import { watch } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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
