import type { WorkspaceId } from '@molly/shared';
import { useVisibleLocalProjects } from '@/hooks/use-visible-local-projects';
import { useVisibleMachineMetas } from '@/hooks/use-visible-machine-metas';
import { useResolvedWorkspaceScope } from './use-resolved-workspace-scope';

type UseLocalResourceVisibilityOptions = {
  includeLocalProjectDetails?: boolean;
  workspaceId?: WorkspaceId | null;
  enabled?: boolean;
};

/** Visible local machines and folders for desktop navigation and presence. */
export function useLocalResourceVisibility(options: UseLocalResourceVisibilityOptions = {}) {
  const scope = useResolvedWorkspaceScope(options);
  const machineIndex = useVisibleMachineMetas({
    includeMachineFlock: false,
    workspaceId: scope.workspaceId,
    enabled: scope.enabled,
  });
  const projectIndex = useVisibleLocalProjects({
    includeMachineFlock: options.includeLocalProjectDetails ?? false,
    syncMachineFlock: false,
    workspaceId: scope.workspaceId,
    enabled: scope.enabled,
  });
  return {
    machines: machineIndex.machines,
    accessByMachineId: machineIndex.accessByMachineId,
    projects: projectIndex.projects,
    accessByProjectKey: projectIndex.accessByProjectKey,
    machineVisibilityLoading: machineIndex.isLoading,
    localProjectVisibilityLoading: projectIndex.isLoading,
    isLoading: machineIndex.isLoading || projectIndex.isLoading,
  };
}
