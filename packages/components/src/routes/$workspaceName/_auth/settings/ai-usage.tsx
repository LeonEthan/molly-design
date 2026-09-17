import { createFileRoute, redirect } from '@tanstack/react-router';

/** Legacy hosted setting: open the local preferences page. */
export const Route = createFileRoute('/$workspaceName/_auth/settings/ai-usage')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/$workspaceName/settings/preferences',
      params: { workspaceName: params.workspaceName },
    });
  },
});
