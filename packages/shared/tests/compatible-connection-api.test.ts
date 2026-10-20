import { describe, expect, it } from 'vitest';
import {
  CompatibleConnectionApiSchema,
  COMPATIBLE_CONNECTION_PRESETS,
  SHIPPED_COMPATIBLE_CONNECTION_APIS,
  isCompatibleConnectionApiShipped,
  normalizeCompatibleConnectionApi,
} from '../src/compatible-connection-api';
import { ModelConnectionSchema } from '../src/embedded-harness';

describe('compatible connection api', () => {
  it('lists all four wire protocols and gates Responses and Gemini off the shipped set', () => {
    expect(CompatibleConnectionApiSchema.options).toEqual([
      'anthropic-messages',
      'openai-completions',
      'openai-responses',
      'google-generative-ai',
    ]);
    expect(SHIPPED_COMPATIBLE_CONNECTION_APIS).toEqual([
      'anthropic-messages',
      'openai-completions',
    ]);
    expect(isCompatibleConnectionApiShipped('openai-responses')).toBe(false);
    expect(isCompatibleConnectionApiShipped('google-generative-ai')).toBe(false);
  });

  it('defaults missing compatibleApi to OpenAI Chat Completions on read', () => {
    const parsed = ModelConnectionSchema.parse({
      schemaVersion: 1,
      id: '00000000-0000-4000-8000-000000000001',
      revision: 1,
      providerPresetId: 'openai-compatible',
      displayName: 'Gateway',
      baseUrl: 'https://example.invalid/v1',
      credentialRef: '00000000-0000-4000-8000-000000000002',
      enabled: true,
      customModels: [
        {
          modelId: 'vendor/model',
          name: 'Declared',
          input: ['text'],
          contextWindow: 8192,
          maxTokens: 1024,
          thinking: ['off'],
          toolCalls: false,
          maxTokensField: 'max_tokens',
        },
      ],
    });
    expect(parsed.compatibleApi).toBe('openai-completions');
    expect(normalizeCompatibleConnectionApi(undefined)).toBe('openai-completions');
  });

  it('ships presets with base URLs and starter metadata', () => {
    const deepseek = COMPATIBLE_CONNECTION_PRESETS.find((preset) => preset.id === 'deepseek-chat');
    expect(deepseek?.api).toBe('openai-completions');
    expect(deepseek?.starterModel?.modelId).toBe('deepseek-flash');
    expect(deepseek?.starterModel?.toolCalls).toBe(true);
    expect(deepseek?.starterModel?.contextWindow).toBeGreaterThan(0);
  });
});
