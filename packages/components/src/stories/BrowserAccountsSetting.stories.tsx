import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within } from 'storybook/test';
import { BrowserAccountsSetting } from '@/components/settings/browser-accounts-setting';

const meta = {
  title: 'Settings/BrowserAccounts',
  component: BrowserAccountsSetting,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[440px]">
        <Story />
      </div>
    ),
  ],
  beforeEach: ({ name }) => {
    const previous = window.ipc;
    window.ipc = {
      invoke: async (channel: string) => {
        switch (channel) {
          case 'publicBrowser.getAccountSummary':
            return {
              persistent: true,
              importAvailable: true,
              sites: [{ site: 'pinterest.com', cookieCount: 0 }],
            };
          case 'publicBrowser.getChromeProfiles':
            return [{ id: 'synthetic', name: 'Designer', isDefault: true }];
          case 'publicBrowser.importChromeAccount':
            if (name === 'Import Failed')
              throw new Error('Chrome authorization or cookie reading timed out.');
            return new Promise(() => {});
          default:
            throw new Error(`Unexpected story IPC: ${channel}`);
        }
      },
    } as never;
    return () => {
      window.ipc = previous;
    };
  },
} satisfies Meta<typeof BrowserAccountsSetting>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
export const AwaitingAuthorization: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', { name: /Import from Chrome|从 Chrome 导入/ })
    );
    await canvas.findByRole('status');
  },
};
export const ImportFailed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', { name: /Import from Chrome|从 Chrome 导入/ })
    );
    await canvas.findByRole('alert');
  },
};
