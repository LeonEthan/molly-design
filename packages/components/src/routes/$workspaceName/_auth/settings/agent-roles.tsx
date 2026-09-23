import { createFileRoute, redirect } from '@tanstack/react-router';

/** Retired Agent Roles setting: open the local preferences page. */
export const Route = createFileRoute('/$workspaceName/_auth/settings/agent-roles')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/$workspaceName/settings/preferences',
      params: { workspaceName: params.workspaceName },
    });
  },
});
