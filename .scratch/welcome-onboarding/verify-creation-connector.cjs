const { createRequire } = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'apps/electron/package.json'));
const { _electron } = req('playwright');
const output = path.join(root, 'output/welcome-redesign-2026-09-24/verification');
const zoomOnly = process.env.MOLLY_CONNECTOR_ZOOM_ONLY === '1';
const windowConfig = path.join(
  process.env.HOME,
  'Library/Preferences/molly-desktop-nodejs/window-state.json'
);
(async () => {
  const savedBounds = await fs.readFile(windowConfig).catch(() => null);
  const profile = await fs.mkdtemp('/tmp/molly-welcome-connector-');
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
    page.on('pageerror', (e) => errors.push(e.message));
    await page.locator('.molly-intro').waitFor();
    await page.clock.install({ time: new Date('2026-09-24T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-09-24T00:00:01Z'));
    for (const locale of ['zh_CN', 'en']) {
      await page.evaluate(
        (selectedLocale) => localStorage.setItem('molly-language', JSON.stringify(selectedLocale)),
        locale
      );
      await page.reload();
      await page.locator('.molly-intro-inspiration').waitFor();
      await page.clock.runFor(3000);
      await page.locator('.molly-intro-creation').waitFor();
      await page.evaluate(async () => {
        await Promise.all(Array.from(document.images).map((i) => i.decode()));
        await document.fonts.ready;
        await Promise.all(document.getAnimations().map((a) => a.finished));
      });
      for (const [width, height, zoom] of zoomOnly
        ? [[620, 600, 2]]
        : [
            [900, 670, 1],
            [620, 600, 1],
            [620, 600, 2],
          ]) {
        await app.evaluate(
          ({ BrowserWindow }, size) => {
            const w = BrowserWindow.getAllWindows().find(
              (candidate) => candidate.getTitle() === 'Molly'
            );
            w.setBounds({ width: size.width, height: size.height });
            w.webContents.setZoomFactor(size.zoom);
          },
          { width, height, zoom }
        );
        await page.waitForFunction(
          (size) => {
            if (
              Math.abs(innerWidth - size.width / size.zoom) > 1 ||
              Math.abs(innerHeight - size.height / size.zoom) > 1
            )
              return false;
            const p = document.querySelector('.molly-intro-connector path');
            const label = document.querySelector('.molly-intro-callout');
            if (!p || !label) return false;
            const endpoint = p
              .getPointAtLength(p.getTotalLength())
              .matrixTransform(p.getScreenCTM());
            const r = label.getBoundingClientRect();
            return (
              Math.abs(endpoint.x - r.left) < 1 && Math.abs(endpoint.y - r.top - r.height / 2) < 1
            );
          },
          { width, height, zoom },
          { polling: 50 }
        );
        if (zoom > 1) {
          await page.locator('.molly-intro-callout').scrollIntoViewIfNeeded();
          await page.screenshot();
        }
        const state = await page.evaluate(() => {
          const host = document.querySelector('.molly-intro');
          const p = document.querySelector('.molly-intro-connector path');
          const start = p.getPointAtLength(0).matrixTransform(p.getScreenCTM());
          const end = p.getPointAtLength(p.getTotalLength()).matrixTransform(p.getScreenCTM());
          return {
            lang: host.lang,
            overflow: host.scrollWidth - host.clientWidth,
            length: p.getTotalLength(),
            start: { x: start.x, y: start.y },
            end: { x: end.x, y: end.y },
            stroke: getComputedStyle(p).stroke,
            pointerEvents: getComputedStyle(p).pointerEvents,
          };
        });
        assert.equal(state.lang, locale === 'en' ? 'en' : 'zh-CN');
        assert(
          state.overflow <= 1 &&
            state.length > 20 &&
            state.stroke !== 'none' &&
            state.pointerEvents === 'none'
        );
        const name = `${locale}-${width}x${height}-${zoom * 100}-creation-connector`;
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
        results.push({ name, ...state });
        console.log(name + ': PASS');
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await fs.writeFile(
      path.join(
        output,
        zoomOnly ? 'creation-connector-zoom-results.json' : 'creation-connector-results.json'
      ),
      JSON.stringify(results, null, 2)
    );
    await app.close();
    if (savedBounds) await fs.writeFile(windowConfig, savedBounds);
    else await fs.rm(windowConfig, { force: true });
  }
  assert.equal(results.length, zoomOnly ? 2 : 6);
  console.log(`PASS: ${results.length} connector captures and attachment checks`);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
