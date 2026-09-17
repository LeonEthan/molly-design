#!/usr/bin/env node
// Separate, explicitly invoked live-model acceptance. Never part of deterministic CI.
import { register } from 'tsx/esm/api';
register();
const { ElectronHarness } = await import('../src/support/electron-harness.ts');
const { KimiReplicationPage } = await import('../src/support/pages/kimi-replication-page.ts');
const { collectKimiResult, REFERENCE_SHA256, sha } =
  await import('./kimi-replication-evidence.mjs');
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { expect } from '@playwright/test';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({
  options: {
    reference: { type: 'string' },
    round: { type: 'string' },
    phase: { type: 'string' },
    'timeout-ms': { type: 'string', default: '2700000' },
  },
});
if (
  !values.reference ||
  !/^[a-z0-9][a-z0-9-]{0,79}$/.test(values.round ?? '') ||
  !['baseline', 'single-file'].includes(values.phase)
)
  throw Error(
    'usage: node e2e/scripts/run-kimi-replication.mjs --reference <reference.jpg> --round <fresh-id> --phase baseline|single-file [--timeout-ms 2700000]'
  );
const timeout = Number(values['timeout-ms']);
if (!Number.isSafeInteger(timeout) || timeout <= 0)
  throw Error('timeout-ms must be a positive integer');
const reference = await readFile(resolve(values.reference));
if (sha(reference) !== REFERENCE_SHA256)
  throw Error('Reference must match the approved MagSafe image SHA-256');
const parent = join(root, 'e2e/artifacts/acceptance/molly-kimi-magsafe-replication');
await mkdir(parent, { recursive: true });
const directory = join(parent, values.round);
await mkdir(directory, { mode: 0o700 }); // exclusive; a failed round cannot be overwritten
await copyFile(resolve(values.reference), join(directory, 'reference.jpg'));
const report = {
  case: 'molly-kimi-magsafe-replication',
  phase: values.phase,
  prompt: '复刻这个设计',
  requiredConfiguration: { model: 'K3', reasoning: 'Thinking High' },
  timeoutMs: timeout,
  reference: { sha256: REFERENCE_SHA256, width: 285, height: 2000 },
  startedAt: new Date().toISOString(),
  source: {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty:
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '',
  },
  runtime: JSON.parse(
    await readFile(join(root, 'apps/cli/src/agent/kimi-runtime-manifest.json'), 'utf8')
  ),
  technical: 'running',
  editing: { status: 'pending' },
  visual: { status: 'pending' },
  overall: 'running',
  imageService:
    'No image service configured in the isolated profile; native call audit retained for review',
};
report.buildHashes = {};
for (const rel of [
  'apps/electron/out/main/index.js',
  'apps/electron/resources/cli/index.js',
  'apps/electron/resources/design/build.json',
])
  report.buildHashes[rel] = sha(await readFile(join(root, rel)));
const rendererEntry = 'apps/electron/out/renderer/index.html';
const rendererHtml = await readFile(join(root, rendererEntry));
report.buildHashes[rendererEntry] = sha(rendererHtml);
for (const asset of rendererHtml
  .toString()
  .matchAll(/(?:src|href)="\.\/assets\/(index-[^"]+\.(?:js|css))"/g)) {
  const rel = `apps/electron/out/renderer/assets/${asset[1]}`;
  report.buildHashes[rel] = sha(await readFile(join(root, rel)));
}
const persist = () => writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
const h = new ElectronHarness({
  rootDir: directory,
  scenarioDir: directory,
  stableId: 'kimi-replication',
});
const ui = new KimiReplicationPage(h);
try {
  console.log(`Golden ${values.phase}: ${directory}`);
  await persist();
  await h.launch();
  await ui.configure();
  report.configurationUi = await ui.page.locator('body').innerText();
  await ui.page.screenshot({ path: join(directory, 'configured.png') });
  report.artworkId = await ui.send(join(directory, 'reference.jpg'));
  report.dataRoot = await h.app.evaluate(() => (process.env.MOLLY_DATA_DIR ?? process.env.LODY_DATA_DIR));
  await persist();
  console.log(`Real Kimi task dispatched: ${report.artworkId}`);
  await expect(ui.page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({
    timeout: 120_000,
  });
  // Explicit terminal UI and durable receipt, not file appearance, define completion.
  await expect(ui.page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden({ timeout });
  await expect
    .poll(
      async () => {
        const input = join(report.dataRoot, 'chats', report.artworkId, 'design-input');
        const turns = await readdir(input);
        return (
          await Promise.all(
            turns.map(async (t) => (await readdir(join(input, t))).includes('receipt.json'))
          )
        ).some(Boolean);
      },
      { timeout: 60_000 }
    )
    .toBe(true);
  console.log('Kimi turn settled; checking commit, exports and native editing.');
  await collectKimiResult(h, {
    directory,
    artworkId: report.artworkId,
    dataRoot: report.dataRoot,
    report,
  });
} catch (error) {
  report.overall = 'failed';
  report.error = String(error);
  if (report.technical === 'running') report.technical = 'failed';
  else if (report.editing.status === 'pending')
    report.editing = { status: 'failed', error: String(error) };
  process.exitCode = 1;
  console.error(String(error));
} finally {
  report.finishedAt = new Date().toISOString();
  if (h.page && !h.page.isClosed())
    await h.page.screenshot({ path: join(directory, 'last-desktop.png') }).catch(() => {});
  if (h.app) {
    await h.captureSnapshot().catch(() => {});
    await h.captureCliBacklog().catch(() => {});
    h.writeDiagnostics();
    try {
      report.reviewProfile = await h.exportReviewProfile(join(directory, 'review-profile'));
    } catch (error) {
      report.teardownError = String(error);
      process.exitCode = 1;
      await h.close().catch(() => {});
    }
  }
  await persist();
  console.log(`Evidence: ${directory}; verdict: ${report.overall}`);
}
