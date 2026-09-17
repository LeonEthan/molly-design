// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAgentConfigRoomId,
  type AgentConfigId,
  type AgentConfigMeta,
  type LocalProjectId,
  type MachineId,
  type WorkspaceId,
} from '@molly/shared';

const sessionActions = vi.hoisted(() => ({
  requestSessionDispatch: vi.fn(),
  startSession: vi.fn(),
  createDesign: vi.fn(),
  saveDesign: vi.fn(),
  acknowledgeDesign: vi.fn(),
  electron: false,
}));

vi.mock('../src/hooks/use-session-actions', () => ({
  useSessionActions: () => sessionActions,
}));

vi.mock('../src/lib/electron', () => ({ isElectronRenderer: () => sessionActions.electron }));
vi.mock('../src/lib/electron-ipc-client', () => ({
  getIpcServices: () => ({
    design: {
      create: sessionActions.createDesign,
      save: sessionActions.saveDesign,
      acknowledge: sessionActions.acknowledgeDesign,
    },
  }),
}));

import {
  FirstTaskScreen,
  getFirstTaskAgentConfigs,
  getSelectedFirstTaskAgentConfig,
} from '../src/components/onboarding/screens/first-task-screen';
import { userAtom } from '../src/atoms';
import { agentConfigMetaCacheAtom } from '../src/atoms/doc-meta';
import { agentDefaultsCache } from '../src/lib/local-storage-cache';
import { localProbeResultAtom } from '../src/atoms/local-probe';
import { chatLandingSessionStateAtomFamily } from '../src/atoms/local-storage-cache';
import {
  buildChatLandingDraftKey,
  chatLandingDraftSessionIdAtomFamily,
  chatLandingSubmittingAtomFamily,
} from '../src/atoms/chat-landing-draft';
import { runtimeAtom } from '../src/atoms/runtime';
import { initI18n } from '../src/i18n';

const machineId = 'machine-1' as MachineId;
const otherMachineId = 'machine-2' as MachineId;
const project = {
  kind: 'local' as const,
  machineId,
  localProjectId: 'project-1' as LocalProjectId,
  name: 'Molly',
};

function config(id: string, name: string, targetMachineId = machineId): AgentConfigMeta {
  return {
    id: id as AgentConfigId,
    machineId: targetMachineId,
    name,
    description: undefined,
    cliType: 'builtin',
    agentType: 'claude',
    env: {},
  };
}

