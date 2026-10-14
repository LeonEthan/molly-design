// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  buildSessionTurnInputConfig,
  type AgentConfigMeta,
  type SessionMeta,
  getSessionRoomId,
  type SessionId,
  ACP_CAPABILITY_CACHE_VERSION,
  buildPendingUserHistoryEntry,
  HistoryEntryWriteSchema,
  parseHistoryWrite,
} from '@molly/shared';
import { buildAcpSelectorOptions } from '../src/components/shared/acp-selector-options';

const state = vi.hoisted(() => ({
  configs: [] as AgentConfigMeta[],
  pending: [] as { association: Record<string, string> }[],
  metas: new Map<string, SessionMeta>(),
  calls: [] as string[],
  runtime: null as unknown,
}));
vi.mock('../src/atoms/runtime', () => ({ activeWorkspaceRuntimeAtom: 'runtime' }));
vi.mock('../src/atoms/local-probe', () => ({ localProbeResultAtom: 'machine' }));
vi.mock('../src/atoms', () => ({
  userAtom: 'user',
  currentWorkspaceIdAtom: 'workspace',
  getAllAgentConfigAtom: 'configs',
}));
vi.mock('jotai', async (original) => ({
  ...(await original<typeof import('jotai')>()),
  useAtomValue: (atom: string) =>
    atom === 'runtime'
      ? state.runtime
      : atom === 'configs'
        ? state.configs
        : atom === 'user'
          ? { id: 'local:user' }
          : atom === 'machine'
            ? { machineId: 'machine' }
            : null,
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => async () => state.calls.push('navigate'),
}));
vi.mock('../src/lib/session-draft-tabs', () => ({ writeStoredLastActiveTabState: () => {} }));
vi.mock('../src/lib/electron-ipc-client', () => ({
  getIpcServices: () => ({
    design: {
      pending: async () => state.pending,
      copy: async (_source: string, association: Record<string, string>) => {
        state.calls.push('copy');
        return { association };
      },
      create: async ({ association }: { association: Record<string, string> }) => {
        state.calls.push('create');
        return { association };
      },
      acknowledge: async () => state.calls.push('acknowledge'),
      finishCopy: async () => state.calls.push('finishCopy'),
    },
  }),
}));
vi.mock('sonner', () => ({ toast: { error: () => {} } }));

import {
  useDesignCreation,
  usePendingDesignRecovery,
} from '../src/components/sessions/design-canvas';

