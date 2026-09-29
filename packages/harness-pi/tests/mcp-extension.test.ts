import { registerSyntheticModels } from './fixtures/synthetic-models';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
  type AssistantMessage,
} from '@earendil-works/pi-ai';
import { createReadToolDefinition, defineTool } from '@earendil-works/pi-coding-agent';
import { createMollySession, type CreateMollySessionInput } from '../src/session-factory';
import { createMcpConfig, createMollyMcpExtension } from '../src/mcp-extension';
import { createExtensionUI } from '../src/extension-ui';
import type { ToolApproval } from '../src/approved-tools';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
registerSyntheticModels();
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const toolMessage = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: 'toolUse', timestamp: 1 });
const done = () => fauxAssistantMessage('Done', { timestamp: 2 });
async function fixture(approve: ToolApproval = async () => true, launchFromPath = false) {
  const root = await mkdtemp(join(tmpdir(), 'molly-standard-mcp-'));
  roots.push(root);
  const cwd = join(root, 'workspace');
  await mkdir(cwd);
  let command = process.execPath;
  if (launchFromPath) {
    const bin = join(root, 'bin');
    await mkdir(bin);
    command = process.platform === 'win32' ? 'molly-mcp-test.exe' : 'molly-mcp-test';
    if (process.platform === 'win32') await copyFile(process.execPath, join(bin, command));
    else await symlink(process.execPath, join(bin, command));
    vi.stubEnv('PATH', bin);
    vi.stubEnv('HOME', root);
    vi.stubEnv('LANG', 'en_US.UTF-8');
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-parent-model-secret');
    vi.stubEnv('MOLLY_CONTROL_TOKEN', 'synthetic-parent-control-secret');
  }
  vi.stubEnv('PI_CODING_AGENT_DIR', join(root, 'agent'));
  const ui = createExtensionUI({
    currentSignal: () => undefined,
    open: async () => {
      throw new Error('unexpected question');
    },
    dismiss: () => {},
    notify: () => {},
  });
  const input: CreateMollySessionInput = {
    cwd,
    privateRoot: join(root, 'private'),
    productSessionId: 'synthetic',
    connection: {
      schemaVersion: 1,
      id: 'test',
      revision: 1,
      providerPresetId: 'openai',
      displayName: 'test',
      baseUrl: 'https://example.invalid/v1',
      credentialRef: 'test',
      enabled: true,
    },
    selection: { connectionId: 'test', modelId: 'gpt-4o', thinking: 'off' },
    apiKey: 'synthetic',
    tools: [defineTool(createReadToolDefinition(cwd))],
    systemPrompt: 'Synthetic test',
    questionUI: ui.ui,
    extensions: [
      createMollyMcpExtension(
        createMcpConfig(
          [
            {
              name: 'images',
              command,
              args: [
                fileURLToPath(new URL('./fixtures/standard-mcp.mjs', import.meta.url)),
                cwd,
                ...(launchFromPath ? ['probe-environment'] : []),
              ],
              env: [],
            },
          ],
          cwd
        ),
        approve
      ),
    ],
  };
  const protocol = async () =>
    (await readFile(join(cwd, 'protocol.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return { input, protocol, cwd };
}
async function session(input: CreateMollySessionInput, responses: AssistantMessage[]) {
  const owned = await createMollySession(input);
  const messages: unknown[] = [];
  owned.runtime.registerProvider('openai', {
    api: owned.session.model!.api,
    streamSimple: (_model, context) => {
      messages.push(context.messages);
      const message = responses.shift();
      if (!message) throw new Error('unexpected model dispatch');
      const stream = createAssistantMessageEventStream();
      if (
        message.stopReason === 'stop' ||
        message.stopReason === 'toolUse' ||
        message.stopReason === 'length'
      )
        stream.push({ type: 'done', reason: message.stopReason, message });
      else throw new Error('unexpected synthetic outcome');
      stream.end();
      return stream;
    },
  });
  return {
    ...owned,
    messages,
    close: async () => {
      await owned.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      owned.session.dispose();
    },
  };
}
it('generates a file, reads its pixels, preserves native history and reuses MCP across turns', async () => {
  const approvals: string[] = [];
  const f = await fixture(async (request) => {
    approvals.push(request.name);
    return true;
  });
  const owned = await session(f.input, [
    toolMessage('mcp', { tool: 'images_generate', args: { prompt: 'synthetic' } }),
    toolMessage('read', { path: 'image.png' }),
    done(),
    toolMessage('mcp', { tool: 'images_fail', args: {} }),
    done(),
  ]);
  let nativeSessionFile: string | undefined;
  try {
    await owned.session.prompt('Generate');
    await owned.session.prompt('Fail');
    expect(owned.hasExtensionFailure()).toBe(false);
    expect(approvals).toEqual(['images/generate', 'images/fail']);
    expect((await readFile(join(f.cwd, 'image.png'))).subarray(1, 4).toString()).toBe('PNG');
    expect(JSON.stringify(owned.messages)).toContain('synthetic service rejected request');
    expect(JSON.stringify(owned.messages)).toContain('image/png');
    const protocol = await f.protocol();
    expect(protocol.filter((row) => row.method === 'initialize')).toHaveLength(1);
    expect(protocol.filter((row) => row.method === 'tools/call').map((row) => row.params)).toEqual([
      expect.objectContaining({ name: 'generate', arguments: { prompt: 'synthetic' } }),
      expect.objectContaining({ name: 'fail', arguments: {} }),
    ]);
    expect(JSON.stringify(protocol)).not.toContain('molly/inline-image-result');
    nativeSessionFile = owned.manager.getSessionFile();
  } finally {
    await owned.close();
  }
  const restored = await session({ ...f.input, nativeSessionFile }, [done()]);
  try {
    await restored.session.prompt('Continue without repeating generation');
    expect(JSON.stringify(restored.messages)).toContain('synthetic service rejected request');
    expect(
      (await f.protocol())
        .filter((row) => row.method === 'tools/call')
        .map((row) => row.params.name)
    ).toEqual(['generate', 'fail']);
  } finally {
    await restored.close();
  }
});
it('denies an MCP call through the public approval event without contacting the tool', async () => {
  const f = await fixture(async () => false);
  const owned = await session(f.input, [
    toolMessage('mcp', { tool: 'images_generate', args: { prompt: 'synthetic' } }),
    done(),
  ]);
  try {
    await owned.session.prompt('Generate');
    expect((await f.protocol()).filter((row) => row.method === 'tools/call')).toEqual([]);
    await expect(readFile(join(f.cwd, 'image.png'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.stringify(owned.messages)).toMatch(/denied/i);
  } finally {
    await owned.close();
  }
});
it('cancels while MCP approval is pending and ignores a late approval', async () => {
  const ready = deferred<void>();
  const decision = deferred<boolean>();
  const f = await fixture(async () => {
    ready.resolve();
    return decision.promise;
  });
  const responses = [
    toolMessage('mcp', { tool: 'images_generate', args: { prompt: 'synthetic' } }),
    done(),
  ];
  const owned = await session(f.input, responses);
  try {
    const pending = owned.session.prompt('Generate');
    await ready.promise;
    await owned.session.abort();
    await pending;
    decision.resolve(true);
    expect(responses).toHaveLength(1);
    expect((await f.protocol()).filter((row) => row.method === 'tools/call')).toEqual([]);
    await expect(readFile(join(f.cwd, 'image.png'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    decision.resolve(false);
    await owned.close();
  }
});
it('uses the stock scripting worker and its per-call approval event', async () => {
  const approvals: string[] = [];
  const f = await fixture(async (request) => {
    approvals.push(request.name);
    return true;
  });
  const owned = await session(f.input, [
    toolMessage('mcpScript', {
      code: 'emit(await tools.images_generate({prompt:"synthetic script"}));',
    }),
    done(),
  ]);
  try {
    await owned.session.prompt('Generate through script');
    expect(approvals).toEqual(['images/generate']);
    expect((await readFile(join(f.cwd, 'image.png'))).subarray(1, 4).toString()).toBe('PNG');
  } finally {
    await owned.close();
  }
});

it('launches a bare stdio command using the sanitized environment without parent secrets', async () => {
  const f = await fixture(undefined, true);
  const owned = await session(f.input, [
    toolMessage('mcp', { tool: 'images_generate', args: { prompt: 'synthetic PATH' } }),
    done(),
  ]);
  try {
    await owned.session.prompt('Generate using the PATH-only server');
    expect((await readFile(join(f.cwd, 'image.png'))).subarray(1, 4).toString()).toBe('PNG');
    expect(JSON.parse(await readFile(join(f.cwd, 'environment.json'), 'utf8'))).toEqual({
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: 'en_US.UTF-8',
      ELECTRON_RUN_AS_NODE: '1',
    });
  } finally {
    await owned.close();
  }
});

it('overlays server settings and selected credentials without inheriting runtime injection', () => {
  vi.stubEnv('PATH', '/synthetic/bin');
  vi.stubEnv('HOME', '/synthetic/home');
  vi.stubEnv('NODE_OPTIONS', '--import=synthetic-unapproved');
  vi.stubEnv('HTTP_PROXY', 'http://synthetic.invalid');
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-model-secret');
  const connection = {
    workspaceId: 'synthetic-workspace',
    serverId: 'protected',
    credentialRef: 'bcd3f6ea-fc62-410a-8b26-c914009fd4cf',
    revision: 1,
    destination: { transport: 'stdio' as const, command: 'npx', args: ['synthetic-server'] },
    fieldNames: ['MCP_API_KEY'],
  };
  const config = createMcpConfig(
    [
      {
        name: 'protected',
        command: 'npx',
        args: ['synthetic-server'],
        env: [
          { name: 'HOME', value: '/synthetic/server-home' },
          { name: 'MCP_API_KEY', value: 'overridden-server-value' },
          { name: 'LITERAL_VALUE', value: '${HOME}' },
        ],
        _meta: { mollyMcpCredential: connection },
      },
    ],
    '/synthetic/workspace',
    [{ connection, values: { MCP_API_KEY: 'synthetic-selected-secret' } }]
  );
  const server = config.mcpServers.protected!;
  expect(server).toMatchObject({ inheritEnv: false, literalEnv: true });
  expect(server.env).toMatchObject({
    PATH: '/synthetic/bin',
    HOME: '/synthetic/server-home',
    MCP_API_KEY: 'synthetic-selected-secret',
    LITERAL_VALUE: '${HOME}',
  });
  for (const key of ['NODE_OPTIONS', 'HTTP_PROXY', 'OPENAI_API_KEY', 'PI_CODING_AGENT_DIR'])
    expect(server.env).not.toHaveProperty(key);
});
