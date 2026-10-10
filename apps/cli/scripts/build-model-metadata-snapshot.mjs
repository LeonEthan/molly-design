const MODELS_DEV_API = 'https://models.dev/api.json';
/** Providers worth shipping: Molly's OpenAI-completions presets plus gateways/local servers
 *  commonly reached through a compatible connection. models.dev ids, not Molly presets. */
const WANTED_PROVIDERS = [
  'openai',
  'deepseek',
  'moonshotai',
  'moonshotai-cn',
  'xai',
  'groq',
  'togetherai',
  'fireworks-ai',
  'mistral',
  'zai',
  'zai-coding-plan',
  'openrouter',
  'siliconflow',
  'siliconflow-cn',
  'ollama',
  'lmstudio',
  'vllm',
];
const MAX_TOKEN_LIMIT = 16_777_216;

function tokenLimit(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_TOKEN_LIMIT
    ? value
    : undefined;
}

/**
 * Build-time, explicit network fetch: project models.dev (MIT) into the compact
 * metadata snapshot packaged as a harness resource. Never runs at install or runtime.
 * Shape contract lives in ModelMetadataSnapshotSchema (packages/shared).
 */
export async function createModelMetadataSnapshot(fetchFn = fetch) {
  const response = await fetchFn(MODELS_DEV_API, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`models.dev answered ${response.status}`);
  const data = await response.json();
  const providers = {};
  for (const providerId of WANTED_PROVIDERS) {
    const provider = data[providerId];
    if (!provider || typeof provider !== 'object' || !provider.models) continue;
    const models = {};
    for (const [modelId, model] of Object.entries(provider.models)) {
      if (!model || typeof model !== 'object') continue;
      const entry = {
        ...(typeof model.name === 'string' && model.name.trim().length > 0
          ? { name: model.name.trim().slice(0, 300) }
          : {}),
        ...(tokenLimit(model.limit?.context)
          ? { contextWindow: tokenLimit(model.limit.context) }
          : {}),
        ...(tokenLimit(model.limit?.output) ? { maxTokens: tokenLimit(model.limit.output) } : {}),
        ...(Array.isArray(model.modalities?.input) && model.modalities.input.includes('image')
          ? { imageInput: true }
          : {}),
        ...(typeof model.tool_call === 'boolean' ? { toolCalls: model.tool_call } : {}),
        ...(typeof model.reasoning === 'boolean' ? { reasoning: model.reasoning } : {}),
      };
      if (Object.keys(entry).length > 0) models[modelId] = entry;
    }
    if (Object.keys(models).length > 0) providers[providerId] = { models };
  }
  return {
    version: 1,
    source: 'models.dev',
    generatedAt: new Date().toISOString(),
    providers,
  };
}
