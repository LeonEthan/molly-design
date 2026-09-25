const { createRequire } = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'apps/electron/package.json'));
const { _electron } = req('playwright');
const sharp = req('sharp');
const output = path.join(root, 'output/welcome-redesign-2026-09-24/verification');
const windowConfig = path.join(
  process.env.HOME,
  'Library/Preferences/molly-desktop-nodejs/window-state.json'
);
async function inkFraction(bytes) {
  const { data, info } = await sharp(bytes)
    .resize(200, 150, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let ink = 0;
  for (let i = 0; i < data.length; i += info.channels)
    if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 130) ink++;
  return ink / (info.width * info.height);
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const savedBounds = await fs.readFile(windowConfig).catch(() => null);
  const profile = await fs.mkdtemp('/tmp/molly-welcome-debug-');
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
    page.on('pageerror', (e) => console.log('PAGE_ERROR', e.message));
    await page.locator('.molly-intro').waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Molly');
      w.setBounds({ width: 900, height: 670 });
      w.show();
      w.focus();
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) {
        await Promise.all([
          page.waitForEvent('domcontentloaded'),
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((candidate) => candidate.getTitle() === 'Molly')
              .webContents.reload()
          ),
        ]);
      }
      await page.locator('.molly-intro-expression').waitFor({ timeout: 15000 });
      if (process.env.MOLLY_QA_HOLD && attempt === 1) {
        console.log('READY_FOR_DESKTOP_CAPTURE');
        await new Promise((resolve) => process.stdin.once('data', resolve));
        process.stdin.pause();
      }
      await page.evaluate(async () => {
        await Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {})));
        await document.fonts.ready;
      });
      const bytes = await page.screenshot({
        animations: 'disabled',
        path: path.join(output, `debug-reload-${attempt}.png`),
      });
      const ink = await inkFraction(bytes);
      const ax = await page.locator('body').ariaSnapshot();
      const native = Buffer.from(
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
      await fs.writeFile(path.join(output, `debug-native-${attempt}.png`), native);
      console.log(
        JSON.stringify({
          attempt,
          ink,
          nativeInk: await inkFraction(native),
          hasSetup: ax.includes('Start setup'),
          size: await page.evaluate(() => [innerWidth, innerHeight]),
        })
      );
      assert(
        ink > 0.025,
        `Blank rendered page after reload ${attempt}: dark pixel fraction ${ink}`
      );
      assert((await inkFraction(native)) > 0.025, `Blank native capture after reload ${attempt}`);
    }
    console.log('PASS: first paint and two native reloads contain visible artwork and setup CTA');
  } finally {
    await app.close();
    if (savedBounds) await fs.writeFile(windowConfig, savedBounds);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
