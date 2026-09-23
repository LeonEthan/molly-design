import type { Meta, StoryObj } from '@storybook/react';
import { Provider, createStore } from 'jotai';
import { useMemo, useState } from 'react';
import { fn } from 'storybook/test';
import { createLocalPlatformProvider, createStaticStore } from '@molly/platform';
import { PlatformContext } from '@molly/platform/react';
import {
  type AgentConfigId,
  type AgentConfigMeta,
  type MachineId,
  getAgentConfigRoomId,
} from '@molly/shared';

import { encodeMollyModelOption, MOLLY_UNSELECTED_MODEL } from '@molly/shared/embedded-harness';
import { agentConfigMetaCacheAtom } from '@/atoms/doc-meta';
import {
  DesktopMachineMenu,
  DesktopPermissionModeButton,
  DesktopRunConfigMenu,
} from '@/components/sessions/desktop-run-config-menu';
import type {
  AcpConfigOptionSelector,
  AcpConfigOptionValue,
} from '@/components/shared/acp-selector-options';
import type { AcpSessionSelectOption } from '@/components/shared/acp-session-select';

/**
 * The desktop composer's two consolidated footer buttons: the run-config
 * dropdown (direct provider/model choices, reasoning + Plan / Fast toggles) and the
 * standalone permission-mode button — both on the standard DropdownMenu
 * surface (distinct background + layered float shadow). The full in-context
 * page is `SessionConversationPage.stories` (`DesktopIdle`).
 */
const machineId = 'machine-storybook' as MachineId;
const codexId = 'agent-codex' as AgentConfigId;
const grokId = 'agent-grok' as AgentConfigId;
const deepseekId = 'agent-deepseek' as AgentConfigId;

const storyPlatform = createLocalPlatformProvider({
  session: createStaticStore({
    status: 'authenticated',
    user: { id: 'user-storybook-run-config', name: 'Storybook user' },
  }),
  workspaces: createStaticStore({
    status: 'ready',
    workspaces: [
      { id: 'workspace-storybook', name: 'Storybook Workspace', slug: null, role: 'owner' },
    ],
    activeWorkspaceId: 'workspace-storybook',
  }),
});

const agents: AgentConfigMeta[] = [
  {
    id: codexId,
    machineId,
    name: 'Codex Primary',
    description: 'Codex on zx-macbook',
    cliType: 'builtin',
    agentType: 'codex',
    env: {},
  },
  {
    id: 'agent-claude' as AgentConfigId,
    machineId,
    name: 'Claude (Opus)',
    description: 'Claude Code',
    cliType: 'builtin',
    agentType: 'claude',
    env: {},
  },
  {
    id: grokId,
    machineId,
    name: 'Grok',
    description: 'Official Grok runtime through the Molly compatibility adapter',
    cliType: 'builtin',
    agentType: 'grok',
    env: {},
  },
  {
    id: deepseekId,
    machineId,
    name: 'DeepSeek Harness',
    description: 'Built-in DeepSeek Harness runtime',
    cliType: 'builtin',
    agentType: 'deepseek',
    env: {},
  },
];

const modelOptions: AcpSessionSelectOption[] = [
  { value: 'gpt-5.5', label: '5.5', description: 'Latest frontier Codex model' },
  { value: 'gpt-5.4', label: '5.4', description: 'Frontier Codex model' },
  { value: 'gpt-5.4-mini', label: '5.4-mini', description: 'Smaller, faster Codex model' },
];

const modeOptions: AcpSessionSelectOption[] = [
  {
    value: 'read-only',
    label: 'Read-only',
    description: 'Requires approval to edit files and run commands.',
  },
  { value: 'agent', label: 'Agent', description: 'Read and edit files, and run commands.' },
  {
    value: 'agent-full-access',
    label: 'Full access',
    description:
      'Codex can edit files outside this workspace and run commands with network access.',
  },
];

const selectors: AcpConfigOptionSelector[] = [
  {
    type: 'select',
    configId: 'reasoning_effort',
    category: 'thought_level',
    label: 'Reasoning effort',
    currentValue: 'medium',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'xhigh', label: 'XHigh' },
      { value: 'max', label: 'Max' },
      { value: 'ultra', label: 'Ultra' },
    ],
  },
  {
    type: 'select',
    configId: 'collaboration_mode',
    category: 'collaboration_mode',
    label: 'Collaboration mode',
    currentValue: 'default',
    options: [
      { value: 'default', label: 'Default' },
      { value: 'plan', label: 'Plan' },
    ],
  },
  {
    type: 'select',
    configId: 'fast-mode',
    category: 'fast-mode',
    label: 'Fast mode',
    currentValue: 'on',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
  },
];

