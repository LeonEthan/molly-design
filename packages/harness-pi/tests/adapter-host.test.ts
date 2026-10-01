import { PassThrough } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ModelRuntime, type InlineExtension } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, fauxAssistantMessage } from '@earendil-works/pi-ai';
import type { CreateElicitationRequest, CreateElicitationResponse } from '@agentclientprotocol/sdk';
import { parseAskUserQuestionElicitationRequest } from '@molly/shared';
import {
  HarnessSessionBindingSchema,
  HarnessQuestionIdentitySchema,
  MOLLY_PROVIDER_IDS,
  PI_ENGINE_VERSION,
  type HarnessRunSnapshot,
  type McpCredentialBinding,
} from '@molly/shared/embedded-harness';
import { PiAcpHost } from '../src/host';
import { PiAcpAgent } from '../src/agent';
import { acpMcpConfig } from '../src/mcp';
import type { AdapterPeer } from '../src/session';
import { PrivateControlPipe } from '../src/private-control-pipe';
import type { WorkerConfig } from '../src/worker-config';
import { fixture, deferred } from './fixtures/adapter';
import { z } from 'zod';
import { LODY_EXTENSION_METHODS } from 'acp-extension-core';
import { HARNESS_MEMORY_METHOD } from '@molly/shared/personal-memory';

