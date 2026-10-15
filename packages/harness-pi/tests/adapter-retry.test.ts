import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fauxToolCall } from '@earendil-works/pi-ai';
import { managed } from './fixtures/managed';
import { retrySignals } from './fixtures/retry';

describe('managed native model-request retry', () => {
  it('recovers from overload with visible retry activity and the final native completion receipt', async () => {
    const retry = retrySignals();
    const f = await managed({
      productionProfile: true,
      providerError: (call) =>
        call === 1 ? '529 overloaded SYNTHETIC_PROVIDER_SECRET' : undefined,
      peer: retry,
    });
    const session = await f.open();
    f.grant(session.snapshot);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const running = session.prompt();
      await retry.scheduled[0]!.promise;
      expect(f.observed).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await running;
      expect(result.stopReason).toBe('end_turn');
      expect(f.observed).toHaveLength(2);
      expect(f.updates).toContainEqual(
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call',
            status: 'in_progress',
            _meta: { lody: { activity: { version: 1, kind: 'retry', automatic: true } } },
          }),
        })
      );
      expect(f.updates).toContainEqual(
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'tool_call_update',
            status: 'completed',
            _meta: { lody: { activity: { version: 1, kind: 'retry', automatic: true } } },
          }),
        })
      );
      expect(JSON.stringify(f.updates)).not.toContain('SYNTHETIC_PROVIDER_SECRET');
      const entries = (await readFile(session.binding.nativeSessionFile, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const final = entries
        .filter((entry) => entry.type === 'message' && entry.message.role === 'assistant')
        .at(-1);
      expect(final.message.stopReason).toBe('stop');
      expect(result._meta?.mollyNativeOutcome).toMatchObject({
        status: 'completed',
        nativeEndEntryId: final.id,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['401 invalid api key', 'auth'],
    ['400 invalid_request', 'invalid_request'],
    ['maximum context length exceeded', 'context_overflow'],
    ['429 insufficient_quota', 'quota'],
    ['400 content_filter', 'content_policy'],
  ])('does not retry the permanent failure %s', async (providerError, category) => {
    const f = await managed({ productionProfile: true, providerError });
    const session = await f.open();
    f.grant(session.snapshot);
    await expect(session.prompt()).rejects.toMatchObject({
      data: { code: 'harness_model_request_failed', category },
    });
    expect(f.observed).toHaveLength(1);
    expect(JSON.stringify(f.updates)).not.toContain('"kind":"retry"');
  });

  it('classifies the final permanent response after an initial transient failure', async () => {
    const retry = retrySignals();
    const f = await managed({
      productionProfile: true,
      providerError: (call) => (call === 1 ? '503 Service Unavailable' : '401 invalid api key'),
      peer: retry,
    });
    const session = await f.open();
    f.grant(session.snapshot);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const running = session.prompt().catch((error: unknown) => error);
      await retry.scheduled[0]!.promise;
      await vi.advanceTimersByTimeAsync(1000);
      expect(await running).toMatchObject({
        data: { code: 'harness_model_request_failed', category: 'auth' },
      });
      expect(f.observed).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels during retry backoff without sending another model request', async () => {
    const retry = retrySignals();
    const f = await managed({
      productionProfile: true,
      providerError: '503 Service Unavailable',
      peer: retry,
    });
    const session = await f.open();
    f.grant(session.snapshot);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const running = session.prompt();
      await retry.scheduled[0]!.promise;
      await f.agent.cancel({ sessionId: session.response.sessionId });
      expect(await running).toMatchObject({ stopReason: 'cancelled' });
      await vi.advanceTimersByTimeAsync(20000);
      expect(f.observed).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries only the failed model request, preserving prior tool side effects and skipping errored tool calls', async () => {
    const retry = retrySignals();
    const f = await managed({
      productionProfile: true,
      providerError: (call) => (call === 2 ? '503 Service Unavailable' : undefined),
      providerToolCall: (call) => (call <= 2 ? fauxToolCall('append_line', {}) : undefined),
      peer: retry,
      extensions: [
        (pi) => {
          pi.registerTool({
            name: 'append_line',
            label: 'Append line',
            description: 'Synthetic observable side effect',
            parameters: { type: 'object', properties: {} },
            execute: async (_id, _params, _signal, _update, context) => {
              await appendFile(join(context.cwd, 'side-effect.txt'), 'one side effect\n');
              return { content: [{ type: 'text', text: 'Appended.' }], details: {} };
            },
          });
        },
      ],
    });
    const session = await f.open();
    f.grant(session.snapshot);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const running = session.prompt();
      await retry.scheduled[0]!.promise;
      expect(await readFile(join(f.cwd, 'side-effect.txt'), 'utf8')).toBe('one side effect\n');
      await vi.advanceTimersByTimeAsync(1000);
      expect((await running).stopReason).toBe('end_turn');
      expect(f.observed).toHaveLength(3);
      expect(await readFile(join(f.cwd, 'side-effect.txt'), 'utf8')).toBe('one side effect\n');
      expect(f.observed[2]).toContain('Appended.');
    } finally {
      vi.useRealTimers();
    }
  });
});
