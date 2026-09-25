const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const suiteRequire = createRequire(path.join(root, 'e2e/package.json'));
const output = path.join(
  root,
  'output/welcome-redesign-2026-09-24/verification',
  `installed-layout-${Date.now()}`
);
const sourceCommit = '152f239648b6a99fe04521d5a788d144c4025fa2';
const executable = path.join(root, 'apps/electron/dist/mac-arm64/Molly.app/Contents/MacOS/Molly');

async function main() {
  const { register } = suiteRequire('tsx/esm/api');
  register();
  const { ElectronHarness } = await import(
    pathToFileURL(path.join(root, 'e2e/src/support/electron-harness.ts')).href
  );
  process.env.MOLLY_E2E_INSTALLED_EXECUTABLE ??= executable;
  process.env.MOLLY_E2E_EXPECTED_SOURCE_COMMIT ??= sourceCommit;
  assert.equal(process.env.MOLLY_E2E_EXPECTED_SOURCE_COMMIT, sourceCommit);
  await fs.mkdir(output, { recursive: true });
  const harness = new ElectronHarness({
    rootDir: output,
    scenarioDir: output,
    stableId: 'welcome-installed-layout',
  });
  const report = {
    surface: 'packaged-macos-arm64',
    sourceCommit,
    executable: process.env.MOLLY_E2E_INSTALLED_EXECUTABLE,
    states: [],
    pageErrors: [],
    passed: false,
  };
  let failure;
  let page;
  try {
    await harness.launch();
    page = harness.page;
    const app = harness.app;
    assert(page && app, 'Installed Molly did not open its first window');
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    await page.locator('.molly-intro-inspiration').waitFor();
    await page.clock.install({ time: new Date('2026-09-24T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-09-24T00:00:01Z'));

    const cases = [
      { locale: 'zh_CN', width: 900, height: 670, zoom: 1, scenes: [0, 1, 2] },
      { locale: 'en', width: 620, height: 600, zoom: 1, scenes: [0, 1, 2] },
      { locale: 'zh_CN', width: 900, height: 670, zoom: 1.5, scenes: [1] },
      { locale: 'en', width: 620, height: 600, zoom: 2, scenes: [2] },
    ];
    const sceneNames = ['inspiration', 'creation', 'expression'];
    for (const condition of cases) {
      const native = await app.evaluate(({ BrowserWindow, app: nativeApp, screen }, target) => {
        const window = BrowserWindow.getAllWindows().find(
          (candidate) => candidate.getTitle() === 'Molly'
        );
        if (!window) throw new Error('Molly window disappeared');
        window.setBounds({ width: target.width, height: target.height });
        window.webContents.setZoomFactor(target.zoom);
        window.show();
        nativeApp.focus({ steal: true });
        window.focus();
        return {
          bounds: window.getBounds(),
          displayScaleFactor: screen.getDisplayMatching(window.getBounds()).scaleFactor,
          focused: window.isFocused(),
        };
      }, condition);
      await page.bringToFront();
      assert.equal(native.bounds.width, condition.width);
      assert.equal(native.bounds.height, condition.height);
      await page.evaluate((locale) => {
        localStorage.setItem('molly-language', JSON.stringify(locale));
        localStorage.setItem('molly-desktop-onboarding-phase', JSON.stringify('ceremony'));
      }, condition.locale);
      await page.reload();
      await page.locator('.molly-intro-inspiration').waitFor();
      const selectors = page.locator('.molly-intro-segments button');
      assert.equal(await selectors.count(), 3);
      if (condition.zoom === 1) {
        await page.locator('.molly-intro-sound').focus();
        await page.keyboard.press('Tab');
        assert(
          await selectors.first().evaluate((button) => button === document.activeElement),
          'Keyboard Tab did not reach the first scene selector'
        );
        assert.equal(
          await selectors.first().evaluate((button) => getComputedStyle(button).outlineStyle),
          'solid'
        );
      }
      for (const index of condition.scenes) {
        if (index !== 0) await selectors.nth(index).click();
        await page.locator(`.molly-intro-${sceneNames[index]}`).waitFor();
        await page.evaluate(async () => {
          await Promise.all(Array.from(document.images).map((image) => image.decode()));
          await document.fonts.ready;
        });
        const action = page.locator('.molly-intro-footer > button');
        const soundControl = page.locator('.molly-intro-sound');
        await soundControl.scrollIntoViewIfNeeded();
        const initial = await page.evaluate(() => {
          const host = document.querySelector('.molly-intro');
          const artwork = document.querySelector('.molly-intro-artwork');
          const sound = document.querySelector('.molly-intro-sound');
          const heading = document.querySelector('main h1');
          const scene = document.querySelector('main').getBoundingClientRect();
          const footer = document.querySelector('footer').getBoundingClientRect();
          const soundBounds = sound.getBoundingClientRect();
          return {
            lang: host.getAttribute('lang'),
            viewport: [innerWidth, innerHeight],
            devicePixelRatio,
            count: document.querySelector('.molly-intro-count')?.textContent?.trim(),
            heading: heading?.textContent?.trim(),
            artwork: {
              decoded: artwork.complete && artwork.naturalWidth > 0 && artwork.naturalHeight > 0,
              naturalSize: [artwork.naturalWidth, artwork.naturalHeight],
            },
            horizontalOverflow: host.scrollWidth - host.clientWidth,
            sceneOverlapsFooter: scene.bottom > footer.top + 1,
            soundVisible: soundBounds.top >= 0 && soundBounds.bottom <= innerHeight,
            soundLabel: sound.getAttribute('aria-label'),
          };
        });
        await action.scrollIntoViewIfNeeded();
        const controls = await action.evaluate((button) => {
          const bounds = button.getBoundingClientRect();
          const centre = document.elementFromPoint(
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2
          );
          return {
            label: button.textContent?.trim(),
            enabled: !button.disabled,
            reachable: bounds.top >= 0 && bounds.bottom <= innerHeight && button.contains(centre),
          };
        });
        const png = Buffer.from(
          await app.evaluate(async ({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows().find(
              (candidate) => candidate.getTitle() === 'Molly'
            );
            return Array.from((await window.webContents.capturePage()).toPNG());
          })
        );
        const name = `${condition.locale}-${condition.width}x${condition.height}-${Math.round(condition.zoom * 100)}-${sceneNames[index]}`;
        await fs.writeFile(path.join(output, `${name}.png`), png);
        const state = {
          name,
          ...native,
          ...initial,
          controls,
          capturedPixels: [png.readUInt32BE(16), png.readUInt32BE(20)],
        };
        report.states.push(state);
        assert.equal(initial.lang, condition.locale === 'en' ? 'en' : 'zh-CN', name);
        assert.equal(initial.count, `0${index + 1} / 03`, name);
        assert(initial.artwork.decoded, `${name}: artwork did not decode`);
        assert(initial.horizontalOverflow <= 1, `${name}: horizontal overflow`);
        assert(!initial.sceneOverlapsFooter, `${name}: footer overlap`);
        assert(initial.soundVisible, `${name}: sound control inaccessible`);
        assert(initial.soundLabel, `${name}: sound control has no accessible label`);
        assert(controls.enabled && controls.reachable, `${name}: setup action inaccessible`);
        assert.equal(
          controls.label,
          index === 2
            ? condition.locale === 'en'
              ? 'Start setup'
              : '开始设置'
            : condition.locale === 'en'
              ? 'Skip'
              : '跳过',
          name
        );
        assert(initial.devicePixelRatio >= 1 && native.displayScaleFactor >= 1, name);
        console.log(`${name}: PASS`);
      }
    }
    assert.equal(report.states.length, 8);
    assert.deepEqual(report.pageErrors, []);
    report.passed = true;
  } catch (error) {
    failure = error;
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    }
  } finally {
    try {
      await harness.close();
    } catch (error) {
      failure ??= error;
    }
    if (failure) {
      report.passed = false;
      report.error = failure.stack ?? String(failure);
    }
    await fs.writeFile(path.join(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Installed layout evidence: ${output}`);
  }
  if (failure) throw failure;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
