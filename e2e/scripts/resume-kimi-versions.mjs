#!/usr/bin/env node
// Resume only the prescribed follow-up after a retained driver failure; never repeat replication.
import { register } from 'tsx/esm/api';
register();
const { ElectronHarness } = await import('../src/support/electron-harness.ts');
const { KimiReplicationPage } = await import('../src/support/pages/kimi-replication-page.ts');
const { verifyKimiVersions } = await import('./kimi-version-evidence.mjs');
const { sha, writeComparison } = await import('./kimi-replication-evidence.mjs');
import { strict as assert } from 'node:assert';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({
  options: { source: { type: 'string' }, round: { type: 'string' } },
});
assert.ok(values.source && /^[a-z0-9][a-z0-9-]{0,79}$/.test(values.round ?? ''));
const source = resolve(values.source);
const sourceBytes = await readFile(join(source, 'report.json'));
const parent = JSON.parse(sourceBytes);
assert.equal(parent.phase, 'unified-canvas');
assert.equal(parent.technical, 'passed');
assert.equal(parent.editing.status, 'passed');
assert.ok(parent.goldenVersion && parent.editedVersion);
for (const [path, digest] of Object.entries(parent.buildHashes))
  assert.equal(sha(await readFile(join(root, path))), digest, `Frozen build changed: ${path}`);
const input = join(source, 'review-profile/lody-data/chats', parent.artworkId, 'design-input');
const turns = await readdir(input);
assert.equal(turns.length, 1, 'Resume requires exactly one original dispatch; no paid retry');
assert.equal(JSON.parse(await readFile(join(input, turns[0], 'receipt.json'))).status, 'committed');
const directory = join(
  root,
  'e2e/artifacts/acceptance/molly-kimi-magsafe-replication',
  values.round
);
await mkdir(directory, { mode: 0o700 });
for (const name of [
  'reference.jpg',
  'canonical.json',
  'golden.png',
  'golden.jpeg',
  ...parent.liveCanvas.frames.flatMap((f) => [`${f.file}.json`, `${f.file}.png`]),
])
  await copyFile(join(source, name), join(directory, name));
const report = {
  ...parent,
  phase: 'unified-canvas-resume',
  parentRound: basename(source),
  parentReportSha256: sha(sourceBytes),
  startedAt: new Date().toISOString(),
  overall: 'running',
  versionFlow: { status: 'running' },
};
delete report.error;
delete report.finishedAt;
delete report.reviewProfile;
const persist = () => writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
const h = new ElectronHarness({
  rootDir: directory,
  scenarioDir: directory,
  stableId: 'kimi-versions-resume',
});
const ui = new KimiReplicationPage(h);
try {
  await persist();
  await h.launchReviewProfile(join(source, 'review-profile'));
  await ui.page.evaluate((id) => {
    window.location.hash = `/local/sessions/${encodeURIComponent(id)}`;
  }, parent.artworkId);
  await ui.canvas(parent.artworkId);
  report.dataRoot = await h.app.evaluate(() => process.env.MOLLY_DATA_DIR);
  await persist();
  console.log(`Resuming prescribed version follow-up: ${parent.artworkId}`);
  await verifyKimiVersions(h, {
    directory,
    artworkId: parent.artworkId,
    dataRoot: report.dataRoot,
    report,
    timeout: parent.timeoutMs,
  });
  const canonical = JSON.parse(await readFile(join(directory, 'canonical.json')));
  let finalDigest = sha(JSON.stringify(canonical.doc));
  for (const frame of report.liveCanvas.frames) {
    const doc = JSON.parse(await readFile(join(directory, `${frame.file}.json`)));
    if (isDeepStrictEqual(doc, canonical.doc)) finalDigest = frame.digest;
  }
  const live = report.liveCanvas.frames.filter((f) => f.observedAt < parent.agentEndedAt);
  report.liveCanvas.distinctIncludingFinal = new Set([
    ...live.map((f) => f.digest),
    finalDigest,
  ]).size;
  report.liveCanvas.status =
    live.length && report.liveCanvas.distinctIncludingFinal >= 2 ? 'passed' : 'unproven';
  report.overall =
    report.liveCanvas.status === 'passed' && report.liveCanvas.latency.status === 'passed'
      ? 'technical-passed-visual-pending'
      : 'unproven-live-progress';
  await writeComparison(directory);
} catch (error) {
  report.overall = 'failed';
  report.versionFlow = { status: 'failed', error: String(error) };
  report.error = String(error);
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
