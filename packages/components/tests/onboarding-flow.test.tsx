// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore, type Store } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfigId, AgentConfigMeta, MachineId, WorkspaceId } from '@molly/shared';
import { getAgentConfigRoomId } from '@molly/shared';
import { createLocalPlatformProvider, createStaticStore } from '@molly/platform';
import { PlatformContext } from '@molly/platform/react';

const mocks = vi.hoisted(() => ({
  getCliState: vi.fn(),
  onCliState: vi.fn(),
}));

vi.mock('../src/hooks/use-recoverable-convex-query', () => ({
  usePublicConvexQuery: () => undefined,
  useRecoverableConvexQuery: () => [],
}));

vi.mock('../src/hooks/use-authenticated-convex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/hooks/use-authenticated-convex')>();
  return {
    ...actual,
    useAuthenticatedConvex: () => ({ isAuthenticated: true, isLoading: false }),
  };
});

vi.mock('../src/hooks/use-machine-flock-agent-configs', () => ({
  useMachineFlockAgentConfigsForMachineIds: () => undefined,
}));
vi.mock('../src/hooks/use-acp-selector-options', () => ({
  useAcpSelectorOptions: () => ({
    capabilityAuthority: 'authoritative',
    modeOptions: [],
    modelOptions: [
      { value: 'molly-model:unselected', label: 'Select a connection and model' },
      {
        value: 'molly-model:00000000-0000-4000-8000-000000000001/deepseek-chat',
        label: 'deepseek-chat',
      },
    ],
    defaultModeId: null,
    defaultModelId: 'molly-model:unselected',
    configOptionSelectors: [],
    modelReasoningEfforts: {
      'molly-model:00000000-0000-4000-8000-000000000001/deepseek-chat': ['off', 'medium', 'high'],
    },
  }),
}));
vi.mock('../src/components/settings/model-connection-setting', () => ({
  ModelConnectionSetting: ({
    onConnectionsChange,
  }: {
    onConnectionsChange?: (connections: unknown[]) => void;
  }) => {
    React.useEffect(() => {
      onConnectionsChange?.([
        {
          schemaVersion: 1,
          id: '00000000-0000-4000-8000-000000000001',
          revision: 1,
          providerPresetId: 'deepseek',
          displayName: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com',
          enabled: true,
          credentialRef: 'synthetic-reference',
        },
      ]);
    }, [onConnectionsChange]);
    return <div data-testid="model-connections" />;
  },
}));
vi.mock('../src/components/settings/image-connection-setting', () => ({
  imageProtocolLabelKey: () => 'settings.imageConnection.protocols.openaiImages',
  ImageConnectionSetting: ({
    onConnectionChange,
  }: {
    onConnectionChange?: (connection: unknown) => void;
  }) => {
    React.useEffect(() => {
      onConnectionChange?.({
        id: '00000000-0000-4000-8000-000000000009',
        revision: 1,
        enabled: true,
        baseUrl: 'https://images.example.com/v1',
        model: 'synthetic-image-model',
        hasApiKey: true,
        legacyHistoryMayContainKey: false,
      });
    }, [onConnectionChange]);
    return <div data-testid="image-connection" />;
  },
}));

import { runtimeAtom } from '../src/atoms/runtime';
import { desktopOnboardingPhaseAtom } from '../src/atoms/onboarding';
import { localCliStartingAtom, localProbeResultAtom } from '../src/atoms/local-probe';
import { agentConfigMetaCacheAtom } from '../src/atoms/doc-meta';
import { currentWorkspaceIdAtom, currentWorkspaceSlugAtom } from '../src/atoms/workspace-context';
import {
  OnboardingOverlay,
  resolveDesktopOnboardingPhase,
} from '../src/components/onboarding/onboarding-overlay';
import { getDesktopOnboardingSteps } from '../src/components/onboarding/onboarding-steps';
import { agentDefaultsCache } from '../src/lib/local-storage-cache';
import { readChatLandingDefaults } from '../src/lib/chat-landing-defaults';
import { initI18n } from '../src/i18n';
import { TestCloudPlatformProvider } from './test-platform';

const workspaceId = 'workspace-1' as WorkspaceId;
const machineId = 'machine-1' as MachineId;
const SYNTHETIC_MODEL_CATALOG = {
  models: [
    {
      providerPresetId: 'deepseek',
      modelId: 'deepseek-chat',
      name: 'deepseek-chat',
      input: ['text'],
      contextWindow: 128_000,
      thinking: ['off', 'medium', 'high'],
    },
  ],
};

function installElectronWindowIpc() {
  mocks.getCliState.mockReturnValue(new Promise(() => undefined));
  mocks.onCliState.mockReturnValue(() => undefined);

  Object.defineProperty(window, '__MOLLY_ELECTRON__', { configurable: true, value: true });
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: {
      invoke: async (channel: string) => {
        if (channel === 'cli.getState') return mocks.getCliState();
        if (channel === 'modelConnections.getModelCatalog') return SYNTHETIC_MODEL_CATALOG;
        if (channel === 'publicBrowser.getAccountSummary') return { sites: [] };
        throw new Error(`unexpected invoke ${channel}`);
      },
      on: (channel: string, listener: (payload: unknown) => void) => {
        if (channel === 'cli.state') return mocks.onCliState(listener);
        return () => {};
      },
      send: () => {},
    },
  });
}

