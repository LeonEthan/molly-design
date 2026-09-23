import { app, BrowserWindow, safeStorage, WebContentsView, session, type Rectangle } from 'electron'
import {
  ELECTRON_PUBLIC_BROWSER_STATE_CHANNEL,
  type ElectronPublicBrowserBounds,
  type ElectronPublicBrowserResult,
  type ElectronPublicBrowserState,
  type ElectronBrowserAccountSummary
} from '@molly/shared/electron-ipc'
import { parseBrowserAddress } from '@molly/shared/browser-url'
import { ElectronBrowserAccountSiteInputSchema } from '@molly/shared/electron-ipc'
import { formatUnknownError } from '../utils'
import { isNavigationAbortError, mergePublicBrowserState } from './public-browser-state'
import type {
  AgentBrowserCommand,
  AgentBrowserHostReply,
  AgentBrowserScope
} from '@molly/shared/browser-agent-rpc'
import {
  PublicBrowserAgentController,
  canPersistPublicBrowserSession,
  publicBrowserPartition
} from './public-browser-agent-controller'
import { hostMatchesSite } from './public-browser-agent-policy'
import {
  listChromeProfiles,
  readChromeSiteCookies,
  type ChromeProfileChoice
} from './browser-account-source'
import {
  assertStoredCookiesUnpartitioned,
  importChromeAccountCookies
} from './browser-account-import'

type PublicBrowserRecord = {
  browserId: string
  view: WebContentsView
  window: BrowserWindow
  captureWindow?: BrowserWindow
  bounds: Rectangle
  state: ElectronPublicBrowserState
  visible: boolean
  lastUsedAt: number
  navigationSequence: number
}

const MAX_PUBLIC_BROWSER_RECORDS = 8
const ACCOUNT_IMPORT_SITES = ElectronBrowserAccountSiteInputSchema.shape.site.options
type AccountImportSite = (typeof ACCOUNT_IMPORT_SITES)[number]

type AccountImportReadinessError = {
  reason: NonNullable<ElectronBrowserAccountSummary['importUnavailableReason']>
  message: string
}

const accountImportReadinessError = (): AccountImportReadinessError | null => {
  if (process.platform !== 'darwin' || !app.isPackaged)
    return {
      reason: 'package-required',
      message: 'Chrome account import requires a packaged Molly app on macOS.'
    }
  if (!canPersistPublicBrowserSession())
    return {
      reason: 'signing-required',
      message: 'Chrome account import requires a Molly build with a stable macOS signing identity.'
    }
  if (!safeStorage.isEncryptionAvailable())
    return {
      reason: 'secure-storage-unavailable',
      message: 'macOS secure storage is unavailable; Chrome account import was stopped.'
    }
  return null
}

const toState = (
  record: PublicBrowserRecord,
  patch: Partial<ElectronPublicBrowserState> = {}
): ElectronPublicBrowserState => {
  const committedUrl = record.view.webContents.getURL()
  return mergePublicBrowserState(
    record.state,
    {
      committedUrl: /^https?:\/\//i.test(committedUrl) ? committedUrl : undefined,
      committedTitle: record.view.webContents.getTitle() || undefined,
      canGoBack: record.view.webContents.navigationHistory.canGoBack(),
      canGoForward: record.view.webContents.navigationHistory.canGoForward()
    },
    patch
  )
}

/** Manual navigation keeps the original hostname-based engine routing. Agent
 * navigation additionally uses the guarded lease in PublicBrowserAgentController. */
const assertPublicUrl = (rawUrl: string): string => {
  const parsed = parseBrowserAddress(rawUrl)
  if (parsed.engine !== 'public-web') {
    throw new Error('Public browser only accepts public HTTP(S) destinations.')
  }
  return parsed.logicalUrl
}

const normalizeBounds = (window: BrowserWindow, bounds: ElectronPublicBrowserBounds): Rectangle => {
  const [contentWidth, contentHeight] = window.getContentSize()
  const normalized = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  }
  if (
    normalized.x < 0 ||
    normalized.y < 0 ||
    normalized.width < 1 ||
    normalized.height < 1 ||
    normalized.x + normalized.width > contentWidth ||
    normalized.y + normalized.height > contentHeight
  ) {
    throw new Error('Public browser bounds are outside the main window content area.')
  }
  return {
    x: normalized.x,
    y: normalized.y,
    width: Math.min(normalized.width, contentWidth - normalized.x),
    height: Math.min(normalized.height, contentHeight - normalized.y)
  }
}

