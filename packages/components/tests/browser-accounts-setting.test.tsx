// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ElectronBrowserAccountSiteInputSchema } from '@molly/shared/electron-ipc';
import { BrowserAccountsSetting } from '../src/components/settings/browser-accounts-setting';
import { initI18n } from '../src/i18n';
import zh from '../../../locales/zh_CN.json';

const bridge = vi.hoisted(() => ({
  getAccountSummary: vi.fn(),
  getImportSources: vi.fn(),
  importBrowserAccount: vi.fn(),
  openBrowserDataPrivacySettings: vi.fn(),
  destroy: vi.fn(),
  beginAccountSignIn: vi.fn(),
}));
vi.mock('../src/lib/electron-ipc-client', () => ({ getPublicBrowserBridge: () => bridge }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await initI18n('zh_CN');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  bridge.openBrowserDataPrivacySettings.mockResolvedValue({ opened: true, platform: 'darwin' });
});
const buttonWithText = (text: string) =>
  [...document.querySelectorAll('button')].find((button) => button.textContent === text);

async function openImport() {
  const toggle = buttonWithText(
    zh['settings.browserAccounts.importToggle'].replace('{{site}}', 'Pinterest')
  );
  if (!toggle) throw new Error('Missing import toggle');
  await act(async () => toggle.click());
}

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('enables memory-only development import with pending authorization and explicit retry', async () => {
  let cookieCount = 0;
  let request = Promise.withResolvers<{ imported: number }>();
  bridge.getAccountSummary.mockImplementation(async () => ({
    persistent: false,
    importAvailable: true,
    sites: ElectronBrowserAccountSiteInputSchema.shape.site.options.map((site) => ({
      site,
      cookieCount,
    })),
  }));
  bridge.getImportSources.mockResolvedValue({
    sources: [
      {
        browserId: 'chrome',
        browserName: 'Google Chrome',
        profiles: [{ id: 'synthetic', name: 'Test profile', isDefault: true }],
      },
    ],
    unreadable: [],
  });
  bridge.importBrowserAccount.mockImplementation(() => request.promise);
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(host.textContent).toContain('Pinterest');
  expect(host.textContent).not.toContain('Amazon');
  expect(ElectronBrowserAccountSiteInputSchema.safeParse({ site: 'amazon.com' }).success).toBe(
    false
  );
  const importButton = Array.from(host.querySelectorAll('button')).find(
    (button) =>
      button.textContent ===
      zh['settings.browserAccounts.importFrom'].replace('{{browser}}', 'Google Chrome')
  );
  if (!importButton) throw new Error('Missing import action');
  expect(importButton.disabled).toBe(false);
  expect(host.textContent).toContain(zh['settings.browserAccounts.developmentMemory']);
  await act(async () => importButton.click());
  expect(importButton.disabled).toBe(true);
  expect(importButton.textContent).toBe(zh['settings.browserAccounts.importing']);
  expect(host.querySelector('[role="status"]')?.textContent).toBe(
    zh['settings.browserAccounts.authorizationHint']
  );
  await act(async () => request.reject(new Error('Synthetic authorization timeout')));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    zh['settings.browserAccounts.retryHint']
  );
  expect(importButton.disabled).toBe(false);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Google Chrome');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Test profile');
  expect(host.querySelector('[role="status"]')).toBeNull();

  request = Promise.withResolvers();
  await act(async () => importButton.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(importButton.disabled).toBe(true);
  cookieCount = 5;
  await act(async () => request.resolve({ imported: cookieCount }));
  expect(host.querySelector('[role="status"]')?.textContent).toBe(
    zh['settings.browserAccounts.imported'].replace('{{total}}', '5')
  );
  expect(importButton.disabled).toBe(false);
});

