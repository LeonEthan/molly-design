import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/desktop/checkout-return')({
  beforeLoad: () => {
    throw redirect({ to: '/' });
  },
});
