import type { Meta, StoryObj } from '@storybook/react';
import type { AgentConfigId, AgentConfigMeta, MachineId } from '@molly/shared';
import { AgentEngineCatalog } from '@/components/settings/agent-engine-catalog';

const legacy: AgentConfigMeta = {
  id: 'synthetic-legacy' as AgentConfigId,
  machineId: 'synthetic-machine' as MachineId,
  name: 'Previous Claude configuration',
  description: undefined,
  cliType: 'builtin',
  agentType: 'claude',
  env: {},
};
const meta = {
  title: 'Settings/AgentEngineCatalog',
  component: AgentEngineCatalog,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[420px]">
        <Story />
      </div>
    ),
  ],
  args: { configs: [] },
} satisfies Meta<typeof AgentEngineCatalog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const LegacyAndPending: Story = {
  args: {
    configs: [legacy],
    setups: [
      {
        v: 1,
        id: 'synthetic-setup' as AgentConfigId,
        machineId: legacy.machineId,
        config: { ...legacy, name: 'Unfinished Codex setup', agentType: 'codex' },
        status: 'awaiting-auth',
        attempt: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  },
};
export const LongNames: Story = {
  args: {
    configs: [
      {
        ...legacy,
        name: 'Previous configuration with a deliberately long name that should remain readable in a narrow settings panel',
      },
    ],
  },
};
