import { createHash } from 'node:crypto';
import type { McpServer } from '@agentclientprotocol/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { Type } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import {
  ModelEndpointSchema,
  McpCredentialBindingSchema,
  StoredMcpCredentialSchema,
  mcpCredentialMatchesServer,
  McpImageBindingSchema,
  type McpImageBinding,
} from '@molly/shared/embedded-harness';
import { createToolEnvironment } from './environment';
import { createBoundModelFetch } from './model-transport';
import { waitForApproval, type BrowserTaskApproval, type ToolApproval } from './approved-tools';
import { CancellationDeliveryTransport } from './mcp-cancellation';
import { resolveMcpContent } from './mcp-content';
import { bindMcpImageTool } from './mcp-image-binding';
import type { OperationResourceRead } from './tool-operation-journal';

type ClientPort = Pick<
  Client,
  'listTools' | 'callTool' | 'readResource' | 'getServerCapabilities' | 'close'
>;

function schemaHash(tool: Tool): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        name: tool.name,
        inputSchema: tool.inputSchema,
        description: tool.description ?? '',
      })
    )
    .digest('hex');
}

/** Only fixed Molly-owned browser failures may cross the MCP error boundary. */
function browserFailureCode(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const reply = result as { isError?: unknown; content?: unknown };
  if (reply.isError !== true || !Array.isArray(reply.content) || reply.content.length !== 1)
    return null;
  const part = reply.content[0] as { type?: unknown; text?: unknown };
  if (part.type !== 'text' || typeof part.text !== 'string' || part.text.length > 1_000)
    return null;
  const message = part.text;
  if (
    message === 'Agent browser requires a public website.' ||
    message === 'Agent browser requires a public page.' ||
    message === 'Agent browser cannot access local, private, or reserved hosts.'
  )
    return 'harness_browser_destination_denied';
  if (message.includes('the returned bytes are not a PNG, JPEG, or GIF image'))
    return 'harness_browser_image_format_unsupported';
  if (
    message === 'Browser element reference is stale.' ||
    message === 'Browser element reference is unknown or stale.' ||
    message === 'Browser element changed or is no longer actionable.'
  )
    return 'harness_browser_reference_stale';
  if (message === 'Selected browser reference is not a loaded image.')
    return 'harness_browser_image_unavailable';
  if (
    message === 'Browser screenshot is empty or exceeds the size limit.' ||
    message === 'Browser screenshot exceeds the size limit.' ||
    message === 'Browser screenshot was not a JPEG image.'
  )
    return 'harness_browser_screenshot_unavailable';
  if (message === 'Browser page is still loading; observe again after it settles.')
    return 'harness_browser_page_not_ready';
  if (
    message === 'Agent browser page must be navigated under the network guard.' ||
    message === 'Agent browser could not verify the current document response.'
  )
    return 'harness_browser_page_unverified';
  if (message.startsWith('Agent browser network blocked: '))
    return 'harness_browser_network_blocked';
  if (message === 'The user has taken control of the browser page.')
    return 'harness_browser_user_takeover';
  return null;
}

export function mcpToolName(server: string, tool: string): string {
  if (
    server === 'molly' &&
    ['molly_generate_image', 'molly_edit_image', 'molly_render_preview', 'molly_browser'].includes(
      tool
    )
  )
    return tool;
  const identity = createHash('sha256')
    .update(JSON.stringify([server, tool]))
    .digest('hex')
    .slice(0, 12);
  return `mcp_${server.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 16)}_${tool.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24)}_${identity}`;
}

async function listTools(client: ClientPort, signal?: AbortSignal): Promise<Tool[]> {
  const tools: Tool[] = [];
  const catalogSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, {
      signal: catalogSignal,
      timeout: 30_000,
      maxTotalTimeout: 30_000,
    });
    tools.push(...page.tools);
    cursor = page.nextCursor;
    if (tools.length > 256 || (cursor && cursors.has(cursor)) || cursors.size > 64)
      throw new Error('harness_mcp_catalog_limit');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
    throw new Error('harness_mcp_duplicate_tool');
  return tools;
}

