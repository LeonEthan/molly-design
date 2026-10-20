import { afterEach, describe, expect, it, vi } from 'vitest';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { generateSessionTitle, TITLE_TIMEOUT_MS } from '../src/session-title';

const model = {
  id: 'selected-model',
  name: 'Selected model',
  provider: 'synthetic',
  api: 'openai-completions',
  baseUrl: 'https://synthetic.invalid',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10000,
  maxTokens: 1000,
} satisfies import('@earendil-works/pi-ai').Model<'openai-completions'>;
const userText = 'Design a poster for a jazz night. Use warm colours.';
const reply = (text: string) => fauxAssistantMessage(text);
const request = (
  completeSimple: Parameters<typeof generateSessionTitle>[0]['runtime']['completeSimple']
) =>
  generateSessionTitle({
    runtime: { completeSimple },
    model,
    userText,
    signal: new AbortController().signal,
  });

afterEach(() => vi.useRealTimers());

describe('selected model session titles', () => {
  it('generates a short title with the exact selected model and only the user text', async () => {
    const result = await request(async (selected, context, options) => {
      expect(selected).toBe(model);
      expect(options?.maxRetries).toBe(0);
      expect(context.messages).toEqual([
        { role: 'user', content: userText, timestamp: expect.any(Number) },
      ]);
      expect(context.tools).toBeUndefined();
      return reply('Warm Jazz Night');
    });
    expect(result.title).toBe('Warm Jazz Night');
  });

  it.each([
    '',
    '  ',
    userText,
    'Design a poster for a jazz night',
    '"Design a poster for a jazz night."',
    'a'.repeat(81),
    'Title\nExplanation',
  ])('rejects empty, copied or invalid output: %s', async (text) => {
    expect((await request(async () => reply(text))).title).toBeNull();
  });

  it('fails without a raw-prompt fallback or a retry', async () => {
    expect(
      await request(async () => {
        throw new Error('synthetic provider failure');
      })
    ).toEqual({ title: null });
  });

  it('rejects incomplete and failed completions while preserving measured usage', async () => {
    for (const stopReason of ['length', 'error', 'aborted'] as const) {
      const result = reply('Warm Jazz Night');
      result.stopReason = stopReason;
      expect(await request(async () => result)).toEqual({ title: null, result });
    }
  });

  it('times out an unresponsive model without accepting a late title', async () => {
    vi.useFakeTimers();
    let finish: ((result: ReturnType<typeof reply>) => void) | undefined;
    let signal: AbortSignal | undefined;
    const pending = request(async (_selected, _context, options) => {
      signal = options?.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await vi.advanceTimersByTimeAsync(TITLE_TIMEOUT_MS);
    expect(await pending).toEqual({ title: null });
    expect(signal?.aborted).toBe(true);
    finish?.(reply('Late title'));
    await Promise.resolve();
  });

  it('cancels the title request without waiting for the provider', async () => {
    const controller = new AbortController();
    const pending = generateSessionTitle({
      runtime: { completeSimple: async () => new Promise(() => {}) },
      model,
      userText,
      signal: controller.signal,
    });
    controller.abort();
    expect(await pending).toEqual({ title: null });
  });
});
