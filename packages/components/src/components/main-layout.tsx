import { type ReactNode } from 'react';
import { WebWorkspaceLayout } from './web-workspace-layout';
import { JoinCommunityDialogContainer } from './settings/join-community-dialog-container';
import { DesktopSettingsModal } from './settings/desktop-settings-modal';
export function WorkspaceRuntimeShell({
  children,
}: {
  children: ReactNode;
}) {
  return <WebWorkspaceLayout>{children}</WebWorkspaceLayout>;
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
  return (
    <WorkspaceRuntimeShell>
      {children}
      <JoinCommunityDialogContainer />
      {workspaceReady ? <DesktopSettingsModal /> : null}
    </WorkspaceRuntimeShell>
  );
}
