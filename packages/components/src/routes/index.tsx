import { createFileRoute, Navigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { RouteMessage } from '@/components/route-message';
import { LoadingPlaceholder } from '@/components/loading-placeholder';
import {
  getLocalWorkspaceSlug,
  useLocalPlatformWorkspacesState,
} from '../providers/local-platform-provider';

export const Route = createFileRoute('/')({
  component: HomeRoute,
});

export function HomeRoute() {
  return <LocalHomeRoute />;
}

function LocalHomeRoute() {
  const { t } = useTranslation();
  const workspacesState = useLocalPlatformWorkspacesState();
  const workspace =
    workspacesState.status === 'ready' ? (workspacesState.workspaces[0] ?? null) : null;

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

  return (
    <Navigate
      to="/$workspaceName/chat"
      params={{ workspaceName: getLocalWorkspaceSlug(workspace) }}
      replace
    />
  );
}
