import type { StreamOptions, ProviderStreams } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  ModelConnectionSchema,
  ModelSelectionSchema,
  MOLLY_PROVIDER_IDS,
  ModelThinkingLevelSchema,
  getModelConnectionConfigurationIssue,
  isProviderPresetDefaultEndpoint,
  normalizeCompatibleConnectionApi,
  compatibleConnectionApiRequiresKey,
  normalizeCompatibleConnectionBaseUrl,
  type CompatibleConnectionApi,
  type ModelConnection,
  type ModelSelection,
} from '@molly/shared/embedded-harness';

const fetchWithoutRedirects: NonNullable<StreamOptions['fetch']> = (input, init) =>
  globalThis.fetch(input, { ...init, redirect: 'error' });

function redirectSafeOptions<T extends StreamOptions>(api: CompatibleConnectionApi, options: T): T {
  if (api === 'openai-responses') return { ...options, fetch: fetchWithoutRedirects };
  if (api !== 'google-generative-ai') return options;
  return {
    ...options,
    onPayload: async (payload, model) => {
      const replacement = await options.onPayload?.(payload, model);
      const next = replacement === undefined ? payload : replacement;
      if (next === null || typeof next !== 'object' || Array.isArray(next))
        throw new Error('harness_model_payload_invalid');
      const config = 'config' in next ? next.config : undefined;
      if (
        config !== undefined &&
        (config === null || typeof config !== 'object' || Array.isArray(config))
      )
        throw new Error('harness_model_payload_invalid');
      const httpOptions = config && 'httpOptions' in config ? config.httpOptions : undefined;
      if (
        httpOptions !== undefined &&
        (httpOptions === null || typeof httpOptions !== 'object' || Array.isArray(httpOptions))
      )
        throw new Error('harness_model_payload_invalid');
      return {
        ...next,
        config: { ...config, httpOptions: { ...httpOptions, fetch: fetchWithoutRedirects } },
      };
    },
  };
}

export function configureModelConnection(
  runtime: ModelRuntime,
  rawConnection: ModelConnection,
  rawSelection: ModelSelection
): { providerId: string; baseUrl: string } {
  const connection = ModelConnectionSchema.parse(rawConnection);
  const selection = ModelSelectionSchema.parse(rawSelection);
  const issue = getModelConnectionConfigurationIssue(connection);
  if (issue) throw new Error(`harness_${issue}`);
  if (!connection.enabled || connection.id !== selection.connectionId)
    throw new Error('harness_connection_unavailable');
  if (connection.models && !connection.models.includes(selection.modelId))
    throw new Error('harness_model_not_in_catalog');
  const compatible = connection.providerPresetId === 'openai-compatible';
  const declared = connection.customModels?.find((model) => model.modelId === selection.modelId);
  if (compatible && !declared) throw new Error('harness_model_not_in_catalog');
  if (compatible && !declared?.thinking.includes(selection.thinking))
    throw new Error('harness_thinking_level_unsupported');
  let providerId = MOLLY_PROVIDER_IDS[connection.providerPresetId];
  if (compatible) {
    const wireApi: CompatibleConnectionApi = normalizeCompatibleConnectionApi(
      connection.compatibleApi
    );
    runtime.registerProvider(providerId, {
      baseUrl: normalizeCompatibleConnectionBaseUrl(connection.baseUrl, wireApi),
      api: wireApi,
      authHeader: wireApi === 'openai-completions' || wireApi === 'openai-responses',
      models: (connection.customModels ?? []).map((model) => ({
        id: model.modelId,
        name: model.name,
        input: model.input,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        reasoning: model.thinking.some((level) => level !== 'off'),
        thinkingLevelMap: Object.fromEntries(
          ModelThinkingLevelSchema.options.map((level) => [
            level,
            model.thinking.includes(level) ? (level === 'off' ? 'none' : level) : null,
          ])
        ),
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        compat: {
          ...(wireApi === 'anthropic-messages'
            ? { supportsReasoningEffort: false }
            : {
                thinkingFormat: 'openai' as const,
                supportsReasoningEffort: model.thinking.some((level) => level !== 'off'),
              }),
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsUsageInStreaming: model.usageInStreaming ?? false,
          supportsFinishReason: true,
          maxTokensField: model.maxTokensField,
        },
      })),
    });
    const provider = runtime.getProvider(providerId);
    if (!provider) throw new Error('harness_connection_unavailable');
    const streams: ProviderStreams = provider;
    runtime.registerNativeProvider({
      ...provider,
      stream: (model, context, options) =>
        streams.stream(model, context, redirectSafeOptions(wireApi, options ?? {})),
      streamSimple: (model, context, options) =>
        streams.streamSimple(model, context, redirectSafeOptions(wireApi, options ?? {})),
      auth: {
        apiKey: {
          name: 'Connection credential',
          async resolve({ credential }) {
            if (credential?.key === undefined) return undefined;
            if (credential.key) return { auth: { apiKey: credential.key } };
            if (compatibleConnectionApiRequiresKey(wireApi)) return undefined;
            const headers: Record<string, string | null> =
              wireApi === 'anthropic-messages'
                ? { 'x-api-key': null, Authorization: null }
                : { Authorization: null };
            return { auth: { apiKey: 'unused', headers } };
          },
        },
      },
    });
  } else if (connection.authType === 'openai_oauth') {
    // Official subscription OAuth issues an access token for the provider's own
    // endpoint; the connection keeps its preset provider and catalog. pi-ai detects
    // the non-`sk-` token on the OpenAI preset and omits rejected request fields.
    providerId = MOLLY_PROVIDER_IDS[connection.providerPresetId];
  } else if (!isProviderPresetDefaultEndpoint(connection.providerPresetId, connection.baseUrl))
    runtime.registerProvider(providerId, { baseUrl: connection.baseUrl });
  const model = runtime.getModel(providerId, selection.modelId);
  if (!model) throw new Error('harness_model_not_in_catalog');
  return { providerId, baseUrl: model.baseUrl };
}