export class PublicBrowserService {
  private readonly records = new Map<string, PublicBrowserRecord>()
  private readonly observedWindows = new WeakSet<BrowserWindow>()
  private readonly agent = new PublicBrowserAgentController()
  private readonly configuredSessions = new WeakSet<Electron.Session>()
  private readonly humanTakeovers = new Map<string, AgentBrowserScope>()
  private readonly closedAgentPages = new Map<string, string>()
  private accountMutation: Promise<void> = Promise.resolve()

  constructor(private readonly getMainWindow: () => BrowserWindow | null) {}

  create(
    browserId: string,
    bounds: ElectronPublicBrowserBounds,
    visible = true
  ): ElectronPublicBrowserResult {
    try {
      const existing = this.records.get(browserId)
      if (existing && !existing.window.isDestroyed() && !existing.view.webContents.isDestroyed()) {
        existing.bounds = normalizeBounds(existing.window, bounds)
        if (visible) {
          this.moveToMainWindow(existing)
          existing.view.setBounds(existing.bounds)
          existing.view.setVisible(true)
        } else {
          this.moveToCaptureWindow(existing)
        }
        existing.visible = visible
        existing.lastUsedAt = performance.now()
        this.publish(existing)
        return { ok: true, state: existing.state }
      }
      if (existing) this.destroy(browserId)

      const window = this.getMainWindow()
      if (!window || window.isDestroyed()) {
        return { ok: false, error: 'The main Electron window is not available.' }
      }

      const capacityFailure = this.evictHiddenRecordAtCapacity()
      if (capacityFailure) return { ok: false, error: capacityFailure }
      const view = new WebContentsView({
        webPreferences: {
          partition: publicBrowserPartition(),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          disableBlinkFeatures: 'WebRTC',
          spellcheck: false
        }
      })
      const record: PublicBrowserRecord = {
        browserId,
        view,
        window,
        bounds: normalizeBounds(window, bounds),
        state: {
          browserId,
          phase: 'idle',
          canGoBack: false,
          canGoForward: false,
          agentControl: this.humanTakeovers.has(browserId) ? 'human-takeover' : 'human'
        },
        visible,
        lastUsedAt: performance.now(),
        navigationSequence: 0
      }
      this.records.set(browserId, record)
      this.configureSession(record)
      this.configureWebContents(record)
      if (visible) {
        window.contentView.addChildView(view)
        view.setBounds(record.bounds)
        view.setVisible(true)
      } else {
        this.moveToCaptureWindow(record)
      }
      if (!this.observedWindows.has(window)) {
        this.observedWindows.add(window)
        window.once('closed', () => this.destroyWindowRecords(window))
      }
      this.publish(record)
      return { ok: true, state: record.state }
    } catch (error) {
      const partialRecord = this.records.get(browserId)
      if (partialRecord) this.disposeRecord(partialRecord)
      return { ok: false, error: formatUnknownError(error) }
    }
  }

  async navigate(browserId: string, rawUrl: string): Promise<ElectronPublicBrowserResult> {
    const record = this.records.get(browserId)
    if (!record) return { ok: false, error: 'Public browser surface has not been created.' }
    const navigationSequence = ++record.navigationSequence
    try {
      this.takeAgentControl(browserId)
      this.publish(record, {
        agentControl: this.humanTakeovers.has(browserId) ? 'human-takeover' : 'human'
      })
      record.lastUsedAt = performance.now()
      const url = assertPublicUrl(rawUrl)
      if (record.navigationSequence !== navigationSequence) {
        return { ok: true, state: record.state }
      }
      if (record.state.phase === 'ready' && record.view.webContents.getURL() === url) {
        this.publish(record, { phase: 'ready', error: undefined, blockedUrl: undefined })
        return { ok: true, state: record.state }
      }
      this.publish(record, { phase: 'loading', url, error: undefined, blockedUrl: undefined })
      await record.view.webContents.loadURL(url)
      if (record.navigationSequence !== navigationSequence) {
        return { ok: true, state: record.state }
      }
      return { ok: true, state: record.state }
    } catch (error) {
      if (record.navigationSequence !== navigationSequence || isNavigationAbortError(error)) {
        return { ok: true, state: record.state }
      }
      const message = formatUnknownError(error)
      this.publish(record, { phase: 'error', error: message })
      return { ok: false, error: message }
    }
  }

