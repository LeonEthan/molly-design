// Public surface consumed by Molly from the generated, pinned VS Code adapter.
import type { Debugger, WebContents } from 'electron'
export interface Disposable {
  dispose(): void
}
export type Event<T> = (listener: (event: T) => void) => Disposable
export type TargetInfo = {
  targetId: string
  type: string
  title: string
  url: string
  attached: boolean
  canAccessOpener: boolean
  browserContextId?: string
}
export type Request = { id: number; method: string; params?: unknown; sessionId?: string }
export type Message = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
  sessionId?: string
}
export interface Connection extends Disposable {
  sessionId: string
  targetId: string
  parentSessionId?: string
  onEvent: Event<Message>
  onClose: Event<void>
  sendCommand(method: string, params?: unknown): Promise<unknown>
}
export type View = {
  id: string
  session: { id: string }
  debugger: BrowserViewDebugger
  webContents: Pick<WebContents, 'isDestroyed' | 'emit'> & {
    debugger: Debugger
    getOrCreateDevToolsTargetId(): string
  }
}
export declare class BrowserViewDebugger implements Disposable {
  constructor(view: Pick<View, 'webContents'>)
  onTargetDiscovered: Event<TargetInfo>
  onTargetDestroyed: Event<string>
  onTargetInfoChanged: Event<TargetInfo>
  onSessionCreated: Event<{ session: Connection; waitingForDebugger: boolean }>
  getTargetInfo(): Promise<TargetInfo>
  sendCommand(method: string, params?: unknown, sessionId?: string): Promise<unknown>
  sendCommandRaw(method: string, params?: unknown, sessionId?: string): Promise<unknown>
  registerCommandInterceptor(
    interceptor: (
      method: string,
      params: unknown,
      session: Connection | undefined
    ) => Promise<unknown> | undefined
  ): Disposable
  dispose(): void
}
export declare class BrowserViewCDPTarget implements Disposable {
  constructor(view: View, targetInfo: TargetInfo)
  targetInfo: TargetInfo
  dispose(): void
}
export declare class CDPBrowserProxy implements Disposable {
  constructor(browser: {
    targetInfo: TargetInfo
    getVersion(): object
    getBrowserContexts(): string[]
    getWindowForTarget(target: BrowserViewCDPTarget): {
      windowId: number
      bounds: { left: number; top: number; width: number; height: number; windowState: string }
    }
    createBrowserContext(): Promise<string>
    disposeBrowserContext(id: string): Promise<void>
    createTarget(url: string, contextId?: string): Promise<BrowserViewCDPTarget>
    activateTarget(target: BrowserViewCDPTarget): Promise<void>
    closeTarget(target: BrowserViewCDPTarget): Promise<boolean>
  })
  onMessage: Event<Message>
  registerTarget(target: BrowserViewCDPTarget): void
  notifySessionCreated(session: Connection, waitingForDebugger: boolean): void
  sendMessage(message: Request): Promise<void>
  sendCommand(method: string, params?: unknown, sessionId?: string): Promise<unknown>
  dispose(): void
}
