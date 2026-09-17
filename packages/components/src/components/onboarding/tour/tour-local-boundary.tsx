import { useMemo, type ReactNode } from 'react';
import { createStaticStore, type PlatformProvider } from '@molly/platform';
import { PlatformContext, usePlatform } from '@molly/platform/react';
import {
  AuthenticatedConvexContext,
  type AuthenticatedConvexContextValue,
} from '@/hooks/use-authenticated-convex';
import {
  TOUR_USER_ID,
  TOUR_WORKSPACE_ID,
  TOUR_WORKSPACE_SLUG,
  type TourIdentity,
} from './tour-fixtures';

const TOUR_AUTH_VALUE: AuthenticatedConvexContextValue = {
  authSessionId: 'onboarding-tour-local',
  isAuthenticated: true,
  isLoading: false,
  isRecovering: false,
  confirmedUnauthenticated: false,
  claimAutomaticCommand: () => false,
  requestAuthRecovery: () => {},
};

function rejectTourWrite(): Promise<never> {
  return Promise.reject(new Error('The onboarding tour is read-only'));
}

/** Real components render against read-only local fixture identity and documents. */
export function TourLocalBoundary({
  children,
  identity,
}: {
  children: ReactNode;
  identity: TourIdentity;
}) {
  const outerPlatform = usePlatform();
  const tourPlatform = useMemo<PlatformProvider>(
    () => ({
      ...outerPlatform,
      identity: {
        session: createStaticStore({
          status: 'authenticated',
          user: {
            id: TOUR_USER_ID,
            name: identity.userName,
            email: identity.userEmail,
          },
        }),
        signOut: rejectTourWrite,
      },
      workspaces: {
        state: createStaticStore({
          status: 'ready',
          workspaces: [
            {
              id: TOUR_WORKSPACE_ID,
              name: identity.workspaceName,
              slug: TOUR_WORKSPACE_SLUG,
              role: 'owner',
            },
          ],
          activeWorkspaceId: TOUR_WORKSPACE_ID,
        }),
        setActive: rejectTourWrite,
        create: rejectTourWrite,
      },
    }),
    [identity.userEmail, identity.userName, identity.workspaceName, outerPlatform]
  );

  return (
    <PlatformContext.Provider value={tourPlatform}>
      <AuthenticatedConvexContext.Provider value={TOUR_AUTH_VALUE}>
        {children}
      </AuthenticatedConvexContext.Provider>
    </PlatformContext.Provider>
  );
}