  goBack(browserId: string): ElectronPublicBrowserResult {
    const record = this.records.get(browserId)
    if (!record) return { ok: false, error: 'Public browser surface has not been created.' }
    if (!record.view.webContents.navigationHistory.canGoBack()) {
      return { ok: false, error: 'No previous public browser history entry.' }
    }
    this.takeAgentControl(browserId)
    this.publish(record, {
      agentControl: this.humanTakeovers.has(browserId) ? 'human-takeover' : 'human'
    })
    record.navigationSequence += 1
    record.view.webContents.navigationHistory.goBack()
    return { ok: true, state: record.state }
  }

  goForward(browserId: string): ElectronPublicBrowserResult {
    const record = this.records.get(browserId)
    if (!record) return { ok: false, error: 'Public browser surface has not been created.' }
    if (!record.view.webContents.navigationHistory.canGoForward()) {
      return { ok: false, error: 'No next public browser history entry.' }
    }
    this.takeAgentControl(browserId)
    this.publish(record, {
      agentControl: this.humanTakeovers.has(browserId) ? 'human-takeover' : 'human'
    })
    record.navigationSequence += 1
    record.view.webContents.navigationHistory.goForward()
    return { ok: true, state: record.state }
  }

  reload(browserId: string): ElectronPublicBrowserResult {
    const record = this.records.get(browserId)
    if (!record) return { ok: false, error: 'Public browser surface has not been created.' }
    this.takeAgentControl(browserId)
    this.publish(record, {
      agentControl: this.humanTakeovers.has(browserId) ? 'human-takeover' : 'human'
    })
    record.navigationSequence += 1
    record.view.webContents.reload()
    return { ok: true, state: record.state }
  }

  stop(browserId: string): ElectronPublicBrowserResult {
    const record = this.records.get(browserId)
    if (!record) return { ok: false, error: 'Public browser surface has not been created.' }
    this.takeAgentControl(browserId)
    this.publish(record, {
      agentControl: this.humanTakeovers.has(browserId) ? 'human-takeover' : 'human'
    })
    record.navigationSequence += 1
    record.view.webContents.stop()
    this.publish(record, { phase: record.view.webContents.getURL() ? 'ready' : 'idle' })
    return { ok: true, state: record.state }
  }

  setBounds(browserId: string, bounds: ElectronPublicBrowserBounds): ElectronPublicBrowserResult {
    const record = this.records.get(browserId)
    if (!record) return { ok: false, error: 'Public browser surface has not been created.' }
    try {
      record.bounds = normalizeBounds(record.window, bounds)
      if (record.captureWindow) {
        record.captureWindow.setContentSize(record.bounds.width, record.bounds.height)
        record.view.setBounds({
          x: 0,
          y: 0,
          width: record.bounds.width,
          height: record.bounds.height
        })
      } else {
        record.view.setBounds(record.bounds)
      }
      return { ok: true, state: record.state }
    } catch (error) {
      return { ok: false, error: formatUnknownError(error) }
    }
  }

  setVisible(browserId: string, visible: boolean): ElectronPublicBrowserResult {
    const record = this.records.get(browserId)
    if (!record) return { ok: false, error: 'Public browser surface has not been created.' }
    if (visible) {
      this.moveToMainWindow(record)
      record.view.setBounds(record.bounds)
      record.view.setVisible(true)
    } else if (this.agent.hasLease(record.view.webContents)) {
      this.moveToCaptureWindow(record)
    } else {
      record.view.setVisible(false)
    }
    record.visible = visible
    record.lastUsedAt = performance.now()
    return { ok: true, state: record.state }
  }

  destroy(browserId: string): ElectronPublicBrowserResult {
    const record = this.records.get(browserId)
    if (!record) return { ok: false, error: 'Public browser surface has not been created.' }
    const scope = this.takeAgentControl(browserId) ?? this.humanTakeovers.get(browserId)
    if (scope) this.closedAgentPages.set(browserId, scope.runId)
    this.disposeRecord(record)
    return { ok: true, state: record.state }
  }

  destroyAll(): void {
    this.revokeAllAgentCommands()
    this.humanTakeovers.clear()
    for (const browserId of [...this.records.keys()]) this.destroy(browserId)
    this.closedAgentPages.clear()
  }

  getState(browserId: string): ElectronPublicBrowserState | null {
    const record = this.records.get(browserId)
    return record ? toState(record) : null
  }

