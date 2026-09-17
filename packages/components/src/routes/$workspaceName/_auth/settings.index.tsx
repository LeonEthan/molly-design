import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/$workspaceName/_auth/settings/')({
  component: SettingsIndexComponent,
});

function SettingsIndexComponent() {
  const { workspaceName } = Route.useParams();
  return (
    <Navigate
      to="/$workspaceName/settings/preferences"
      params={{ workspaceName }}
      search={(prev) => prev}
      replace
    />
  );
}
