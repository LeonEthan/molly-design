/**
 * User Stop cancel options.
 *
 * User Stop sends `stop` so it hard-stops without the dispatch-pause Continue
 * interstitial. `stop` is distinct from `interrupt` (interrupt-and-send, which
 * always resumes dispatch so the selected queued input promotes).
 * - Daemons below `sessionStopControl: 2` do not know `stop`; fall back to
 *   optionless cancel (legacy pause).
 * - The owner decides `stop` atomically against its own queue: empty queue →
 *   `dispatchPause.state = 'resumed'`; queued input → `paused` until Continue.
 *   The renderer queue check below is only a fast path; renderer emptiness can
 *   race an in-flight enqueue.
 *
 * Recovery fences that still write `dispatchPause.state = 'paused'` keep the
 * interstitial via `shouldShowDispatchPauseInterstitial`.
 */
export type UserSessionStopCancelOptions = { action: 'stop' };

export type DispatchPauseSnapshot = {
  turnId: string;
  state: 'paused' | 'resumed';
  error?: string;
};

export function resolveUserSessionStopCancelOptions(input: {
  supportsUserStop: boolean;
  hasQueuedInput: boolean;
}): UserSessionStopCancelOptions | undefined {
  if (!input.supportsUserStop || input.hasQueuedInput) {
    return undefined;
  }
  return { action: 'stop' };
}

/**
 * Continue / Stop again strip for an active dispatch pause (recovery fence or
 * legacy paused Stop that preserved a non-empty queue).
 */
export function shouldShowDispatchPauseInterstitial(
  dispatchPause: DispatchPauseSnapshot | null | undefined
): dispatchPause is DispatchPauseSnapshot & { state: 'paused' } {
  return dispatchPause?.state === 'paused';
}
