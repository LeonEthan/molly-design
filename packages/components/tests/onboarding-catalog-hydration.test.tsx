// @vitest-environment jsdom

import React, { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalPlatformProvider, createStaticStore } from '@molly/platform';
import { PlatformContext } from '@molly/platform/react';
import {
  getMollyMachinePresenceKey,
  machineFlockKeys,
  type AgentConfigId,
  type AgentConfigMeta,
  type MachineFlockEvent,
  type MachineId,
  type MollyPresenceInstanceId,
  type WorkspaceId,
} from '@molly/shared';
import { localProbeResultAtom } from '../src/atoms/local-probe';
import { desktopOnboardingPhaseAtom } from '../src/atoms/onboarding';
import { mollyPresenceNowMsAtom, mollyPresenceStatesAtom } from '../src/atoms/presence';
import { runtimeAtom, type WorkspaceRuntime } from '../src/atoms/runtime';
import { currentWorkspaceIdAtom, currentWorkspaceSlugAtom } from '../src/atoms/workspace-context';
import { ProvidersScreen } from '../src/components/onboarding/screens/providers-screen';
import { OnboardingOverlay } from '../src/components/onboarding/onboarding-overlay';
import { initI18n } from '../src/i18n';

vi.mock('../src/components/settings/model-connection-setting', () => ({
  ModelConnectionSetting: () => null,
}));

vi.mock('../src/components/settings/image-connection-setting', () => ({
  ImageConnectionSetting: () => null,
}));

vi.mock('../src/components/onboarding/onboarding-shell', () => ({
  OnboardingShellHost: ({ children }: { children: ReactNode }) => children,
  OnboardingShell: ({
    title,
    children,
    primaryAction,
  }: {
    title: string;
    children: ReactNode;
    primaryAction: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {children}
      {primaryAction}
    </main>
  ),
  OnboardingBackButton: () => null,
  OnboardingNextButton: ({
    finish: _finish,
    label: _label,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { finish?: boolean; label?: string }) => (
    <button {...props}>Finish</button>
  ),
}));

vi.mock('../src/components/onboarding/ceremony/use-onboarding-audio', () => ({
  useOnboardingAudio: () => ({ stop: () => undefined }),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('onboarding machine catalog hydration', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    await initI18n('en');
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('hydrates a cold local daemon catalog in Connect your models without leaving setup', async () => {
    const workspaceId = 'workspace-onboarding-cold' as WorkspaceId;
    const machineId = 'machine-onboarding-cold' as MachineId;
    const instanceId = 'instance-onboarding-cold' as MollyPresenceInstanceId;
    const config: AgentConfigMeta = {
      id: 'molly-onboarding-cold' as AgentConfigId,
      machineId,
      name: 'Molly',
      cliType: 'builtin',
      agentType: 'molly',
      env: {},
    };
    const key = machineFlockKeys.agentConfig(config.id);
    const firstSync = deferred();
    let emitRows: (batch: { events: MachineFlockEvent[] }) => void = () => undefined;
    let published = false;
    const binding = {
      transportId: 'local',
      status: 'joined' as const,
      firstSyncedWithRemote: firstSync.promise,
      onStatusChange: () => () => undefined,
      waitUntilSynced: () => firstSync.promise,
      rejoin: async () => undefined,
    };
    const runtime = {
      workspaceId,
      workspaceSlug: 'local',
      repo: {
        openFlockDoc: async () => ({
          flock: {
            subscribe: (listener: typeof emitRows) => {
              emitRows = listener;
              return () => undefined;
            },
            scan: ({ prefix }: { prefix: readonly string[] }) =>
              published && prefix[0] === key[0] ? [{ key, value: config }] : [],
          },
          joinRoom: async () => {
            await firstSync.promise;
            published = true;
            return {
              transportIds: () => ['local'],
              subscription: () => binding,
              unsubscribe: () => undefined,
            };
          },
        }),
      },
    } as unknown as WorkspaceRuntime;
    const store = createStore();
    store.set(runtimeAtom, runtime);
    store.set(currentWorkspaceIdAtom, workspaceId);
    store.set(currentWorkspaceSlugAtom, 'local');
    store.set(localProbeResultAtom, { ok: true, machineId });
    store.set(mollyPresenceNowMsAtom, 1000);
    store.set(mollyPresenceStatesAtom, {
      [getMollyMachinePresenceKey(machineId, instanceId)]: {
        kind: 'machine',
        machineId,
        instanceId,
        updatedAt: 1000,
      },
    });
    const platform = createLocalPlatformProvider({
      session: createStaticStore({ status: 'unauthenticated' }),
    });
    await act(async () => {
      root.render(
        <PlatformContext.Provider value={platform}>
          <Provider store={store}>
            <ProvidersScreen
              onBack={() => undefined}
              onSkip={() => undefined}
              onNext={() => undefined}
            />
          </Provider>
        </PlatformContext.Provider>
      );
    });
    const finish = () =>
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Finish'
      )!;
    expect(container.textContent).toContain('built-in Molly catalog');
    expect(finish().disabled).toBe(true);
    await act(async () => {
      firstSync.resolve();
    });
    // The built-in Molly is picked up in the background: no chip to click, and
    // Finish stays disabled until both model cards report readiness and the
    // connected LLM's models are projected for a bindable default.
    expect(container.textContent).not.toContain('built-in Molly catalog');
    expect(finish().disabled).toBe(true);
    act(() => emitRows({ events: [{ key, value: undefined }] }));
    expect(container.textContent).toContain('built-in Molly catalog');
    expect(finish().disabled).toBe(true);
  });

  it('resumes a persisted legacy phase at Connect your models and keeps the catalog subscription', async () => {
    const workspaceId = 'workspace-onboarding-legacy' as WorkspaceId;
    const machineId = 'machine-onboarding-legacy' as MachineId;
    const store = createStore();
    store.set(runtimeAtom, {
      workspaceId,
      workspaceSlug: 'local',
      getMachineAcpBinaryProgress: () => null,
      subscribeMachineAcpBinaryProgress: () => () => undefined,
    } as unknown as WorkspaceRuntime);
    store.set(currentWorkspaceIdAtom, workspaceId);
    store.set(currentWorkspaceSlugAtom, 'local');
    store.set(localProbeResultAtom, { ok: true, machineId });
    store.set(desktopOnboardingPhaseAtom, 'summary');
    const platform = createLocalPlatformProvider({
      session: createStaticStore({ status: 'unauthenticated' }),
    });
    await act(async () => {
      root.render(
        <PlatformContext.Provider value={platform}>
          <Provider store={store}>
            <OnboardingOverlay onCompleted={async () => true} />
          </Provider>
        </PlatformContext.Provider>
      );
    });
    expect(container.querySelector('h1')?.textContent).toBe('Connect your models');
  });
});
