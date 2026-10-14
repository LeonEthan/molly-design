// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrowserAccountsSetting } from '../src/components/settings/browser-accounts-setting';
import { initI18n } from '../src/i18n';
import zh from '../../../locales/zh_CN.json';
import type {
  ElectronBrowserAccountImportInput,
  ElectronBrowserImportResult,
  ElectronBrowserProfileChoice,
  ElectronBrowserProfilesResult,
} from '@molly/shared/electron-ipc';

const bridge = vi.hoisted(() => ({
  getAccountSummary: vi.fn(),
  getImportSources: vi.fn(),
  getImportProfiles: vi.fn(),
  importBrowserAccount: vi.fn(),
  cancelAccountImport: vi.fn(),
  clearAccountData: vi.fn(),
}));
vi.mock('../src/lib/electron-ipc-client', () => ({
  getPublicBrowserBridge: () => bridge,
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const result: ElectronBrowserImportResult = {
  ok: true,
  report: {
    sites: [
      { siteId: 'pinterest', discovered: 10, imported: 7, skipped: 2, failed: 1 },
      { siteId: 'amazon', discovered: 0, imported: 0, skipped: 0, failed: 0 },
    ],
  },
};
const one: ElectronBrowserProfileChoice[] = [
  { id: 'opaque-default', name: 'Designer', isDefault: true },
];
const several: ElectronBrowserProfileChoice[] = [
  { id: 'opaque-default', name: 'Designer', isDefault: true },
  { id: 'opaque-studio', name: 'Studio', isDefault: false },
  { id: 'opaque-work', name: 'Work', isDefault: false },
];
const listed = (profiles: ElectronBrowserProfileChoice[]): ElectronBrowserProfilesResult => ({
  ok: true,
  profiles,
});
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
const button = (label: string) => {
  const found = [...document.querySelectorAll('button')].find(
    (entry) => entry.textContent === label
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
};
const dialog = () => document.querySelector('[role="dialog"]')!;
const picker = (labelId: 'browser-import-source-label' | 'browser-import-profile-label') =>
  document.querySelector<HTMLButtonElement>(`[role="combobox"][aria-labelledby="${labelId}"]`)!;
async function openImport() {
  await act(async () => button(zh['settings.browserAccounts.importFromBrowser']).click());
}
async function expandSites() {
  const trigger = [...document.querySelectorAll('button')].find((entry) =>
    entry.textContent?.startsWith(zh['settings.browserImport.websites'])
  );
  if (!trigger) throw new Error('Missing website disclosure');
  await act(async () => trigger.click());
}
async function choose(
  labelId: 'browser-import-source-label' | 'browser-import-profile-label',
  label: string
) {
  const trigger = picker(labelId);
  if (!trigger) throw new Error(`Missing picker: ${labelId}`);
  await act(async () => {
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (entry) => entry.textContent === label
  );
  if (!option) throw new Error(`Missing option: ${label}`);
  await act(async () => {
    option.focus();
    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLElement.prototype.scrollIntoView = () => undefined;
  await initI18n('zh_CN');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  bridge.getAccountSummary.mockResolvedValue({ importAvailable: true, sites: [] });
  bridge.getImportSources.mockResolvedValue({
    sources: [
      { browserId: 'chrome', browserName: 'Google Chrome' },
      { browserId: 'edge', browserName: 'Microsoft Edge' },
    ],
  });
  bridge.getImportProfiles.mockResolvedValue(listed(one));
  bridge.importBrowserAccount.mockResolvedValue(result);
  bridge.cancelAccountImport.mockResolvedValue('cancelled');
  bridge.clearAccountData.mockResolvedValue({ removed: 7 });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  localStorage.clear();
});

it('lists the real profiles when the dialog opens and reads no cookies until one is picked', async () => {
  const order: string[] = [];
  const received: ElectronBrowserAccountImportInput[] = [];
  bridge.getImportProfiles.mockImplementation(async (browserId: string, operationId: string) => {
    order.push(`list:${browserId}`);
    expect(operationId).toMatch(/^[a-f0-9-]{36}$/);
    return listed(several);
  });
  bridge.importBrowserAccount.mockImplementation(
    async (input: ElectronBrowserAccountImportInput) => {
      order.push('import');
      received.push(input);
      return result;
    }
  );
  await act(async () => root.render(<BrowserAccountsSetting />));
  expect(order).toEqual([]);
  await openImport();
  expect(order).toEqual(['list:chrome']);
  expect(picker('browser-import-profile-label').textContent).toBe(
    zh['settings.browserImport.chooseProfile']
  );
  expect(button(zh['settings.browserImport.import']).disabled).toBe(true);
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(bridge.importBrowserAccount).not.toHaveBeenCalled();
  await choose('browser-import-profile-label', 'Studio');
  expect(button(zh['settings.browserImport.import']).disabled).toBe(false);
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(order).toEqual(['list:chrome', 'import']);
  expect(received[0]).toMatchObject({
    browserId: 'chrome',
    profileId: 'opaque-studio',
    siteIds: expect.arrayContaining(['pinterest']),
  });
  expect(received[0].siteIds).toHaveLength(27);
  expect(received[0].operationId).toMatch(/^[a-f0-9-]{36}$/);
});

it('shows a single profile by name and still waits for the explicit Import click', async () => {
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(picker('browser-import-profile-label').textContent).toBe('Designer');
  expect(bridge.importBrowserAccount).not.toHaveBeenCalled();
  expect(button(zh['settings.browserImport.import']).disabled).toBe(false);
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(bridge.importBrowserAccount.mock.calls[0][0]).toMatchObject({
    browserId: 'chrome',
    profileId: 'opaque-default',
  });
});

it('lists the profiles of another browser only after it is chosen', async () => {
  const listings: string[] = [];
  bridge.getImportProfiles.mockImplementation(async (browserId: string) => {
    listings.push(browserId);
    return listed(browserId === 'edge' ? [{ id: 'edge-one', name: 'Edge person', isDefault: true }] : several);
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(listings).toEqual(['chrome']);
  await choose('browser-import-source-label', 'Microsoft Edge');
  expect(listings).toEqual(['chrome', 'edge']);
  expect(picker('browser-import-profile-label').textContent).toBe('Edge person');
});

it('preserves the curated website selection and keeps the catalog free of explanatory essays', async () => {
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(dialog().textContent).toContain('27 / 27');
  expect(dialog().querySelectorAll('[role="checkbox"]').length).toBe(0);
  await expandSites();
  expect(dialog().textContent).toContain('Amazon');
  expect(dialog().textContent).toContain('Shopify');
  expect(dialog().textContent).toContain('Figma');
  const checkboxes = [...dialog().querySelectorAll<HTMLElement>('[role="checkbox"]')];
  expect(checkboxes.length).toBe(28);
  expect(checkboxes.every((entry) => entry.getAttribute('data-state') === 'checked')).toBe(true);
  await act(async () => checkboxes[0].click());
  expect(button(zh['settings.browserImport.import']).disabled).toBe(true);
  await act(async () => checkboxes[1].click());
  expect(button(zh['settings.browserImport.import']).disabled).toBe(false);
  expect(dialog().querySelectorAll('p').length).toBe(0);
  await act(async () => button(zh['common.cancel']).click());
  await openImport();
  expect(dialog().textContent).toContain('27 / 27');
});

it('reports discovered, imported, skipped and failed for every selected site and nothing else', async () => {
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  await act(async () => button(zh['settings.browserImport.import']).click());
  const rows = [...dialog().querySelectorAll<HTMLElement>('tbody tr')];
  expect(
    [...dialog().querySelectorAll('thead th')].map((entry) => entry.textContent)
  ).toEqual([
    zh['settings.browserImport.websites'],
    zh['settings.browserImport.columns.discovered'],
    zh['settings.browserImport.columns.imported'],
    zh['settings.browserImport.columns.skipped'],
    zh['settings.browserImport.columns.failed'],
  ]);
  expect(rows.map((row) => [...row.children].map((cell) => cell.textContent))).toEqual([
    ['Pinterest', '10', '7', '2', '1'],
    ['Amazon', '0', '0', '0', '0'],
  ]);
  expect(dialog().querySelectorAll('[role="checkbox"]').length).toBe(0);
  expect(dialog().querySelectorAll('p').length).toBe(0);
  expect(button(zh['settings.browserImport.done']).disabled).toBe(false);
  await act(async () => button(zh['settings.browserImport.done']).click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('keeps Website accounts to one short line, Import, Clear and a per-site status list', async () => {
  bridge.getAccountSummary.mockResolvedValue({
    importAvailable: true,
    sites: [
      { siteId: 'pinterest', cookieCount: 14 },
      { siteId: 'figma', cookieCount: 0 },
      { siteId: 'amazon', cookieCount: 3 },
    ],
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  expect(host.querySelectorAll('p').length).toBe(1);
  expect(host.querySelector('p')?.textContent).toBe(
    zh['settings.browserImport.settingsDescription']
  );
  expect([...host.querySelectorAll('button')].map((entry) => entry.textContent)).toEqual([
    zh['settings.browserAccounts.importFromBrowser'],
    zh['settings.browserImport.clear'],
  ]);
  expect([...host.querySelectorAll('li')].map((entry) => entry.textContent)).toEqual([
    `Pinterest${zh['settings.browserImport.siteCookies'].replace('{{count}}', '14')}`,
    `Amazon${zh['settings.browserImport.siteCookies'].replace('{{count}}', '3')}`,
  ]);
  expect(host.textContent).not.toContain('17');
});

it('revokes a reading operation on close and ignores its late result', async () => {
  const pending = Promise.withResolvers<ElectronBrowserImportResult>();
  const cancelled: string[] = [];
  bridge.importBrowserAccount.mockReturnValue(pending.promise);
  bridge.cancelAccountImport.mockImplementation(async (id: string) => {
    cancelled.push(id);
    return 'cancelled';
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    zh['settings.browserImport.importing']
  );
  await act(async () => button(zh['common.cancel']).click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(cancelled[0]).toMatch(/^[a-f0-9-]{36}$/);
  await openImport();
  await act(async () => pending.resolve(result));
  expect(dialog().querySelectorAll('tbody tr').length).toBe(0);
  expect(button(zh['settings.browserImport.import']).disabled).toBe(false);
});

it('revokes a pending profile listing when the dialog closes', async () => {
  const pending = Promise.withResolvers<ElectronBrowserProfilesResult>();
  const listing: string[] = [];
  bridge.getImportProfiles.mockImplementation(async (_browserId: string, id: string) => {
    listing.push(id);
    return pending.promise;
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(picker('browser-import-profile-label').textContent).toBe(
    zh['settings.browserImport.loading']
  );
  expect(button(zh['settings.browserImport.import']).disabled).toBe(true);
  await act(async () => button(zh['common.cancel']).click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(bridge.cancelAccountImport).toHaveBeenCalledWith(listing[0]);
  await act(async () => pending.resolve(listed(several)));
});

it('keeps the dialog open while an accepted write is finishing', async () => {
  const pending = Promise.withResolvers<ElectronBrowserImportResult>();
  bridge.importBrowserAccount.mockReturnValue(pending.promise);
  bridge.cancelAccountImport.mockResolvedValue('finishing');
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  await act(async () => button(zh['settings.browserImport.import']).click());
  await act(async () => button(zh['common.cancel']).click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    zh['settings.browserImport.finishing']
  );
  await act(async () => pending.resolve(result));
  expect(button(zh['settings.browserImport.done']).disabled).toBe(false);
});

it('closes after the write settles before a delayed cancellation receipt', async () => {
  const pendingImport = Promise.withResolvers<ElectronBrowserImportResult>();
  const pendingCancellation = Promise.withResolvers<'finishing'>();
  bridge.importBrowserAccount.mockReturnValue(pendingImport.promise);
  bridge.cancelAccountImport.mockReturnValue(pendingCancellation.promise);
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  await act(async () => button(zh['settings.browserImport.import']).click());
  await act(async () => button(zh['common.cancel']).click());
  await act(async () => pendingImport.resolve(result));
  expect(button(zh['settings.browserImport.done']).disabled).toBe(false);
  await act(async () => pendingCancellation.resolve('finishing'));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('shows a localized failure and supports explicit retry without another confirmation step', async () => {
  bridge.importBrowserAccount.mockResolvedValue({ ok: false, error: 'write-restored' });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    zh['settings.browserImport.errors.write-restored']
  );
  expect(button(zh['settings.browserImport.retry']).disabled).toBe(false);
  bridge.importBrowserAccount.mockResolvedValue(result);
  await act(async () => button(zh['settings.browserImport.retry']).click());
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(button(zh['settings.browserImport.done'])).toBeTruthy();
});

it('keeps unsupported builds honest', async () => {
  bridge.getAccountSummary.mockResolvedValue({
    importAvailable: false,
    importUnavailableReason: 'signing-required',
    sites: [],
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(button(zh['settings.browserImport.import']).disabled).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    zh['settings.browserAccounts.importUnavailableReasons.signing-required']
  );
  expect(bridge.getImportSources).not.toHaveBeenCalled();
  expect(bridge.getImportProfiles).not.toHaveBeenCalled();
});

it('stays silent after an OS denial of the listing and offers no recovery guidance', async () => {
  bridge.getImportProfiles.mockResolvedValue({ ok: false, error: 'source-access-denied' });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(dialog().querySelector('[role="alert"]')).toBeNull();
  expect(dialog().querySelector('a, img, video')).toBeNull();
  expect(picker('browser-import-profile-label').textContent).toBe(
    zh['settings.browserImport.noProfiles']
  );
  expect(bridge.importBrowserAccount).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('private');
});

it('re-enumerates after the user allows access, on focus or an explicit Import click', async () => {
  bridge.getImportProfiles.mockResolvedValue({ ok: false, error: 'source-access-denied' });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(bridge.getImportProfiles).toHaveBeenCalledTimes(1);
  bridge.getImportProfiles.mockResolvedValue(listed(several));
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(bridge.getImportProfiles).toHaveBeenCalledTimes(2);
  expect(picker('browser-import-profile-label').textContent).toBe(
    zh['settings.browserImport.chooseProfile']
  );
  expect(bridge.importBrowserAccount).not.toHaveBeenCalled();
  await act(async () => button(zh['common.cancel']).click());

  bridge.getImportProfiles.mockResolvedValue({ ok: false, error: 'source-access-denied' });
  await openImport();
  bridge.getImportProfiles.mockResolvedValue(listed(one));
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(bridge.importBrowserAccount).not.toHaveBeenCalled();
  expect(picker('browser-import-profile-label').textContent).toBe('Designer');
});

it('requires a new explicit choice when the selected profile changed before reading', async () => {
  bridge.getImportProfiles.mockResolvedValue(listed(several));
  bridge.importBrowserAccount.mockResolvedValueOnce({ ok: false, error: 'profile-changed' });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  await choose('browser-import-profile-label', 'Studio');
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    zh['settings.browserImport.errors.profile-changed']
  );
  expect(bridge.getImportProfiles).toHaveBeenCalledTimes(2);
  expect(picker('browser-import-profile-label').textContent).toBe(
    zh['settings.browserImport.chooseProfile']
  );
  await choose('browser-import-profile-label', 'Work');
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(bridge.importBrowserAccount.mock.calls.map(([input]) => input.profileId)).toEqual([
    'opaque-studio',
    'opaque-work',
  ]);
  expect(button(zh['settings.browserImport.done'])).toBeTruthy();
});

it.each(['source-unavailable', 'source-incomplete', 'source-authorization-denied'] as const)(
  'shows the localized reason for %s from a cookie read',
  async (error) => {
    bridge.importBrowserAccount.mockResolvedValue({ ok: false, error });
    await act(async () => root.render(<BrowserAccountsSetting />));
    await openImport();
    await act(async () => button(zh['settings.browserImport.import']).click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      zh[`settings.browserImport.errors.${error}`]
    );
    expect(button(zh['settings.browserImport.retry']).disabled).toBe(false);
  }
);

it('shows an unreadable listing reason and retries it only on click', async () => {
  bridge.getImportProfiles.mockResolvedValue({ ok: false, error: 'source-unavailable' });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    zh['settings.browserImport.errors.source-unavailable']
  );
  expect(bridge.getImportProfiles).toHaveBeenCalledTimes(1);
  bridge.getImportProfiles.mockResolvedValue(listed(one));
  await act(async () => button(zh['settings.browserImport.retry']).click());
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(picker('browser-import-profile-label').textContent).toBe('Designer');
  expect(bridge.importBrowserAccount).not.toHaveBeenCalled();
});

it('distinguishes no installed browsers from a failed catalog read and retries only on click', async () => {
  bridge.getImportSources.mockRejectedValue(new Error('Synthetic catalog failure'));
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    zh['settings.browserImport.errors.unavailable']
  );
  bridge.getImportSources.mockResolvedValue({ sources: [] });
  await act(async () => button(zh['settings.browserImport.retry']).click());
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(picker('browser-import-profile-label').textContent).toBe(
    zh['settings.browserImport.noProfiles']
  );
  expect(bridge.getImportProfiles).not.toHaveBeenCalled();
  expect(button(zh['settings.browserImport.import']).disabled).toBe(true);
});

it('clears all Molly website data only after the explicit clear confirmation', async () => {
  const events: string[] = [];
  vi.spyOn(window, 'confirm').mockImplementation(() => {
    events.push('confirmed');
    return true;
  });
  bridge.clearAccountData.mockImplementation(async () => {
    events.push('all-data-cleared');
    return { removed: 7 };
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await act(async () => button(zh['settings.browserImport.clear']).click());
  expect(events).toEqual(['confirmed', 'all-data-cleared']);
  expect(host.querySelector('[role="status"]')?.textContent).toBe(
    zh['settings.browserImport.cleared']
  );
});
