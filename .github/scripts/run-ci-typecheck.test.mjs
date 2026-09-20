import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { main, runCiTypecheck } from './run-ci-typecheck.mjs';

function recordExec() {
  const calls = [];
  return {
    calls,
    execFileSync(cmd, args) {
      calls.push({ cmd, args: [...args] });
    },
  };
}

void test('28. full mode argv is exactly pnpm typecheck', () => {
  const { calls, execFileSync } = recordExec();
  runCiTypecheck({
    scope: { mode: 'full', runTypecheck: true, typecheckPackages: ['molly'] },
    execFileSync,
  });
  assert.deepEqual(calls, [{ cmd: 'pnpm', args: ['typecheck'] }]);
});

void test('affected typecheck always prepares adapters first', () => {
  const { calls, execFileSync } = recordExec();
  runCiTypecheck({
    scope: {
      mode: 'affected',
      runTypecheck: true,
      typecheckPackages: ['@loro-dev/ignore', 'molly'],
    },
    execFileSync,
  });
  assert.deepEqual(calls[0].args, [
    '--fail-if-no-match',
    '--filter',
    'molly',
    'prepare:acp-adapters',
  ]);
  assert.equal(calls[1].args[0], '-r');
  assert.ok(calls[1].args.includes('--workspace-concurrency=1'));
  assert.ok(calls[1].args.includes('@loro-dev/ignore'));
  assert.ok(calls[1].args.includes('molly'));
});

void test('37. invalid scope file execs pnpm typecheck', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-typecheck-'));
  const invalid = join(dir, 'invalid.json');
  writeFileSync(invalid, '{}');
  const { calls, execFileSync } = recordExec();
  main(['node', 'run-ci-typecheck.mjs', '--scope', invalid], { execFileSync });
  assert.deepEqual(calls, [{ cmd: 'pnpm', args: ['typecheck'] }]);
});

void test('affected preparation targets the actual embedded runtime package', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../apps/cli/package.json', import.meta.url), 'utf8')
  );
  const { calls, execFileSync } = recordExec();
  runCiTypecheck({
    scope: { mode: 'affected', runTypecheck: true, typecheckPackages: [manifest.name] },
    execFileSync,
  });
  const args = calls[0].args;
  assert.equal(args[args.indexOf('--filter') + 1], manifest.name);
  assert.ok(manifest.scripts[args.at(-1)]);
  assert.ok(args.includes('--fail-if-no-match'));
});
