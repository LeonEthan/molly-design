import { VERSION as PI_ENGINE_VERSION } from '@earendil-works/pi-coding-agent';
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  getSupportedThinkingLevels,
} from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { HarnessModelCatalogSchema, MOLLY_PROVIDER_IDS } from '@molly/shared/embedded-harness';

/** Build-time, offline projection. Never inspects local credentials or user model files. */
export async function createBundledModelCatalog() {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  return HarnessModelCatalogSchema.parse({
    version: 1,
    engineVersion: PI_ENGINE_VERSION,
    models: Object.entries(MOLLY_PROVIDER_IDS).flatMap(([providerPresetId, providerId]) =>
      runtime.getModels(providerId).map((model) => ({
        providerPresetId,
        modelId: model.id,
        name: model.name,
        input: model.input,
        contextWindow: model.contextWindow,
        thinking: getSupportedThinkingLevels(model),
      }))
    ),
  });
}
