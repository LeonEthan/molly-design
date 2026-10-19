const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const WEBSITE = path.resolve(__dirname, '..', '..');
const OUT = process.env.ARTIFACT_DIR || path.join(WEBSITE, 'qa-output', 'captures');
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
    const missing = await page.evaluate(async () => {
      document.querySelectorAll('img[loading="lazy"]').forEach((image) => {
        image.loading = 'eager';
      });
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const step = 400;
      let y = 0;
      while (y < document.documentElement.scrollHeight) {
        window.scrollTo(0, y);
        await sleep(150);
        y += step;
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(200);
      window.scrollTo(0, 0);
      const visible = [...document.images].filter((image) => {
        if (image.closest('[hidden]')) return false;
        for (let node = image; node && node !== document.body; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return true;
      });
      await Promise.all(
        visible.map(
          (image) =>
            new Promise((resolve) => {
              if (image.complete && image.naturalWidth > 0) {
                resolve();
                return;
              }
              const done = () => resolve();
              image.addEventListener('load', done, { once: true });
              image.addEventListener('error', done, { once: true });
              setTimeout(done, 10000);
            })
        )
      );
      return visible
        .filter((image) => !(image.complete && image.naturalWidth > 0))
        .map((image) => image.currentSrc || image.src);
    });
    if (missing.length) throw new Error(`visible images failed to load: ${missing.join(', ')}`);
    const shot = path.join(OUT, `site175-${lang}-${theme}-${width}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    console.log('wrote', shot);
    await page.close();
  }
  if (process.env.SKIP_VIDEO === '1') {
    await browser.close();
    console.log('artifacts written to', OUT);
    return;
  }

  const videoPath = path.join(OUT, 'site175-hero-recording.webm');
  const recordPage = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  });
  const recording = recordPage.video();
  await recordPage.addInitScript(() => {
    localStorage.setItem('molly-lang', 'en');
    localStorage.setItem('molly-theme', 'light');
  });
  await recordPage.goto(BASE, { waitUntil: 'networkidle' });
  await recordPage.locator('.stage').scrollIntoViewIfNeeded();
  await recordPage.waitForTimeout(10000);
  await recordPage.close();
  if (recording) await recording.saveAs(videoPath);

  await browser.close();
  console.log('artifacts written to', OUT);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
