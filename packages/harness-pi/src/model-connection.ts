import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  ModelConnectionSchema,
  ModelSelectionSchema,
  MOLLY_PROVIDER_IDS,
  ModelThinkingLevelSchema,
  getModelConnectionConfigurationIssue,
  type ModelConnection,
  type ModelSelection,
} from '@molly/shared/embedded-harness';

export function configureModelConnection(
  runtime: ModelRuntime,
  rawConnection: ModelConnection,
  rawSelection: ModelSelection
): string {
  const connection = ModelConnectionSchema.parse(rawConnection);
  const selection = ModelSelectionSchema.parse(rawSelection);
  const issue = getModelConnectionConfigurationIssue(connection);
  if (issue) throw new Error(`harness_${issue}`);
  if (!connection.enabled || connection.id !== selection.connectionId)
    throw new Error('harness_connection_unavailable');
  const compatible = connection.providerPresetId === 'openai-compatible';
  const declared = connection.customModels?.find((model) => model.modelId === selection.modelId);
  if (compatible && !declared) throw new Error('harness_model_not_in_catalog');
  if (compatible && !declared?.thinking.includes(selection.thinking))
    throw new Error('harness_thinking_level_unsupported');
  const providerId = MOLLY_PROVIDER_IDS[connection.providerPresetId];
  runtime.registerProvider(
    providerId,
    compatible
      ? {
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
              supportsUsageInStreaming: model.usageInStreaming,
              supportsFinishReason: true,
              maxTokensField: model.maxTokensField,
            },
          })),
        }
      : { baseUrl: connection.baseUrl }
  );
  if (!runtime.getModel(providerId, selection.modelId))
    throw new Error('harness_model_not_in_catalog');
  return providerId;
}
