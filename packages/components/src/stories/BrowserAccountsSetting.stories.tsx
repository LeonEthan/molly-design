import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within } from 'storybook/test';
import { BrowserAccountsSetting } from '@/components/settings/browser-accounts-setting';

const meta = {
  title: 'Settings/BrowserAccounts',
  component: BrowserAccountsSetting,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[520px]">
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
            return name === 'Development Build'
              ? {
                  persistent: false,
                  importAvailable: false,
                  importUnavailableReason: 'package-required',
                  sites: [{ site: 'pinterest.com', cookieCount: 0 }],
                }
              : {
                  persistent: true,
                  importAvailable: true,
                  sites: [
                    { site: 'pinterest.com', cookieCount: name === 'Cookies Saved' ? 14 : 0 },
                  ],
                };
          case 'publicBrowser.getImportSources':
            return {
              sources: [
                {
                  browserId: 'chrome',
                  browserName: 'Google Chrome',
                  profiles: [
                    { id: 'Default', name: 'Designer', isDefault: true },
                    { id: 'Profile 1', name: 'Studio', isDefault: false },
                  ],
                },
                {
                  browserId: 'arc',
                  browserName: 'Arc',
                  profiles: [{ id: 'Default', name: 'Moodboards', isDefault: true }],
                },
              ],
              unreadable: name === 'Unreadable Browser' ? ['Microsoft Edge'] : [],
            };
          case 'publicBrowser.importBrowserAccount':
            if (name === 'Import Failed')
              throw new Error('Browser authorization or cookie reading timed out.');
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
      await canvas.findByRole('button', { name: /Import from Google Chrome|从 Google Chrome 导入/ })
    );
    await canvas.findByRole('status');
  },
};
export const ImportFailed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', { name: /Import from Google Chrome|从 Google Chrome 导入/ })
    );
    await canvas.findByRole('alert');
  },
};
export const CookiesSaved: Story = {};
export const DevelopmentBuild: Story = {};
export const UnreadableBrowser: Story = {};
