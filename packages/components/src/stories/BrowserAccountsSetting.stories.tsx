import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within } from 'storybook/test';
import { BrowserAccountsSetting } from '@/components/settings/browser-accounts-setting';

const meta = {
  title: 'Settings/BrowserAccounts',
  component: BrowserAccountsSetting,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[min(520px,calc(100vw-32px))]">
        <Story />
      </div>
    ),
  ],
  beforeEach: ({ name }) => {
    const previous = window.ipc;
    window.ipc = {
      on: () => () => undefined,
      invoke: async (channel: string) => {
        switch (channel) {
          case 'publicBrowser.getAccountSummary':
            return {
              persistent: ![
                'Development Build',
                'Unsigned Package',
                'Unreadable Profiles',
              ].includes(name),
              importAvailable: name !== 'Unsigned Package',
              ...(name === 'Unsigned Package'
                ? { importUnavailableReason: 'signing-required' }
                : {}),
              sites: [{ site: 'pinterest.com', cookieCount: name === 'Cookies Saved' ? 14 : 0 }],
            };
          case 'publicBrowser.getImportSources':
            if (name === 'Unreadable Profiles')
              return { sources: [], unreadable: ['Google Chrome', 'Microsoft Edge', 'Brave'] };
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
          case 'publicBrowser.openBrowserDataPrivacySettings':
            return {
              opened: true,
              platform: 'darwin',
              target:
                'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders',
            };
          case 'publicBrowser.importBrowserAccount':
            if (name === 'Import Failed')
              throw new Error('Browser authorization or cookie reading timed out.');
            return new Promise(() => {});
          case 'publicBrowser.destroy':
          case 'publicBrowser.beginAccountSignIn':
            return { ok: true };
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

const openImport = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: /Import it|从浏览器导入/ }));
  return canvas;
};
const importOpen: Story = {
  play: async ({ canvasElement }) => void (await openImport(canvasElement)),
};

export const Ready: Story = {};
export const SignInDialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', { name: /^(Sign in to Pinterest|登录 Pinterest)$/ })
    );
  },
};
export const AwaitingAuthorization: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await openImport(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', { name: /Import from Google Chrome|从 Google Chrome 导入/ })
    );
    await canvas.findByRole('status');
  },
};
export const ImportFailed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await openImport(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', { name: /Import from Google Chrome|从 Google Chrome 导入/ })
    );
    await canvas.findByRole('alert');
  },
};
export const CookiesSaved: Story = {};
export const DevelopmentBuild: Story = {};
export const UnsignedPackage: Story = importOpen;
export const UnreadableBrowser: Story = importOpen;
export const UnreadableProfiles: Story = importOpen;
