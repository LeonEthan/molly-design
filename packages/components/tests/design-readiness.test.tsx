// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ModelConnection,
  ProtectedImageConnection,
  SaveModelConnection,
} from '@molly/shared/embedded-harness';
import {
  DesignReadinessView,
  type DesignReadinessTarget,
  type DesignReadinessViewProps,
} from '../src/components/settings/design-readiness';
import { MachineAgentSettings } from '../src/components/settings/machine-agent-settings';
import { initI18n } from '../src/i18n';

const fakes = vi.hoisted(() => ({
  ipcAvailable: false,
  connections: [] as unknown[],
  imageConnection: null as unknown,
  pinterestCookies: 0,
  openedTab: undefined as string | undefined,
}));
vi.mock('../src/lib/electron-ipc-client', () => ({
  getIpcServices: () =>
    fakes.ipcAvailable
      ? {
          modelConnections: {
            getSnapshot: async () => ({ connections: fakes.connections }),
            save: async (input: SaveModelConnection) => {
              const current = fakes.connections[0] as ModelConnection;
              return { ...current, revision: current.revision + 1, enabled: input.enabled };
            },
            getImageSnapshot: async () => ({ connection: fakes.imageConnection }),
          },
        }
      : null,
  getPublicBrowserBridge: () =>
    fakes.ipcAvailable
      ? {
          getAccountSummary: async () => ({
            persistent: true,
            importAvailable: false,
            sites: [{ site: 'pinterest.com', cookieCount: fakes.pinterestCookies }],
          }),
        }
      : null,
}));
vi.mock('../src/hooks/use-open-settings', () => ({
  useOpenSettings: () => ({
    openSettings: (tab: string) => {
      fakes.openedTab = tab;
    },
  }),
}));
vi.mock('../src/hooks/use-machine-flock-agent-configs', () => ({
  useMachineFlockAgentConfigsForMachineIds: () => undefined,
}));

const connection: ModelConnection = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  providerPresetId: 'deepseek',
  displayName: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  enabled: true,
  credentialRef: 'synthetic-reference',
};
const imageConnection: ProtectedImageConnection = {
  id: '00000000-0000-4000-8000-000000000009',
  revision: 1,
  enabled: true,
  baseUrl: 'https://images.example.com/v1',
  model: 'synthetic-image-model',
  hasApiKey: true,
  legacyHistoryMayContainKey: false,
};

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  await initI18n('en');
  fakes.ipcAvailable = false;
  fakes.openedTab = undefined;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const chips = () =>
  [...host.querySelectorAll<HTMLButtonElement>('ul[aria-label="Design setup"] button')].map(
    (chip) => `${chip.dataset.state}: ${chip.textContent}`
  );

async function renderView(props: Partial<DesignReadinessViewProps>) {
  const shown: DesignReadinessTarget[] = [];
  await act(async () =>
    root.render(<DesignReadinessView onShow={(target) => shown.push(target)} {...props} />)
  );
  return shown;
}

describe('design setup strip', () => {
  it('names the connections in use and never ticks Pinterest from stored cookies', async () => {
    await renderView({
      connections: [
        connection,
        { ...connection, id: '00000000-0000-4000-8000-000000000002', displayName: 'Kimi' },
        { ...connection, id: '00000000-0000-4000-8000-000000000003', enabled: false },
      ],
      imageConnection,
      pinterestCookieCount: 12,
    });
    expect(chips()).toEqual([
      'set: Models· Configured: DeepSeek +1',
      'set: Image generation (optional)· Configured: synthetic-image-model',
      'unverified: Pinterest (optional)· Sign-in not verified',
    ]);
  });

  it.each([
    [[], 'Not configured'],
    [[{ ...connection, enabled: false }], 'Off'],
    [
      [
        {
          ...connection,
          providerPresetId: 'moonshot',
          baseUrl: 'https://api.kimi.com/coding/v1',
        } satisfies ModelConnection,
      ],
      'Needs a fix',
    ],
  ] as const)('explains why no model is in use', async (connections, reason) => {
    await renderView({ connections });
    expect(chips()[0]).toBe(`unset: Models· ${reason}`);
  });

  it.each([
    [null, 'Off'],
    [{ ...imageConnection, enabled: false }, 'Off'],
    [{ ...imageConnection, hasApiKey: false }, 'Key missing'],
  ] as const)('explains why image generation is not set up', async (image, reason) => {
    await renderView({ imageConnection: image, pinterestCookieCount: 0 });
    expect(chips().slice(1)).toEqual([
      `unset: Image generation (optional)· ${reason}`,
      'unset: Pinterest (optional)· Not signed in',
    ]);
  });

  it('claims nothing about a setting it has not read', async () => {
    await renderView({});
    expect(chips()).toEqual([
      'unknown: Models',
      'unknown: Image generation (optional)',
      'unknown: Pinterest (optional)',
    ]);
  });

  it('sends each chip to the place that fixes it', async () => {
    const shown = await renderView({});
    for (const chip of host.querySelectorAll('button')) await act(async () => chip.click());
    expect(shown).toEqual(['models', 'image', 'pinterest']);
  });
});

describe('AI models page', () => {
  async function renderPage() {
    fakes.ipcAvailable = true;
    fakes.connections = [connection];
    fakes.imageConnection = null;
    fakes.pinterestCookies = 0;
    await act(async () =>
      root.render(
        <Provider store={createStore()}>
          <MachineAgentSettings
            selectedMachineId={null}
            onSelectedMachineChange={() => undefined}
          />
        </Provider>
      )
    );
  }

  it('follows a connection switched off below it', async () => {
    await renderPage();
    expect(chips()).toEqual([
      'set: Models· Configured: DeepSeek',
      'unset: Image generation (optional)· Off',
      'unset: Pinterest (optional)· Not signed in',
    ]);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Use DeepSeek"]')!.click()
    );
    expect(chips()[0]).toBe('unset: Models· Off');
  });

  it('moves to the image section in place and opens Website accounts for Pinterest', async () => {
    HTMLElement.prototype.scrollIntoView = () => undefined;
    await renderPage();
    const chip = (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>('ul[aria-label="Design setup"] button')].find(
        (entry) => entry.textContent?.startsWith(label)
      )!;
    await act(async () => chip('Image generation').click());
    expect(document.activeElement?.textContent).toContain('Set up image generation');
    expect(document.activeElement?.textContent).not.toContain('Add model connection');
    await act(async () => chip('Pinterest').click());
    expect(fakes.openedTab).toBe('browser-accounts');
  });

  it('shows no strip without the desktop services', async () => {
    await act(async () =>
      root.render(
        <Provider store={createStore()}>
          <MachineAgentSettings
            selectedMachineId={null}
            onSelectedMachineChange={() => undefined}
          />
        </Provider>
      )
    );
    expect(host.querySelector('ul[aria-label="Design setup"]')).toBeNull();
  });
});
