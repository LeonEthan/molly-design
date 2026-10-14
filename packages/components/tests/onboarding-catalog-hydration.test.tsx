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
import { desktopOnboardingDraftAtom, desktopOnboardingPhaseAtom } from '../src/atoms/onboarding';
import { mollyPresenceNowMsAtom, mollyPresenceStatesAtom } from '../src/atoms/presence';
import { runtimeAtom, type WorkspaceRuntime } from '../src/atoms/runtime';
import { currentWorkspaceIdAtom, currentWorkspaceSlugAtom } from '../src/atoms/workspace-context';
import { ProvidersScreen } from '../src/components/onboarding/screens/providers-screen';
import { OnboardingOverlay } from '../src/components/onboarding/onboarding-overlay';
import { initI18n } from '../src/i18n';

vi.mock('../src/components/settings/model-connection-setting', () => ({
  ModelConnectionSetting: () => null,
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
    <button {...props}>Next</button>
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

  it.each(['providers', 'summary'] as const)(
    'hydrates a cold local daemon catalog in %s without leaving setup',
    async (screen) => {
      const workspaceId = `workspace-onboarding-cold-${screen}` as WorkspaceId;
      const machineId = `machine-onboarding-cold-${screen}` as MachineId;
      const instanceId = 'instance-onboarding-cold' as MollyPresenceInstanceId;
      const config: AgentConfigMeta = {
        id: `molly-onboarding-cold-${screen}` as AgentConfigId,
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
      let accepted: unknown = null;
      const platform = createLocalPlatformProvider({
        session: createStaticStore({ status: 'unauthenticated' }),
      });
      store.set(desktopOnboardingPhaseAtom, 'summary');
      store.set(desktopOnboardingDraftAtom, {
        provider: { kind: 'agentConfig', agentConfigId: config.id, agentName: config.name },
        project: null,
      });
      await act(async () => {
        root.render(
          <PlatformContext.Provider value={platform}>
            <Provider store={store}>
              {screen === 'providers' ? (
                <ProvidersScreen
                  onBack={() => undefined}
                  onSkip={() => undefined}
                  onNext={(selection) => {
                    accepted = selection;
                  }}
                />
              ) : (
                <OnboardingOverlay onCompleted={async () => true} />
              )}
            </Provider>
          </PlatformContext.Provider>
        );
      });
      const next = () =>
        Array.from(container.querySelectorAll('button')).find(
          (button) => button.textContent === 'Next'
        )!;
      if (screen === 'providers') {
        expect(container.textContent).toContain('built-in Molly catalog');
        expect(next().disabled).toBe(true);
      } else {
        expect(container.querySelector('h1')?.textContent).toBe('Explore Molly');
      }
      await act(async () => {
        firstSync.resolve();
      });
      if (screen === 'summary') {
        expect(container.querySelector('h1')?.textContent).toBe('Ready to enter Molly');
        expect(store.get(desktopOnboardingDraftAtom).provider?.kind).toBe('agentConfig');
        return;
      }
      const molly = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Molly'
      );
      expect(molly).toBeDefined();
      expect(container.textContent).not.toContain('built-in Molly catalog');
      expect(next().disabled).toBe(true);
      act(() => molly?.click());
      expect(next().disabled).toBe(false);
      act(() => next().click());
      expect(accepted).toEqual({
        kind: 'agentConfig',
        agentConfigId: config.id,
        agentName: 'Molly',
      });
      act(() => emitRows({ events: [{ key, value: undefined }] }));
      expect(container.textContent).toContain('built-in Molly catalog');
      expect(next().disabled).toBe(true);
    }
  );
});
