import { useCallback, useMemo } from 'react';
import { atom, useAtomValue } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { useTranslation } from 'react-i18next';
import { getSessionRoomId, type SessionId } from '@molly/shared';
import { sessionMetaAtomFamily } from '@/atoms/doc-meta';
import { activeWorkspaceRuntimeAtom } from '@/atoms/runtime';
import { resolveSessionFileOpenTarget } from '@/lib/session-file-open-target';

export function useSessionMarkdownImageResolver(sessionId?: SessionId) {
  const { t } = useTranslation();
  const unavailable = t('sessions.imageLoadUnavailable', 'Unable to load image');
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const routeAtom = useMemo(
    () =>
      sessionId
        ? selectAtom(
            sessionMetaAtomFamily(getSessionRoomId(sessionId)),
            (session) => ({
              machineId: session?.machineId,
              ownerSessionId: session?.parentSessionId ?? sessionId,
            }),
            (previous, next) =>
              previous.machineId === next.machineId &&
              previous.ownerSessionId === next.ownerSessionId
          )
        : atom(null),
    [sessionId]
  );
  const route = useAtomValue(routeAtom);

  return useCallback(
    async (href: string): Promise<string> => {
      if (!sessionId || !route?.machineId || !runtime) throw new Error(unavailable);
      const { filePath } = resolveSessionFileOpenTarget({
        rawPath: href,
        pathKind: 'markdown-href',
      });
      const result = await runtime.requestFilePreview(
        route.machineId,
        { sessionId, path: filePath },
        { ownerSessionId: route.ownerSessionId }
      );
      if (result.status === 'resource' && result.kind === 'binary') return result.url;
      throw new Error(result.status === 'error' ? result.message : unavailable);
    },
    [route, runtime, sessionId, unavailable]
  );
}
