const { BASE, launch, sleep, run } = require('./lib.cjs');

const lang = process.env.QA_LANG;
const width = Number(process.env.QA_WIDTH) || 1440;

run(`pause ${lang || 'auto'} ${width}`, async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  if (lang) await page.addInitScript((language) => localStorage.setItem('molly-lang', language), lang);
  await page.goto(BASE, { waitUntil: 'load' });
  if ((await page.locator('.hs').count()) === 0) {
    console.log('pause: no hero loop');
    await browser.close();
    return [];
  }
  const stage = page.locator('.hs');
  const time = () => page.evaluate(() => document.querySelector('.hs').dataset.time);
  const setHidden = (hidden) =>
    page.evaluate((value) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  const results = {};

  await stage.scrollIntoViewIfNeeded();
  await sleep(page, 2500);
  const onScreen = await time();
  await sleep(page, 400);
  results['running on screen'] = onScreen !== (await time());

  await page.evaluate(() => window.scrollTo(0, 5000));
  await sleep(page, 500);
  const offScreen = await time();
  await sleep(page, 800);
  results['paused off screen'] = offScreen === (await time());

  await stage.scrollIntoViewIfNeeded();
  await sleep(page, 500);
  const back = await time();
  await sleep(page, 400);
  results.resumed = back !== (await time());

  await setHidden(true);
  await sleep(page, 300);
  const hidden = await time();
  await sleep(page, 800);
  results['paused when hidden'] = hidden === (await time());

  await setHidden(false);
  await sleep(page, 300);
  const visible = await time();
  await sleep(page, 400);
  results['resumed visible'] = visible !== (await time());

  await browser.close();
  for (const [check, ok] of Object.entries(results)) console.log(check, ok);
  const passed = Object.values(results).filter(Boolean).length;
  console.log(`pause: ${passed}/${Object.keys(results).length}`);
  return Object.entries(results)
    .filter(([, ok]) => !ok)
    .map(([check]) => `${check} failed`);
});
