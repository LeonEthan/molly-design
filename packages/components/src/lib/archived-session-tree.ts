import type { SessionMeta } from '@molly/shared';
import { buildOpenedBySessionTree, type OpenedBySessionTreeNode } from './session-opened-by-tree';

export function buildArchivedSessionTree(
  sessions: readonly SessionMeta[]
): OpenedBySessionTreeNode<SessionMeta>[] {
  return buildOpenedBySessionTree(sessions, {
    getId: (session) => session.id,
    getOpenedBySessionId: (session) => session.openedByRootSessionId ?? session.openedBySessionId,
  });
}
