import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { lazy, useEffect, useRef } from 'react';
import { ElectronSessionCompletionNotifier } from '@/components/electron-session-completion-notifier';
import { ElectronMenuHandler } from '@/components/electron-menu-handler';
import { AppCommands } from '@/components/app-commands';
import { CommandPalette } from '@/components/commands/command-palette';
import { AutoArchivePrWatcher } from '@/components/auto-archive-pr-watcher';
import { RouteSuspense } from '@/components/route-suspense';
import { writeLastAppRoutePath } from '@/lib/last-app-route';
import { useWorkspaceBadge } from '@/hooks/use-workspace-badge';


const LazyMainLayout = lazy(async () => {
  const module = await import('@/components/main-layout');
  return { default: module.MainLayout };
});

export const Route = createFileRoute('/$workspaceName/_auth')({
  component: MainLayoutComponent,
});

function MainLayoutComponent() {
  return <LocalPlatformLayoutContent />;
}

function LocalPlatformLayoutContent() {
  useWorkspaceBadge();

  return (
    <RouteSuspense>
      <LazyMainLayout>
        <AuthedWorkspaceRouteTracker />
        <Outlet />
        <ElectronSessionCompletionNotifier />
        <ElectronMenuHandler />
        <AppCommands />
        <CommandPalette />
        <AutoArchivePrWatcher />
      </LazyMainLayout>
    </RouteSuspense>
  );
}

function AuthedWorkspaceRouteTracker() {
  const location = useLocation();
  const routeHref = location.href;
  const routeHrefRef = useRef(routeHref);
  routeHrefRef.current = routeHref;

  useEffect(() => {
    writeLastAppRoutePath(routeHref);
  }, [routeHref]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    const persistCurrentRoute = () => {
      writeLastAppRoutePath(routeHrefRef.current);
    };
    const persistWhenHidden = () => {
      if (document.visibilityState === 'hidden') {
        persistCurrentRoute();
      }
    };

    window.addEventListener('pagehide', persistCurrentRoute);
    document.addEventListener('visibilitychange', persistWhenHidden);

    return () => {
      window.removeEventListener('pagehide', persistCurrentRoute);
      document.removeEventListener('visibilitychange', persistWhenHidden);
    };
  }, []);

  return null;
}
