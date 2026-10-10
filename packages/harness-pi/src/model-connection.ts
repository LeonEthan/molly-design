import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  ModelConnectionSchema,
  ModelSelectionSchema,
  MOLLY_PROVIDER_IDS,
  ModelThinkingLevelSchema,
  getModelConnectionConfigurationIssue,
  isProviderPresetDefaultEndpoint,
  type ModelConnection,
  type ModelSelection,
} from '@molly/shared/embedded-harness';

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
  const providerId = MOLLY_PROVIDER_IDS[connection.providerPresetId];
  if (compatible)
    runtime.registerProvider(providerId, {
      baseUrl: connection.baseUrl,
      api: 'openai-completions',
      authHeader: true,
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
          thinkingFormat: 'openai',
          supportsReasoningEffort: model.thinking.some((level) => level !== 'off'),
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsUsageInStreaming: true,
          supportsFinishReason: true,
          maxTokensField: model.maxTokensField,
        },
      })),
    });
  else if (connection.authType === 'openai_oauth')
    // OAuth connections run against the ChatGPT codex backend, not the public API host.
    // The account header arrives with the credential grant; registration is stable here
    // so the host's provider fingerprint does not change at grant time.
    runtime.registerProvider(providerId, {
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      api: 'openai-codex-responses',
      authHeader: true,
      headers: { originator: 'molly' },
    });
  else if (!isProviderPresetDefaultEndpoint(connection.providerPresetId, connection.baseUrl))
    runtime.registerProvider(providerId, { baseUrl: connection.baseUrl });
  const model = runtime.getModel(providerId, selection.modelId);
  if (!model) throw new Error('harness_model_not_in_catalog');
  return { providerId, baseUrl: model.baseUrl };
}
