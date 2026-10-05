import type { Meta, StoryObj } from '@storybook/react';
import { BundledCapabilitiesView } from '@/components/settings/bundled-capabilities-setting';

const meta = {
  title: 'Settings/BundledCapabilities',
  component: BundledCapabilitiesView,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[560px]">
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
        engineVersion: '1.0.0',
        protocolVersion: 1,
        buildId: 'a'.repeat(64),
      },
      engine: { name: '@earendil-works/pi-coding-agent', version: '1.0.0', license: 'MIT' },
      addons: [
        { name: 'pi-skillful', version: '0.4.0', license: 'MIT' },
        { name: '@juicesharp/rpiv-ask-user-question', version: '2.12.0', license: 'MIT' },
        { name: '@zigai/pi-mention-skill', version: '0.10.4', license: 'MIT' },
        { name: '@ff-labs/pi-fff', version: '0.11.0', license: 'MIT' },
        { name: 'cc-safety-net', version: '2.4.14', license: 'MIT' },
      ],
    },
  },
};
