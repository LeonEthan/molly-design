import { describe, expect, it, vi } from 'vitest';
import type { MachineId } from '@molly/shared';
import {
  TargetRoutedMachineMonitor,
  type MachineMonitorTransportPort,
} from '../src/providers/target-routed-machine-monitor';

const MACHINE = 'machine-local' as MachineId;

const makePort = () => {
  const unsubscribe = vi.fn();
  const subscribeMachine = vi.fn(() => unsubscribe);
  const forceSample = vi.fn();
  return {
    port: { subscribeMachine, forceSample } satisfies MachineMonitorTransportPort,
    subscribeMachine,
    forceSample,
    unsubscribe,
  };
};

describe('TargetRoutedMachineMonitor', () => {
  it('binds a pending subscription when the local monitor arrives', () => {
    const local = makePort();
    const monitor = new TargetRoutedMachineMonitor();
    const listener = vi.fn();
    const unsubscribe = monitor.subscribeMachine(MACHINE, listener);

    monitor.forceSample(MACHINE);
    expect(local.subscribeMachine).not.toHaveBeenCalled();
    monitor.setLocalTransport(local.port);
    expect(local.subscribeMachine).toHaveBeenCalledWith(MACHINE, listener);
    monitor.forceSample(MACHINE);
    expect(local.forceSample).toHaveBeenCalledWith(MACHINE);

    unsubscribe();
    expect(local.unsubscribe).toHaveBeenCalled();
  });
});
