import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserHost } from './browser-host';
import {
  BROWSER_HOST_OPERATION_TIMEOUT_MS,
  BROWSER_HOST_TTL_MS,
  AgentBrowserScopeSchema,
  type AgentBrowserHostWork,
  type AgentBrowserHostReport,
  type AgentBrowserScope,
} from '@molly/shared/browser-agent-rpc';

const exchange = (
  host: BrowserHost,
  reports: readonly AgentBrowserHostReport[],
  active: (scope: AgentBrowserScope) => boolean
) =>
  host.exchange(reports, active, {
    version: 2,
    driver: 'agent-browser',
    driverRevision: 'fixture',
  });

const scope = AgentBrowserScopeSchema.parse({
  sessionId: 'session-1',
  browserId: 'session-browser-session-1',
  runId: 'run-1',
});
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
    exchange(host, [], () => true);
    const first = host.enqueue(work('first'));
    await expect(host.enqueue(work('first'))).resolves.toMatchObject({ ok: false });
    const second = host.enqueue(work('second'));
    expect(exchange(host, [], () => true).map((item) => item.requestId)).toEqual(['first']);
    expect(exchange(host, [], () => true)).toEqual([]);
    exchange(
      host,
      [
        {
          requestId: 'first',
          ok: true,
          reply: { kind: 'page', url: 'https://example.com/', title: 'private page' },
        },
      ],
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
    exchange(host, [], () => true);
    const result = host.enqueue(work('first'));
    expect(exchange(host, [], () => true).map((item) => item.requestId)).toEqual(['first']);
    host.cancel('first', scope);
    expect(host.takeRevocations().map((item) => item.browserId)).toEqual([scope.browserId]);
    expect(exchange(host, [], () => true)).toEqual([]);
    await expect(result).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('cancelled'),
    });
  });

  it('returns an unknown outcome on timeout without replaying dispatched work', async () => {
    const host = new BrowserHost(() => Date.now());
    exchange(host, [], () => true);
    const result = host.enqueue(work('first'));
    exchange(host, [], () => true);
    await vi.advanceTimersByTimeAsync(BROWSER_HOST_OPERATION_TIMEOUT_MS);
    await expect(result).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('outcome is unknown'),
    });
    expect(host.takeRevocations().map((item) => item.browserId)).toEqual([scope.browserId]);
    expect(exchange(host, [], () => true)).toEqual([]);
    const next = host.enqueue(work('next'));
    expect(exchange(host, [], () => true).map((item) => item.requestId)).toEqual(['next']);
    exchange(
      host,
      [
        {
          requestId: 'first',
          ok: true,
          reply: { kind: 'page', url: 'https://example.com/', title: 'late old result' },
        },
        {
          requestId: 'next',
          ok: true,
          reply: { kind: 'page', url: 'https://example.com/', title: 'fresh observation' },
        },
      ],
      () => true
    );
    await expect(next).resolves.toEqual({
      ok: true,
      reply: { kind: 'page', url: 'https://example.com/', title: 'fresh observation' },
    });
  });

  it('revokes a dispatched page when the desktop host disconnects', async () => {
    const host = new BrowserHost(() => Date.now());
    exchange(host, [], () => true);
    const result = host.enqueue(work('first'));
    expect(exchange(host, [], () => true).map((item) => item.requestId)).toEqual(['first']);
    await vi.advanceTimersByTimeAsync(BROWSER_HOST_TTL_MS + 1);
    exchange(host, [], () => true);
    await expect(result).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('outcome is unknown'),
    });
    expect(host.takeRevocations()).toEqual([scope]);
    const next = host.enqueue(work('next'));
    expect(exchange(host, [], () => true).map((item) => item.requestId)).toEqual(['next']);
    exchange(
      host,
      [
        {
          requestId: 'next',
          ok: true,
          reply: { kind: 'page', url: 'https://example.com/', title: 'reconnected page' },
        },
      ],
      () => true
    );
    await expect(next).resolves.toEqual({
      ok: true,
      reply: { kind: 'page', url: 'https://example.com/', title: 'reconnected page' },
    });
  });

  it('allows a new same-run action after cancellation without replaying the cancelled work', async () => {
    const host = new BrowserHost(() => Date.now());
    exchange(host, [], () => true);
    const cancelled = host.enqueue(work('cancelled'));
    expect(exchange(host, [], () => true).map((item) => item.requestId)).toEqual(['cancelled']);
    host.cancel('cancelled', scope);
    await expect(cancelled).resolves.toMatchObject({ ok: false });
    expect(host.takeRevocations()).toEqual([scope]);
    const followup = host.enqueue(work('followup'));
    expect(exchange(host, [], () => true).map((item) => item.requestId)).toEqual(['followup']);
    expect(exchange(host, [], () => true)).toEqual([]);
    exchange(
      host,
      [
        {
          requestId: 'followup',
          ok: true,
          reply: { kind: 'page', url: 'https://example.com/', title: 'observed page' },
        },
      ],
      () => true
    );
    await expect(followup).resolves.toEqual({
      ok: true,
      reply: { kind: 'page', url: 'https://example.com/', title: 'observed page' },
    });
  });
});
