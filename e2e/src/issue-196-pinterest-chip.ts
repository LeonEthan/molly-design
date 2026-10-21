import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ElectronHarness } from './support/electron-harness.js';
import { OnboardingPage } from './support/pages/onboarding-page.js';

const ARTIFACT_DIR = join(process.cwd(), 'artifacts', 'issue-196-pinterest-chip');
mkdirSync(ARTIFACT_DIR, { recursive: true });

const harness = new ElectronHarness({
  rootDir: ARTIFACT_DIR,
  scenarioDir: ARTIFACT_DIR,
  stableId: 'MOLLY-ISSUE-196',
});

const fail = (message: string): never => {
  throw new Error(message);
};

async function openAiModelsSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: /^(Settings|设置)$/u }).first().click();
  await page.getByRole('button', { name: 'AI models' }).click();
  await page
    .getByRole('list', { name: 'Design setup' })
    .waitFor({ state: 'visible', timeout: 60_000 });
}

function pinterestChip(page: import('@playwright/test').Page) {
  return page
    .getByRole('list', { name: 'Design setup' })
    .getByRole('button')
    .filter({ hasText: 'Pinterest' });
}

async function expectChipState(
  page: import('@playwright/test').Page,
  state: string,
  text: RegExp,
  screenshotName: string
): Promise<void> {
  const chip = pinterestChip(page);
  await chip.waitFor({ state: 'visible', timeout: 60_000 });
  const actualState = await chip.getAttribute('data-state');
  if (actualState !== state) fail(`Pinterest chip state ${actualState}, expected ${state}`);
  const actualText = (await chip.textContent())?.replace(/\s+/g, ' ').trim() ?? '';
  if (!text.test(actualText)) fail(`Pinterest chip text "${actualText}" did not match ${text}`);
  await page.screenshot({ path: join(ARTIFACT_DIR, screenshotName) });
  console.log(`ok: state=${actualState} text="${actualText}" (${screenshotName})`);
}

async function setTheme(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  await page.evaluate((nextTheme) => {
    window.localStorage.setItem('vite-ui-theme', nextTheme);
    window.location.reload();
  }, theme);
}

try {
  await harness.launch();
  const page = harness.page ?? fail('no main window');
  const onboarding = new OnboardingPage(page);
  await onboarding.waitForLocalBootstrap();
  await onboarding.skipConfigurationAndEnterProduct();

  // 0-cookie state, light theme: "Not signed in" and click opens the import dialog.
  await openAiModelsSettings(page);
  await expectChipState(page, 'unset', /Not signed in/u, 'pinterest-0-cookies-light.png');
  await pinterestChip(page).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Import from your browser' });
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });
  console.log('ok: 0-cookie click opens the import dialog');
  await page.screenshot({ path: join(ARTIFACT_DIR, 'pinterest-0-cookies-dialog.png') });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 30_000 });

  // Seed synthetic Pinterest cookies into Molly's own browser partition.
  const seeded = await harness.app!.evaluate(async ({ session }) => {
    const partition = 'persist:molly-public-browser-dev-v1';
    const target = session.fromPartition(partition);
    const base = {
      url: 'https://www.pinterest.com',
      domain: '.pinterest.com',
      path: '/',
      secure: true,
      httpOnly: true,
      expirationDate: Math.floor(Date.now() / 1000) + 86_400,
    };
    await target.cookies.set({ ...base, name: 'e2e_synthetic_session', value: 'synthetic-1' });
    await target.cookies.set({ ...base, name: 'e2e_synthetic_marker', value: 'synthetic-2' });
    const count = (await target.cookies.get({ domain: '.pinterest.com' })).length;
    return { partition, count };
  });
  if (seeded.count < 2) fail(`synthetic cookie seeding wrote ${seeded.count} cookies`);
  console.log(`ok: seeded ${seeded.count} synthetic cookies into ${seeded.partition}`);

  // Imported state, light theme: honest copy, never ticked, click reopens import.
  await page.reload();
  await openAiModelsSettings(page);
  await expectChipState(
    page,
    'unverified',
    /Imported · open Pinterest to check/u,
    'pinterest-imported-light.png'
  );
  await pinterestChip(page).click();
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });
  console.log('ok: imported-state click reopens the import dialog');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 30_000 });

  // Dark theme legibility for both states.
  await setTheme(page, 'dark');
  await openAiModelsSettings(page);
  await expectChipState(
    page,
    'unverified',
    /Imported · open Pinterest to check/u,
    'pinterest-imported-dark.png'
  );
  const cleared = await harness.app!.evaluate(async ({ session }) => {
    const target = session.fromPartition('persist:molly-public-browser-dev-v1');
    for (const cookie of await target.cookies.get({ domain: '.pinterest.com' })) {
      const scheme = cookie.secure ? 'https' : 'http';
      const host = (cookie.domain ?? '').replace(/^\./, '');
      await target.cookies.remove(`${scheme}://${host}${cookie.path ?? '/'}`, cookie.name ?? '');
    }
    return (await target.cookies.get({ domain: '.pinterest.com' })).length;
  });
  if (cleared !== 0) fail(`synthetic cookie cleanup left ${cleared} cookies`);
  await page.reload();
  await openAiModelsSettings(page);
  await expectChipState(page, 'unset', /Not signed in/u, 'pinterest-0-cookies-dark.png');

  console.log('ISSUE-196 E2E PASSED');
} finally {
  await harness.close();
}
