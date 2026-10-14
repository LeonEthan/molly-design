import { app, BrowserWindow, safeStorage, WebContentsView, session, type Rectangle } from 'electron'
import {
  ELECTRON_PUBLIC_BROWSER_STATE_CHANNEL,
  type ElectronPublicBrowserBounds,
  type ElectronPublicBrowserResult,
  type ElectronPublicBrowserState,
  type AccountImportBrowserId,
  type ElectronBrowserAccountSummary,
  type ElectronBrowserAccountImportInput,
  type ElectronBrowserImportReport,
  type ElectronBrowserImportSources,
  type ElectronBrowserProfileChoice,
  type ElectronBrowserImportCancelResult
} from '@molly/shared/electron-ipc'
import { parseBrowserAddress } from '@molly/shared/browser-url'
import { ACCOUNT_IMPORT_BROWSERS } from '@molly/shared/electron-ipc'
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
import {
  listImportSources,
  listImportProfiles,
  readBrowserProfileCookies
} from './browser-account-source'
import { importBrowserAccountCookies, importedCookieIdentity } from './browser-account-import'
import { isolateBrowserAccounts } from './browser-account-isolation'
import { BrowserAccountError } from './browser-account-error'
import {
  BROWSER_ACCOUNT_SITES,
  browserAccountSiteForDomain
} from '@molly/shared/browser-account-sites'

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

type AccountImportReadinessError = {
  reason: NonNullable<ElectronBrowserAccountSummary['importUnavailableReason']>
  message: string
}

const accountImportReadinessError = (): AccountImportReadinessError | null => {
  if (process.platform !== 'darwin')
    return {
      reason: 'macos-required',
      message: 'Browser account import is available only on macOS.'
    }
  if (app.isPackaged && !canPersistPublicBrowserSession())
    return {
      reason: 'signing-required',
      message: 'Browser account import requires a Molly build with a stable macOS signing identity.'
    }
  if (!safeStorage.isEncryptionAvailable())
    return {
      reason: 'secure-storage-unavailable',
      message: 'macOS secure storage is unavailable; browser account import was stopped.'
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
      committedUrl: committedUrl || undefined,
      committedTitle: record.view.webContents.getTitle() || undefined,
      canGoBack: record.view.webContents.navigationHistory.canGoBack(),
      canGoForward: record.view.webContents.navigationHistory.canGoForward()
    },
    patch
  )
}

