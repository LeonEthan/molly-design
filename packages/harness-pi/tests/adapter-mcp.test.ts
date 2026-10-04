import { watch } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { McpCredentialBinding } from '@molly/shared/embedded-harness';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  McpServer,
} from '@agentclientprotocol/sdk';
import { z } from 'zod';
import { acpMcpConfig } from '../src/mcp';
import type { AdapterPeer } from '../src/session';
import { deferred, fixture } from './fixtures/adapter';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const codemode = (code: string) =>
  fauxAssistantMessage(fauxToolCall('codemode', { code }), { stopReason: 'toolUse' });
const tool = (name: string) =>
  codemode(
    `const result = await tools.mcp__synthetic__${name}({}); text(result); for (const block of result.content) if (block.type === "image") image(block);`
  );
const done = () => fauxAssistantMessage('SYNTHETIC_DONE');

function answer(params: unknown, selection: string): CreateElicitationResponse {
  const request = params as CreateElicitationRequest;
  if (request.mode !== 'form') throw new Error('Expected form elicitation');
  const fields = z
    .object({ properties: z.record(z.string(), z.unknown()) })
    .parse(request.requestedSchema);
  const key = Object.keys(fields.properties)[0]!;
  const schema = z.object({ enum: z.array(z.string()) }).parse(fields.properties[key]);
  expect(schema.enum).toContain(selection);
  return { action: 'accept', content: { [key]: selection } };
}

function server(directory: string): Extract<McpServer, { command: string }> {
  return {
    name: 'synthetic',
    command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/adapter-mcp.mjs', import.meta.url)), directory],
    env: [],
  };
}

