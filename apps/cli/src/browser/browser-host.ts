import type {
  AgentBrowserHostReport,
  AgentBrowserHostWork,
  AgentBrowserHostReply,
  AgentBrowserScope,
} from '@molly/shared/browser-agent-rpc';
import {
  BROWSER_HOST_TTL_MS,
  BROWSER_HOST_OPERATION_TIMEOUT_MS,
} from '@molly/shared/browser-agent-rpc';

const MAX_PENDING = 8;

type Entry = {
  work: AgentBrowserHostWork;
  resolve: (outcome: BrowserHostOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  handedOut: boolean;
};

export type BrowserHostOutcome =
  | { ok: true; reply: AgentBrowserHostReply }
  | { ok: false; error: string };

/**
 * One-shot handoff over the existing owner-only machine socket. Every queued operation
 * is bound to the daemon's active run at enqueue, dispatch, and report time.
 */
export class BrowserHost {
  private readonly entries = new Map<string, Entry>();
  private readonly revokedPages = new Map<string, AgentBrowserScope>();
  private readonly uncertainPages = new Map<string, AgentBrowserScope>();
  private lastSeenAt: number | undefined;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly setTimer: (
      handler: () => void,
      ms: number
    ) => ReturnType<typeof setTimeout> = setTimeout,
    private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void = clearTimeout
  ) {}

  isConnected(): boolean {
    return this.lastSeenAt !== undefined && this.now() - this.lastSeenAt <= BROWSER_HOST_TTL_MS;
  }

  enqueue(work: AgentBrowserHostWork): Promise<BrowserHostOutcome> {
    if (!this.isConnected()) {
      return Promise.resolve({ ok: false, error: 'The Molly desktop browser is not connected.' });
    }
    if (this.entries.has(work.requestId)) {
      return Promise.resolve({ ok: false, error: 'Browser operation identity is already in use.' });
    }
    if (this.entries.size >= MAX_PENDING) {
      return Promise.resolve({ ok: false, error: 'Too many browser operations are in progress.' });
    }
    const uncertainRun = this.uncertainPages.get(work.scope.browserId);
    if (uncertainRun?.runId === work.scope.runId) {
      return Promise.resolve({
        ok: false,
        error:
          'A prior browser action has an unknown outcome. Continue in a new run after checking the page.',
      });
    }
    if (uncertainRun) this.uncertainPages.delete(work.scope.browserId);
    return new Promise((resolve) => {
      const timer = this.setTimer(() => {
        const entry = this.entries.get(work.requestId);
        if (entry?.handedOut) this.blockUncertain(entry.work.scope);
        this.settle(work.requestId, {
          ok: false,
          error:
            'Browser operation timed out; its outcome is unknown. Do not repeat a click or input automatically.',
        });
      }, BROWSER_HOST_OPERATION_TIMEOUT_MS);
      this.entries.set(work.requestId, { work, resolve, timer, handedOut: false });
    });
  }

  cancel(requestId: string, scope: AgentBrowserScope): void {
    const entry = this.entries.get(requestId);
    if (
      !entry ||
      entry.work.scope.runId !== scope.runId ||
      entry.work.scope.browserId !== scope.browserId
    )
      return;
    if (entry.handedOut) this.blockUncertain(scope);
    this.settle(requestId, {
      ok: false,
      error: 'Browser operation was cancelled; any dispatched action has an unknown outcome.',
    });
  }

  takeRevocations(): AgentBrowserScope[] {
    const scopes = [...this.revokedPages.values()];
    this.revokedPages.clear();
    return scopes;
  }

  exchange(
    reports: readonly AgentBrowserHostReport[],
    isActive: (scope: AgentBrowserScope) => boolean
  ): AgentBrowserHostWork[] {
    for (const [browserId, scope] of this.uncertainPages) {
      if (!isActive(scope)) this.uncertainPages.delete(browserId);
    }
    const wasConnected = this.isConnected();
    this.lastSeenAt = this.now();
    for (const report of reports) {
      const entry = this.entries.get(report.requestId);
      if (!entry || !entry.handedOut) continue;
      this.settle(
        report.requestId,
        !isActive(entry.work.scope)
          ? { ok: false, error: 'Browser run ended before its result could be returned.' }
          : report.ok
            ? { ok: true, reply: report.reply }
            : { ok: false, error: report.error }
      );
    }
    const work: AgentBrowserHostWork[] = [];
    const busyPages = new Set(
      [...this.entries.values()]
        .filter((entry) => entry.handedOut)
        .map((entry) => entry.work.scope.browserId)
    );
    for (const entry of [...this.entries.values()]) {
      if (!isActive(entry.work.scope)) {
        this.settle(entry.work.requestId, {
          ok: false,
          error: 'Browser run ended before dispatch.',
        });
      } else if (entry.handedOut && !wasConnected) {
        this.blockUncertain(entry.work.scope);
        this.settle(entry.work.requestId, {
          ok: false,
          error: 'Browser host disconnected; operation outcome is unknown.',
        });
      } else if (!entry.handedOut && !busyPages.has(entry.work.scope.browserId)) {
        entry.handedOut = true;
        busyPages.add(entry.work.scope.browserId);
        work.push(entry.work);
      }
    }
    return work;
  }

  private settle(requestId: string, outcome: BrowserHostOutcome): void {
    const entry = this.entries.get(requestId);
    if (!entry) return;
    this.entries.delete(requestId);
    this.clearTimer(entry.timer);
    entry.resolve(outcome);
  }

  private blockUncertain(scope: AgentBrowserScope): void {
    this.uncertainPages.set(scope.browserId, scope);
    this.revokedPages.set(scope.browserId, scope);
  }
}
