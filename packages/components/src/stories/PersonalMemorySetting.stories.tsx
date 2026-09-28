import type { Meta, StoryObj } from '@storybook/react';
import { PersonalMemoryPanel } from '@/components/settings/personal-memory-setting';

const meta = {
  title: 'Settings/PersonalMemory',
  component: PersonalMemoryPanel,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[620px]">
        <Story />
      </div>
    ),
  ],
  args: { request: async () => ({ enabled: true, revision: 'synthetic', entries: [] }) },
} satisfies Meta<typeof PersonalMemoryPanel>;
export default meta;
type Story = StoryObj<typeof PersonalMemoryPanel>;
export const Empty: Story = {};
export const Remembered: Story = {
  args: {
    request: async () => ({
      enabled: true,
      revision: 'synthetic',
      entries: [{ id: 'preference', text: 'Prefers concise explanations.' }],
    }),
  },
};
export const Disabled: Story = {
  args: {
    request: async () => ({
      enabled: false,
      revision: 'synthetic',
      entries: [{ id: 'preference', text: '喜欢简洁的说明。' }],
    }),
  },
};
export const Unavailable: Story = {
  args: {
    request: async () => {
      throw new Error('synthetic_unavailable');
    },
  },
};
