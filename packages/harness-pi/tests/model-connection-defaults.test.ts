import { expect, it } from 'vitest';
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  MOLLY_PROVIDER_IDS,
  PROVIDER_PRESET_DEFAULT_BASE_URLS,
  ProviderPresetIdSchema,
} from '@molly/shared/embedded-harness';

it('suggests the endpoint most pinned SDK models of each native preset use', async () => {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const nativePresets = ProviderPresetIdSchema.options.filter(
    (preset) => preset !== 'openai-compatible'
  );
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
