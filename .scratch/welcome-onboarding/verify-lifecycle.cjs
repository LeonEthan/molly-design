const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/welcome-redesign-2026-09-24/verification');
const e2eRequire = createRequire(path.join(root, 'e2e/package.json'));
e2eRequire('tsx/cjs');
const { expect } = e2eRequire('@playwright/test');
const { ElectronHarness } = e2eRequire('./src/support/electron-harness.ts');
const { OnboardingPage } = e2eRequire('./src/support/pages/onboarding-page.ts');

const executable =
  process.env.MOLLY_E2E_INSTALLED_EXECUTABLE ??
  path.join(root, 'apps/electron/dist/mac-arm64/Molly.app/Contents/MacOS/Molly');
const sourceCommit = process.env.MOLLY_E2E_EXPECTED_SOURCE_COMMIT;

async function freezeOpening(page) {
  const time = new Date('2026-09-24T00:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date('2026-09-24T00:00:01Z'));
}

async function exposeSetupArtwork(harness) {
  await harness.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => candidate.getTitle() === 'Molly'
    );
    window.setBounds({ width: 1200, height: 760 });
  });
  const artwork = harness.page.locator(
    '[data-onboarding-stage="providers"] img[src*="molly-editorial-v3"]'
  );
  await expect(artwork).toBeVisible();
  await expect.poll(() => artwork.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
}

