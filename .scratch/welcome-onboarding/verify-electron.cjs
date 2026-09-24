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
const cases = [];
(async () => {
  const savedBounds = await fs.readFile(windowConfig).catch(() => null);
  const profile = await fs.mkdtemp('/tmp/molly-welcome-matrix-');
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
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.locator('.molly-intro').waitFor();
    await page.clock.install({ time: new Date('2026-09-24T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-09-24T00:00:01Z'));
    for (const locale of ['zh_CN', 'en']) {
      for (const [width, height] of [
        [900, 670],
        [620, 600],
      ]) {
        for (const zoom of [1, ...(width === 900 ? [1.5] : [2])]) {
          await app.evaluate(
            ({ BrowserWindow }, b) => {
              const w = BrowserWindow.getAllWindows().find(
                (candidate) => candidate.getTitle() === 'Molly'
              );
              w.setBounds({ width: b.width, height: b.height });
              w.webContents.setZoomFactor(b.zoom);
            },
            { width, height, zoom }
          );
          await page.evaluate((selectedLocale) => {
            localStorage.setItem('molly-language', JSON.stringify(selectedLocale));
            localStorage.setItem('molly-desktop-onboarding-phase', JSON.stringify('ceremony'));
          }, locale);
          await page.reload();
          await page.locator('.molly-intro-inspiration').waitFor();
          const scenes = ['inspiration', 'creation', 'expression'];
          for (let index = 0; index < scenes.length; index++) {
            if (index) await page.clock.runFor(3000);
            const scene = scenes[index];
            await page.locator(`.molly-intro-${scene}`).waitFor();
            await page.evaluate(async () => {
              await Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {})));
              await document.fonts.ready;
            });
            const actualLang = await page.locator('.molly-intro').getAttribute('lang');
            assert.equal(actualLang, locale === 'en' ? 'en' : 'zh-CN');
            assert.equal(
              await page.locator('.molly-intro-count').textContent(),
              `0${index + 1} / 03`
            );
            const name = `${locale}-${width}x${height}-${Math.round(zoom * 100)}-${scene}`;
            await page.locator('.molly-intro').evaluate((e) => {
              e.scrollTop = 0;
            });
            const before = await page.evaluate(() => {
              const host = document.querySelector('.molly-intro');
              const sound = document.querySelector('.molly-intro-sound');
              const s = sound.getBoundingClientRect();
              const heading = document.querySelector('h1');
              const range = document.createRange();
              range.selectNodeContents(heading);
              const text = range.getBoundingClientRect();
              return {
                viewport: [innerWidth, innerHeight],
                headerTop: s.top,
                horizontalOverflow: host.scrollWidth - host.clientWidth,
                headingLeft: text.left,
                headingRight: text.right,
                scene: document.querySelector('main').getBoundingClientRect().toJSON(),
                footer: document.querySelector('footer').getBoundingClientRect().toJSON(),
              };
            });
            const failures = [];
            if (before.headerTop < 0) failures.push('sound clipped at scroll origin');
            if (before.horizontalOverflow > 1) failures.push('horizontal overflow');
            if (
              scene !== 'expression' &&
              (before.headingLeft < 0 || before.headingRight > before.viewport[0] + 1)
            )
              failures.push('heading clipped');
            if (before.scene.bottom > before.footer.top + 1) failures.push('scene overlaps footer');
            await page.evaluate(async () => {
              await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
            });
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
            await fs.writeFile(path.join(output, name + '.png'), pixels);
            const action = page.locator('.molly-intro-footer button');
            await action.scrollIntoViewIfNeeded();
            const hit = await action.evaluate((e) => {
              const r = e.getBoundingClientRect();
              return (
                r.top >= 0 &&
                r.bottom <= innerHeight &&
                e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
              );
            });
            if (!hit) failures.push('setup/skip not reachable');
            cases.push({ name, ...before, failures });
            console.log(JSON.stringify({ name, failures }));
          }
          await page.clock.runFor(30000);
          assert(await page.locator('.molly-intro-expression').isVisible());
          await page.locator('.molly-intro-footer button').click();
          await page
            .getByRole('heading', {
              name: locale === 'en' ? 'Connect a model' : '连接模型',
              exact: true,
            })
            .waitFor();
          await page
            .getByRole('button', { name: locale === 'en' ? 'Back' : '返回', exact: true })
            .click();
          await page.locator('.molly-intro-inspiration').waitFor();
          await page.locator('.molly-intro-footer button').click();
          await page
            .getByRole('heading', {
              name: locale === 'en' ? 'Connect a model' : '连接模型',
              exact: true,
            })
            .waitFor();
        }
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await fs.writeFile(path.join(output, 'matrix-results.json'), JSON.stringify(cases, null, 2));
    await app.close();
    if (savedBounds) await fs.writeFile(windowConfig, savedBounds);
  }
  assert(
    cases.length === 24 && cases.every((c) => !c.failures.length),
    `Layout failed: ${cases.filter((c) => c.failures.length).length}/${cases.length}`
  );
  console.log(
    'PASS: 24 scenes: both languages at default/minimum sizes and the two previously failing zoom cases; all setup/skip/back paths work'
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
