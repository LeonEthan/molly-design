import { createFileRoute, Navigate, notFound, Outlet, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useWorkspaceContextAtoms } from '@/hooks/use-workspace-context-atoms';
import { RouteMessage } from '@/components/route-message';
import { LoadingPlaceholder } from '@/components/loading-placeholder';
import {
  WORKSPACE_SLUG_RESERVED_LANDING_EXACT_PATHS,
  WORKSPACE_SLUG_RESERVED_LANDING_PREFIXES,
} from '@molly/shared';
import { WorkspaceRouteTargetProvider } from '../providers/workspace-route-target';
import {
  getLocalWorkspaceSlug,
  useLocalPlatformWorkspacesState,
} from '../providers/local-platform-provider';

// Paths that are served by the CF Pages middleware as landing pages.
// If a client-side navigation targets one of these, we must do a full page
// reload so the middleware can serve the correct content.
// Keep in sync with LANDING_PATH_PREFIXES / LANDING_EXACT_PATHS in
// functions/_middleware.ts.
const LANDING_PATH_PREFIXES: readonly string[] = WORKSPACE_SLUG_RESERVED_LANDING_PREFIXES;
const LANDING_EXACT_NAMES = new Set<string>(WORKSPACE_SLUG_RESERVED_LANDING_EXACT_PATHS);

/**
 * Determine whether the current pathname should be served by the CF Pages
 * middleware as a landing page. Must stay in sync with `isLandingPath` in
 * `functions/_middleware.ts`.
 *
 * For **prefix** landing names (`docs`, `blog`, …) the middleware serves
 * the entire subtree, so any sub-path is a valid redirect target.
 *
 * For **exact** landing names (`home`, `price`, `download`, ...) the middleware only serves
 * the root path (`/home`, `/price`). Deeper paths like `/home/foo/bar`
 * are *not* recognised by the middleware and would fall back to the App SPA,
 * creating an infinite reload loop if we redirect with `reloadDocument`.
 */
function shouldRedirectToLanding(workspaceName: string, pathname: string): boolean {
  if (LANDING_PATH_PREFIXES.includes(workspaceName)) {
    return true;
  }
  if (LANDING_EXACT_NAMES.has(workspaceName)) {
    const stripped = pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;
    return stripped === `/${workspaceName}`;
  }
  return false;
}

function isLandingWorkspaceName(name: string): boolean {
  if (LANDING_EXACT_NAMES.has(name)) return true;
  if (LANDING_PATH_PREFIXES.includes(name)) return true;
  return false;
}

export const Route = createFileRoute('/$workspaceName')({
  beforeLoad: ({ params, location }) => {
    if (shouldRedirectToLanding(params.workspaceName, location.pathname)) {
      // Force full-page navigation so the CF Pages middleware serves the
      // landing page instead of the App SPA treating it as a workspace.
      // Use the full target href to preserve deep links like /docs/quickstart.
      if (typeof window !== 'undefined') {
        throw redirect({ href: location.href, reloadDocument: true });
      }
      throw redirect({ to: '/' });
    }
    // The workspace name collides with a landing-page name but the full path
    // is not a valid landing URL (e.g. /home/foo/bar). There is no workspace
    // with this name, so surface a 404 immediately instead of entering the
    // workspace guard flow (which would show loading spinners then redirect).
    if (isLandingWorkspaceName(params.workspaceName)) {
      throw notFound();
    }
  },
  component: WorkspaceGuardRoute,
});

function WorkspaceGuardRoute() {
  const { workspaceName } = Route.useParams();
  // The URL target is available during render, before workspace atoms and
  // runtime effects converge. Descendants use it to reject previous-scope data.
  return (
    <WorkspaceRouteTargetProvider slug={workspaceName}>
      <LocalWorkspaceGuardRoute />
    </WorkspaceRouteTargetProvider>
  );
}

function LocalWorkspaceGuardRoute() {
  const { t } = useTranslation();
  const { workspaceName } = Route.useParams();
  const workspacesState = useLocalPlatformWorkspacesState();
  const workspace =
    workspacesState.status === 'ready' ? (workspacesState.workspaces[0] ?? null) : null;

  // Establish the workspace-context atoms from the implicit workspace: the
  // runtime provider keys off these atoms, not the router.
  useWorkspaceContextAtoms(
    workspaceName,
    workspace ? { status: 'member', organizationId: workspace.id } : undefined
  );

  if (workspacesState.status === 'error') {
    return (
      <RouteMessage
        title={t('workspace.route.loadingWorkspacesErrorTitle')}
        description={t('workspace.route.loadingWorkspacesErrorDescription')}
      />
    );
  }

  if (!workspace) {
    return (
      <LoadingPlaceholder
        title={t('workspace.route.localStartingTitle')}
        description={t('workspace.route.localStartingDescription')}
      />
    );
  }

  // A stale or hand-typed slug still refers to the only workspace; converge on
  // its canonical slug instead of rendering under a mismatched URL.
  const canonicalSlug = getLocalWorkspaceSlug(workspace);
  if (workspaceName !== canonicalSlug) {
    return <Navigate to="/$workspaceName/chat" params={{ workspaceName: canonicalSlug }} replace />;
  }

  return <Outlet />;
}