const providerId = MOLLY_PROVIDER_IDS['openai-compatible'];
async function managed(
  options: {
    extensions?: InlineExtension[];
    peer?: Partial<AdapterPeer>;
    length?: boolean;
    config?: Partial<WorkerConfig>;
  } = {}
) {
  const f = await fixture();
  const config: WorkerConfig = {
    schemaVersion: 1,
    runtimeEpoch: randomUUID(),
    productSessionId: 'product-session',
    workspaceId: 'workspace',
    privateRoot: f.root,
    cwd: f.cwd,
    shellPath: '/bin/sh',
    harness: {
      id: 'molly',
      engine: 'pi',
      engineVersion: PI_ENGINE_VERSION,
      buildId: 'synthetic',
      protocolVersion: 1,
    },
    connection: {
      schemaVersion: 1,
      id: 'connection',
      revision: 1,
      providerPresetId: 'openai-compatible',
      displayName: 'Synthetic',
      baseUrl: 'https://synthetic.invalid/v1',
      credentialRef: 'protected-reference',
      enabled: true,
      customModels: [
        {
          modelId: 'model',
          name: 'Synthetic',
          input: ['text', 'image'],
          contextWindow: 200000,
          maxTokens: 4096,
          thinking: ['off'],
          toolCalls: true,
          usageInStreaming: false,
          maxTokensField: 'max_tokens',
        },
      ],
    },
    selection: { connectionId: 'connection', modelId: 'model', thinking: 'off' },
    systemPrompt: 'Synthetic host context.',
    permissionProfileId: 'native-profile',
    ...options.config,
  };
  const pipe = new PassThrough();
  const peer: AdapterPeer = {
    sessionUpdate: async (update) => {
      f.updates.push(update);
    },
    ...options.peer,
  };
  const host = new PiAcpHost(config, new PrivateControlPipe(pipe), peer);
  const observed: string[] = [];
  let selectedRuntime!: ModelRuntime;
  const create = ModelRuntime.create.bind(ModelRuntime);
  vi.spyOn(ModelRuntime, 'create').mockImplementation(async (args) => {
    const runtime = await create(args);
    selectedRuntime = runtime;
    runtime.registerProvider(providerId, {
      baseUrl: config.connection.baseUrl,
      api: 'openai-completions',
      streamSimple: (model, context, opts) => {
        const stream = createAssistantMessageEventStream();
        void (async () => {
          try {
            await opts?.onPayload?.({ synthetic: true }, model);
            observed.push(JSON.stringify(context));
            const extraction = JSON.stringify(context).includes('Extract only explicitly stated');
            const message = {
              ...fauxAssistantMessage(
                extraction ? '{"changes":[{"text":"Prefers serif type"}]}' : 'Synthetic answer.',
                {
                  stopReason: options.length ? 'length' : 'stop',
                }
              ),
              provider: model.provider,
              model: model.id,
              api: model.api,
              usage: {
                input: 23,
                output: 5,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 28,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
            };
            stream.push({ type: 'done', reason: options.length ? 'length' : 'stop', message });
            stream.end();
          } catch {
            stream.push({
              type: 'error',
              reason: 'error',
              error: fauxAssistantMessage('', { stopReason: 'error' }),
            });
            stream.end();
          }
        })();
        return stream;
      },
    });
    return runtime;
  });
  const agent = new PiAcpAgent(peer, {
    agentDir: f.agentDir,
    host,
    extensions: options.extensions,
  });
  f.trackAgent(agent);
  await agent.initialize({
    protocolVersion: 1,
    ...(options.peer?.request ? { clientCapabilities: { elicitation: { form: {} } } } : {}),
  });
  function grant(snapshot: HarnessRunSnapshot, key = 'SYNTHETIC_SECRET') {
    pipe.write(
      `${JSON.stringify({ type: 'credential', runtimeEpoch: snapshot.runtimeEpoch, runId: snapshot.runId, apiKey: key })}\n`
    );
  }
  async function open() {
    const response = await agent.newSession({ cwd: f.cwd, mcpServers: [] });
    const binding = HarnessSessionBindingSchema.parse(response._meta?.mollyRuntime);
    const snapshot: HarnessRunSnapshot = {
      schemaVersion: 1,
      runId: 'run',
      runtimeEpoch: config.runtimeEpoch,
      sessionId: config.productSessionId,
      turnId: 'turn',
      connection: config.connection,
      selection: config.selection,
      harness: config.harness,
      toolsetHash: binding.toolsetHash,
      pluginSetHash: binding.pluginSetHash,
      permissionProfileId: config.permissionProfileId,
    };
    const prompt = (text = 'Hello', override = snapshot) =>
      agent.prompt({
        sessionId: response.sessionId,
        prompt: [{ type: 'text', text }],
        _meta: { mollyRunSnapshot: override },
      });
    return { response, binding, snapshot, prompt };
  }
  return { ...f, agent, host, config, pipe, grant, open, observed, runtime: () => selectedRuntime };
}

describe('owned ACP host integration', () => {
  it('projects actual native usage through the existing Core notification and ACP context channels', async () => {
    const notifications: { method: string; params: Record<string, unknown> }[] = [];
    const f = await managed({
      peer: {
        extNotification: async (method, params) => {
          notifications.push({ method, params });
        },
      },
    });
    const s = await f.open();
    f.grant(s.snapshot);
    await s.prompt();
    const usage = notifications.filter(
      (entry) => entry.method === LODY_EXTENSION_METHODS.sessionUsageUpdate
    );
    expect(usage).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({
          sessionId: s.response.sessionId,
          modelUsage: {
            [`${providerId}/model`]: expect.objectContaining({ inputTokens: 23, outputTokens: 5 }),
          },
        }),
      }),
    ]);
    expect(JSON.stringify(usage)).not.toContain('costUSD');
    expect(f.updates).toContainEqual(
      expect.objectContaining({
        update: expect.objectContaining({ sessionUpdate: 'usage_update', used: 28, size: 200000 }),
      })
    );
  });
  it('binds the host identity and persists the granted key and endpoint for sub-agents', async () => {
    const f = await managed();
    await writeFile(
      join(f.agentDir, 'auth.json'),
      JSON.stringify({ [providerId]: { type: 'api_key', key: 'PROFILE_SECRET' } })
    );
    await writeFile(
      join(f.agentDir, 'models.json'),
      JSON.stringify({ providers: { [providerId]: { baseUrl: 'https://wrong.invalid' } } })
    );
    const s = await f.open();
    f.grant(s.snapshot);
    const result = await s.prompt();
    expect(result._meta).toMatchObject({
      mollyRunId: 'run',
      mollyRuntimeEpoch: f.config.runtimeEpoch,
      mollyNativeOutcome: { status: 'completed' },
    });
    expect(f.observed[0]).toContain(f.config.systemPrompt);
    expect(f.observed[0]).toContain('IANA time zone:');
    const child = await ModelRuntime.create({
      authPath: join(f.agentDir, 'auth.json'),
      modelsPath: join(f.agentDir, 'models.json'),
      modelsStorePath: join(f.agentDir, 'child-models-cache.json'),
      refreshOnCreate: false,
    });
    const model = child.getModel(providerId, 'model');
    expect(model?.baseUrl).toBe(f.config.connection.baseUrl);
    expect((await child.getAuth(model!))?.auth.apiKey).toBe('SYNTHETIC_SECRET');
    const content = await readFile(s.binding.nativeSessionFile, 'utf8');
    expect(content).not.toContain('SYNTHETIC_SECRET');
    expect(JSON.stringify(f.updates)).not.toContain('SYNTHETIC_SECRET');
    const native = z
      .object({ mollyNativeOutcome: z.object({ nativeEndEntryId: z.string() }) })
      .parse(result._meta);
    const entry = content
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((item) => item.id === native.mollyNativeOutcome.nativeEndEntryId);
    expect(entry.message.role).toBe('assistant');
  });

  it('reserves execution before awaiting a private credential and retires on cancellation', async () => {
    const f = await managed();
    const s = await f.open();
    const pending = s.prompt();
    const rejected = expect(pending).rejects.toThrow('pi_acp_host_execution_failed');
    await expect(s.prompt()).rejects.toMatchObject({ code: -32600 });
    await expect(
      f.agent.setSessionConfigOption({
        sessionId: s.response.sessionId,
        configId: 'model',
        value: 'other',
      })
    ).rejects.toMatchObject({ code: -32600 });
    await f.agent.cancel({ sessionId: s.response.sessionId });
    await rejected;
    expect(f.observed).toEqual([]);
    expect(f.pipe.destroyed).toBe(true);
    await expect(s.prompt()).rejects.toMatchObject({ code: -32600 });
  });

  it.each(['epoch', 'selection', 'policy', 'tools'] as const)(
    'refuses mismatched %s before consuming credentials',
    async (kind) => {
      const f = await managed();
      const s = await f.open();
      const snapshot = {
        ...s.snapshot,
        ...(kind === 'epoch' ? { runtimeEpoch: randomUUID() } : {}),
        ...(kind === 'selection'
          ? { selection: { ...s.snapshot.selection, modelId: 'other' } }
          : {}),
        ...(kind === 'policy' ? { permissionMode: 'auto-review' as const } : {}),
        ...(kind === 'tools' ? { toolsetHash: '0'.repeat(64) } : {}),
      };
      await expect(s.prompt('Hello', snapshot)).rejects.toThrow('pi_acp_host_snapshot_mismatch');
      expect(f.observed).toEqual([]);
      expect(f.pipe.destroyed).toBe(true);
    }
  );

  it('refuses a credential for a different run and never opens a model connection', async () => {
    const f = await managed();
    const s = await f.open();
    f.grant({ ...s.snapshot, runId: 'other' });
    await expect(s.prompt()).rejects.toThrow('pi_acp_host_execution_failed');
    expect(f.observed).toEqual([]);
    expect(f.pipe.destroyed).toBe(true);
  });

  it('awaits credential preparation before cancellation or writer release', async () => {
    const f = await managed();
    const s = await f.open();
    const prepared = deferred<void>();
    const finishPrepare = deferred<void>();
    const runtime = f.runtime();
    const setKey = runtime.setRuntimeApiKey.bind(runtime);
    vi.spyOn(runtime, 'setRuntimeApiKey').mockImplementation(async (provider, key) => {
      prepared.resolve();
      await finishPrepare.promise;
      await setKey(provider, key);
    });
    f.grant(s.snapshot);
    const pending = s.prompt();
    const rejected = expect(pending).rejects.toThrow('pi_acp_host_execution_failed');
    await prepared.promise;
    let cancellationFinished = false;
    const cancel = f.agent.cancel({ sessionId: s.response.sessionId }).then(() => {
      cancellationFinished = true;
    });
    const closing = f.agent.dispose();
    expect(await readFile(`${s.binding.nativeSessionFile}.acp-lock`, 'utf8')).toBeDefined();
    expect(cancellationFinished).toBe(false);
    finishPrepare.resolve();
    await rejected;
    await cancel;
    await closing;
    await expect(readFile(`${s.binding.nativeSessionFile}.acp-lock`, 'utf8')).rejects.toMatchObject(
      { code: 'ENOENT' }
    );
    expect(f.observed).toEqual([]);
  });

  it.each(['model', 'endpoint'] as const)(
    'refuses a native extension changing the selected %s before inference',
    async (kind) => {
      const f = await managed({
        extensions: [
          (pi) => {
            if (kind === 'model')
              pi.registerProvider('other', {
                baseUrl: 'https://other.invalid',
                api: 'openai-completions',
                apiKey: 'synthetic-other',
                models: [
                  {
                    id: 'other',
                    name: 'Other',
                    input: ['text'],
                    contextWindow: 4096,
                    maxTokens: 1024,
                    reasoning: false,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  },
                ],
              });
            pi.on('before_agent_start', async (_event, ctx) => {
              if (kind === 'endpoint')
                pi.registerProvider(providerId, { baseUrl: 'https://other.invalid' });
              else {
                const model = ctx.modelRegistry.find('other', 'other');
                expect(model?.id).toBe('other');
                await pi.setModel(model!);
              }
            });
          },
        ],
      });
      const s = await f.open();
      f.grant(s.snapshot);
      await expect(s.prompt()).rejects.toThrow('pi_acp_host_execution_failed');
      expect(f.observed).toEqual([]);
      expect(f.pipe.destroyed).toBe(true);
    }
  );

  it('requires host authorization of the native UUID before restoring a managed history', async () => {
    const f = await managed();
    await expect(
      f.agent.loadSession({ sessionId: randomUUID(), cwd: f.cwd, mcpServers: [] })
    ).rejects.toThrow('pi_acp_session_setup_failed');
    expect(f.observed).toEqual([]);
    expect(f.pipe.destroyed).toBe(true);
  });

  it('keeps native custom entries distinct from the assistant completion receipt', async () => {
    const f = await managed({
      extensions: [
        (pi) => {
          pi.on('agent_end', () => {
            pi.appendEntry('synthetic', { note: 'after response' });
          });
        },
      ],
    });
    const s = await f.open();
    f.grant(s.snapshot);
    const result = await s.prompt();
    const native = z
      .object({ mollyNativeOutcome: z.object({ nativeEndEntryId: z.string() }) })
      .parse(result._meta);
    const entries = (await readFile(s.binding.nativeSessionFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(entries.at(-1).type).toBe('custom');
    expect(
      entries.find((entry) => entry.id === native.mollyNativeOutcome.nativeEndEntryId).message.role
    ).toBe('assistant');
  });

  it.each(['handled', 'length'])('does not report %s as completed inference', async (kind) => {
    const f = await managed({
      length: kind === 'length',
      extensions: [
        (pi) => {
          pi.registerCommand('local', { handler: async () => {} });
        },
      ],
    });
    const s = await f.open();
    f.grant(s.snapshot);
    await expect(s.prompt(kind === 'handled' ? '/local' : 'Hello')).rejects.toThrow(
      'pi_acp_host_execution_failed'
    );
    expect(f.pipe.destroyed).toBe(true);
  });

  it('binds GUI questions to the current run and waits for visible dismissal before releasing the answer', async () => {
    const dismissed = deferred<void>();
    const requested = deferred<void>();
    const accepted = deferred<void>();
    let identity: unknown;
    const peer: Partial<AdapterPeer> = {
      request: (async (_method: string, raw: unknown) => {
        const params = z
          .object({
            _meta: z.object({ mollyQuestion: HarnessQuestionIdentitySchema }),
            requestedSchema: z.object({ properties: z.record(z.string(), z.unknown()) }),
          })
          .parse(raw);
        identity = params._meta.mollyQuestion;
        const parsed = parseAskUserQuestionElicitationRequest(raw as CreateElicitationRequest);
        expect(parsed?.meta.questions[0]?.id).toBe(params._meta.mollyQuestion.questionId);
        expect(parsed?.autoResolutionMs).toBeNull();
        requested.resolve();
        return {
          action: 'accept',
          content: { [Object.keys(params.requestedSchema.properties)[0]!]: 'Continue' },
        };
      }) as AdapterPeer['request'],
      extMethod: async (_method, params) => {
        expect(params.request).toEqual(identity);
        await dismissed.promise;
        return { version: 1, dismissed: true };
      },
    };
    const f = await managed({
      peer,
      extensions: [
        (pi) => {
          pi.on('before_agent_start', async (_event, ctx) => {
            if ((await ctx.ui.select('Continue?', ['Continue'])) === 'Continue') accepted.resolve();
          });
        },
      ],
    });
    const s = await f.open();
    f.grant(s.snapshot);
    const running = s.prompt();
    await requested.promise;
    expect(identity).toMatchObject({ runId: 'run', runtimeEpoch: f.config.runtimeEpoch });
    expect(f.observed).toEqual([]);
    dismissed.resolve();
    await accepted.promise;
    await running;
  });

  it.each(['select', 'input', 'confirm', 'editor'] as const)(
    'delivers native %s through the actual host question parser',
    async (kind) => {
      const answer =
        kind === 'select' ? 'Continue' : kind === 'confirm' ? 'Confirm' : 'Synthetic text';
      let value: unknown;
      const peer: Partial<AdapterPeer> = {
        request: (async (_method: string, raw: unknown) => {
          const request = raw as CreateElicitationRequest;
          const parsed = parseAskUserQuestionElicitationRequest(request);
          const identity = HarnessQuestionIdentitySchema.parse(request._meta?.mollyQuestion);
          expect(parsed?.meta.source).toBe('lody');
          expect(parsed?.meta.questions[0]?.id).toBe(identity.questionId);
          expect(parsed?.autoResolutionMs).toBeNull();
          if (kind === 'input' || kind === 'editor')
            expect(parsed?.meta.questions[0]?.allowCustomAnswer).toBe(true);
          return { action: 'accept', content: { [parsed!.fieldKeys[0]!]: answer } };
        }) as AdapterPeer['request'],
        extMethod: async () => ({ version: 1, dismissed: true }),
      };
      const f = await managed({
        peer,
        extensions: [
          (pi) => {
            pi.on('before_agent_start', async (_event, ctx) => {
              value =
                kind === 'select'
                  ? await ctx.ui.select('Question', ['Continue'])
                  : kind === 'confirm'
                    ? await ctx.ui.confirm('Title', 'Question')
                    : kind === 'input'
                      ? await ctx.ui.input('Question')
                      : await ctx.ui.editor('Question', 'Current text');
            });
          },
        ],
      });
      const s = await f.open();
      f.grant(s.snapshot);
      await s.prompt();
      expect(value).toBe(kind === 'confirm' ? true : answer);
    }
  );

  it('fails an unintegrated startup dialog instead of accepting an unbound GUI answer', async () => {
    const f = await managed({
      peer: {
        request: (async () => ({ action: 'accept' })) as AdapterPeer['request'],
        extMethod: async () => ({ version: 1, dismissed: true }),
      },
      extensions: [
        (pi) => {
          pi.on('session_start', async (_event, ctx) => {
            await ctx.ui.confirm('Startup', 'Continue?');
          });
        },
      ],
    });
    await expect(f.open()).rejects.toThrow('pi_acp_session_setup_failed');
    expect(f.observed).toEqual([]);
  });

  it('holds the run and history writer until a background dialog finishes visible retirement', async () => {
    const opened = deferred<void>();
    const retiring = deferred<void>();
    const retired = deferred<void>();
    const peer: Partial<AdapterPeer> = {
      request: (async () => {
        opened.resolve();
        return new Promise<CreateElicitationResponse>(() => {});
      }) as AdapterPeer['request'],
      extMethod: async () => {
        retiring.resolve();
        await retired.promise;
        return { version: 1, dismissed: true };
      },
    };
    const f = await managed({
      peer,
      extensions: [
        (pi) => {
          pi.on('before_agent_start', (_event, ctx) => {
            void ctx.ui.select('Background question', ['Continue']).catch(() => undefined);
          });
        },
      ],
    });
    const s = await f.open();
    f.grant(s.snapshot);
    let finished = false;
    const prompt = s.prompt().then((result) => {
      finished = true;
      return result;
    });
    await opened.promise;
    await retiring.promise;
    expect(finished).toBe(false);
    expect(f.host.busy).toBe(true);
    expect(await readFile(`${s.binding.nativeSessionFile}.acp-lock`, 'utf8')).toBeDefined();
    const closing = f.agent.dispose();
    retired.resolve();
    await prompt;
    await closing;
    expect(f.host.busy).toBe(false);
    await expect(readFile(`${s.binding.nativeSessionFile}.acp-lock`, 'utf8')).rejects.toMatchObject(
      { code: 'ENOENT' }
    );
  });

  it('refuses a successful answer when the host never confirms visible dismissal', async () => {
    const dismissing = deferred<void>();
    const late = deferred<Record<string, unknown>>();
    const f = await managed({
      peer: {
        request: (async (_method: string, raw: unknown) => {
          const form = parseAskUserQuestionElicitationRequest(raw as CreateElicitationRequest)!;
          return { action: 'accept', content: { [form.fieldKeys[0]!]: 'Continue' } };
        }) as AdapterPeer['request'],
        extMethod: async () => {
          dismissing.resolve();
          return late.promise;
        },
      },
      extensions: [
        (pi) => {
          pi.on('before_agent_start', async (_event, ctx) => {
            await ctx.ui.select('Question', ['Continue']);
          });
        },
      ],
    });
    const s = await f.open();
    vi.useFakeTimers();
    try {
      f.grant(s.snapshot);
      const pending = s.prompt();
      const refused = expect(pending).rejects.toThrow('pi_acp_host_execution_failed');
      await dismissing.promise;
      await vi.advanceTimersByTimeAsync(5000);
      await refused;
      late.resolve({ version: 1, dismissed: true });
      expect(f.observed).toEqual([]);
      expect(f.pipe.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('awaits every background dialog retirement when one dismissal fails', async () => {
    const questions = new Map<string, string>();
    const delayedRetirement = deferred<void>();
    const retiring = deferred<void>();
    const f = await managed({
      peer: {
        request: (async (_method: string, raw: unknown) => {
          const request = raw as CreateElicitationRequest;
          const identity = HarnessQuestionIdentitySchema.parse(request._meta?.mollyQuestion);
          questions.set(identity.questionId, request.message);
          return new Promise<CreateElicitationResponse>(() => {});
        }) as AdapterPeer['request'],
        extMethod: async (_method, params) => {
          const identity = HarnessQuestionIdentitySchema.parse(params.request);
          if (questions.get(identity.questionId) === 'Failed question')
            throw new Error('Synthetic dismissal failure');
          retiring.resolve();
          await delayedRetirement.promise;
          return { version: 1, dismissed: true };
        },
      },
      extensions: [
        (pi) => {
          pi.on('before_agent_start', (_event, ctx) => {
            void ctx.ui.select('Failed question', ['Continue']).catch(() => undefined);
            void ctx.ui.select('Delayed question', ['Continue']).catch(() => undefined);
          });
        },
      ],
    });
    const s = await f.open();
    vi.useFakeTimers();
    let closing: Promise<void> | undefined;
    f.grant(s.snapshot);
    const pending = s.prompt();
    const refused = expect(pending).rejects.toThrow('pi_acp_host_execution_failed');
    try {
      await retiring.promise;
      await vi.advanceTimersByTimeAsync(0);
      closing = f.agent.dispose();
      expect(f.host.busy).toBe(true);
      expect((await f.runtime().getAuth(providerId))?.auth.apiKey).toBe('SYNTHETIC_SECRET');
      expect(await readFile(`${s.binding.nativeSessionFile}.acp-lock`, 'utf8')).toBeDefined();
      delayedRetirement.resolve();
      await refused;
      await closing;
      expect(f.host.busy).toBe(false);
      expect(f.pipe.destroyed).toBe(true);
      await expect(
        readFile(`${s.binding.nativeSessionFile}.acp-lock`, 'utf8')
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      delayedRetirement.resolve();
      await Promise.allSettled([pending, closing, refused]);
      vi.useRealTimers();
    }
  });

  it('owns one managed session and rejects a different working directory', async () => {
    const f = await managed();
    const s = await f.open();
    await expect(f.agent.newSession({ cwd: f.cwd, mcpServers: [] })).rejects.toThrow(
      'pi_acp_session_setup_failed'
    );
    await expect(s.prompt()).rejects.toMatchObject({ code: -32600 });
    const other = await managed();
    const directory = join(other.root, 'other');
    await mkdir(directory);
    await expect(other.agent.newSession({ cwd: directory, mcpServers: [] })).rejects.toThrow(
      'pi_acp_session_setup_failed'
    );
    expect(other.observed).toEqual([]);
  });

  it('checks exact protected MCP grants without persisting secret fields', async () => {
    const f = await managed();
    const binding: McpCredentialBinding = {
      workspaceId: 'workspace',
      serverId: 'server',
      credentialRef: randomUUID(),
      revision: 1,
      destination: { transport: 'stdio', command: 'synthetic', args: [] },
      fieldNames: ['API_TOKEN'],
    };
    f.pipe.write(
      `${JSON.stringify({
        type: 'mcp-credentials',
        runtimeEpoch: f.config.runtimeEpoch,
        sessionId: f.config.productSessionId,
        credentials: [{ connection: binding, values: { API_TOKEN: '!$VALUE' } }],
      })}\n`
    );
    const native = await f.host.sessionConfig(
      [
        {
          name: 'server',
          command: 'synthetic',
          args: [],
          env: [],
          _meta: { mollyMcpCredential: binding, mollyConnection: { id: 'server', revision: 1 } },
        },
      ],
      f.cwd
    );
    expect(native[0]?.config).toMatchObject({ env: { API_TOKEN: '$!$$VALUE' } });
    expect(await readFile(join(f.agentDir, 'settings.json'), 'utf8')).not.toContain('!$VALUE');
  });

  it('rejects custom-header credentials that could silently fall through to native OAuth', () => {
    const connection: McpCredentialBinding = {
      workspaceId: 'workspace',
      serverId: 'server',
      credentialRef: randomUUID(),
      revision: 1,
      destination: { transport: 'http', url: 'https://synthetic.invalid/mcp' },
      fieldNames: ['X-Api-Key'],
    };
    expect(() =>
      acpMcpConfig(
        [
          {
            type: 'http',
            name: 'server',
            url: connection.destination.transport === 'http' ? connection.destination.url : '',
            headers: [],
            _meta: { mollyMcpCredential: connection },
          },
        ],
        '/synthetic',
        [{ connection, values: { 'X-Api-Key': 'secret' } }]
      )
    ).toThrow('pi_acp_mcp_protected_oauth_unsupported');
  });

  it('restores a previous-release history from any connection partition without rewriting it', async () => {
    const id = randomUUID();
    const f = await managed({ config: { nativeSessionId: id } });
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    const directory = join(
      f.root,
      'sessions',
      digest('earlier-connection'),
      digest('product-session')
    );
    await mkdir(directory, { recursive: true });
    const baseline = JSON.parse(
      await readFile(new URL('./fixtures/pi-0.85.1-session.json', import.meta.url), 'utf8')
    );
    const original =
      [
        JSON.stringify({ ...baseline.header, id, cwd: f.cwd }),
        ...baseline.entries.map((entry: unknown) => JSON.stringify(entry)),
      ].join('\n') + '\n';
    const file = join(directory, `2026-09-29T15-16-31-184Z_${id}.jsonl`);
    await writeFile(file, original);
    await f.agent.loadSession({ sessionId: id, cwd: f.cwd, mcpServers: [] });
    expect(f.updates).toContainEqual(
      expect.objectContaining({
        update: {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'Synthetic previous-release request' },
        },
      })
    );
    expect(await readFile(file, 'utf8')).toBe(original);
  });

  it('refuses to dispatch a run again after its durable fence exists', async () => {
    const f = await managed();
    const s = await f.open();
    f.grant(s.snapshot);
    await s.prompt();
    const second = await managed({ config: { privateRoot: f.root } });
    const t = await second.open();
    await expect(t.prompt('Again', { ...t.snapshot, runId: 'run' })).rejects.toMatchObject({
      data: { code: 'harness_run_already_dispatched' },
    });
    expect(second.observed).toEqual([]);
  });

  it('recalls personal preferences into context and captures new ones after completion', async () => {
    const operations: unknown[] = [];
    const f = await managed({
      config: { personalMemory: true },
      peer: {
        extMethod: async (method, params) => {
          expect(method).toBe(HARNESS_MEMORY_METHOD);
          const request = z.object({ request: z.object({ operation: z.unknown() }) }).parse(params);
          operations.push(request.request.operation);
          return {
            revision: 'r1',
            enabled: true,
            entries: [{ id: 'p1', text: 'Likes muted color' }],
          };
        },
      },
    });
    const s = await f.open();
    f.grant(s.snapshot);
    const result = await s.prompt('I prefer serif type.');
    expect(result._meta?.mollyPersonalMemory).toBe('saved');
    expect(f.observed[0]).toContain('Likes muted color');
    expect(operations).toEqual([
      { action: 'read' },
      { action: 'capture', revision: 'r1', changes: [{ text: 'Prefers serif type' }] },
    ]);
  });
});