  async executeAgentCommand(
    scope: AgentBrowserScope,
    command: AgentBrowserCommand
  ): Promise<AgentBrowserHostReply> {
    // Browser identity comes from the trusted Session, never from a model-supplied target id.
    if (!/^session-browser-[a-zA-Z0-9_-]{1,128}$/.test(scope.browserId)) {
      throw new Error('Invalid session browser identity.')
    }
    const closedRun = this.closedAgentPages.get(scope.browserId)
    if (closedRun === scope.runId)
      throw new Error('This browser page was closed. Start a new task to browse again.')
    if (closedRun) this.closedAgentPages.delete(scope.browserId)
    const takeover = this.humanTakeovers.get(scope.browserId)
    if (takeover?.runId === scope.runId)
      throw new Error('The user has taken control of this browser page.')
    if (takeover) this.humanTakeovers.delete(scope.browserId)
    let record = this.records.get(scope.browserId)
    if (!record) {
      const window = this.getMainWindow()
      if (!window || window.isDestroyed())
        throw new Error('The main Electron window is not available.')
      const [width, height] = window.getContentSize()
      const created = this.create(
        scope.browserId,
        {
          x: 0,
          y: 0,
          width: Math.max(1, Math.min(width, 1280)),
          height: Math.max(1, Math.min(height, 800))
        },
        false
      )
      if (!created.ok) throw new Error(created.error)
      record = this.records.get(scope.browserId)
      if (!record) throw new Error('Browser page was not created.')
    }
    if (!record.visible) this.moveToCaptureWindow(record)
    record.lastUsedAt = performance.now()
    this.publish(record, { agentControl: 'agent' })
    try {
      const result = await this.agent.execute(record.view.webContents, scope, command)
      return result
    } finally {
      if (!this.agent.hasLease(record.view.webContents))
        this.publish(record, {
          agentControl: this.humanTakeovers.has(scope.browserId) ? 'human-takeover' : 'human'
        })
    }
  }

  revokeAgentCommand(browserId: string): void {
    const record = this.records.get(browserId)
    if (record) {
      this.agent.revoke(record.view.webContents)
      this.publish(record, {
        agentControl: this.humanTakeovers.has(browserId) ? 'human-takeover' : 'human'
      })
    }
  }

  takeAgentControl(browserId: string): AgentBrowserScope | null {
    const scope = this.agent.activeScopes().find((active) => active.browserId === browserId)
    if (!scope) return null
    this.humanTakeovers.set(browserId, scope)
    this.revokeAgentCommand(browserId)
    return scope
  }

  takeoverScope(browserId: string): AgentBrowserScope | null {
    return this.humanTakeovers.get(browserId) ?? null
  }

  canResumeAgentControl(browserId: string, runId: string): boolean {
    return this.closedAgentPages.get(browserId) !== runId
  }

  resumeAgentControl(browserId: string, runId: string): void {
    if (this.humanTakeovers.get(browserId)?.runId === runId) {
      this.humanTakeovers.delete(browserId)
      const record = this.records.get(browserId)
      if (record) this.publish(record, { agentControl: 'human' })
    }
  }

  activeAgentScopes(): AgentBrowserScope[] {
    return this.agent.activeScopes()
  }

  takeoverScopes(): AgentBrowserScope[] {
    return [...this.humanTakeovers.values()]
  }

  private pauseAgentsForAccountChange(): void {
    for (const scope of this.agent.activeScopes()) this.takeAgentControl(scope.browserId)
  }

  private async runAccountMutation<T>(work: () => Promise<T>): Promise<T> {
    const prior = this.accountMutation
    let release: () => void = () => undefined
    this.accountMutation = new Promise<void>((resolve) => {
      release = resolve
    })
    await prior
    try {
      return await work()
    } finally {
      release()
    }
  }

  revokeAllAgentCommands(): void {
    for (const record of this.records.values()) this.revokeAgentCommand(record.browserId)
  }

  async getChromeProfiles(): Promise<ChromeProfileChoice[]> {
    const readinessError = accountImportReadinessError()
    if (readinessError) throw new Error(readinessError.message)
    try {
      return await listChromeProfiles()
    } catch {
      throw new Error('Molly could not list Chrome profiles on this Mac.')
    }
  }

