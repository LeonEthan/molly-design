import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertIsolation, assertSocketPaths, benchRootPrefix, treeRss } from './bench-mygo-vs-electron.mjs';

test('rejects home, redirected directories and nested encrypted files before launch', (t) => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bench-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'data');
  fs.mkdirSync(dir);
  const env = Object.fromEntries(
    [
      'HOME',
      'MOLLY_DATA_DIR',
      'MOLLY_ELECTRON_USER_DATA_DIR',
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME',
      'TMPDIR',
    ].map((k) => [k, dir])
  );
  assertIsolation(root, env, dir);
  assert.throws(() => assertIsolation(root, { ...env, HOME: os.homedir() }, dir), /outside/);
  const link = path.join(root, 'link');
  fs.symlinkSync(os.homedir(), link);
  assert.throws(() => assertIsolation(root, env, link), /outside/);
  fs.unlinkSync(link);
  fs.writeFileSync(path.join(dir, 'secret.enc'), '');
  assert.throws(() => assertIsolation(root, env, dir), /\.enc/);
});

test('RSS includes grandchildren and excludes unrelated processes', () => {
  assert.equal(treeRss('4 3 10\n1 0 5\n2 1 4\n3 2 8\n5 1 9', 2), 22 * 1024);
});

test('selects the short POSIX root only when a channel would overflow', { skip: process.platform === 'win32' }, () => {
  const tmp = fs.realpathSync('/tmp');
  assert.equal(benchRootPrefix(tmp), path.join(tmp, 'molly-bench-'));
  assert.equal(benchRootPrefix(path.join(tmp, '界'.repeat(30))), path.join(tmp, 'molly-b-'));
});

test('enforces the UTF-8 byte boundary for the longest socket', { skip: process.platform === 'win32' }, () => {
  const tail = '/MOLLY_DATA_DIR/run/molly-loro-data-plane.sock';
  const root = '/界' + 'a'.repeat(103 - Buffer.byteLength('/界' + tail));
  assertSocketPaths(root);
  assert.throws(() => assertSocketPaths(root + 'a'), /too_long:.*loro-data-plane/);
});
