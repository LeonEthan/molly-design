import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Api,
  type Model,
  type ModelsStoreEntry,
} from '@earendil-works/pi-ai';
import { OpenAICompletionsCompatSchema } from '@earendil-works/pi-ai/providers/compat-schema';
import {
  ModelCostSchema,
  ModelInputLimitsSchema,
  ModelInputModalitySchema,
  ModelPromptCacheSchema,
  ThinkingLevelMapSchema,
} from '@earendil-works/pi-ai/providers/model-schema';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { PI_ENGINE_VERSION } from '@molly/shared/embedded-harness';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { z } from 'zod';

export const NATIVE_OVERLAY_PROVIDER_ID = 'kimi-coding';
export const NATIVE_OVERLAY_MODEL_ID = 'k3.1-pro';
export const NATIVE_OVERLAY_RESOURCE = 'native-model-overlay.json';

const NativeTargetModelSchema = Type.Object(
  {
    id: Type.Literal(NATIVE_OVERLAY_MODEL_ID),
    name: Type.String({ minLength: 1 }),
    api: Type.Literal('openai-completions'),
    provider: Type.Literal(NATIVE_OVERLAY_PROVIDER_ID),
    baseUrl: Type.Literal('https://api.kimi.com/coding/v1'),
    input: Type.Array(ModelInputModalitySchema, { minItems: 2, uniqueItems: true }),
    inputLimits: Type.Optional(ModelInputLimitsSchema),
    cost: ModelCostSchema,
    type: Type.Optional(Type.Literal('chat')),
    reasoning: Type.Literal(true),
    thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
    promptCache: Type.Optional(ModelPromptCacheSchema),
    contextWindow: Type.Integer({ minimum: 1 }),
    maxTokens: Type.Integer({ minimum: 1 }),
    compat: Type.Optional(OpenAICompletionsCompatSchema),
  },
  { additionalProperties: false }
);

