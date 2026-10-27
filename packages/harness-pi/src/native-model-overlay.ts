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
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { PI_ENGINE_VERSION } from '@molly/shared/embedded-harness';
import { z } from 'zod';

export const NATIVE_OVERLAY_PROVIDER_ID = 'kimi-coding';
export const NATIVE_OVERLAY_MODEL_ID = 'k3.1-pro';
export const NATIVE_OVERLAY_RESOURCE = 'native-model-overlay.json';

const NativeTargetModelSchema = z
  .object({
    id: z.literal(NATIVE_OVERLAY_MODEL_ID),
    name: z.string().trim().min(1).max(300),
    api: z.literal('openai-completions'),
    provider: z.literal(NATIVE_OVERLAY_PROVIDER_ID),
    baseUrl: z.literal('https://api.kimi.com/coding/v1'),
    input: z.tuple([z.literal('text'), z.literal('image')]),
    inputLimits: z
      .object({
        images: z
          .object({
            resize: z
              .object({
                maxWidth: z.number().int().positive(),
                maxHeight: z.number().int().positive(),
                maxBytes: z.number().int().positive(),
                jpegQuality: z.number().positive().max(100),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
    cost: z
      .object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        cacheRead: z.number().nonnegative(),
        cacheWrite: z.number().nonnegative(),
      })
      .strict(),
    type: z.literal('chat'),
    reasoning: z.literal(true),
    thinkingLevelMap: z
      .object({
        off: z.null(),
        minimal: z.null(),
        low: z.literal('low'),
        medium: z.null(),
        high: z.literal('high'),
        xhigh: z.null(),
        max: z.literal('max'),
      })
      .strict(),
    contextWindow: z.literal(1_048_576),
    maxTokens: z.literal(131_072),
    compat: z
      .object({
        supportsStrictMode: z.literal(false),
        supportsStore: z.literal(false),
        supportsDeveloperRole: z.literal(false),
        supportsReasoningEffort: z.literal(true),
        maxTokensField: z.literal('max_tokens'),
        thinkingFormat: z.literal('openai'),
        requiresReasoningContentOnAssistantMessages: z.literal(true),
        supportsMidConvoSystemMessages: z.literal(true),
        supportsMidConvoToolAdditions: z.literal(true),
      })
      .strict(),
  })
  .strict();

const NativeModelOverlaySchema = z
  .object({
    version: z.literal(1),
    engineVersion: z.literal(PI_ENGINE_VERSION),
    providerId: z.literal(NATIVE_OVERLAY_PROVIDER_ID),
    source: z.literal('pi.dev'),
    entry: z
      .object({
        models: z.array(NativeTargetModelSchema).length(1),
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
  if (!model || !NativeTargetModelSchema.safeParse(model).success) throw overlayError('invalid');
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

export async function verifyNativeModelOverlay(
  overlay: NativeModelOverlay
): Promise<NativeModelOverlay> {
  const parsed = NativeModelOverlaySchema.parse(overlay);
  const baseline = await createNativeModelRuntime();
  if (baseline.getModel(NATIVE_OVERLAY_PROVIDER_ID, NATIVE_OVERLAY_MODEL_ID))
    throw overlayError('unexpected');
  const restored = await createNativeModelRuntime(parsed);
  const before = baseline.getModels(NATIVE_OVERLAY_PROVIDER_ID);
  const after = restored.getModels(NATIVE_OVERLAY_PROVIDER_ID);
  if (
    after.length !== before.length + 1 ||
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
    fallback?: NativeModelOverlay;
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
    const overlay = NativeModelOverlaySchema.parse({
      version: 1,
      engineVersion: PI_ENGINE_VERSION,
      providerId: NATIVE_OVERLAY_PROVIDER_ID,
      source: 'pi.dev',
      entry: {
        lastModified: entry.lastModified,
        models: entry.models.filter((model) => model.id === NATIVE_OVERLAY_MODEL_ID),
      },
    });
    return { overlay: await verifyNativeModelOverlay(overlay), source: 'refreshed' };
  } catch {
    if (options.signal?.aborted) throw overlayError('refresh_aborted');
    if (!options.fallback) throw overlayError('refresh_failed');
    try {
      return { overlay: await verifyNativeModelOverlay(options.fallback), source: 'cached' };
    } catch {
      throw overlayError('refresh_failed');
    }
  }
}
