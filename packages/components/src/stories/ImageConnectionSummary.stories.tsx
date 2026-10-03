import type { Meta, StoryObj } from '@storybook/react';
import { ImageConnectionSummary } from '@/components/settings/image-connection-setting';

const meta = {
  title: 'Settings/ImageConnectionSummary',
  component: ImageConnectionSummary,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[560px] rounded-2xl border border-border/40 bg-card">
        <Story />
      </div>
    ),
  ],
  args: {
    stored: {
      enabled: true,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-image-2',
      hasApiKey: true,
    },
    onToggle: () => undefined,
    onEdit: () => undefined,
    onCheck: () => undefined,
    onDelete: () => undefined,
  },
} satisfies Meta<typeof ImageConnectionSummary>;
export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = {};
export const Checked: Story = {
  args: { check: { phase: 'done', result: { ok: true, models: ['gpt-image-2'] } } },
};
export const Off: Story = {
  args: { stored: { ...meta.args.stored, enabled: false } },
};
export const KeyMissing: Story = {
  args: { stored: { ...meta.args.stored, enabled: false, hasApiKey: false } },
};
export const DashScope: Story = {
  args: {
    stored: {
      ...meta.args.stored,
      protocol: 'dashscope',
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      model: 'qwen-image-2.0',
    },
  },
};
