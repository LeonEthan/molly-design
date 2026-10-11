import { describe, expect, it } from 'vitest';
import {
  discoveredModelDraft,
  enrichDiscoveredModel,
  defaultMaxTokensField,
} from '../src/components/settings/compatible-model-fields';

const snapshot = {
  version: 1 as const,
  source: 'models.dev' as const,
  generatedAt: '2026-10-10T00:00:00Z',
  providers: {
    deepseek: {
      models: {
        'deepseek-chat': {
          name: 'DeepSeek Chat',
          contextWindow: 65536,
          maxTokens: 8192,
          toolCalls: true,
        },
        'deepseek-reasoner': {
          name: 'DeepSeek Reasoner',
          contextWindow: 131072,
          maxTokens: 65536,
          reasoning: true,
          toolCalls: true,
        },
      },
    },
    openai: {
      models: {
        'gpt-5': { name: 'GPT-5', contextWindow: 400000, maxTokens: 128000, reasoning: true },
      },
    },
  },
};

describe('compatible model discovery drafts', () => {
  it('uses the service response first and only fills blanks from the snapshot', () => {
    const service = enrichDiscoveredModel(
      { modelId: 'deepseek-chat', name: 'Service Name', contextWindow: 64000 },
      snapshot
    );
    expect(service.draft.name).toBe('Service Name');
    expect(service.draft.contextWindow).toBe('64000');
    expect(service.draft.maxTokens).toBe('8192');
    expect(service.draft.toolCalls).toBe(true);
    expect(service.incomplete).toBe(false);
  });

  it('falls back to the snapshot for identity and limits when the service is silent', () => {
    const enriched = enrichDiscoveredModel({ modelId: 'deepseek-reasoner' }, snapshot);
    expect(enriched.draft.name).toBe('DeepSeek Reasoner');
    expect(enriched.draft.contextWindow).toBe('131072');
    expect(enriched.draft.thinking).toContain('high');
    expect(enriched.incomplete).toBe(false);
  });

  it('keeps unknown models incomplete with the model id as the name', () => {
    const unknown = enrichDiscoveredModel({ modelId: 'vendor/private-model' }, snapshot);
    expect(unknown.draft.name).toBe('vendor/private-model');
    expect(unknown.draft.contextWindow).toBe('');
    expect(unknown.incomplete).toBe(true);
  });

  it('without a snapshot only service-reported fields are filled', () => {
    const bare = enrichDiscoveredModel({ modelId: 'x', contextWindow: 32000 }, null);
    expect(bare.draft.contextWindow).toBe('32000');
    expect(bare.draft.maxTokens).toBe('');
    expect(bare.incomplete).toBe(true);
    expect(discoveredModelDraft({ modelId: 'x', contextWindow: 32000 })).toEqual(bare.draft);
  });

  it('routes modern OpenAI families to max_completion_tokens and legacy to max_tokens', () => {
    expect(defaultMaxTokensField('gpt-5.1')).toBe('max_completion_tokens');
    expect(defaultMaxTokensField('openai/o4-mini')).toBe('max_completion_tokens');
    expect(defaultMaxTokensField('openai/gpt-4o')).toBe('max_tokens');
    expect(defaultMaxTokensField('deepseek-chat')).toBe('max_tokens');
  });

  it('scopes snapshot lookups by the connection host before any cross-provider match', () => {
    const ambiguous = {
      ...snapshot,
      providers: {
        ...snapshot.providers,
        togetherai: {
          models: { 'llama-3.1-70b': { name: 'Together Llama', contextWindow: 131072 } },
        },
        'fireworks-ai': {
          models: { 'llama-3.1-70b': { name: 'Fireworks Llama', contextWindow: 32000 } },
        },
      },
    };
    // Same id in two providers: never guess across namespaces.
    expect(enrichDiscoveredModel({ modelId: 'llama-3.1-70b' }, ambiguous).draft.name).toBe(
      'llama-3.1-70b'
    );
    // The endpoint identifies the provider namespace.
    const scoped = enrichDiscoveredModel(
      { modelId: 'llama-3.1-70b' },
      ambiguous,
      'https://api.together.ai/v1'
    );
    expect(scoped.draft.name).toBe('Together Llama');
    // Provider-prefixed ids (OpenRouter style) match the owner namespace with the prefix stripped.
    const prefixed = enrichDiscoveredModel(
      { modelId: 'deepseek/deepseek-chat' },
      snapshot
    );
    expect(prefixed.draft.name).toBe('DeepSeek Chat');
  });
});