it('keeps a visible disabled import button for unsigned macOS packages', async () => {
  bridge.getAccountSummary.mockResolvedValue({
    persistent: false,
    importAvailable: false,
    importUnavailableReason: 'signing-required',
    sites: [{ site: 'pinterest.com', cookieCount: 0 }],
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  const importButton = Array.from(host.querySelectorAll('button')).find(
    (button) => button.textContent === zh['settings.browserAccounts.importFromBrowser']
  );
  expect(importButton?.disabled).toBe(true);
  expect(host.textContent).toContain(
    zh['settings.browserAccounts.importUnavailableReasons.signing-required']
  );
});

it('distinguishes unreadable profiles from absent sources and restores import after manual refresh', async () => {
  let accessible = false;
  const imports: unknown[][] = [];
  const privacyOpened = Promise.withResolvers<void>();
  const privacyRequests: string[] = [];
  bridge.openBrowserDataPrivacySettings.mockImplementation(async () => {
    privacyRequests.push('settings');
    await privacyOpened.promise;
    return { opened: true, platform: 'darwin' };
  });
  bridge.getAccountSummary.mockResolvedValue({
    persistent: false,
    importAvailable: true,
    sites: [{ site: 'pinterest.com', cookieCount: 0 }],
  });
  bridge.getImportSources.mockImplementation(async () => ({
    sources: accessible
      ? [
          {
            browserId: 'chrome',
            browserName: 'Google Chrome',
            profiles: [{ id: 'Default', name: 'Synthetic profile', isDefault: true }],
          },
        ]
      : [],
    unreadable: accessible ? [] : ['Google Chrome'],
  }));
  bridge.importBrowserAccount.mockImplementation(async (...args: unknown[]) => {
    imports.push(args);
    return { imported: 1 };
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(host.textContent).not.toContain(zh['settings.browserAccounts.noSources']);
  expect(host.textContent).toContain(
    zh['settings.browserAccounts.unreadableSources'].replace('{{browsers}}', 'Google Chrome')
  );
  const privacyButton = buttonWithText(zh['settings.browserAccounts.openFilesAndFolders']);
  if (!privacyButton) throw new Error('Missing privacy recovery');
  expect(privacyButton.disabled).toBe(false);
  await act(async () => privacyButton.click());
  expect(privacyRequests).toEqual(['settings']);
  expect(privacyButton.disabled).toBe(true);
  expect(imports).toEqual([]);
  await act(async () => privacyOpened.resolve());
  expect(privacyButton.disabled).toBe(false);
  expect(
    Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === zh['settings.browserAccounts.importFromBrowser']
    )?.disabled
  ).toBe(true);

  accessible = true;
  const refresh = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${zh['settings.browserAccounts.refresh']}"]`
  );
  if (!refresh) throw new Error('Missing refresh action');
  await act(async () => refresh.click());
  const importButton = Array.from(host.querySelectorAll('button')).find(
    (button) =>
      button.textContent ===
      zh['settings.browserAccounts.importFrom'].replace('{{browser}}', 'Google Chrome')
  );
  expect(importButton?.disabled).toBe(false);
  expect(host.textContent).toContain('Synthetic profile');
  expect(host.textContent).toContain(zh['settings.browserAccounts.developmentMemory']);
  expect(host.textContent).not.toContain(zh['settings.browserAccounts.noSources']);
  expect(imports).toEqual([]);
  expect(buttonWithText(zh['settings.browserAccounts.openFilesAndFolders'])).toBeUndefined();
});

it('reports absent sources only after a completed readable empty listing', async () => {
  bridge.getAccountSummary.mockResolvedValue({
    persistent: false,
    importAvailable: true,
    sites: [{ site: 'pinterest.com', cookieCount: 0 }],
  });
  bridge.getImportSources.mockResolvedValue({ sources: [], unreadable: [] });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(host.textContent).toContain(zh['settings.browserAccounts.noSources']);
  expect(host.querySelector('[role="combobox"]')).toBeNull();
});

it('imports from the browser profile Molly found, naming any it could not read', async () => {
  const requests: unknown[][] = [];
  const recovery: string[] = [];
  bridge.openBrowserDataPrivacySettings.mockImplementation(async () => {
    recovery.push('settings');
    return { opened: true, platform: 'darwin' };
  });
  bridge.getAccountSummary.mockResolvedValue({
    persistent: true,
    importAvailable: true,
    sites: [{ site: 'pinterest.com', cookieCount: 0 }],
  });
  bridge.getImportSources.mockResolvedValue({
    sources: [
      {
        browserId: 'arc',
        browserName: 'Arc',
        profiles: [{ id: 'Default', name: 'Studio', isDefault: true }],
      },
    ],
    unreadable: ['Microsoft Edge'],
  });
  bridge.importBrowserAccount.mockImplementation(async (...args: unknown[]) => {
    requests.push(args);
    return { imported: 3 };
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(host.textContent).not.toContain('Microsoft Edge');
  const privacyButton = buttonWithText(zh['settings.browserAccounts.openFilesAndFolders']);
  if (!privacyButton) throw new Error('Missing privacy recovery for other browsers');
  expect(privacyButton.disabled).toBe(false);
  await act(async () => privacyButton.click());
  expect(recovery).toEqual(['settings']);
  expect(requests).toEqual([]);
  const details = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === zh['settings.browserAccounts.otherSourceIssues']
  )!;
  await act(async () => details.click());
  expect(host.textContent).toContain(
    zh['settings.browserAccounts.unreadableSources'].replace('{{browsers}}', 'Microsoft Edge')
  );
  await act(async () => details.click());
  expect(host.textContent).not.toContain('Microsoft Edge');
  const importButton = Array.from(host.querySelectorAll('button')).find(
    (button) =>
      button.textContent === zh['settings.browserAccounts.importFrom'].replace('{{browser}}', 'Arc')
  );
  await act(async () => importButton?.click());
  expect(requests).toEqual([['arc', 'Default', 'pinterest.com', false]]);
});

it('opens privacy settings after a failed re-list and reports a failed settings launch', async () => {
  const events: string[] = [];
  bridge.getAccountSummary.mockResolvedValue({
    persistent: true,
    importAvailable: true,
    sites: [{ site: 'pinterest.com', cookieCount: 0 }],
  });
  bridge.getImportSources.mockResolvedValue({ sources: [], unreadable: ['Google Chrome'] });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  bridge.getImportSources.mockImplementation(async () => {
    events.push('listing rejected');
    throw new Error('Synthetic profile access denied');
  });
  bridge.openBrowserDataPrivacySettings.mockImplementation(async () => {
    events.push('settings rejected');
    return { opened: false, platform: 'darwin', error: 'Synthetic settings launch failure' };
  });
  const privacyButton = buttonWithText(zh['settings.browserAccounts.openFilesAndFolders']);
  if (!privacyButton) throw new Error('Missing privacy recovery');
  await act(async () => privacyButton.click());
  expect(events).toEqual(['listing rejected', 'settings rejected']);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    'Synthetic settings launch failure'
  );
  expect(privacyButton.disabled).toBe(false);
});

it('leads with sign-in inside Molly and leaves other browsers unread until import opens', async () => {
  const listings: unknown[] = [];
  const destroyed: unknown[] = [];
  bridge.getAccountSummary.mockResolvedValue({
    persistent: true,
    importAvailable: true,
    sites: [{ site: 'pinterest.com', cookieCount: 0 }],
  });
  bridge.getImportSources.mockImplementation(async () => {
    listings.push('listed');
    return { sources: [], unreadable: ['Google Chrome'] };
  });
  bridge.destroy.mockImplementation(async (browserId: string) => {
    destroyed.push(browserId);
    return { ok: true };
  });
  const pause = Promise.withResolvers<{ ok: true }>();
  bridge.beginAccountSignIn.mockImplementation(() => pause.promise);
  await act(async () => root.render(<BrowserAccountsSetting />));
  expect(listings).toEqual([]);
  expect(host.textContent).not.toContain('Google Chrome');

  const signIn = buttonWithText(
    zh['settings.browserAccounts.signIn'].replace('{{site}}', 'Pinterest')
  );
  if (!signIn) throw new Error('Missing sign-in action');
  await act(async () => signIn.click());
  expect(document.querySelector('[role="dialog"] [role="status"]')?.textContent).toBe(
    zh['settings.browserAccounts.signInPausing']
  );
  expect(bridge.beginAccountSignIn).toHaveBeenCalledWith('website-sign-in-pinterest.com');
  await act(async () => pause.resolve({ ok: true }));
  expect(document.querySelector('[role="dialog"] [role="status"]')).toBeNull();
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain(
    zh['settings.browserAccounts.signInTitle'].replace('{{site}}', 'Pinterest')
  );
  expect(dialog?.textContent).toContain(
    zh['settings.browserAccounts.signInGoogleHint'].replaceAll('{{site}}', 'Pinterest')
  );
  await act(async () => buttonWithText(zh['settings.browserAccounts.signInDone'])?.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(destroyed).toEqual(['website-sign-in-pinterest.com']);
  expect(listings).toEqual([]);

  await openImport();
  expect(listings).toEqual(['listed']);
  expect(host.textContent).toContain(
    zh['settings.browserAccounts.unreadableSources'].replace('{{browsers}}', 'Google Chrome')
  );
});

it('keeps the sign-in page closed when Agent browsing cannot be paused', async () => {
  bridge.getAccountSummary.mockResolvedValue({
    persistent: true,
    importAvailable: true,
    sites: [{ site: 'pinterest.com', cookieCount: 0 }],
  });
  bridge.beginAccountSignIn.mockRejectedValue(new Error('Synthetic pause failure'));
  bridge.destroy.mockResolvedValue({ ok: true });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await act(async () => root.render(<BrowserAccountsSetting />));
  await act(async () =>
    buttonWithText(zh['settings.browserAccounts.signIn'].replace('{{site}}', 'Pinterest'))?.click()
  );
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe(
    zh['settings.browserAccounts.signInPauseFailed']
  );
  expect(document.querySelector('[role="dialog"] [role="status"]')).toBeNull();
});
