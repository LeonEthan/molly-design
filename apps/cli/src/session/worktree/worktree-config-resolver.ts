import {
  resolveProjectGitHubRepo,
  type MachineId,
  type SessionId,
  type SessionMeta,
  type WorktreeCleanupScriptConfig,
  type WorktreeSetupScriptConfig,
  type WorkspaceId,
} from '@molly/shared';
import type { LoroDocumentManager } from '@/lib/loro/doc';
import type { Logger } from '@/utils/logger';
import { readLegacySessionLaunchConfig } from '../session-launch-config-resolver';
import { readLocalProjectWorktreeCleanup } from './worktree-setup-config-store';

export type GitHubRepoWorktreeConfig = {
  worktreeSetup?: WorktreeSetupScriptConfig;
  worktreeCleanup?: WorktreeCleanupScriptConfig;
};

export async function resolveGitHubRepoWorktreeConfig(_input: {
  token: string;
  workspaceId: WorkspaceId;
  repoFullName: string | undefined;
  logger: Logger;
}): Promise<GitHubRepoWorktreeConfig | null> {
  return null;
}

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

  const repoFullName =
    resolveProjectGitHubRepo(sessionMeta?.project) ?? sessionMeta?.repoFullName;
  return (
    (await resolveGitHubRepoWorktreeConfig({
      token: input.token,
      workspaceId: input.workspaceId,
      repoFullName,
      logger: input.logger,
    }))?.worktreeCleanup ??
    (
      await readLegacySessionLaunchConfig({
        repo: input.workspaceDocument.repo,
        workspaceId: input.workspaceId,
        machineId: input.machineId,
        sessionId: input.sessionId,
        sessionMeta,
        logger: input.logger,
      })
    )?.worktreeCleanup ??
    null
  );
}
