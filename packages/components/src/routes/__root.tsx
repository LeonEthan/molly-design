import {
  createRootRouteWithContext,
  Outlet,
  useLocation,
  useNavigate,
} from '@tanstack/react-router';
import AppInitializer from '@/components/AppInitializer';
import { ThemeProvider } from '../theme-provider';
import { LanguageProvider } from '../i18n';
import { Toaster } from '@/ui/sonner';
import { NotFound } from '@/components/not-found';
import { TooltipProvider } from '@/ui';
import { RuntimeProvider } from '../providers/runtime-provider';
import { markStartupNavigationForEagerSync } from '../providers/startup-network-idle';
import { useEffect, useMemo, useState } from 'react';
import { ErrorBoundary } from '@/components/error-boundary';
import type { RouterContext } from '../router';
import { onIpcEvent } from '@/lib/electron-ipc-client';
import { useStableSession } from '@/hooks/useStableSession';
import { normalizeCurrentUserFromSessionUser } from '@/lib/current-user';
import { useSetAtom } from 'jotai';
import { authTokenAtom, userAtom } from '@/atoms';
import { ERROR_BOUNDARY_PROBE_EVENT, consumeErrorBoundaryProbe } from '@/lib/error-boundary-probe';
import { resolveDesktopOpenLocalProjectDeepLinkPath } from '@/lib/desktop-open-local-project-deep-link';
import { InterfaceFontController } from '@/components/interface-font-controller';
import { PlatformContext } from '@molly/platform/react';
import { getLocalPlatformProvider } from '../providers/local-platform-provider';
import { LocalPlatformAuthProvider } from '../providers/local-platform-auth-provider';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  notFoundComponent: NotFound,
  head: () => ({
    // TODO: head meta
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
    ],
  }),
});

function RootComponent() {
  return (
    <PlatformContext.Provider value={getLocalPlatformProvider()}>
      <LocalPlatformAuthProvider>
        <RootApp />
      </LocalPlatformAuthProvider>
    </PlatformContext.Provider>
  );
}

function ErrorBoundaryProbe() {
  const [eventProbeCount, setEventProbeCount] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const triggerProbe = () => setEventProbeCount((count) => count + 1);
    window.addEventListener(ERROR_BOUNDARY_PROBE_EVENT, triggerProbe);
    return () => window.removeEventListener(ERROR_BOUNDARY_PROBE_EVENT, triggerProbe);
  }, []);

  if (eventProbeCount > 0 || consumeErrorBoundaryProbe()) {
    const error = new Error('Molly ErrorBoundary probe');
    error.name = 'LodyErrorBoundaryProbeError';
    throw error;
  }

  return null;
}

function RootApp() {
  const { data: session } = useStableSession();
  const isElectron = typeof window !== 'undefined' && window.__MOLLY_ELECTRON__ === true;
  const setUser = useSetAtom(userAtom);
  const setAuthToken = useSetAtom(authTokenAtom);
  const currentUser = useMemo(() => {
    if (!session?.user) {
      return null;
    }
    return normalizeCurrentUserFromSessionUser(session.user);
  }, [session?.user]);
  useEffect(() => {
    setUser(currentUser);
  }, [currentUser, setUser]);

  useEffect(() => {
    setAuthToken(null);
  }, [setAuthToken]);

  return (
    <>
      {isElectron && <DesktopDeepLinkRouter />}
      <ThemeProvider>
        <InterfaceFontController enabled={isElectron} />
        <TooltipProvider skipDelayDuration={0}>
          <AppInitializer>
            <LanguageProvider>
              <>
                <Toaster />
                <RuntimeProvider>
                  {/* Location-driven effects and the Outlet boundary subscribe to
                      router state in these two small components, so a navigation
                      no longer re-renders the whole provider stack above. */}
                  <RootLocationEffects />
                  <RootOutletBoundary />
                </RuntimeProvider>
                {/* <TanStackRouterDevtools /> */}
              </>
            </LanguageProvider>
          </AppInitializer>
        </TooltipProvider>
      </ThemeProvider>
    </>
  );
}

/**
 * Owns every location-driven root effect (pageview tracking, auth redirects,
 * session-expiry handling). Renders nothing; keeping the subscription here
 * instead of in `RootApp` keeps the app-wide provider stack out of the
 * per-navigation re-render.
 */
function RootLocationEffects() {
  const location = useLocation();

  useEffect(() => {
    markStartupNavigationForEagerSync();
  }, [location.href]);

  useEffect(() => {
    // A stale modal layer can leave the desktop surface unable to receive clicks.
    if (typeof document !== 'undefined' && document.body.style.pointerEvents === 'none') {
      document.body.style.pointerEvents = '';
    }
  }, [location.pathname]);

  return null;
}

/**
 * The root Outlet wrapped in its error boundary. Subscribes to the location
 * (for `resetKeys`) so `RootApp` and the providers above don't have to.
 */
function RootOutletBoundary() {
  const location = useLocation({
    select: (l) => ({ pathname: l.pathname, search: l.search }),
  });
  return (
    <ErrorBoundary
      name="RootOutlet"
      variant="page"
      resetKeys={[location.pathname, location.search]}
      showErrorDetails
      propagateAuthErrors={false}
    >
      <ErrorBoundaryProbe />
      <Outlet />
    </ErrorBoundary>
  );
}

/** Navigate to a local-project path, preserving its optional query string. */
function navigateToResolvedPath(navigate: ReturnType<typeof useNavigate>, path: string): void {
  const queryIndex = path.indexOf('?');
  if (queryIndex === -1) {
    void navigate({ to: path, replace: true });
    return;
  }
  const to = path.slice(0, queryIndex);
  const search = Object.fromEntries(new URLSearchParams(path.slice(queryIndex + 1)));
  void navigate({ to, search, replace: true });
}

function DesktopDeepLinkRouter() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof window === 'undefined' || window.__MOLLY_ELECTRON__ !== true) {
      return undefined;
    }
    return onIpcEvent('app.deepLink', (url) => {
      const openLocalProjectPath = resolveDesktopOpenLocalProjectDeepLinkPath(
        url,
        location.pathname
      );
      if (openLocalProjectPath) {
        navigateToResolvedPath(navigate, openLocalProjectPath);
      }
    });
  }, [location.pathname, navigate]);

  return null;
}
