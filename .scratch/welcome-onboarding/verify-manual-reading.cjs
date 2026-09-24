const { createRequire } = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'apps/electron/package.json'));
const { _electron } = req('playwright');
const output = path.join(root, 'output/welcome-redesign-2026-09-24/verification');
const windowConfig = path.join(
  process.env.HOME,
  'Library/Preferences/molly-desktop-nodejs/window-state.json'
);
(async () => {
  const savedBounds = await fs.readFile(windowConfig).catch(() => null);
  const profile = await fs.mkdtemp('/tmp/molly-welcome-reading-');
  const app = await _electron.launch({
    executablePath: req('electron'),
    args: [path.join(root, 'apps/electron')],
    env: {
      ...process.env,
      MOLLY_DATA_DIR: '/tmp/molly-welcome-step1-data',
      MOLLY_ELECTRON_USER_DATA_DIR: profile,
      MOLLY_ELECTRON_FORCE_ONBOARDING: '1',
      MOLLY_ELECTRON_USE_BUNDLED_CLI: '1',
    },
  });
  const results = [];
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.molly-intro').waitFor();
    await page.clock.install({ time: new Date('2026-09-24T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-09-24T00:00:01Z'));
    const count = () => page.locator('.molly-intro-count').textContent();
    const selectors = page.locator('.molly-intro-segments button');
    for (const locale of ['zh_CN', 'en']) {
      for (const reduced of [false, true]) {
        const width = locale === 'en' ? 620 : 900;
        const height = locale === 'en' ? 600 : 670;
        await app.evaluate(
          ({ BrowserWindow }, size) => {
            const win = BrowserWindow.getAllWindows().find(
              (candidate) => candidate.getTitle() === 'Molly'
            );
            win.setBounds(size);
            win.webContents.setZoomFactor(1);
            win.show();
            win.focus();
          },
          { width, height }
        );
        await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
        await page.evaluate((selectedLocale) => {
          localStorage.setItem('molly-language', JSON.stringify(selectedLocale));
          localStorage.setItem('molly-desktop-onboarding-phase', JSON.stringify('ceremony'));
        }, locale);
        await page.reload();
        await page.locator('.molly-intro-inspiration').waitFor();
        await page.clock.runFor(reduced ? 30000 : 3000);
        assert.equal(await count(), reduced ? '01 / 03' : '02 / 03');
        if (reduced)
          assert.equal(
            await page.locator('main').evaluate((el) => getComputedStyle(el).animationName),
            'none'
          );
        await page.evaluate(() => document.activeElement.blur());
        await page.keyboard.press('Tab');
        assert(
          await page.locator('.molly-intro-sound').evaluate((el) => el === document.activeElement)
        );
        await page.keyboard.press('Tab');
        await page.waitForFunction(
          () => document.activeElement === document.querySelector('.molly-intro-segments button'),
          null,
          { polling: 50, timeout: 3000 }
        );
        assert(
          await selectors.nth(0).evaluate((el) => el === document.activeElement),
          await page.evaluate(() =>
            JSON.stringify({
              active: document.activeElement.outerHTML.slice(0, 600),
              buttons: Array.from(document.querySelectorAll('button')).map((el) => ({
                text: el.textContent,
                label: el.getAttribute('aria-label'),
                tabIndex: el.tabIndex,
              })),
            })
          )
        );
        await page.keyboard.press('Enter');
        await page.clock.runFor(30000);
        assert.equal(await count(), '01 / 03');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Space');
        assert.equal(await count(), '02 / 03');
        assert(
          await selectors.nth(1).evaluate((el) => getComputedStyle(el).outlineStyle === 'solid')
        );
        assert.equal(await selectors.nth(1).getAttribute('aria-current'), 'step');
        assert(
          (await selectors.nth(1).getAttribute('aria-label')).includes(
            locale === 'en' ? 'Your vision.' : '灵感成形'
          )
        );
        await page.clock.runFor(30000);
        assert.equal(await count(), '02 / 03');
        await page.evaluate(async () => {
          await Promise.all(Array.from(document.images).map((img) => img.decode()));
          await document.fonts.ready;
          await Promise.all(document.getAnimations().map((animation) => animation.finished));
        });
        const name = `step2-${locale}-${reduced ? 'reduced' : 'standard'}`;
        await page.screenshot();
        const pixels = Buffer.from(
          await app.evaluate(async ({ BrowserWindow }) =>
            Array.from(
              (
                await BrowserWindow.getAllWindows()
                  .find((candidate) => candidate.getTitle() === 'Molly')
                  .webContents.capturePage()
              ).toPNG()
            )
          )
        );
        await fs.writeFile(path.join(output, `${name}.png`), pixels);
        const layout = await page
          .locator('.molly-intro')
          .evaluate((el) => ({ overflow: el.scrollWidth - el.clientWidth }));
        assert(layout.overflow <= 1);
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        assert.equal(await count(), '03 / 03');
        await page.keyboard.press('Tab');
        assert(
          await page.locator('.molly-intro-start').evaluate((el) => el === document.activeElement)
        );
        await page.keyboard.press('Enter');
        await page
          .getByRole('heading', {
            name: locale === 'en' ? 'Connect a model' : '连接模型',
            exact: true,
          })
          .waitFor();
        assert(
          await page.evaluate(() => {
            const chrome = document.createElement('button');
            document.body.append(chrome);
            const event = new KeyboardEvent('keydown', {
              key: 'Tab',
              bubbles: true,
              cancelable: true,
            });
            chrome.dispatchEvent(event);
            chrome.remove();
            return event.defaultPrevented;
          })
        );
        await page
          .getByRole('button', { name: locale === 'en' ? 'Back' : '返回', exact: true })
          .click();
        assert.equal(await count(), '01 / 03');
        await page.clock.runFor(3000);
        assert.equal(await count(), reduced ? '01 / 03' : '02 / 03');
        if (locale === 'en' && reduced) {
          await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((candidate) => candidate.getTitle() === 'Molly')
              .webContents.setZoomFactor(2)
          );
          await selectors.nth(2).focus();
          await page.keyboard.press('Enter');
          assert.equal(await count(), '03 / 03');
          await page.keyboard.press('Tab');
          assert(
            await page.locator('.molly-intro-start').evaluate((el) => el === document.activeElement)
          );
          await page.screenshot();
          const zoomPixels = Buffer.from(
            await app.evaluate(async ({ BrowserWindow }) =>
              Array.from(
                (
                  await BrowserWindow.getAllWindows()
                    .find((candidate) => candidate.getTitle() === 'Molly')
                    .webContents.capturePage()
                ).toPNG()
              )
            )
          );
          await fs.writeFile(path.join(output, 'step2-en-reduced-200.png'), zoomPixels);
        }
        results.push({
          locale,
          reduced,
          width,
          height,
          keyboard: 'Tab / Enter / Space',
          manualHold: true,
          freshVisit: true,
          ...layout,
        });
        console.log(name + ': PASS');
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await fs.writeFile(path.join(output, 'step2-results.json'), JSON.stringify(results, null, 2));
    await app.close();
    if (savedBounds) await fs.writeFile(windowConfig, savedBounds);
    else await fs.rm(windowConfig, { force: true });
  }
  assert.equal(results.length, 4);
  console.log(
    'PASS: four bilingual native reading flows, keyboard focus/activation, reduced motion and fresh Back visits; enlarged minimum-window keyboard handoff remains reachable'
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
