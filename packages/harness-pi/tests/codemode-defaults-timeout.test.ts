import type { McpServer } from '@agentclientprotocol/sdk';
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from '@earendil-works/pi-ai';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { MOLLY_BUILTIN_MCP_CONNECTION } from '@molly/shared/embedded-harness';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { acpMcpConfig } from '../src/mcp';
import { writeProfileSettings } from '../src/profile-settings';
import { sessionDirectory } from '../src/profile';
import { deferred, fixture } from './fixtures/adapter';
import { managed } from './fixtures/managed';

const server = (metadata?: Record<string, unknown>): McpServer => ({
  name: 'molly',
  type: 'http',
  url: 'https://synthetic.invalid/mcp',
  headers: [],
  ...(metadata ? { _meta: metadata } : {}),
});

async function managedConfig(metadata?: Record<string, unknown>) {
  const host = await managed();
  const [selected] = await host.host.sessionConfig([server(metadata)], host.cwd);
  if (!selected) throw new Error('Synthetic MCP configuration missing');
  return selected;
}

async function heldNativeRequest(config: Awaited<ReturnType<typeof managedConfig>>) {
  const listed = deferred<void>();
  const started = deferred<void>();
  const cancelled = deferred<void>();
  const response = deferred<Response>();
  const requests: { id?: string | number; method: string; params?: unknown }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.url).toBe('https://synthetic.invalid/mcp');
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const body = z
      .object({
        id: z.union([z.string(), z.number()]).optional(),
        method: z.string(),
        params: z.unknown().optional(),
      })
      .parse(await request.json());
    requests.push(body);
    if (body.method === 'notifications/cancelled') {
      cancelled.resolve();
      return new Response(null, { status: 202 });
    }
    if (body.id === undefined) return new Response(null, { status: 202 });
    if (body.method === 'tools/call') {
      started.resolve();
      return await response.promise;
    }
    const result =
      body.method === 'initialize'
        ? {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'synthetic', version: '1' },
          }
        : {
            tools: [
              {
                name: 'image',
                description: 'Synthetic image request',
                inputSchema: { type: 'object', properties: {} },
              },
            ],
          };
    if (body.method === 'tools/list') listed.resolve();
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  });
  const f = await fixture({
    extensions: [
      {
        name: 'synthetic-managed-mcp',
        factory: (pi) => pi.registerMcpServer(config.name, config.config),
      },
    ],
    responses: [
      fauxAssistantMessage(
        fauxToolCall('codemode', {
          code: 'text(await tools.mcp__molly__image({}));',
        }),
        { stopReason: 'toolUse' }
      ),
      fauxAssistantMessage('SYNTHETIC_DONE'),
    ],
  });
  await f.initialize();
  const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
  await listed.promise;
  const finish = () => {
    const call = requests.find((request) => request.method === 'tools/call');
    const pending = z.object({ id: z.union([z.string(), z.number()]) }).parse(call);
    response.resolve(
      Response.json({
        jsonrpc: '2.0',
        id: pending.id,
        result: { content: [{ type: 'text', text: 'SYNTHETIC_IMAGE_SAVED' }] },
      })
    );
  };
  const prompt = () =>
    f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Synthetic image request' }],
    });
  return { f, started, cancelled, requests, finish, prompt };
}