async function protocol(directory: string) {
  try {
    return (await readFile(join(directory, 'protocol.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) =>
        z.object({ method: z.string(), params: z.unknown().optional() }).parse(JSON.parse(line))
      );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function fileSignal(directory: string, name: string) {
  const target = `${name}.json`;
  const ready = deferred<unknown>();
  const watcher = watch(directory, (_event, filename) => {
    if (filename?.toString() !== target) return;
    void readFile(join(directory, target), 'utf8').then(
      (value) => ready.resolve(JSON.parse(value)),
      () => {}
    );
  });
  return { promise: ready.promise, close: () => watcher.close() };
}

describe('owned Pi ACP native MCP integration', () => {
  it('keeps nested MCP outcomes associated with their script and restores summaries without execution', async () => {
    const f = await fixture({
      responses: [
        codemode(
          'await tools.mcp__synthetic__image({}); const failure = await tools.mcp__synthetic__fail({}); if (!failure.isError) throw new Error("Expected failure"); text("HANDLED_FAILURE");'
        ),
        done(),
      ],
    });
    const metadataSchema = z.object({
      lody: z.object({ toolName: z.string(), parentToolCallId: z.string().optional() }),
    });
    const toolUpdates = () =>
      f.updates.flatMap(({ update }) =>
        update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update'
          ? [{ update, meta: metadataSchema.parse(update._meta).lody }]
          : []
      );
    await f.initialize();
    const selected = server(f.cwd);
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [selected] });
    const response = await f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Synthetic nested calls' }],
    });
    expect(response.stopReason).toBe('end_turn');
    const live = toolUpdates();
    const parent = live.find(
      ({ meta, update }) => meta.toolName === 'codemode' && update.sessionUpdate === 'tool_call'
    );
    if (!parent) throw new Error('Missing script activity');
    const children = live.filter(
      ({ meta, update }) =>
        meta.parentToolCallId === parent.update.toolCallId && update.sessionUpdate === 'tool_call'
    );
    expect(children.map(({ meta }) => meta.toolName)).toEqual([
      'mcp__synthetic__image',
      'mcp__synthetic__fail',
    ]);
    expect(
      live
        .filter(
          ({ meta, update }) =>
            meta.parentToolCallId === parent.update.toolCallId &&
            update.sessionUpdate === 'tool_call_update'
        )
        .map(({ update }) => update.status)
    ).toEqual(['completed', 'failed']);
    await f.agent.dispose();
    const requests = await protocol(f.cwd);
    f.updates.length = 0;
    const restored = f.makeAgent();
    await restored.initialize({ protocolVersion: 1 });
    await restored.loadSession({
      sessionId: session.sessionId,
      cwd: f.cwd,
      mcpServers: [selected],
    });
    const recovered = toolUpdates().filter(({ meta }) => meta.parentToolCallId !== undefined);
    expect(recovered.map(({ update }) => update.toolCallId)).toEqual(
      children.map(({ update }) => update.toolCallId)
    );
    expect(recovered.map(({ update }) => update.status)).toEqual(['completed', 'failed']);
    expect(JSON.stringify(recovered)).toContain('original result is not recorded');
    expect(JSON.stringify(recovered)).not.toContain(png);
    expect((await protocol(f.cwd)).filter((request) => request.method === 'tools/call')).toEqual(
      requests.filter((request) => request.method === 'tools/call')
    );
    expect(f.prompts).toHaveLength(2);
  });

  it('authenticates native HTTP MCP requests with literal protected custom headers', async () => {
    const connection: McpCredentialBinding = {
      workspaceId: 'workspace',
      serverId: 'synthetic',
      credentialRef: randomUUID(),
      revision: 1,
      destination: { transport: 'http', url: 'https://synthetic.invalid/mcp' },
      fieldNames: ['X-Api-Key'],
    };
    const [selected] = acpMcpConfig(
      [
        {
          name: 'synthetic',
          type: 'http',
          url: 'https://synthetic.invalid/mcp',
          headers: [],
          _meta: { mollyMcpCredential: connection },
        },
      ],
      '/synthetic',
      [{ connection, values: { 'X-Api-Key': '!SYNTHETIC${HOME}' } }]
    );
    if (!selected) throw new Error('Synthetic MCP configuration missing');
    const requests: { method: string; key: string | null; authorization: string | null }[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe('https://synthetic.invalid/mcp');
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const body = z
        .object({ id: z.union([z.number(), z.string()]).optional(), method: z.string() })
        .parse(await request.json());
      requests.push({
        method: body.method,
        key: request.headers.get('x-api-key'),
        authorization: request.headers.get('authorization'),
      });
      if (body.id === undefined) return new Response(null, { status: 202 });
      const result =
        body.method === 'initialize'
          ? {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'synthetic', version: '1' },
            }
          : body.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: 'probe',
                    description: 'Synthetic probe',
                    inputSchema: { type: 'object', properties: {} },
                  },
                ],
              }
            : { content: [{ type: 'text', text: 'CUSTOM_HEADER_ACCEPTED' }] };
      return Response.json({ jsonrpc: '2.0', id: body.id, result });
    });
    const f = await fixture({
      extensions: [
        {
          name: 'synthetic-protected-http',
          factory: (pi) => {
            pi.registerMcpServer(selected.name, selected.config);
          },
        },
      ],
      responses: [tool('probe'), done()],
    });
    try {
      await f.initialize();
      const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
      const result = await f.agent.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Probe' }],
      });
      expect(result.stopReason).toBe('end_turn');
      expect(f.prompts[1]).toContain('CUSTOM_HEADER_ACCEPTED');
      expect(requests.map(({ method }) => method)).toContain('tools/call');
      expect(
        requests.every(
          ({ key, authorization }) => key === '!SYNTHETIC${HOME}' && authorization === null
        )
      ).toBe(true);
      expect(await readFile(join(f.agentDir, 'settings.json'), 'utf8')).not.toContain('!SYNTHETIC');
      await expect(readFile(join(f.agentDir, 'mcp.json'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await f.agent.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('uses native codemode discovery and preserves MCP image/error/resource content', async () => {
    const f = await fixture({
      responses: [
        tool('image'),
        done(),
        tool('fail'),
        done(),
        codemode(
          'text(await tools.read_mcp_resource({server: "synthetic", uri: "synthetic://resource"}));'
        ),
        done(),
      ],
    });
    const initialized = await f.initialize();
    expect(initialized.agentCapabilities?.mcpCapabilities).toEqual({ http: true });
    const selected = server(f.cwd);
    selected.env = [
      { name: 'SYNTHETIC_LITERAL_DOLLAR', value: '${HOME}$HOME' },
      { name: 'SYNTHETIC_LITERAL_BANG', value: '!literal' },
    ];
    selected.args.push('${HOME}', '$HOME', '$env:HOME', '{env:HOME}');
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [selected] });
    expect(
      (
        await f.agent.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: 'Get image' }],
        })
      ).stopReason
    ).toBe('end_turn');
    expect(JSON.parse(await readFile(join(f.cwd, 'spawned.json'), 'utf8'))).toEqual({
      initialized: true,
      environment: { dollar: '${HOME}$HOME', bang: '!literal' },
      arguments: ['${HOME}', '$HOME', '$env:HOME', '{env:HOME}'],
    });
    expect(f.updates).toContainEqual(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: 'tool_call_update',
          status: 'completed',
          content: expect.arrayContaining([
            { type: 'content', content: { type: 'image', data: png, mimeType: 'image/png' } },
          ]),
        }),
      })
    );
    expect(
      (
        await f.agent.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: 'Get error' }],
        })
      ).stopReason
    ).toBe('end_turn');
    expect(f.updates).toContainEqual(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: 'tool_call_update',
          status: 'failed',
          content: expect.arrayContaining([
            { type: 'content', content: { type: 'image', data: png, mimeType: 'image/png' } },
          ]),
        }),
      })
    );
    await f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Read resource' }],
    });
    expect(f.prompts.join('\n')).toContain(png);
    expect(f.prompts.join('\n')).toContain('SYNTHETIC_SERVICE_ERROR');
    expect(f.prompts.join('\n')).toContain('SYNTHETIC_RESOURCE_CONTENT');
    const rows = await protocol(f.cwd);
    expect(rows.filter((row) => row.method === 'tools/call').map((row) => row.params)).toEqual([
      expect.objectContaining({ name: 'image', arguments: {} }),
      expect.objectContaining({ name: 'fail', arguments: {} }),
    ]);
    expect(rows.filter((row) => row.method === 'resources/read').map((row) => row.params)).toEqual([
      expect.objectContaining({ uri: 'synthetic://resource' }),
    ]);
    const commands = f.updates.flatMap(({ update }) =>
      update.sessionUpdate === 'available_commands_update' ? update.availableCommands : []
    );
    expect(commands).toContainEqual(expect.objectContaining({ name: 'mcp' }));
    expect(commands.some((command) => command.name.includes('compose'))).toBe(false);
    expect(
      (
        await f.agent.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: '/mcp' }],
        })
      ).stopReason
    ).toBe('end_turn');
    expect(
      (
        await f.agent.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: '/mcp logout synthetic' }],
        })
      ).stopReason
    ).toBe('end_turn');
    expect(
      (
        await f.agent.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: '/mcp login synthetic' }],
        })
      ).stopReason
    ).toBe('end_turn');
    expect(f.responses).toEqual([]);
    expect((await protocol(f.cwd)).filter((row) => row.method.startsWith('prompts/'))).toEqual([]);
    await expect(readFile(join(f.agentDir, 'mcp-auth.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('sends native MCP cancellation during a codemode call and does not replay it', async () => {
    const f = await fixture({ responses: [tool('hold'), done()] });
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [server(f.cwd)] });
    const started = fileSignal(f.cwd, 'hold-started');
    const cancelled = fileSignal(f.cwd, 'cancelled');
    try {
      const running = f.agent.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Cancel in flight' }],
      });
      await started.promise;
      await f.agent.cancel({ sessionId: session.sessionId });
      await cancelled.promise;
      expect((await running).stopReason).toBe('cancelled');
      expect(
        (
          await f.agent.prompt({
            sessionId: session.sessionId,
            prompt: [{ type: 'text', text: 'Fresh prompt' }],
          })
        ).stopReason
      ).toBe('end_turn');
      const rows = await protocol(f.cwd);
      expect(rows.filter((row) => row.method === 'tools/call').map((row) => row.params)).toEqual([
        expect.objectContaining({ name: 'hold' }),
      ]);
      expect(rows).toContainEqual(expect.objectContaining({ method: 'notifications/cancelled' }));
    } finally {
      started.close();
      cancelled.close();
    }
  });

  it('responds to unsupported server form elicitation with the native method-not-found error', async () => {
    const questions: unknown[] = [];
    const request = (async (_method: string, params: unknown) => {
      questions.push(params);
      return answer(params, 'beta');
    }) as AdapterPeer['request'];
    const f = await fixture({ request, responses: [tool('form'), done()] });
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [server(f.cwd)] });
    expect(
      (
        await f.agent.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: 'Unsupported MCP form' }],
        })
      ).stopReason
    ).toBe('end_turn');
    expect(questions).toEqual([]);
    expect(JSON.parse(await readFile(join(f.cwd, 'form-response.json'), 'utf8'))).toMatchObject({
      error: { code: -32601 },
    });
    expect(f.prompts.join('\n')).toContain('SYNTHETIC_FORM_RESULT');
  });

  it('preserves explicit empty ACP selection without importing profile MCP config', async () => {
    const f = await fixture();
    const configured = server(f.cwd);
    const original = JSON.stringify({
      mcpServers: { ambient: { command: configured.command, args: configured.args } },
    });
    await writeFile(join(f.agentDir, 'mcp.json'), original);
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    await f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'No MCP selected' }],
    });
    await f.agent.dispose();
    expect(await protocol(f.cwd)).toEqual([]);
    expect(await readFile(join(f.agentDir, 'mcp.json'), 'utf8')).toBe(original);
  });

  it('gives codemode scripts no model catalog, so images need the image connection', async () => {
    const f = await fixture({
      responses: [codemode('text(typeof models); text(typeof tools);'), done()],
    });
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [server(f.cwd)] });
    await f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Inspect script globals' }],
    });
    await f.agent.dispose();
    const outputs = f.updates.flatMap(({ update }) =>
      update.sessionUpdate === 'tool_call_update' && update.status === 'completed'
        ? (update.content ?? []).flatMap((item) =>
            item.type === 'content' && item.content.type === 'text' ? [item.content.text] : []
          )
        : []
    );
    expect(outputs.join('\n')).toMatch(/undefined[\s\S]*object/);
  });

  it('applies catalog exposure natively: direct tools are declared, hidden tools are unreachable', async () => {
    const f = await fixture({
      responses: [
        fauxAssistantMessage(fauxToolCall('mcp__synthetic__image', {}), { stopReason: 'toolUse' }),
        done(),
        tool('fail'),
        done(),
      ],
    });
    await f.initialize();
    const session = await f.agent.newSession({
      cwd: f.cwd,
      mcpServers: [
        {
          ...server(f.cwd),
          _meta: {
            mollyMcpExposure: 'direct',
            mollyMcpToolExposure: [{ pattern: 'fail', exposure: 'hidden' }],
          },
        },
      ],
    });
    for (const text of ['Direct call', 'Hidden call'])
      await f.agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text }] });
    await f.agent.dispose();
    const settled = f.updates.flatMap(({ update }) =>
      update.sessionUpdate === 'tool_call_update' && update.status !== 'in_progress' ? [update] : []
    );
    expect(settled[0]).toMatchObject({
      status: 'completed',
      content: expect.arrayContaining([
        { type: 'content', content: { type: 'image', data: png, mimeType: 'image/png' } },
      ]),
    });
    expect(settled[1]?.status).toBe('failed');
    const called = (await protocol(f.cwd)).flatMap(({ method, params }) =>
      method === 'tools/call' ? [z.object({ name: z.string() }).parse(params).name] : []
    );
    expect(called).toEqual(['image']);
  });

  it('rejects a discovered duplicate adapter package before executing its extension', async () => {
    const f = await fixture();
    const pkg = join(f.root, 'duplicate');
    await mkdir(pkg);
    await writeFile(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: 'pi-mcp-adapter',
        version: '3.3.0',
        pi: { extensions: ['./index.js'] },
      })
    );
    const execution = join(f.cwd, 'duplicate-executed.json');
    await writeFile(
      join(pkg, 'index.js'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(execution)}, '{}'); export default function() { throw new Error('DUPLICATE_WAS_EXECUTED'); }`
    );
    await writeFile(
      join(f.agentDir, 'settings.json'),
      JSON.stringify({
        packages: [pkg],
        retry: { enabled: false },
        compaction: { enabled: false },
      })
    );
    await f.initialize();
    await expect(f.agent.newSession({ cwd: f.cwd, mcpServers: [] })).rejects.toThrow(
      'pi_acp_session_setup_failed'
    );
    await f.agent.dispose();
    expect(await protocol(f.cwd)).toEqual([]);
    await expect(readFile(execution)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.prompts).toEqual([]);
  });

  it('accepts a native directory package without a package manifest', async () => {
    const f = await fixture();
    const pkg = join(f.root, 'ordinary');
    await mkdir(pkg);
    const execution = join(f.cwd, 'ordinary-executed.json');
    await writeFile(
      join(pkg, 'index.ts'),
      `import { writeFileSync } from 'node:fs'; export default function(pi) { pi.registerCommand('ordinary', {description: 'Synthetic ordinary package', handler: async () => { writeFileSync(${JSON.stringify(execution)}, '{}'); }}); }`
    );
    await writeFile(
      join(f.agentDir, 'settings.json'),
      JSON.stringify({
        packages: [pkg],
        retry: { enabled: false },
        compaction: { enabled: false },
      })
    );
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    expect(
      (
        await f.agent.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: '/ordinary' }],
        })
      ).stopReason
    ).toBe('end_turn');
    expect(JSON.parse(await readFile(execution, 'utf8'))).toEqual({});
    expect(f.prompts).toEqual([]);
  });

  it('closes the native MCP child after an earlier session shutdown hook fails', async () => {
    const f = await fixture({
      responses: [tool('image'), done()],
      extensions: [
        {
          name: 'shutdown-failure',
          factory: (pi) => {
            pi.on('session_shutdown', async () => {
              throw new Error('SYNTHETIC_SHUTDOWN_FAILURE');
            });
          },
        },
      ],
    });
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [server(f.cwd)] });
    await f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Start native MCP child' }],
    });
    const exited = fileSignal(f.cwd, 'exited');
    try {
      await expect(f.agent.dispose()).rejects.toThrow('pi_acp_cleanup_failed');
      expect(await exited.promise).toEqual({ code: 0 });
      await expect(f.agent.newSession({ cwd: f.cwd, mcpServers: [] })).rejects.toMatchObject({
        code: -32600,
      });
    } finally {
      exited.close();
    }
  });

  it('converts ACP servers to native configs while keeping argv, URLs, env and headers literal', () => {
    const selected = server('/synthetic');
    selected.args.push('${HOME}');
    selected.env.push({ name: 'DOLLAR', value: '${HOME}$' }, { name: 'BANG', value: '!literal' });
    const config = acpMcpConfig(
      [
        selected,
        {
          name: 'http',
          type: 'http',
          url: 'https://synthetic.invalid/${HOME}',
          headers: [
            { name: 'Authorization', value: '!literal$' },
            { name: 'X-Literal', value: '${HOME}' },
          ],
          _meta: {
            mollyMcpDescription: '  Synthetic catalog summary  ',
            mollyMcpExposure: 'deferred',
            mollyMcpToolExposure: [
              { pattern: 'delete_*', exposure: 'hidden' },
              { pattern: '*', exposure: 'direct' },
            ],
          },
        },
      ],
      '/synthetic/project'
    );
    const expected = [...selected.args];
    selected.args.push('changed-after-dispatch');
    expect(config).toEqual([
      {
        name: 'synthetic',
        config: {
          command: process.execPath,
          args: expected,
          cwd: '/synthetic/project',
          env: { DOLLAR: '$${HOME}$$', BANG: '$!literal' },
        },
      },
      {
        name: 'http',
        config: {
          description: 'Synthetic catalog summary',
          exposure: 'deferred',
          toolExposure: { 'delete_*': 'hidden', '*': 'direct' },
          type: 'http',
          url: 'https://synthetic.invalid/${HOME}',
          headers: { Authorization: '$!literal$$', 'X-Literal': '$${HOME}' },
        },
      },
    ]);
    expect(() => acpMcpConfig([server('/synthetic'), server('/synthetic')], '/synthetic')).toThrow(
      'pi_acp_mcp_server_identity'
    );
    expect(() =>
      acpMcpConfig([{ ...server('/synthetic'), _meta: { mollyMcpCredential: {} } }], '/synthetic')
    ).toThrow('pi_acp_protected_mcp_not_integrated');
    expect(() =>
      acpMcpConfig([{ ...server('/synthetic'), _meta: { mollyMcpDescription: 1 } }], '/synthetic')
    ).toThrow('pi_acp_mcp_description_invalid');
    for (const _meta of [
      { mollyMcpExposure: 'codemode-deferred' },
      { mollyMcpToolExposure: [{ pattern: 'search', exposure: 'visible' }] },
      { mollyMcpToolExposure: [{ pattern: ' padded', exposure: 'direct' }] },
      { mollyMcpToolExposure: { search: 'direct' } },
      {
        mollyMcpToolExposure: [
          { pattern: 'search', exposure: 'direct' },
          { pattern: 'search', exposure: 'hidden' },
        ],
      },
    ])
      expect(() => acpMcpConfig([{ ...server('/synthetic'), _meta }], '/synthetic')).toThrow(
        'pi_acp_mcp_exposure_invalid'
      );
    expect(() =>
      acpMcpConfig(
        [{ name: 'sse', type: 'sse', url: 'https://synthetic.invalid/sse', headers: [] }],
        '/synthetic'
      )
    ).toThrow('pi_acp_mcp_transport_unsupported');
    expect(() => acpMcpConfig([{ ...server('/synthetic'), type: 'acp' }], '/synthetic')).toThrow(
      'pi_acp_mcp_transport_unsupported'
    );
  });

  it.each(['~', '~/different'])('refuses native home expansion for ACP path %s', (value) => {
    expect(() => acpMcpConfig([{ ...server('/synthetic'), command: value }], '/synthetic')).toThrow(
      'pi_acp_mcp_literal_target_unsupported'
    );
    expect(() => acpMcpConfig([{ ...server('/synthetic'), args: [value] }], '/synthetic')).toThrow(
      'pi_acp_mcp_literal_target_unsupported'
    );
    expect(() => acpMcpConfig([server('/synthetic')], value)).toThrow(
      'pi_acp_mcp_literal_target_unsupported'
    );
  });
});
