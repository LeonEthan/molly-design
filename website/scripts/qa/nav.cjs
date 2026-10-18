const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { BASE, OUT, SHOTS, buildConstant, launch, run } = require('./lib.cjs');

const GH = buildConstant('GH');
const LABEL = { en: 'Molly Design on GitHub', zh: '在 GitHub 上查看 Molly Design' };
const HOVER_COLOR = 'rgb(162, 240, 140)';

run('nav', async () => {
  const browser = await launch();
  const origin = new URL(BASE).origin;
  const results = [];
  const failures = [];
  for (const lang of ['en', 'zh'])
    for (const width of [1440, 768, 390, 360]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        deviceScaleFactor: 2,
        locale: lang === 'en' ? 'en-US' : 'zh-CN',
        reducedMotion: 'reduce',
      });
      const requests = [];
      page.on('request', (request) => requests.push(request.url()));
      try {
        await page.goto(BASE, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        const github = page.locator('.nav-github');
        const expectLanguage = async (language) => {
          assert.equal(await github.getAttribute('aria-label'), LABEL[language]);
          assert.equal(await github.getAttribute('title'), LABEL[language]);
          assert.equal(await page.locator('html').getAttribute('data-lang'), language);
        };
        await expectLanguage(lang);
        const other = lang === 'en' ? 'zh' : 'en';
        await page.locator(`[data-set="${other}"]`).click();
        await expectLanguage(other);
        await page.locator(`[data-set="${lang}"]`).click();
        await expectLanguage(lang);

        const metrics = await page.evaluate(() => {
          const measure = (selector) => {
            const box = document.querySelector(selector).getBoundingClientRect();
            return { x: box.x, y: box.y, w: box.width, h: box.height, right: box.right, bottom: box.bottom };
          };
          return {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth,
            brand: measure('.brand'),
            github: measure('.nav-github'),
            toggle: measure('.lang'),
            menu: measure('.menu'),
            color: getComputedStyle(document.querySelector('.nav-github')).color,
          };
        });
        assert.equal(metrics.scrollWidth, width);
        assert.equal(metrics.github.w, 36);
        assert.equal(metrics.github.h, 36);
        assert(metrics.brand.right <= metrics.github.x);
        assert(metrics.github.right <= metrics.toggle.x);
        if (width <= 860) assert(metrics.toggle.right <= metrics.menu.x);

        for (const selector of ['.nav-github', '.footer-github']) {
          const link = page.locator(selector);
          assert.equal(await link.getAttribute('href'), GH);
          assert.equal(await link.getAttribute('target'), '_blank');
          assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
          const svg = link.locator('svg');
          assert.equal(await svg.getAttribute('viewBox'), '0 0 16 16');
          assert.equal(await svg.getAttribute('fill'), 'currentColor');
          assert.equal(await svg.getAttribute('aria-hidden'), 'true');
          assert.equal(await svg.getAttribute('focusable'), 'false');
          assert.equal(await svg.locator('path').count(), 1);
        }

        await page.mouse.move(0, 0);
        if (width === 1440) {
          await page.locator('.top').screenshot({ path: path.join(SHOTS, `nav-${lang}-1440.png`) });
          if (lang === 'en') {
            await github.hover();
            await page.waitForFunction(
              (color) => getComputedStyle(document.querySelector('.nav-github')).color === color,
              HOVER_COLOR
            );
            await page.locator('.top').screenshot({ path: path.join(SHOTS, 'nav-hover-1440.png') });
            await page.mouse.move(0, 0);
            await page.locator('.brand').focus();
            for (let i = 0; i < 10 && !(await github.evaluate((element) => element === document.activeElement)); i++)
              await page.keyboard.press('Tab');
            metrics.focus = await github.evaluate((element) => ({
              active: element === document.activeElement,
              visible: element.matches(':focus-visible'),
              outline: getComputedStyle(element).outlineStyle,
              outlineWidth: getComputedStyle(element).outlineWidth,
            }));
            assert(
              metrics.focus.active &&
                metrics.focus.visible &&
                metrics.focus.outline === 'solid' &&
                metrics.focus.outlineWidth === '2px'
            );
            await page.locator('.top').screenshot({ path: path.join(SHOTS, 'nav-focus-1440.png') });
            await page.locator('footer').scrollIntoViewIfNeeded();
            await github.evaluate((element) => element.blur());
            await page.locator('footer').screenshot({ path: path.join(SHOTS, 'nav-footer.png') });
          }
        }
        if (width === 390 && lang === 'en')
          await page.locator('.top').screenshot({ path: path.join(SHOTS, 'nav-en-390.png') });
        if (width <= 860) {
          await page.locator('.menu').click();
          assert.equal(await page.locator('html').evaluate((element) => element.scrollWidth), width);
          assert(await github.isVisible());
          await page.locator('.menu').click();
        }
        const external = requests.filter((url) => new URL(url).origin !== origin);
        assert.deepEqual(external, []);
        results.push({ lang, width, ...metrics, initialDetectionAndToggle: true, externalRequests: 0 });
        console.log('ok', lang, width);
      } catch (error) {
        failures.push(`${lang} ${width}: ${error.message}`);
      }
      await page.close();
    }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'nav-checks.json'), JSON.stringify(results, null, 2));
  console.log(`nav: ${results.length}/8`);
  return failures;
});