function uninstallElectronWindowIpc() {
  delete window.__MOLLY_ELECTRON__;
  delete window.ipc;
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.textContent?.includes(label) && !item.closest('[hidden]')
  );
  if (!button) throw new Error(`Expected button containing "${label}"`);
  return button;
}

describe('desktop onboarding flow', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  let store: Store;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    await initI18n('en');
    localStorage.clear();
    installElectronWindowIpc();

    store = createStore();
    store.set(currentWorkspaceIdAtom, workspaceId);
    store.set(currentWorkspaceSlugAtom, 'workspace-1');
    store.set(runtimeAtom, {
      workspaceId,
      workspaceSlug: 'workspace-1',
      getMachineAcpBinaryProgress: () => null,
      subscribeMachineAcpBinaryProgress: () => () => undefined,
    } as never);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    document.body.innerHTML = '';
    uninstallElectronWindowIpc();
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('renders the welcome step without waiting for the Electron CLI bootstrap', async () => {
    await act(async () => {
      root?.render(
        <TestCloudPlatformProvider>
          <Provider store={store}>
            <OnboardingOverlay onCompleted={vi.fn()} />
          </Provider>
        </TestCloudPlatformProvider>
      );
    });

    expect(container.textContent).toContain('Unexpected connections.');
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.textContent).not.toContain('Preparing your workspace');
    expect(mocks.getCliState).not.toHaveBeenCalled();
  });

  it.each([
    { action: 'Skip', reducedMotion: false },
    { action: 'Start setup', reducedMotion: false },
    { action: 'Start setup', reducedMotion: true },
  ])(
    'hands $action to local setup and resets manual reading from Back (reduced motion: $reducedMotion)',
    async ({ action, reducedMotion }) => {
      const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
      Object.defineProperty(motionPreference, 'matches', { value: reducedMotion });
      vi.spyOn(window, 'matchMedia').mockReturnValue(motionPreference);
      vi.useFakeTimers();
      const platform = createLocalPlatformProvider({
        session: createStaticStore({ status: 'unauthenticated' }),
        workspaces: createStaticStore({ status: 'ready', workspaces: [], activeWorkspaceId: null }),
      });
      await act(async () =>
        root?.render(
          <Provider store={store}>
            <PlatformContext.Provider value={platform}>
              <OnboardingOverlay onCompleted={async () => true} />
            </PlatformContext.Provider>
          </Provider>
        )
      );
      await act(async () =>
        container.querySelectorAll<HTMLButtonElement>('.molly-intro-segments button')[1].click()
      );
      if (action === 'Start setup') {
        await act(async () =>
          container.querySelectorAll<HTMLButtonElement>('.molly-intro-segments button')[2].click()
        );
      }
      await act(async () => findButton(container, action).click());
      expect(store.get(desktopOnboardingPhaseAtom)).toBe('providers');
      expect(container.textContent).toContain('Connect your models');
      expect(container.querySelector('[data-testid=model-connections]')).not.toBeNull();
      expect(container.querySelector('[data-testid=image-connection]')).not.toBeNull();
      expect(container.querySelector('img')?.getAttribute('src')).toContain(
        'molly-editorial-v3.png'
      );
      await act(async () => findButton(container, 'Back').click());
      expect(store.get(desktopOnboardingPhaseAtom)).toBe('ceremony');
      expect(container.querySelector('h1')?.textContent).toBe('Unexpected connections.');
      expect(container.querySelector('.molly-intro-count')?.textContent).toBe('01 / 03');
      await act(async () => vi.advanceTimersByTime(3000));
      expect(container.querySelector('.molly-intro-count')?.textContent).toBe(
        reducedMotion ? '01 / 03' : '02 / 03'
      );
    }
  );

  it('derives steps and normalizes legacy phases from platform capabilities', () => {
    expect(getDesktopOnboardingSteps({ cloudAccount: false, multiWorkspace: false })).toEqual([
      'ceremony',
      'providers',
    ]);
    expect(getDesktopOnboardingSteps({ cloudAccount: true, multiWorkspace: true })).toEqual([
      'ceremony',
      'login',
      'workspace',
      'providers',
    ]);
    const local = { cloudAccount: false, multiWorkspace: false };
    expect(resolveDesktopOnboardingPhase(null, local)).toBe('ceremony');
    expect(resolveDesktopOnboardingPhase('login', local)).toBe('providers');
    expect(resolveDesktopOnboardingPhase('workspace', local)).toBe('providers');
    expect(resolveDesktopOnboardingPhase('projects', local)).toBe('providers');
    expect(resolveDesktopOnboardingPhase('firstTask', local)).toBe('providers');
    expect(resolveDesktopOnboardingPhase('summary', local)).toBe('providers');
    expect(resolveDesktopOnboardingPhase('providers', local)).toBe('providers');
    expect(resolveDesktopOnboardingPhase('ceremony', local)).toBe('ceremony');
    expect(
      resolveDesktopOnboardingPhase('workspace', { cloudAccount: true, multiWorkspace: true })
    ).toBe('workspace');
  });

  it('resumes a legacy persisted phase at Connect your models without probing old setup', async () => {
    const legacyRequests: string[] = [];
    const legacy: AgentConfigMeta = {
      id: 'retired' as AgentConfigId,
      machineId,
      name: 'Previous Claude',
      description: undefined,
      cliType: 'builtin',
      agentType: 'claude',
      env: {},
    };
    store.set(localProbeResultAtom, { ok: true, machineId });
    store.set(localCliStartingAtom, false);
    store.set(agentConfigMetaCacheAtom, { [getAgentConfigRoomId(legacy.id)]: legacy });
    store.set(desktopOnboardingPhaseAtom, 'firstTask');
    store.set(runtimeAtom, {
      workspaceId,
      workspaceSlug: 'workspace-1',
      requestMachineAcpBinaryStatus: () => {
        legacyRequests.push('status');
      },
      requestMachineAcpBinaryInstall: () => {
        legacyRequests.push('install');
      },
      requestMachineAcpCapabilitiesRefresh: () => {
        legacyRequests.push('refresh');
      },
    } as never);
    const platform = createLocalPlatformProvider({
      session: createStaticStore({ status: 'unauthenticated' }),
      workspaces: createStaticStore({ status: 'ready', workspaces: [], activeWorkspaceId: null }),
    });
    await act(async () =>
      root?.render(
        <Provider store={store}>
          <PlatformContext.Provider value={platform}>
            <OnboardingOverlay onCompleted={async () => true} />
          </PlatformContext.Provider>
        </Provider>
      )
    );
    expect(container.querySelector('[data-testid=model-connections]')).not.toBeNull();
    expect(container.textContent).toContain('Connect your models');
    expect(findButton(container, 'Finish').disabled).toBe(true);
    expect(container.textContent).not.toContain('Previous Claude');
    expect(legacyRequests).toEqual([]);
  });

  it('auto-selects the built-in Molly and binds first-session defaults on Finish', async () => {
    const molly: AgentConfigMeta = {
      id: 'synthetic-molly' as AgentConfigId,
      machineId,
      name: 'Molly',
      description: undefined,
      cliType: 'builtin',
      agentType: 'molly',
      env: {},
    };
    store.set(localProbeResultAtom, { ok: true, machineId });
    store.set(agentConfigMetaCacheAtom, { [getAgentConfigRoomId(molly.id)]: molly });
    store.set(desktopOnboardingPhaseAtom, 'providers');
    const completed: unknown[] = [];
    const platform = createLocalPlatformProvider({
      session: createStaticStore({ status: 'unauthenticated' }),
      workspaces: createStaticStore({ status: 'ready', workspaces: [], activeWorkspaceId: null }),
    });
    await act(async () =>
      root?.render(
        <Provider store={store}>
          <PlatformContext.Provider value={platform}>
            <OnboardingOverlay
              onCompleted={async (completion) => {
                completed.push(completion);
                return true;
              }}
            />
          </PlatformContext.Provider>
        </Provider>
      )
    );
    expect(findButton(container, 'Finish').disabled).toBe(false);
    await act(async () => findButton(container, 'Finish').click());
    expect(completed).toEqual([{}]);
    expect(readChatLandingDefaults(workspaceId)).toMatchObject({
      agentId: molly.id,
      machineId,
      contextType: 'chat',
    });
    expect(agentDefaultsCache.get(molly.id)).toMatchObject({
      modeId: null,
      modelId: 'molly-model:00000000-0000-4000-8000-000000000001/deepseek-chat',
      configOptionValues: { reasoning_effort: 'high' },
    });
  });

  it('completes onboarding from Connect your models via Skip for now', async () => {
    const completed: unknown[] = [];
    const platform = createLocalPlatformProvider({
      session: createStaticStore({ status: 'unauthenticated' }),
      workspaces: createStaticStore({ status: 'ready', workspaces: [], activeWorkspaceId: null }),
    });
    store.set(desktopOnboardingPhaseAtom, 'providers');
    store.set(localProbeResultAtom, { ok: true, machineId });
    await act(async () =>
      root?.render(
        <Provider store={store}>
          <PlatformContext.Provider value={platform}>
            <OnboardingOverlay
              onCompleted={async (completion) => {
                completed.push(completion);
                return true;
              }}
            />
          </PlatformContext.Provider>
        </Provider>
      )
    );
    // Finish stays disabled until both model cards report readiness; the
    // mocked cards never report, so only Skip can complete here.
    expect(findButton(container, 'Finish').disabled).toBe(true);
    await act(async () => findButton(container, 'Skip for now').click());
    expect(completed).toEqual([{}]);
  });
});
