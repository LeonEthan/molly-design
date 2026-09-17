import type { SessionMeta, SessionToCreate } from '@molly/shared';
import { resolveProjectGitHubRepo } from '@molly/shared';

function normalizeRepoFullName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveSessionRepoFullName(
  session: Pick<SessionMeta, 'project' | 'repoFullName'>
): string {
  return normalizeRepoFullName(resolveProjectGitHubRepo(session.project) ?? session.repoFullName);
}

export function resolveSessionCreateRepoFullName(
  session: Pick<SessionToCreate, 'project' | 'repoFullName'>
): string {
  return normalizeRepoFullName(resolveProjectGitHubRepo(session.project) ?? session.repoFullName);
}
