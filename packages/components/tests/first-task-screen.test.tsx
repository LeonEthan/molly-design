// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACP_CAPABILITY_CACHE_VERSION,
  getAgentConfigRoomId,
  type AgentConfigId,
  type AgentConfigMeta,
  type LocalProjectId,
  type MachineId,
  type MachineViewMeta,
  type WorkspaceId,
} from '@molly/shared';
import { encodeMollyModelOption } from '@molly/shared/embedded-harness';
import { buildAcpSelectorOptions } from '../src/components/shared/acp-selector-options';

const machineCatalog = vi.hoisted(() => ({ machines: new Map() }));
vi.mock('../src/hooks/use-visible-machine-metas', () => ({
  useVisibleMachineMetas: () => machineCatalog,
}));

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
  isFirstTaskModelAvailable,
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
const modelId = encodeMollyModelOption('00000000-0000-4000-8000-000000000001', 'k3-256k');
function modelCapabilities() {
  return {
    cliType: 'builtin' as const,
    agentType: 'molly',
    cacheVersion: ACP_CAPABILITY_CACHE_VERSION,
    provenance: 'runtime' as const,
    fetchedAt: 1,
    modes: [],
    models: [{ modelId, name: 'Synthetic Kimi · k3-256k' }],
    modelReasoningEfforts: { [modelId]: ['off', 'high'] },
    configOptions: [
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select' as const,
        currentValue: 'molly-model:unselected',
        options: [{ value: modelId, name: 'Synthetic Kimi · k3-256k' }],
      },
      {
        id: 'reasoning_effort',
        name: 'Thinking',
        category: 'thought_level',
        type: 'select' as const,
        currentValue: 'off',
        options: [
          { value: 'off', name: 'Off' },
          { value: 'high', name: 'High' },
        ],
      },
    ],
  };
}
const machine = {
  acpCapabilities: { selected: modelCapabilities(), 'chosen-agent': modelCapabilities() },
} satisfies Pick<MachineViewMeta, 'acpCapabilities'>;
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
    agentType: 'molly',
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
    machineCatalog.machines = new Map([[machineId, machine]]);
    for (const id of ['selected', 'chosen-agent']) {
      agentDefaultsCache.set(id as AgentConfigId, {
        modelId,
        modeId: null,
        configOptionValues: { reasoning_effort: 'high' },
      });
    }
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

  it('excludes retired and custom-launch targets from first-task execution', () => {
    const molly = config('molly', 'Molly');
    const retired = { ...molly, id: 'legacy' as AgentConfigId, agentType: 'claude' };
    const override = { ...molly, id: 'override' as AgentConfigId, runtimeOverrides: {} };
    expect(getFirstTaskAgentConfigs([retired, override, molly], project)).toEqual([molly]);
  });

  it('requires an authoritative exact model and a supported explicit thinking level', () => {
    const options = buildAcpSelectorOptions({
      configId: 'selected' as AgentConfigId,
      cliType: 'builtin',
      agentType: 'molly',
      selectedModelId: modelId,
      machine,
    });
    expect(isFirstTaskModelAvailable(options, modelId, 'high')).toBe(true);
    expect(isFirstTaskModelAvailable(options, modelId, 'off')).toBe(true);
    expect(isFirstTaskModelAvailable(options, modelId, '')).toBe(false);
    expect(isFirstTaskModelAvailable(options, modelId, 'xhigh')).toBe(false);
    expect(isFirstTaskModelAvailable(options, 'molly-model:unselected', 'off')).toBe(false);
    expect(
      isFirstTaskModelAvailable(options, encodeMollyModelOption('deleted', 'k3-256k'), 'high')
    ).toBe(false);
    expect(
      isFirstTaskModelAvailable({ ...options, capabilityAuthority: 'provisional' }, modelId, 'high')
    ).toBe(false);
    expect(
      isFirstTaskModelAvailable({ ...options, modelReasoningEfforts: undefined }, modelId, 'high')
    ).toBe(false);
    expect(
      isFirstTaskModelAvailable({ ...options, configOptionSelectors: [] }, modelId, 'high')
    ).toBe(false);
  });

  it.each(['missing', 'stale', 'unsupported', 'catalog-missing'])(
    'enters without accepting a task for a %s model selection',
    async (kind) => {
      const selected = config('selected', 'Molly');
      const store = createStore();
      store.set(userAtom, { id: 'synthetic-user', name: 'User', email: 'synthetic@example.com' });
      store.set(runtimeAtom, { workspaceId: 'local', workspaceSlug: 'local' } as never);
      store.set(agentConfigMetaCacheAtom, { [getAgentConfigRoomId(selected.id)]: selected });
      agentDefaultsCache.set(selected.id, {
        modelId: kind === 'missing' ? null : kind === 'stale' ? 'old-model' : modelId,
        modeId: null,
        configOptionValues: { reasoning_effort: kind === 'unsupported' ? 'xhigh' : 'high' },
      });
      if (kind === 'catalog-missing') machineCatalog.machines = new Map();
      const events: string[] = [];
      sessionActions.startSession.mockImplementation(async () => {
        events.push('accept');
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
                events.push('enter');
                return true;
              }}
            />
          </Provider>
        );
      });
      expect(container.textContent).toContain(
        'Missing or outdated choices are not replaced automatically'
      );
      expect(container.textContent).not.toContain('Start design session');
      const enter = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Enter Molly'
      );
      expect(enter).toBeDefined();
      await act(async () => enter?.click());
      expect(events).toEqual(['enter']);
    }
  );

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
  it.each(['save', 'accept', 'success', 'changed', 'rehydrated', 'cache-changed'])(
    'keeps the design handoff recoverable across unmount: %s',
    async (outcome) => {
      sessionActions.electron = true;
      const selected = config('chosen-agent', 'Chosen Agent');
      const store = createStore();
      store.set(userAtom, { id: 'user-design', name: 'User', email: 'synthetic@example.com' });
      store.set(runtimeAtom, { workspaceId: 'local', workspaceSlug: 'local' } as never);
      store.set(localProbeResultAtom, { machineId } as never);
      store.set(agentConfigMetaCacheAtom, { [getAgentConfigRoomId(selected.id)]: selected });
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
        expect(historyEntry.inputConfig.modelId).toBe(modelId);
        expect(historyEntry.inputConfig.configOptionValues).toEqual({ reasoning_effort: 'high' });
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
      if (outcome === 'cache-changed') {
        agentDefaultsCache.set(selected.id, { modelId: 'changed-after-submit', modeId: null });
      }
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
      } else if (outcome === 'success' || outcome === 'rehydrated' || outcome === 'cache-changed') {
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
