import { afterEach, expect, it, vi } from 'vitest';
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  normalizeContext,
} from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  MOLLY_PROVIDER_IDS,
  PROVIDER_PRESET_CHECKS,
  PROVIDER_PRESET_DEFAULT_BASE_URLS,
  ProviderPresetIdSchema,
  type ModelConnection,
  type ProviderPresetId,
} from '@molly/shared/embedded-harness';
import { configureModelConnection } from '../src/model-connection';

const nativePresets = ProviderPresetIdSchema.options.filter(
  (preset) => preset !== 'openai-compatible'
);

afterEach(() => vi.unstubAllEnvs());

const offlineRuntime = () =>
  ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });

const connection = (providerPresetId: ProviderPresetId, baseUrl: string): ModelConnection => ({
  schemaVersion: 1,
  id: 'connection',
  revision: 1,
  providerPresetId,
  displayName: 'Synthetic',
  baseUrl,
  credentialRef: 'protected-reference',
  enabled: true,
});

const selecting = (modelId: string) => ({
  connectionId: 'connection',
  modelId,
  thinking: 'off' as const,
});

it('suggests the endpoint most pinned SDK models of each native preset use', async () => {
  const runtime = await offlineRuntime();
  expect(Object.keys(PROVIDER_PRESET_DEFAULT_BASE_URLS).sort()).toEqual([...nativePresets].sort());
  for (const preset of nativePresets) {
    const counts = new Map<string, number>();
    for (const model of runtime.getModels(MOLLY_PROVIDER_IDS[preset])) {
      counts.set(model.baseUrl, (counts.get(model.baseUrl) ?? 0) + 1);
    }
    const [mostUsed] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    expect({ preset, endpoint: PROVIDER_PRESET_DEFAULT_BASE_URLS[preset] }).toEqual({
      preset,
      endpoint: mostUsed,
    });
  }
});

it.each(['https://api.kimi.com/coding', 'https://api.kimi.com/coding/'])(
  'loads a legacy saved Kimi %s as the SDK default OpenAI endpoint',
  async (baseUrl) => {
    const runtime = await offlineRuntime();
    const model = runtime.getModel('kimi-coding', 'kimi-for-coding');
    expect(model?.api).toBe('openai-completions');
    expect(
      configureModelConnection(
        runtime,
        connection('kimi-coding', baseUrl),
        selecting('kimi-for-coding')
      )
    ).toEqual({ providerId: 'kimi-coding', baseUrl: 'https://api.kimi.com/coding/v1' });
    expect(runtime.getRegisteredProviderConfig('kimi-coding')).toBeUndefined();
  }
);

it('keeps every SDK model on its own endpoint while a connection uses the default', async () => {
  for (const preset of nativePresets) {
    const runtime = await offlineRuntime();
    const providerId = MOLLY_PROVIDER_IDS[preset];
    for (const model of runtime.getModels(providerId)) {
      expect(
        configureModelConnection(
          runtime,
          connection(preset, PROVIDER_PRESET_DEFAULT_BASE_URLS[preset]),
          selecting(model.id)
        )
      ).toEqual({ providerId, baseUrl: model.baseUrl });
    }
    expect(runtime.getRegisteredProviderConfig(providerId)).toBeUndefined();
  }
});

it('serves OpenRouter Claude models from /api even though the default is /api/v1', async () => {
  const runtime = await offlineRuntime();
  const claude = runtime
    .getModels(MOLLY_PROVIDER_IDS.openrouter)
    .find((model) => model.api === 'anthropic-messages');
  expect(
    configureModelConnection(
      runtime,
      connection('openrouter', 'https://openrouter.ai/api/v1/'),
      selecting(claude!.id)
    )
  ).toEqual({ providerId: MOLLY_PROVIDER_IDS.openrouter, baseUrl: 'https://openrouter.ai/api' });
});

