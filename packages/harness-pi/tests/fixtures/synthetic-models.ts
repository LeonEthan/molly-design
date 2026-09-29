import { beforeEach, vi } from 'vitest';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Api } from '@earendil-works/pi-ai';

const providers: Array<[string, Api, string[]]> = [
  ['openai', 'openai-responses', ['gpt-4o']],
  ['anthropic', 'anthropic-messages', ['claude-haiku-4-5']],
  ['xai', 'openai-responses', ['grok-4.3']],
  ['deepseek', 'openai-completions', ['deepseek-v4-flash']],
  ['moonshotai', 'openai-completions', ['kimi-k2-0711-preview']],
  ['kimi-coding', 'anthropic-messages', ['kimi-for-coding', 'k3-256k']],
  ['zai', 'openai-completions', ['glm-4.7']],
  ['minimax', 'anthropic-messages', ['MiniMax-M2.7']],
  ['openrouter', 'anthropic-messages', ['anthropic/claude-haiku-4.5']],
];

export function registerSyntheticModels() {
  const create = ModelRuntime.create.bind(ModelRuntime);
  beforeEach(() => {
    vi.spyOn(ModelRuntime, 'create').mockImplementation(async (options) => {
      const runtime = await create(options);
      for (const [provider, api, ids] of providers) {
        runtime.registerProvider(provider, {
          api,
          baseUrl: 'https://synthetic.invalid/v1',
          models: ids.map((id) => ({
            id,
            name: `Synthetic ${id}`,
            reasoning: true,
            input: ['text', 'image'],
            contextWindow: 200_000,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            thinkingLevelMap: {
              off: 'none',
              minimal: 'low',
              low: 'low',
              medium: 'medium',
              high: 'high',
              xhigh: null,
            },
          })),
        });
      }
      return runtime;
    });
  });
}