  async getAccountSummary(): Promise<ElectronBrowserAccountSummary> {
    await this.accountMutation
    const browserSession = session.fromPartition(publicBrowserPartition())
    const sites = await Promise.all(
      ACCOUNT_IMPORT_SITES.map(async (site) => {
        const cookies = await browserSession.cookies.get({ domain: site })
        return {
          site,
          cookieCount: cookies.filter((cookie) =>
            hostMatchesSite((cookie.domain ?? '').replace(/^\./, ''), site)
          ).length
        }
      })
    )
    const reason = accountImportReadinessError()
    return {
      persistent: canPersistPublicBrowserSession(),
      importAvailable: reason === null,
      ...(reason ? { importUnavailableReason: reason.reason } : {}),
      sites
    }
  }

  async importChromeAccount(
    profileId: string,
    site: AccountImportSite,
    replaceExisting: boolean
  ): Promise<number> {
    const readinessError = accountImportReadinessError()
    if (readinessError) throw new Error(readinessError.message)
    return await this.runAccountMutation(async () => {
      const browserSession = session.fromPartition(publicBrowserPartition())
      const imported = await importChromeAccountCookies({
        store: browserSession.cookies,
        site,
        replaceExisting,
        readSource: () => readChromeSiteCookies(profileId, site),
        beforeWrite: async () => {
          this.pauseAgentsForAccountChange()
          // Read partition metadata in the destination session. Electron's
          // cookies.get() omits it, so it cannot establish a lossless backup.
          // A blank, short-lived view avoids interfering with any Agent page.
          const probe = new WebContentsView({
            webPreferences: {
              session: browserSession,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false
            }
          })
          let snapshot: unknown
          try {
            probe.webContents.debugger.attach('1.3')
            snapshot = await probe.webContents.debugger.sendCommand('Network.getAllCookies')
          } catch {
            throw new Error(
              'Molly could not verify existing cookie identities. No cookies were imported.'
            )
          } finally {
            if (!probe.webContents.isDestroyed()) probe.webContents.close()
          }
          assertStoredCookiesUnpartitioned(snapshot, site)
        }
      })
      for (const record of this.records.values()) {
        const url = record.view.webContents.getURL()
        if (url && hostMatchesSite(new URL(url).hostname, site)) {
          this.publish(record, { accountImport: { site, imported, at: Date.now() } })
          record.view.webContents.reload()
        }
      }
      return imported
    })
  }

  async clearAccountCookies(site: string): Promise<number> {
    return await this.runAccountMutation(async () => {
      if (!ACCOUNT_IMPORT_SITES.includes(site as AccountImportSite)) {
        throw new Error('Site cookie clearing currently supports Pinterest only.')
      }
      this.pauseAgentsForAccountChange()
      const browserSession = session.fromPartition(publicBrowserPartition())
      const cookies = await browserSession.cookies.get({ domain: site })
      let removed = 0
      for (const cookie of cookies) {
        const host = (cookie.domain ?? '').replace(/^\./, '')
        if (!hostMatchesSite(host, site)) continue
        await browserSession.cookies.remove(
          `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`,
          cookie.name
        )
        removed += 1
      }
      await browserSession.cookies.flushStore()
      for (const record of this.records.values()) {
        const url = record.view.webContents.getURL()
        if (url && hostMatchesSite(new URL(url).hostname, site)) {
          this.publish(record, { accountImport: undefined })
          record.view.webContents.reload()
        }
      }
      return removed
    })
  }

  private configureSession(record: PublicBrowserRecord): void {
    const browserSession = record.view.webContents.session
    if (this.configuredSessions.has(browserSession)) return
    this.configuredSessions.add(browserSession)
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
    browserSession.on('will-download', (event) => event.preventDefault())
  }

