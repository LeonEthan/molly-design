import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import type { WorkspaceId } from '@molly/shared';
import { userAtom } from '@/atoms';
import {
  buildVisibleLocalProjectIndex,
  type LocalProjectVisibilityAccess,
  type VisibleLocalProjectIndex,
} from '@/lib/visible-local-project-index';
import { useVisibleMachineMetas } from './use-visible-machine-metas';
import type { VisibleMachineIndex } from '@/lib/visible-machine-index';
import { useResolvedWorkspaceScope } from './use-resolved-workspace-scope';

export type { LocalProjectVisibilityAccess };

const EMPTY_ACCESS_ROWS: LocalProjectVisibilityAccess[] = [];

type UseVisibleLocalProjectsOptions = {
  includeMachineFlock?: boolean;
  syncMachineFlock?: boolean;
  workspaceId?: WorkspaceId | null;
  enabled?: boolean;
};

export function useVisibleLocalProjects(
  options: UseVisibleLocalProjectsOptions = {}
): VisibleLocalProjectIndex {
  const visibleMachineIndex = useVisibleMachineMetas({
    includeMachineFlock: options.includeMachineFlock,
    syncMachineFlock: options.syncMachineFlock,
    workspaceId: options.workspaceId,
    enabled: options.enabled,
  });
  return useVisibleLocalProjectsFromMachineIndex(visibleMachineIndex, {
    workspaceId: options.workspaceId,
    enabled: options.enabled,
  });
}

export function useVisibleLocalProjectsFromMachineIndex(
  visibleMachineIndex: Pick<VisibleMachineIndex, 'machines' | 'accessByMachineId' | 'isLoading'>,
  options: { enabled?: boolean; workspaceId?: WorkspaceId | null } = {}
): VisibleLocalProjectIndex {
  const { enabled } = useResolvedWorkspaceScope(options);
  const currentUserId = useAtomValue(userAtom)?.id ?? null;
  const {
    machines: visibleMachines,
    accessByMachineId,
    isLoading: machineVisibilityLoading,
  } = visibleMachineIndex;
  const rawAccessRows = EMPTY_ACCESS_ROWS;
  const isLoading = enabled && machineVisibilityLoading;

  return useMemo(
    () =>
      buildVisibleLocalProjectIndex({
        rawMachines: visibleMachines,
        machineAccessByMachineId: accessByMachineId,
        convexAccessRows: rawAccessRows,
        currentUserId: enabled ? currentUserId : null,
        isLoading,
      }),
    [accessByMachineId, currentUserId, enabled, isLoading, rawAccessRows, visibleMachines]
  );
}
