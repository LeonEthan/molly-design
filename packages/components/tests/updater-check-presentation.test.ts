import { describe, expect, it } from 'vitest';
import {
  readUpdaterCheckPresentation,
  shouldApplyUpdaterSnapshot,
} from '../src/lib/updater-check-presentation';

describe('readUpdaterCheckPresentation', () => {
  it('hides the action when updates are disabled', () => {
    expect(readUpdaterCheckPresentation(null)).toBeNull();
    expect(readUpdaterCheckPresentation({ phase: 'disabled' })).toBeNull();
  });

  it('follows check, result, download, and install in order', () => {
    expect(readUpdaterCheckPresentation({ phase: 'idle' })).toEqual({ kind: 'check' });
    expect(readUpdaterCheckPresentation({ phase: 'checking' })).toEqual({ kind: 'checking' });
    expect(readUpdaterCheckPresentation({ phase: 'up_to_date' })).toEqual({ kind: 'up_to_date' });
    expect(readUpdaterCheckPresentation({ phase: 'downloading', percent: 42.4 })).toEqual({
      kind: 'downloading',
      percent: 42,
    });
    expect(readUpdaterCheckPresentation({ phase: 'downloading' })).toEqual({
      kind: 'downloading',
      percent: null,
    });
    expect(readUpdaterCheckPresentation({ phase: 'downloaded' })).toEqual({
      kind: 'ready',
      error: null,
    });
  });

  it('keeps a ready update installable when a later check fails', () => {
    expect(
      readUpdaterCheckPresentation({ phase: 'downloaded', error: 'Could not restart' })
    ).toEqual({ kind: 'ready', error: 'Could not restart' });
  });

  it('surfaces a check failure as text and a usable check action', () => {
    expect(readUpdaterCheckPresentation({ phase: 'error', error: 'feed unreachable' })).toEqual({
      kind: 'error',
      message: 'feed unreachable',
    });
    expect(readUpdaterCheckPresentation({ phase: 'error', error: '  ' })).toEqual({
      kind: 'error',
      message: '',
    });
  });
});

describe('shouldApplyUpdaterSnapshot', () => {
  it('drops a snapshot that lost the race to a newer push', () => {
    expect(shouldApplyUpdaterSnapshot(0)).toBe(true);
    expect(shouldApplyUpdaterSnapshot(1)).toBe(false);
  });
});
