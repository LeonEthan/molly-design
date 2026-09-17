import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/desktop/github-install')({
  beforeLoad: () => {
    throw redirect({ to: '/' });
  },
});
