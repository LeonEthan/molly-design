import { useCallback } from 'react';
import { useRouter, useRouterState } from '@tanstack/react-router';

declare module '@tanstack/react-router' {
  interface HistoryState {
    focusComposerSessionId?: string;
    focusDesignCanvasSessionId?: string;
  }
}

export function getSessionCreationNavigation(
  workspaceName: string,
  sessionId: string,
  options: { focusDesignCanvas?: boolean } = {}
) {
  return {
    to: '/$workspaceName/sessions/$sessionId' as const,
    params: { workspaceName, sessionId },
    state: {
      focusComposerSessionId: sessionId,
      focusDesignCanvasSessionId: options.focusDesignCanvas ? sessionId : undefined,
    },
  };
}

/** A navigation owns one focus handoff, consumed when its composer actually mounts. */
export function useComposerNavigationFocus(sessionId: string) {
  return useSessionCreationNavigationRequest(sessionId, 'focusComposerSessionId');
}

export function useDesignCanvasNavigationFocus(sessionId: string) {
  return useSessionCreationNavigationRequest(sessionId, 'focusDesignCanvasSessionId');
}

function useSessionCreationNavigationRequest(
  sessionId: string,
  requestKey: 'focusComposerSessionId' | 'focusDesignCanvasSessionId'
) {
  const router = useRouter();
  const entryKey = useRouterState({ select: (state) => state.location.state.__TSR_key });
  return useCallback(() => {
    const location = router.history.location;
    if (location.state.__TSR_key !== entryKey || location.state[requestKey] !== sessionId) {
      return false;
    }
    router.history.replace(location.href, {
      ...location.state,
      [requestKey]: undefined,
    });
    return true;
  }, [entryKey, requestKey, router, sessionId]);
}
