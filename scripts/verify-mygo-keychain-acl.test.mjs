import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { measureOperation, verifyIsolatedACL } from './verify-mygo-keychain-acl.mjs';

void test(
  'a helper build failure removes the isolated directory before any password operations',
  { skip: process.platform !== 'darwin' },
  () => {
    let temp;
    const report = verifyIsolatedACL((command, args, options) => {
      assert.equal(command, 'go');
      temp = options.cwd;
      throw new Error('injected failure');
    });
    assert.match(temp, /^\/tmp\/molly-acl-/);
    assert.equal(fs.existsSync(temp), false);
    assert.equal(report.cleaned, true);
    assert.equal(report.verified, false);
  }
);

void test('records the native status and distinguishes process failures from ACL denial', () => {
  assert.deepEqual(
    measureOperation(() => {}),
    { passed: true, osStatus: 0 }
  );
  const denied = 'keychain update: authorization failed (OSStatus -25293)';
  assert.deepEqual(
    measureOperation(() => {
      throw Object.assign(new Error('helper exited'), { stderr: Buffer.from(denied) });
    }),
    { passed: false, osStatus: -25293, error: denied }
  );
  assert.deepEqual(
    measureOperation(() => {
      throw new Error('timeout');
    }),
    {
      passed: false,
      osStatus: null,
      error: 'timeout',
    }
  );
});
