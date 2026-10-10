import type { WebContents } from 'electron'
import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { z } from 'zod'
import {
  CDPBrowserProxy,
  BrowserViewDebugger,
  BrowserViewCDPTarget,
  type TargetInfo,
  type View,
  type Disposable
} from './browser-cdp-upstream.js'

export type BrowserCdpGuards = {
  assertActive(): void
  detached(): void
  contextChanged?(): void
  dispatchInput(send: () => Promise<unknown>): Promise<unknown>
}

export class BrowserCdpConnection {
  private readonly targets = new Set<BrowserViewCDPTarget>()
  private readonly subscriptions: Disposable[] = []
  private server: WebSocketServer | undefined
  private client: WebSocket | undefined
  private debugger: BrowserViewDebugger | undefined
  private proxy: CDPBrowserProxy | undefined
  private closed = false
  private readonly onDetach = (): void => {
    if (!this.closed) this.guards.detached()
  }

  constructor(
    private readonly contents: WebContents,
    private readonly guards: BrowserCdpGuards & { assertWebMcpInvoke(params: unknown): void }
  ) {}

  async connect(): Promise<string> {
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
            if (id === info.targetId) {
              this.targets.delete(target)
              this.guards.contextChanged?.()
            }
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
        if (method === 'WebMCP.invokeTool') {
          if (!session) throw new Error('Website tool context changed. List the tools again.')
          this.guards.assertWebMcpInvoke(params)
          return debuggerTransport.sendCommandRaw(method, params, session.sessionId)
        }
        if (method.startsWith('Input.'))
          return this.guards.dispatchInput(() =>
            debuggerTransport.sendCommandRaw(method, params, session?.sessionId)
          )
        return undefined
      })
    )
    register(targetInfo)
    this.contents.debugger.on('detach', this.onDetach)
    const token = randomBytes(32).toString('hex')
    let claimed = false
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      maxPayload: 4 * 1024 * 1024,
      verifyClient: ({ req }: { req: IncomingMessage }) => {
        if (this.closed || claimed || req.headers.origin || req.url !== `/${token}`) return false
        claimed = true
        return true
      }
    })
    this.server = server
    const requestSchema = z
      .object({
        id: z.number().int(),
        method: z.string().max(200),
        params: z.unknown().optional(),
        sessionId: z.string().optional()
      })
      .strict()
    server.on('connection', (client) => {
      if (this.closed) {
        client.terminate()
        return
      }
      this.client = client
      client.on('error', () => this.guards.detached())
      client.on('close', () => {
        if (!this.closed) this.guards.detached()
      })
      client.on('message', (bytes) => {
        try {
          this.guards.assertActive()
          const request = requestSchema.parse(JSON.parse(bytes.toString()))
          if (
            [
              'Browser.close',
              'Target.createTarget',
              'Target.closeTarget',
              'Target.createBrowserContext',
              'Target.disposeBrowserContext',
              'Target.attachToBrowserTarget',
              'Target.sendMessageToTarget'
            ].includes(request.method)
          ) {
            client.send(
              JSON.stringify({
                id: request.id,
                sessionId: request.sessionId,
                error: { code: -32000, message: 'Only the granted Molly page is available.' }
              })
            )
            return
          }
          void proxy.sendMessage(request)
        } catch {
          client.terminate()
        }
      })
    })
    this.subscriptions.push(
      proxy.onMessage((message) => {
        if (this.closed || this.client?.readyState !== WebSocket.OPEN) return
        try {
          this.guards.assertActive()
          if (
            [
              'WebMCP.toolsAdded',
              'WebMCP.toolsRemoved',
              'Page.frameStartedNavigating',
              'Page.frameNavigated',
              'Page.frameDetached',
              'Runtime.executionContextsCleared',
              'Target.detachedFromTarget'
            ].includes(message.method ?? '')
          )
            this.guards.contextChanged?.()
          this.client.send(JSON.stringify(message))
        } catch {
          this.client.terminate()
        }
      })
    )
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', () => reject(new Error('Private browser transport is unavailable.')))
    })
    this.guards.assertActive()
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Private browser transport is unavailable.')
    return `ws://127.0.0.1:${address.port}/${token}`
  }

  /** Synchronous detachment prevents old operations from issuing more commands. */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.client?.terminate()
    this.server?.close()
    this.contents.debugger.off('detach', this.onDetach)
    for (const target of this.targets) target.dispose()
    this.targets.clear()
    this.debugger?.dispose()
    this.proxy?.dispose()
    for (const subscription of this.subscriptions) subscription.dispose()
    this.subscriptions.length = 0
  }
}
