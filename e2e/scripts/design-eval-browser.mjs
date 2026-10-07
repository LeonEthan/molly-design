import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';

export function validateBrowserSelection(selection) {
  const browsers = ['chrome', 'edge', 'brave', 'arc', 'vivaldi', 'opera', 'chromium'];
  if (
    !selection ||
    !browsers.includes(selection.browserId) ||
    typeof selection.profileId !== 'string' ||
    !selection.profileId.trim() ||
    selection.profileId.length > 512
  )
    throw Error('Configure browser.browserId and browser.profileId in private/connection.json');
  return { browserId: selection.browserId, profileId: selection.profileId, site: 'pinterest.com' };
}

export async function prepareDesignEvalBrowser({ invoke, selection, verify }) {
  const source = validateBrowserSelection(selection);
  const before = await invoke('publicBrowser.getAccountSummary');
  if (!before.importAvailable)
    throw Error(`Browser import unavailable: ${before.importUnavailableReason ?? 'unknown'}`);
  if (before.sites.some((entry) => entry.site === source.site && entry.cookieCount > 0))
    throw Error('Browser preparation requires a fresh isolated website account');
  const sources = await invoke('publicBrowser.getImportSources');
  if (
    !sources.sources.some(
      (browser) =>
        browser.browserId === source.browserId &&
        browser.profiles.some((profile) => profile.id === source.profileId)
    )
  )
    throw Error('Selected browser profile is unavailable; check launcher browser-data access');
  const { imported } = await invoke('publicBrowser.importBrowserAccount', {
    ...source,
    replaceExisting: false,
  });
  const after = await invoke('publicBrowser.getAccountSummary');
  const cookieCount = after.sites.find((entry) => entry.site === source.site)?.cookieCount ?? 0;
  if (!(imported > 0 && cookieCount > 0))
    throw Error('Browser import did not retain website cookies');
  const page = await verify(source.site);
  if (!page.signedIn || !page.visibleReferences || page.loginBlocked)
    throw Error('Pinterest sign-in and visible references were not verified');
  return {
    status: 'ready',
    source,
    imported,
    cookieCount,
    persistent: after.persistent,
    page,
  };
}

export async function readResearchPage(h, researchSite, includeScreenshot = false) {
  return h.app.evaluate(
    async ({ webContents }, { site, screenshot }) => {
      const contents = webContents.getAllWebContents().find((entry) => {
        try {
          const host = new URL(entry.getURL()).hostname;
          return host === site || host.endsWith(`.${site}`);
        } catch {
          return false;
        }
      });
      if (!contents) return { signedIn: false, visibleReferences: false, loginBlocked: false };
      const state = await contents.executeJavaScript(`(() => {
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        };
        const profile = [...document.querySelectorAll('[data-test-id="header-profile"], [data-test-id="header-profile-button"], [data-test-id="HeaderAvatar"], [data-test-id="pro-partner-header"] [data-test-id="gestalt-avatar-svg"], [aria-label="Your profile"], [aria-label="个人主页"], [aria-label="你的个人资料"]')].some(visible);
        const references = new Set([...document.images].filter(image => image.currentSrc.includes('pinimg.com') && image.naturalWidth >= 100 && image.naturalHeight >= 100 && visible(image)).map(image => image.closest('[data-test-id="pin"], a[href*="/pin/"]')).filter(Boolean));
        const loginBlocked = [...document.querySelectorAll('[role="dialog"], [data-test-id="login-signup-modal"]')].some(element => visible(element) && /Log in|Sign up|登录|登入|注册|註冊/i.test(element.innerText));
        return { url: location.origin + location.pathname, signedIn: profile, visibleReferences: references.size > 0, visibleReferenceCount: references.size, loginBlocked };
      })()`);
      if (screenshot) state.screenshot = (await contents.capturePage()).toPNG().toString('base64');
      return state;
    },
    { site: researchSite, screenshot: includeScreenshot }
  );
}

export async function verifyResearchBrowser({ h, invoke, site, directory }) {
  const browserId = 'design-eval-browser-preparation';
  const created = await invoke('publicBrowser.create', {
    browserId,
    bounds: { x: 20, y: 20, width: 720, height: 520 },
  });
  if (!created.ok) throw Error(created.error);
  try {
    const navigation = await invoke('publicBrowser.navigate', {
      browserId,
      url: `https://www.${site}/search/pins/?q=coffee%20poster%20design`,
    });
    if (!navigation.ok) throw Error(navigation.error);
    await expect
      .poll(() => readResearchPage(h, site), {
        message: 'Imported website account must show signed-in controls and visible references',
        timeout: 120_000,
        intervals: [250, 500, 1000],
      })
      .toMatchObject({ signedIn: true, visibleReferences: true, loginBlocked: false });
    const { screenshot, ...page } = await readResearchPage(h, site, true);
    await writeFile(join(directory, 'browser-ready.png'), Buffer.from(screenshot, 'base64'));
    return page;
  } catch (error) {
    const observation = await readResearchPage(h, site, true).catch(() => null);
    if (observation?.screenshot) {
      const { screenshot, ...page } = observation;
      await writeFile(join(directory, 'browser-failed.png'), Buffer.from(screenshot, 'base64'));
      await writeFile(join(directory, 'browser-failed.json'), JSON.stringify(page, null, 2));
    }
    throw error;
  } finally {
    await invoke('publicBrowser.destroy', { browserId });
  }
}
