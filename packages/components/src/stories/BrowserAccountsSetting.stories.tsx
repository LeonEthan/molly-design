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
              importAvailable: name !== 'Unsigned Package',
              ...(name === 'Unsigned Package'
                ? { importUnavailableReason: 'signing-required' }
                : {}),
              sites: [
                { siteId: 'pinterest', cookieCount: 14 },
                { siteId: 'amazon', cookieCount: 26 },
              ],
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
          case 'publicBrowser.getImportProfiles':
            if (name === 'Profile Access Denied') return { ok: false, error: 'source-access-denied' };
            if (name === 'Unreadable Profiles') return { ok: false, error: 'source-unavailable' };
            if (name === 'Listing Profiles') return new Promise(() => {});
            return {
              ok: true,
              profiles:
                ['Single Profile', 'Importing', 'Keychain Access Denied', 'Import Failed'].includes(name)
                  ? [{ id: 'opaque-default', name: 'Designer', isDefault: true }]
                  : [
                      { id: 'opaque-default', name: 'Designer', isDefault: true },
                      { id: 'opaque-studio', name: 'Studio', isDefault: false },
                      { id: 'opaque-work', name: 'Work', isDefault: false },
                    ],
            };
          case 'publicBrowser.importBrowserAccount':
            if (name === 'Import Failed') return { ok: false, error: 'write-restored' };
            if (name === 'Importing') return new Promise(() => {});
            if (name === 'Keychain Access Denied')
              return { ok: false, error: 'source-authorization-denied' };
            return {
              ok: true,
              report: {
                sites: [
                  { siteId: 'pinterest', discovered: 17, imported: 14, skipped: 2, failed: 1 },
                  { siteId: 'amazon', discovered: 26, imported: 26, skipped: 0, failed: 0 },
                  { siteId: 'figma', discovered: 0, imported: 0, skipped: 0, failed: 0 },
                ],
              },
            };
          case 'publicBrowser.cancelAccountImport':
            return 'cancelled';
          case 'publicBrowser.clearAccountData':
            return { removed: 14 };
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
const imported: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openImport(canvasElement);
    await userEvent.click(await dialog.findByRole('combobox', { name: /Profile|用户配置/ }));
    await userEvent.click(await within(document.body).findByRole('option', { name: 'Studio' }));
    await userEvent.click(await dialog.findByRole('button', { name: /^(Import|导入)$/ }));
  },
};
const importSingle: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openImport(canvasElement);
    await dialog.findByText('Designer');
    await userEvent.click(await dialog.findByRole('button', { name: /^(Import|导入)$/ }));
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
export const ListingProfiles: Story = opened;
export const SingleProfile: Story = importSingle;
export const ChooseProfile: Story = opened;
export const ProfileAccessDenied: Story = opened;
export const Importing: Story = importSingle;
export const KeychainAccessDenied: Story = importSingle;
export const ImportFailed: Story = importSingle;
export const Imported: Story = imported;
export const UnsignedPackage: Story = opened;
export const NoBrowsers: Story = opened;
export const UnreadableProfiles: Story = opened;
