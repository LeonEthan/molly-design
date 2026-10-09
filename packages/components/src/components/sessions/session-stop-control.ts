/**
 * User Stop cancel options.
 *
 * Prefer `interrupt` so Stop hard-stops without the dispatch-pause Continue
 * interstitial. Two gates keep that from breaking older daemons or the queue:
 * - Older daemons without `sessionStopControl: 1` reject action-bearing cancel;
 *   fall back to optionless cancel (legacy pause).
 * - `interrupt` writes `dispatchPause.state = 'resumed'`, which lets the watcher
 *   promote queued input. When the queue is non-empty, use legacy cancel so the
 *   queue stays paused until Continue. Renderer emptiness can race an enqueue;
 *   the owner also demotes interrupt→pause when getMessageQueue() is non-empty.
 *
 * Recovery fences that still write `dispatchPause.state = 'paused'` keep the
 * interstitial via `shouldShowDispatchPauseInterstitial`.
 */
export type UserSessionStopCancelOptions = { action: 'interrupt' };

export type DispatchPauseSnapshot = {
  turnId: string;
  state: 'paused' | 'resumed';
  error?: string;
};

export function resolveUserSessionStopCancelOptions(input: {
  supportsSessionStopControl: boolean;
  hasQueuedInput: boolean;
}): UserSessionStopCancelOptions | undefined {
  if (!input.supportsSessionStopControl || input.hasQueuedInput) {
    return undefined;
  }
  return { action: 'interrupt' };
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