it('sends every model of a connection with a custom endpoint to that endpoint', async () => {
  const runtime = await offlineRuntime();
  const providerId = MOLLY_PROVIDER_IDS.openrouter;
  const models = runtime.getModels(providerId);
  const endpoint = 'https://gateway.example.invalid/v1';
  configureModelConnection(runtime, connection('openrouter', endpoint), selecting(models[0]!.id));
  expect(new Set(runtime.getModels(providerId).map((model) => model.baseUrl))).toEqual(
    new Set([endpoint])
  );
  expect(runtime.getRegisteredProviderConfig(providerId)).toEqual({ baseUrl: endpoint });
});

it('checks each native preset through the protocol all of its SDK models use', async () => {
  const runtime = await offlineRuntime();
  const protocolOf = (api: string) =>
    api.startsWith('openai-')
      ? 'openai'
      : api === 'anthropic-messages'
        ? 'anthropic'
        : api === 'google-generative-ai'
          ? 'google'
          : api;
  for (const preset of nativePresets) {
    const protocols = new Set(
      runtime.getModels(MOLLY_PROVIDER_IDS[preset]).map((model) => protocolOf(model.api))
    );
    expect({ preset, check: PROVIDER_PRESET_CHECKS[preset] }).toEqual({
      preset,
      check: preset === 'openrouter' ? 'openrouter' : [...protocols].join(),
    });
  }
  expect(PROVIDER_PRESET_CHECKS['openai-compatible']).toBe('openai');
});

it('refuses a model the connection no longer offers in the conversation picker', async () => {
  const runtime = await offlineRuntime();
  const [first, second] = runtime.getModels(MOLLY_PROVIDER_IDS.anthropic);
  const narrowed = {
    ...connection('anthropic', PROVIDER_PRESET_DEFAULT_BASE_URLS.anthropic),
    models: [first!.id],
  };
  expect(configureModelConnection(runtime, narrowed, selecting(first!.id)).providerId).toBe(
    MOLLY_PROVIDER_IDS.anthropic
  );
  expect(() => configureModelConnection(runtime, narrowed, selecting(second!.id))).toThrow(
    'harness_model_not_in_catalog'
  );
});

