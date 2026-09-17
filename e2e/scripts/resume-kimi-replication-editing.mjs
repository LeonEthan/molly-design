#!/usr/bin/env node
// Rechecks visible editing against a copied retained profile. It never dispatches a model turn.
import { register } from 'tsx/esm/api';
register();
const { ElectronHarness } = await import('../src/support/electron-harness.ts');
const { KimiReplicationPage } = await import('../src/support/pages/kimi-replication-page.ts');
const { verifyKimiEditing, sha } = await import('./kimi-replication-evidence.mjs');
import { parseArgs } from 'node:util';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { expect } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const acceptanceRoot = join(root, 'e2e/artifacts/acceptance/molly-kimi-magsafe-replication');
const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    round: { type: 'string' },
  },
});
if (!values.source || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(values.round ?? '')) {
  throw Error(
    'usage: node e2e/scripts/resume-kimi-replication-editing.mjs --source <round-directory> --round <fresh-id>'
  );
}

const source = resolve(values.source);
const sourceReport = JSON.parse(await readFile(join(source, 'report.json'), 'utf8'));
assert.equal(sourceReport.case, 'molly-kimi-magsafe-replication');
assert.equal(sourceReport.technical, 'passed', 'Source round must have passed technical checks');
assert.equal(sourceReport.receipts?.length, 1, 'Source round must contain exactly one model receipt');
assert.equal(sourceReport.receipts[0]?.status, 'committed');
const artworkId = sourceReport.artworkId;
assert.equal(typeof artworkId, 'string');

await mkdir(acceptanceRoot, { recursive: true });
const directory = join(acceptanceRoot, values.round);
await mkdir(directory, { mode: 0o700 });
for (const name of ['reference.jpg', 'canonical.json', 'golden.png', 'golden.jpeg']) {
  await copyFile(join(source, name), join(directory, name));
}
const original = JSON.parse(await readFile(join(directory, 'canonical.json'), 'utf8'));
const { width, height } = original.doc.canvas;
const report = {
  case: sourceReport.case,
  phase: 'editing-resume',
  parentRound: basename(source),
  parentReportSha256: sha(await readFile(join(source, 'report.json'))),
  artworkId,
  modelCall: false,
  startedAt: new Date().toISOString(),
  source: {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty:
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '',
  },
  technical: 'passed',
  inheritedTechnicalFrom: basename(source),
  editing: { status: 'running' },
  visual: { status: 'pending', inheritedOutputFrom: basename(source) },
  overall: 'running',
  exports: structuredClone(sourceReport.exports),
};
const persist = () => writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
const h = new ElectronHarness({ rootDir: directory, scenarioDir: directory, stableId: 'kimi-editing-resume' });
const ui = new KimiReplicationPage(h);

try {
  await persist();
  await h.launchReviewProfile(join(source, 'review-profile'));
  await h.app.evaluate(({ session }) => session.defaultSession.clearCache());
  await expect
    .poll(
      async () => {
        try {
          return (await ui.ipc('design.read', artworkId))?.revisionId ?? false;
        } catch {
          return false;
        }
      },
      { timeout: 120_000 }
    )
    .toBeTruthy();
  await ui.page.evaluate((id) => {
    window.location.hash = `/local/sessions/${encodeURIComponent(id)}`;
  }, artworkId);
  await expect(ui.page).toHaveURL(/#\/local\/sessions\/[^/?#]+(?:\?.*)?$/, {
    timeout: 120_000,
  });
  await ui.canvas(artworkId);
  assert.deepEqual((await ui.ipc('design.read', artworkId)).doc, original.doc);
  const dataRoot = await h.app.evaluate(() => (process.env.MOLLY_DATA_DIR ?? process.env.LODY_DATA_DIR));
  const workdir = join(dataRoot, 'chats', artworkId);
  const authoring = await import(
    pathToFileURL(join(workdir, '.claude/skills/graphic-design/scripts/lib/molly-authoring.mjs')).href
  );
  const exportAndRecord = async (label, format) => {
    const name = `${label}.${format}`;
    await ui.export(artworkId, format, join(directory, name));
    const bytes = await readFile(join(directory, name));
    const dimensions = await h.app.evaluate(
      ({ nativeImage }, encoded) =>
        nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')).getSize(),
      bytes.toString('base64')
    );
    assert.deepEqual(dimensions, { width, height });
    report.exports[name] = { sha256: sha(bytes), bytes: bytes.length, ...dimensions };
    return sha(bytes);
  };
  await verifyKimiEditing(h, {
    directory,
    artworkId,
    dataRoot,
    report,
    original,
    authoring,
    exportAndRecord,
  });
  await h.page.screenshot({ path: join(directory, 'desktop.png') });
  report.overall = 'editing-passed-visual-pending';
} catch (error) {
  report.editing = { status: 'failed', error: String(error) };
  report.overall = 'failed';
  report.error = String(error);
  process.exitCode = 1;
  console.error(String(error));
} finally {
  report.finishedAt = new Date().toISOString();
  if (h.page && !h.page.isClosed()) {
    await h.page.screenshot({ path: join(directory, 'last-desktop.png') }).catch(() => {});
  }
  if (h.app) {
    await h.captureSnapshot().catch(() => {});
    await h.captureCliBacklog().catch(() => {});
    h.writeDiagnostics();
    await h.close().catch((error) => {
      report.teardownError = String(error);
      process.exitCode = 1;
    });
  }
  await persist();
  console.log(`Editing evidence: ${directory}; verdict: ${report.overall}`);
}
