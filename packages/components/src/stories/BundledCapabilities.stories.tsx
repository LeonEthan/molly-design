import type { Meta, StoryObj } from '@storybook/react';
import { BundledCapabilitiesView } from '@/components/settings/bundled-capabilities-setting';

const meta = {
  title: 'Settings/BundledCapabilities',
  component: BundledCapabilitiesView,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
  args: { snapshot: undefined },
} satisfies Meta<typeof BundledCapabilitiesView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loading: Story = {};
export const Unavailable: Story = { args: { snapshot: null } };
export const Included: Story = {
  args: {
    snapshot: {
      harness: {
        id: 'molly',
        engine: 'pi',
        engineVersion: '0.85.1',
        protocolVersion: 1,
        buildId: 'a'.repeat(64),
      },
      extensions: [
        {
          name: 'pi-ask-question',
          version: '0.4.0',
          commit: 'b'.repeat(40),
          license: 'MIT',
          tools: ['ask_question'],
          activation: 'requires-question-ui-v1',
        },
      ],
    },
  },
};