it.each(['', 'SYNTHETIC_KEY'])('uses only the granted compatible credential: %s', async (key) => {
  const credentials = new InMemoryCredentialStore();
  vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_AMBIENT_SECRET');
  const runtime = await ModelRuntime.create({
    credentials,
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const configured = configureModelConnection(
    runtime,
    {
      ...connection('openai-compatible', 'http://127.0.0.1:1234/v1'),
      customModels: [
        {
          modelId: 'synthetic',
          name: 'Synthetic',
          input: ['text'],
          contextWindow: 4096,
          maxTokens: 1024,
          thinking: ['off'],
          toolCalls: true,
          maxTokensField: 'max_tokens',
        },
      ],
    },
    selecting('synthetic')
  );
  expect(await runtime.getAuth(configured.providerId)).toBeUndefined();
  await credentials.modify(configured.providerId, async () => ({ type: 'api_key', key }));
  const requests: { url: string; authorization: string | null }[] = [];
  const model = runtime.getModel(configured.providerId, 'synthetic')!;
  const result = await runtime
    .streamSimple(
      model,
      {
        messages: [{ role: 'user', content: 'synthetic prompt', timestamp: 1 }],
      },
      {
        fetch: async (url, init) => {
          requests.push({
            url: String(url),
            authorization: new Headers(init?.headers).get('authorization'),
          });
          return new Response(
            `data: ${JSON.stringify({
              id: 'synthetic',
              choices: [{ index: 0, delta: { content: 'reply' }, finish_reason: 'stop' }],
            })}\n\ndata: [DONE]\n\n`,
            { headers: { 'content-type': 'text/event-stream' } }
          );
        },
      }
    )
    .result();
  expect(result.stopReason).toBe('stop');
  expect(requests).toEqual([
    {
      url: 'http://127.0.0.1:1234/v1/chat/completions',
      authorization: key ? `Bearer ${key}` : null,
    },
  ]);
  expect(JSON.stringify(requests)).not.toContain('SYNTHETIC_AMBIENT_SECRET');
});

it('omits x-api-key when an anthropic-messages connection has no key', async () => {
  const credentials = new InMemoryCredentialStore();
  const runtime = await ModelRuntime.create({
    credentials,
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const configured = configureModelConnection(
    runtime,
    {
      ...connection('openai-compatible', 'https://api.deepseek.com/anthropic'),
      compatibleApi: 'anthropic-messages',
      customModels: [
        {
          modelId: 'deepseek-flash',
          name: 'DeepSeek Flash',
          input: ['text'],
          contextWindow: 65536,
          maxTokens: 8192,
          thinking: ['off'],
          toolCalls: true,
          maxTokensField: 'max_tokens',
        },
      ],
    },
    selecting('deepseek-flash')
  );
  await credentials.modify(configured.providerId, async () => ({ type: 'api_key', key: '' }));
  const headers: { apiKey: string | null }[] = [];
  const model = runtime.getModel(configured.providerId, 'deepseek-flash')!;
  const result = await runtime
    .streamSimple(
      model,
      { messages: [{ role: 'user', content: 'synthetic prompt', timestamp: 1 }] },
      {
        fetch: async (_url, init) => {
          headers.push({ apiKey: new Headers(init?.headers).get('x-api-key') });
          return new Response(
            `event: message_start\ndata: ${JSON.stringify({
              type: 'message_start',
              message: {
                id: 'synthetic',
                type: 'message',
                role: 'assistant',
                content: [],
                model: 'deepseek-flash',
                usage: { input_tokens: 1, output_tokens: 1 },
              },
            })}\n\nevent: content_block_start\ndata: ${JSON.stringify({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            })}\n\nevent: content_block_delta\ndata: ${JSON.stringify({
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'ok' },
            })}\n\nevent: message_delta\ndata: ${JSON.stringify({
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: { output_tokens: 1 },
            })}\n\nevent: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
            { headers: { 'content-type': 'text/event-stream' } }
          );
        },
      }
    )
    .result();
  expect(result.stopReason).toBe('stop');
  expect(headers[0]?.apiKey).toBeNull();
});

it.each([undefined, false, true])(
  'requests streaming usage only for an explicit compatible-model capability: %s',
  async (usageInStreaming) => {
    let requestBody: unknown;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        `data: ${JSON.stringify({
          id: 'synthetic-completion',
          choices: [{ index: 0, delta: { content: 'synthetic reply' }, finish_reason: 'stop' }],
        })}\n\ndata: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } }
      );
    });
    try {
      const runtime = await offlineRuntime();
      const configured = configureModelConnection(
        runtime,
        {
          ...connection('openai-compatible', 'https://synthetic.example.invalid/v1'),
          customModels: [
            {
              modelId: 'synthetic-model',
              name: 'Synthetic',
              input: ['text'],
              contextWindow: 4096,
              maxTokens: 1024,
              thinking: ['off'],
              toolCalls: true,
              maxTokensField: 'max_tokens',
              ...(usageInStreaming === undefined ? {} : { usageInStreaming }),
            },
          ],
        },
        selecting('synthetic-model')
      );
      const model = runtime.getModel(configured.providerId, 'synthetic-model');
      if (!model || model.api !== 'openai-completions') throw new Error('missing synthetic model');
      const response = await streamSimple(
        { ...model, api: 'openai-completions' },
        normalizeContext({
          messages: [{ role: 'user', content: 'synthetic prompt', timestamp: 1 }],
        }),
        { apiKey: 'synthetic-key' }
      ).result();
      expect(response.stopReason).toBe('stop');
      expect(requestBody).toEqual(
        usageInStreaming === true
          ? expect.objectContaining({ stream_options: { include_usage: true } })
          : expect.not.objectContaining({ stream_options: expect.anything() })
      );
    } finally {
      fetchMock.mockRestore();
    }
  }
);
