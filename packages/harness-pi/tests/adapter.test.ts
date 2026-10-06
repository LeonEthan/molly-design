import { mkdir, readFile, writeFile, symlink, appendFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fixture, deferred } from './fixtures/adapter';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  SendRequestOptions,
} from '@agentclientprotocol/sdk';
import { z } from 'zod';
import { prepareProfile } from '../src/profile';
import { createWorkerEnvironment } from '../src/environment';
import type { AdapterPeer } from '../src/session';
import { acpPromptToPiMessage } from '../src/translate/prompt';
import { formatToolContent } from '../src/translate/tool-content';

describe('owned native Pi ACP adapter', () => {
  it('refuses native resource loading when the process profile differs from the adapter profile', async () => {
    const f = await fixture();
    await f.initialize();
    vi.stubEnv('PI_CODING_AGENT_DIR', join(f.root, 'other-profile'));
    await expect(f.agent.newSession({ cwd: f.cwd, mcpServers: [] })).rejects.toThrow(
      'pi_acp_session_setup_failed'
    );
    expect(f.prompts).toEqual([]);
    await expect(readFile(join(f.agentDir, 'sessions'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('retires a startup GUI dialog on disconnect before releasing the native writer', async () => {
    const opened = deferred<void>();
    const cancelled = deferred<void>();
    const late = deferred<CreateElicitationResponse>();
    const request = (async (_method: string, _params: unknown, options?: SendRequestOptions) => {
      options?.cancellationSignal?.addEventListener('abort', () => cancelled.resolve());
      opened.resolve();
      return late.promise;
    }) as AdapterPeer['request'];
    const f = await fixture({
      request,
      extensions: [
        (pi) => {
          pi.on('session_start', async (_event, context) => {
            await context.ui.select('Startup question', ['Continue']);
          });
        },
      ],
    });
    await f.initialize();
    const creating = f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    const refused = expect(creating).rejects.toThrow('pi_acp_session_setup_failed');
    await opened.promise;
    const closing = f.agent.dispose();
    await cancelled.promise;
    await refused;
    await closing;
    late.resolve({ action: 'accept', content: { unused: 'Continue' } });
    expect(f.prompts).toEqual([]);
    const successor = f.makeAgent();
    await successor.initialize({ protocolVersion: 1 });
    const listing = await successor.listSessions({ cwd: f.cwd });
    expect(listing.sessions).toHaveLength(1);
    await successor.loadSession({
      cwd: f.cwd,
      mcpServers: [],
      sessionId: listing.sessions[0]!.sessionId,
    });
  });

  it('uses native history and reopens the same ID without invoking a model', async () => {
    const f = await fixture();
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    const first = await f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Hello' }],
    });
    expect(first.stopReason).toBe('end_turn');
    expect(first._meta?.piAcp).toMatchObject({
      execution: 'inference',
      usage: { scope: 'native-session', cost: null },
    });
    const listed = await f.agent.listSessions({ cwd: f.cwd });
    expect(listed.sessions.map((entry) => entry.sessionId)).toEqual([session.sessionId]);
    await f.agent.dispose();
    const restored = f.makeAgent();
    await restored.initialize({ protocolVersion: 1 });
    f.updates.length = 0;
    const loaded = await restored.loadSession({
      sessionId: session.sessionId,
      cwd: f.cwd,
      mcpServers: [],
    });
    expect(loaded.configOptions).toEqual(session.configOptions);
    expect(f.updates).toContainEqual(
      expect.objectContaining({
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Synthetic answer.' },
        },
      })
    );
    expect(f.prompts).toHaveLength(1);
    expect(await readFile(join(f.agentDir, 'settings.json'), 'utf8')).not.toContain(
      'synthetic-only'
    );
  });

  it('loads an ordinary native package, hooks, skills and commands without a custom resource loader', async () => {
    const f = await fixture({
      responses: [
        fauxAssistantMessage(fauxToolCall('package_tool', {}), { stopReason: 'toolUse' }),
        fauxAssistantMessage('Done'),
      ],
    });
    const pkg = join(f.root, 'ordinary-package');
    await mkdir(join(pkg, 'skills', 'demo'), { recursive: true });
    await mkdir(join(pkg, 'prompts'));
    await writeFile(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: 'synthetic-native-package',
        version: '1.0.0',
        pi: { extensions: ['./extension.js'], skills: ['./skills'], prompts: ['./prompts'] },
      })
    );
    await writeFile(
      join(pkg, 'extension.js'),
      `export default function(pi) {
      let started = false;
      pi.on('session_start', () => { started = true; });
      pi.on('before_agent_start', (event) => ({ systemPrompt: event.systemPrompt + '\\nNATIVE_PACKAGE_HOOK' }));
      pi.registerCommand('package-command', { description: 'Native command', handler: async (_args, ctx) => { ctx.ui.notify('COMMAND_HANDLED'); } });
      pi.registerTool({ name: 'package_tool', label: 'Package tool', description: 'Synthetic tool', parameters: { type: 'object', properties: {} }, execute: async () => ({ content: [{ type: 'text', text: started ? 'STARTUP_BOUND' : 'NOT_BOUND' }], details: {} }) });
    }`
    );
    await writeFile(
      join(pkg, 'skills', 'demo', 'SKILL.md'),
      '---\nname: demo\ndescription: Native skill marker\n---\nNATIVE_SKILL'
    );
    await writeFile(
      join(pkg, 'prompts', 'demo.md'),
      '---\ndescription: Native template marker\n---\nNATIVE_TEMPLATE $1'
    );
    await writeFile(
      join(f.agentDir, 'settings.json'),
      JSON.stringify({
        packages: [pkg],
        enableSkillCommands: true,
        retry: { enabled: false },
        compaction: { enabled: false },
      })
    );
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    expect(f.updates).toContainEqual(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: 'available_commands_update',
          availableCommands: expect.arrayContaining([
            { name: 'package-command', description: 'Native command' },
            { name: 'skill:demo', description: 'Native skill marker' },
          ]),
        }),
      })
    );
    await f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: '/demo argument' }],
    });
    expect(f.prompts[0]).toContain('NATIVE_TEMPLATE argument');
    expect(f.prompts[0]).toContain('NATIVE_PACKAGE_HOOK');
    expect(f.updates).toContainEqual(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: 'tool_call_update',
          status: 'completed',
          rawOutput: expect.objectContaining({
            content: [{ type: 'text', text: 'STARTUP_BOUND' }],
          }),
        }),
      })
    );
  });

  it('distinguishes a handled extension command from inference and binds non-TUI question UI', async () => {
    const requests: CreateElicitationRequest[] = [];
    const request = (async (_method: string, params: unknown) => {
      const question = params as CreateElicitationRequest;
      requests.push(question);
      if (question.mode !== 'form') throw new Error('Unexpected mode');
      const schema = z
        .object({ properties: z.record(z.string(), z.unknown()) })
        .parse(question.requestedSchema);
      const key = Object.keys(schema.properties)[0]!;
      return {
        action: 'accept',
        content: { [key]: requests.length === 1 ? 'Wide' : 'Draft text' },
      } satisfies CreateElicitationResponse;
    }) as AdapterPeer['request'];
    const f = await fixture({
      request,
      extensions: [
        (pi) => {
          pi.registerCommand('choose', {
            description: 'Choose layout',
            handler: async (_args, ctx) => {
              expect(ctx.hasUI).toBe(true);
              const choice = await ctx.ui.select('Layout?', ['Wide', 'Tall']);
              const text = await ctx.ui.editor('Text', 'Initial');
              ctx.ui.notify(`${choice}: ${text}`);
            },
          });
        },
      ],
    });
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    const result = await f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: '/choose' }],
    });
    expect(result._meta?.piAcp).toMatchObject({ execution: 'handled' });
    expect(f.prompts).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(f.updates).toContainEqual(
      expect.objectContaining({
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Wide: Draft text' },
        },
      })
    );
  });

  it('keeps native binary image reads and preserves image tool content in ACP', async () => {
    const f = await fixture({
      responses: [
        fauxAssistantMessage(fauxToolCall('read', { path: 'image.png' }), {
          stopReason: 'toolUse',
        }),
        fauxAssistantMessage('Image observed'),
      ],
    });
    const data =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    await writeFile(join(f.cwd, 'image.png'), Buffer.from(data, 'base64'));
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    await f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [
        { type: 'text', text: 'Read image.png' },
        { type: 'image', mimeType: 'image/png', data },
      ],
    });
    expect(f.prompts[0]).toContain(data);
    expect(f.prompts[1]).toContain('image/png');
    expect(f.updates).toContainEqual(
      expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: 'tool_call_update',
          status: 'completed',
          content: expect.arrayContaining([
            {
              type: 'content',
              content: expect.objectContaining({
                type: 'image',
                mimeType: 'image/png',
                data: expect.any(String),
              }),
            },
          ]),
        }),
      })
    );
  });

  it('waits for native follow-up work after agent_end and cancels queued input', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const f = await fixture({
      responses: [
        fauxAssistantMessage(fauxToolCall('pause', {}), { stopReason: 'toolUse' }),
        fauxAssistantMessage('First ended'),
        fauxAssistantMessage('Follow-up ended'),
      ],
      extensions: [
        (pi) => {
          pi.registerTool({
            name: 'pause',
            label: 'Pause',
            description: 'Explicit test signal',
            parameters: { type: 'object', properties: {} },
            execute: async () => {
              entered.resolve();
              await release.promise;
              return { content: [{ type: 'text', text: 'Released' }], details: {} };
            },
          });
        },
      ],
    });
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    const running = f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Start' }],
    });
    await entered.promise;
    await expect(
      f.agent.setSessionConfigOption({
        sessionId: session.sessionId,
        configId: 'model',
        value: 'synthetic/model',
      })
    ).rejects.toThrow();
    expect(
      await f.agent.extMethod('_pi/follow_up', {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Then follow up' }],
      })
    ).toEqual({ disposition: 'queued' });
    release.resolve();
    expect((await running).stopReason).toBe('end_turn');
    expect(f.updates).toContainEqual(
      expect.objectContaining({
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Follow-up ended' },
        },
      })
    );
    expect(f.prompts.at(-1)).toContain('Then follow up');
  });

  it('cancels a pending question, clears native queued work and ignores late answers', async () => {
    const opened = deferred<void>();
    const late = deferred<CreateElicitationResponse>();
    const cancelled = deferred<void>();
    let answer: string | undefined = 'not-yet-returned';
    const request = (async (_method: string, _params: unknown, options?: SendRequestOptions) => {
      options?.cancellationSignal?.addEventListener('abort', () => cancelled.resolve(), {
        once: true,
      });
      opened.resolve();
      return late.promise;
    }) as AdapterPeer['request'];
    const f = await fixture({
      request,
      extensions: [
        (pi) => {
          pi.registerCommand('ask', {
            description: 'Ask',
            handler: async (_args, ctx) => {
              answer = await ctx.ui.select('Approve?', ['Yes', 'No']);
            },
          });
        },
      ],
    });
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    const running = f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: '/ask' }],
    });
    await opened.promise;
    await f.agent.cancel({ sessionId: session.sessionId });
    await cancelled.promise;
    expect((await running).stopReason).toBe('cancelled');
    expect(answer).toBeUndefined();
    late.resolve({ action: 'accept', content: { unused: 'Yes' } });
    expect(
      (
        await f.agent.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: 'A new prompt' }],
        })
      ).stopReason
    ).toBe('end_turn');
    expect(f.prompts).toHaveLength(1);
  });

  it('fails extension errors and refuses unintegrated protected MCP credentials', async () => {
    const f = await fixture({
      extensions: [
        (pi) => {
          pi.on('before_agent_start', () => {
            throw new Error('Synthetic extension failure');
          });
        },
      ],
    });
    const capabilities = await f.initialize();
    expect(capabilities.agentCapabilities?.mcpCapabilities).toEqual({ http: true });
    await expect(
      f.agent.newSession({
        cwd: f.cwd,
        mcpServers: [
          {
            name: 'protected',
            command: 'unused',
            args: [],
            env: [],
            _meta: { mollyMcpCredential: {} },
          },
        ],
      })
    ).rejects.toMatchObject({ code: -32602 });
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    await expect(
      f.agent.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Trigger error' }],
      })
    ).rejects.toThrow('pi_acp_extension_failed');
    expect(f.prompts).toEqual([]);
  });

  it('retains corrupt history and rejects profile symlinks into the local CLI directory', async () => {
    const f = await fixture();
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    const { sessionDirectory } = await import('../src/profile');
    const { SessionManager } = await import('@earendil-works/pi-coding-agent');
    const directory = await sessionDirectory(f.agentDir);
    const native = (await SessionManager.list(f.cwd, directory)).find(
      (entry) => entry.id === session.sessionId
    )!;
    await appendFile(native.path, '{broken\n');
    const corrupt = await readFile(native.path, 'utf8');
    await f.agent.dispose();
    const restored = f.makeAgent();
    await restored.initialize({ protocolVersion: 1 });
    await expect(
      restored.loadSession({ sessionId: session.sessionId, cwd: f.cwd, mcpServers: [] })
    ).rejects.toThrow();
    expect(await readFile(native.path, 'utf8')).toBe(corrupt);
    await expect(prepareProfile(join(homedir(), '.pi', 'agent'))).rejects.toThrow(
      'pi_acp_cli_profile_refused'
    );
    await symlink(homedir(), join(f.root, 'home-link'));
    await expect(prepareProfile(join(f.root, 'home-link', '.pi', 'agent'))).rejects.toThrow(
      'pi_acp_cli_profile_refused'
    );
  });

  it('refuses a second writer and permits reopening after the owner closes', async () => {
    const f = await fixture();
    await f.initialize();
    const first = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    const second = f.makeAgent();
    await second.initialize({ protocolVersion: 1 });
    await expect(
      second.loadSession({ sessionId: first.sessionId, cwd: f.cwd, mcpServers: [] })
    ).rejects.toThrow('pi_acp_session_setup_failed');
    await f.agent.dispose();
    const loaded = await second.loadSession({
      sessionId: first.sessionId,
      cwd: f.cwd,
      mcpServers: [],
    });
    expect(loaded.configOptions).toEqual(first.configOptions);
    expect(f.prompts).toEqual([]);
  });

  it('clears a queued native follow-up when cancelling an in-flight tool', async () => {
    const entered = deferred<void>();
    const f = await fixture({
      responses: [fauxAssistantMessage(fauxToolCall('pause', {}), { stopReason: 'toolUse' })],
      extensions: [
        (pi) => {
          pi.registerTool({
            name: 'pause',
            label: 'Pause',
            description: 'Wait for abort',
            parameters: { type: 'object', properties: {} },
            execute: async (_id, _params, signal) => {
              await new Promise<void>((resolve) => {
                signal?.addEventListener('abort', () => resolve(), { once: true });
                entered.resolve();
              });
              return { content: [{ type: 'text', text: 'Stopped' }], details: {} };
            },
          });
        },
      ],
    });
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    const running = f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Start' }],
    });
    await entered.promise;
    await f.agent.extMethod('_pi/follow_up', {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Must not run' }],
    });
    await f.agent.cancel({ sessionId: session.sessionId });
    expect((await running).stopReason).toBe('cancelled');
    expect(f.prompts).toHaveLength(1);
    expect(f.updates).not.toContainEqual(
      expect.objectContaining({
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Must not run' },
        },
      })
    );
  });

  it('preserves real HOME and strips inherited credentials without changing the caller', () => {
    const inherited: NodeJS.ProcessEnv = {
      HOME: '/real-home',
      PATH: '/bin',
      OPENAI_API_KEY: 'do-not-inherit',
      PI_CODING_AGENT_DIR: '/cli-profile',
      PI_CODING_AGENT_SESSION_DIR: '/cli-sessions',
    };
    const config = { privateRoot: '/molly-private', runtimeEpoch: 'worker-one' };
    const environment = createWorkerEnvironment(inherited, config);
    expect(environment).toMatchObject({
      HOME: '/real-home',
      CC_SAFETY_NET_PROJECT_TIGHTEN_ONLY: '1',
    });
    expect(dirname(environment.PI_CODING_AGENT_DIR!)).toBe(
      join(config.privateRoot, 'config', 'workers')
    );
    expect(basename(environment.PI_CODING_AGENT_DIR!)).toMatch(/^[a-f0-9]{64}$/);
    expect(createWorkerEnvironment({}, config).PI_CODING_AGENT_DIR).toBe(
      environment.PI_CODING_AGENT_DIR
    );
    expect(
      createWorkerEnvironment({}, { ...config, runtimeEpoch: 'worker-two' }).PI_CODING_AGENT_DIR
    ).not.toBe(environment.PI_CODING_AGENT_DIR);
    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(environment.PI_CODING_AGENT_SESSION_DIR).toBeUndefined();
    expect(inherited.PI_CODING_AGENT_DIR).toBe('/cli-profile');
  });

  it('cancels during native prompt preparation before any model execution and waits for preparation to retire', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let blocked = true;
    const f = await fixture({
      extensions: [
        (pi) => {
          pi.on('before_agent_start', async () => {
            if (!blocked) return;
            entered.resolve();
            await release.promise;
          });
        },
      ],
    });
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    const running = f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Will be cancelled' }],
    });
    await entered.promise;
    const cancelling = f.agent.cancel({ sessionId: session.sessionId });
    await expect(
      f.agent.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Cannot overlap preparation' }],
      })
    ).rejects.toThrow();
    blocked = false;
    release.resolve();
    await cancelling;
    expect((await running).stopReason).toBe('cancelled');
    expect(f.prompts).toEqual([]);
    expect(
      (
        await f.agent.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: 'text', text: 'An explicit new prompt' }],
        })
      ).stopReason
    ).toBe('end_turn');
  });

  it('holds writer ownership through an accepted model mutation during disconnect', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const f = await fixture();
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    const runtime = f.runtime();
    const check = runtime.checkAuth.bind(runtime);
    vi.spyOn(runtime, 'checkAuth').mockImplementation(async (provider, options) => {
      entered.resolve();
      await release.promise;
      return check(provider, options);
    });
    const mutation = f.agent.setSessionConfigOption({
      sessionId: session.sessionId,
      configId: 'model',
      value: 'synthetic/model',
    });
    await entered.promise;
    const closing = f.agent.dispose();
    const next = f.makeAgent();
    await next.initialize({ protocolVersion: 1 });
    await expect(
      next.loadSession({ sessionId: session.sessionId, cwd: f.cwd, mcpServers: [] })
    ).rejects.toThrow();
    release.resolve();
    await mutation;
    await closing;
    expect(
      (await next.loadSession({ sessionId: session.sessionId, cwd: f.cwd, mcpServers: [] }))
        .configOptions
    ).toEqual(session.configOptions);
  });

  it('acquires ownership before reading history across a writer handoff', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let blockSetup = false;
    const f = await fixture({
      beforeRuntime: async () => {
        if (!blockSetup) return;
        entered.resolve();
        await release.promise;
      },
    });
    await f.initialize();
    const session = await f.agent.newSession({ cwd: f.cwd, mcpServers: [] });
    await f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'First turn' }],
    });
    const next = f.makeAgent();
    await next.initialize({ protocolVersion: 1 });
    blockSetup = true;
    const restore = next.loadSession({ sessionId: session.sessionId, cwd: f.cwd, mcpServers: [] });
    const result = restore.then(
      () => 'loaded',
      () => 'refused'
    );
    const boundary = await Promise.race([entered.promise.then(() => 'runtime-entered'), result]);
    f.responses.push(fauxAssistantMessage('Latest completed turn'));
    await f.agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Latest turn' }],
    });
    await f.agent.dispose();
    blockSetup = false;
    release.resolve();
    await result;
    f.updates.length = 0;
    if (boundary === 'refused')
      await next.loadSession({ sessionId: session.sessionId, cwd: f.cwd, mcpServers: [] });
    expect(boundary).toBe('refused');
    expect(f.updates).toContainEqual(
      expect.objectContaining({
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Latest completed turn' },
        },
      })
    );
  });

  it('preserves embedded images and rejects unsupported binary or audio content', () => {
    expect(
      acpPromptToPiMessage([
        {
          type: 'resource',
          resource: { uri: 'file:///image.png', mimeType: 'image/png', blob: 'aW1hZ2U=' },
        },
      ]).images
    ).toEqual([{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }]);
    expect(() =>
      acpPromptToPiMessage([{ type: 'audio', mimeType: 'audio/wav', data: 'AA==' }])
    ).toThrow('pi_acp_audio_unsupported');
    expect(
      formatToolContent(
        'image_tool',
        {
          content: [{ type: 'image', mimeType: 'image/png', data: 'AA==' }],
          details: { structured: true },
        },
        true
      )
    ).toContainEqual({
      type: 'content',
      content: { type: 'image', mimeType: 'image/png', data: 'AA==' },
    });
  });

  it('passes a host attachment as a local path for native tools', () => {
    const { message } = acpPromptToPiMessage([
      { type: 'text', text: 'See file' },
      {
        type: 'resource_link',
        uri: pathToFileURL('/work/.molly/attachments/brief.pdf').href,
        name: 'brief.pdf',
        mimeType: 'application/pdf',
        size: 3,
      },
    ]);
    expect(message).toContain('"path":"/work/.molly/attachments/brief.pdf"');
  });
});
