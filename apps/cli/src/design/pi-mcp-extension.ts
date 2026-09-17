import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  Transport,
  TransportSendOptions,
} from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, MessageExtraInfo } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const configSchema = z.union([
  z.object({
    type: z.literal('http'),
    url: z.string().url(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })),
  }),
  z.object({
    type: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()),
  }),
]);
// Image HTTP work has a 180s production deadline; allow 30s for MCP delivery.
const IMAGE_TOOL_TIMEOUT_MS = 210_000;
const CANCELLATION_DELIVERY_TIMEOUT_MS = 30_000;
const callOptions = (name: string, signal?: AbortSignal) => ({
  signal,
  ...(['molly_generate_image', 'molly_edit_image'].includes(name)
    ? { timeout: IMAGE_TOOL_TIMEOUT_MS }
    : {}),
});
const names = new Set(['molly_generate_image', 'molly_edit_image', 'molly_render_preview']);

/** Give SDK cancellation delivery its existing allowance before per-call transport cleanup. */
export class CancellationDeliveryTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  private cancellationDelivery: Promise<'delivered' | 'failed'> | undefined;

  constructor(private readonly inner: Transport) {}

  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }

  setProtocolVersion(version: string): void {
    this.inner.setProtocolVersion?.(version);
  }

  async start(): Promise<void> {
    this.inner.onclose = () => this.onclose?.();
    this.inner.onerror = (error) => this.onerror?.(error);
    this.inner.onmessage = (message, extra) => this.onmessage?.(message, extra);
    await this.inner.start();
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const delivery = this.inner.send(message, options);
    if ('method' in message && message.method === 'notifications/cancelled') {
      this.cancellationDelivery = delivery.then(
        () => 'delivered',
        () => 'failed'
      );
    }
    return delivery;
  }

  async waitForCancellationDelivery(): Promise<
    'not-requested' | 'delivered' | 'failed' | 'timed-out'
  > {
    const delivery = this.cancellationDelivery;
    if (!delivery) return 'not-requested';
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        delivery,
        new Promise<'timed-out'>((resolve) => {
          deadline = setTimeout(() => resolve('timed-out'), CANCELLATION_DELIVERY_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }

  async close(): Promise<void> {
    await this.inner.close();
  }
}

interface PiMcpApi {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(
      id: string,
      args: Record<string, unknown>,
      signal?: AbortSignal
    ): Promise<{
      content: (
        | { type: 'text'; text: string }
        | { type: 'image'; data: string; mimeType: string }
      )[];
      details: Record<string, never>;
    }>;
  }): void;
  getActiveTools(): string[];
  setActiveTools(names: string[]): void;
  on(
    event: 'session_start' | 'before_agent_start' | 'session_shutdown',
    handler: () => Promise<void>
  ): void;
}

/** Only the existing Molly tools: no external MCP catalog, image provider or server. */
export async function registerPiMcpTools(
  pi: PiMcpApi,
  client: Client,
  invoke: (
    args: Parameters<Client['callTool']>[0],
    signal?: AbortSignal
  ) => ReturnType<Client['callTool']> = (args, signal) =>
    client.callTool(args, undefined, callOptions(args.name, signal))
): Promise<void> {
  let available = new Set<string>();
  let closed = false;
  const refresh = async () => {
    const activeBefore = pi.getActiveTools();
    const previouslyAvailable = available;
    available = new Set();
    pi.setActiveTools(activeBefore.filter((name) => !names.has(name)));
    const listed = await client.listTools();
    const selected = listed.tools.filter((tool) => names.has(tool.name));
    available = new Set(selected.map((tool) => tool.name));
    for (const tool of selected) {
      pi.registerTool({
        name: tool.name,
        label: tool.title ?? tool.name,
        description: tool.description ?? tool.name,
        parameters: tool.inputSchema,
        async execute(_id, args, signal) {
          if (closed || !available.has(tool.name)) throw Error('Molly MCP tool is unavailable');
          const result = await invoke({ name: tool.name, arguments: args }, signal);
          if (!('content' in result) || !Array.isArray(result.content))
            throw Error('Invalid Molly MCP result');
          const content = z
            .array(
              z.union([
                z.object({ type: z.literal('text'), text: z.string() }),
                z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }),
              ])
            )
            .parse(result.content);
          if (result.isError)
            throw Error(
              content
                .filter((c) => c.type === 'text')
                .map((c) => c.text)
                .join('\n') || 'Molly MCP tool failed'
            );
          return { content, details: {} };
        },
      });
    }
    pi.setActiveTools([
      ...activeBefore.filter((name) => !names.has(name)),
      ...[...available].filter(
        (name) => activeBefore.includes(name) || !previouslyAvailable.has(name)
      ),
    ]);
  };
  pi.on('session_shutdown', async () => {
    if (closed) return;
    closed = true;
    available.clear();
    await client.close();
  });
  pi.on('before_agent_start', refresh);
  pi.on('session_start', refresh);
}

export default async function mollyPiMcpExtension(pi: PiMcpApi): Promise<void> {
  const raw = process.env.MOLLY_PI_MCP_CONFIG ?? process.env.LODY_PI_MCP_CONFIG;
  if (!raw) return;
  const client = new Client({ name: 'molly-pi-tools', version: '1.0.0' });
  try {
    const config = configSchema.parse(JSON.parse(raw));
    if (config.type === 'http') {
      const url = new URL(config.url);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
        throw Error('Invalid local MCP endpoint');
      const transport = () =>
        new StreamableHTTPClientTransport(url, {
          requestInit: {
            headers: Object.fromEntries(config.headers.map(({ name, value }) => [name, value])),
          },
        });
      const activeCalls = new Set<Client>();
      pi.on('session_shutdown', async () => {
        await Promise.all([...activeCalls].map((call) => call.close()));
      });
      await client.connect(transport());
      await registerPiMcpTools(pi, client, async (args, signal) => {
        signal?.throwIfAborted();
        const callClient = new Client({ name: 'molly-pi-tool-call', version: '1.0.0' });
        const callTransport = new CancellationDeliveryTransport(transport());
        activeCalls.add(callClient);
        let closing: Promise<void> | undefined;
        const abortConnect = () => {
          closing ??= callClient.close();
          void closing.catch(() => undefined);
        };
        signal?.addEventListener('abort', abortConnect, { once: true });
        try {
          try {
            await callClient.connect(callTransport);
          } finally {
            signal?.removeEventListener('abort', abortConnect);
          }
          signal?.throwIfAborted();
          return await callClient.callTool(args, undefined, callOptions(args.name, signal));
        } finally {
          try {
            await callTransport.waitForCancellationDelivery();
            await (closing ?? callClient.close());
          } finally {
            activeCalls.delete(callClient);
          }
        }
      });
    } else {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
        stderr: 'pipe',
      });
      // Consume diagnostics without exposing inherited credentials or blocking the child.
      transport.stderr?.on('data', () => undefined);
      await client.connect(transport);
      await registerPiMcpTools(pi, client);
    }
  } catch {
    await client.close();
    // Never include headers, endpoints, or provider credentials in startup errors.
    throw Error('Molly MCP tools could not initialize');
  }
}
