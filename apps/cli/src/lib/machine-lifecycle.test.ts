import { describe, expect, it } from 'vitest';
import { resolveMachineLifecycleCapability } from './machine-lifecycle';

describe('machine lifecycle helpers', () => {
  it('enables remote restart for supervised daemon workers', () => {
    expect(resolveMachineLifecycleCapability('daemon')).toEqual({
      launchMode: 'daemon',
      canRemoteRestart: true,
    });
  });

  it('disables remote lifecycle for Electron managed CLI', () => {
    expect(resolveMachineLifecycleCapability('electron')).toEqual({
      launchMode: 'electron',
      canRemoteRestart: false,
      reason: 'electron',
    });
  });

  it('disables remote lifecycle for foreground molly start', () => {
    expect(resolveMachineLifecycleCapability(undefined)).toEqual({
      launchMode: 'foreground',
      canRemoteRestart: false,
      reason: 'not_daemon',
    });
  });
});
