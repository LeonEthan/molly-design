import type { Meta, StoryObj } from '@storybook/react';
import { BrowserImportAccess } from '@/components/settings/browser-import-access';

const meta = {
  title: 'Settings/BrowserImportAccess',
  component: BrowserImportAccess,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[min(400px,calc(100vw-48px))]">
        <Story />
      </div>
    ),
  ],
  args: {
    applicationName: 'Molly Preview',
    browserName: 'Google Chrome',
    pending: false,
    onRecheck: () => undefined,
  },
} satisfies Meta<typeof BrowserImportAccess>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BeforeAccess: Story = { args: { state: 'unrequested' } };
export const DeniedWithoutPrompt: Story = { args: { state: 'denied' } };
export const AccessRestored: Story = { args: { state: 'readable' } };