describe('first task Agent Provider state', () => {
  let root: Root | undefined;
  let container: HTMLDivElement;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    sessionActions.electron = false;
    sessionActions.createDesign.mockResolvedValue(undefined);
    sessionActions.saveDesign.mockResolvedValue(undefined);
    sessionActions.acknowledgeDesign.mockResolvedValue(undefined);
    localStorage.clear();
    await initI18n('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('offers only published configs bound to the project machine in deterministic order', () => {
    const selected = config('selected', 'Zulu');
    const otherLocal = config('other-local', 'Alpha');
    const remote = config('remote', 'Beta', otherMachineId);

    expect(getFirstTaskAgentConfigs([selected, remote, otherLocal], project)).toEqual([
      otherLocal,
      selected,
    ]);
    expect(
      getFirstTaskAgentConfigs([selected], {
        kind: 'github',
        repoFullName: 'lodyai/lody',
        name: 'Molly',
      })
    ).toEqual([]);
  });

  it('does not fall back when the exact selected config disappears', () => {
    const remaining = config('remaining', 'Alpha');

    expect(
      getSelectedFirstTaskAgentConfig([remaining], 'missing-selection' as AgentConfigId)
    ).toBeNull();
  });

  it('skips without creating a Session, first turn, or dispatch request', async () => {
    const onSkip = vi.fn();
    const onContinue = vi.fn().mockResolvedValue(true);

    await act(async () => {
      root?.render(
        <Provider store={createStore()}>
          <FirstTaskScreen
            agentConfigId={'selected' as AgentConfigId}
            project={project}
            onBack={vi.fn()}
            onAgentConfigChange={vi.fn()}
            onSkip={onSkip}
            onContinue={onContinue}
          />
        </Provider>
      );
    });

    const skipButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Skip for now'
    );
    expect(skipButton).toBeDefined();

    await act(async () => {
      skipButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSkip).toHaveBeenCalledOnce();
    expect(onContinue).not.toHaveBeenCalled();
    expect(sessionActions.startSession).not.toHaveBeenCalled();
    expect(sessionActions.requestSessionDispatch).not.toHaveBeenCalled();
  });

  it('enters Molly before background Session creation settles', async () => {
    const selected = config('selected', 'Claude Code');
    const store = createStore();
    store.set(userAtom, { id: 'user-1', name: 'User', email: 'user@example.com' });
    store.set(runtimeAtom, {
      workspaceId: 'workspace-1' as WorkspaceId,
      workspaceSlug: 'workspace-1',
    } as never);
    store.set(agentConfigMetaCacheAtom, {
      [getAgentConfigRoomId(selected.id)]: selected,
    });
    let resolveStart:
      | ((value: {
          sessionId: string;
          historyEntry: { id: string; inputConfig: Record<string, unknown> };
        }) => void)
      | undefined;
    sessionActions.startSession.mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      })
    );
    sessionActions.requestSessionDispatch.mockResolvedValue(true);
    const onContinue = vi.fn().mockResolvedValue(true);

    await act(async () => {
      root?.render(
        <Provider store={store}>
          <FirstTaskScreen
            agentConfigId={selected.id}
            project={project}
            onBack={vi.fn()}
            onAgentConfigChange={vi.fn()}
            onSkip={vi.fn()}
            onContinue={onContinue}
          />
        </Provider>
      );
    });

    const runButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Start design session'
    );
    expect(runButton).toBeDefined();
    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onContinue).toHaveBeenCalledOnce();
    expect(sessionActions.startSession).toHaveBeenCalledOnce();
    expect(onContinue.mock.invocationCallOrder[0]).toBeLessThan(
      sessionActions.startSession.mock.invocationCallOrder[0]
    );
    expect(sessionActions.requestSessionDispatch).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Enter Molly');

    await act(async () => {
      resolveStart?.({
        sessionId: 'session-1',
        historyEntry: { id: 'turn-1', inputConfig: {} },
      });
      await Promise.resolve();
    });
    expect(sessionActions.requestSessionDispatch).toHaveBeenCalledOnce();
    expect(onContinue).toHaveBeenCalledOnce();
  });
  it.each(['save', 'accept', 'success', 'changed', 'rehydrated'])(
    'keeps the design handoff recoverable across unmount: %s',
    async (outcome) => {
      sessionActions.electron = true;
      const selected = config('chosen-agent', 'Chosen Agent');
      const store = createStore();
      store.set(userAtom, { id: 'user-design', name: 'User', email: 'synthetic@example.com' });
      store.set(runtimeAtom, { workspaceId: 'local', workspaceSlug: 'local' } as never);
      store.set(localProbeResultAtom, { machineId } as never);
      store.set(agentConfigMetaCacheAtom, { [getAgentConfigRoomId(selected.id)]: selected });
      agentDefaultsCache.set(selected.id, { modelId: 'user-chosen-model', modeId: null });
      const events: string[] = [];
      let releaseSave!: () => void;
      sessionActions.saveDesign.mockImplementation(
        () =>
          new Promise<void>((resolve, reject) => {
            events.push('save');
            releaseSave = () =>
              outcome === 'save' ? reject(new Error('synthetic save error')) : resolve();
          })
      );
      sessionActions.createDesign.mockImplementation(async () => {
        events.push('create');
      });
      sessionActions.startSession.mockImplementation(async (args, historyEntry) => {
        events.push('accept');
        expect(args.agentConfigId).toBe(selected.id);
        expect(historyEntry.inputConfig.modelId).toBe('user-chosen-model');
        expect(args.design).toEqual({ artworkId: args.sessionId, path: 'design.json' });
        if (outcome === 'accept') throw new Error('synthetic accept error');
        return {
          sessionId: args.sessionId,
          historyEntry: { ...historyEntry, id: 'synthetic-turn' },
        };
      });
      sessionActions.requestSessionDispatch.mockImplementation(async () => {
        events.push('dispatch');
      });
      await act(async () => {
        root?.render(
          <Provider store={store}>
            <FirstTaskScreen
              agentConfigId={selected.id}
              project={project}
              onBack={() => {}}
              onAgentConfigChange={() => {}}
              onSkip={() => {}}
              onContinue={async () => {
                events.push('navigate');
                return true;
              }}
            />
          </Provider>
        );
      });
      const button = Array.from(container.querySelectorAll('button')).find(
        (item) => item.textContent === 'Start design session'
      )!;
      await act(async () => button.click());
      const key = buildChatLandingDraftKey('user-design', 'local');
      const reservedId = store.get(chatLandingDraftSessionIdAtomFamily(key));
      expect(reservedId).toBeTruthy();
      expect(store.get(chatLandingSubmittingAtomFamily(key))).toBe(true);
      expect(events).toEqual(['navigate', 'create', 'save']);
      act(() => root?.unmount());
      root = undefined;
      if (outcome === 'rehydrated')
        store.set(
          chatLandingSessionStateAtomFamily(buildChatLandingDraftKey('user-design', 'local')),
          {
            ...store.get(
              chatLandingSessionStateAtomFamily(buildChatLandingDraftKey('user-design', 'local'))
            ),
          }
        );
      if (outcome === 'changed')
        store.set(
          chatLandingSessionStateAtomFamily(buildChatLandingDraftKey('user-design', 'local')),
          {
            prompt: 'A newer user draft',
          }
        );
      await act(async () => {
        releaseSave();
      });
      expect(store.get(chatLandingSubmittingAtomFamily(key))).toBe(false);
      if (outcome === 'changed') {
        expect(
          store.get(
            chatLandingSessionStateAtomFamily(buildChatLandingDraftKey('user-design', 'local'))
          ).prompt
        ).toBe('A newer user draft');
      } else if (outcome === 'success' || outcome === 'rehydrated') {
        expect(events).toEqual(['navigate', 'create', 'save', 'accept', 'dispatch']);
        expect(
          store.get(
            chatLandingSessionStateAtomFamily(buildChatLandingDraftKey('user-design', 'local'))
          ).prompt
        ).toBe('');
        expect(store.get(chatLandingDraftSessionIdAtomFamily(key))).toBeNull();
      } else {
        expect(events.includes('dispatch')).toBe(false);
        expect(
          store.get(
            chatLandingSessionStateAtomFamily(buildChatLandingDraftKey('user-design', 'local'))
          ).prompt
        ).toBe('Design an editable poster for a weekend flower market.');
        expect(store.get(chatLandingDraftSessionIdAtomFamily(key))).toBe(reservedId);
      }
    }
  );
});
