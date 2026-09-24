// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore, type Store } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentConfigId,
  AgentConfigMeta,
  LocalProjectId,
  MachineId,
  WorkspaceId,
} from '@molly/shared';
import { getAgentConfigRoomId } from '@molly/shared';
import { createLocalPlatformProvider, createStaticStore } from '@molly/platform';
import { PlatformContext } from '@molly/platform/react';

const mocks = vi.hoisted(() => ({
  getCliState: vi.fn(),
  onCliState: vi.fn(),
  selectLocalProjectDirectory: vi.fn(),
  useVisibleLocalProjects: vi.fn(),
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

vi.mock('../src/hooks/use-visible-local-projects', () => ({
  useVisibleLocalProjects: mocks.useVisibleLocalProjects,
}));
vi.mock('../src/hooks/use-machine-flock-agent-configs', () => ({
  useMachineFlockAgentConfigsForMachineIds: () => undefined,
}));
vi.mock('../src/components/settings/model-connection-setting', () => ({
  ModelConnectionSetting: () => <div data-testid="model-connections" />,
}));

import { runtimeAtom } from '../src/atoms/runtime';
import { desktopOnboardingDraftAtom, desktopOnboardingPhaseAtom } from '../src/atoms/onboarding';
import { localCliStartingAtom, localProbeResultAtom } from '../src/atoms/local-probe';
import { agentConfigMetaCacheAtom } from '../src/atoms/doc-meta';
import { currentWorkspaceIdAtom, currentWorkspaceSlugAtom } from '../src/atoms/workspace-context';
import {
  OnboardingOverlay,
  resolveDesktopOnboardingPhase,
} from '../src/components/onboarding/onboarding-overlay';
import { getDesktopOnboardingSteps } from '../src/components/onboarding/onboarding-steps';
import { ProjectsScreenView } from '../src/components/onboarding/screens/projects-screen';
import { ProvidersScreenView } from '../src/components/onboarding/screens/providers-screen';
import { SummaryScreen } from '../src/components/onboarding/screens/summary-screen';
import { initI18n } from '../src/i18n';
import { TestCloudPlatformProvider } from './test-platform';

const workspaceId = 'workspace-1' as WorkspaceId;
const machineId = 'machine-1' as MachineId;

function installElectronWindowIpc() {
  mocks.getCliState.mockReturnValue(new Promise(() => undefined));
  mocks.onCliState.mockReturnValue(() => undefined);

  Object.defineProperty(window, '__MOLLY_ELECTRON__', { configurable: true, value: true });
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: {
      invoke: async (channel: string, ...args: unknown[]) => {
        if (channel === 'cli.getState') return mocks.getCliState();
        if (channel === 'localProjects.selectDirectory') {
          return mocks.selectLocalProjectDirectory(...args);
        }
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
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((item) =>
    item.textContent?.includes(label)
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
    await initI18n('en');
    localStorage.clear();
    mocks.useVisibleLocalProjects.mockReturnValue({ projects: new Map() });
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

  it.each(['Skip', 'Start setup'])(
    'hands %s to local setup and replays from Back',
    async (action) => {
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
      if (action === 'Start setup') {
        await act(async () => vi.advanceTimersByTime(3000));
        await act(async () => vi.advanceTimersByTime(3000));
      }
      await act(async () => findButton(container, action).click());
      expect(store.get(desktopOnboardingPhaseAtom)).toBe('providers');
      expect(container.textContent).toContain('Connect a model');
      expect(container.querySelector('[data-testid=model-connections]')).not.toBeNull();
      expect(container.querySelector('img')?.getAttribute('src')).toContain(
        'molly-editorial-v3.png'
      );
      await act(async () => findButton(container, 'Back').click());
      expect(store.get(desktopOnboardingPhaseAtom)).toBe('ceremony');
      expect(container.querySelector('h1')?.textContent).toBe('Unexpected connections.');
      expect(container.querySelector('.molly-intro-count')?.textContent).toBe('01 / 03');
    }
  );

  it('derives steps and repairs stale phases from platform capabilities', () => {
    expect(getDesktopOnboardingSteps({ cloudAccount: false, multiWorkspace: false })).toEqual([
      'ceremony',
      'providers',
      'projects',
      'firstTask',
    ]);
    expect(getDesktopOnboardingSteps({ cloudAccount: true, multiWorkspace: true })).toEqual([
      'ceremony',
      'login',
      'workspace',
      'providers',
      'projects',
      'firstTask',
    ]);
    expect(
      resolveDesktopOnboardingPhase('login', {
        cloudAccount: false,
        multiWorkspace: false,
        hasAgent: false,
        hasProject: false,
      })
    ).toBe('providers');
    expect(
      resolveDesktopOnboardingPhase('firstTask', {
        cloudAccount: false,
        multiWorkspace: false,
        hasAgent: true,
        hasProject: false,
      })
    ).toBe('projects');
  });

  it('mounts the real connection step without probing, installing or reviving old setup', async () => {
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
    store.set(desktopOnboardingDraftAtom, {
      provider: { kind: 'agentConfig', agentConfigId: legacy.id, agentName: legacy.name },
      project: null,
    });
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
    expect(container.textContent).toContain('Connect a model');
    expect(findButton(container, 'Next').disabled).toBe(true);
    expect(container.textContent).not.toContain('Previous Claude');
    expect(legacyRequests).toEqual([]);
    expect(store.get(desktopOnboardingDraftAtom).provider).toEqual({
      kind: 'agentConfig',
      agentConfigId: legacy.id,
      agentName: legacy.name,
    });
  });

  it('returns the exact selected local project', async () => {
    const onComplete = vi.fn();
    const selectedMachine = 'machine-2' as MachineId;
    const selectedProject = 'project-2' as LocalProjectId;
    await act(async () => {
      root?.render(
        <ProjectsScreenView
          local={[
            {
              key: `${machineId}:project-1`,
              machineId,
              localProjectId: 'project-1' as LocalProjectId,
              name: 'first',
              detail: '/first',
            },
            {
              key: `${selectedMachine}:${selectedProject}`,
              machineId: selectedMachine,
              localProjectId: selectedProject,
              name: 'selected',
              detail: '/selected',
            },
          ]}
          github={[]}
          importing={false}
          connectingGitHub={false}
          canImportLocal
          canConnectGitHub={false}
          loadingRepos={false}
          selectedProjectKey={`local:${selectedMachine}:${selectedProject}`}
          onAddLocal={vi.fn()}
          onConnectGitHub={vi.fn()}
          onBack={vi.fn()}
          onSkip={vi.fn()}
          onComplete={onComplete}
        />
      );
    });

    await act(async () => {
      findButton(container, 'Next').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onComplete).toHaveBeenCalledWith({
      kind: 'local',
      machineId: selectedMachine,
      localProjectId: selectedProject,
      name: 'selected',
    });
  });

  it('requires explicit selection of a published local Molly', async () => {
    const selected: AgentConfigMeta = {
      id: 'synthetic-molly' as AgentConfigId,
      machineId,
      name: 'Molly',
      description: undefined,
      cliType: 'builtin',
      agentType: 'molly',
      env: {},
    };
    const selections: unknown[] = [];
    await act(async () =>
      root?.render(
        <ProvidersScreenView
          configs={[
            selected,
            {
              ...selected,
              id: 'legacy' as AgentConfigId,
              name: 'Retired Claude',
              agentType: 'claude',
            },
            {
              ...selected,
              id: 'remote' as AgentConfigId,
              name: 'Remote Molly',
              machineId: 'remote' as MachineId,
            },
          ]}
          localMachineId={machineId}
          onBack={() => undefined}
          onSkip={() => undefined}
          onNext={(selection) => selections.push(selection)}
        />
      )
    );
    expect(findButton(container, 'Next').disabled).toBe(true);
    expect(container.textContent).not.toContain('Retired Claude');
    expect(container.textContent).not.toContain('Remote Molly');
    await act(async () =>
      findButton(container, 'Molly').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    await act(async () =>
      findButton(container, 'Next').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    expect(selections).toEqual([
      { kind: 'agentConfig', agentConfigId: selected.id, agentName: selected.name },
    ]);
  });

  it('does not replace a removed selection with another Molly or offer legacy installers', async () => {
    const config: AgentConfigMeta = {
      id: 'one' as AgentConfigId,
      machineId,
      name: 'Molly One',
      description: undefined,
      cliType: 'builtin',
      agentType: 'molly',
      env: {},
    };
    const selections: unknown[] = [];
    const render = (configs: AgentConfigMeta[], currentMachineId = machineId) =>
      root?.render(
        <ProvidersScreenView
          configs={configs}
          localMachineId={currentMachineId}
          onBack={() => undefined}
          onSkip={() => undefined}
          onNext={(selection) => selections.push(selection)}
        />
      );
    await act(async () => render([config]));
    await act(async () =>
      findButton(container, 'Molly One').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    );
    await act(async () => render([{ ...config, id: 'two' as AgentConfigId, name: 'Molly Two' }]));
    expect(findButton(container, 'Next').disabled).toBe(true);
    expect(selections).toEqual([]);
    const otherMachine = 'other-machine' as MachineId;
    await act(async () => render([{ ...config, machineId: otherMachine }], otherMachine));
    expect(findButton(container, 'Next').disabled).toBe(true);
    expect(findButton(container, 'Molly One').getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).not.toContain('Download');
    expect(container.textContent).not.toContain('Sign in');
    expect(container.textContent).not.toContain('Add provider');
  });

  it('keeps failed Agent setup retryable from Summary with investigation detail', async () => {
    const retry = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('machine is offline'))
      .mockResolvedValueOnce(undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await act(async () => {
      root?.render(
        <SummaryScreen
          agentState="failed"
          agentName="Codex"
          agentFailureCode="runtime-install-failed"
          onBack={vi.fn()}
          onComplete={vi.fn()}
          onRetryAgent={retry}
        />
      );
    });

    expect(container.textContent).toContain(
      'Molly could not download the Agent runtime. Check your connection and try again.'
    );
    expect(container.textContent).not.toContain('runtime-install-failed');
    await act(async () => {
      findButton(container, 'Retry').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('machine is offline');
    expect(consoleError).toHaveBeenCalledWith(
      '[onboarding] Failed to retry Agent setup from Summary:',
      expect.any(Error)
    );
    expect(findButton(container, 'Retry').disabled).toBe(false);

    await act(async () => {
      findButton(container, 'Retry').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(retry).toHaveBeenCalledTimes(2);
  });
});