const assertPublicUrl = (rawUrl: string): string => {
  const parsed = parseBrowserAddress(rawUrl)
  if (parsed.engine !== 'public-web') {
    throw new Error('Loopback addresses use Managed Preview from the address bar.')
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
  private accountOperation: {
    id: string
    controller: AbortController
    writing: boolean
    owner: BrowserWindow
  } | null = null
  private accountWriting = false
  private readonly accountPages = new Map<
    string,
    {
      browserId: string
      bounds: ElectronPublicBrowserBounds
      visible: boolean
      url: string
      owner: BrowserWindow
    }
  >()
  private recoveryIsolation: Awaited<ReturnType<typeof isolateBrowserAccounts>> | undefined
  private readonly humanAccountPages = new Set<string>()
  private shuttingDown = false

  constructor(
    private readonly getMainWindow: () => BrowserWindow | null,
    private readonly pauseActiveRuns: () => Promise<AgentBrowserScope[]>
  ) {}

  create(
    browserId: string,
    bounds: ElectronPublicBrowserBounds,
    visible = true
  ): ElectronPublicBrowserResult {
    try {
      if (this.accountWriting || this.shuttingDown)
        return { ok: false, error: 'Website accounts are being updated.' }
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
      const normalizedBounds = normalizeBounds(window, bounds)

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
          spellcheck: false
        }
      })
      const record: PublicBrowserRecord = {
        browserId,
        view,
        window,
        bounds: normalizedBounds,
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
      this.observeWindow(window)
      this.publish(record)
      return { ok: true, state: record.state }
    } catch (error) {
      const partialRecord = this.records.get(browserId)
      if (partialRecord) this.disposeRecord(partialRecord)
      return { ok: false, error: formatUnknownError(error) }
    }
  }

  async navigate(browserId: string, rawUrl: string): Promise<ElectronPublicBrowserResult> {
    if (this.accountWriting || this.shuttingDown)
      return { ok: false, error: 'Website accounts are being updated.' }
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
    if (this.accountWriting || this.shuttingDown)
      return { ok: false, error: 'Website accounts are being updated.' }
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
    if (this.accountWriting || this.shuttingDown)
      return { ok: false, error: 'Website accounts are being updated.' }
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
    if (this.accountWriting || this.shuttingDown)
      return { ok: false, error: 'Website accounts are being updated.' }
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
    if (this.accountWriting || this.shuttingDown)
      return { ok: false, error: 'Website accounts are being updated.' }
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
    if (this.accountWriting || this.shuttingDown)
      return { ok: false, error: 'Website accounts are being updated.' }
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
    if (this.accountWriting || this.shuttingDown)
      return { ok: false, error: 'Website accounts are being updated.' }
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
    this.accountPages.delete(browserId)
    const record = this.records.get(browserId)
    if (!record) {
      return { ok: false, error: 'Public browser surface has not been created.' }
    }
    if (this.humanAccountPages.has(browserId))
      record.view.webContents.once('destroyed', () => this.humanAccountPages.delete(browserId))
    const scope = this.takeAgentControl(browserId) ?? this.humanTakeovers.get(browserId)
    if (scope) this.closedAgentPages.set(browserId, scope.runId)
    this.disposeRecord(record)
    return { ok: true, state: record.state }
  }

  destroyAll(): void {
    this.revokeAllAgentCommands()
    this.humanTakeovers.clear()
    this.humanAccountPages.clear()
    for (const browserId of [...this.records.keys()]) this.destroy(browserId)
    this.closedAgentPages.clear()
  }

  getState(browserId: string): ElectronPublicBrowserState | null {
    const record = this.records.get(browserId)
    if (record) return toState(record)
    return this.humanTakeovers.has(browserId)
      ? this.pagelessState(browserId, 'human-takeover')
      : null
  }

  private pagelessState(
    browserId: string,
    agentControl: ElectronPublicBrowserState['agentControl']
  ): ElectronPublicBrowserState {
    return { browserId, phase: 'idle', canGoBack: false, canGoForward: false, agentControl }
  }

  private publishPageless(state: ElectronPublicBrowserState): void {
    const window = this.getMainWindow()
    if (window && !window.isDestroyed())
      window.webContents.send(ELECTRON_PUBLIC_BROWSER_STATE_CHANNEL, state)
  }

  async executeAgentCommand(
    scope: AgentBrowserScope,
    command: AgentBrowserCommand
  ): Promise<AgentBrowserHostReply> {
    // Browser identity comes from the trusted Session, never from a model-supplied target id.
    if (!/^session-browser-[a-zA-Z0-9_-]{1,128}$/.test(scope.browserId)) {
      throw new Error('Invalid session browser identity.')
    }
    if (this.accountWriting || this.shuttingDown)
      throw new Error('Website accounts are being updated.')
    if (this.humanAccountPages.size > 0)
      throw new Error('Agent browsing is paused while the user controls website accounts.')
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

  async takeHumanAccountControl(browserId: string): Promise<AgentBrowserScope | null> {
    const scope = this.takeAgentControl(browserId) ?? this.humanTakeovers.get(browserId) ?? null
    if (!scope) return null
    this.humanAccountPages.add(browserId)
    await this.pauseAgentsForAccountChange()
    return scope
  }

  takeoverScope(browserId: string): AgentBrowserScope | null {
    return this.humanTakeovers.get(browserId) ?? null
  }

  canResumeAgentControl(browserId: string, runId: string): boolean {
    return (
      !this.accountWriting && !this.shuttingDown && this.closedAgentPages.get(browserId) !== runId
    )
  }

  resumeAgentControl(browserId: string, runId: string): void {
    if (this.humanTakeovers.get(browserId)?.runId === runId) {
      this.humanAccountPages.delete(browserId)
      this.humanTakeovers.delete(browserId)
      const record = this.records.get(browserId)
      if (record) this.publish(record, { agentControl: 'human' })
      else this.publishPageless(this.pagelessState(browserId, 'human'))
    }
  }

  activeAgentScopes(): AgentBrowserScope[] {
    return this.agent.activeScopes()
  }

  takeoverScopes(): AgentBrowserScope[] {
    return [...this.humanTakeovers.values()]
  }

  /** Account changes, including a human sign-in, reach every Agent page through the shared profile. */
  async pauseAgentsForAccountChange(): Promise<void> {
    const takeLeasedPages = () => {
      for (const scope of this.agent.activeScopes()) this.takeAgentControl(scope.browserId)
    }
    takeLeasedPages()
    const paused = await this.pauseActiveRuns()
    takeLeasedPages()
    for (const scope of paused) {
      if (this.humanTakeovers.get(scope.browserId)?.runId === scope.runId) continue
      this.humanTakeovers.set(scope.browserId, scope)
      const record = this.records.get(scope.browserId)
      if (record) this.publish(record, { agentControl: 'human-takeover' })
      else this.publishPageless(this.pagelessState(scope.browserId, 'human-takeover'))
    }
  }

  revokeAllAgentCommands(): void {
    for (const record of this.records.values()) this.revokeAgentCommand(record.browserId)
  }

  async getImportSources(): Promise<ElectronBrowserImportSources> {
    if (accountImportReadinessError()) throw new BrowserAccountError('unavailable')
    return listImportSources(ACCOUNT_IMPORT_BROWSERS)
  }

  async getImportProfiles(
    browserId: AccountImportBrowserId
  ): Promise<ElectronBrowserProfileChoice[]> {
    return this.withAccountOperation(`profiles:${browserId}`, async (operation) => {
      const profiles = await this.readImportProfiles(browserId, operation)
      this.assertAccountOwner(operation)
      return profiles
    })
  }

  private async readImportProfiles(
    browserId: AccountImportBrowserId,
    operation: NonNullable<PublicBrowserService['accountOperation']>
  ): Promise<ElectronBrowserProfileChoice[]> {
    if (!(await this.getImportSources()).sources.some((source) => source.browserId === browserId))
      throw new BrowserAccountError('source-unavailable')
    this.assertAccountOwner(operation)
    return listImportProfiles(browserId, operation.controller.signal)
  }

  async getAccountSummary(): Promise<ElectronBrowserAccountSummary> {
    const reason = accountImportReadinessError()
    const cookies = await session.fromPartition(publicBrowserPartition()).cookies.get({})
    return {
      persistent: canPersistPublicBrowserSession(),
      importAvailable: reason === null,
      ...(reason ? { importUnavailableReason: reason.reason } : {}),
      recoveryRequired: Boolean(this.recoveryIsolation),
      cookieCount: cookies.length,
      sites: BROWSER_ACCOUNT_SITES.map((site) => ({
        siteId: site.id,
        cookieCount: cookies.filter(
          (cookie) => browserAccountSiteForDomain(cookie.domain ?? '')?.id === site.id
        ).length
      }))
    }
  }

  cancelAccountImport(operationId: string): ElectronBrowserImportCancelResult {
    const operation = this.accountOperation
    if (!operation || operation.id !== operationId) return 'idle'
    if (operation.writing) return 'finishing'
    operation.controller.abort()
    return 'cancelled'
  }

  private async withAccountOperation<T>(
    id: string,
    work: (operation: NonNullable<PublicBrowserService['accountOperation']>) => Promise<T>
  ): Promise<T> {
    if (this.accountOperation || this.shuttingDown || (this.accountWriting && id !== 'clear'))
      throw new BrowserAccountError('busy')
    const owner = this.getMainWindow()
    if (!owner || owner.isDestroyed()) throw new BrowserAccountError('cancelled')
    this.observeWindow(owner)
    const operation = { id, owner, controller: new AbortController(), writing: false }
    this.accountOperation = operation
    let release: () => void = () => undefined
    this.accountMutation = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      return await work(operation)
    } finally {
      this.accountOperation = null
      release()
    }
  }

  private assertAccountOwner(
    operation: NonNullable<PublicBrowserService['accountOperation']>
  ): void {
    if (
      operation.controller.signal.aborted ||
      operation.owner.isDestroyed() ||
      this.getMainWindow() !== operation.owner ||
      this.shuttingDown
    )
      throw new BrowserAccountError('cancelled')
  }

  private async changeAccounts<T>(
    operation: NonNullable<PublicBrowserService['accountOperation']>,
    work: (isolation: Awaited<ReturnType<typeof isolateBrowserAccounts>>) => Promise<T>
  ): Promise<T> {
    this.assertAccountOwner(operation)
    operation.writing = true
    this.accountWriting = true
    let isolation: Awaited<ReturnType<typeof isolateBrowserAccounts>> | undefined
    try {
      await this.pauseAgentsForAccountChange()
      this.assertAccountOwner(operation)
      const closing: Promise<void>[] = []
      for (const record of [...this.records.values()]) {
        const contents = record.view.webContents
        this.accountPages.set(record.browserId, {
          browserId: record.browserId,
          bounds: record.bounds,
          visible: record.visible,
          url: contents.getURL(),
          owner: record.window
        })
        if (!contents.isDestroyed())
          closing.push(new Promise<void>((resolve) => contents.once('destroyed', resolve)))
        this.disposeRecord(record)
      }
      await Promise.all(closing)
      const browserSession = session.fromPartition(publicBrowserPartition())
      this.configureBrowserSession(browserSession)
      await browserSession.closeAllConnections()
      isolation = this.recoveryIsolation ?? (await isolateBrowserAccounts(browserSession))
      this.assertAccountOwner(operation)
      const result = await work(isolation)
      this.recoveryIsolation = undefined
      return result
    } catch (error) {
      if (
        isolation &&
        (operation.id === 'clear' ||
          (error instanceof BrowserAccountError && error.code === 'restore-incomplete'))
      )
        this.recoveryIsolation = isolation
      throw error
    } finally {
      if (isolation && this.recoveryIsolation !== isolation) await isolation.release()
      this.accountWriting = Boolean(this.recoveryIsolation)
      if (!this.accountWriting && !this.shuttingDown && !operation.controller.signal.aborted) {
        for (const page of this.accountPages.values()) {
          if (page.owner.isDestroyed() || page.owner !== this.getMainWindow()) continue
          const result = this.create(page.browserId, page.bounds, page.visible)
          if (result.ok && page.url && page.url !== 'about:blank')
            void this.navigate(page.browserId, page.url)
        }
      }
      if (!this.recoveryIsolation) this.accountPages.clear()
    }
  }

  async importBrowserAccount(
    input: ElectronBrowserAccountImportInput
  ): Promise<ElectronBrowserImportReport | { profiles: ElectronBrowserProfileChoice[] }> {
    if (accountImportReadinessError()) throw new BrowserAccountError('unavailable')
    return this.withAccountOperation(input.operationId, async (operation) => {
      const profiles = await this.readImportProfiles(input.browserId, operation)
      this.assertAccountOwner(operation)
      if (profiles.length === 0) throw new BrowserAccountError('source-unavailable')
      if (!input.profileId && profiles.length > 1) return { profiles }
      const profileId = input.profileId ?? profiles[0]!.id
      if (!profiles.some((profile) => profile.id === profileId)) return { profiles }
      const source = await readBrowserProfileCookies(
        input.browserId,
        profileId,
        input.siteIds,
        operation.controller.signal
      )
      this.assertAccountOwner(operation)
      if (source.cookies.length === 0) return source.report
      return this.changeAccounts(operation, async ({ store }) => {
        const retained = await importBrowserAccountCookies(store, source.cookies)
        for (const cookie of source.cookies) {
          if (retained.has(importedCookieIdentity(cookie))) continue
          const siteId = browserAccountSiteForDomain(cookie.domain)!.id
          const row = source.report.sites.find((site) => site.siteId === siteId)!
          row.imported--
          row.skippedExpired++
          source.report.imported--
          source.report.skippedExpired++
        }
        return source.report
      })
    })
  }

  async clearAccountData(): Promise<number> {
    return this.withAccountOperation('clear', async (operation) =>
      this.changeAccounts(operation, async () => {
        const browserSession = session.fromPartition(publicBrowserPartition())
        const removed = (await browserSession.cookies.get({})).length
        await browserSession.clearStorageData()
        await browserSession.clearCache()
        await browserSession.clearAuthCache()
        await browserSession.cookies.flushStore()
        if ((await browserSession.cookies.get({})).length !== 0)
          throw new BrowserAccountError('restore-incomplete')
        return removed
      })
    )
  }

  async shutdownForQuit(): Promise<void> {
    this.shuttingDown = true
    if (this.accountOperation?.writing) await this.accountMutation
    else this.accountOperation?.controller.abort()
  }

  private configureSession(record: PublicBrowserRecord): void {
    this.configureBrowserSession(record.view.webContents.session)
  }

  private configureBrowserSession(browserSession: Electron.Session): void {
    if (this.configuredSessions.has(browserSession)) return
    this.configuredSessions.add(browserSession)
    browserSession.webRequest.onBeforeRequest((_details, callback) =>
      callback({ cancel: this.accountWriting || this.shuttingDown })
    )
    browserSession.webRequest.onHeadersReceived((_details, callback) =>
      callback({ cancel: this.accountWriting || this.shuttingDown })
    )
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
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
      if (this.agent.hasLease(contents)) return
      try {
        if (parseBrowserAddress(details.url).engine === 'public-web') return
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
      if (record.state.phase === 'loading' && contents.getURL()) {
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
      this.publish(record, { url })
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

  private observeWindow(window: BrowserWindow): void {
    if (this.observedWindows.has(window)) return
    this.observedWindows.add(window)
    window.once('closed', () => {
      if (this.accountOperation?.owner === window) this.accountOperation.controller.abort()
      this.destroyWindowRecords(window)
    })
    window.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument && this.accountOperation?.owner === window)
        this.accountOperation.controller.abort()
    })
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
