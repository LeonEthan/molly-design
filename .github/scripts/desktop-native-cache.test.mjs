import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  NATIVE_RESOURCES,
  acceptRestores,
  readBuildReport,
  restoreOutcome,
  verifyForSave,
} from './desktop-native-cache.mjs';
import { recordNativeBuild } from '../../apps/electron/scripts/native-resource-cache.mjs';

const workflows = new URL('../workflows/', import.meta.url);
const CACHED_WORKFLOWS = ['e2e-smoke.yml', 'e2e-daily.yml'];
const readWorkflow = (name) => fs.readFileSync(new URL(name, workflows), 'utf8');

function regressionSteps(text) {
  const job = text.slice(text.indexOf('\n  regression:\n'));
  return job
    .split(/\n(?= {6}- name: )/u)
    .slice(1)
    .map((block) => ({ name: block.match(/^ {6}- name: (.+)$/mu)[1], block }));
}

function stepIndex(steps, name) {
  const index = steps.findIndex((step) => step.name === name);
  assert.notEqual(index, -1, `missing step: ${name}`);
  return index;
}

void test('native caches restore after a clean checkout and save only verified fresh builds', () => {
  for (const workflow of CACHED_WORKFLOWS) {
    const text = readWorkflow(workflow);
    const steps = regressionSteps(text);
    assert.doesNotMatch(text, /\bclean:/u, workflow);
    assert.doesNotMatch(text, /restore-keys/u, workflow);
    const checkout = stepIndex(steps, 'Checkout');
    const key = stepIndex(steps, 'Compute native resource cache keys');
    const build = stepIndex(steps, 'Build OSS desktop and bundled CLI');
    const verify = stepIndex(steps, 'Verify native resources before cache save');
    const accept = steps[stepIndex(steps, 'Accept exact native resource cache restores')];
    const report =
      'MOLLY_NATIVE_BUILD_REPORT: ${{ runner.temp }}/molly-native-build-report.jsonl\n';
    assert.ok(steps[build].block.includes(report), workflow);
    assert.ok(steps[verify].block.includes(report), workflow);
    assert.match(steps[verify].block, /id: native-cache-verify\n/u, workflow);
    assert.ok(steps.indexOf(accept) < build, workflow);
    for (const { output, environment } of NATIVE_RESOURCES) {
      assert.ok(
        accept.block.includes(
          `${environment}_CACHE_KEY: \${{ steps.native-cache-key.outputs.${output} }}`
        )
      );
      assert.ok(
        accept.block.includes(
          `${environment}_MATCHED_KEY: \${{ steps.${output}-cache.outputs.cache-matched-key }}`
        )
      );
      assert.ok(
        accept.block.includes(
          `${environment}_CACHE_HIT: \${{ steps.${output}-cache.outputs.cache-hit }}`
        )
      );
      assert.ok(
        steps.indexOf(steps.find((step) => step.name === `Restore ${output} native resource`)) <
          steps.indexOf(accept)
      );
    }
    const journeys = steps.findIndex((step) => step.name.endsWith('desktop journeys'));
    assert.ok(checkout < key && build < verify && verify < journeys, workflow);
    assert.ok(stepIndex(steps, 'Setup browser driver toolchain') < key, workflow);

    for (const { output } of NATIVE_RESOURCES) {
      const restore = steps[stepIndex(steps, `Restore ${output} native resource`)];
      const save = steps[stepIndex(steps, `Save ${output} native resource`)];
      const restoreAt = steps.indexOf(restore);
      const saveAt = steps.indexOf(save);
      assert.ok(key < restoreAt && restoreAt < build && verify < saveAt && saveAt < journeys);
      const location = `path: apps/electron/resources/${output}\n`;
      const exactKey = `key: \${{ steps.native-cache-key.outputs.${output} }}`;
      assert.match(restore.block, /uses: actions\/cache\/restore@v4/u);
      assert.ok(restore.block.includes(location) && restore.block.includes(exactKey));
      assert.match(restore.block, new RegExp(`id: ${output}-cache\\n`, 'u'));
      assert.match(save.block, /uses: actions\/cache\/save@v4/u);
      assert.ok(save.block.includes(location) && save.block.includes(exactKey));
      assert.ok(save.block.includes(`steps.native-cache-verify.outputs.${output}-fresh == 'true'`));
      assert.match(save.block, /continue-on-error: true\n/u);
      assert.doesNotMatch(save.block, /always\(\)|failure\(\)|cancelled\(\)/u);
    }
  }
});

void test('native caches stay in read-only regression lanes; release always rebuilds', () => {
  for (const file of fs.readdirSync(workflows)) {
    const text = readWorkflow(file);
    const usesNativeCache =
      text.includes('desktop-native-cache.mjs') ||
      /actions\/cache[\s\S]*apps\/electron\/resources\//u.test(text);
    assert.equal(usesNativeCache, CACHED_WORKFLOWS.includes(file), file);
    if (CACHED_WORKFLOWS.includes(file)) {
      assert.doesNotMatch(text, /pull_request_target/u, file);
      assert.doesNotMatch(text, /^\s+(contents|actions): write/mu, file);
    }
  }
  assert.doesNotMatch(readWorkflow('release-electron.yml'), /actions\/cache|desktop-native-cache/u);
});

