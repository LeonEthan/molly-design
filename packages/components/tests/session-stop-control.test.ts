import { describe, expect, it } from 'vitest';
import {
  resolveUserSessionStopCancelOptions,
  shouldShowDispatchPauseInterstitial,
} from '../src/components/sessions/session-stop-control';

describe('resolveUserSessionStopCancelOptions', () => {
  it('hard-stops with interrupt so Stop never opens the Continue interstitial', () => {
    expect(resolveUserSessionStopCancelOptions()).toEqual({ action: 'interrupt' });
  });
});

describe('shouldShowDispatchPauseInterstitial', () => {
  it('hides the strip when dispatch is not paused', () => {
    expect(shouldShowDispatchPauseInterstitial(undefined)).toBe(false);
    expect(shouldShowDispatchPauseInterstitial(null)).toBe(false);
    expect(shouldShowDispatchPauseInterstitial({ state: 'resumed' })).toBe(false);
  });

  it('keeps the strip for an active pause (recovery / legacy Continue gate)', () => {
    expect(shouldShowDispatchPauseInterstitial({ state: 'paused' })).toBe(true);
    expect(
      shouldShowDispatchPauseInterstitial({
        state: 'paused',
        error: 'Stop close failed',
      })
    ).toBe(true);
  });
});
