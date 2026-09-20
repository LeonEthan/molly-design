import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import type { AgentConfigId, AgentConfigMeta, MachineId } from '@molly/shared';
import { ProvidersScreenView } from '@/components/onboarding';

const machineId = 'synthetic-machine' as MachineId;
const molly: AgentConfigMeta = {
  id: 'synthetic-molly' as AgentConfigId,
  machineId,
  name: 'Molly',
  description: undefined,
  cliType: 'builtin',
  agentType: 'molly',
  env: {},
};
const meta = {
  title: 'Onboarding/ProvidersScreen',
  component: ProvidersScreenView,
  parameters: { layout: 'fullscreen' },
  args: { configs: [], localMachineId: machineId, onBack: fn(), onSkip: fn(), onNext: fn() },
} satisfies Meta<typeof ProvidersScreenView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const WaitingForLocalMachine: Story = { args: { localMachineId: null } };
export const ExplicitSelection: Story = { args: { configs: [molly] } };
export const LegacyOnly: Story = {
  args: { configs: [{ ...molly, agentType: 'claude', name: 'Retired Claude' }] },
};
