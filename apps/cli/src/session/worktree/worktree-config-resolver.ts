import {
  type MachineId,
  type SessionId,
  type SessionMeta,
  type WorktreeCleanupScriptConfig,
  type WorkspaceId,
} from '@molly/shared';
import type { LoroDocumentManager } from '@/lib/loro/doc';
import type { Logger } from '@/utils/logger';
import { readLegacySessionLaunchConfig } from '../session-launch-config-resolver';
import { readLocalProjectWorktreeCleanup } from './worktree-setup-config-store';

export async function resolveSessionWorktreeCleanupConfig(input: {
  token: string;
  workspaceId: WorkspaceId;
  machineId: MachineId;
  sessionId: SessionId;
  sessionMeta: SessionMeta | undefined;
  workspaceDocument: LoroDocumentManager;
  logger: Logger;
}): Promise<WorktreeCleanupScriptConfig | null> {
  const { sessionMeta } = input;
  if (sessionMeta?.project?.kind === 'local' && sessionMeta.isWorktree === true) {
    return await readLocalProjectWorktreeCleanup(sessionMeta.project.localProjectId);
  }
  if (sessionMeta?.project !== undefined && sessionMeta.project.kind !== 'github') {
    return null;
  }

  return (
    (
      await readLegacySessionLaunchConfig({
        repo: input.workspaceDocument.repo,
        workspaceId: input.workspaceId,
        machineId: input.machineId,
        sessionId: input.sessionId,
        sessionMeta,
        logger: input.logger,
      })
    )?.worktreeCleanup ?? null
  );
}
