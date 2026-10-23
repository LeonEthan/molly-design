import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { ArchiveLoadingScreen } from '@/components/archive/archive-loading-screen';

const LazyArchiveView = lazy(async () => {
  const module = await import('@/components/archive/archive-view');
  return { default: module.ArchiveView };
});

export const Route = createFileRoute('/$workspaceName/_auth/archive')({
  component: ArchiveRoute,
});

function ArchiveRoute() {
  return (
    <Suspense fallback={<ArchiveLoadingScreen />}>
      <LazyArchiveView />
    </Suspense>
  );
}
