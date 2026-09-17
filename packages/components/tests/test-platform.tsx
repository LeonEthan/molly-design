import type { ReactNode } from 'react';
import {
  CLOUD_PLATFORM_CAPABILITIES,
  createStaticStore,
  type PlatformProvider,
} from '@molly/platform';
import { PlatformContext } from '@molly/platform/react';
import { cloudPlatformApi } from './cloud-platform-api.fixture';

/**
 * Explicit cloud composition root for component and hook tests.
 *
 * The production PlatformContext intentionally has no default. Tests that
 * exercise cloud-backed UI should mount this provider so a missing app-level
 * platform assembly remains a fail-fast programming error.
 */
export const TEST_CLOUD_PLATFORM: PlatformProvider = {
  kind: 'cloud',
  identity: {
    session: createStaticStore({ status: 'unauthenticated' }),
    signOut: async () => {},
  },
  workspaces: {
    state: createStaticStore({
      status: 'ready',
      workspaces: [],
      activeWorkspaceId: null,
    }),
    setActive: async () => {},
  },
  capabilities: CLOUD_PLATFORM_CAPABILITIES,
  cloudApi: cloudPlatformApi,
  sync: { mode: 'cloud' },
};

export function TestCloudPlatformProvider({ children }: { children: ReactNode }) {
  return (
    <PlatformContext.Provider value={TEST_CLOUD_PLATFORM}>{children}</PlatformContext.Provider>
  );
}
