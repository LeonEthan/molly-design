import { describe, expect, it } from 'vitest';
import {
  CompatibleConnectionApiSchema,
  COMPATIBLE_CONNECTION_PRESETS,
  SHIPPED_COMPATIBLE_CONNECTION_APIS,
  isCompatibleConnectionApiShipped,
  normalizeCompatibleConnectionApi,
  normalizeCompatibleConnectionBaseUrl,
} from '../src/compatible-connection-api';
import { ModelConnectionSchema, SaveModelConnectionSchema } from '../src/embedded-harness';

describe('compatible connection api', () => {
  it('lists all four wire protocols and ships all of them', () => {
    expect(CompatibleConnectionApiSchema.options).toEqual([
      'anthropic-messages',
      'openai-completions',
      'openai-responses',
      'google-generative-ai',
    ]);
    expect(SHIPPED_COMPATIBLE_CONNECTION_APIS).toEqual([
      'anthropic-messages',
      'openai-completions',
      'openai-responses',
      'google-generative-ai',
    ]);
    expect(isCompatibleConnectionApiShipped('openai-responses')).toBe(true);
    expect(isCompatibleConnectionApiShipped('google-generative-ai')).toBe(true);
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

it('ships every persisted protocol and provides a preset for both new protocols', () => {
  expect(SHIPPED_COMPATIBLE_CONNECTION_APIS).toEqual(CompatibleConnectionApiSchema.options);
  for (const api of ['openai-responses', 'google-generative-ai']) {
    expect(COMPATIBLE_CONNECTION_PRESETS.some((preset) => preset.api === api)).toBe(true);
  }
});

it.each([
  ['openai-responses', 'https://gateway.invalid/v1/', 'https://gateway.invalid/v1'],
  [
    'openai-responses',
    'https://gateway.invalid/v1/v1/responses/responses/',
    'https://gateway.invalid/v1',
  ],
  [
    'openai-responses',
    'https://gateway.invalid/prefix/v1/responses',
    'https://gateway.invalid/prefix/v1',
  ],
  [
    'google-generative-ai',
    'https://gateway.invalid/v1beta/v1beta/models/models/',
    'https://gateway.invalid/v1beta',
  ],
  [
    'google-generative-ai',
    'https://gateway.invalid/prefix/v1beta/models/model:streamGenerateContent/',
    'https://gateway.invalid/prefix/v1beta',
  ],
  ['anthropic-messages', 'https://gateway.invalid/anthropic/', 'https://gateway.invalid/anthropic'],
  ['openai-completions', 'https://gateway.invalid/v1/', 'https://gateway.invalid/v1'],
] as const)('normalizes %s %s without doubling request segments', (api, input, expected) => {
  expect(normalizeCompatibleConnectionBaseUrl(input, api)).toBe(expected);
  expect(normalizeCompatibleConnectionBaseUrl(expected, api)).toBe(expected);
});

it.each([
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
  'google-generative-ai',
  undefined,
] as const)(
  'accepts explicit empty keys only for the legacy compatible protocols: %s',
  (compatibleApi) => {
    const result = SaveModelConnectionSchema.safeParse({
      providerPresetId: 'openai-compatible',
      displayName: 'Synthetic',
      baseUrl: 'https://synthetic.invalid/v1',
      enabled: false,
      compatibleApi,
      apiKey: '',
    });
    expect(result.success).toBe(
      compatibleApi !== 'openai-responses' && compatibleApi !== 'google-generative-ai'
    );
  }
);
