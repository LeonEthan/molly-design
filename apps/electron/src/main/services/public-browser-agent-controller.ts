import { app, type WebContents } from 'electron'
import type {
  AgentBrowserCommand,
  AgentBrowserHostReply,
  AgentBrowserScope
} from '@molly/shared/browser-agent-rpc'
import { fetchSelectedBrowserImage } from './public-browser-asset-fetch'
import { BrowserMcpDriver, browserMcpSnapshot } from './browser-mcp-driver'
import { isStableSignedMacApp } from './browser-account-signing'
import { agentBrowserDocumentKey, hostMatchesSite } from './public-browser-agent-policy'

type Lease = {
  scope: AgentBrowserScope
  contents: WebContents
  driver?: BrowserMcpDriver
  dispatchingInput: boolean
  blockHumanInput: (event: Electron.Event) => void
  imageCookieContext: string
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

export class PublicBrowserAgentController {
  private readonly leases = new Map<number, Lease>()

  hasLease(contents: WebContents): boolean {
    return this.leases.has(contents.id)
  }

  activeScopes(): AgentBrowserScope[] {
    return [...this.leases.values()].filter((lease) => !lease.disposed).map((lease) => lease.scope)
  }

  revoke(contents: WebContents): void {
    const lease = this.leases.get(contents.id)
    if (!lease) return
    lease.disposed = true
    lease.abortController.abort()
    for (const wake of lease.waiters) wake()
    lease.waiters.clear()
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

  private async createLease(contents: WebContents, scope: AgentBrowserScope): Promise<Lease> {
    if (contents.debugger.isAttached()) throw new Error('Browser debugger is already in use.')
    const lease: Lease = {
      scope,
      contents,
      imageCookieContext: contents.getURL()
        ? new URL(contents.getURL()).hostname.replace(/^www\./i, '')
        : '',
      dispatchingInput: false,
      blockHumanInput: (event) => {
        if (!lease.dispatchingInput) event.preventDefault()
      },
      ready: !contents.isLoadingMainFrame(),
      disposed: false,
      abortController: new AbortController(),
      waiters: new Set(),
      onDidStartNavigation: (_event, url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace && !lease.disposed) {
          lease.ready = false
          this.updateImageCookieContext(lease, url)
        }
      },
      onDomReady: () => {
        if (!lease.disposed) {
          this.updateImageCookieContext(lease, contents.getURL())
          lease.ready = true
        }
      },
      onDidStopLoading: () => {
        if (!lease.disposed) {
          this.updateImageCookieContext(lease, contents.getURL())
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
      if (!contents.getURL()) await contents.loadURL('about:blank')
      this.assertSameLease(lease)
      lease.driver = new BrowserMcpDriver(contents, {
        assertActive: () => this.assertSameLease(lease),
        dispatchInput: (send) => {
          this.assertSameLease(lease)
          lease.dispatchingInput = true
          try {
            return send()
          } finally {
            lease.dispatchingInput = false
          }
        },
        detached: () => this.revoke(contents)
      })
      await lease.driver.connect()
      this.assertSameLease(lease)
      return lease
    } catch (error) {
      if (this.leases.get(contents.id) === lease) this.revoke(contents)
      throw error
    }
  }

  private assertReadable(lease: Lease): void {
    this.assertSameLease(lease)
    if (lease.contents.isDestroyed()) throw new Error('Agent browser page closed.')
    if (!lease.ready)
      throw new Error('Browser page is still loading; observe again after it settles.')
  }

  private updateImageCookieContext(lease: Lease, rawUrl: string): void {
    const host = new URL(rawUrl).hostname
    if (!hostMatchesSite(host, lease.imageCookieContext)) {
      lease.imageCookieContext = host.replace(/^www\./i, '')
    }
  }

  private async waitForDocument(lease: Lease): Promise<void> {
    this.assertSameLease(lease)
    if (lease.ready) {
      this.assertReadable(lease)
      return
    }
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error): void => {
        clearTimeout(timer)
        lease.contents.off('did-stop-loading', check)
        lease.contents.off('dom-ready', check)
        lease.waiters.delete(check)
        if (error) reject(error)
        else resolve()
      }
      const check = (): void => {
        if (lease.disposed || lease.contents.isDestroyed()) {
          finish(new Error('Agent browser control was revoked.'))
        } else if (lease.ready) {
          try {
            this.assertReadable(lease)
            finish()
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)))
          }
        }
      }
      const timer = setTimeout(
        () => finish(new Error('Browser page is still loading; observe again after it settles.')),
        5_000
      )
      lease.contents.on('did-stop-loading', check)
      lease.contents.on('dom-ready', check)
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
      this.revoke(contents)
      lease = undefined
    }
    if (!lease) lease = await this.createLease(contents, scope)
    lease.scope = scope
    if (command.kind !== 'navigate') await this.waitForDocument(lease)
    if (!lease.driver) throw new Error('Molly browser driver is unavailable.')
    const response = await lease.driver.execute(command).catch((error: unknown) => {
      this.assertSameLease(lease)
      throw error
    })
    this.assertSameLease(lease)
    await this.waitForDocument(lease)
    this.assertReadable(lease)
    if (command.kind === 'save_image') {
      if (response.kind !== 'image')
        throw new Error('Selected browser reference is not a loaded image.')
      const result = response.image
      const pageUrl = contents.getURL()
      if (agentBrowserDocumentKey(result.pageUrl) !== agentBrowserDocumentKey(pageUrl))
        throw new Error('Selected image is outside the current main document.')
      const asset = await fetchSelectedBrowserImage({
        browserSession: contents.session,
        imageUrl: result.imageUrl,
        pageUrl,
        imageCookieContext: lease.imageCookieContext,
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
