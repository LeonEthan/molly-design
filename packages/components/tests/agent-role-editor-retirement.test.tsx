// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import {
  ACP_CAPABILITY_CACHE_VERSION,
  getAgentConfigRoomId,
  type AgentConfigMeta,
  type AgentConfigId,
  type MachineId,
  type AgentRole,
  type AgentRoleId,
} from '@molly/shared';
import { encodeMollyModelOption } from '@molly/shared/embedded-harness';
import type { AgentRoleFormProps } from '../src/components/settings/agent-role-form';
import {
  AgentRoleEditorDialog,
  openAgentRoleEditorForEdit,
  type AgentRoleEditorState,
} from '../src/components/settings/agent-role-editor-dialog';
import { EMPTY_AGENT_ROLE_FORM_VALUE } from '../src/lib/agent-role-form';
import { agentConfigMetaCacheAtom } from '../src/atoms/doc-meta';
import { userAtom } from '../src/atoms';
import { initI18n } from '../src/i18n';

const state = vi.hoisted(() => ({
  form: undefined as AgentRoleFormProps | undefined,
  saved: [] as AgentRole[],
  machines: new Map(),
}));
vi.mock('../src/components/settings/agent-role-form', () => ({
  AgentRoleForm: (props: AgentRoleFormProps) => {
    state.form = props;
    return <div>{props.error}</div>;
  },
}));
vi.mock('../src/hooks/use-visible-machine-metas', () => ({ useVisibleMachineMetas: () => state }));
vi.mock('../src/hooks/use-workspace-agent-roles', () => ({
  useWorkspaceAgentRoleActions: () => ({
    upsert: async (role: AgentRole) => {
      state.saved.push(role);
    },
  }),
}));
vi.mock('../src/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@posthog/react', () => ({ usePostHog: () => undefined }));
vi.mock('../src/lib/posthog-analytics', () => ({ capturePostHogEvent: () => {} }));
vi.mock('../src/ui/dialog', () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Dialog: Part, DialogContent: Part, DialogDescription: Part, DialogTitle: Part };
});

const machineId = 'synthetic-machine' as MachineId;
const molly: AgentConfigMeta = {
  id: 'molly' as AgentConfigId,
  machineId,
  name: 'Molly',
  description: undefined,
  cliType: 'builtin',
  agentType: 'molly',
  env: {},
};
const legacy: AgentConfigMeta = {
  ...molly,
  id: 'legacy' as AgentConfigId,
  agentType: 'kimi',
  name: 'Old Kimi',
};
const override: AgentConfigMeta = {
  ...molly,
  id: 'override' as AgentConfigId,
  runtimeOverrides: {},
};
const modelId = encodeMollyModelOption('synthetic-connection', 'k3-256k');
const capability = {
  cliType: 'builtin',
  agentType: 'molly',
  cacheVersion: ACP_CAPABILITY_CACHE_VERSION,
  provenance: 'runtime',
  fetchedAt: 1,
  modes: [],
  models: [{ modelId, name: 'Kimi' }],
  modelReasoningEfforts: { [modelId]: ['off', 'high'] },
  configOptions: [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: 'molly-model:unselected',
      options: [{ value: modelId, name: 'Kimi' }],
    },
    {
      id: 'reasoning_effort',
      name: 'Thinking',
      category: 'thought_level',
      type: 'select',
      currentValue: 'off',
      options: [
        { value: 'off', name: 'Off' },
        { value: 'high', name: 'High' },
      ],
    },
  ],
};
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await initI18n('en');
  state.form = undefined;
  state.saved = [];
  state.machines = new Map([
    [
      machineId,
      { id: machineId, name: 'Synthetic machine', acpCapabilities: { molly: capability } },
    ],
  ]);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(editor: AgentRoleEditorState) {
  const store = createStore();
  store.set(userAtom, { id: 'synthetic-user', name: 'User', email: 'synthetic@example.com' });
  store.set(
    agentConfigMetaCacheAtom,
    Object.fromEntries(
      [molly, legacy, override].map((config) => [getAgentConfigRoomId(config.id), config])
    )
  );
  await act(async () =>
    root.render(
      <Provider store={store}>
        <AgentRoleEditorDialog
          editor={editor}
          accessibleRoles={[]}
          onChange={() => {}}
          onClose={() => {}}
          source="settings"
        />
      </Provider>
    )
  );
  expect(state.form).toBeDefined();
  return state.form!;
}
function add(
  configId: AgentConfigId,
  selectedModel: string | null = modelId
): AgentRoleEditorState {
  return {
    mode: 'add',
    roleId: 'new-role' as AgentRoleId,
    value: {
      ...EMPTY_AGENT_ROLE_FORM_VALUE,
      name: 'Synthetic role',
      machineId,
      agentConfigId: configId,
      modelId: selectedModel,
      configOptionValues: { reasoning_effort: 'high' },
    },
  };
}
it.each([legacy.id, override.id])(
  'offers only Molly and refuses a supplied retired target %s',
  async (id) => {
    const form = await render(add(id));
    expect(form.agentConfigs.map((config) => config.agentConfigId)).toEqual([molly.id]);
    expect(form.submitDisabled).toBe(true);
    await act(async () => form.onSubmit());
    expect(state.saved).toEqual([]);
  }
);
it.each([null, 'old-model'])(
  'does not default or save a missing/stale model %s',
  async (selectedModel) => {
    const form = await render(add(molly.id, selectedModel));
    expect(form.value.modelId).toBe(selectedModel);
    await act(async () => form.onSubmit());
    expect(state.saved).toEqual([]);
  }
);
it('saves the explicit embedded model and supported thinking', async () => {
  const form = await render(add(molly.id));
  expect(form.submitDisabled).toBe(false);
  await act(async () => form.onSubmit());
  expect(
    state.saved.map((role) => ({ target: role.agentConfigId, config: role.runConfig }))
  ).toEqual([
    { target: molly.id, config: { modelId, configOptionValues: { reasoning_effort: 'high' } } },
  ]);
});
it.each(['old-cache', 'missing-ladder', 'wrong-effort'])(
  'refuses %s without changing the selection',
  async (kind) => {
    state.machines = new Map([
      [
        machineId,
        {
          id: machineId,
          name: 'Synthetic machine',
          acpCapabilities: {
            molly: {
              ...capability,
              ...(kind === 'old-cache' ? { cacheVersion: 0 } : {}),
              ...(kind === 'missing-ladder' ? { modelReasoningEfforts: undefined } : {}),
            },
          },
        },
      ],
    ]);
    const editor = add(molly.id);
    if (kind === 'wrong-effort') editor.value.configOptionValues.reasoning_effort = 'xhigh';
    const form = await render(editor);
    expect(form.submitDisabled).toBe(true);
    await act(async () => form.onSubmit());
    expect(state.saved).toEqual([]);
    expect(form.value.modelId).toBe(modelId);
  }
);
it('keeps a legacy Role read-only without silently migrating or saving edits', async () => {
  const role: AgentRole = {
    v: 1,
    id: 'old-role' as AgentRoleId,
    ownerUserId: 'synthetic-user',
    visibility: 'private',
    name: 'Legacy role',
    machineId,
    agentConfigId: legacy.id,
    runConfig: { modelId: 'old-model' },
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  const form = await render(openAgentRoleEditorForEdit(role));
  expect(form.readOnly).toBe(true);
  expect(form.submitDisabled).toBe(true);
  expect(host.textContent).toContain('Agent engine is retired');
  await act(async () => form.onSubmit());
  expect(state.saved).toEqual([]);
  expect(role.runConfig).toEqual({ modelId: 'old-model' });
});
