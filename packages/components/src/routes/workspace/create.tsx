import { createFileRoute, redirect } from '@tanstack/react-router';

/** Legacy product-cloud URL: land in the local desktop product. */
export const Route = createFileRoute('/workspace/create')({
  beforeLoad: () => {
    throw redirect({ to: '/' });
  },
});
