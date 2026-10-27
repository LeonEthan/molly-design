import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import {
  HarnessModelCatalogSchema,
  MOLLY_PROVIDER_IDS,
  PI_ENGINE_VERSION,
} from '@molly/shared/embedded-harness';
import {
  createNativeModelRuntime,
  NATIVE_OVERLAY_MODEL_ID,
  NATIVE_OVERLAY_PROVIDER_ID,
  type NativeModelOverlay,
} from './native-model-overlay';

export { parseNativeModelOverlay, resolveNativeModelOverlay } from './native-model-overlay';

/** Build-time, offline projection from the same sealed runtime used by workers. */
export async function createBundledModelCatalog(overlay?: NativeModelOverlay) {
  const runtime = await createNativeModelRuntime(overlay);
  const catalogModels = Object.entries(MOLLY_PROVIDER_IDS).flatMap(
    ([providerPresetId, providerId]) =>
      runtime.getModels(providerId).map((model) => ({
        providerPresetId,
        modelId: model.id,
        name: model.name,
        input: model.input,
        contextWindow: model.contextWindow,
        thinking: getSupportedThinkingLevels(model),
      }))
  );
  if (
    !catalogModels.some(
      (model) =>
        model.providerPresetId === NATIVE_OVERLAY_PROVIDER_ID &&
        model.modelId === NATIVE_OVERLAY_MODEL_ID
    )
  )
    throw new Error('harness_native_model_overlay_required_model_missing');
  return HarnessModelCatalogSchema.parse({
    version: 1,
    engineVersion: PI_ENGINE_VERSION,
    models: catalogModels,
  });
}
