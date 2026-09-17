import type { PermissionRequestKind, SessionId, WorkspaceId } from '@molly/shared';

export type PermissionRequestNotificationInput = {
  sessionId: SessionId;
  sessionTitle: string | null | undefined;
  workspaceId: WorkspaceId;
  workspaceSlug: string;
  userId: string;
  requestId: string;
  toolCallId: string;
  toolTitle: string | null | undefined;
  toolKind: string | null | undefined;
  requestKind?: PermissionRequestKind;
};

export type LiveActivitySummarySyncResult =
  | { sent: true; ended: boolean }
  | { sent: false; reason?: string };
