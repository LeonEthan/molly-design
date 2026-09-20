// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentConfigId, AgentConfigMeta, MachineId, ProviderSetupTask } from '@molly/shared';
import { MachineAgentSettings } from '../src/components/settings/machine-agent-settings';
import { localProbeResultAtom } from '../src/atoms/local-probe';
import { initI18n } from '../src/i18n';
import en from '../../../locales/en.json';

const state = vi.hoisted(() => ({
  configs: [] as AgentConfigMeta[],
  setups: [] as ProviderSetupTask[],
  requestedMachines: [] as string[],
  syncRemote: undefined as boolean | undefined,
}));
vi.mock('../src/atoms/agents', async (importOriginal) => {
  const { atom } = await import('jotai');
  return {
    ...(await importOriginal<object>()),
    getAllAgentConfigAtom: atom(() => state.configs),
    getAllProviderSetupsAtom: atom(() => state.setups),
  };
});
vi.mock('../src/hooks/use-machine-flock-agent-configs', () => ({
  useMachineFlockAgentConfigsForMachineIds: (ids: string[], options: { syncRemote?: boolean }) => {
    state.requestedMachines = ids;
    state.syncRemote = options.syncRemote;
  },
}));
vi.mock('../src/hooks/use-visible-machine-metas', () => ({
  useVisibleMachineMetas: () => {
    throw new Error('Agents must not mount the old machine management graph');
  },
}));
vi.mock('../src/components/settings/model-connection-setting', () => ({
  ModelConnectionSetting: () => <div data-testid="model-connections" />,
}));

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await initI18n('en');
  state.configs = [];
  state.setups = [];
  state.requestedMachines = [];
  state.syncRemote = undefined;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it.each([undefined, 'agents'] as const)(
  'renders model connections and only local history in %s mode',
  async (mode) => {
    const local: AgentConfigMeta = {
      id: 'local-legacy' as AgentConfigId,
      machineId: 'local-machine' as MachineId,
      name: 'Local historical provider',
      description: undefined,
      cliType: 'builtin',
      agentType: 'claude',
      env: {},
    };
    state.configs = [
      local,
      {
        ...local,
        id: 'other-legacy' as AgentConfigId,
        machineId: 'other-machine' as MachineId,
        name: 'Other machine private provider',
      },
    ];
    state.setups = state.configs.map((config) => ({
      v: 1,
      id: config.id,
      machineId: config.machineId,
      config: { ...config, name: `${config.name} setup` },
      status: 'queued',
      attempt: 1,
      createdAt: 1,
      updatedAt: 1,
    }));
    const before = JSON.stringify([state.configs, state.setups]);
    const store = createStore();
    store.set(localProbeResultAtom, { ok: true, machineId: local.machineId });
    await act(async () =>
      root.render(
        <Provider store={store}>
          <MachineAgentSettings
            mode={mode}
            selectedMachineId={'other-machine' as MachineId}
            onSelectedMachineChange={() => {
              throw new Error('Must not change machine selection');
            }}
          />
        </Provider>
      )
    );
    expect(host.querySelector('[data-testid=model-connections]')).not.toBeNull();
    expect(host.textContent).toContain(en['settings.models.capabilitiesTitle']);
    expect(host.textContent).toContain(local.name);
    expect(host.textContent).toContain(`${local.name} setup`);
    expect(host.textContent).not.toContain('Other machine private provider');
    expect(state.requestedMachines).toEqual([local.machineId]);
    expect(state.syncRemote).toBe(false);
    expect(host.querySelector('button, input, select')).toBeNull();
    expect(JSON.stringify([state.configs, state.setups])).toBe(before);
  }
);

it('keeps connection settings usable before the local machine identity is available', async () => {
  await act(async () =>
    root.render(
      <Provider store={createStore()}>
        <MachineAgentSettings selectedMachineId={null} onSelectedMachineChange={() => undefined} />
      </Provider>
    )
  );
  expect(host.querySelector('[data-testid=model-connections]')).not.toBeNull();
  expect(host.textContent).toContain(en['settings.models.engineSelectionHint']);
  expect(state.requestedMachines).toEqual([]);
});
