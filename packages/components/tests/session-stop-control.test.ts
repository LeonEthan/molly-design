import { describe, expect, it } from 'vitest';
import {
  resolveUserSessionStopCancelOptions,
  shouldShowDispatchPauseInterstitial,
} from '../src/components/sessions/session-stop-control';

describe('resolveUserSessionStopCancelOptions', () => {
  it('hard-stops with stop when sessionStopControl v2 is advertised and the queue is empty', () => {
    expect(
      resolveUserSessionStopCancelOptions({
        supportsUserStop: true,
        hasQueuedInput: false,
      })
    ).toEqual({ action: 'stop' });
  });

  it('falls back to legacy cancel for daemons below sessionStopControl v2', () => {
    expect(
      resolveUserSessionStopCancelOptions({
        supportsUserStop: false,
        hasQueuedInput: false,
      })
    ).toBeUndefined();
  });

  it('falls back to legacy cancel when queued input must stay paused', () => {
    expect(
      resolveUserSessionStopCancelOptions({
        supportsUserStop: true,
        hasQueuedInput: true,
      })
    ).toBeUndefined();
  });
});

describe('shouldShowDispatchPauseInterstitial', () => {
  it('hides the strip when dispatch is not paused', () => {
    expect(shouldShowDispatchPauseInterstitial(undefined)).toBe(false);
    expect(shouldShowDispatchPauseInterstitial(null)).toBe(false);
    expect(shouldShowDispatchPauseInterstitial({ turnId: 't1', state: 'resumed' })).toBe(false);
  });

  it('keeps the strip for an active pause (recovery / legacy Continue gate)', () => {
    expect(shouldShowDispatchPauseInterstitial({ turnId: 't1', state: 'paused' })).toBe(true);
    expect(
      shouldShowDispatchPauseInterstitial({
        turnId: 't1',
        state: 'paused',
        error: 'Stop close failed',
      })
    ).toBe(true);
  });
});
