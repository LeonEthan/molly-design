import type { Meta, StoryObj } from '@storybook/react';
import type { ModelConnection, ProtectedImageConnection } from '@molly/shared/embedded-harness';
import { DesignReadinessView } from '@/components/settings/design-readiness';

const deepseek: ModelConnection = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  revision: 1,
  providerPresetId: 'deepseek',
  displayName: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  enabled: true,
  credentialRef: 'synthetic-reference',
};
const image: ProtectedImageConnection = {
  id: '00000000-0000-4000-8000-000000000009',
  revision: 1,
  enabled: true,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-image-1',
  hasApiKey: true,
  legacyHistoryMayContainKey: false,
};

const meta = {
  title: 'Settings/DesignReadiness',
  component: DesignReadinessView,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[560px]">
        <Story />
      </div>
    ),
  ],
  args: {
    onShow: () => undefined,
    connections: [deepseek],
    imageConnection: image,
    pinterestCookieCount: 14,
  },
} satisfies Meta<typeof DesignReadinessView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SetUp: Story = {};
export const SeveralConnections: Story = {
  args: {
    connections: [
      deepseek,
      { ...deepseek, id: '00000000-0000-4000-8000-000000000002', displayName: 'Kimi' },
    ],
  },
};
export const NothingSetUp: Story = {
  args: { connections: [], imageConnection: null, pinterestCookieCount: 0 },
};
export const ConnectionsOff: Story = {
  args: {
    connections: [{ ...deepseek, enabled: false }],
    imageConnection: { ...image, enabled: false },
  },
};
export const ImageKeyMissing: Story = {
  args: { imageConnection: { ...image, hasApiKey: false } },
};
export const StillReading: Story = {
  args: { connections: undefined, imageConnection: undefined, pinterestCookieCount: undefined },
};
export const NarrowPanel: Story = {
  decorators: [
    (Story) => (
      <div className="w-[320px]">
        <Story />
      </div>
    ),
  ],
  args: {
    connections: [{ ...deepseek, displayName: 'DeepSeek for brand campaign work' }],
  },
};