async function capture(harness, label, directory) {
  const page = harness.page;
  const [native, renderer] = await Promise.all([
    harness.app.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      userDataPath: app.getPath('userData'),
    })),
    page.evaluate(() => {
      const setupArtwork = document.querySelector(
        '[data-onboarding-stage="providers"] img[src*="molly-editorial-v3"]'
      );
      const bounds = setupArtwork?.getBoundingClientRect();
      return {
        url: location.href,
        scene: document.querySelector('.molly-intro-count')?.textContent?.trim() ?? null,
        phase: localStorage.getItem('molly-desktop-onboarding-phase'),
        setupStage:
          document
            .querySelector('[data-onboarding-stage]')
            ?.getAttribute('data-onboarding-stage') ?? null,
        lightTheme: document.documentElement.classList.contains('light'),
        setupArtwork: setupArtwork
          ? {
              source: setupArtwork.getAttribute('src'),
              decoded: setupArtwork.complete && setupArtwork.naturalWidth > 0,
              visible: Boolean(bounds && bounds.width > 0 && bounds.height > 0),
            }
          : null,
        productPrompt: Boolean(document.querySelector('#chat-prompt')),
      };
    }),
  ]);
  await page.screenshot({ path: path.join(directory, `${label}.png`) });
  return { label, native, renderer };
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'lifecycle-'));
  const result = {
    surface: 'packaged-macos-arm64',
    executable,
    expectedSourceCommit: sourceCommit ?? null,
    checkpoints: [],
    passed: false,
  };
  const harness = new ElectronHarness({
    rootDir: directory,
    scenarioDir: directory,
    stableId: 'WELCOME-LIFECYCLE-007',
  });
  let failure;
  try {
    assert.match(
      sourceCommit ?? '',
      /^[a-f0-9]{40}$/,
      'Set MOLLY_E2E_EXPECTED_SOURCE_COMMIT to the packaged source SHA'
    );
    process.env.MOLLY_E2E_INSTALLED_EXECUTABLE = executable;
    await harness.launch();
    let page = harness.page;
    await freezeOpening(page);
    await expect(page.locator('.molly-intro-inspiration')).toBeVisible();
    const initial = await capture(harness, 'initial-ceremony', directory);
    result.checkpoints.push(initial);
    assert(initial.native.isPackaged);
    assert.equal(initial.renderer.scene, '01 / 03');
    assert(initial.renderer.lightTheme);
    const profile = initial.native.userDataPath;

    await harness.restart();
    page = harness.page;
    await freezeOpening(page);
    await expect(page.locator('.molly-intro-inspiration')).toBeVisible();
    const resumedCeremony = await capture(harness, 'restart-after-ceremony-quit', directory);
    result.checkpoints.push(resumedCeremony);
    assert.equal(resumedCeremony.native.userDataPath, profile);
    assert.equal(resumedCeremony.native.appPath, initial.native.appPath);
    assert.equal(resumedCeremony.renderer.scene, '01 / 03');
    await new OnboardingPage(page).waitForLocalBootstrap();
    await new OnboardingPage(page).openAgentConfiguration();
    await expect(page.locator('[data-onboarding-stage="providers"]')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('molly-desktop-onboarding-phase')))
      .toBe('"providers"');
    await exposeSetupArtwork(harness);
    const setup = await capture(harness, 'entered-setup', directory);
    result.checkpoints.push(setup);
    assert.equal(setup.renderer.setupStage, 'providers');
    assert.equal(setup.renderer.phase, '"providers"');
    assert(setup.renderer.setupArtwork?.decoded && setup.renderer.setupArtwork.visible);
    assert(setup.renderer.lightTheme);

    await harness.restart();
    page = harness.page;
    await expect(page.getByRole('heading', { name: 'Connect a model' })).toBeVisible();
    await exposeSetupArtwork(harness);
    const resumedSetup = await capture(harness, 'restart-after-setup-quit', directory);
    result.checkpoints.push(resumedSetup);
    assert.equal(resumedSetup.native.userDataPath, profile);
    assert.equal(resumedSetup.native.appPath, initial.native.appPath);
    assert.equal(resumedSetup.renderer.setupStage, 'providers');
    assert.equal(resumedSetup.renderer.phase, '"providers"');
    assert(
      resumedSetup.renderer.setupArtwork?.decoded && resumedSetup.renderer.setupArtwork.visible
    );
    assert(resumedSetup.renderer.lightTheme);
    await new OnboardingPage(page).waitForLocalBootstrap();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByRole('heading', { name: 'Explore Molly' })).toBeVisible();
    await page.getByRole('button', { name: 'Enter Molly' }).click();
    await expect(page.locator('#chat-prompt')).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/#\/local\/chat(?:\?.*)?$/u);
    const product = await capture(harness, 'entered-product', directory);
    result.checkpoints.push(product);
    const completionStore = path.join(profile, 'onboarding-state.json');
    await expect
      .poll(async () => {
        const content = await fs.readFile(completionStore, 'utf8').catch(() => null);
        return content ? JSON.parse(content).completed : null;
      })
      .toBe(true);
    result.nativeCompletion = { completed: true };

    await harness.restart();
    page = harness.page;
    await expect(page.locator('#chat-prompt')).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/#\/local\/chat(?:\?.*)?$/u);
    await expect(page.locator('.molly-intro')).toHaveCount(0);
    const resumedProduct = await capture(harness, 'restart-after-product-quit', directory);
    result.checkpoints.push(resumedProduct);
    assert.equal(resumedProduct.native.userDataPath, profile);
    assert.equal(resumedProduct.native.appPath, initial.native.appPath);
    assert(resumedProduct.renderer.productPrompt);
    assert.equal(resumedProduct.renderer.scene, null);
    assert.equal(
      harness.logs.filter((record) => record.source === 'page' && record.level === 'error').length,
      0
    );
  } catch (error) {
    failure = error;
    result.error =
      error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
    if (harness.page) {
      await harness.page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    }
  } finally {
    try {
      await harness.close();
    } catch (error) {
      result.teardownError = error instanceof Error ? error.message : String(error);
      failure ??= error;
    }
    result.pageErrors = harness.logs
      .filter((record) => record.source === 'page' && record.level === 'error')
      .map((record) => record.message);
    result.passed = !failure;
    await fs.writeFile(
      path.join(directory, 'results.json'),
      `${JSON.stringify(result, null, 2)}\n`
    );
    console.log(`Lifecycle evidence: ${path.join(directory, 'results.json')}`);
  }
  if (failure) throw failure;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
