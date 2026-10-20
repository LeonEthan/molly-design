import { z } from 'zod';

/**
 * Wire protocol for an OpenAI-compatible (custom) model connection. Matches pi-ai
 * provider `api` values.
 */
export const CompatibleConnectionApiSchema = z.enum([
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
  'google-generative-ai',
]);
export type CompatibleConnectionApi = z.infer<typeof CompatibleConnectionApiSchema>;

export const SHIPPED_COMPATIBLE_CONNECTION_APIS = [
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
  'google-generative-ai',
] as const satisfies readonly CompatibleConnectionApi[];

export type ShippedCompatibleConnectionApi = (typeof SHIPPED_COMPATIBLE_CONNECTION_APIS)[number];

export function isCompatibleConnectionApiShipped(
  api: CompatibleConnectionApi
): api is ShippedCompatibleConnectionApi {
  return (SHIPPED_COMPATIBLE_CONNECTION_APIS as readonly string[]).includes(api);
}

export function normalizeCompatibleConnectionApi(
  api: CompatibleConnectionApi | undefined
): CompatibleConnectionApi {
  return api ?? 'openai-completions';
}

export function compatibleConnectionApiRequiresKey(
  api: CompatibleConnectionApi | undefined
): boolean {
  return api === 'openai-responses' || api === 'google-generative-ai';
}

export function normalizeCompatibleConnectionBaseUrl(
  baseUrl: string,
  api: CompatibleConnectionApi | undefined
): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (api !== 'openai-responses' && api !== 'google-generative-ai') return base;
  const url = new URL(base);
  let path = url.pathname.replace(/\/+$/, '');
  if (api === 'openai-responses') path = path.replace(/(?:\/responses)+$/, '');
  else
    path = path.replace(/(?:\/models)+(?:\/[^/]+:(?:streamGenerateContent|generateContent))?$/, '');
  path = path.replace(/(\/v\d+(?:beta\d*)?)(?:\1)+(?=\/|$)/g, '$1');
  url.pathname = path;
  return url.toString().replace(/\/+$/, '');
}

export type CompatibleConnectionPreset = {
  id: string;
  labelKey: string;
  api: ShippedCompatibleConnectionApi;
  baseUrl: string;
  /** Optional starter declaration so users never hand-type limits for well-known models. */
  starterModel?: {
    modelId: string;
    name: string;
    input: ('text' | 'image')[];
    contextWindow: number;
    maxTokens: number;
    thinking: ('off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[];
    toolCalls: boolean;
    maxTokensField: 'max_tokens' | 'max_completion_tokens';
  };
};

/** One-click setup rows (cc-switch style): base URL, API family, and model metadata. */
export const COMPATIBLE_CONNECTION_PRESETS: readonly CompatibleConnectionPreset[] = [
  {
    id: 'openai-responses',
    labelKey: 'settings.models.compatiblePresets.openaiResponses',
    api: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'google-gemini',
    labelKey: 'settings.models.compatiblePresets.googleGemini',
    api: 'google-generative-ai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  {
    id: 'deepseek-chat',
    labelKey: 'settings.models.compatiblePresets.deepseekChat',
    api: 'openai-completions',
    baseUrl: 'https://api.deepseek.com/v1',
    starterModel: {
      modelId: 'deepseek-flash',
      name: 'DeepSeek Flash',
      input: ['text'],
      contextWindow: 65536,
      maxTokens: 8192,
      thinking: ['off', 'high'],
      toolCalls: true,
      maxTokensField: 'max_tokens',
    },
  },
  {
    id: 'deepseek-anthropic',
    labelKey: 'settings.models.compatiblePresets.deepseekAnthropic',
    api: 'anthropic-messages',
    baseUrl: 'https://api.deepseek.com/anthropic',
    starterModel: {
      modelId: 'deepseek-flash',
      name: 'DeepSeek Flash',
      input: ['text'],
      contextWindow: 65536,
      maxTokens: 8192,
      thinking: ['off'],
      toolCalls: true,
      maxTokensField: 'max_tokens',
    },
  },
  {
    id: 'moonshot',
    labelKey: 'settings.models.compatiblePresets.moonshot',
    api: 'openai-completions',
    baseUrl: 'https://api.moonshot.ai/v1',
    starterModel: {
      modelId: 'moonshot-v1-8k',
      name: 'Moonshot v1 8K',
      input: ['text'],
      contextWindow: 8192,
      maxTokens: 4096,
      thinking: ['off'],
      toolCalls: true,
      maxTokensField: 'max_tokens',
    },
  },
  {
    id: 'openrouter',
    labelKey: 'settings.models.compatiblePresets.openrouter',
    api: 'openai-completions',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    id: 'siliconflow',
    labelKey: 'settings.models.compatiblePresets.siliconflow',
    api: 'openai-completions',
    baseUrl: 'https://api.siliconflow.cn/v1',
  },
  {
    id: 'ollama',
    labelKey: 'settings.models.compatiblePresets.ollama',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:11434/v1',
  },
];
