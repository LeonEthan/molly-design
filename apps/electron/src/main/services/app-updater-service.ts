import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { autoUpdater, MacUpdater, NsisUpdater, type AppUpdater } from 'electron-updater'
import { loadSparkleBridge, type SparkleBridge } from 'electron-sparkle-updater'
import type {
  CheckForElectronUpdateResult,
  ElectronUpdaterState,
  QuitAndInstallElectronUpdateResult
} from '@molly/shared/electron-ipc'
import { IPC_PUSH_CHANNELS } from '@molly/shared/electron-ipc'
import { formatUnknownError } from '../utils'
import { setAppQuitting } from '../window-state'
import { readUpdaterReleaseMetadata } from './app-updater-metadata'
import { sparkleEventToStatePatch } from './app-updater-sparkle-events'
import { UPDATE_CHECK_UNANSWERED } from '@molly/shared/electron-ipc'
import {
  UPDATE_CHECK_UNANSWERED_MS,
  beginSparkleCheck,
  createCheckingWatchdog,
  nextSparkleEventGate,
  recoverUnansweredCheck,
  shouldResetPhaseForManualCheck,
  type TimeoutHandle
} from './app-updater-check'
import {
  resolveSparkleAddonPath,
  resolveSparkleAppcastUrl,
  shouldUseSparkleUpdater,
  sparklePackageJsonPathFromModuleEntry
} from './app-updater-sparkle-policy'

const SPARKLE_ED_PUBLIC_KEY_PLACEHOLDER = 'SPARKLE_ED_PUBLIC_KEY_PLACEHOLDER'

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000
const MOLLY_UPDATER_STATE_EVENT = IPC_PUSH_CHANNELS.updaterState

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

