import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import type { MachineId, MachineLifecycleCapability } from '@molly/shared';
import { activeWorkspaceRuntimeAtom } from '@/atoms/runtime';
import { currentWorkspaceIdAtom } from '@/atoms/workspace-context';

export function useMachineLifecycleCapability({
  machineId,
  enabled,
}: {
  machineId: MachineId | null;
  enabled: boolean;
}): MachineLifecycleCapability | null {
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const [capability, setCapability] = useState<MachineLifecycleCapability | null>(null);

  useEffect(() => {
    setCapability(null);
    if (!runtime || !workspaceId || !machineId || !enabled) {
      return undefined;
    }

    let cancelled = false;
    const responsePromise = runtime.waitForMachineStatusResponse(machineId, { timeoutMs: 30000 });
    runtime.sendControl({
      type: 'machine/status',
      machineId,
      workspaceId,
    });
    void responsePromise.then((response) => {
      if (cancelled) return;
      setCapability(response?.success ? (response.lifecycle ?? null) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [machineId, enabled, runtime, workspaceId]);

  return capability;
}
