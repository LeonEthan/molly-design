import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ModelRuntime, type InlineExtension } from '@earendil-works/pi-coding-agent';
import { getCurrentTools } from '@earendil-works/pi-ai';
import { PiAcpHost } from '../src/host';
import type { CreateElicitationRequest, CreateElicitationResponse } from '@agentclientprotocol/sdk';
import { parseAskUserQuestionElicitationRequest } from '@molly/shared';
import {
  HarnessQuestionIdentitySchema,
  MOLLY_PROVIDER_IDS,
  PROVIDER_PRESET_DEFAULT_BASE_URLS,
  type McpCredentialBinding,
} from '@molly/shared/embedded-harness';
import { acpMcpConfig } from '../src/mcp';
import type { AdapterPeer } from '../src/session';
import { deferred } from './fixtures/adapter';
import { z } from 'zod';
import { LODY_EXTENSION_METHODS } from 'acp-extension-core';
import { HARNESS_MEMORY_METHOD } from '@molly/shared/personal-memory';

import { managed } from './fixtures/managed';
import { retrySignals } from './fixtures/retry';

const providerId = MOLLY_PROVIDER_IDS['openai-compatible'];
describe('owned ACP host integration', () => {
  it('fingerprints tool names and plugin paths in locale-independent code-unit order', async () => {
    const f = await managed({
      extensions: [
        (pi) => {
          for (const name of ['synthetic_a', 'synthetic_Z', 'synthetic_z'])
            pi.registerTool({
              name,
              label: name,
              description: name,
              parameters: { type: 'object', properties: {} },
              execute: async () => ({ content: [{ type: 'text', text: 'unused' }], details: {} }),
            });
        },
      ],
    });
    const bind = vi.spyOn(f.host, 'bind');
    const session = await f.open();
    const wrapper = bind.mock.calls[0]![0];
    const tools = wrapper.piSession
      .getAllTools()
      .map(({ name, description, parameters }) => ({ name, description, parameters }));
    const names = tools.map((tool) => tool.name).sort();
    expect(names.filter((name) => name.startsWith('synthetic_'))).toEqual([
      'synthetic_Z',
      'synthetic_a',
      'synthetic_z',
    ]);
    const hash = (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex');
    expect(session.binding.toolsetHash).toBe(
      hash(names.map((name) => tools.find((tool) => tool.name === name)))
    );
    vi.spyOn(String.prototype, 'localeCompare').mockImplementation(() => {
      throw new Error('locale_sort_forbidden');
    });
    const first = await f.host.bind(wrapper, ['/plugins/z', '/plugins/ä', '/plugins/Z']);
    const second = await f.host.bind(wrapper, ['/plugins/ä', '/plugins/Z', '/plugins/z']);
    expect(first.toolsetHash).toBe(session.binding.toolsetHash);
    expect(first.pluginSetHash).toBe(hash(['/plugins/Z', '/plugins/z', '/plugins/ä']));
    expect(second.pluginSetHash).toBe(first.pluginSetHash);
  });

  it.each(['custom', 'user'] as const)(
    'refuses an idle native %s turn after Molly dispatch ends',
    async (messageType) => {
      const events: string[] = [];
      const f = await managed({
        extensions: [
          (pi) => {
            pi.on('before_agent_start', (event) => {
              events.push(event.messageType);
            });
          },
        ],
      });
      const bind = vi.spyOn(f.host, 'bind');
      const session = await f.open();
      const native = bind.mock.calls[0]![0].piSession;
      f.grant(session.snapshot);
      await session.prompt();
      const original = (await readFile(session.binding.nativeSessionFile, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((entry) => entry.customType === 'molly_host_system_prompt');
      const unsolicited =
        messageType === 'custom'
          ? native.sendCustomMessage(
              { customType: 'synthetic-trigger', content: 'Synthetic idle turn', display: false },
              { triggerTurn: true }
            )
          : native.sendUserMessage('Synthetic idle user turn');
      await expect(unsolicited).rejects.toThrow('pi_acp_extension_failed');
      expect(events).toEqual(['user', messageType]);
      expect(f.observed).toHaveLength(1);
      expect(f.pipe.destroyed).toBe(true);
      expect(
        (await readFile(session.binding.nativeSessionFile, 'utf8'))
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .filter((entry) => entry.customType === 'molly_host_system_prompt')
      ).toEqual(original);
    }
  );

  it('restores the active native tool loadout on resume without executing tools', async () => {
    const f = await managed();
    const bind = vi.spyOn(f.host, 'bind');
    const first = await f.open();
    const native = bind.mock.calls[0]![0].piSession;
    native.setActiveToolsByName(['read']);
    f.grant(first.snapshot);
    await first.prompt();
    expect(native.getActiveToolNames()).toEqual(['read']);
    await f.agent.dispose();
    vi.restoreAllMocks();
    const next = await managed({
      config: {
        ...f.config,
        runtimeEpoch: randomUUID(),
        nativeSessionId: first.response.sessionId,
      },
    });
    const nextBind = vi.spyOn(next.host, 'bind');
    const resumed = await next.open();
    expect(nextBind.mock.calls[0]![0].piSession.getActiveToolNames()).toEqual(['read']);
    expect(next.observed).toEqual([]);
    next.grant({ ...resumed.snapshot, runId: 'resumed' });
    await resumed.prompt('Synthetic resume', { ...resumed.snapshot, runId: 'resumed' });
    expect(nextBind.mock.calls[0]![0].piSession.getActiveToolNames()).toEqual(['read']);
    expect(getCurrentTools(JSON.parse(next.observed[0]!).messages).map(({ name }) => name)).toEqual(
      ['read']
    );
  });

  it('accepts an empty grant for its bound compatible connection and completes inference', async () => {
    const f = await managed();
    const session = await f.open();
    f.grant(session.snapshot, '');
    expect((await session.prompt())._meta?.mollyNativeOutcome).toMatchObject({
      status: 'completed',
    });
    expect((await f.runtime().getAuth(providerId))?.auth.headers?.Authorization).toBeNull();
  });
  it('reports native model failures without exposing provider payloads or replaying the run', async () => {
    const retry = retrySignals();
    const f = await managed({
      productionProfile: true,
      peer: retry,
      providerError:
        '500: {"message":"HTTP/2 PROTOCOL_ERROR SYNTHETIC_PROVIDER_SECRET","type":"server_error","code":"internal_server_error"}',
    });
    const session = await f.open();
    f.grant(session.snapshot);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const running = session.prompt().catch((failure: unknown) => failure);
    let error: unknown;
    try {
      for (const [index, signal] of retry.scheduled.entries()) {
        await signal.promise;
        await vi.advanceTimersByTimeAsync(1000 * 2 ** index);
      }
      error = await running;
    } finally {
      vi.useRealTimers();
    }
    expect(error).toMatchObject({
      code: -32603,
      message: 'Model request failed.',
      data: {
        code: 'harness_model_request_failed',
        category: 'transient',
        details: expect.stringContaining('after automatic retries'),
      },
    });
    expect(JSON.stringify(error)).not.toContain('SYNTHETIC_PROVIDER_SECRET');
    expect(JSON.stringify(f.updates)).not.toContain('SYNTHETIC_PROVIDER_SECRET');
    expect(f.observed).toHaveLength(4);
    expect(f.pipe.destroyed).toBe(true);
    await expect(session.prompt()).rejects.toMatchObject({ code: -32600 });
    expect(f.observed).toHaveLength(4);
  });

  it.each(['overflow', 'length'] as const)(
    'refuses automatic %s compaction recovery before another model request',
    async (failure) => {
      const compactions: { reason: string; aborted: boolean; willRetry: boolean }[] = [];
      const f = await managed({
        productionProfile: true,
        length: failure === 'length',
        providerError: failure === 'overflow' ? 'maximum context length exceeded' : undefined,
        extensions: [
          {
            name: 'observe-compaction',
            factory: (pi) => {
              pi.on('session_start', () => {
                pi.sendMessage({
                  customType: 'synthetic-history',
                  content: 'x'.repeat(100_000),
                  display: false,
                });
              });
              pi.on('session_compact_failed', (event) => {
                compactions.push({
                  reason: event.reason,
                  aborted: event.aborted,
                  willRetry: event.willRetry,
                });
              });
            },
          },
        ],
      });
      const session = await f.open();
      f.grant(session.snapshot);
      await expect(session.prompt('Synthetic request. '.repeat(8_000))).rejects.toThrow(
        failure === 'overflow' ? 'Model request failed.' : 'pi_acp_host_execution_failed'
      );
      expect(f.observed).toHaveLength(1);
      expect(compactions).toEqual([{ reason: 'overflow', aborted: true, willRetry: false }]);
      const history = await readFile(session.binding.nativeSessionFile, 'utf8');
      expect(history).not.toContain('"type":"compaction"');
    },
    30_000
  );

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
  it('binds the granted key and endpoint in memory without changing old profile files', async () => {
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
    const model = f.runtime().getModel(providerId, 'model');
    expect(model?.baseUrl).toBe(f.config.connection.baseUrl);
    expect((await f.runtime().getAuth(model!))?.auth.apiKey).toBe('SYNTHETIC_SECRET');
    expect(JSON.parse(await readFile(join(f.agentDir, 'auth.json'), 'utf8'))).toEqual({
      [providerId]: { type: 'api_key', key: 'PROFILE_SECRET' },
    });
    expect(JSON.parse(await readFile(join(f.agentDir, 'models.json'), 'utf8'))).toEqual({
      providers: { [providerId]: { baseUrl: 'https://wrong.invalid' } },
    });
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

  it('keeps same-preset workers on their own endpoint and key without publishing credentials', async () => {
    const first = await managed();
    const firstSession = await first.open();
    first.grant(firstSession.snapshot, 'FIRST_SYNTHETIC_KEY');
    await firstSession.prompt();
    vi.restoreAllMocks();
    const second = await managed({
      config: {
        privateRoot: first.root,
        productSessionId: 'second-product-session',
        connection: {
          ...first.config.connection,
          id: 'second-connection',
          baseUrl: 'https://second.invalid/v1',
        },
        selection: { ...first.config.selection, connectionId: 'second-connection' },
      },
    });
    const secondSession = await second.open();
    const secondSnapshot = { ...secondSession.snapshot, runId: 'second-run' };
    second.grant(secondSnapshot, 'SECOND_SYNTHETIC_KEY');
    await secondSession.prompt('Hello', secondSnapshot);
    vi.restoreAllMocks();
    expect(first.agentDir).not.toBe(second.agentDir);
    for (const [owner, key] of [
      [first, 'FIRST_SYNTHETIC_KEY'],
      [second, 'SECOND_SYNTHETIC_KEY'],
    ] as const) {
      const model = owner.runtime().getModel(providerId, 'model');
      expect(model?.baseUrl).toBe(owner.config.connection.baseUrl);
      expect((await owner.runtime().getAuth(model!))?.auth.apiKey).toBe(key);
      for (const name of ['auth.json', 'models.json', 'models-cache.json'])
        await expect(readFile(join(owner.agentDir, name))).rejects.toMatchObject({
          code: 'ENOENT',
        });
    }
  });

  it.each([
    ['openai-responses', 'https://synthetic.invalid/v1/', 'https://synthetic.invalid/v1'],
    [
      'openai-responses',
      'https://synthetic.invalid/v1/v1/responses/',
      'https://synthetic.invalid/v1',
    ],
    [
      'google-generative-ai',
      'https://synthetic.invalid/v1beta/',
      'https://synthetic.invalid/v1beta',
    ],
    [
      'google-generative-ai',
      'https://synthetic.invalid/v1beta/v1beta/models/models/',
      'https://synthetic.invalid/v1beta',
    ],
  ] as const)(
    'admits a managed %s run with saved URL %s',
    async (compatibleApi, baseUrl, resolvedBaseUrl) => {
      const f = await managed({
        config: {
          connection: {
            schemaVersion: 1,
            id: 'connection',
            revision: 1,
            providerPresetId: 'openai-compatible',
            displayName: 'Synthetic',
            baseUrl,
            credentialRef: 'protected-reference',
            enabled: true,
            compatibleApi,
            customModels: [
              {
                modelId: 'model',
                name: 'Synthetic',
                input: ['text'],
                contextWindow: 8192,
                maxTokens: 1024,
                thinking: ['off'],
                toolCalls: true,
                maxTokensField: 'max_tokens',
              },
            ],
          },
        },
      });
      const session = await f.open();
      f.grant(session.snapshot);
      const result = await session.prompt('Normalized endpoint admission.');
      expect(result.stopReason).toBe('end_turn');
      expect(f.runtime().getModel(providerId, 'model')).toMatchObject({
        api: compatibleApi,
        baseUrl: resolvedBaseUrl,
      });
      expect(f.observed.some((context) => context.includes('Normalized endpoint admission.'))).toBe(
        true
      );
      expect(result._meta?.mollyNativeOutcome).toMatchObject({ status: 'completed' });
    }
  );

  it.each([
    ['openai-responses', 'https://alternate.invalid/v1'],
    ['openai-responses', 'https://synthetic.invalid/alternate/v1'],
    ['google-generative-ai', 'https://alternate.invalid/v1beta'],
    ['google-generative-ai', 'https://synthetic.invalid/alternate/v1beta'],
  ] as const)(
    'refuses an alternate endpoint before inference in a normalized %s run: %s',
    async (compatibleApi, alternateEndpoint) => {
      const f = await managed({
        config: {
          connection: {
            schemaVersion: 1,
            id: 'connection',
            revision: 1,
            providerPresetId: 'openai-compatible',
            displayName: 'Synthetic',
            baseUrl:
              compatibleApi === 'openai-responses'
                ? 'https://synthetic.invalid/v1/v1/responses/'
                : 'https://synthetic.invalid/v1beta/v1beta/models/',
            credentialRef: 'protected-reference',
            enabled: true,
            compatibleApi,
            customModels: [
              {
                modelId: 'model',
                name: 'Synthetic',
                input: ['text'],
                contextWindow: 8192,
                maxTokens: 1024,
                thinking: ['off'],
                toolCalls: true,
                maxTokensField: 'max_tokens',
              },
            ],
          },
        },
        extensions: [
          (pi) => {
            pi.on('before_agent_start', () => {
              pi.registerProvider(providerId, { baseUrl: alternateEndpoint });
            });
          },
        ],
      });
      const session = await f.open();
      f.grant(session.snapshot);
      await expect(session.prompt()).rejects.toThrow('pi_acp_host_execution_failed');
      expect(f.observed).toEqual([]);
      expect(f.pipe.destroyed).toBe(true);
    }
  );

  it.each([
    'anthropic-messages',
    'openai-completions',
    'openai-responses',
    'google-generative-ai',
  ] as const)(
    'admits an empty compatible grant only for legacy protocols: %s',
    async (compatibleApi) => {
      const f = await managed({
        config: {
          connection: {
            schemaVersion: 1,
            id: 'connection',
            revision: 1,
            providerPresetId: 'openai-compatible',
            displayName: 'Synthetic',
            baseUrl: 'https://synthetic.invalid/v1',
            credentialRef: 'protected-reference',
            enabled: true,
            compatibleApi,
            customModels: [
              {
                modelId: 'model',
                name: 'Synthetic',
                input: ['text'],
                contextWindow: 8192,
                maxTokens: 1024,
                thinking: ['off'],
                toolCalls: true,
                maxTokensField: 'max_tokens',
              },
            ],
          },
        },
      });
      const session = await f.open();
      f.grant(session.snapshot, '');
      if (compatibleApi === 'openai-responses' || compatibleApi === 'google-generative-ai') {
        await expect(session.prompt()).rejects.toThrow('pi_acp_host_execution_failed');
        expect(f.observed).toEqual([]);
        expect(f.pipe.destroyed).toBe(true);
      } else {
        expect((await session.prompt()).stopReason).toBe('end_turn');
      }
    }
  );

  it('dispatches a default-endpoint model only to its own SDK endpoint', async () => {
    const probe = await ModelRuntime.create({
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const openrouter = MOLLY_PROVIDER_IDS.openrouter;
    const defaultEndpoint = PROVIDER_PRESET_DEFAULT_BASE_URLS.openrouter;
    const claude = probe.getModels(openrouter).find((model) => model.baseUrl !== defaultEndpoint)!;
    const f = await managed({
      initialize: false,
      config: {
        connection: {
          schemaVersion: 1,
          id: 'connection',
          revision: 1,
          providerPresetId: 'openrouter',
          displayName: 'OpenRouter',
          baseUrl: defaultEndpoint,
          credentialRef: 'protected-reference',
          enabled: true,
        },
        selection: { connectionId: 'connection', modelId: claude.id, thinking: 'off' },
      },
    });
    const runtime = await f.host.createRuntime(f.agentDir);
    const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
    const { extension } = f.host;
    const factory = typeof extension === 'function' ? extension : extension.factory;
    await factory({
      on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) =>
        handlers.set(event, handler),
      getThinkingLevel: () => 'off',
    } as never);
    const validate = handlers.get('before_provider_request')!;
    const model = runtime.getModel(openrouter, claude.id);
    expect(model?.baseUrl).toBe(claude.baseUrl);
    expect(() => validate({}, { model })).not.toThrow();
    expect(() => validate({}, { model: { ...model, baseUrl: defaultEndpoint } })).toThrow(
      'pi_acp_host_model_changed'
    );
  });

  it('retires a worker before a changed grant can replace its runtime key', async () => {
    const f = await managed();
    const s = await f.open();
    f.grant(s.snapshot);
    await s.prompt();
    const history = await readFile(s.binding.nativeSessionFile, 'utf8');
    const snapshot = { ...s.snapshot, runId: 'changed-key', turnId: 'changed-key-turn' };
    f.grant(snapshot, 'CHANGED_SYNTHETIC_KEY');
    await expect(s.prompt('Must not run', snapshot)).rejects.toThrow(
      'pi_acp_host_execution_failed'
    );
    expect((await f.runtime().getAuth(providerId))?.auth.apiKey).toBe('SYNTHETIC_SECRET');
    await expect(readFile(join(f.agentDir, 'auth.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(s.binding.nativeSessionFile, 'utf8')).toBe(history);
    expect(f.pipe.destroyed).toBe(true);
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

  it('refuses a mismatched snapshot before consuming credentials', async () => {
    const f = await managed();
    const s = await f.open();
    await expect(s.prompt('Hello', { ...s.snapshot, runtimeEpoch: randomUUID() })).rejects.toThrow(
      'pi_acp_host_snapshot_mismatch'
    );
    expect(f.observed).toEqual([]);
    expect(f.pipe.destroyed).toBe(true);
  });

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

  it('runs an OpenAI OAuth connection on the public OpenAI preset', async () => {
    const f = await managed({
      config: {
        connection: {
          schemaVersion: 1,
          id: 'connection',
          revision: 1,
          providerPresetId: 'openai',
          displayName: 'OpenAI OAuth',
          baseUrl: PROVIDER_PRESET_DEFAULT_BASE_URLS.openai,
          credentialRef: 'protected-reference',
          enabled: true,
          authType: 'openai_oauth',
          oauth: { email: 'designer@example.com', plan: 'plus', accountId: 'acct-1' },
        },
        selection: { connectionId: 'connection', modelId: 'gpt-5.2', thinking: 'low' },
      },
    });
    const s = await f.open();
    // The official flow talks to api.openai.com directly on the public preset;
    // no codex backend provider is registered.
    expect(f.runtime().getRegisteredProviderConfig('openai-codex')).toBeUndefined();
    f.grant(s.snapshot, 'SYNTHETIC_OAUTH_TOKEN', 'acct-1');
    await s.prompt().catch(() => undefined);
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

  it('accepts protected custom HTTP headers and replaces public values case-insensitively', () => {
    const connection: McpCredentialBinding = {
      workspaceId: 'workspace',
      serverId: 'server',
      credentialRef: randomUUID(),
      revision: 1,
      destination: { transport: 'http', url: 'https://synthetic.invalid/mcp' },
      fieldNames: ['X-Api-Key'],
    };
    expect(
      acpMcpConfig(
        [
          {
            type: 'http',
            name: 'server',
            url: connection.destination.transport === 'http' ? connection.destination.url : '',
            headers: [
              { name: 'x-api-key', value: 'stale' },
              { name: 'X-Public', value: 'public' },
            ],
            _meta: { mollyMcpCredential: connection },
          },
        ],
        '/synthetic',
        [{ connection, values: { 'X-Api-Key': '!secret${HOME}' } }]
      )
    ).toEqual([
      {
        name: 'server',
        config: {
          type: 'http',
          url: 'https://synthetic.invalid/mcp',
          headers: { 'X-Public': 'public', 'X-Api-Key': '$!secret$${HOME}' },
        },
      },
    ]);
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

  it('keeps provider system bytes stable across turns and fresh host reload, then refreshes a new session', async () => {
    let instant = new Date('2026-10-17T12:00:00.123Z');
    let preference = 'Likes muted color';
    const options = {
      time: { now: () => instant, resolveTimeZone: () => 'America/Los_Angeles' },
      memoryResponse: '{"changes":[]}',
      peer: {
        extMethod: async () => ({
          revision: preference,
          enabled: true,
          entries: [{ id: 'p1', text: preference }],
        }),
      },
    };
    const f = await managed({
      ...options,
      config: {
        personalMemory: true,
        readBeforeEditReminder: 'Read before editing synthetic files.',
      },
    });
    const first = await f.open();
    const systemBytes = (observed: string): string =>
      JSON.stringify(
        JSON.parse(observed)
          .messages.filter((message: { role: string }) => message.role === 'system')
          .map((message: { content: unknown; sections?: unknown }) => ({
            content: message.content,
            sections: message.sections,
          }))
      );
    const systems: string[] = [];
    for (let turn = 1; turn <= 3; turn++) {
      const snapshot = { ...first.snapshot, runId: `stable-${turn}`, turnId: `turn-${turn}` };
      f.grant(snapshot);
      expect((await first.prompt(`Synthetic turn ${turn}`, snapshot)).stopReason).toBe('end_turn');
      const main = JSON.parse(f.observed.at(-2)!);
      systems.push(systemBytes(f.observed.at(-2)!));
      expect(
        main.messages.filter((message: { role: string }) => message.role === 'user')
      ).toHaveLength(turn);
      instant = new Date(instant.getTime() + 60_000);
      preference = `Current preference after turn ${turn}`;
    }
    expect(systems[0]).toContain('2026-10-17T12:00:00.123Z');
    expect(systems[0]).toContain('Likes muted color');
    expect(systems[0]).toContain(f.config.readBeforeEditReminder);
    expect(systems).toEqual([systems[0], systems[0], systems[0]]);
    await f.agent.dispose();
    vi.restoreAllMocks();
    const restored = await managed({
      ...options,
      config: {
        ...f.config,
        runtimeEpoch: randomUUID(),
        nativeSessionId: first.response.sessionId,
        systemPrompt: 'Changed worker host context.',
        readBeforeEditReminder: 'Changed worker reminder.',
      },
    });
    const resumed = await restored.open();
    const resumeSnapshot = { ...resumed.snapshot, runId: 'resumed-run' };
    restored.grant(resumeSnapshot);
    expect((await resumed.prompt('Synthetic resumed turn', resumeSnapshot)).stopReason).toBe(
      'end_turn'
    );
    expect(systemBytes(restored.observed[0]!)).toBe(systems[0]);
    await restored.agent.dispose();
    vi.restoreAllMocks();
    const next = await managed({
      ...options,
      config: { ...f.config, runtimeEpoch: randomUUID(), productSessionId: 'next-product-session' },
    });
    const fresh = await next.open();
    const freshSnapshot = { ...fresh.snapshot, runId: 'fresh-run' };
    next.grant(freshSnapshot);
    expect((await fresh.prompt('Synthetic fresh turn', freshSnapshot)).stopReason).toBe('end_turn');
    const freshSystem = systemBytes(next.observed[0]!);
    expect(freshSystem).not.toBe(systems[0]);
    expect(freshSystem).toContain(instant.toISOString());
    expect(freshSystem).toContain(preference);
    expect(freshSystem).not.toContain('Likes muted color');
  });

  it('recalls personal preferences into context and captures new ones after completion', async () => {
    const operations: unknown[] = [];
    const usage: Record<string, unknown>[] = [];
    const f = await managed({
      config: { personalMemory: true },
      peer: {
        extNotification: async (method, params) => {
          if (method === LODY_EXTENSION_METHODS.sessionUsageUpdate) usage.push(params);
        },
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
    expect(usage.at(-1)).toMatchObject({
      modelUsage: { [`${providerId}/model`]: { inputTokens: 26, outputTokens: 6 } },
      usage: { costUSD: 0.015 },
    });
    const history = await readFile(s.binding.nativeSessionFile, 'utf8');
    const entries = history
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(entries).toContainEqual(
      expect.objectContaining({
        type: 'usage',
        kind: 'personal_memory_extraction',
        provider: providerId,
        model: 'model',
      })
    );
    expect(history).not.toContain('Prefers serif type');
  });

  it('accounts measured extraction usage and fails soft with a logged code on prose output', async () => {
    const usage: Record<string, unknown>[] = [];
    const operations: unknown[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const f = await managed({
        config: { personalMemory: true },
        memoryResponse: 'No durable personal preferences were stated.',
        peer: {
          extMethod: async (_method, params) => {
            operations.push(
              z.object({ request: z.object({ operation: z.unknown() }) }).parse(params).request
                .operation
            );
            return { revision: 'r1', enabled: true, entries: [] };
          },
          extNotification: async (method, params) => {
            if (method === LODY_EXTENSION_METHODS.sessionUsageUpdate) usage.push(params);
          },
        },
      });
      const s = await f.open();
      f.grant(s.snapshot);
      const result = await s.prompt('I prefer serif type.');
      expect(result._meta).toMatchObject({
        mollyPersonalMemory: 'unchanged',
        mollyPersonalMemoryDiagnostic: 'memory_extraction_not_json',
        mollyNativeOutcome: { status: 'completed' },
      });
      expect(operations).toEqual([{ action: 'read' }]);
      expect(stderr).toHaveBeenCalledWith(
        'molly_personal_memory_diagnostic memory_extraction_not_json\n'
      );
      expect(JSON.stringify(stderr.mock.calls)).not.toContain('durable personal');
      expect(usage.at(-1)).toMatchObject({
        modelUsage: { [`${providerId}/model`]: { inputTokens: 26, outputTokens: 6 } },
        usage: { costUSD: 0.015 },
      });
    } finally {
      stderr.mockRestore();
    }
  });

  it('captures preferences from a fenced JSON extraction reply', async () => {
    const operations: unknown[] = [];
    const f = await managed({
      config: { personalMemory: true },
      memoryResponse: 'Sure:\n```json\n{"changes":[{"text":"Prefers serif type"},]}\n```',
      peer: {
        extMethod: async (_method, params) => {
          operations.push(
            z.object({ request: z.object({ operation: z.unknown() }) }).parse(params).request
              .operation
          );
          return { revision: 'r1', enabled: true, entries: [] };
        },
      },
    });
    const s = await f.open();
    f.grant(s.snapshot);
    const result = await s.prompt('I prefer serif type.');
    expect(result._meta?.mollyPersonalMemory).toBe('saved');
    expect(result._meta?.mollyPersonalMemoryDiagnostic).toBeUndefined();
    expect(operations).toEqual([
      { action: 'read' },
      { action: 'capture', revision: 'r1', changes: [{ text: 'Prefers serif type' }] },
    ]);
  });

  it('reports capture_failed with the peer error code when the store rejects a capture', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const f = await managed({
        config: { personalMemory: true },
        peer: {
          extMethod: async (_method, params) => {
            const { operation } = z
              .object({ request: z.object({ operation: z.object({ action: z.string() }) }) })
              .parse(params).request;
            if (operation.action === 'capture') throw new Error('memory_stale');
            return { revision: 'r1', enabled: true, entries: [] };
          },
        },
      });
      const s = await f.open();
      f.grant(s.snapshot);
      const result = await s.prompt('I prefer serif type.');
      expect(result._meta).toMatchObject({
        mollyPersonalMemory: 'capture_failed',
        mollyPersonalMemoryDiagnostic: 'memory_stale',
        mollyNativeOutcome: { status: 'completed' },
      });
      expect(stderr).toHaveBeenCalledWith('molly_personal_memory_diagnostic memory_stale\n');
    } finally {
      stderr.mockRestore();
    }
  });

  it('accounts an extraction result before cancellation and preserves the completed main receipt', async () => {
    const received: Record<string, unknown>[] = [];
    const publishing = deferred<void>();
    const release = deferred<void>();
    const f = await managed({
      config: { personalMemory: true },
      peer: {
        extMethod: async () => ({ revision: 'r1', enabled: true, entries: [] }),
        extNotification: async (method, params) => {
          if (method !== LODY_EXTENSION_METHODS.sessionUsageUpdate) return;
          received.push(params);
          const update = z.object({ usage: z.object({ inputTokens: z.number() }) }).parse(params);
          if (update.usage.inputTokens === 3) {
            publishing.resolve();
            await release.promise;
          }
        },
      },
    });
    const s = await f.open();
    f.grant(s.snapshot);
    const running = s.prompt('I prefer serif type.');
    await Promise.race([
      publishing.promise,
      running.then(() => {
        throw new Error('Extraction usage was not published');
      }),
    ]);
    const cancelling = f.agent.cancel({ sessionId: s.response.sessionId });
    release.resolve();
    const result = await running;
    await cancelling;
    expect(result._meta).toMatchObject({
      mollyPersonalMemory: 'cancelled',
      mollyNativeOutcome: { status: 'completed', nativeEndEntryId: expect.any(String) },
    });
    expect(received.at(-1)).toMatchObject({
      modelUsage: { [`${providerId}/model`]: { inputTokens: 26, outputTokens: 6 } },
      usage: { inputTokens: 3, outputTokens: 1, costUSD: 0.015 },
    });
    const entries = (await readFile(s.binding.nativeSessionFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(entries).toContainEqual(
      expect.objectContaining({ type: 'usage', kind: 'personal_memory_extraction' })
    );
  });
});

describe('session system prompt toolset fingerprint', () => {
  const reloadOptions = () => {
    const state = {
      instant: new Date('2026-10-17T12:00:00.000Z'),
      preference: 'Likes muted color',
    };
    return {
      state,
      options: {
        time: { now: () => state.instant, resolveTimeZone: () => 'America/Los_Angeles' },
        memoryResponse: '{"changes":[]}',
        peer: {
          extMethod: async () => ({
            revision: state.preference,
            enabled: true,
            entries: [{ id: 'p1', text: state.preference }],
          }),
        },
      },
    };
  };
  const toolExtension =
    (register: boolean): InlineExtension =>
    (pi) => {
      if (register) {
        pi.on('session_start', () =>
          pi.setActiveTools([...pi.getActiveTools(), 'synthetic_added_tool'])
        );
        pi.registerTool({
          name: 'synthetic_added_tool',
          label: 'Synthetic added tool',
          description: 'Synthetic tool present only in some workers',
          parameters: { type: 'object', properties: {} },
          execute: async () => ({ content: [{ type: 'text', text: 'unused' }], details: {} }),
        });
      }
    };
  const systemText = (observed: string): string =>
    JSON.stringify(
      JSON.parse(observed).messages.filter((message: { role: string }) => message.role === 'system')
    );
  const savedEntries = async (file: string) =>
    (await readFile(file, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter(
        (entry) => entry.type === 'custom' && entry.customType === 'molly_host_system_prompt'
      );
  type Fixture = Awaited<ReturnType<typeof managed>>;
  const worker = async (
    options: ReturnType<typeof reloadOptions>['options'],
    register: boolean,
    base?: Fixture['config'],
    nativeSessionId?: string,
    productionProfile = false
  ) => {
    const f = await managed({
      ...options,
      productionProfile,
      extensions: [toolExtension(register)],
      config: {
        personalMemory: true,
        ...base,
        ...(base ? { runtimeEpoch: randomUUID(), nativeSessionId } : {}),
      },
    });
    const session = await f.open();
    const turn = async (runId: string) => {
      const snapshot = { ...session.snapshot, runId, turnId: runId };
      f.grant(snapshot);
      expect((await session.prompt(`Synthetic ${runId}`, snapshot)).stopReason).toBe('end_turn');
      return systemText(f.observed.filter((body) => !body.includes('Extract only')).at(-1)!);
    };
    const close = async () => {
      await f.agent.dispose();
      vi.restoreAllMocks();
    };
    return { f, session, turn, close };
  };

  it.each([
    ['adds', false, true],
    ['removes', true, false],
  ])(
    'rebuilds once with fresh time and memory when the next worker %s a tool',
    async (_, before, after) => {
      const { state, options } = reloadOptions();
      const first = await worker(options, before);
      const original = await first.turn('first');
      expect(original).toContain('2026-10-17T12:00:00.000Z');
      expect(original).toContain('Likes muted color');
      await first.close();
      state.instant = new Date('2026-10-18T09:30:00.000Z');
      state.preference = 'Prefers bold contrast';
      const second = await worker(options, after, first.f.config, first.session.response.sessionId);
      expect(second.session.binding.pluginSetHash).toBe(first.session.binding.pluginSetHash);
      expect(second.session.binding.toolsetHash).not.toBe(first.session.binding.toolsetHash);
      const rebuilt = await second.turn('second');
      expect(rebuilt).not.toBe(original);
      expect(rebuilt).toContain('2026-10-18T09:30:00.000Z');
      expect(rebuilt).toContain('Prefers bold contrast');
      expect(rebuilt).not.toContain('Likes muted color');
      expect(rebuilt.includes('synthetic_added_tool')).toBe(after);
      state.instant = new Date('2026-10-19T00:00:00.000Z');
      expect(await second.turn('third')).toBe(rebuilt);
      const entries = await savedEntries(second.session.binding.nativeSessionFile);
      expect(entries.map((entry) => entry.data.toolsetHash)).toEqual([
        first.session.binding.toolsetHash,
        second.session.binding.toolsetHash,
      ]);
      expect(entries.map((entry) => entry.data.version)).toEqual([2, 2]);
      await second.close();
    }
  );

  it('keeps byte-identical prompts across production-profile workers with an unchanged toolset', async () => {
    const { state, options } = reloadOptions();
    const first = await worker(options, true, undefined, undefined, true);
    const original = await first.turn('first');
    await first.close();
    state.instant = new Date('2026-10-18T09:30:00.000Z');
    state.preference = 'Prefers bold contrast';
    const second = await worker(
      options,
      true,
      first.f.config,
      first.session.response.sessionId,
      true
    );
    expect(second.session.binding.toolsetHash).toBe(first.session.binding.toolsetHash);
    expect(second.session.binding.pluginSetHash).toBe(first.session.binding.pluginSetHash);
    expect(await second.turn('second')).toBe(original);
    expect(await savedEntries(second.session.binding.nativeSessionFile)).toHaveLength(1);
    await second.close();
  });

  it('lets the latest of duplicate entries win across workers', async () => {
    const { state, options } = reloadOptions();
    const first = await worker(options, false);
    await first.turn('first');
    await first.close();
    state.instant = new Date('2026-10-18T09:30:00.000Z');
    const second = await worker(options, true, first.f.config, first.session.response.sessionId);
    const rebuilt = await second.turn('second');
    await second.close();
    state.instant = new Date('2026-10-19T00:00:00.000Z');
    const third = await worker(options, true, first.f.config, first.session.response.sessionId);
    expect(await third.turn('third')).toBe(rebuilt);
    expect(await savedEntries(third.session.binding.nativeSessionFile)).toHaveLength(2);
    await third.close();
  });

  it.each([1, 3])(
    'rebuilds a version %s entry exactly once, then reuses the rebuilt bytes',
    async (version) => {
      const { state, options } = reloadOptions();
      const first = await worker(options, false);
      const original = await first.turn('first');
      await first.close();
      const file = first.session.binding.nativeSessionFile;
      const lines = (await readFile(file, 'utf8')).split('\n');
      await writeFile(
        file,
        lines
          .map((line) => {
            if (!line) return line;
            const entry = JSON.parse(line);
            if (entry.customType !== 'molly_host_system_prompt') return line;
            return JSON.stringify({
              ...entry,
              data: { version, systemPrompt: entry.data.systemPrompt },
            });
          })
          .join('\n')
      );
      state.instant = new Date('2026-10-18T09:30:00.000Z');
      const second = await worker(options, false, first.f.config, first.session.response.sessionId);
      const rebuilt = await second.turn('second');
      expect(rebuilt).not.toBe(original);
      expect(rebuilt).toContain('2026-10-18T09:30:00.000Z');
      await second.close();
      state.instant = new Date('2026-10-19T00:00:00.000Z');
      const third = await worker(options, false, first.f.config, first.session.response.sessionId);
      expect(await third.turn('third')).toBe(rebuilt);
      expect((await savedEntries(file)).map((entry) => entry.data.version)).toEqual([version, 2]);
      await third.close();
    }
  );

  it('opens a genuine Pi 1.0.4-written v1 session and rebuilds once on 1.3.0', async () => {
    const { state, options } = reloadOptions();
    const id = randomUUID();
    const f = await managed({
      ...options,
      extensions: [toolExtension(false)],
      config: { nativeSessionId: id, personalMemory: true },
    });
    const baseline = JSON.parse(
      await readFile(new URL('./fixtures/pi-1.0.4-session.json', import.meta.url), 'utf8')
    );
    expect(baseline.writtenBy.version).toBe('1.0.4');
    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    const directory = join(
      f.root,
      'sessions',
      digest(f.config.connection.id),
      digest(f.config.productSessionId)
    );
    await mkdir(directory, { recursive: true });
    const file = join(directory, `2026-10-17T12-00-00-000Z_${id}.jsonl`);
    const original =
      [
        JSON.stringify({ ...baseline.header, id, cwd: f.cwd }),
        ...baseline.entries.map((entry: unknown) => JSON.stringify(entry)),
      ].join('\n') + '\n';
    await writeFile(file, original);
    const session = await f.open();
    expect(await readFile(file, 'utf8')).toBe(original);
    f.grant(session.snapshot);
    await session.prompt();
    const rebuilt = systemText(f.observed[0]!);
    expect(rebuilt).not.toContain('Synthetic Pi 1.0.4 frozen host prompt.');
    expect(rebuilt).toContain('Likes muted color');
    expect(f.updates).toContainEqual(
      expect.objectContaining({
        update: {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'Synthetic legacy greeting.' },
        },
      })
    );
    await f.agent.dispose();
    vi.restoreAllMocks();
    state.instant = new Date('2026-10-19T00:00:00.000Z');
    const next = await worker(options, false, f.config, id);
    expect(await next.turn('reopened')).toBe(rebuilt);
    expect((await savedEntries(file)).map((entry) => entry.data.version)).toEqual([1, 2]);
    await next.close();
  });

  it('refuses a malformed saved entry without rewriting history or inferring', async () => {
    const { options } = reloadOptions();
    const first = await worker(options, false);
    await first.turn('first');
    await first.close();
    const file = first.session.binding.nativeSessionFile;
    const corrupted = (await readFile(file, 'utf8'))
      .split('\n')
      .map((line) => {
        if (!line) return line;
        const entry = JSON.parse(line);
        if (entry.customType !== 'molly_host_system_prompt') return line;
        return JSON.stringify({ ...entry, data: { version: 2, systemPrompt: 'Missing hashes' } });
      })
      .join('\n');
    await writeFile(file, corrupted);
    const bind = vi.spyOn(PiAcpHost.prototype, 'bind');
    const f = await managed({
      ...options,
      extensions: [toolExtension(false)],
      config: {
        ...first.f.config,
        runtimeEpoch: randomUUID(),
        nativeSessionId: first.session.response.sessionId,
      },
    });
    await expect(f.open()).rejects.toThrow('pi_acp_session_setup_failed');
    await expect(bind.mock.results[0]!.value).rejects.toThrow(
      'pi_acp_host_invalid_system_prompt_snapshot'
    );
    expect(await readFile(file, 'utf8')).toBe(corrupted);
    expect(f.observed).toEqual([]);
    await f.agent.dispose();
    vi.restoreAllMocks();
  });
});