function readFiniteNumber(record: Record<string, unknown> | null, key: string): number | undefined {
  const value = record ? record[key] : undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function readVersionPrereleaseChannel(version: string): string | undefined {
  const trimmed = version.trim()
  if (!trimmed) return undefined
  const [, prereleasePart] = trimmed.split('-', 2)
  if (!prereleasePart) return undefined

  const [channel] = prereleasePart.split('.', 1)
  const normalized = readNonEmptyString(channel)?.toLowerCase()
  if (!normalized) return undefined
  return normalized
}

// electron-updater defaults to `console`, and a packaged desktop app has no
// terminal attached, so every install failure it reports is lost. Keep the
// updater's own log next to the app data instead.
function createUpdaterLogger() {
  const logPath = join(app.getPath('userData'), 'updater.log')
  const write = (level: string, message: unknown): void => {
    try {
      appendFileSync(logPath, `${new Date().toISOString()} [${level}] ${String(message)}\n`)
    } catch {
      // Logging must never break the update flow.
    }
  }
  return {
    info: (message: unknown) => write('info', message),
    warn: (message: unknown) => write('warn', message),
    error: (message: unknown) => write('error', message)
  }
}

export class AppUpdaterService {
  private state: ElectronUpdaterState = {
    phase: 'idle',
    currentVersion: app.getVersion()
  }
  private started = false
  private electronUpdater: AppUpdater | null = null
  private checkInFlight = false
  private checkTicket = 0
  private intervalRef: NodeJS.Timeout | null = null
  private sparkleBridge: SparkleBridge | null = null
  private sparkleSessionOpen = false
  private ignoreSparkleUntilChecking = false
  /** Package electron-updater has on disk, cleared when a newer one supersedes it. */
  private downloadedFile: string | undefined
  private errorCount = 0
  private preparationInFlight = false
  private configurationUnavailable = false
  private checkingWatchdog: ReturnType<typeof createCheckingWatchdog> | null = null

  constructor(
    private readonly options: {
      enabled?: boolean
      requireSparkle?: boolean
      prepareInstall?: () => Promise<() => Promise<void>>
      prepareToRelaunch?: () => Promise<void>
      abortRelaunch?: () => void
      checkTimeoutMs?: number
      scheduleTimeout?: (callback: () => void, delayMs: number) => TimeoutHandle
    } = {}
  ) {}

  getState(): ElectronUpdaterState {
    return this.state
  }

  start(): void {
    if (this.started) return
    this.started = true

    if (!this.isUpdaterEnabled()) {
      this.setState({
        phase: 'disabled',
        disabledReason: 'updater_disabled_in_dev'
      })
      return
    }

    const sparkleBridge = this.tryLoadSparkleBridge()
    if (sparkleBridge) {
      this.sparkleBridge = sparkleBridge
      this.attachSparkleEventHandler(sparkleBridge)
      sparkleBridge.setAutomaticChecks(true)
      return
    }
    if (this.options.requireSparkle) {
      this.configurationUnavailable = true
      this.setState({ phase: 'disabled', disabledReason: 'molly_update_configuration_unavailable' })
      return
    }

    this.configureElectronUpdater(autoUpdater)
    void this.checkForUpdates()
    this.intervalRef = setInterval(() => {
      void this.checkForUpdates()
    }, UPDATE_CHECK_INTERVAL_MS)
  }

  private configureElectronUpdater(updater: AppUpdater): void {
    updater.logger = createUpdaterLogger()
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true

    if (!app.isPackaged) {
      updater.forceDevUpdateConfig = true
    }

    const updateChannel = this.resolveUpdateChannel()
    updater.channel = updateChannel
    updater.allowPrerelease = updateChannel !== 'latest'

    const updateUrl = readNonEmptyString(import.meta.env.VITE_ELECTRON_UPDATE_URL)
    if (updateUrl) {
      updater.setFeedURL({
        provider: 'generic',
        url: updateUrl
      })
    }

    this.electronUpdater = updater
    this.attachListeners(updater)
  }

  stop(): void {
    if (this.intervalRef) {
      clearInterval(this.intervalRef)
      this.intervalRef = null
    }
    this.checkingWatchdog?.stop()
  }

  async checkForUpdates(): Promise<CheckForElectronUpdateResult> {
    if (!this.isUpdaterEnabled()) {
      return {
        started: false,
        error: 'updater_disabled'
      }
    }
    if (this.sparkleBridge) {
      try {
        if (!shouldResetPhaseForManualCheck(this.state.phase)) {
          this.emitState()
          return { started: false }
        }
        const started = beginSparkleCheck({
          bridge: this.sparkleBridge,
          sessionOpen: this.sparkleSessionOpen
        })
        this.sparkleSessionOpen = started.sessionOpen
        this.ignoreSparkleUntilChecking =
          started.ignoreUntilChecking || this.ignoreSparkleUntilChecking
        if (!started.started) {
          this.setState({
            phase: 'error',
            error: UPDATE_CHECK_UNANSWERED,
            checkedAtMs: Date.now()
          })
          return { started: false, error: UPDATE_CHECK_UNANSWERED }
        }
        this.setState({
          phase: 'checking',
          error: undefined,
          checkedAtMs: Date.now(),
          percent: undefined,
          bytesPerSecond: undefined,
          transferred: undefined,
          total: undefined
        })
        return { started: true }
      } catch (error) {
        const message = formatUnknownError(error)
        this.setState({
          phase: 'error',
          error: message,
          checkedAtMs: Date.now()
        })
        return {
          started: false,
          error: message
        }
      }
    }
    if (this.checkInFlight) {
      return {
        started: false,
        error: 'check_in_progress'
      }
    }

    if (!shouldResetPhaseForManualCheck(this.state.phase)) {
      this.emitState()
      return { started: false }
    }

    const ticket = ++this.checkTicket
    this.checkInFlight = true
    this.setState({
      phase: 'checking',
      error: undefined,
      checkedAtMs: Date.now(),
      percent: undefined,
      bytesPerSecond: undefined,
      transferred: undefined,
      total: undefined
    })

    try {
      let updater = this.electronUpdater
      if (!updater) {
        if (process.platform === 'darwin') updater = new MacUpdater()
        else if (process.platform === 'win32') updater = new NsisUpdater()
        else throw new Error('Unsupported updater platform')
        this.configureElectronUpdater(updater)
      }
      await updater.checkForUpdates()
      return { started: true }
    } catch (error) {
      const message = formatUnknownError(error)
      if (this.checkTicket === ticket) this.recordError(message)
      return {
        started: false,
        error: message
      }
    } finally {
      if (this.checkTicket === ticket) this.checkInFlight = false
    }
  }

  async quitAndInstall(): Promise<QuitAndInstallElectronUpdateResult> {
    if (!this.isUpdaterEnabled()) return { ok: false, error: 'updater_disabled' }
    if (this.state.phase !== 'downloaded') return { ok: false, error: 'update_not_downloaded' }
    if (this.preparationInFlight) return { ok: false, error: 'update_install_in_progress' }
    this.preparationInFlight = true
    let release: (() => Promise<void>) | undefined
    try {
      release = await this.options.prepareInstall?.()
      const result = await this.installDownloadedUpdate()
      if (!result.ok) await release?.()
      return result
    } catch (error) {
      await release?.()
      const message = formatUnknownError(error)
      this.recordError(message)
      return { ok: false, error: message }
    } finally {
      this.preparationInFlight = false
    }
  }

  private async installDownloadedUpdate(): Promise<QuitAndInstallElectronUpdateResult> {
    try {
      await this.options.prepareToRelaunch?.()
    } catch (error) {
      this.options.abortRelaunch?.()
      const message = formatUnknownError(error)
      this.recordError(message)
      return { ok: false, error: message }
    }

    if (this.sparkleBridge) {
      try {
        setAppQuitting(true)
        this.sparkleBridge.installUpdateNow()
        return { ok: true }
      } catch (error) {
        setAppQuitting(false)
        this.options.abortRelaunch?.()
        const message = formatUnknownError(error)
        this.recordError(message)
        return {
          ok: false,
          error: message
        }
      }
    }

    if (this.state.phase !== 'downloaded' || !this.electronUpdater) {
      return {
        ok: false,
        error: 'update_not_downloaded'
      }
    }

    try {
      setAppQuitting(true)
      const errorsBeforeInstall = this.errorCount
      this.electronUpdater.quitAndInstall(false, true)
      // electron-updater reports install failures through its `error` event and
      // returns normally, so a plain `ok: true` here would leave the renderer
      // spinning on an install that never started. The event listener is
      // synchronous, so a failure is already recorded by now. The phase itself
      // is no longer the signal: a downloaded package stays `downloaded` so the
      // user can retry.
      if (this.errorCount !== errorsBeforeInstall) {
        setAppQuitting(false)
        this.options.abortRelaunch?.()
        return {
          ok: false,
          error: this.state.error ?? 'update_install_failed'
        }
      }
      return { ok: true }
    } catch (error) {
      setAppQuitting(false)
      this.options.abortRelaunch?.()
      const message = formatUnknownError(error)
      this.recordError(message)
      return {
        ok: false,
        error: message
      }
    }
  }

  /**
   * Record a failure without discarding an installable package. A failed check
   * or a failed install leaves the downloaded update on disk, and dropping the
   * phase to `error` would hide both the sidebar banner and the About panel's
   * install button, which is the only way to retry.
   */
  private recordError(message: string): void {
    this.errorCount += 1
    this.setState({
      phase: this.downloadedFile || this.state.phase === 'downloaded' ? 'downloaded' : 'error',
      error: message,
      checkedAtMs: Date.now()
    })
  }

  private tryLoadSparkleBridge(): SparkleBridge | null {
    if (
      !shouldUseSparkleUpdater({
        platform: process.platform,
        isPackaged: app.isPackaged,
        sparkleAvailable: true
      })
    ) {
      return null
    }

    // In a signed package Info.plist is authoritative; an inherited shell key/feed
    // must not redirect a Molly installation or downgrade its verification.
    if (this.options.requireSparkle) {
      try {
        const plist = join(app.getAppPath(), '..', '..', 'Info.plist')
        const read = (key: string) =>
          execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], {
            encoding: 'utf8'
          }).trim()
        const expectedFeed = resolveSparkleAppcastUrl({
          configuredAppcastUrl: process.env.SPARKLE_APPCAST_URL
        })
        if (
          read('CFBundleIdentifier') !== 'dev.molly-design.app' ||
          read('SUFeedURL') !== expectedFeed ||
          !/^[A-Za-z0-9+/]{43}=$/.test(read('SUPublicEDKey'))
        )
          return null
      } catch {
        return null
      }
    }

    const log = (message: string): void => {
      console.log(`[sparkle] ${message}`)
    }

    let resolvedPackageJsonPath: string | undefined
    try {
      resolvedPackageJsonPath = sparklePackageJsonPathFromModuleEntry(
        createRequire(import.meta.url).resolve('electron-sparkle-updater')
      )
    } catch {
      resolvedPackageJsonPath = undefined
    }

    const addonPath = resolveSparkleAddonPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      resolvedPackageJsonPath,
      exists: existsSync
    })
    if (!addonPath) {
      log('native addon not found')
      return null
    }

    const bridge = loadSparkleBridge({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      addonPath,
      log
    })
    if (!bridge) return null

    const initialized = bridge.init({
      appcastUrl: resolveSparkleAppcastUrl({
        configuredAppcastUrl: readNonEmptyString(process.env.SPARKLE_APPCAST_URL)
      }),
      publicEdKey:
        readNonEmptyString(process.env.SPARKLE_ED_PUBLIC_KEY) ?? SPARKLE_ED_PUBLIC_KEY_PLACEHOLDER
    })
    if (!initialized) {
      log('init failed')
      return null
    }
    return bridge
  }

  private attachSparkleEventHandler(bridge: SparkleBridge): void {
    if (typeof bridge.setEventHandler !== 'function') {
      console.log('[sparkle] native bridge has no event handler; renderer progress will not update')
      return
    }
    bridge.setEventHandler((event) => {
      const eventType = typeof event?.type === 'string' ? event.type : undefined
      const gate = nextSparkleEventGate(this.ignoreSparkleUntilChecking, eventType)
      this.ignoreSparkleUntilChecking = gate.ignoreUntilChecking
      if (!gate.deliver) return
      try {
        const patch = sparkleEventToStatePatch(event, Date.now())
        if (!patch) return
        if (patch.phase) this.sparkleSessionOpen = patch.phase === 'checking'
        this.setState(patch)
      } catch (error) {
        console.log(`[sparkle] event handler failed: ${formatUnknownError(error)}`)
      }
    })
  }

  private isUpdaterEnabled(): boolean {
    if (this.configurationUnavailable) return false
    if (this.options.enabled === false) return false
    if (app.isPackaged) return true
    return (
      (process.env.MOLLY_ELECTRON_ENABLE_DEV_UPDATER ??
        process.env.LODY_ELECTRON_ENABLE_DEV_UPDATER) === '1'
    )
  }

  private resolveUpdateChannel(): string {
    const configuredChannel = readNonEmptyString(import.meta.env.VITE_ELECTRON_UPDATE_CHANNEL)
    if (configuredChannel) return configuredChannel.toLowerCase()

    if (!app.isPackaged) {
      return 'next'
    }

    const prereleaseChannel = readVersionPrereleaseChannel(app.getVersion())
    if (prereleaseChannel) return prereleaseChannel

    return 'latest'
  }

  private attachListeners(updater: AppUpdater): void {
    updater.on('checking-for-update', () => {
      if (updater !== this.electronUpdater) return
      this.setState({
        phase: 'checking',
        error: undefined,
        checkedAtMs: Date.now(),
        percent: undefined,
        bytesPerSecond: undefined,
        transferred: undefined,
        total: undefined
      })
    })

    updater.on('update-available', (payload) => {
      if (updater !== this.electronUpdater) return
      const record = readObject(payload)
      const version = readNonEmptyString(record?.version)
      // A newer version supersedes whatever is cached; electron-updater cleans
      // that directory, so the old path would point at a deleted file.
      this.downloadedFile = undefined
      this.setState({
        phase: 'downloading',
        availableVersion: version,
        downloadedVersion: undefined,
        ...readUpdaterReleaseMetadata(payload, version),
        checkedAtMs: Date.now(),
        error: undefined
      })
    })

    updater.on('update-not-available', () => {
      if (updater !== this.electronUpdater) return
      this.setState({
        phase: 'up_to_date',
        availableVersion: undefined,
        downloadedVersion: undefined,
        percent: undefined,
        bytesPerSecond: undefined,
        transferred: undefined,
        total: undefined,
        checkedAtMs: Date.now(),
        error: undefined
      })
    })

    updater.on('download-progress', (payload) => {
      if (updater !== this.electronUpdater) return
      const record = readObject(payload)
      this.setState({
        phase: 'downloading',
        percent: readFiniteNumber(record, 'percent'),
        bytesPerSecond: readFiniteNumber(record, 'bytesPerSecond'),
        transferred: readFiniteNumber(record, 'transferred'),
        total: readFiniteNumber(record, 'total')
      })
    })

    updater.on('update-downloaded', (payload) => {
      if (updater !== this.electronUpdater) return
      const record = readObject(payload)
      const version = readNonEmptyString(record?.version)
      const targetVersion = version ?? this.state.availableVersion
      this.downloadedFile = readNonEmptyString(record?.downloadedFile)
      this.setState({
        phase: 'downloaded',
        downloadedVersion: version,
        availableVersion: targetVersion,
        ...readUpdaterReleaseMetadata(payload, targetVersion),
        checkedAtMs: Date.now(),
        error: undefined
      })
    })

    updater.on('error', (error) => {
      if (updater !== this.electronUpdater) return
      this.recordError(formatUnknownError(error))
    })
  }

  private setState(nextPartialState: Partial<ElectronUpdaterState>): void {
    this.state = {
      ...this.state,
      ...nextPartialState,
      currentVersion: app.getVersion()
    }
    this.emitState()
    this.syncCheckingWatchdog()
  }

  private syncCheckingWatchdog(): void {
    if (!this.checkingWatchdog) {
      const schedule =
        this.options.scheduleTimeout ??
        ((callback: () => void, delayMs: number): TimeoutHandle => {
          const timer = setTimeout(callback, delayMs)
          return { cancel: () => clearTimeout(timer) }
        })
      this.checkingWatchdog = createCheckingWatchdog({
        delayMs: this.options.checkTimeoutMs ?? UPDATE_CHECK_UNANSWERED_MS,
        schedule,
        isChecking: () => this.state.phase === 'checking',
        onUnanswered: () => {
          this.checkTicket += 1
          this.checkInFlight = false
          if (!this.sparkleBridge && this.electronUpdater) {
            this.electronUpdater.autoDownload = false
            this.electronUpdater.autoInstallOnAppQuit = false
            this.electronUpdater = null
          }
          const recovered = recoverUnansweredCheck({
            sparkle: this.sparkleBridge,
            sparkleSessionOpen: this.sparkleSessionOpen
          })
          this.sparkleSessionOpen = recovered.sparkleSessionOpen
          this.ignoreSparkleUntilChecking = recovered.ignoreUntilChecking
          this.setState({
            phase: 'error',
            error: UPDATE_CHECK_UNANSWERED,
            checkedAtMs: Date.now()
          })
        }
      })
    }
    this.checkingWatchdog.sync(this.state.phase)
  }

  private emitState(): void {
    for (const browserWindow of BrowserWindow.getAllWindows()) {
      if (browserWindow.isDestroyed()) continue
      const webContents = browserWindow.webContents
      if (!webContents || webContents.isDestroyed()) continue
      webContents.send(MOLLY_UPDATER_STATE_EVENT, this.state)
    }
  }
}
