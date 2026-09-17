// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_PLATFORM_CAPABILITIES,
  createStaticStore,
  type PlatformProvider,
} from '@molly/platform';
import { PlatformContext } from '@molly/platform/react';
import { resetTimeSync } from '@molly/shared';
import AppInitializer from '../src/components/AppInitializer';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createProvider(): PlatformProvider {
  return {
    kind: 'local',
    identity: {
      session: createStaticStore({ status: 'unauthenticated' as const }),
      signOut: () => Promise.resolve(),
    },
    workspaces: {
      state: createStaticStore({
        status: 'ready' as const,
        workspaces: [],
        activeWorkspaceId: null,
      }),
      setActive: () => Promise.resolve(),
    },
    capabilities: LOCAL_PLATFORM_CAPABILITIES,
    cloudApi: null,
    sync: { mode: 'local' },
  };
}

describe('AppInitializer local startup', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    resetTimeSync();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    resetTimeSync();
  });

  async function renderWith(platform: PlatformProvider): Promise<void> {
    await act(async () => {
      root.render(
        <PlatformContext.Provider value={platform}>
          <AppInitializer>ready</AppInitializer>
        </PlatformContext.Provider>
      );
      await Promise.resolve();
    });
  }

  it('performs no time-server request on the account-free local platform', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await renderWith(createProvider());

    expect(fetchMock).not.toHaveBeenCalled();
  });

});
