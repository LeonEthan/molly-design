const fs = require('node:fs');
const path = require('node:path');
const { BASE, WEBSITE, launch, sleep, run } = require('./lib.cjs');

const lang = process.env.QA_LANG;
const width = Number(process.env.QA_WIDTH) || 1280;
const csp = /Content-Security-Policy: (.*)/
  .exec(fs.readFileSync(path.join(WEBSITE, 'dist', '_headers'), 'utf8'))[1]
  .replace('upgrade-insecure-requests', '');

run(`csp ${lang || 'auto'} ${width}`, async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || /Content Security/.test(message.text())) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.route('**/*', async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    if (route.request().resourceType() === 'document') headers['content-security-policy'] = csp;
    await route.fulfill({ response, headers });
  });
  if (lang) await page.addInitScript((language) => localStorage.setItem('molly-lang', language), lang);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  for (let y = 0; y < 16000; y += 700) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await sleep(page, 120);
  }
  await page.locator('#demo').scrollIntoViewIfNeeded();
  await sleep(page, 1500);
  const video = await page.evaluate(() => {
    const element = document.querySelector('video');
    return { time: element.currentTime, readyState: element.readyState };
  });
  const broken = await page.evaluate(
    () => [...document.images].filter((image) => image.complete && image.naturalWidth === 0).length
  );
  console.log('csp errors', JSON.stringify(errors), 'video', JSON.stringify(video), 'broken', broken);
  await browser.close();
  const failures = [];
  if (errors.length) failures.push(`console/CSP errors: ${errors.join(' | ')}`);
  if (!(video.time > 0)) failures.push(`demo video did not play (${JSON.stringify(video)})`);
  if (broken) failures.push(`${broken} broken images`);
  return failures;
});
