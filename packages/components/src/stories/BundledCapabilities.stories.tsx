import { PI_ENGINE_VERSION } from '@molly/shared/embedded-harness';
import type { Meta, StoryObj } from '@storybook/react';
import { BundledCapabilitiesView } from '@/components/settings/bundled-capabilities-setting';

const meta = {
  title: 'Settings/BundledCapabilities',
  component: BundledCapabilitiesView,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[min(560px,calc(100vw-32px))]">
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
        engineVersion: PI_ENGINE_VERSION,
        protocolVersion: 1,
        buildId: 'a'.repeat(64),
      },
      engine: { name: '@earendil-works/pi-coding-agent', version: PI_ENGINE_VERSION, license: 'MIT' },
      addons: [
        { name: 'pi-skillful', version: '0.4.0', license: 'MIT' },
        { name: '@juicesharp/rpiv-ask-user-question', version: '2.12.0', license: 'MIT' },
        { name: '@zigai/pi-mention-skill', version: '0.10.4', license: 'MIT' },
        { name: '@ff-labs/pi-fff', version: '0.11.0', license: 'MIT' },
        { name: 'cc-safety-net', version: '2.6.16', license: 'MIT' },
      ],
    },
  },
};
