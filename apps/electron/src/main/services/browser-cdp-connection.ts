import type { WebContents } from 'electron'
import { chromium, type Browser, type Page, type ConnectOverCDPTransport } from 'playwright'
import {
  CDPBrowserProxy,
  BrowserViewDebugger,
  BrowserViewCDPTarget,
  type TargetInfo,
  type Request,
  type View,
  type Disposable
} from './browser-cdp-upstream.js'

export type BrowserCdpGuards = {
  assertActive(): void
  beforeNavigate(url: string): Promise<void>
  observeNetwork(method: string, params: unknown): void
  detached(): void
  dispatchInput(send: () => Promise<unknown>): Promise<unknown>
}

/** Main-only transport to one granted WebContents and its descendants. No listener. */
export class BrowserCdpConnection {
  private readonly targets = new Set<BrowserViewCDPTarget>()
  private readonly subscriptions: Disposable[] = []
  private browser: Browser | undefined
  private debugger: BrowserViewDebugger | undefined
  private proxy: CDPBrowserProxy | undefined
  private closed = false
  private readonly onMessage = (_event: Electron.Event, method: string, params: unknown): void => {
    this.guards.observeNetwork(method, params)
  }
  private readonly onDetach = (): void => {
    if (!this.closed) this.guards.detached()
  }

  constructor(
    private readonly contents: WebContents,
    private readonly guards: BrowserCdpGuards
  ) {}

  async connect(): Promise<{ browser: Browser; page: Page }> {
    this.guards.assertActive()
    if (this.contents.debugger.isAttached()) throw new Error('Browser debugger is already in use.')
    this.contents.debugger.attach('1.3')
    let targetInfo: TargetInfo
    let version: object
    try {
      targetInfo = (await this.contents.debugger.sendCommand('Target.getTargetInfo')).targetInfo
      version = await this.contents.debugger.sendCommand('Browser.getVersion')
    } finally {
      if (this.contents.debugger.isAttached()) this.contents.debugger.detach()
    }
    this.guards.assertActive()
    const webContents: View['webContents'] = {
      debugger: this.contents.debugger,
      isDestroyed: () => this.contents.isDestroyed(),
      emit: this.contents.emit.bind(this.contents),
      getOrCreateDevToolsTargetId: () => targetInfo.targetId
    }
    const debuggerTransport = new BrowserViewDebugger({ webContents })
    this.debugger = debuggerTransport
    const view: View = {
      id: String(this.contents.id),
      session: { id: `molly-page-${this.contents.id}` },
      webContents,
      debugger: debuggerTransport
    }
    const denied = async (): Promise<never> => {
      throw new Error('Only the granted Molly page is available.')
    }
    const proxy = new CDPBrowserProxy({
      targetInfo: {
        targetId: `molly-browser-${this.contents.id}`,
        type: 'browser',
        title: '',
        url: '',
        attached: true,
        canAccessOpener: false
      },
      getVersion: () => version,
      getBrowserContexts: () => [],
      getWindowForTarget: () => ({
        windowId: this.contents.id,
        bounds: { left: 0, top: 0, width: 1000, height: 760, windowState: 'normal' }
      }),
      createTarget: denied,
      closeTarget: denied,
      createBrowserContext: denied,
      disposeBrowserContext: denied,
      activateTarget: async () => undefined
    })
    this.proxy = proxy
    const register = (info: TargetInfo): void => {
      if (this.closed) return
      const target = new BrowserViewCDPTarget(view, info)
      this.targets.add(target)
      if (targetInfo.targetId !== info.targetId)
        this.subscriptions.push(
          debuggerTransport.onTargetDestroyed((id) => {
            if (id === info.targetId) this.targets.delete(target)
          })
        )
      proxy.registerTarget(target)
    }
    this.subscriptions.push(
      debuggerTransport.onTargetDiscovered((info) => {
        if (['iframe', 'worker'].includes(info.type)) register(info)
      }),
      debuggerTransport.onSessionCreated(({ session, waitingForDebugger }) =>
        proxy.notifySessionCreated(session, waitingForDebugger)
      ),
      debuggerTransport.registerCommandInterceptor((method, params, session) => {
        this.guards.assertActive()
        if (method === 'Page.navigate') {
          const url = (params as { url?: unknown } | undefined)?.url
          if (typeof url !== 'string')
            return Promise.reject(new Error('Browser navigation needs a URL.'))
          return this.guards.beforeNavigate(url).then(() => {
            this.guards.assertActive()
            return debuggerTransport.sendCommandRaw(method, params, session?.sessionId)
          })
        }
        if (method.startsWith('Input.'))
          return this.guards.dispatchInput(() =>
            debuggerTransport.sendCommandRaw(method, params, session?.sessionId)
          )
        // Playwright cannot re-enable caches or SW responses behind the peer guard.
        if (method === 'Network.setCacheDisabled')
          return debuggerTransport.sendCommandRaw(
            method,
            { cacheDisabled: true },
            session?.sessionId
          )
        if (method === 'Network.setBypassServiceWorker')
          return debuggerTransport.sendCommandRaw(method, { bypass: true }, session?.sessionId)
        return undefined
      })
    )
    register(targetInfo)
    this.contents.debugger.on('message', this.onMessage)
    this.contents.debugger.on('detach', this.onDetach)
    await debuggerTransport.sendCommand('Network.enable')
    await debuggerTransport.sendCommand('Network.setCacheDisabled', { cacheDisabled: true })
    await debuggerTransport.sendCommand('Network.setBypassServiceWorker', { bypass: true })
    const transport: ConnectOverCDPTransport = {
      send: (message) => {
        this.guards.assertActive()
        const request = message as Partial<Request>
        if (typeof request.id !== 'number' || typeof request.method !== 'string')
          throw new Error('Unexpected browser transport message.')
        void proxy.sendMessage(request as Request)
      },
      close() {
        this.onclose?.()
      }
    }
    this.subscriptions.push(proxy.onMessage((message) => transport.onmessage?.(message)))
    this.browser = await chromium.connectOverCDP(transport, { timeout: 10_000 })
    this.guards.assertActive()
    const page = this.browser.contexts()[0]?.pages()[0]
    if (!page) throw new Error('Molly browser page is unavailable.')
    return { browser: this.browser, page }
  }

  /** Synchronous detachment prevents old operations from issuing more commands. */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.contents.debugger.off('message', this.onMessage)
    this.contents.debugger.off('detach', this.onDetach)
    for (const target of this.targets) target.dispose()
    this.targets.clear()
    this.debugger?.dispose()
    this.proxy?.dispose()
    for (const subscription of this.subscriptions) subscription.dispose()
    this.subscriptions.length = 0
    void this.browser?.close().catch(() => undefined)
  }
}
