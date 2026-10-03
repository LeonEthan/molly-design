import { expect, it } from 'vitest';
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
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
