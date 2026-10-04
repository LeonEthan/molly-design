import { homedir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ListToolsResultSchema, McpError, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { createToolEnvironment } from '@molly/harness-pi/environment';
import {
  MCP_TOOL_DISCOVERY_LIMITS,
  McpToolDiscoveryRequestSchema,
  type McpDiscoveredTool,
  type McpToolDiscoveryRequest,
  type McpToolDiscoveryResult,
} from '@molly/shared/embedded-harness';

/**
 * `molly __internal mcp-list-tools`: Settings' one-shot tool listing for one saved MCP server.
 * Electron main owns the deadline, output bound and process-tree cleanup; this process only
 * initializes, pages through `tools/list` and prints one secret-free result line.
 */
const MAX_REQUEST_BYTES = 128 * 1024;
const HELPER_DEADLINE_MS = 20_000;
const MIN_SECRET_ECHO_CHARS = 6;

export function buildDiscoveryTransport(request: McpToolDiscoveryRequest): Transport {
  const { destination, values = {} } = request;
  if (destination.transport === 'stdio')
    return new StdioClientTransport({
      command: destination.command,
      args: destination.args,
      env: { ...createToolEnvironment(process.env), ...values },
      cwd: homedir(),
      stderr: 'ignore',
    });
  return new StreamableHTTPClientTransport(new URL(destination.url), {
    requestInit: { headers: values },
    fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }),
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 0,
      maxReconnectionDelay: 0,
      reconnectionDelayGrowFactor: 1,
    },
  });
}

function redact(text: string, secrets: readonly string[], max: number): string {
  let redacted = text;
  for (const secret of secrets) redacted = redacted.split(secret).join('•••');
  return redacted.slice(0, max);
}

function project(tool: Tool, secrets: readonly string[]): McpDiscoveredTool | undefined {
  if (
    tool.name.length > MCP_TOOL_DISCOVERY_LIMITS.name ||
    secrets.some((s) => tool.name.includes(s))
  )
    return undefined;
  const title = tool.title ?? tool.annotations?.title;
  const hints = tool.annotations ?? {};
  return {
    name: tool.name,
    ...(title ? { title: redact(title, secrets, MCP_TOOL_DISCOVERY_LIMITS.title) } : {}),
    ...(tool.description
      ? { description: redact(tool.description, secrets, MCP_TOOL_DISCOVERY_LIMITS.description) }
      : {}),
    ...(typeof hints.readOnlyHint === 'boolean' ? { readOnlyHint: hints.readOnlyHint } : {}),
    ...(typeof hints.destructiveHint === 'boolean'
      ? { destructiveHint: hints.destructiveHint }
      : {}),
    ...(typeof hints.idempotentHint === 'boolean' ? { idempotentHint: hints.idempotentHint } : {}),
    ...(typeof hints.openWorldHint === 'boolean' ? { openWorldHint: hints.openWorldHint } : {}),
  };
}

function failureReason(error: unknown): McpToolDiscoveryResult {
  if (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403))
    return { ok: false, reason: 'needs_credentials' };
  if (error instanceof Error && error.name === 'UnauthorizedError')
    return { ok: false, reason: 'needs_credentials' };
  if (error instanceof McpError || (error instanceof Error && error.name === 'ZodError'))
    return { ok: false, reason: 'invalid_response' };
  return { ok: false, reason: 'unreachable' };
}

/** Initialize, page through `tools/list` within the limits, and never call a tool. */
export async function discoverMcpTools(
  transport: Transport,
  secrets: readonly string[] = []
): Promise<McpToolDiscoveryResult> {
  const client = new Client({ name: 'molly-settings', version: '1.0.0' }, { capabilities: {} });
  const echoes = secrets.filter((secret) => secret.length >= MIN_SECRET_ECHO_CHARS);
  try {
    await client.connect(transport);
    const tools: McpDiscoveredTool[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MCP_TOOL_DISCOVERY_LIMITS.pages; page += 1) {
      const result = await client.request(
        { method: 'tools/list', params: cursor ? { cursor } : {} },
        ListToolsResultSchema
      );
      for (const tool of result.tools) {
        const projected = project(tool, echoes);
        if (!projected || seen.has(projected.name)) continue;
        if (tools.length === MCP_TOOL_DISCOVERY_LIMITS.tools)
          return { ok: true, tools, truncated: true };
        seen.add(projected.name);
        tools.push(projected);
      }
      if (!result.nextCursor) return { ok: true, tools, truncated: false };
      if (result.nextCursor === cursor) return { ok: false, reason: 'invalid_response' };
      cursor = result.nextCursor;
    }
    return { ok: true, tools, truncated: true };
  } catch (error) {
    return failureReason(error);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function readRequest(): Promise<McpToolDiscoveryRequest | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) return undefined;
    chunks.push(buffer);
  }
  try {
    const parsed = McpToolDiscoveryRequestSchema.safeParse(
      JSON.parse(Buffer.concat(chunks).toString('utf8'))
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function runMcpToolDiscovery(): Promise<void> {
  const request = await readRequest();
  const result: McpToolDiscoveryResult = request
    ? await Promise.race([
        discoverMcpTools(buildDiscoveryTransport(request), Object.values(request.values ?? {})),
        new Promise<McpToolDiscoveryResult>((resolve) =>
          setTimeout(() => resolve({ ok: false, reason: 'timed_out' }), HELPER_DEADLINE_MS).unref()
        ),
      ])
    : { ok: false, reason: 'unsupported' };
  process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(0));
}