describe('managed Codemode defaults and MCP request budget', () => {
  it('declares Codemode alongside ordinary tools with the production profile and no MCP', async () => {
    const f = await managed({ productionProfile: true });
    const session = await f.open();
    f.grant(session.snapshot);
    await session.prompt();
    const tools = getCurrentTools(JSON.parse(f.observed[0]!).messages).map(({ name }) => name);
    expect(tools).toEqual(expect.arrayContaining(['codemode', 'read', 'bash', 'edit', 'write']));
    expect(tools.some((name) => name.startsWith('subagent'))).toBe(false);
  });

  it('restores native history without replay and uses the SDK factory default tool selection', async () => {
    let restoring = false;
    const f = await fixture({
      extensions: [
        {
          name: 'select-initial-native-tools',
          factory: (pi) => {
            pi.on('session_start', () => {
              if (!restoring) pi.setActiveTools(['read', 'write']);
            });
          },
        },
      ],
    });
    await writeProfileSettings(f.agentDir);
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    await f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Persist the selected native tools' }],
    });
    expect(
      getCurrentTools(JSON.parse(f.prompts[0]!).messages)
        .map(({ name }) => name)
        .sort()
    ).toEqual(['read', 'write']);
    await f.agent.dispose();
    const directory = await sessionDirectory(f.agentDir);
    const saved = (await SessionManager.list(f.cwd, directory)).find(
      (entry) => entry.id === session.sessionId
    )!;
    const history = SessionManager.open(saved.path, directory);
    history.appendMessage(
      fauxAssistantMessage(
        {
          type: 'toolCall',
          id: 'synthetic-retired-delegation',
          name: 'subagent',
          arguments: { task: 'Synthetic saved delegation' },
        },
        { stopReason: 'toolUse' }
      )
    );
    history.appendMessage({
      role: 'toolResult',
      toolCallId: 'synthetic-retired-delegation',
      toolName: 'subagent',
      content: [{ type: 'text', text: 'SYNTHETIC_SAVED_SUBAGENT_RESULT' }],
      isError: false,
      timestamp: 0,
    });
    history.appendMessage(fauxAssistantMessage('SYNTHETIC_SAVED_SUBAGENT_COMPLETE'));
    restoring = true;
    f.updates.length = 0;
    const resumed = f.makeAgent();
    await resumed.initialize({ protocolVersion: 1 });
    await resumed.loadSession({ sessionId: session.sessionId, cwd: f.cwd, mcpServers: [] });
    expect(f.prompts).toHaveLength(1);
    expect(JSON.stringify(f.updates)).toContain('Persist the selected native tools');
    expect(JSON.stringify(f.updates)).toContain('SYNTHETIC_SAVED_SUBAGENT_RESULT');
    f.responses.push(fauxAssistantMessage('SYNTHETIC_RESTORED'));
    await resumed.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Use the native factory selection after restore' }],
    });
    expect(
      getCurrentTools(JSON.parse(f.prompts[1]!).messages)
        .map(({ name }) => name)
        .sort()
    ).toEqual(expect.arrayContaining(['codemode', 'read', 'bash', 'edit', 'write']));
    expect(
      getCurrentTools(JSON.parse(f.prompts[1]!).messages).some(({ name }) =>
        name.startsWith('subagent')
      )
    ).toBe(false);
  });

  it('extends only the exact managed built-in catalog identity', async () => {
    expect(
      (await managedConfig({ mollyConnection: MOLLY_BUILTIN_MCP_CONNECTION })).config.timeout
    ).toBe(900);
    for (const metadata of [
      undefined,
      { mollyConnection: { id: 'external', revision: 1 } },
      { mollyConnection: { ...MOLLY_BUILTIN_MCP_CONNECTION, revision: 2 } },
      { mollyConnection: { ...MOLLY_BUILTIN_MCP_CONNECTION, untrusted: true } },
    ]) {
      expect((await managedConfig(metadata)).config.timeout).toBeUndefined();
    }
    expect(
      acpMcpConfig([server({ mollyConnection: MOLLY_BUILTIN_MCP_CONNECTION })], '/synthetic')[0]
        ?.config.timeout
    ).toBeUndefined();
  });

  it('lets a managed native MCP image request finish beyond the native 60-second default', async () => {
    const config = await managedConfig({ mollyConnection: MOLLY_BUILTIN_MCP_CONNECTION });
    const request = await heldNativeRequest(config);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const running = request.prompt();
      await request.started.promise;
      await vi.advanceTimersByTimeAsync(60_001);
      request.finish();
      expect((await running).stopReason).toBe('end_turn');
      expect(request.f.prompts[1]).toContain('SYNTHETIC_IMAGE_SAVED');
      expect(request.requests.map(({ method }) => method)).not.toContain('notifications/cancelled');
    } finally {
      vi.useRealTimers();
      await request.f.agent.dispose();
      vi.unstubAllGlobals();
    }
  });

  it.each([
    { origin: 'managed built-in', timeoutMs: 900_000, trusted: true },
    { origin: 'standalone with forged metadata', timeoutMs: 60_000, trusted: false },
  ])(
    'cancels a silent $origin request at its native timeout without replay',
    async ({ timeoutMs, trusted }) => {
      const metadata = { mollyConnection: MOLLY_BUILTIN_MCP_CONNECTION };
      const config = trusted
        ? await managedConfig(metadata)
        : acpMcpConfig([server(metadata)], '/synthetic')[0]!;
      const request = await heldNativeRequest(config);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const running = request.prompt();
        await request.started.promise;
        await vi.advanceTimersByTimeAsync(timeoutMs);
        await request.cancelled.promise;
        expect((await running).stopReason).toBe('end_turn');
        expect(request.f.prompts[1]).toContain(String(timeoutMs));
        request.finish();
        expect(
          request.requests
            .filter(({ method }) => method === 'tools/call')
            .map(({ params }) => params)
        ).toEqual([expect.objectContaining({ name: 'image' })]);
      } finally {
        vi.useRealTimers();
        await request.f.agent.dispose();
        vi.unstubAllGlobals();
      }
    }
  );
});
