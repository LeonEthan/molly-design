import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { createConnection } from '@playwright/mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AgentBrowserCommand } from '@molly/shared/browser-agent-rpc'
import { z } from 'zod'
import { BrowserCdpConnection, type BrowserCdpGuards } from './browser-cdp-connection'

// This server stays in main. Its catalog is never forwarded to the Agent.
// Molly's strict action union is the public whitelist; this is the host's list/call whitelist.
const ALLOWED_TOOLS = new Set([
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_take_screenshot',
  'browser_evaluate'
])
const ImageMetadataSchema = z.object({
  tag: z.literal('IMG'),
  imageUrl: z.string().url().max(2048),
  pageUrl: z.string().url().max(2048),
  loaded: z.literal(true)
})
export type BrowserImageMetadata = z.infer<typeof ImageMetadataSchema>
export type BrowserDriverResult =
  | { kind: 'tool'; result: CallToolResult }
  | { kind: 'image'; image: BrowserImageMetadata }

export function browserMcpText(result: CallToolResult): string {
  return result.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

/** Discard code, console output and host file links; expose only the requested snapshot. */
export function browserMcpSnapshot(result: CallToolResult): string {
  const text = browserMcpText(result)
  const snapshot = text.match(/### Snapshot\n```(?:yaml)?\n([\s\S]*?)\n```/)
  if (!snapshot) throw new Error('Browser snapshot was unavailable; take a new snapshot.')
  const body = snapshot[1]
  return body.length <= 16_000
    ? body
    : `${body.slice(0, 16_000)}\n[Snapshot truncated; scroll and observe again.]`
}

function fixedResult(result: CallToolResult): unknown {
  const text = browserMcpText(result)
  const json = text.match(/### Result\n([\s\S]*?)(?:\n###|$)/)?.[1]
  try {
    return JSON.parse(json ?? '')
  } catch {
    throw new Error('Browser element changed or is no longer actionable.')
  }
}

export class BrowserMcpDriver {
  private readonly connection: BrowserCdpConnection
  private server: Awaited<ReturnType<typeof createConnection>> | undefined
  private client: Client | undefined
  private output: string | undefined
  private connecting: Promise<void> | undefined
  private active: Promise<unknown> | undefined
  private disposed = false
  private closing: Promise<void> | undefined

  constructor(
    contents: WebContents,
    private readonly guards: BrowserCdpGuards
  ) {
    this.connection = new BrowserCdpConnection(contents, guards)
  }

  connect(): Promise<void> {
    return (this.connecting ??= this.initialize())
  }

  private async initialize(): Promise<void> {
    this.output = await mkdtemp(join(tmpdir(), 'molly-browser-mcp-'))
    this.guards.assertActive()
    const { page } = await this.connection.connect()
    this.guards.assertActive()
    this.server = await createConnection(
      {
        browser: { browserName: 'chromium' },
        webmcp: false,
        saveSession: false,
        outputDir: this.output,
        outputMaxSize: 8 * 1024 * 1024,
        imageResponses: 'allow',
        timeouts: { action: 5_000, navigation: 15_000, settle: 0, idle: 0 }
      },
      async () => {
        this.guards.assertActive()
        return page.context()
      }
    )
    this.guards.assertActive()
    this.client = new Client({ name: 'molly-browser-host', version: '1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await this.server.connect(serverTransport)
    await this.client.connect(clientTransport)
    this.guards.assertActive()
    const visible = (await this.client.listTools()).tools.filter((tool) =>
      ALLOWED_TOOLS.has(tool.name)
    )
    if (visible.length !== ALLOWED_TOOLS.size)
      throw new Error('Molly browser driver tools are unavailable.')
  }

  private async call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
    this.guards.assertActive()
    if (this.disposed || !this.client || !ALLOWED_TOOLS.has(name))
      throw new Error('Browser operation is unavailable.')
    let result: CallToolResult
    try {
      result = CallToolResultSchema.parse(
        await this.client.callTool({ name, arguments: args }, CallToolResultSchema, {
          timeout: 20_000
        })
      )
    } catch {
      this.guards.assertActive()
      throw new Error('Browser operation failed. Take a new snapshot before trying again.')
    }
    this.guards.assertActive()
    if (result.isError) {
      const text = browserMcpText(result)
      if (/Ref .*not found|snapshot.*stale/i.test(text))
        throw new Error('Browser element reference is stale.')
      if (/timeout|timed out/i.test(text))
        throw new Error('Browser page is still loading; observe again after it settles.')
      if (/closed|revoked|detached/i.test(text))
        throw new Error('Agent browser control was revoked.')
      throw new Error('Browser operation failed. Take a new snapshot before trying again.')
    }
    return result
  }

  async execute(command: AgentBrowserCommand): Promise<BrowserDriverResult> {
    if (this.active) throw new Error('Browser page is still finishing a previous operation.')
    const operation = (async () => {
      try {
        return await this.perform(command)
      } finally {
        await this.clearOutput()
      }
    })()
    this.active = operation
    try {
      const result = await operation
      return command.kind === 'save_image'
        ? { kind: 'image', image: ImageMetadataSchema.parse(result) }
        : { kind: 'tool', result: CallToolResultSchema.parse(result) }
    } finally {
      this.active = undefined
    }
  }

  private async perform(
    command: AgentBrowserCommand
  ): Promise<CallToolResult | BrowserImageMetadata> {
    switch (command.kind) {
      case 'navigate':
        return this.call('browser_navigate', { url: command.url })
      case 'snapshot':
        return this.call('browser_snapshot')
      case 'screenshot':
        return this.call('browser_take_screenshot', { type: 'jpeg', scale: 'css', fullPage: false })
      case 'click':
        return this.call('browser_click', { target: command.ref })
      case 'type': {
        const metadata = fixedResult(
          await this.call('browser_evaluate', {
            target: command.ref,
            function:
              '(element) => ({ password: element.tagName === "INPUT" && element.type === "password" })'
          })
        )
        if (
          !metadata ||
          typeof metadata !== 'object' ||
          !('password' in metadata) ||
          metadata.password !== false
        )
          throw new Error(
            'Agent browser does not type into password fields; ask the user to take over.'
          )
        return this.call('browser_type', { target: command.ref, text: command.text })
      }
      case 'scroll':
        return this.call('browser_evaluate', {
          function: `() => { window.scrollBy(0, ${command.deltaY}); }`
        })
      case 'save_image': {
        // Host-authored code only. The upstream public tool resolves its own ref.
        const metadata = fixedResult(
          await this.call('browser_evaluate', {
            target: command.ref,
            function:
              '(element) => ({ tag: element.tagName, imageUrl: element.currentSrc, pageUrl: element.ownerDocument.URL, loaded: element.complete === true && element.naturalWidth > 0 })'
          })
        )
        const parsed = ImageMetadataSchema.safeParse(metadata)
        if (!parsed.success) throw new Error('Selected browser reference is not a loaded image.')
        return parsed.data
      }
      default:
        throw new Error('Unsupported browser command.')
    }
  }

  private async clearOutput(): Promise<void> {
    if (!this.output) return
    const entries = await readdir(this.output).catch(() => [])
    await Promise.all(
      entries.map((name) => rm(join(this.output!, name), { recursive: true, force: true }))
    )
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.disposed = true
    this.connection.dispose()
    // Await file writers before removing the private directory. Nothing here is
    // returned to the renderer/Agent, even if an operation was revoked in flight.
    this.closing = Promise.allSettled([this.connecting, this.active])
      .then(async () => {
        await Promise.allSettled([this.client?.close(), this.server?.close()])
        if (this.output) await rm(this.output, { recursive: true, force: true })
      })
      .catch(() => undefined)
    return this.closing
  }
}
