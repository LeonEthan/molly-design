const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const OUT = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts';
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8790/';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const combos = [
    ['en', 'light', 1440],
    ['en', 'dark', 1440],
    ['zh', 'light', 1440],
    ['zh', 'dark', 1440],
    ['en', 'light', 390],
    ['en', 'dark', 390],
    ['zh', 'light', 390],
    ['zh', 'dark', 390],
  ];
  for (const [lang, theme, width] of combos) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
    await page.addInitScript(
      ({ lang, theme }) => {
        localStorage.setItem('molly-lang', lang);
        localStorage.setItem('molly-theme', theme);
      },
      { lang, theme }
    );
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(OUT, `site175-${lang}-${theme}-${width}.png`),
      fullPage: true,
    });
    await page.close();
  }

  const videoPath = path.join(OUT, 'site175-hero-recording.webm');
  const recordPage = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  });
  await recordPage.addInitScript(() => {
    localStorage.setItem('molly-lang', 'en');
    localStorage.setItem('molly-theme', 'light');
  });
  await recordPage.goto(BASE, { waitUntil: 'networkidle' });
  await recordPage.locator('.stage').scrollIntoViewIfNeeded();
  await recordPage.waitForTimeout(10000);
  await recordPage.close();
  const webms = fs.readdirSync(OUT).filter((f) => f.endsWith('.webm'));
  const latest = webms.sort().pop();
  if (latest) fs.renameSync(path.join(OUT, latest), videoPath);

  await browser.close();
  console.log('artifacts written to', OUT);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
