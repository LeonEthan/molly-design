const fs = require('node:fs');
const path = require('node:path');
const { BASE, WEBSITE, launch } = require('./qa/lib.cjs');

const output = path.resolve(process.argv[2] || path.join(WEBSITE, 'docs', 'COPY.md'));

async function main() {
  const browser = await launch();
  const out = {};
  for (const lang of ['en', 'zh']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript((language) => localStorage.setItem('molly-lang', language), lang);
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      document.querySelectorAll('details').forEach((details) => (details.open = true));
      document.querySelectorAll('[hidden]').forEach((element) => (element.hidden = false));
    });
    out[lang] = await page.evaluate(() => {
      const parts = [
        ...document.querySelectorAll('body > header, main > section, body > section, main > *, body > footer'),
      ].filter((element, _, all) => !all.some((other) => other !== element && other.contains(element)));
      return {
        github: {
          label: document.querySelector('.nav-github').getAttribute('aria-label'),
          title: document.querySelector('.nav-github').title,
          footer: document.querySelector('.footer-github').innerText,
        },
        title: document.title,
        desc: document.querySelector('meta[name=description]').content,
        blocks: parts.map((element) => ({
          id: element.id || element.tagName.toLowerCase(),
          text: element.innerText.replace(/\n{3,}/g, '\n\n').trim(),
        })),
        alts: [...document.querySelectorAll('img[alt],video[aria-label],[role=img][aria-label]')]
          .map((element) => element.getAttribute('alt') || element.getAttribute('aria-label'))
          .filter(Boolean),
      };
    });
    await page.close();
  }
  await browser.close();

  let md =
    '# COPY — final EN + CN copy\n\nGenerated from the built `dist/index.html` (rendered in each language) by `scripts/copy.cjs`, so it matches what ships. Source of truth: `src/slots.json` + `build.py`.\n\n';
  md += `## Meta\n\n- EN title: ${out.en.title}\n- Description (bilingual): ${out.en.desc}\n\n`;
  out.en.blocks.forEach((block, i) => {
    const zh = out.zh.blocks[i];
    md += `## ${block.id}\n\n### EN\n\n\`\`\`text\n${block.text}\n\`\`\`\n\n### 中文\n\n\`\`\`text\n${zh ? zh.text : ''}\n\`\`\`\n\n`;
  });
  md +=
    '## Image and video alt text\n\n| EN | 中文 |\n|---|---|\n' +
    out.en.alts.map((alt, i) => `| ${alt} | ${out.zh.alts[i] || ''} |`).join('\n') +
    '\n';
  md +=
    '\n## GitHub navigation\n\n| Attribute | EN | 中文 |\n|---|---|---|\n' +
    ['label', 'title', 'footer'].map((key) => `| ${key} | ${out.en.github[key]} | ${out.zh.github[key]} |`).join('\n') +
    '\n';
  fs.writeFileSync(output, md);
  console.log(`wrote ${output}: ${out.en.blocks.length} blocks, ${out.en.alts.length} alt texts`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
