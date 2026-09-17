import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { createLocalPlatformProvider, createStaticStore } from '@molly/platform';
import { PlatformContext } from '@molly/platform/react';
import { LocalPlatformAuthProvider } from '@/providers/local-platform-auth-provider';

const settingsStoryUser = {
  id: 'settings-story-user',
  name: 'Local Designer',
  email: 'designer@example.com',
  image: null,
};

const localStoryPlatform = createLocalPlatformProvider({
  session: createStaticStore({ status: 'authenticated', user: settingsStoryUser }),
  workspaces: createStaticStore({
    status: 'ready',
    workspaces: [
      {
        id: 'settings-story-workspace',
        name: 'Molly',
        slug: 'local',
        role: 'owner' as const,
        members: [],
      },
    ],
    activeWorkspaceId: 'settings-story-workspace',
  }),
});

export function SettingsStoryProviders({ children }: { children: ReactNode }) {
  return (
    <PlatformContext.Provider value={localStoryPlatform}>
      <LocalPlatformAuthProvider>{children}</LocalPlatformAuthProvider>
    </PlatformContext.Provider>
  );
}

function createStoryRouter(children: ReactNode) {
  const rootRoute = createRootRoute({ component: () => <>{children}</> });
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: {},
  });
}

export function RoutedStory({ children }: { children: ReactNode }) {
  const [router] = useState(() => createStoryRouter(children));
  return <RouterProvider router={router} />;
}