void test('the cold benchmark control is manual-only and skips restore without skipping verification', () => {
  const text = readWorkflow('e2e-smoke.yml');
  assert.ok(
    text.includes(
      "NATIVE_CACHE_MODE: ${{ github.event_name == 'workflow_dispatch' && inputs.native_cache == 'cold' && 'cold' || 'reuse' }}"
    )
  );
  const steps = regressionSteps(text);
  for (const { output } of NATIVE_RESOURCES)
    assert.ok(
      steps[stepIndex(steps, `Restore ${output} native resource`)].block.includes(
        "if: env.NATIVE_CACHE_MODE != 'cold'"
      )
    );
  assert.doesNotMatch(
    steps[stepIndex(steps, 'Verify native resources before cache save')].block,
    /\bif:/u
  );
});

void test('only an exact matched key is accepted; anything else is removed before the build', (t) => {
  const key = 'molly-native-agent-browser-darwin-arm64-abc';
  assert.equal(restoreOutcome('reuse', { hit: 'true', requestedKey: key, matchedKey: key }), 'hit');
  assert.equal(
    restoreOutcome('reuse', { hit: 'false', requestedKey: key, matchedKey: '' }),
    'miss'
  );
  assert.equal(restoreOutcome(undefined, {}), 'miss');
  assert.equal(
    restoreOutcome('reuse', { hit: 'false', requestedKey: key, matchedKey: `${key}-older` }),
    'rejected-key'
  );
  assert.equal(
    restoreOutcome('reuse', { hit: 'true', requestedKey: key, matchedKey: `${key}-older` }),
    'rejected-key'
  );
  assert.equal(
    restoreOutcome('reuse', { hit: 'true', requestedKey: '', matchedKey: key }),
    'rejected-key'
  );
  assert.equal(
    restoreOutcome('cold', { hit: 'true', requestedKey: key, matchedKey: key }),
    'skipped-cold'
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-native-accept-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resources = ['exact', 'prefix', 'missing'].map((name) => {
    const directory = path.join(root, name);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'manifest.json'), '{}');
    return { output: name, environment: name.toUpperCase(), directory };
  });
  const lines = [];
  acceptRestores(
    {
      NATIVE_CACHE_MODE: 'reuse',
      NATIVE_CACHE_RESTORE_STARTED_AT: '1000',
      PNPM_CACHE_HIT: 'true',
      EXACT_CACHE_KEY: 'k1',
      EXACT_CACHE_HIT: 'true',
      EXACT_MATCHED_KEY: 'k1',
      PREFIX_CACHE_KEY: 'k2',
      PREFIX_CACHE_HIT: 'false',
      PREFIX_MATCHED_KEY: 'k2-other',
      MISSING_CACHE_KEY: 'k3',
      MISSING_CACHE_HIT: '',
      MISSING_MATCHED_KEY: '',
    },
    4250,
    { log: (line) => lines.push(line), resources }
  );
  assert.deepEqual(lines, [
    '[native-cache] pnpm-cache=hit',
    '[native-cache] exact restore=hit',
    '[native-cache] prefix restore=rejected-key',
    '[native-cache] missing restore=miss',
    '[native-cache] restore durationMs=3250',
  ]);
  assert.equal(fs.existsSync(resources[0].directory), true);
  assert.equal(fs.existsSync(resources[1].directory), false);
  assert.equal(fs.existsSync(resources[2].directory), false);
});

void test('only resources built and verified in this run are offered for saving', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-native-save-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const report = path.join(root, 'report.jsonl');
  const env = { MOLLY_NATIVE_BUILD_REPORT: report };
  recordNativeBuild('fresh', { buildId: 'b1' }, 5, env);
  recordNativeBuild('relabeled', { buildId: 'old' }, 5, env);
  assert.deepEqual(readBuildReport(report), [
    { resource: 'fresh', buildId: 'b1' },
    { resource: 'relabeled', buildId: 'old' },
  ]);
  assert.deepEqual(readBuildReport(path.join(root, 'absent.jsonl')), []);

  const resource = (output, verify) => ({ output, directory: path.join(root, output), verify });
  const lines = [];
  const result = verifyForSave({ platform: 'darwin', arch: 'arm64' }, readBuildReport(report), {
    log: (line) => lines.push(line),
    now: () => 0,
    resources: [
      resource('fresh', () => ({ buildId: 'b1' })),
      resource('relabeled', () => ({ buildId: 'b2' })),
      resource('restored', () => ({ buildId: 'b3' })),
      resource('invalid', () => {
        throw new Error('Invalid resource');
      }),
    ],
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.outputs, [
    'fresh-fresh=true',
    'relabeled-fresh=false',
    'restored-fresh=false',
    'invalid-fresh=false',
  ]);
  assert.deepEqual(lines, [
    '[native-resource] fresh saveGate=fresh durationMs=0',
    '[native-resource] relabeled saveGate=reused durationMs=0',
    '[native-resource] restored saveGate=reused durationMs=0',
    '[native-resource] invalid saveGate=rejected reason="Invalid resource"',
  ]);
});
