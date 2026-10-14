import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within } from 'storybook/test';
import type { ElectronBrowserAccountImportInput } from '@molly/shared/electron-ipc';
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
      invoke: async (channel: string, input?: ElectronBrowserAccountImportInput) => {
        switch (channel) {
          case 'publicBrowser.getAccountSummary':
            return {
              persistent: name !== 'Development Build',
              importAvailable: name !== 'Unsigned Package',
              ...(name === 'Unsigned Package'
                ? { importUnavailableReason: 'signing-required' }
                : {}),
              cookieCount: 14,
              sites: [{ siteId: 'pinterest', cookieCount: 14 }],
            };
          case 'publicBrowser.getImportSources':
            return {
              sources:
                name === 'No Browsers'
                  ? []
                  : [
                      { browserId: 'chrome', browserName: 'Google Chrome' },
                      { browserId: 'edge', browserName: 'Microsoft Edge' },
                    ],
            };
          case 'publicBrowser.importBrowserAccount':
            if (name === 'Import Failed') return { ok: false, error: 'write-restored' };
            if (name === 'Importing With Authorization') return new Promise(() => {});
            if (name === 'File Access Denied') return { ok: false, error: 'source-access-denied' };
            if (name === 'Keychain Access Denied')
              return { ok: false, error: 'source-authorization-denied' };
            if (name === 'Unreadable Profiles') return { ok: false, error: 'source-unavailable' };
            if (name === 'Choose Profile' && !input?.profileId)
              return {
                ok: true,
                profiles: [
                  { id: 'opaque-default', name: 'Designer', isDefault: true },
                  { id: 'opaque-studio', name: 'Studio', isDefault: false },
                ],
              };
            return {
              ok: true,
              report: {
                imported: 40,
                skippedExpired: 2,
                skippedPartitioned: 1,
                sites: [
                  { siteId: 'pinterest', imported: 14, skippedExpired: 2, skippedPartitioned: 1 },
                  { siteId: 'amazon', imported: 26, skippedExpired: 0, skippedPartitioned: 0 },
                ],
              },
            };
          case 'publicBrowser.cancelAccountImport':
            return 'cancelled';
          case 'publicBrowser.clearAccountData':
            return { removed: 14 };
          case 'publicBrowser.openBrowserDataPrivacySettings':
            return { opened: true, platform: 'darwin' };
          case 'app.restartApp':
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
  await userEvent.click(
    await within(canvasElement).findByRole('button', { name: /Import from browser|从浏览器导入/ })
  );
  return within(await within(document.body).findByRole('dialog'));
};
const opened: Story = {
  play: async ({ canvasElement }) => {
    await openImport(canvasElement);
  },
};
const importing: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openImport(canvasElement);
    const button = await dialog.findByRole('button', { name: /^(Import|导入)$/ });
    await dialog.findByText('Google Chrome');
    await userEvent.click(button);
  },
};
export const Ready: Story = {};
export const ImportDialog: Story = opened;
export const ExpandedWebsites: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openImport(canvasElement);
    await userEvent.click(await dialog.findByRole('button', { name: /Websites|网站清单/ }));
  },
};
export const ImportingWithAuthorization: Story = importing;
export const ChooseProfile: Story = importing;
export const FileAccessDenied: Story = importing;
export const KeychainAccessDenied: Story = importing;
export const ImportFailed: Story = importing;
export const Imported: Story = importing;
export const DevelopmentBuild: Story = opened;
export const UnsignedPackage: Story = opened;
export const NoBrowsers: Story = opened;
export const UnreadableProfiles: Story = importing;
