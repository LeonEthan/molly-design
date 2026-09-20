import { useMemo, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Provider, createStore } from 'jotai';
import { createLocalPlatformProvider, createStaticStore } from '@molly/platform';
import { PlatformContext } from '@molly/platform/react';
import {
  ACP_CAPABILITY_CACHE_VERSION,
  getAgentConfigRoomId,
  getMachineRoomId,
  type AgentConfigId,
  type AgentConfigMeta,
  type LocalProjectId,
  type MachineId,
  type WorkspaceId,
} from '@molly/shared';
import { encodeMollyModelOption, MOLLY_UNSELECTED_MODEL } from '@molly/shared/embedded-harness';
import { userAtom } from '@/atoms';
import { agentConfigMetaCacheAtom, machineMetaCacheAtom } from '@/atoms/doc-meta';
import { runtimeAtom } from '@/atoms/runtime';
import { currentWorkspaceSlugAtom } from '@/atoms/workspace-context';
import { FirstTaskScreen } from '@/components/onboarding';

const workspaceId = 'workspace-onboarding-first-task' as WorkspaceId;
const machineId = 'machine-onboarding-first-task' as MachineId;
const project = {
  kind: 'local' as const,
  machineId,
  localProjectId: 'project-lody' as LocalProjectId,
  name: 'Molly',
};
const configs: AgentConfigMeta[] = [
  {
    id: 'provider-molly' as AgentConfigId,
    machineId,
    name: 'Molly',
    description: undefined,
    cliType: 'builtin',
    agentType: 'molly',
    env: {},
  },
  {
    id: 'provider-kimi' as AgentConfigId,
    machineId,
    name: 'Retired Kimi CLI',
    description: undefined,
    cliType: 'builtin',
    agentType: 'kimi',
    env: {},
  },
];

const storyPlatform = createLocalPlatformProvider({
  session: createStaticStore({
    status: 'authenticated',
    user: { id: 'user-onboarding-first-task', name: 'Wibus' },
  }),
  workspaces: createStaticStore({
    status: 'ready',
    workspaces: [
      {
        id: workspaceId,
        name: 'Molly',
        slug: 'lody',
        role: 'owner',
      },
    ],
    activeWorkspaceId: workspaceId,
  }),
});

function ModelSelectionStory({ catalogAvailable = true }: { catalogAvailable?: boolean }) {
  const [selectedAgentConfigId, setSelectedAgentConfigId] = useState(configs[0]!.id);
  const [completed, setCompleted] = useState(false);
  const store = useMemo(() => {
    const next = createStore();
    next.set(userAtom, {
      id: 'user-onboarding-first-task',
      name: 'Wibus',
      email: 'wibus@example.com',
    });
    next.set(currentWorkspaceSlugAtom, 'lody');
    next.set(runtimeAtom, {
      workspaceId,
      workspaceSlug: 'lody',
    } as never);
    next.set(
      agentConfigMetaCacheAtom,
      Object.fromEntries(configs.map((config) => [getAgentConfigRoomId(config.id), config]))
    );
    const modelId = encodeMollyModelOption('00000000-0000-4000-8000-000000000001', 'k3-256k');
    next.set(machineMetaCacheAtom, {
      [getMachineRoomId(machineId)]: {
        id: machineId,
        name: 'Synthetic local machine',
        ownerUserId: 'user-onboarding-first-task',
        acpCapabilities: catalogAvailable
          ? {
              [configs[0]!.id]: {
                cliType: 'builtin',
                agentType: 'molly',
                provenance: 'runtime',
                cacheVersion: ACP_CAPABILITY_CACHE_VERSION,
                fetchedAt: 1,
                modes: [],
                models: [{ modelId, name: 'Synthetic Kimi · k3-256k' }],
                modelReasoningEfforts: { [modelId]: ['off', 'high'] },
                configOptions: [
                  {
                    id: 'model',
                    category: 'model',
                    name: 'Model',
                    type: 'select',
                    currentValue: MOLLY_UNSELECTED_MODEL,
                    options: [{ value: modelId, name: 'Synthetic Kimi · k3-256k' }],
                  },
                  {
                    id: 'reasoning_effort',
                    category: 'thought_level',
                    name: 'Thinking',
                    type: 'select',
                    currentValue: 'off',
                    options: [
                      { value: 'off', name: 'Off' },
                      { value: 'high', name: 'High' },
                    ],
                  },
                ],
              },
            }
          : undefined,
      },
    } as never);
    return next;
  }, [catalogAvailable]);

  if (completed) {
    return <div data-testid="first-task-skipped" />;
  }

  return (
    <PlatformContext.Provider value={storyPlatform}>
      <Provider store={store}>
        <FirstTaskScreen
          agentConfigId={selectedAgentConfigId}
          project={project}
          onBack={() => {}}
          onAgentConfigChange={(config) => setSelectedAgentConfigId(config.id)}
          onSkip={() => setCompleted(true)}
          onContinue={async () => {
            setCompleted(true);
            return true;
          }}
        />
      </Provider>
    </PlatformContext.Provider>
  );
}

const meta = {
  title: 'Onboarding/FirstTaskScreen',
  component: ModelSelectionStory,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ModelSelectionStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ExplicitModelSelection: Story = {
  render: () => <ModelSelectionStory />,
};

export const CatalogUnavailable: Story = {
  render: () => <ModelSelectionStory catalogAvailable={false} />,
};
