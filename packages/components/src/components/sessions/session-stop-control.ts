/**
 * User Stop must hard-stop the active turn without entering the
 * dispatch-pause Continue interstitial ("Molly stopped… Stop again / Continue").
 *
 * `interrupt` cancels the turn and marks dispatch resumed, so queued inputs are
 * not gated behind an explicit Continue prompt. Recovery fences that still
 * write `dispatchPause.state = 'paused'` keep the interstitial for Continue.
 */
export function resolveUserSessionStopCancelOptions(): { action: 'interrupt' } {
  return { action: 'interrupt' };
}

/**
 * The Continue / Stop again strip is only for an active dispatch pause
 * (recovery fence or a legacy paused Stop). User Stop uses interrupt and never
 * lands here.
 */
export function shouldShowDispatchPauseInterstitial(
  dispatchPause: { state: 'paused' | 'resumed'; error?: string } | null | undefined
): boolean {
  return dispatchPause?.state === 'paused';
}