/** Testing seam is the real MCP client interface, not a second tool protocol. */
export async function defineMcpTools(input: {
  signal?: AbortSignal;
  serverName: string;
  imageBinding?: McpImageBinding;
  imageImportAvailable?: boolean;
  client: ClientPort;
  approve: ToolApproval;
  isAvailable: () => boolean;
  dispatch: (
    serverName: string,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    invoke: (context?: {
      metadata?: Record<string, unknown>;
      readResource?: OperationResourceRead;
    }) => Promise<unknown>,
    boundImage?: boolean,
    authorization?: BrowserTaskApproval
  ) => Promise<unknown>;
}) {
  return (await listTools(input.client, input.signal)).map((descriptor) => {
    const tool = structuredClone(descriptor);
    const frozen = schemaHash(tool);
    const image = bindMcpImageTool(tool, structuredClone(input.imageBinding));
    const bindingDescription =
      image.status === 'bound'
        ? ` Image ${image.operation} mapping; fixed model: ${image.model}. Image references are forwarded unchanged to this server; no local-file read or upload is implied. Inline MCP images and resource links are supported; linked results require separate approval and this server's resources/read capability, with no host URL fetch fallback. ${input.imageImportAvailable ? 'Returned PNG/JPEG/GIF images are imported into the current design draft; host asset receipts replace server content. Read those assets to inspect them. Import does not commit artwork.' : 'Artwork asset import is not ready.'}`
        : image.status === 'unavailable'
          ? ' Image binding unavailable: configured fields/model do not match this schema. This remains an ordinary MCP tool; image asset import is not ready.'
          : '';
    return {
      name: mcpToolName(input.serverName, tool.name),
      label: tool.title ?? tool.name,
      description: `[MCP ${input.serverName}] ${tool.description ?? tool.name}${bindingDescription}`,
      // TypeBox's public Unsafe adapter retains the server's JSON Schema verbatim.
      parameters: image.status === 'bound' ? image.parameters : Type.Unsafe(tool.inputSchema),
      async execute(toolCallId, raw, signal) {
        try {
          signal?.throwIfAborted();
          const args = image.status === 'bound' ? image.map(raw) : structuredClone(raw);
          if (!input.isAvailable()) throw new Error('harness_mcp_connection_changed');
          const current = (await listTools(input.client, signal)).find(
            (entry) => entry.name === tool.name
          );
          if (!current || schemaHash(current) !== frozen)
            throw new Error('harness_mcp_schema_changed');
          const allowed = await waitForApproval(
            input.approve({
              toolCallId,
              name: `${input.serverName}/${tool.name}`,
              arguments: structuredClone(args),
              signal,
            }),
            signal
          );
          signal?.throwIfAborted();
          if (!allowed || !input.isAvailable()) throw new Error('harness_permission_denied');
          const approved = (await listTools(input.client, signal)).find(
            (entry) => entry.name === tool.name
          );
          signal?.throwIfAborted();
          if (!input.isAvailable() || !approved || schemaHash(approved) !== frozen)
            throw new Error('harness_mcp_schema_changed');
          if (!args || typeof args !== 'object' || Array.isArray(args))
            throw new Error('harness_mcp_arguments_invalid');
          const executionSignal = AbortSignal.any([
            ...(signal ? [signal] : []),
            AbortSignal.timeout(210_000),
          ]);
          const readResource = async (
            uri: string,
            index: number,
            withinParent?: OperationResourceRead
          ) => {
            executionSignal.throwIfAborted();
            if (!input.isAvailable()) throw new Error('harness_mcp_connection_changed');
            if (!input.client.getServerCapabilities()?.resources)
              throw new Error('harness_mcp_resource_read_unavailable');
            const resourceCallId = createHash('sha256')
              .update(JSON.stringify(['resource', toolCallId, index]))
              .digest('hex');
            const resourceAllowed = await waitForApproval(
              input.approve({
                toolCallId: resourceCallId,
                name: `${input.serverName}/resources/read`,
                arguments: { uri },
                signal: executionSignal,
              }),
              executionSignal
            );
            executionSignal.throwIfAborted();
            if (!resourceAllowed) throw new Error('harness_permission_denied');
            if (!input.isAvailable()) throw new Error('harness_mcp_connection_changed');
            const resourceCatalogTool = (await listTools(input.client, executionSignal)).find(
              (entry) => entry.name === tool.name
            );
            executionSignal.throwIfAborted();
            if (
              !input.isAvailable() ||
              !resourceCatalogTool ||
              schemaHash(resourceCatalogTool) !== frozen
            )
              throw new Error('harness_mcp_schema_changed');
            const read = async () => {
              executionSignal.throwIfAborted();
              if (!input.isAvailable()) throw new Error('harness_mcp_connection_changed');
              const result = await input.client.readResource(
                { uri },
                { signal: executionSignal, timeout: 30_000, maxTotalTimeout: 30_000 }
              );
              executionSignal.throwIfAborted();
              if (!input.isAvailable()) throw new Error('harness_mcp_connection_changed');
              return result;
            };
            return withinParent
              ? withinParent(resourceCallId, uri, read)
              : input.dispatch(input.serverName, resourceCallId, 'resources/read', { uri }, read);
          };
          const result = await input.dispatch(
            input.serverName,
            toolCallId,
            tool.name,
            args as Record<string, unknown>,
            async (context) => {
              executionSignal.throwIfAborted();
              if (!input.isAvailable()) throw new Error('harness_mcp_connection_changed');
              const reply = await input.client.callTool(
                {
                  name: tool.name,
                  arguments: args as Record<string, unknown>,
                  ...(context?.metadata ? { _meta: context.metadata } : {}),
                },
                undefined,
                { signal: executionSignal, timeout: 210_000, maxTotalTimeout: 210_000 }
              );
              // Resolve paid image results before parent settlement. Child reads carry
              // independent approvals/receipts within this parent's serial dispatch.
              if (image.status !== 'ordinary' && reply.isError !== true) {
                const content = await resolveMcpContent(reply, async (uri, index) => {
                  if (image.status !== 'bound' || !context?.readResource)
                    throw new Error('harness_mcp_image_resource_import_unavailable');
                  return readResource(uri, index, context.readResource);
                });
                return { ...reply, content };
              }
              return reply;
            },
            image.status === 'bound',
            typeof allowed === 'object' ? allowed : undefined
          );
          if (input.serverName === 'molly' && tool.name === 'molly_browser') {
            const failure = browserFailureCode(result);
            if (failure) throw new Error(failure);
          }
          const content = await resolveMcpContent(result, (uri, index) => readResource(uri, index));
          executionSignal.throwIfAborted();
          if (!input.isAvailable()) throw new Error('harness_mcp_connection_changed');
          return {
            content,
            details: {
              serverName: input.serverName,
              toolName: tool.name,
              imageBinding: image.status,
            },
          };
        } catch (error) {
          // eslint-disable-next-line preserve-caught-error -- A cancelled request may still carry an upstream secret.
          if (signal?.aborted) throw new Error('harness_cancelled');
          const safeCodes = new Set([
            'harness_mcp_connection_changed',
            'harness_mcp_schema_changed',
            'harness_permission_denied',
            'harness_mcp_arguments_invalid',
            'harness_mcp_image_arguments_invalid',
            'harness_mcp_result_unsupported',
            'harness_mcp_result_limit',
            'harness_mcp_resource_mismatch',
            'harness_mcp_resource_read_unavailable',
            'harness_mcp_catalog_limit',
            'harness_mcp_duplicate_tool',
            'harness_mcp_tool_failed',
            'harness_mcp_outcome_unknown',
            'harness_browser_image_format_unsupported',
            'harness_browser_reference_stale',
            'harness_browser_image_unavailable',
            'harness_browser_screenshot_unavailable',
            'harness_browser_page_not_ready',
            'harness_browser_page_unverified',
            'harness_browser_network_blocked',
            'harness_browser_user_takeover',
            'harness_browser_destination_denied',
          ]);
          // Native history must not retain raw transport/server diagnostics or echoed credentials.
          // eslint-disable-next-line preserve-caught-error -- Deliberately discard secret-bearing causes.
          throw new Error(
            error instanceof Error && safeCodes.has(error.message)
              ? error.message
              : 'harness_mcp_tool_failed'
          );
        }
      },
    } satisfies ToolDefinition;
  });
}

