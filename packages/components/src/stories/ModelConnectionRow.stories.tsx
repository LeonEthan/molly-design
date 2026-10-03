import type { Meta, StoryObj } from '@storybook/react';
import { ModelConnectionRow } from '@/components/settings/model-connection-setting';

const meta = {
  title: 'Settings/ModelConnectionRow',
  component: ModelConnectionRow,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[560px] rounded-2xl border border-border/40 bg-card">
        <Story />
      </div>
    ),
  ],
  args: {
    onEdit: () => undefined,
    onToggle: () => undefined,
    connection: {
      schemaVersion: 1,
      id: '00000000-0000-4000-8000-000000000001',
      revision: 1,
      providerPresetId: 'deepseek',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      enabled: true,
      credentialRef: 'synthetic-reference',
    },
  },
} satisfies Meta<typeof ModelConnectionRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultEndpoint: Story = {};
export const CustomEndpoint: Story = {
  args: {
    connection: { ...meta.args.connection, baseUrl: 'https://proxy.example.com/v1' },
  },
};
export const Off: Story = {
  args: { connection: { ...meta.args.connection, enabled: false } },
};
export const CannotTurnOn: Story = {
  args: {
    connection: {
      ...meta.args.connection,
      providerPresetId: 'moonshot',
      displayName: 'Kimi',
      baseUrl: 'https://api.kimi.com/coding/v1',
      enabled: false,
    },
  },
};
export const KeyWorks: Story = {
  args: {
    check: { phase: 'done', result: { ok: true, models: ['deepseek-flash'] } },
    onCheck: () => undefined,
    onDelete: () => undefined,
  },
};
export const KeyRejected: Story = {
  args: {
    check: { phase: 'done', result: { ok: false, reason: 'key_rejected', status: 401 } },
    onCheck: () => undefined,
    onDelete: () => undefined,
  },
};
export const ChosenModels: Story = {
  args: { connection: { ...meta.args.connection, models: ['deepseek-flash'] } },
};
