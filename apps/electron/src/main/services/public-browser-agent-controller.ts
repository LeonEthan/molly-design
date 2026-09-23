import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { app, type Session, type WebContents } from 'electron'
import { classifyBrowserHostname, parseBrowserAddress } from '@molly/shared/browser-url'
import type {
  AgentBrowserCommand,
  AgentBrowserHostReply,
  AgentBrowserScope
} from '@molly/shared/browser-agent-rpc'
import { fetchSelectedBrowserImage } from './public-browser-asset-fetch'
import { BrowserMcpDriver, browserMcpSnapshot } from './browser-mcp-driver'
import { isStableSignedMacApp } from './browser-account-signing'
import {
  agentBrowserDocumentKey,
  assertAgentBrowserDestination,
  hostMatchesSite,
  isVerifiedAgentBrowserResponsePeer,
  type AgentBrowserNetworkChecks
} from './public-browser-agent-policy'

type Lease = {
  scope: AgentBrowserScope
  contents: WebContents
  driver?: BrowserMcpDriver
  dispatchingInput: boolean
  blockHumanInput: (event: Electron.Event) => void
  verifiedDocuments: Set<string>
  networkError: string | null
  ready: boolean
  disposed: boolean
  abortController: AbortController
  waiters: Set<() => void>
  onDidStartNavigation: (
    _event: Electron.Event,
    url: string,
    isInPlace: boolean,
    isMainFrame: boolean
  ) => void
  onDidStopLoading: () => void
  onDomReady: () => void
  onDestroyed: () => void
}

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024
const AGENT_BROWSER_PARTITION = 'persist:molly-public-browser-v1'
const DEV_BROWSER_PARTITION = 'molly-public-browser-v1'

export const canPersistPublicBrowserSession = (): boolean =>
  app.isPackaged && (process.platform !== 'darwin' || isStableSignedMacApp(app.getPath('exe')))

export const publicBrowserPartition = (): string =>
  canPersistPublicBrowserSession() ? AGENT_BROWSER_PARTITION : DEV_BROWSER_PARTITION

const networkChecks = (browserSession: Session): AgentBrowserNetworkChecks => ({
  classifyHost: classifyBrowserHostname,
  resolveAddresses: async (host) => {
    if (isIP(host.replace(/^\[|\]$/g, ''))) return [host]
    return (await lookup(host, { all: true })).map((entry) => entry.address)
  },
  resolveProxy: async (url) => await browserSession.resolveProxy(url)
})

const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url)
/**
 * Main-process owner of agent access to existing WebContentsViews. Playwright MCP owns page operations;
 * Molly verifies network peers and authorization; no target/transport is ever given to the Agent.
 */
export class PublicBrowserAgentController {
  private readonly leases = new Map<number, Lease>()
  private readonly protectedSessions = new WeakSet<Session>()

  hasLease(contents: WebContents): boolean {
    return this.leases.has(contents.id)
  }

  activeScopes(): AgentBrowserScope[] {
    return [...this.leases.values()].filter((lease) => !lease.disposed).map((lease) => lease.scope)
  }

  permitsTopLevelNavigation(contents: WebContents, rawUrl: string): boolean {
    const lease = this.leases.get(contents.id)
    if (!lease) return true
    try {
      const url = new URL(rawUrl)
      return (
        isWebUrl(url.toString()) &&
        lease.scope.sites.some((site) => hostMatchesSite(url.hostname, site))
      )
    } catch {
      return false
    }
  }

  revoke(contents: WebContents): void {
    const lease = this.leases.get(contents.id)
    if (!lease) return
    lease.disposed = true
    lease.abortController.abort()
    for (const wake of lease.waiters) wake()
    lease.waiters.clear()
    lease.verifiedDocuments.clear()
    this.leases.delete(contents.id)
    void lease.driver?.dispose()
    if (!contents.isDestroyed()) {
      contents.off('did-start-navigation', lease.onDidStartNavigation)
      contents.off('did-stop-loading', lease.onDidStopLoading)
      contents.off('dom-ready', lease.onDomReady)
      contents.off('destroyed', lease.onDestroyed)
      contents.off('before-mouse-event', lease.blockHumanInput)
      contents.off('before-input-event', lease.blockHumanInput)
    }
  }

