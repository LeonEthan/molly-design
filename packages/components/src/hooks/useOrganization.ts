import { useMemo } from 'react';
import type { PlatformUser, WorkspaceSummary } from '@molly/platform';
import { usePlatformSession } from '@molly/platform/react';
import { useImplicitLocalWorkspace } from '../providers/local-platform-provider';

type LocalOrganization = WorkspaceSummary & {
  slug: string;
  logo: null;
  members: {
    userId: string;
    role: string;
    user: { name: string; image: string | null; email: string };
  }[];
};

function projectLocalOrganization(
  workspace: WorkspaceSummary,
  user: PlatformUser
): LocalOrganization {
  return {
    ...workspace,
    slug: workspace.slug ?? workspace.id,
    logo: null,
    members: [{
      userId: user.id,
      role: workspace.role,
      user: { name: user.name ?? 'Local', image: null, email: 'local@molly-design.local' },
    }],
  };
}

const unavailable = () => Promise.reject(new Error('Workspace management is unavailable locally'));

/** One implicit workspace backed by the local daemon, with no product-cloud auth. */
export function useOrganization(_options?: { targetSlug?: string }) {
  const workspace = useImplicitLocalWorkspace();
  const session = usePlatformSession();
  return useMemo(() => {
    const user = session.status === 'authenticated' ? session.user : null;
    const activeOrganization =
      workspace && user ? projectLocalOrganization(workspace, user) : null;
    const loading = activeOrganization === null;
    return {
      organizations: activeOrganization ? [activeOrganization] : undefined,
      organizationsLoading: loading,
      activeOrganizationLoading: loading,
      refetchOrganizations: () => Promise.resolve(),
      refetchActiveOrganization: () => Promise.resolve(),
      role: workspace?.role,
      hasAdminPermission: true,
      loading,
      error: null,
      activeOrganization,
      activateOrganization: (_organizationId: string) => Promise.resolve(),
      switchOrganization: (_organizationId: string) => Promise.resolve(),
      createOrganization: (_name: string, _slug: string): Promise<WorkspaceSummary> => unavailable(),
      updateOrganization: unavailable,
      deleteOrganization: unavailable,
      leaveOrganization: unavailable,
    };
  }, [session, workspace]);
}
