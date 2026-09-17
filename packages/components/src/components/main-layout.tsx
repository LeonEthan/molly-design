import { type ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import { tasksFeatureEnabledAtom } from '@/atoms/settings';
import { useTaskIndexSync } from '../hooks/use-task-index';
import { WebWorkspaceLayout } from './web-workspace-layout';
import { JoinCommunityDialogContainer } from './settings/join-community-dialog-container';
import { DesktopSettingsModal } from './settings/desktop-settings-modal';
import { TaskQuickAddDialogContainer } from './tasks/task-quick-add-dialog-container';
import { TaskStatusWatcher } from './tasks/task-status-watcher';
export function WorkspaceRuntimeShell({
  children,
}: {
  children: ReactNode;
}) {
  return <WebWorkspaceLayout>{children}</WebWorkspaceLayout>;
}

/** Keeps the workspace task index live for the sidebar count and the Tasks page. */
function TaskIndexSync() {
  useTaskIndexSync();
  return null;
}

export function MainLayout({
  children,
  workspaceReady = true,
}: {
  children: ReactNode;
  /**
   * Keeps the navigation shell mounted while a new workspace scope converges,
   * without starting workspace-owned background work or mobile content stacks.
   */
  workspaceReady?: boolean;
}) {
  // Behind the beta gate none of this mounts: no index subscription, no status
  // watcher, no quick-add dialog listening for its open atom.
  const tasksEnabled = useAtomValue(tasksFeatureEnabledAtom);

  return (
    <WorkspaceRuntimeShell>
      {children}
      {tasksEnabled && workspaceReady ? (
        <>
          <TaskIndexSync />
          <TaskStatusWatcher />
          <TaskQuickAddDialogContainer />
        </>
      ) : null}
      <JoinCommunityDialogContainer />
      {workspaceReady ? <DesktopSettingsModal /> : null}
    </WorkspaceRuntimeShell>
  );
}
