import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { z } from 'zod'
import {
  BrowserWebMcpSummarySchema,
  AgentBrowserHostReplySchema,
  type AgentBrowserCommand,
  type AgentBrowserHostReply,
  type BrowserWebMcpSummary
} from '@molly/shared/browser-agent-rpc'
import { BrowserCdpConnection, type BrowserCdpGuards } from './browser-cdp-connection'
import { BrowserAgentRuntime } from './browser-agent-runtime'

const ToolSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(64_000),
  origin: z.string().max(2048),
  frameId: z.string().max(200),
  inputSchema: z.json(),
  annotations: z.json().optional()
})
type SiteTool = z.infer<typeof ToolSchema> & { toolId: string }
type Invocation = { nativeId: string; epoch: number; pending: boolean }
const ImageMetadataSchema = z.object({
  tag: z.literal('IMG'),
  imageUrl: z.string().url().max(2048),
  pageUrl: z.string().url().max(2048),
  loaded: z.literal(true)
})
type DriverResult =
  | AgentBrowserHostReply
  | {
      kind: 'selected_image'
      image: z.infer<typeof ImageMetadataSchema>
      webmcp?: BrowserWebMcpSummary
    }

export class BrowserAgentError extends Error {
  constructor(
    message: string,
    readonly webmcp?: BrowserWebMcpSummary
  ) {
    super(message)
  }
}

export class AgentBrowserDriver {
  private readonly connection: BrowserCdpConnection
  private readonly runtime: BrowserAgentRuntime
  private connecting: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private active = false
  private epoch = 0
  private documentEpoch = 0
  private observationId: string | undefined
  private summary: BrowserWebMcpSummary | undefined
  private tools: SiteTool[] = []
  private catalog = ''
  private webMcpPermit: { tool: SiteTool; epoch: number } | undefined
  private readonly invocations = new Map<string, Invocation>()
  private readonly invalidateObservation = (): void => {
    this.epoch++
    this.observationId = undefined
    this.catalog = ''
    this.tools = []
    this.webMcpPermit = undefined
  }

  private readonly onMainDocument = (): void => {
    this.documentEpoch++
    this.invalidateObservation()
  }

  constructor(
    private readonly contents: WebContents,
    private readonly guards: BrowserCdpGuards
  ) {
    this.connection = new BrowserCdpConnection(contents, {
      ...guards,
      contextChanged: this.invalidateObservation,
      assertWebMcpInvoke: (params) => {
        const permit = this.webMcpPermit
        this.webMcpPermit = undefined
        const request = z.object({ toolName: z.string(), frameId: z.string() }).parse(params)
        if (
          !permit ||
          permit.epoch !== this.epoch ||
          request.toolName !== permit.tool.name ||
          request.frameId !== permit.tool.frameId
        )
          throw new Error('Website tool context changed. List the tools again.')
      }
    })
    this.runtime = new BrowserAgentRuntime(guards.assertActive, guards.detached)
    contents.on('did-start-navigation', this.invalidateObservation)
    contents.on('did-navigate', this.onMainDocument)
    contents.on('frame-created', this.invalidateObservation)
  }

  connect(): Promise<void> {
    this.connecting ??= (async () => {
      const endpoint = await this.connection.connect()
      await this.runtime.start()
      await this.call(['connect', endpoint])
    })()
    return this.connecting
  }

  private async call(args: string[]): Promise<Record<string, unknown>> {
    const result = await this.runtime.call(args)
    this.guards.assertActive()
    const data = result.data ?? {}
    if (data.webmcp && typeof data.webmcp === 'object') {
      const raw = z
        .object({
          status: z.string(),
          tools: z.array(z.unknown()).optional(),
          toolCount: z.number().optional(),
          truncated: z.boolean().optional()
        })
        .safeParse(data.webmcp)
      if (raw.success) {
        this.summary = BrowserWebMcpSummarySchema.parse({
          status: raw.data.status === 'ready' ? 'ready' : 'unavailable',
          untrusted: true,
          toolCount: raw.data.toolCount ?? 0,
          tools: raw.data.tools ?? [],
          truncated: raw.data.truncated ?? false
        })
        this.catalog = ''
        this.tools = []
      }
    }
    if (!result.success) {
      const error = result.error ?? ''
      if (/outcome_unknown/.test(error)) {
        this.guards.detached()
        throw new Error(
          'Browser outcome is unknown. Observe before continuing; do not repeat the action automatically.'
        )
      }
      if (/password_requires_human/.test(error))
        throw new Error('Password fields require the user to take over.')
      if (/checkbox_state_unconfirmed/.test(error))
        throw new Error(
          'Checkbox state is not yet confirmed. Observe before continuing; do not repeat the click automatically.'
        )
      if (/webmcp_event_stream_lost/.test(error)) {
        this.guards.detached()
        throw new Error('Browser observation stream was interrupted. Reconnect and observe again.')
      }
      if (/webmcp_unsupported/.test(error)) {
        this.summary = {
          status: 'unavailable',
          untrusted: true,
          toolCount: 0,
          tools: [],
          truncated: false
        }
        this.tools = []
        this.catalog = ''
        throw new Error('WebMCP is unavailable in this page runtime.')
      }
      if (/ref|stale|context.changed/i.test(error))
        throw new Error('Browser reference or context changed. Observe again.')
      if (/dialog/i.test(error))
        throw new Error('A browser dialog needs attention. Read dialog status before continuing.')
      throw new Error(
        'Browser operation failed; its effects may be incomplete. Observe before continuing.'
      )
    }
    return data
  }

