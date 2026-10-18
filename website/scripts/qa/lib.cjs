const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const WEBSITE = path.resolve(__dirname, '..', '..');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8790/';
const OUT = path.resolve(process.env.QA_OUT || path.join(WEBSITE, 'qa-output'));
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

function buildConstant(name) {
  const source = fs.readFileSync(path.join(WEBSITE, 'build.py'), 'utf8');
  const match = new RegExp(`^${name} = '([^']+)'`, 'm').exec(source);
  if (!match) throw new Error(`build.py constant ${name} not found`);
  return match[1];
}

function launch() {
  return chromium.launch({ channel: process.env.QA_CHROME_CHANNEL || 'chrome' });
}

function sleep(page, ms) {
  return page.waitForTimeout(ms);
}

function finish(name, failures) {
  if (failures.length) {
    console.log(`FAIL ${name}: ${failures.length} failure(s)`);
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${name}`);
  }
}

function run(name, main) {
  main().then(
    (failures) => finish(name, failures),
    (error) => finish(name, [String(error && error.stack ? error.stack : error)])
  );
}

module.exports = { WEBSITE, BASE, OUT, SHOTS, buildConstant, launch, sleep, run };
