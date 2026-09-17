import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/complete-email')({
  beforeLoad: () => {
    throw redirect({ to: '/' });
  },
});
