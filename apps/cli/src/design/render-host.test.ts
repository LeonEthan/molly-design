/**
 * The daemon's preview queue (P2.4b), driven by a fake clock and fake timers.
 *
 * No real timers, no filesystem, no desktop: the queue is a state machine about
 * who is holding which preview and what answer each one deserves. A preview can
 * only be enqueued once a host has polled, so every case here polls first.
 */

import { DESIGN_RENDER_HOST_TTL_MS } from '@molly/shared';
import { describe, expect, it } from 'vitest';
import {
  DESIGN_RENDER_PREVIEW_TIMEOUT_MS,
  DesignRenderHost,
  MAX_PENDING_PREVIEWS,
} from './render-host';

type FakeTimers = {
  now: () => number;
  setTimer: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  advance: (ms: number) => void;
};

function fakeTimers(): FakeTimers {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; handler: () => void }>();
  return {
    now: () => now,
    setTimer: (handler, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { at: now + ms, handler });
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle) => {
      timers.delete(handle as unknown as number);
    },
    advance: (ms) => {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].handler();
      }
      now = target;
    },
  };
}

const work = (requestId: string) => ({
  requestId,
  payloadPath: `/data/design-preview-stage/${requestId}.json`,
  outputPath: `/data/chats/session/design-preview/${requestId}.png`,
  width: 320,
  height: 200,
});

const createHost = () => {
  const timers = fakeTimers();
  return {
    timers,
    host: new DesignRenderHost({
      now: timers.now,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    }),
  };
};

/** A host that has polled once, which is what makes previews enqueueable at all. */
const withHost = () => {
  const created = createHost();
  created.host.handleHostPoll([]);
  return created;
};

describe('DesignRenderHost', () => {
  it('is not connected before any host has polled', () => {
    const { host } = createHost();
    expect(host.isConnected()).toBe(false);
  });

  it('refuses immediately when no desktop is polling', async () => {
    const { host } = createHost();
    const outcome = await host.enqueue(work('one'));
    expect(outcome.status).toBe('refused');
    expect(outcome.status === 'refused' && outcome.error).toContain('not running');
  });

  it('treats a host as connected for exactly the liveness TTL', () => {
    const { host, timers } = withHost();
    timers.advance(DESIGN_RENDER_HOST_TTL_MS);
    expect(host.isConnected()).toBe(true);
    timers.advance(1);
    expect(host.isConnected()).toBe(false);
  });

  it('hands work out exactly once and settles it from the report', async () => {
    const { host } = withHost();
    const pending = host.enqueue(work('one'));

    expect(host.handleHostPoll([]).map((item) => item.requestId)).toEqual(['one']);
    // A second poll while the host is still rendering must not hand it out again.
    expect(host.handleHostPoll([])).toEqual([]);

    expect(host.handleHostPoll([{ requestId: 'one', ok: true }])).toEqual([]);
    await expect(pending).resolves.toEqual({
      status: 'rendered',
      absolutePath: '/data/chats/session/design-preview/one.png',
    });
  });

  it('turns a failed report into the host’s own error', async () => {
    const { host } = withHost();
    const pending = host.enqueue(work('one'));
    host.handleHostPoll([]);
    host.handleHostPoll([{ requestId: 'one', ok: false, error: 'font failed to load' }]);
    await expect(pending).resolves.toEqual({ status: 'refused', error: 'font failed to load' });
  });

  it('applies reports before handing out work in the same poll', async () => {
    const { host } = withHost();
    const first = host.enqueue(work('one'));
    host.handleHostPoll([]);
    const second = host.enqueue(work('two'));

    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });

    const handed = host.handleHostPoll([{ requestId: 'one', ok: true }]);
    expect(handed.map((item) => item.requestId)).toEqual(['two']);
    await expect(first).resolves.toMatchObject({ status: 'rendered' });
    // Handed out, not reported: the same poll applied the report it carried
    // before deciding what to give back, so `two` is still outstanding.
    expect(secondSettled).toBe(false);

    host.handleHostPoll([{ requestId: 'two', ok: true }]);
    await expect(second).resolves.toMatchObject({ status: 'rendered' });
  });

  it('fails work the previous host was holding once a new host appears', async () => {
    const { host, timers } = withHost();
    const pending = host.enqueue(work('one'));
    host.handleHostPoll([]);

    // The desktop quit: no poll for longer than the TTL, then a fresh one.
    timers.advance(DESIGN_RENDER_HOST_TTL_MS + 1);
    expect(host.handleHostPoll([])).toEqual([]);
    await expect(pending).resolves.toEqual({
      status: 'refused',
      error: 'the Molly desktop restarted before the preview was rendered',
    });
  });

  it('refuses on its own deadline rather than holding an agent turn open', async () => {
    const { host, timers } = withHost();
    const pending = host.enqueue(work('one'));
    host.handleHostPoll([]);

    timers.advance(DESIGN_RENDER_PREVIEW_TIMEOUT_MS);
    const outcome = await pending;
    expect(outcome.status).toBe('refused');
    expect(outcome.status === 'refused' && outcome.error).toContain('did not render');
  });

  it('ignores a report for work it is not holding', () => {
    const { host } = withHost();
    expect(() => host.handleHostPoll([{ requestId: 'ghost', ok: true }])).not.toThrow();
    expect(host.isConnected()).toBe(true);
  });

  it(`refuses past ${MAX_PENDING_PREVIEWS} waiting previews instead of queueing forever`, async () => {
    const { host } = withHost();
    const waiting = Array.from({ length: MAX_PENDING_PREVIEWS }, (_, index) =>
      host.enqueue(work(`queued-${index}`))
    );
    const refused = await host.enqueue(work('overflow'));
    expect(refused.status).toBe('refused');
    expect(refused.status === 'refused' && refused.error).toContain('waiting');

    // The ceiling is on *waiting* work, so everything already queued is intact
    // and still renders normally.
    host.handleHostPoll(
      Array.from({ length: MAX_PENDING_PREVIEWS }, (_, index) => ({
        requestId: `queued-${index}`,
        ok: true as const,
      }))
    );
    for (const pending of waiting) {
      await expect(pending).resolves.toMatchObject({ status: 'rendered' });
    }
  });
});