export async function connectMcpBridge(
  servers: McpServer[],
  options: {
    cwd: string;
    approve: ToolApproval;
    dispatch: Parameters<typeof defineMcpTools>[0]['dispatch'];
    credentials?: Array<ReturnType<typeof StoredMcpCredentialSchema.parse>>;
    signal?: AbortSignal;
    imageImportAvailable?: boolean;
  }
) {
  if (servers.length > 32 || new Set(servers.map((server) => server.name)).size !== servers.length)
    throw new Error('harness_mcp_server_limit');
  const clients: Client[] = [];
  const transports: CancellationDeliveryTransport[] = [];
  let closed = false;
  const close = async () => {
    closed = true;
    await Promise.all(transports.map((transport) => transport.waitForCancellationDelivery()));
    await Promise.allSettled(clients.map((client) => client.close()));
  };
  const tools: Awaited<ReturnType<typeof defineMcpTools>> = [];
  try {
    for (const server of servers) {
      options.signal?.throwIfAborted();
      let values: Record<string, string> = {};
      if (server._meta?.mollyMcpCredential !== undefined) {
        const binding = McpCredentialBindingSchema.parse(server._meta.mollyMcpCredential);
        const credential = options.credentials?.find(
          (entry) => JSON.stringify(entry.connection) === JSON.stringify(binding)
        );
        if (
          !credential ||
          !mcpCredentialMatchesServer(binding, server) ||
          ('type' in server
            ? server.type !== 'http' || server.headers.length > 0
            : server.env.length > 0)
        )
          throw new Error('harness_mcp_credential_mismatch');
        values = StoredMcpCredentialSchema.parse(credential).values;
      }
      const client = new Client({ name: 'molly-embedded-pi', version: '1.0.0' });
      clients.push(client);
      let available = true;
      client.onclose = () => {
        available = false;
      };
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        available = false;
      });
      if ('type' in server) {
        if (server.type !== 'http') throw new Error('harness_mcp_transport_unsupported');
        const endpoint = ModelEndpointSchema.parse(server.url);
        const transport = new CancellationDeliveryTransport(
          new StreamableHTTPClientTransport(new URL(endpoint), {
            fetch: createBoundModelFetch(endpoint),
            requestInit: {
              headers: {
                ...Object.fromEntries(server.headers.map(({ name, value }) => [name, value])),
                ...values,
              },
            },
          })
        );
        transports.push(transport);
        await client.connect(transport, { signal: options.signal, timeout: 30_000 });
      } else {
        const transport = new StdioClientTransport({
          command: server.command,
          args: server.args,
          cwd: options.cwd,
          env: {
            ...createToolEnvironment(process.env),
            ...Object.fromEntries(server.env.map(({ name, value }) => [name, value])),
            ...values,
          },
          stderr: 'pipe',
        });
        transport.stderr?.on('data', () => undefined);
        const guarded = new CancellationDeliveryTransport(transport);
        transports.push(guarded);
        await client.connect(guarded, { signal: options.signal, timeout: 30_000 });
      }
      tools.push(
        ...(await defineMcpTools({
          serverName: server.name,
          client,
          approve: options.approve,
          isAvailable: () => !closed && available,
          dispatch: options.dispatch,
          signal: options.signal,
          imageImportAvailable: options.imageImportAvailable,
          ...(server._meta?.mollyImageBinding !== undefined
            ? {
                imageBinding: McpImageBindingSchema.parse(server._meta.mollyImageBinding),
              }
            : {}),
        }))
      );
    }
    return { tools, close };
  } catch {
    await close();
    throw new Error('harness_mcp_start_failed');
  }
}
