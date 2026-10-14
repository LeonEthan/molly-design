// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BROWSER_ACCOUNT_SITE_IDS as BROWSER_SITE_IDS } from '@molly/shared/browser-account-sites';
import { BrowserAccountsSetting } from '../src/components/settings/browser-accounts-setting';
import { initI18n } from '../src/i18n';
import zh from '../../../locales/zh_CN.json';
import type {
  ElectronBrowserAccountImportInput,
  ElectronBrowserImportResult,
} from '@molly/shared/electron-ipc';

const bridge = vi.hoisted(() => ({
  getAccountSummary: vi.fn(),
  getImportSources: vi.fn(),
  getImportProfiles: vi.fn(),
  importBrowserAccount: vi.fn(),
  cancelAccountImport: vi.fn(),
  clearAccountData: vi.fn(),
  openBrowserDataPrivacySettings: vi.fn(),
}));
const app = vi.hoisted(() => ({ restartApp: vi.fn() }));
vi.mock('../src/lib/electron-ipc-client', () => ({
  getPublicBrowserBridge: () => bridge,
  getIpcServices: () => ({ app }),
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const result: ElectronBrowserImportResult = {
  ok: true,
  report: {
    imported: 7,
    skippedExpired: 2,
    skippedPartitioned: 1,
    sites: [{ siteId: 'pinterest', imported: 7, skippedExpired: 2, skippedPartitioned: 1 }],
  },
};
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
const button = (label: string) => {
  const found = [...document.querySelectorAll('button')].find(
    (entry) => entry.textContent === label
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
};
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

async function chooseSource(label: string) {
  const trigger = document.querySelector<HTMLElement>('[role="combobox"]');
  if (!trigger) throw new Error('Missing source picker');
  await act(async () => {
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (entry) => entry.textContent === label
  );
  if (!option) throw new Error(`Missing source: ${label}`);
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
  bridge.getAccountSummary.mockResolvedValue({
    persistent: true,
    importAvailable: true,
    cookieCount: 0,
    sites: [],
  });
  bridge.getImportSources.mockResolvedValue({
    sources: [
      { browserId: 'chrome', browserName: 'Google Chrome' },
      { browserId: 'edge', browserName: 'Microsoft Edge' },
    ],
  });
  bridge.getImportProfiles.mockResolvedValue([
    { id: 'opaque-default', name: 'Designer', isDefault: true },
  ]);
  bridge.importBrowserAccount.mockResolvedValue(result);
  bridge.cancelAccountImport.mockResolvedValue('cancelled');
  bridge.clearAccountData.mockResolvedValue({ removed: 7 });
  bridge.openBrowserDataPrivacySettings.mockResolvedValue({ opened: true });
  app.restartApp.mockResolvedValue({ ok: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('keeps Import available before reading profiles and preserves the curated website selection', async () => {
  const discovered: string[] = [];
  bridge.getImportProfiles.mockImplementation(async (browserId: string) => {
    discovered.push(browserId);
    return [{ id: 'opaque-default', name: 'Designer', isDefault: true }];
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  expect(discovered).toEqual([]);
  await openImport();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('Google Chrome');
  expect(dialog.textContent).not.toContain('Designer');
  expect(dialog.textContent).toContain('27 / 27');
  expect(dialog.querySelectorAll('[role="checkbox"]').length).toBe(0);
  expect(button(zh['settings.browserImport.import']).disabled).toBe(false);
  expect(discovered).toEqual([]);
  await expandSites();
  expect(dialog.textContent).toContain('Amazon');
  expect(dialog.textContent).toContain('Shopify');
  expect(dialog.textContent).toContain('Figma');
  const checkboxes = [...dialog.querySelectorAll<HTMLElement>('[role="checkbox"]')];
  expect(checkboxes.length).toBe(28);
  expect(checkboxes.every((entry) => entry.getAttribute('data-state') === 'checked')).toBe(true);
  await act(async () => checkboxes[0].click());
  expect(button(zh['settings.browserImport.import']).disabled).toBe(true);
  await act(async () => checkboxes[1].click());
  const received: ElectronBrowserAccountImportInput[] = [];
  bridge.importBrowserAccount.mockImplementation(
    async (input: ElectronBrowserAccountImportInput) => {
      received.push(input);
      return result;
    }
  );
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(received[0]).toMatchObject({
    browserId: 'chrome',
    siteIds: ['pinterest'],
  });
  expect(received[0].profileId).toBeUndefined();
  expect(received[0].operationId).toMatch(/^[a-f0-9-]{36}$/);
  expect(dialog.querySelector('[role="status"]')?.textContent).toContain('7');
  expect(dialog.querySelector('[role="status"]')?.textContent).toContain(
    zh['settings.browserImport.verifyLogin']
  );
  await act(async () => button(zh['settings.browserImport.done']).click());
  await openImport();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('27 / 27');
  expect(document.querySelectorAll('[role="dialog"] [role="checkbox"]').length).toBe(0);
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
  await act(async () =>
    pending.resolve({
      ok: true,
      profiles: [
        { id: 'late-one', name: 'Late one', isDefault: true },
        { id: 'late-two', name: 'Late two', isDefault: false },
      ],
    })
  );
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Late');
  expect(button(zh['settings.browserImport.import']).disabled).toBe(false);
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

it('keeps unsupported builds honest and distinguishes unavailable profile data from no installed browsers', async () => {
  bridge.getAccountSummary.mockResolvedValue({
    persistent: false,
    importAvailable: false,
    importUnavailableReason: 'signing-required',
    cookieCount: 0,
    sites: [],
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(button(zh['settings.browserImport.import']).disabled).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    zh['settings.browserAccounts.importUnavailableReasons.signing-required']
  );
  await act(async () => button(zh['common.cancel']).click());
  bridge.getAccountSummary.mockResolvedValue({
    persistent: true,
    importAvailable: true,
    cookieCount: 0,
    sites: [],
  });
  bridge.importBrowserAccount.mockResolvedValue({ ok: false, error: 'source-unavailable' });
  bridge.getImportProfiles.mockRejectedValue(new Error('private path must not appear'));
  await openImport();
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(button(zh['settings.browserImport.import']).disabled).toBe(false);
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    zh['settings.browserImport.errors.source-unavailable']
  );
  expect(document.body.textContent).not.toContain('private path');
});

it('continues the same import when the system authorization finishes and freezes its input', async () => {
  const pending = Promise.withResolvers<ElectronBrowserImportResult>();
  const requests: ElectronBrowserAccountImportInput[] = [];
  bridge.importBrowserAccount.mockImplementation((input: ElectronBrowserAccountImportInput) => {
    requests.push(input);
    return pending.promise;
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  await expandSites();
  await act(async () => button(zh['settings.browserImport.import']).click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector<HTMLButtonElement>('[role="combobox"]')?.disabled).toBe(true);
  expect(
    [...dialog.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')].every(
      (entry) => entry.disabled
    )
  ).toBe(true);
  expect(dialog.querySelector('[role="status"]')?.textContent).toContain(
    zh['settings.browserImport.importing']
  );
  expect(requests.map(({ browserId, profileId }) => ({ browserId, profileId }))).toEqual([
    { browserId: 'chrome', profileId: undefined },
  ]);
  await act(async () => pending.resolve(result));
  expect(button(zh['settings.browserImport.done']).disabled).toBe(false);
});

it('asks for an explicit profile only after Import discovers multiple profiles', async () => {
  const requests: ElectronBrowserAccountImportInput[] = [];
  bridge.importBrowserAccount.mockImplementation(
    async (input: ElectronBrowserAccountImportInput) => {
      requests.push(input);
      return input.profileId
        ? result
        : {
            ok: true,
            profiles: [
              { id: 'opaque-default', name: 'Designer', isDefault: true },
              { id: 'opaque-studio', name: 'Studio', isDefault: false },
            ],
          };
    }
  );
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    zh['settings.browserImport.profileRequired']
  );
  expect(document.querySelector('[role="combobox"]')?.textContent).toBe(
    zh['settings.browserImport.chooseProfile']
  );
  expect(button(zh['settings.browserImport.import']).disabled).toBe(true);
  await chooseSource('Google Chrome · Studio');
  expect(button(zh['settings.browserImport.import']).disabled).toBe(false);
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(requests.map(({ browserId, profileId }) => ({ browserId, profileId }))).toEqual([
    { browserId: 'chrome', profileId: undefined },
    { browserId: 'chrome', profileId: 'opaque-studio' },
  ]);
  expect(button(zh['settings.browserImport.done']).disabled).toBe(false);
});

it('requires a new explicit choice when the selected profile is no longer available', async () => {
  const requests: ElectronBrowserAccountImportInput[] = [];
  bridge.importBrowserAccount.mockImplementation(
    async (input: ElectronBrowserAccountImportInput) => {
      requests.push(input);
      if (input.profileId === 'opaque-default') return result;
      return {
        ok: true,
        profiles: input.profileId
          ? [{ id: 'opaque-default', name: 'Designer', isDefault: true }]
          : [
              { id: 'opaque-default', name: 'Designer', isDefault: true },
              { id: 'opaque-studio', name: 'Studio', isDefault: false },
            ],
      };
    }
  );
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  await act(async () => button(zh['settings.browserImport.import']).click());
  await chooseSource('Google Chrome · Studio');
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(document.querySelector('[role="combobox"]')?.textContent).toBe(
    zh['settings.browserImport.chooseProfile']
  );
  expect(button(zh['settings.browserImport.import']).disabled).toBe(true);
  await chooseSource('Google Chrome · Designer');
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(requests.map(({ profileId }) => profileId)).toEqual([
    undefined,
    'opaque-studio',
    'opaque-default',
  ]);
  expect(button(zh['settings.browserImport.done']).disabled).toBe(false);
});

const recoverySteps = [
  zh['settings.browserImport.recovery.step1'],
  zh['settings.browserImport.recovery.step2'],
  zh['settings.browserImport.recovery.step3'],
  zh['settings.browserImport.recovery.step4'],
];

it('starts the App Data import on Import and offers System Settings only after the denial', async () => {
  const events: string[] = [];
  bridge.importBrowserAccount.mockImplementation(async () => {
    events.push('import');
    return { ok: false, error: 'source-access-denied' };
  });
  bridge.openBrowserDataPrivacySettings.mockImplementation(async () => {
    events.push('settings');
    return { opened: true };
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  expect(events).toEqual([]);
  await act(async () => button(zh['settings.browserImport.import']).click());
  expect(events).toEqual(['import']);
  const alert = document.querySelector('[role="alert"]')?.textContent ?? '';
  expect(alert).toContain(zh['settings.browserImport.recovery.title']);
  for (const step of recoverySteps) expect(alert).toContain(step);
  expect(alert).not.toContain('文件与文件夹');
  expect(button(zh['settings.browserImport.openSystemSettings']).disabled).toBe(false);
  await act(async () => button(zh['settings.browserImport.openSystemSettings']).click());
  expect(events).toEqual(['import', 'settings']);
  expect(button(zh['settings.browserImport.allowedImportNow']).disabled).toBe(false);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    zh['settings.browserImport.settingsReturn']
  );
});

it('re-checks the same import when the window regains focus after System Settings, without another click', async () => {
  const events: string[] = [];
  const requests: ElectronBrowserAccountImportInput[] = [];
  bridge.importBrowserAccount.mockImplementation(
    async (input: ElectronBrowserAccountImportInput) => {
      events.push('import');
      requests.push(input);
      return requests.length === 1 ? { ok: false, error: 'source-access-denied' } : result;
    }
  );
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  await chooseSource('Microsoft Edge');
  await act(async () => button(zh['settings.browserImport.import']).click());
  await act(async () => button(zh['settings.browserImport.openSystemSettings']).click());
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(events).toEqual(['import', 'import']);
  expect(
    requests.map(({ browserId, profileId, siteIds }) => ({ browserId, profileId, siteIds }))
  ).toEqual([
    { browserId: 'edge', profileId: undefined, siteIds: [...BROWSER_SITE_IDS] },
    { browserId: 'edge', profileId: undefined, siteIds: [...BROWSER_SITE_IDS] },
  ]);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Microsoft Edge');
  expect(document.querySelector('[role="status"]')?.textContent).toContain('7');
  expect(button(zh['settings.browserImport.done']).disabled).toBe(false);
});

it('does not re-check on focus before the user has opened System Settings', async () => {
  const events: string[] = [];
  bridge.importBrowserAccount.mockImplementation(async () => {
    events.push('import');
    return { ok: false, error: 'source-access-denied' };
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  await act(async () => button(zh['settings.browserImport.import']).click());
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(events).toEqual(['import']);
  expect(button(zh['settings.browserImport.openSystemSettings']).disabled).toBe(false);
});

it('keeps guiding after a retry is still denied and offers restart with no skip exit', async () => {
  const events: string[] = [];
  bridge.importBrowserAccount.mockImplementation(async () => {
    events.push('import');
    return { ok: false, error: 'source-access-denied' };
  });
  bridge.openBrowserDataPrivacySettings.mockImplementation(async () => {
    events.push('settings');
    return { opened: true };
  });
  app.restartApp.mockImplementation(async () => {
    events.push('restart');
    return { ok: true };
  });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  await act(async () => button(zh['settings.browserImport.import']).click());
  await act(async () => button(zh['settings.browserImport.openSystemSettings']).click());
  await act(async () => button(zh['settings.browserImport.allowedImportNow']).click());
  expect(events).toEqual(['import', 'settings', 'import']);
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    zh['settings.browserImport.recovery.stillDenied']
  );
  expect(document.querySelector('[role="alert"]')?.textContent).not.toContain(
    zh['settings.browserImport.recovery.title']
  );
  const labels = [...dialog.querySelectorAll('button')].map((entry) => entry.textContent);
  expect(labels).toContain(zh['settings.browserImport.openSystemSettingsAgain']);
  expect(labels).toContain(zh['settings.browserImport.restartAndImport']);
  expect(labels).toContain(zh['common.cancel']);
  expect(labels.some((label) => /登录|sign in/i.test(label ?? ''))).toBe(false);
  await act(async () => button(zh['settings.browserImport.openSystemSettingsAgain']).click());
  expect(events).toEqual(['import', 'settings', 'import', 'settings']);
  await act(async () => button(zh['settings.browserImport.restartAndImport']).click());
  expect(events).toEqual(['import', 'settings', 'import', 'settings', 'restart']);
});

it('shows a restart failure and keeps the restart action available', async () => {
  bridge.importBrowserAccount.mockResolvedValue({ ok: false, error: 'source-access-denied' });
  app.restartApp.mockResolvedValue({ ok: false, error: 'synthetic busy agent' });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  await act(async () => button(zh['settings.browserImport.import']).click());
  await act(async () => button(zh['settings.browserImport.openSystemSettings']).click());
  await act(async () => button(zh['settings.browserImport.allowedImportNow']).click());
  await act(async () => button(zh['settings.browserImport.restartAndImport']).click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    zh['settings.browserImport.restartFailed']
  );
  expect(document.body.textContent).not.toContain('synthetic busy agent');
  expect(button(zh['settings.browserImport.restartAndImport']).disabled).toBe(false);
});

it.each(['source-unavailable', 'source-incomplete', 'source-authorization-denied'] as const)(
  'does not send %s to file privacy settings',
  async (error) => {
    bridge.importBrowserAccount.mockResolvedValue({ ok: false, error });
    await act(async () => root.render(<BrowserAccountsSetting />));
    await openImport();
    await act(async () => button(zh['settings.browserImport.import']).click());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      zh[`settings.browserImport.errors.${error}`]
    );
    expect(document.body.textContent).not.toContain(
      zh['settings.browserImport.openSystemSettings']
    );
    expect(button(zh['settings.browserImport.retry']).disabled).toBe(false);
  }
);

it('shows a failed settings launch without claiming access and ignores stale settings replies', async () => {
  bridge.importBrowserAccount.mockResolvedValue({ ok: false, error: 'source-access-denied' });
  bridge.openBrowserDataPrivacySettings.mockResolvedValue({ opened: false });
  await act(async () => root.render(<BrowserAccountsSetting />));
  await openImport();
  await act(async () => button(zh['settings.browserImport.import']).click());
  await act(async () => button(zh['settings.browserImport.openSystemSettings']).click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    zh['settings.browserImport.openSystemSettingsFailed']
  );
  expect(button(zh['settings.browserImport.openSystemSettings']).disabled).toBe(false);
  const pending = Promise.withResolvers<{ opened: boolean }>();
  bridge.openBrowserDataPrivacySettings.mockReturnValue(pending.promise);
  await act(async () => button(zh['settings.browserImport.openSystemSettings']).click());
  await chooseSource('Microsoft Edge');
  await act(async () => pending.resolve({ opened: true }));
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(button(zh['settings.browserImport.import']).disabled).toBe(false);
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
  expect(document.querySelector('[role="combobox"]')?.textContent).toBe(
    zh['settings.browserImport.noSources']
  );
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
