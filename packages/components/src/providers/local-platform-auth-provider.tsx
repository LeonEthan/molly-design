import { useMemo, type ReactNode } from 'react';
import { StableSessionContext, type StableSessionValue } from '../hooks/useStableSession';
import {
  AuthenticatedConvexContext,
  type AuthenticatedConvexContextValue,
} from '@/hooks/use-authenticated-convex';
import { usePlatformSession } from '@molly/platform/react';

/**
 * Local authentication contexts for the desktop shell. Session identity comes
 * from the CLI-owned platform snapshot, while hosted queries remain disabled.
 */

/**
 * The synthetic email exists only to satisfy `normalizeCurrentUserFromSessionUser`
 * (zod `email()`), which populates `userAtom` in the root shell. The domain must
 * not be the missing-email domain, or the root shell would bounce to
 * /complete-email.
 */
const LOCAL_AUTHENTICATED_CONVEX_VALUE: AuthenticatedConvexContextValue = {
  authSessionId: null,
  isAuthenticated: false,
  isLoading: false,
  isRecovering: false,
  confirmedUnauthenticated: false,
  claimAutomaticCommand: () => false,
  requestAuthRecovery: () => {},
};

export function LocalPlatformAuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const platformSession = usePlatformSession();
  const sessionValue = useMemo<StableSessionValue>(() => {
    const user =
      platformSession.status === 'authenticated'
        ? {
            id: platformSession.user.id,
            name: platformSession.user.name ?? 'Local',
            email: 'local@molly-design.local',
            image: platformSession.user.image ?? null,
          }
        : null;
    return { data: user ? { user } : null };
  }, [platformSession]);

  return (
    <StableSessionContext.Provider value={sessionValue}>
      <AuthenticatedConvexContext.Provider value={LOCAL_AUTHENTICATED_CONVEX_VALUE}>
        {children}
      </AuthenticatedConvexContext.Provider>
    </StableSessionContext.Provider>
  );
}