  private ref(input: { ref: string; observationId: string }): string {
    if (!this.observationId || input.observationId !== this.observationId)
      throw new Error('Browser observation is stale. Take a new snapshot.')
    return input.ref.startsWith('@') ? input.ref : `@${input.ref}`
  }

  private page(): { url: string; title: string } {
    return {
      url: this.contents.getURL().slice(0, 2048),
      title: this.contents.getTitle().slice(0, 500)
    }
  }

  private data(value: unknown): AgentBrowserHostReply {
    const encoded = JSON.stringify(value)
    return AgentBrowserHostReplySchema.parse({
      kind: 'data',
      ...this.page(),
      data: encoded.length <= 64_000 ? value : { status: 'output_too_large', truncated: true }
    })
  }

  private async catalogTools(): Promise<SiteTool[]> {
    const epoch = this.epoch
    const data = await this.call(['webmcp', 'list'])
    if (epoch !== this.epoch)
      throw new Error('Page changed while reading website tools. List them again.')
    const tools = z.array(ToolSchema).max(512).parse(data.tools)
    const signature = JSON.stringify(tools)
    if (signature !== this.catalog) {
      this.catalog = signature
      this.tools = tools.map((tool) => ({ ...tool, toolId: randomUUID() }))
    }
    return this.tools
  }

  async execute(command: AgentBrowserCommand): Promise<DriverResult> {
    if (this.active) throw new Error('Browser page is still finishing a previous operation.')
    this.active = true
    try {
      const result = await this.perform(command)
      this.guards.assertActive()
      return { ...result, ...(this.summary ? { webmcp: this.summary } : {}) }
    } catch (error) {
      throw new BrowserAgentError(
        error instanceof Error ? error.message : 'Browser operation failed.',
        this.summary
      )
    } finally {
      this.active = false
      this.summary = undefined
    }
  }

