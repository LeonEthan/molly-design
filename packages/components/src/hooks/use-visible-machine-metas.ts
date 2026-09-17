import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import type { MachineFlockRowFamily, MachineId, WorkspaceId } from '@molly/shared';
import { getMachineMetaMapAtom } from '@/atoms/machines';
import { userAtom } from '@/atoms';
import { onlineMachineIdsAtom } from '@/atoms/presence';
import { useMachineFlockRowsByMachineIdsState } from '@/hooks/use-machine-flock-rows';
import { mergeMachineFlockMachineMeta } from '@/lib/machine-flock-machine-meta-overlay';
import {
  buildVisibleMachineIndex,
  type MachineVisibilityAccess,
  type VisibleMachineIndex,
} from '@/lib/visible-machine-index';
import { useResolvedWorkspaceScope } from './use-resolved-workspace-scope';

export type { MachineVisibilityAccess };

const EMPTY_ACCESS_ROWS: MachineVisibilityAccess[] = [];

type UseVisibleMachineMetasOptions = {
  includeMachineFlock?: boolean;
  syncMachineFlock?: boolean;
  machineFlockFamilies?: readonly MachineFlockRowFamily[];
  workspaceId?: WorkspaceId | null;
  enabled?: boolean;
};

const DEFAULT_MACHINE_FLOCK_FAMILIES = [
  'localProject',
  'deleteLocalProjectCommand',
  'acpCapability',
  'rateLimit',
] as const satisfies readonly MachineFlockRowFamily[];

export type VisibleMachineMetas = VisibleMachineIndex & {
  machineFlockRemoteSyncedMachineIds: ReadonlySet<MachineId>;
};

export function useVisibleMachineMetas(
  options: UseVisibleMachineMetasOptions = {}
): VisibleMachineMetas {
  const includeMachineFlock = options.includeMachineFlock ?? true;
  const syncMachineFlock = options.syncMachineFlock ?? true;
  const { workspaceId, enabled } = useResolvedWorkspaceScope(options);
  const rawMachines = useAtomValue(getMachineMetaMapAtom);
  const onlineMachineIds = useAtomValue(onlineMachineIdsAtom);
  const currentUserId = useAtomValue(userAtom)?.id ?? null;
  const rawAccessRows = EMPTY_ACCESS_ROWS;
  const isLoading = !enabled || !workspaceId;

  const baseVisibleIndex = useMemo(
    () =>
      buildVisibleMachineIndex({
        rawMachines,
        convexAccessRows: rawAccessRows,
        currentUserId: enabled ? currentUserId : null,
        isLoading,
      }),
    [enabled, rawMachines, rawAccessRows, currentUserId, isLoading]
  );
  const visibleMachineIds = useMemo(
    () => [...baseVisibleIndex.machines.keys()],
    [baseVisibleIndex.machines]
  );
  const onlineVisibleMachineIds = useMemo(
    () => visibleMachineIds.filter((machineId) => onlineMachineIds.has(machineId)),
    [onlineMachineIds, visibleMachineIds]
  );
  const {
    rowsByMachineId: machineFlockRowsByMachineId,
    remoteSyncedMachineIds: machineFlockRemoteSyncedMachineIds,
  } = useMachineFlockRowsByMachineIdsState(
    includeMachineFlock && enabled ? visibleMachineIds : [],
    {
      families: options.machineFlockFamilies ?? DEFAULT_MACHINE_FLOCK_FAMILIES,
      syncRemote: enabled && syncMachineFlock,
      remoteMachineIds: enabled ? onlineVisibleMachineIds : [],
    }
  );
  const visibleMachinesWithFlockMeta = useMemo(
    () =>
      includeMachineFlock
        ? mergeMachineFlockMachineMeta(baseVisibleIndex.machines, machineFlockRowsByMachineId)
        : baseVisibleIndex.machines,
    [baseVisibleIndex.machines, includeMachineFlock, machineFlockRowsByMachineId]
  );

  return useMemo(
    () => ({
      ...baseVisibleIndex,
      machines: visibleMachinesWithFlockMeta,
      machineFlockRemoteSyncedMachineIds,
    }),
    [
      baseVisibleIndex,
      machineFlockRemoteSyncedMachineIds,
      visibleMachinesWithFlockMeta,
    ]
  );
}