  revokeAll(): void {
    for (const lease of [...this.leases.values()]) this.revoke(lease.contents)
  }

  private installNetworkGuard(browserSession: Session): void {
    if (this.protectedSessions.has(browserSession)) return
    this.protectedSessions.add(browserSession)
    browserSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const lease = this.leases.get(details.webContentsId ?? -1)
      if (details.webContentsId === undefined && this.leases.size > 0)
        return callback({ cancel: true })
      if (!lease || lease.disposed) return callback({ cancel: false })
      const mainFrame = details.resourceType === 'mainFrame'
      const frame = mainFrame || details.resourceType === 'subFrame'
      void assertAgentBrowserDestination(
        { url: details.url, ...(frame ? { topLevelSites: lease.scope.sites } : {}) },
        networkChecks(browserSession)
      ).then(
        () => callback({ cancel: lease.disposed }),
        (error: unknown) => {
          // A denied subrequest never reaches the page. Keep the main document
          // readable; only a failed main-frame navigation invalidates it.
          if (mainFrame) {
            lease.networkError =
              error instanceof Error ? error.message : 'Browser request was blocked.'
          }
          callback({ cancel: true })
        }
      )
    })
  }

  private observeNetwork(lease: Lease, method: string, rawParams: unknown): void {
    if (lease.disposed || !rawParams || typeof rawParams !== 'object') return
    const params = rawParams as Record<string, unknown>
    const requestId = typeof params.requestId === 'string' ? params.requestId : undefined
    if (!requestId) return
    const verifyResponse = (response: unknown): boolean => {
      const value = response as
        | {
            url?: string
            remoteIPAddress?: string
            fromDiskCache?: boolean
            fromServiceWorker?: boolean
          }
        | undefined
      if (!value?.url || !isWebUrl(value.url)) return false
      if (!isVerifiedAgentBrowserResponsePeer(value, classifyBrowserHostname)) {
        lease.networkError = 'The browser could not verify a public response peer.'
        lease.contents.stop()
        return false
      }
      return true
    }
    if (method === 'Network.requestWillBeSent') {
      if (params.redirectResponse) verifyResponse(params.redirectResponse)
    } else if (method === 'Network.responseReceived') {
      const verified = verifyResponse(params.response)
      if (verified && params.type === 'Document') {
        const response = params.response as { url: string }
        lease.verifiedDocuments.add(agentBrowserDocumentKey(response.url))
      }
    }
  }

  private async createLease(contents: WebContents, scope: AgentBrowserScope): Promise<Lease> {
    if (scope.sites.length === 0 || scope.sites.length > 8) {
      throw new Error('An agent browser task needs one to eight approved sites.')
    }
    for (const site of scope.sites) {
      if (!/^[a-z0-9.-]{1,253}$/i.test(site) || classifyBrowserHostname(site) !== 'public') {
        throw new Error('Agent browser site scope is invalid.')
      }
    }
    this.installNetworkGuard(contents.session)
    // Electron's debugger commands can stall before the first committed document.
    if (!contents.getURL()) await contents.loadURL('data:text/html,<title>Molly browser</title>')
    if (contents.debugger.isAttached()) throw new Error('Browser debugger is already in use.')
    const lease: Lease = {
      scope,
      contents,
      verifiedDocuments: new Set(),
      dispatchingInput: false,
      blockHumanInput: (event) => {
        if (!lease.dispatchingInput) event.preventDefault()
      },
      networkError: null,
      ready: false,
      disposed: false,
      abortController: new AbortController(),
      waiters: new Set(),
      onDidStartNavigation: (_event, _url, isInPlace, isMainFrame) => {
        if (!isMainFrame || isInPlace || lease.disposed) return
        lease.ready = false
        lease.verifiedDocuments.clear()
      },
      onDomReady: () => {
        if (lease.disposed || lease.networkError) return
        const url = contents.getURL()
        if (isWebUrl(url) && lease.verifiedDocuments.has(agentBrowserDocumentKey(url))) {
          lease.ready = true
        }
      },
      onDidStopLoading: () => {
        if (lease.disposed || lease.networkError) return
        const url = contents.getURL()
        if (isWebUrl(url) && lease.verifiedDocuments.has(agentBrowserDocumentKey(url))) {
          lease.ready = true
        }
      },
      onDestroyed: () => this.revoke(contents)
    }
    this.leases.set(contents.id, lease)
    try {
      contents.once('destroyed', lease.onDestroyed)
      contents.on('before-mouse-event', lease.blockHumanInput)
      contents.on('before-input-event', lease.blockHumanInput)
      contents.on('did-start-navigation', lease.onDidStartNavigation)
      contents.on('did-stop-loading', lease.onDidStopLoading)
      contents.on('dom-ready', lease.onDomReady)
      lease.driver = new BrowserMcpDriver(contents, {
        assertActive: () => this.assertSameLease(lease),
        dispatchInput: (send) => {
          this.assertSameLease(lease)
          // Electron emits its before-input hooks synchronously during CDP dispatch.
          // Never leave the human-input gate open while Playwright awaits a page.
          lease.dispatchingInput = true
          try {
            return send()
          } finally {
            lease.dispatchingInput = false
          }
        },
        beforeNavigate: async (url) => {
          await assertAgentBrowserDestination(
            { url, topLevelSites: lease.scope.sites },
            networkChecks(contents.session)
          )
          this.assertSameLease(lease)
        },
        observeNetwork: (method, params) => this.observeNetwork(lease, method, params),
        detached: () => this.revoke(contents)
      })
      await lease.driver.connect()
      this.assertSameLease(lease)
      return lease
    } catch (error) {
      this.revoke(contents)
      throw error
    }
  }

  private assertReadable(lease: Lease): void {
    if (lease.disposed || lease.contents.isDestroyed())
      throw new Error('Agent browser page closed.')
    if (lease.networkError) throw new Error(`Agent browser network blocked: ${lease.networkError}`)
    if (!lease.ready)
      throw new Error('Agent browser page must be navigated under the network guard.')
    let current: URL
    try {
      current = new URL(lease.contents.getURL())
    } catch {
      throw new Error('Agent browser page URL cannot be verified.')
    }
    if (!lease.scope.sites.some((site) => hostMatchesSite(current.hostname, site))) {
      throw new Error('Agent browser page is outside the current approved site.')
    }
    if (!lease.verifiedDocuments.has(agentBrowserDocumentKey(current.toString()))) {
      throw new Error('Agent browser could not verify the current document response.')
    }
  }

  private async waitForVerifiedDocument(lease: Lease): Promise<void> {
    this.assertSameLease(lease)
    if (lease.networkError || lease.ready) {
      this.assertReadable(lease)
      return
    }
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error): void => {
        clearTimeout(timer)
        lease.contents.off('did-stop-loading', check)
        lease.contents.off('dom-ready', check)
        lease.contents.debugger.off('message', onMessage)
        lease.waiters.delete(check)
        if (error) reject(error)
        else resolve()
      }
      const check = (): void => {
        if (lease.disposed || lease.contents.isDestroyed()) {
          finish(new Error('Agent browser control was revoked.'))
        } else if (lease.networkError || lease.ready) {
          try {
            this.assertReadable(lease)
            finish()
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)))
          }
        }
      }
      const onMessage = (): void => check()
      const timer = setTimeout(
        () => finish(new Error('Agent browser could not verify the current document response.')),
        5_000
      )
      lease.contents.on('did-stop-loading', check)
      lease.contents.on('dom-ready', check)
      lease.contents.debugger.on('message', onMessage)
      lease.waiters.add(check)
      check()
    })
  }

  private assertSameLease(lease: Lease): void {
    if (lease.disposed || this.leases.get(lease.contents.id) !== lease) {
      throw new Error('Agent browser control was revoked before the result was returned.')
    }
  }

  async execute(
    contents: WebContents,
    scope: AgentBrowserScope,
    command: AgentBrowserCommand
  ): Promise<AgentBrowserHostReply> {
    let lease = this.leases.get(contents.id)
    if (lease && (lease.scope.runId !== scope.runId || lease.scope.browserId !== scope.browserId)) {
      // The daemon dispatches only its currently active run. A new run takes
      // over the same Session page by first invalidating every old reference.
      this.revoke(contents)
      lease = undefined
    }
    if (!lease) lease = await this.createLease(contents, scope)
    // Only the daemon's active-run work may extend the site set, after a newly
    // approved navigate call. The page and the Agent cannot mutate this scope.
    lease.scope = scope
    if (command.kind === 'navigate') {
      const parsed = parseBrowserAddress(command.url)
      if (parsed.engine !== 'public-web') throw new Error('Agent browser requires a public page.')
      const url = await assertAgentBrowserDestination(
        { url: parsed.logicalUrl, topLevelSites: lease.scope.sites },
        networkChecks(contents.session)
      )
      this.assertSameLease(lease)
      lease.networkError = null
      lease.verifiedDocuments.clear()
      lease.ready = false
      command = { kind: 'navigate', url }
    } else {
      await this.waitForVerifiedDocument(lease)
    }
    if (!lease.driver) throw new Error('Molly browser driver is unavailable.')
    const response = await lease.driver.execute(command)
    this.assertSameLease(lease)
    await this.waitForVerifiedDocument(lease)
    if (command.kind === 'save_image') {
      if (response.kind !== 'image')
        throw new Error('Selected browser reference is not a loaded image.')
      // The currently granted main document remains the provenance authority.
      // Child-frame URLs cannot silently replace it or select another account.
      const result = response.image
      const pageUrl = contents.getURL()
      if (agentBrowserDocumentKey(result.pageUrl) !== agentBrowserDocumentKey(pageUrl))
        throw new Error('Selected image is outside the current main document.')
      const asset = await fetchSelectedBrowserImage({
        browserSession: contents.session,
        imageUrl: result.imageUrl,
        pageUrl,
        sites: lease.scope.sites,
        signal: lease.abortController.signal
      })
      this.assertSameLease(lease)
      this.assertReadable(lease)
      return {
        kind: 'asset',
        base64: Buffer.from(asset.bytes).toString('base64'),
        pageUrl,
        imageUrl: asset.finalUrl
      }
    }
    if (response.kind !== 'tool') throw new Error('Browser driver returned an unexpected result.')
    const result = response.result
    if (command.kind === 'snapshot') {
      return { kind: 'text', text: `Page: ${contents.getURL()}\n${browserMcpSnapshot(result)}` }
    }
    if (command.kind === 'screenshot') {
      const capture = result.content.find((part) => part.type === 'image')
      if (
        !capture ||
        capture.type !== 'image' ||
        capture.mimeType !== 'image/jpeg' ||
        capture.data.length > 2_800_000
      )
        throw new Error('Browser screenshot is empty or exceeds the size limit.')
      const bytes = Buffer.from(capture.data, 'base64')
      if (
        bytes.length === 0 ||
        bytes.length > MAX_SCREENSHOT_BYTES ||
        bytes.subarray(0, 3).toString('hex') !== 'ffd8ff'
      )
        throw new Error('Browser screenshot is empty or exceeds the size limit.')
      return {
        kind: 'image',
        mimeType: 'image/jpeg',
        base64: capture.data,
        pageUrl: contents.getURL()
      }
    }
    return {
      kind: 'text',
      text: `${command.kind} completed on ${contents.getURL()}. Take a snapshot to observe the result.`
    }
  }
}