const grokSelectors: AcpConfigOptionSelector[] = [
  {
    type: 'select',
    configId: 'interaction_mode',
    category: 'mode',
    label: 'Interaction Mode',
    currentValue: 'agent',
    options: [
      { value: 'agent', label: 'Agent' },
      { value: 'plan', label: 'Plan' },
      { value: 'ask', label: 'Ask' },
    ],
  },
  {
    type: 'select',
    configId: 'permission_mode',
    category: '_permission',
    label: 'Permission Mode',
    currentValue: 'ask',
    options: [
      { value: 'ask', label: 'Ask Every Time' },
      { value: 'always-approve', label: 'Always Approve' },
    ],
  },
  {
    type: 'select',
    configId: 'model',
    category: 'model',
    label: 'Model',
    currentValue: 'grok-build',
    options: [{ value: 'grok-build', label: 'Grok Build' }],
  },
  {
    type: 'select',
    configId: 'reasoning_effort',
    category: 'thought_level',
    label: 'Reasoning Effort',
    currentValue: 'medium',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
  },
];

function StoryShell({
  isEmptyConversation,
  machineSelected = true,
}: {
  isEmptyConversation: boolean;
  machineSelected?: boolean;
}) {
  const store = useMemo(() => {
    const s = createStore();
    s.set(
      agentConfigMetaCacheAtom,
      Object.fromEntries(agents.map((a) => [getAgentConfigRoomId(a.id), a]))
    );
    return s;
  }, []);

  const [model, setModel] = useState<string | null>(modelOptions[0]?.value ?? null);
  const [mode, setMode] = useState<string | null>(modeOptions[0]?.value ?? null);
  const [values, setValues] = useState<Record<string, AcpConfigOptionValue>>(() =>
    Object.fromEntries(selectors.map((sel) => [sel.configId, sel.currentValue]))
  );

  return (
    <Provider store={store}>
      <div className="flex min-h-dvh items-end bg-background p-8">
        {/* Mimic the composer footer row the buttons live in. */}
        <div className="mb-6 flex w-full max-w-3xl items-center gap-2 rounded-xl bg-input/90 px-4 py-3">
          <DesktopRunConfigMenu
            agentSelection={machineSelected ? { agentId: codexId, machineId } : null}
            disabledReason={machineSelected ? undefined : 'Select a machine first'}
            agentLocked={!isEmptyConversation}
            modelOptions={modelOptions}
            selectedModelId={model}
            onModelChange={setModel}
            configOptionSelectors={selectors}
            configOptionValues={values}
            onConfigOptionChange={(id, v) => setValues((p) => ({ ...p, [id]: v }))}
          />
          <DesktopPermissionModeButton
            modeOptions={modeOptions}
            selectedModeId={mode}
            onModeChange={setMode}
            configOptionSelectors={selectors}
            configOptionValues={values}
            onConfigOptionChange={(id, v) => setValues((p) => ({ ...p, [id]: v }))}
          />
        </div>
      </div>
    </Provider>
  );
}

function MachineScopeShell() {
  const secondMachineId = 'machine-other-local' as MachineId;
  const [selectedMachineId, setSelectedMachineId] = useState(machineId);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-8">
      <div className="flex items-center gap-2">
        <DesktopMachineMenu
          value={selectedMachineId}
          options={[
            { value: machineId, label: 'zx-macbook' },
            { value: secondMachineId, label: 'build-machine' },
          ]}
          onChange={setSelectedMachineId}
        />
        <div className="flex h-6 items-center rounded-md bg-foreground/[0.06] px-2 text-xs font-normal text-foreground/80">
          lody
        </div>
      </div>
    </div>
  );
}

function GrokConfigShell() {
  const store = useMemo(() => {
    const next = createStore();
    next.set(
      agentConfigMetaCacheAtom,
      Object.fromEntries(agents.map((agent) => [getAgentConfigRoomId(agent.id), agent]))
    );
    return next;
  }, []);
  const [values, setValues] = useState<Record<string, AcpConfigOptionValue>>(() =>
    Object.fromEntries(grokSelectors.map((selector) => [selector.configId, selector.currentValue]))
  );
  const updateConfig = (id: string, value: AcpConfigOptionValue) =>
    setValues((previous) => ({ ...previous, [id]: value }));

  return (
    <Provider store={store}>
      <div className="flex min-h-dvh items-end bg-background p-8">
        <div className="mb-6 flex w-full max-w-3xl items-center gap-2 rounded-xl bg-input/90 px-4 py-3">
          <DesktopRunConfigMenu
            agentSelection={{ agentId: grokId, machineId }}
            agentLocked
            modelOptions={[]}
            selectedModelId={null}
            configOptionSelectors={grokSelectors}
            configOptionValues={values}
            onConfigOptionChange={updateConfig}
          />
          <DesktopPermissionModeButton
            modeOptions={[]}
            selectedModeId={null}
            configOptionSelectors={grokSelectors}
            configOptionValues={values}
            onConfigOptionChange={updateConfig}
          />
        </div>
      </div>
    </Provider>
  );
}