const NativeModelOverlaySchema = z
  .object({
    version: z.literal(1),
    engineVersion: z.literal(PI_ENGINE_VERSION),
    providerId: z.literal(NATIVE_OVERLAY_PROVIDER_ID),
    source: z.literal('pi.dev'),
    entry: z
      .object({
        models: z
          .array(
            z.custom<Model<'openai-completions'>>((model) => Check(NativeTargetModelSchema, model))
          )
          .length(1),
        lastModified: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

export type NativeModelOverlay = z.infer<typeof NativeModelOverlaySchema>;
export type NativeModelOverlayResolution = {
  overlay?: NativeModelOverlay;
  source: 'builtin' | 'refreshed' | 'cached';
};

const ResourceManifestSchema = z
  .object({
    files: z.array(
      z
        .object({
          path: z.string(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .passthrough()
    ),
  })
  .passthrough();

function overlayError(code: string): Error {
  return new Error(`harness_native_model_overlay_${code}`);
}

function listedOverlay(manifest: unknown) {
  return ResourceManifestSchema.parse(manifest).files.find(
    (entry) => entry.path === NATIVE_OVERLAY_RESOURCE
  );
}

export function parseNativeModelOverlay(bytes: string, manifest: unknown): NativeModelOverlay {
  const listed = listedOverlay(manifest);
  if (!listed) throw overlayError('missing');
  if (createHash('sha256').update(bytes).digest('hex') !== listed.sha256)
    throw overlayError('checksum_mismatch');
  try {
    return NativeModelOverlaySchema.parse(JSON.parse(bytes));
  } catch {
    throw overlayError('invalid');
  }
}

export async function readNativeModelOverlay(
  manifest: unknown,
  resourceDirectory: URL
): Promise<NativeModelOverlay | undefined> {
  if (!listedOverlay(manifest)) return undefined;
  let bytes: string;
  try {
    bytes = await readFile(new URL(NATIVE_OVERLAY_RESOURCE, resourceDirectory), 'utf8');
  } catch {
    throw overlayError('missing');
  }
  return parseNativeModelOverlay(bytes, manifest);
}

function assertTarget(model: Model<Api> | undefined): void {
  if (!Check(NativeTargetModelSchema, model)) throw overlayError('invalid');
}

async function createRuntime(
  credentials: InMemoryCredentialStore,
  modelsStore: InMemoryModelsStore,
  allowModelNetwork: boolean
): Promise<ModelRuntime> {
  return ModelRuntime.create({
    credentials,
    modelsStore,
    modelsPath: null,
    catalogBaseUrl: 'https://pi.dev',
    allowModelNetwork,
    refreshOnCreate: false,
  });
}

export async function createNativeModelRuntime(
  overlay?: NativeModelOverlay,
  credentials = new InMemoryCredentialStore()
): Promise<ModelRuntime> {
  const modelsStore = new InMemoryModelsStore();
  if (overlay) {
    const parsed = NativeModelOverlaySchema.parse(overlay);
    await modelsStore.write(parsed.providerId, parsed.entry);
  }
  const runtime = await createRuntime(credentials, modelsStore, false);
  if (!overlay) return runtime;
  const refreshed = await runtime.refresh({
    providers: [overlay.providerId],
    allowNetwork: false,
  });
  if (refreshed.aborted || refreshed.errors.size > 0) throw overlayError('restore_failed');
  const models = runtime.getModels(overlay.providerId);
  if (models.filter((model) => model.id === NATIVE_OVERLAY_MODEL_ID).length !== 1)
    throw overlayError('restore_failed');
  assertTarget(runtime.getModel(overlay.providerId, NATIVE_OVERLAY_MODEL_ID));
  return runtime;
}

export async function verifyNativeModelOverlay(overlay: unknown): Promise<NativeModelOverlay> {
  const parsed = NativeModelOverlaySchema.parse(overlay);
  const baseline = await createNativeModelRuntime();
  if (baseline.getModel(NATIVE_OVERLAY_PROVIDER_ID, NATIVE_OVERLAY_MODEL_ID))
    throw overlayError('unexpected');
  const restored = await createNativeModelRuntime(parsed);
  const before = baseline.getModels(NATIVE_OVERLAY_PROVIDER_ID);
  const after = restored.getModels(NATIVE_OVERLAY_PROVIDER_ID);
  if (
    after.length !== before.length + 1 ||
    !isDeepStrictEqual(
      restored.getModel(NATIVE_OVERLAY_PROVIDER_ID, NATIVE_OVERLAY_MODEL_ID),
      parsed.entry.models[0]
    ) ||
    before.some(
      (model) =>
        !isDeepStrictEqual(
          model,
          after.find(({ id }) => id === model.id)
        )
    ) ||
    after.some((model) => model.id === 'k3.1-pro-highspeed')
  )
    throw overlayError('projection_mismatch');
  return parsed;
}

async function refreshNativeEntry(signal?: AbortSignal): Promise<ModelsStoreEntry> {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(NATIVE_OVERLAY_PROVIDER_ID, async () => ({
    type: 'api_key',
    key: 'molly-build-time-catalog-only',
  }));
  const modelsStore = new InMemoryModelsStore();
  const runtime = await createRuntime(credentials, modelsStore, true);
  const refreshed = await runtime.refresh({
    providers: [NATIVE_OVERLAY_PROVIDER_ID],
    allowNetwork: true,
    force: true,
    signal,
  });
  if (refreshed.aborted || refreshed.errors.size > 0) throw overlayError('refresh_failed');
  const entry = await modelsStore.read(NATIVE_OVERLAY_PROVIDER_ID, { signal });
  if (!entry) throw overlayError('refresh_failed');
  return entry;
}

export async function resolveNativeModelOverlay(
  options: {
    readFallback?: () => unknown;
    signal?: AbortSignal;
    refresh?: (signal?: AbortSignal) => Promise<ModelsStoreEntry>;
  } = {}
): Promise<NativeModelOverlayResolution> {
  const baseline = await createNativeModelRuntime();
  const builtin = baseline.getModel(NATIVE_OVERLAY_PROVIDER_ID, NATIVE_OVERLAY_MODEL_ID);
  if (builtin) {
    assertTarget(builtin);
    return { source: 'builtin' };
  }
  try {
    const entry = await (options.refresh ?? refreshNativeEntry)(options.signal);
    if (!Number.isInteger(entry.lastModified) || (entry.lastModified ?? 0) <= 0)
      throw overlayError('refresh_failed');
    const overlay = await verifyNativeModelOverlay({
      version: 1,
      engineVersion: PI_ENGINE_VERSION,
      providerId: NATIVE_OVERLAY_PROVIDER_ID,
      source: 'pi.dev',
      entry: {
        lastModified: entry.lastModified,
        models: entry.models.filter((model) => model.id === NATIVE_OVERLAY_MODEL_ID),
      },
    });
    return { overlay, source: 'refreshed' };
  } catch {
    if (options.signal?.aborted) throw overlayError('refresh_aborted');
    try {
      const overlay = await verifyNativeModelOverlay(options.readFallback?.());
      return { overlay, source: 'cached' };
    } catch {
      throw overlayError('refresh_failed');
    }
  }
}