  private async perform(command: AgentBrowserCommand): Promise<DriverResult> {
    const observe =
      [
        'snapshot',
        'screenshot',
        'read',
        'webmcp_list',
        'webmcp_result',
        'webmcp_cancel',
        'save_image',
        'frame',
        'wait'
      ].includes(command.kind) || command.kind === 'dialog'
    if (
      !observe &&
      [...this.invocations.values()].some(
        (value) => value.epoch === this.documentEpoch && value.pending
      )
    )
      throw new Error(
        'A WebMCP invocation is pending. Read its result or cancel it before another page action.'
      )
    const ref = 'ref' in command ? this.ref(command) : undefined
    if (
      (!observe && command.kind !== 'wait' && command.kind !== 'frame') ||
      (command.kind === 'dialog' && command.action !== 'status') ||
      command.kind === 'webmcp_cancel'
    )
      this.observationId = undefined
    switch (command.kind) {
      case 'navigate': {
        await this.call(['open', command.url])
        break
      }
      case 'back':
      case 'forward':
      case 'reload':
        await this.call([command.kind])
        break
      case 'snapshot': {
        const epoch = this.epoch
        const args = ['snapshot']
        if (command.interactive) args.push('-i')
        if (command.depth) args.push('-d', String(command.depth))
        if (command.selector) args.push('-s', command.selector)
        this.observationId = undefined
        const data = await this.call(args)
        if (this.epoch !== epoch)
          throw new Error('Page changed during observation. Take a new snapshot.')
        const snapshot = z.string().parse(data.snapshot)
        this.observationId = randomUUID()
        return {
          kind: 'snapshot',
          ...this.page(),
          observationId: this.observationId,
          snapshot: snapshot.slice(0, 50_000),
          truncated: snapshot.length > 50_000
        }
      }
      case 'read': {
        const result = await this.call(['read'])
        const text = z.string().parse(result.content)
        return this.data({
          text: text.slice(0, 50_000),
          truncated: text.length > 50_000,
          untrusted: true
        })
      }
      case 'screenshot':
        await this.call(['screenshot', this.runtime.screenshotPath()])
        return {
          kind: 'image',
          mimeType: 'image/jpeg',
          base64: await this.runtime.readScreenshot(),
          pageUrl: this.page().url
        }
      case 'click':
        await this.call(['click', ref!])
        break
      case 'type': {
        const epoch = this.epoch
        const metadata = await this.call(['get', 'element-info', ref!])
        if (metadata.inputType === 'password')
          throw new Error('Password fields require the user to take over.')
        if (epoch !== this.epoch) throw new Error('Page changed before input. Take a new snapshot.')
        await this.call(['fill', ref!, command.text])
        break
      }
      case 'press':
        await this.call(['press', command.key])
        break
      case 'select':
        await this.call(['select', ref!, command.value])
        break
      case 'check':
        await this.call([command.checked ? 'check' : 'uncheck', ref!])
        break
      case 'scroll':
        await this.call([
          'scroll',
          command.deltaY < 0 ? 'up' : 'down',
          String(Math.abs(command.deltaY))
        ])
        break
      case 'wait': {
        const condition = command.condition
        const args =
          condition.kind === 'element'
            ? [this.ref(condition)]
            : condition.kind === 'text'
              ? ['--text', condition.text]
              : condition.kind === 'url'
                ? ['--url', condition.pattern]
                : ['--load', condition.state]
        await this.call(['wait', ...args, '--timeout', String(command.timeoutMs ?? 5000)])
        break
      }
      case 'frame': {
        const target = command.target === 'main' ? 'main' : this.ref(command.target)
        this.invalidateObservation()
        await this.call(['frame', target])
        break
      }
      case 'dialog':
        return this.data(
          await this.call([
            'dialog',
            command.action,
            ...(command.text === undefined ? [] : [command.text])
          ])
        )
      case 'save_image': {
        const epoch = this.epoch
        const data = await this.call(['get', 'element-info', ref!])
        if (epoch !== this.epoch)
          throw new Error('Page changed before image selection. Take a new snapshot.')
        const parsed = ImageMetadataSchema.safeParse(data)
        if (!parsed.success) throw new Error('Selected browser reference is not a loaded image.')
        return { kind: 'selected_image', image: parsed.data }
      }
      case 'webmcp_list': {
        const tools = await this.catalogTools()
        if (command.toolId) {
          const tool = tools.find((candidate) => candidate.toolId === command.toolId)
          if (!tool) throw new Error('Website tool identity is stale. List the tools again.')
          if (JSON.stringify(tool).length > 60_000)
            throw new Error('Website tool schema exceeds the size limit.')
          return this.data({ untrusted: true, tool })
        }
        const offset = command.offset ?? 0
        const page = tools
          .slice(offset, offset + 16)
          .map(({ toolId, name, description, origin, frameId }) => ({
            toolId,
            name,
            description: description.slice(0, 500),
            origin,
            frameId
          }))
        return this.data({
          untrusted: true,
          tools: page,
          total: tools.length,
          nextOffset: offset + page.length < tools.length ? offset + page.length : null
        })
      }
      case 'webmcp_invoke': {
        const tool = this.tools.find((candidate) => candidate.toolId === command.toolId)
        if (!tool) throw new Error('Website tool identity is stale. List the tools again.')
        if (JSON.stringify(tool).length > 60_000)
          throw new Error('Website tool schema exceeds the size limit.')
        if (this.invocations.size >= 128)
          throw new Error('Browser invocation history is full. Start a new browser run.')
        const epoch = this.documentEpoch
        const permit = { tool, epoch: this.epoch }
        this.webMcpPermit = permit
        let data: Record<string, unknown>
        try {
          const tools = await this.catalogTools()
          if (
            this.webMcpPermit !== permit ||
            permit.epoch !== this.epoch ||
            !tools.some((candidate) => candidate.toolId === tool.toolId)
          )
            throw new Error('Website tool identity is stale. List the tools again.')
          data = await this.call([
            'webmcp',
            'invoke',
            tool.name,
            '--frame',
            tool.frameId,
            '--params',
            JSON.stringify(command.input),
            '--detach'
          ])
        } finally {
          this.webMcpPermit = undefined
        }
        const nativeId = z.string().parse(data.invocationId)
        const invocationId = randomUUID()
        this.invocations.set(invocationId, { nativeId, epoch, pending: true })
        return this.data({
          invocationId,
          status: this.documentEpoch === epoch ? 'pending' : 'context_changed',
          untrusted: true,
          origin: tool.origin
        })
      }
      case 'webmcp_result':
      case 'webmcp_cancel': {
        const invocation = this.invocations.get(command.invocationId)
        if (!invocation)
          throw new Error('Website invocation identity is unavailable in this browser run.')
        if (invocation.epoch !== this.documentEpoch)
          return this.data({
            invocationId: command.invocationId,
            status: 'context_changed',
            outcome: 'unknown',
            untrusted: true
          })
        const data = await this.call([
          'webmcp',
          command.kind === 'webmcp_result' ? 'result' : 'cancel',
          invocation.nativeId
        ])
        if (invocation.epoch !== this.documentEpoch)
          return this.data({
            invocationId: command.invocationId,
            status: 'context_changed',
            outcome: 'unknown',
            untrusted: true
          })
        const { invocationId: _nativeId, webmcp: _summary, ...result } = data
        invocation.pending = ['pending', 'cancel_requested'].includes(String(data.status))
        if (!invocation.pending) this.observationId = undefined
        return this.data({ ...result, invocationId: command.invocationId, untrusted: true })
      }
    }
    return { kind: 'page', ...this.page() }
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.connection.dispose()
    this.contents.off('did-start-navigation', this.invalidateObservation)
    this.contents.off('did-navigate', this.onMainDocument)
    this.contents.off('frame-created', this.invalidateObservation)
    this.invalidateObservation()
    this.closing = this.runtime.dispose().catch(() => undefined)
    return this.closing
  }
}
