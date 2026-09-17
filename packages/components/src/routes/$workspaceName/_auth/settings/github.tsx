import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/$workspaceName/_auth/settings/github')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/$workspaceName/settings/agents', params });
  },
});
