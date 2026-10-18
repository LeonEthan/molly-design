const fs = require('node:fs');
const path = require('node:path');

const MINIMUM = { performance: 95, accessibility: 100, 'best-practices': 100, seo: 100 };
const failures = [];
for (const file of process.argv.slice(2)) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const name = path.basename(file, '.json');
  const scores = Object.fromEntries(
    Object.keys(MINIMUM).map((category) => [category, Math.round(report.categories[category].score * 100)])
  );
  const audit = (id) => report.audits[id].displayValue;
  console.log(
    name,
    JSON.stringify(scores),
    `LCP ${audit('largest-contentful-paint')}`,
    `TBT ${audit('total-blocking-time')}`,
    `CLS ${audit('cumulative-layout-shift')}`,
    `LCP element ${report.audits['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.selector ?? 'n/a'}`
  );
  for (const [category, minimum] of Object.entries(MINIMUM))
    if (scores[category] < minimum) failures.push(`${name} ${category} ${scores[category]} < ${minimum}`);
}
if (failures.length) {
  console.log(`FAIL lighthouse: ${failures.join('; ')}`);
  process.exitCode = 1;
} else {
  console.log('PASS lighthouse');
}
