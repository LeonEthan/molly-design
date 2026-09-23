import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserHost } from './browser-host';
import {
  BROWSER_HOST_OPERATION_TIMEOUT_MS,
  BROWSER_HOST_TTL_MS,
  type AgentBrowserHostWork,
} from '@molly/shared/browser-agent-rpc';

const scope = {
  sessionId: 'session-1' as AgentBrowserHostWork['scope']['sessionId'],
  browserId: 'session-browser-session-1',
  runId: 'run-1',
  sites: ['pinterest.com'],
};
const work = (requestId: string): AgentBrowserHostWork => ({
  requestId,
  scope,
  command: { kind: 'snapshot' },
});

describe('BrowserHost', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('dispatches one operation per page and refuses a late result after run revocation', async () => {
    const host = new BrowserHost(() => Date.now());
    host.exchange([], () => true);
    const first = host.enqueue(work('first'));
    await expect(host.enqueue(work('first'))).resolves.toMatchObject({ ok: false });
    const second = host.enqueue(work('second'));
    expect(host.exchange([], () => true).map((item) => item.requestId)).toEqual(['first']);
    expect(host.exchange([], () => true)).toEqual([]);
    host.exchange(
      [{ requestId: 'first', ok: true, reply: { kind: 'text', text: 'private page' } }],
      () => false
    );
    await expect(first).resolves.toEqual({
      ok: false,
      error: 'Browser run ended before its result could be returned.',
    });
    await expect(second).resolves.toEqual({
      ok: false,
      error: 'Browser run ended before dispatch.',
    });
  });

  it('revoke on cancellation and does not re-dispatch the same action', async () => {
    const host = new BrowserHost(() => Date.now());
    host.exchange([], () => true);
    const result = host.enqueue(work('first'));
    expect(host.exchange([], () => true).map((item) => item.requestId)).toEqual(['first']);
    host.cancel('first', scope);
    expect(host.takeRevocations().map((item) => item.browserId)).toEqual([scope.browserId]);
    expect(host.exchange([], () => true)).toEqual([]);
    await expect(result).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('cancelled'),
    });
  });

  it('returns an unknown outcome on timeout without replaying dispatched work', async () => {
    const host = new BrowserHost(() => Date.now());
    host.exchange([], () => true);
    const result = host.enqueue(work('first'));
    host.exchange([], () => true);
    await vi.advanceTimersByTimeAsync(BROWSER_HOST_OPERATION_TIMEOUT_MS);
    await expect(result).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('outcome is unknown'),
    });
    expect(host.takeRevocations().map((item) => item.browserId)).toEqual([scope.browserId]);
    expect(host.exchange([], () => true)).toEqual([]);
    await expect(host.enqueue(work('next'))).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('new run'),
    });
    expect(host.exchange([], () => true)).toEqual([]);
  });

  it('revokes a dispatched page when the desktop host disconnects', async () => {
    const host = new BrowserHost(() => Date.now());
    host.exchange([], () => true);
    const result = host.enqueue(work('first'));
    expect(host.exchange([], () => true).map((item) => item.requestId)).toEqual(['first']);
    await vi.advanceTimersByTimeAsync(BROWSER_HOST_TTL_MS + 1);
    host.exchange([], () => true);
    await expect(result).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('outcome is unknown'),
    });
    expect(host.takeRevocations()).toEqual([scope]);
  });
});
