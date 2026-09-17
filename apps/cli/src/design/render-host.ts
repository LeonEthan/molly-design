/**
 * The daemon half of the design preview render bridge (P2.4b).
 *
 * The daemon cannot rasterize a design — that needs the desktop's Chromium — so
 * a preview is a hand-off to a *render host*: the running Molly desktop, which
 * polls `design/render-host` over the machine-local control socket and returns
 * each result on a later call. This module owns that queue and nothing else: no
 * filesystem, no IPC, no payload. `./render-preview.ts` stages the artifact and
 * drives it, which keeps every decision here testable with an injected clock.
 *
 * Liveness is the poll itself. `isConnected` is true only while a host has
 * polled within `DESIGN_RENDER_HOST_TTL_MS`, so capability presence matches
 * environment presence: a desktop that is not running means
 * `molly_render_preview` is not registered, and a preview asked for with no host
 * is refused immediately rather than queued behind a promise that never settles.
 *
 * A request is handed to the host exactly once. If the host disappears while
 * holding it — the desktop quit or crashed — the request fails on its own
 * deadline, and a *later* poll from a fresh host is taken as proof that the
 * previous one is gone, so work it was holding is failed at once instead of
 * being left to time out. Nothing is ever retried or re-handed automatically: a
 * stale preview is worse than an honest failure (`agent-naive`; root
 * `AGENTS.md`).
 */

import {
  DESIGN_RENDER_HOST_TTL_MS,
  type DesignRenderHostReport,
  type DesignRenderHostWork,
} from '@molly/shared';

/**
 * How long one preview may take in total before it is reported as a failure.
 *
 * The desktop's own render budget is 30 s (the canvas load timeout in
 * `renderSavedDesign`) plus a poll interval to pick the work up, so this leaves
 * room for a cold first render without letting a wedged host hold an agent turn
 * open indefinitely.
 */
export const DESIGN_RENDER_PREVIEW_TIMEOUT_MS = 60_000;

/** Queue ceiling. One waiting preview belongs to one live tool call, so this is a backstop. */
export const MAX_PENDING_PREVIEWS = 8;

/**
 * What the queue settles a preview as. Deliberately says nothing about the PNG
 * itself: a `rendered` outcome means the host claims it wrote the file at
 * `absolutePath`, and verifying those bytes is the caller's job before any of it
 * reaches the agent.
 */
export type DesignRenderPreviewOutcome =
  | { status: 'rendered'; absolutePath: string }
  | { status: 'refused'; error: string };

type Entry = {
  work: DesignRenderHostWork;
  resolve: (outcome: DesignRenderPreviewOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  /** True once the host has been given this request and has not reported it. */
  handedOut: boolean;
};

export type DesignRenderHostOptions = {
  /** Test seam: defaults to the wall clock. */
  now?: () => number;
  /** Test seams: default to the global timers. */
  setTimer?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
};

/**
 * The queue of previews waiting on a desktop render host.
 *
 * One instance per daemon (owned by `MessageHandler`): the queue is process
 * state, and two of them would hand the same request to two hosts.
 */
export class DesignRenderHost {
  private readonly now: () => number;
  private readonly setTimer: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  /** Last poll from any host, or `undefined` if none has polled yet. */
  private lastSeenAt: number | undefined;
  /** Waiting and handed-out previews, in the order they were asked for. */
  private readonly entries = new Map<string, Entry>();

  constructor(options: DesignRenderHostOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((handler, ms) => setTimeout(handler, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  /** Whether a host polled recently enough to be treated as present right now. */
  isConnected(): boolean {
    return (
      this.lastSeenAt !== undefined && this.now() - this.lastSeenAt <= DESIGN_RENDER_HOST_TTL_MS
    );
  }

  /**
   * Ask the desktop to render one image.
   *
   * Refusals that need no host at all — no desktop running, queue full — settle
   * here rather than becoming a promise the caller waits on, so the tool can
   * answer honestly and at once.
   *
   */
  enqueue(work: DesignRenderHostWork): Promise<DesignRenderPreviewOutcome> {
    if (!this.isConnected()) {
      return Promise.resolve({
        status: 'refused',
        error:
          'the Molly desktop is not running, so no preview can be rendered. Do not retry: tell the user to open Molly and run the preview again.',
      });
    }
    if (this.entries.size >= MAX_PENDING_PREVIEWS) {
      return Promise.resolve({
        status: 'refused',
        error: `too many previews are already waiting (${MAX_PENDING_PREVIEWS}); wait for the earlier ones to finish`,
      });
    }
    const timeoutMs = DESIGN_RENDER_PREVIEW_TIMEOUT_MS;
    return new Promise<DesignRenderPreviewOutcome>((resolve) => {
      const timer = this.setTimer(
        () =>
          this.settle(work.requestId, () => ({
            status: 'refused',
            error: `the Molly desktop did not render the image within ${Math.round(
              timeoutMs / 1000
            )}s`,
          })),
        timeoutMs
      );
      this.entries.set(work.requestId, { work, resolve, timer, handedOut: false });
    });
  }

  /**
   * The desktop's poll: register liveness, take its reports, hand back its work.
   *
   * Order matters. Liveness is registered first so a report that arrives on the
   * deadline still counts as having been answered; reports are applied before
   * work is handed out so a host that reports and takes on the same call is
   * never given a request it has already finished.
   */
  handleHostPoll(reports: readonly DesignRenderHostReport[]): DesignRenderHostWork[] {
    const wasConnected = this.isConnected();
    this.lastSeenAt = this.now();

    for (const report of reports) {
      this.settle(report.requestId, (entry) =>
        report.ok
          ? { status: 'rendered', absolutePath: entry.work.outputPath }
          : { status: 'refused', error: report.error }
      );
    }

    // A poll after a liveness gap is a different host from the one holding the
    // outstanding work: the desktop that took it went away with it.
    if (!wasConnected) {
      for (const [requestId, entry] of [...this.entries]) {
        if (!entry.handedOut) continue;
        this.settle(requestId, () => ({
          status: 'refused',
          error: 'the Molly desktop restarted before the preview was rendered',
        }));
      }
    }

    const work: DesignRenderHostWork[] = [];
    for (const entry of this.entries.values()) {
      if (entry.handedOut) continue;
      entry.handedOut = true;
      work.push(entry.work);
    }
    return work;
  }

  private settle(requestId: string, build: (entry: Entry) => DesignRenderPreviewOutcome): void {
    const entry = this.entries.get(requestId);
    if (!entry) return;
    this.entries.delete(requestId);
    this.clearTimer(entry.timer);
    entry.resolve(build(entry));
  }
}
