import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/email-verified')({
  beforeLoad: () => {
    throw redirect({ to: '/' });
  },
});
