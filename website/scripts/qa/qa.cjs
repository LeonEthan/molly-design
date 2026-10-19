const path = require('node:path');
const { BASE, SHOTS, launch, run } = require('./lib.cjs');

const motion = process.argv[2] || 'reduce';

run(`qa ${motion}`, async () => {
  const browser = await launch();
  const failures = [];
  let passed = 0;
  let total = 0;
  for (const lang of ['en', 'zh'])
    for (const width of [360, 390, 640, 768, 1024, 1440]) {
      total++;
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: motion });
      const errors = [];
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning')
          errors.push(`${message.type()}: ${message.text()} @ ${message.location().url || 'unknown'}`);
      });
      page.on('pageerror', (error) => errors.push(String(error)));
      page.on('requestfailed', (request) =>
        errors.push(`requestfailed ${request.resourceType()} ${request.url()}: ${request.failure()?.errorText}`)
      );
      page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
      });
      await page.addInitScript((language) => localStorage.setItem('molly-lang', language), lang);
      await page.goto(BASE, { waitUntil: 'networkidle' });
      const result = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const overflow = [];
        document.querySelectorAll('body *').forEach((element) => {
          const box = element.getBoundingClientRect();
          if (!box.width || (box.right <= viewportWidth + 1 && box.left >= -1)) return;
          if (getComputedStyle(element).position === 'fixed') return;
          if (element.classList.contains('skip')) return;
          for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement)
            if (['auto', 'hidden', 'scroll', 'clip'].includes(getComputedStyle(ancestor).overflowX)) return;
          overflow.push(`${element.tagName}.${element.className} ${Math.round(box.left)}..${Math.round(box.right)}`);
        });
        return {
          scrollWidth: document.documentElement.scrollWidth,
          viewportWidth,
          overflow: overflow.slice(0, 8),
          imagesWithoutDimensions: [...document.images].filter(
            (image) => !image.getAttribute('width') || !image.getAttribute('height')
          ).length,
          brokenImages: [...document.images]
            .filter((image) => image.complete && image.naturalWidth === 0)
            .map((image) => image.src),
        };
      });
      console.log(lang, width, JSON.stringify(result), errors.length ? JSON.stringify(errors) : '');
      const problems = [];
      if (result.scrollWidth !== result.viewportWidth)
        problems.push(`scrollWidth ${result.scrollWidth} != ${result.viewportWidth}`);
      if (result.overflow.length) problems.push(`overflow ${result.overflow.join(', ')}`);
      if (result.imagesWithoutDimensions) problems.push(`${result.imagesWithoutDimensions} images without width/height`);
      if (result.brokenImages.length) problems.push(`broken images ${result.brokenImages.join(', ')}`);
      if (errors.length) problems.push(`console/network ${errors.join(' | ')}`);
      if (problems.length) failures.push(`${lang} ${width}: ${problems.join('; ')}`);
      else passed++;
      await page.screenshot({ path: path.join(SHOTS, `qa-${lang}-${width}-${motion}.png`), fullPage: width !== 1440 });
      await page.close();
    }
  await browser.close();
  console.log(`qa ${motion}: ${passed}/${total}`);
  return failures;
});
