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
  getChromeProfiles: vi.fn(),
  importChromeAccount: vi.fn(),
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
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('offers Pinterest import and explains pending authorization and explicit retry', async () => {
  let cookieCount = 0;
  let request = Promise.withResolvers<{ imported: number }>();
  bridge.getAccountSummary.mockImplementation(async () => ({
    persistent: true,
    importAvailable: true,
    sites: ElectronBrowserAccountSiteInputSchema.shape.site.options.map((site) => ({
      site,
      cookieCount,
    })),
  }));
  bridge.getChromeProfiles.mockResolvedValue([
    { id: 'synthetic', name: 'Test profile', isDefault: true },
  ]);
  bridge.importChromeAccount.mockImplementation(() => request.promise);
  await act(async () => root.render(<BrowserAccountsSetting />));
  expect(host.textContent).toContain('Pinterest');
  expect(host.textContent).not.toContain('Amazon');
  expect(ElectronBrowserAccountSiteInputSchema.safeParse({ site: 'amazon.com' }).success).toBe(
    false
  );
  const importButton = Array.from(host.querySelectorAll('button')).find(
    (button) => button.textContent === zh['settings.browserAccounts.importSite']
  );
  if (!importButton) throw new Error('Missing import action');
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