  private configureWebContents(record: PublicBrowserRecord): void {
    const contents = record.view.webContents
    contents.setWindowOpenHandler((details) => {
      if (this.agent.hasLease(contents)) return { action: 'deny' }
      void this.navigate(record.browserId, details.url)
      return { action: 'deny' }
    })
    // Both events, as `installNavigationGuard` in `window.ts` does. `will-navigate`
    // does not fire for a server-side 3xx, so a public page redirecting to loopback
    // would otherwise commit here — the engine split has to hold for the hop the
    // server chose, not only the one the page did.
    const enforceEngineRouting = (details: { url: string; preventDefault: () => void }): void => {
      try {
        if (
          parseBrowserAddress(details.url).engine === 'public-web' &&
          this.agent.permitsTopLevelNavigation(contents, details.url)
        )
          return
      } catch {
        // The structured error is published below.
      }
      details.preventDefault()
      this.publish(record, {
        phase: 'error',
        error: 'Navigation left the public web boundary.',
        blockedUrl: details.url
      })
    }
    contents.on('will-navigate', enforceEngineRouting)
    contents.on('will-redirect', enforceEngineRouting)
    contents.on('did-start-loading', () => {
      // Pages such as Pinterest keep subresources active after their document is
      // usable. Do not put the full-page loading cover back over a ready page.
      if (record.state.phase === 'ready' && !contents.isLoadingMainFrame()) return
      this.publish(record, { phase: 'loading', error: undefined, blockedUrl: undefined })
    })
    contents.on('dom-ready', () => {
      if (record.state.phase === 'loading' && /^https?:\/\//i.test(contents.getURL())) {
        this.publish(record, { phase: 'ready' })
      }
    })
    contents.on('did-stop-loading', () => {
      this.publish(
        record,
        record.state.phase === 'error' ? {} : { phase: contents.getURL() ? 'ready' : 'idle' }
      )
    })
    contents.on('did-navigate', (_event, url) => {
      if (/^https?:\/\//i.test(url)) this.publish(record, { url })
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) this.publish(record, { url })
    })
    contents.on('page-title-updated', (_event, title) => this.publish(record, { title }))
    contents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || isNavigationAbortError({ errno: errorCode })) return
        this.publish(record, {
          phase: 'error',
          url: validatedURL,
          error: errorDescription
        })
      }
    )
    contents.on('render-process-gone', (_event, details) => {
      this.publish(record, {
        phase: 'crashed',
        error: `Public browser renderer exited: ${details.reason}`
      })
    })
  }

  private publish(
    record: PublicBrowserRecord,
    patch: Partial<ElectronPublicBrowserState> = {}
  ): void {
    record.state = toState(record, patch)
    if (!record.window.isDestroyed()) {
      record.window.webContents.send(ELECTRON_PUBLIC_BROWSER_STATE_CHANNEL, record.state)
    }
  }

  private evictHiddenRecordAtCapacity(): string | null {
    if (this.records.size < MAX_PUBLIC_BROWSER_RECORDS) return null
    const candidate = [...this.records.values()]
      .filter((record) => !record.visible && !this.agent.hasLease(record.view.webContents))
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0]
    if (!candidate) {
      return `Public browser capacity reached (${MAX_PUBLIC_BROWSER_RECORDS}) with no hidden surface available for eviction.`
    }
    this.destroy(candidate.browserId)
    return null
  }

  private destroyWindowRecords(window: BrowserWindow): void {
    for (const record of [...this.records.values()]) {
      if (record.window === window) this.destroy(record.browserId)
    }
  }

  private disposeRecord(record: PublicBrowserRecord): void {
    this.agent.revoke(record.view.webContents)
    this.records.delete(record.browserId)
    if (record.captureWindow) {
      const captureWindow = record.captureWindow
      record.captureWindow = undefined
      if (!captureWindow.isDestroyed()) {
        captureWindow.contentView.removeChildView(record.view)
        captureWindow.close()
      }
    } else if (!record.window.isDestroyed()) {
      record.window.contentView.removeChildView(record.view)
    }
    if (!record.view.webContents.isDestroyed()) record.view.webContents.close()
  }

  private moveToCaptureWindow(record: PublicBrowserRecord): void {
    if (record.captureWindow && !record.captureWindow.isDestroyed()) return
    if (!record.window.isDestroyed()) record.window.contentView.removeChildView(record.view)
    const captureWindow = new BrowserWindow({
      width: record.bounds.width,
      height: record.bounds.height,
      show: false,
      skipTaskbar: true,
      frame: false,
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true }
    })
    record.captureWindow = captureWindow
    captureWindow.once('closed', () => {
      if (record.captureWindow === captureWindow) this.destroy(record.browserId)
    })
    captureWindow.contentView.addChildView(record.view)
    record.view.setBounds({ x: 0, y: 0, width: record.bounds.width, height: record.bounds.height })
    record.view.setVisible(true)
  }

  private moveToMainWindow(record: PublicBrowserRecord): void {
    const captureWindow = record.captureWindow
    if (!captureWindow) return
    record.captureWindow = undefined
    if (!captureWindow.isDestroyed()) {
      captureWindow.contentView.removeChildView(record.view)
    }
    record.window.contentView.addChildView(record.view)
    if (!captureWindow.isDestroyed()) captureWindow.close()
  }
}