function DeepSeekWarningShell() {
  const store = useMemo(() => {
    const next = createStore();
    next.set(
      agentConfigMetaCacheAtom,
      Object.fromEntries(agents.map((agent) => [getAgentConfigRoomId(agent.id), agent]))
    );
    return next;
  }, []);
  const [model, setModel] = useState<string | null>('deepseek-v4-flash');

  return (
    <Provider store={store}>
      <div className="flex min-h-dvh items-end bg-background p-8">
        <div className="mb-6 flex w-full max-w-3xl items-center gap-2 rounded-xl bg-input/90 px-4 py-3">
          <DesktopRunConfigMenu
            agentSelection={{ agentId: deepseekId, machineId }}
            availableAgentConfigs={agents}
            agentLocked
            modelOptions={[
              {
                value: 'deepseek-v4-flash',
                label: 'DeepSeek-V4-Flash',
                description: 'Faster DeepSeek Harness coding model.',
              },
              {
                value: 'deepseek-v4-pro',
                label: 'DeepSeek-V4-Pro',
                description: 'More capable DeepSeek Harness coding model.',
              },
            ]}
            selectedModelId={model}
            onModelChange={setModel}
          />
        </div>
      </div>
    </Provider>
  );
}

function ProviderModelShell({ empty = false }: { empty?: boolean }) {
  const [model, setModel] = useState(MOLLY_UNSELECTED_MODEL);
  const [values, setValues] = useState<Record<string, AcpConfigOptionValue>>({
    reasoning_effort: 'medium',
  });
  const config: AgentConfigMeta = { ...agents[0]!, name: 'Molly', agentType: 'molly' };
  const options = empty
    ? []
    : ['Studio', 'Review'].flatMap((connection) =>
        [1, 2, 3, 4].map((index) => ({
          value: encodeMollyModelOption(connection.toLowerCase(), `aurora-${index}`),
          label: `${connection} · Aurora ${index}`,
          description: `aurora-${index}`,
        }))
      );
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-8">
      <DesktopRunConfigMenu
        agentSelection={{ agentId: config.id, machineId }}
        availableAgentConfigs={[config]}
        modelOptions={[
          { value: MOLLY_UNSELECTED_MODEL, label: 'Select a connection and model' },
          ...options,
        ]}
        selectedModelId={model}
        onModelChange={setModel}
        configOptionSelectors={
          empty ? [] : selectors.filter((selector) => selector.category === 'thought_level')
        }
        configOptionValues={values}
        onConfigOptionChange={(key, value) =>
          setValues((previous) => ({ ...previous, [key]: value }))
        }
      />
    </div>
  );
}

function EmptyMachineScopeShell() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-8">
      <DesktopMachineMenu value={null} options={[]} onChange={fn()} />
    </div>
  );
}

function LeftOpeningReasoningMenuShell() {
  const store = useMemo(() => {
    const next = createStore();
    next.set(
      agentConfigMetaCacheAtom,
      Object.fromEntries(agents.map((agent) => [getAgentConfigRoomId(agent.id), agent]))
    );
    return next;
  }, []);
  const [values, setValues] = useState<Record<string, AcpConfigOptionValue>>({});

  return (
    <Provider store={store}>
      <div className="relative h-[670px] w-[900px] overflow-hidden bg-background">
        <div className="absolute left-[650px] top-[619px]">
          <DesktopRunConfigMenu
            agentSelection={{ agentId: grokId, machineId }}
            availableAgentConfigs={agents}
            modelOptions={[{ value: 'grok-build', label: 'Grok Build' }]}
            selectedModelId="grok-build"
            configOptionSelectors={grokSelectors}
            configOptionValues={values}
            onConfigOptionChange={(key, value) =>
              setValues((previous) => ({ ...previous, [key]: value }))
            }
          />
        </div>
      </div>
    </Provider>
  );
}

const meta = {
  title: 'Sessions/DesktopRunConfigMenu',
  component: StoryShell,
  parameters: { layout: 'fullscreen' },
  globals: { theme: 'dark' },
  decorators: [
    (Story) => (
      <PlatformContext.Provider value={storyPlatform}>
        <Story />
      </PlatformContext.Provider>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof StoryShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LockedAgent: Story = { args: { isEmptyConversation: false } };
export const EmptyConversationAgentPickable: Story = { args: { isEmptyConversation: true } };
export const MachineRequired: Story = {
  args: { isEmptyConversation: true, machineSelected: false },
};
export const GrokInteractionAndPermission: Story = {
  args: { isEmptyConversation: false },
  render: () => <GrokConfigShell />,
};
export const DeepSeekDelegationWarning: Story = {
  args: { isEmptyConversation: false },
  render: () => <DeepSeekWarningShell />,
};
export const MachineScope: Story = {
  args: { isEmptyConversation: true },
  render: () => <MachineScopeShell />,
};
export const MachineScopeEmpty: Story = {
  args: { isEmptyConversation: true },
  render: () => <EmptyMachineScopeShell />,
};
export const LeftOpeningReasoningMenu: Story = {
  args: { isEmptyConversation: true },
  render: () => <LeftOpeningReasoningMenuShell />,
};

export const ProviderAndModel: Story = {
  args: { isEmptyConversation: true },
  render: () => <ProviderModelShell />,
};
export const NoModelConnections: Story = {
  args: { isEmptyConversation: true },
  render: () => <ProviderModelShell empty />,
};
