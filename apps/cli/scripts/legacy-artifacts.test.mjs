import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertNoLegacyHarnessArtifacts } from './verify-embedded-harness.mjs';

test('allows embedded resources and independent worker entries', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'molly-build-retirement-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'harness'));
  await writeFile(path.join(root, 'index.js'), '// synthetic entry');
  await writeFile(path.join(root, 'diff-worker.js'), '// synthetic worker');
  assert.doesNotThrow(() => assertNoLegacyHarnessArtifacts(root));
});

for (const artifact of [
  ...['claude', 'codex', 'grok', 'deepseek'].flatMap((name) => [
    `${name}-acp.js`,
    `${name}-acp.js.map`,
  ]),
  ...[
    'pi-design-launcher',
    'pi-design-extension',
    'pi-mcp-extension',
    'codex-design-reminder',
    'grok-design-reminder',
    'claude-design-hook',
  ].flatMap((name) => [`${name}.js`, `${name}.js.map`]),
  'deepseek-agent-presets',
]) {
  test(`rejects a stale ${artifact} without modifying the build`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'molly-build-retirement-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const location = path.join(root, artifact);
    if (artifact === 'deepseek-agent-presets') await mkdir(location);
    else await writeFile(location, '// synthetic retired entry');
    assert.throws(() => assertNoLegacyHarnessArtifacts(root), /Retired harness artifacts remain/);
    // A failed packaging check is observation only, not an implicit cleanup.
    const { stat } = await import('node:fs/promises');
    assert.ok(await stat(location));
  });
}
