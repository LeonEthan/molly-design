const { BASE, launch, run } = require('./lib.cjs');

const lang = process.env.QA_LANG;
const width = Number(process.env.QA_WIDTH) || 1440;
const checkExternal = process.env.QA_EXTERNAL_LINKS === '1';
const ROOT_FILES = [
  '/404.html',
  '/robots.txt',
  '/sitemap.xml',
  '/_headers',
  '/og.png',
  '/favicon.ico',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/site.webmanifest',
];

run(`a11y ${lang || 'auto'} ${width}`, async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const failures = [];
  if (lang) await page.addInitScript((language) => localStorage.setItem('molly-lang', language), lang);
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const reduced = await page.evaluate(() => ({
    videos: [...document.querySelectorAll('video')].map((video) => ({
      autoplay: video.autoplay,
      paused: video.paused,
      poster: Boolean(video.poster),
      controls: video.controls,
    })),
    runningAnimations: document.getAnimations().filter((animation) => animation.playState === 'running').length,
  }));
  console.log('reduced', JSON.stringify(reduced));
  if (reduced.runningAnimations) failures.push(`${reduced.runningAnimations} animations running under reduced motion`);
  if (reduced.videos.some((video) => video.autoplay || !video.paused || !video.poster))
    failures.push('a video autoplays or lacks a poster under reduced motion');

  const focusStops = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    focusStops.push(
      await page.evaluate(() => {
        const element = document.activeElement;
        const style = getComputedStyle(element);
        const label = (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 22);
        const ring = style.outlineStyle !== 'none' || style.boxShadow !== 'none' ? 'ring' : 'NORING';
        return `${element.tagName}${element.id ? `#${element.id}` : ''}:${label}|${ring}`;
      })
    );
  }
  console.log(focusStops.join('\n'));

  const missingAlt = await page.evaluate(() =>
    [...document.images]
      .filter((image) => !image.alt && image.getAttribute('aria-hidden') !== 'true' && !image.closest('[aria-hidden=true]'))
      .map((image) => image.src)
  );
  console.log('noalt', missingAlt);
  if (missingAlt.length) failures.push(`images without alt: ${missingAlt.join(', ')}`);

  const links = await page.evaluate(() => [
    ...new Set(
      [
        ...document.querySelectorAll(
          'a[href],link[href],source[srcset],img[src],video[src],video[poster],source[src]'
        ),
      ]
        .flatMap((element) => [
          element.getAttribute('href'),
          element.getAttribute('src'),
          element.getAttribute('poster'),
          ...(element.getAttribute('srcset') || '').split(',').map((entry) => entry.trim().split(' ')[0]),
        ])
        .filter(Boolean)
    ),
  ]);
  const origin = new URL(BASE).origin;
  const badLinks = [];
  for (const link of links) {
    if (link.startsWith('#') || link.startsWith('mailto')) continue;
    const url = new URL(link, BASE);
    if (url.origin !== origin && !checkExternal) {
      console.log('external link check skipped', url.href);
      continue;
    }
    const status = await page.request
      .get(url.href, { maxRedirects: 0 })
      .then((response) => response.status())
      .catch(() => 'ERR');
    if (!(status === 200 || (url.origin !== origin && typeof status === 'number' && status < 400)))
      badLinks.push(`${status} ${link}`);
  }
  console.log('links', links.length, 'bad', badLinks);
  if (badLinks.length) failures.push(`bad links: ${badLinks.join(', ')}`);

  for (const file of [...ROOT_FILES, '/nope']) {
    const status = (await page.request.get(new URL(file, BASE).href)).status();
    console.log(file, status);
    const expected = file === '/nope' ? 404 : 200;
    if (status !== expected) failures.push(`${file} returned ${status}, expected ${expected}`);
  }
  await browser.close();
  return failures;
});