let root: Root;
let host: HTMLDivElement;
let create: ReturnType<typeof useDesignCreation>;
const config = (id: string, machineId = 'machine', agentType = 'molly'): AgentConfigMeta => ({
  id: id as AgentConfigMeta['id'],
  machineId: machineId as AgentConfigMeta['machineId'],
  name: id,
  cliType: 'builtin',
  agentType,
  env: {},
});
function Creation() {
  create = useDesignCreation('local');
  return null;
}
function Recovery() {
  usePendingDesignRecovery();
  return null;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.configs = [config('unrelated', 'machine', 'codex'), config('molly-config')];
  state.pending = [];
  state.metas.clear();
  state.calls = [];
  state.runtime = {
    repo: { getDocMeta: async (room: string) => ({ meta: state.metas.get(room) }) },
    writer: {
      upsertDocMeta: async (room: string, meta: SessionMeta) => {
        state.metas.set(room, { ...state.metas.get(room), ...meta });
        state.calls.push('publish');
      },
    },
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it.each([undefined, 'source-artwork'])(
  'publishes a selectable Molly session for %s',
  async (source) => {
    await act(async () => root.render(<Creation />));
    await act(async () => create('Editable copy', 800, 600, source));
    const meta = [...state.metas.values()][0];
    const input = buildSessionTurnInputConfig({
      cliType: meta.cliType!,
      agentType: meta.agentType!,
      agentConfigId: meta.agentConfigId,
      inputBlocks: [{ type: 'text', text: 'Change the title' }],
    });
    const entry = buildPendingUserHistoryEntry({
      userId: 'local:user',
      inputBlocks: [{ type: 'text', text: 'Change the title' }],
      timestamp: '2026-10-12T00:00:00Z',
      inputConfig: input,
    });
    expect(() =>
      parseHistoryWrite(HistoryEntryWriteSchema, { id: 'turn', ...entry })
    ).not.toThrow();
    expect(meta).toMatchObject({
      machineId: 'machine',
      cliType: 'builtin',
      agentType: 'molly',
      agentConfigId: 'molly-config',
    });
    expect(input.modelId).toBeUndefined();
    const options = buildAcpSelectorOptions({
      configId: meta.agentConfigId,
      cliType: meta.cliType,
      agentType: meta.agentType,
      machine: {
        acpCapabilities: {
          'molly-config': {
            cliType: 'builtin',
            agentType: 'molly',
            provenance: 'runtime',
            cacheVersion: ACP_CAPABILITY_CACHE_VERSION,
            fetchedAt: 1,
            modes: [],
            models: [],
            configOptions: [
              {
                id: 'model',
                name: 'Model',
                category: 'model',
                type: 'select',
                currentValue: 'molly-model:unselected',
                options: [{ value: 'molly-model:connection/model', name: 'Test model' }],
              },
            ],
          },
        },
      },
    });
    expect(options.modelOptions.map((option) => option.value)).toEqual([
      'molly-model:connection/model',
    ]);
    expect(state.calls).toEqual(
      source
        ? ['copy', 'publish', 'acknowledge', 'finishCopy', 'navigate']
        : ['create', 'publish', 'acknowledge', 'navigate']
    );
  }
);

it('does not copy or publish when the local Molly catalog is unavailable', async () => {
  state.configs = [config('elsewhere', 'other-machine'), config('wrong-agent', 'machine', 'codex')];
  await act(async () => root.render(<Creation />));
  await expect(create('Editable copy', 800, 600, 'source')).rejects.toThrow();
  expect(state.metas.size).toBe(0);
  expect(state.calls).toEqual([]);
});

it('recovers an unacknowledged association with the same catalog binding', async () => {
  state.pending = [
    {
      association: {
        sessionId: 'recovered',
        machineId: 'machine',
        userId: 'local:user',
        name: 'Recovered design',
        createdAt: '2026-10-12T00:00:00Z',
      },
    },
  ];
  await act(async () => root.render(<Recovery />));
  expect([...state.metas.values()][0]).toMatchObject({
    agentType: 'molly',
    agentConfigId: 'molly-config',
    design: { artworkId: 'recovered', path: 'design.json' },
  });
  expect(state.calls).toEqual(['publish', 'acknowledge']);
});

it('retains pending artwork until its own machine catalog becomes available', async () => {
  state.configs = [config('elsewhere', 'other-machine')];
  state.pending = [
    {
      association: {
        sessionId: 'waiting',
        machineId: 'machine',
        userId: 'local:user',
        name: 'Waiting design',
        createdAt: '2026-10-12T00:00:00Z',
      },
    },
  ];
  await act(async () => root.render(<Recovery />));
  expect(state.metas.size).toBe(0);
  expect(state.calls).toEqual([]);
  state.configs = [config('molly-config')];
  await act(async () => root.render(<Recovery />));
  expect([...state.metas.values()][0]).toMatchObject({ agentConfigId: 'molly-config' });
  expect(state.calls).toEqual(['publish', 'acknowledge']);
});

it('does not replace an already published session binding during association recovery', async () => {
  state.pending = [
    {
      association: {
        sessionId: 'existing',
        machineId: 'machine',
        userId: 'local:user',
        name: 'Existing design',
        createdAt: '2026-10-12T00:00:00Z',
      },
    },
  ];
  state.metas.set(getSessionRoomId('existing' as SessionId), {
    id: 'existing' as SessionId,
    cliType: 'builtin',
    agentType: '',
    title: 'A retained legacy copy',
  });
  await act(async () => root.render(<Recovery />));
  expect([...state.metas.values()][0]).toMatchObject({
    agentType: '',
    title: 'A retained legacy copy',
    design: { artworkId: 'existing', path: 'design.json' },
  });
  expect([...state.metas.values()][0].agentConfigId).toBeUndefined();
});
