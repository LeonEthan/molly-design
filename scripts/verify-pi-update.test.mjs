import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validRegistrySignature } from './verify-pi-update.mjs';

test('registry signatures bind the package name, version and locked integrity', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const keys = [
    {
      keyid: 'synthetic',
      key: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    },
  ];
  const id = '@synthetic/pi@1.0.0';
  const integrity = 'sha512-synthetic';
  const signatures = [
    {
      keyid: 'synthetic',
      sig: sign('sha256', Buffer.from(`${id}:${integrity}`), privateKey).toString('base64'),
    },
  ];
  assert.equal(validRegistrySignature(id, integrity, signatures, keys), true);
  assert.equal(validRegistrySignature(id, 'sha512-changed', signatures, keys), false);
  assert.equal(validRegistrySignature('@synthetic/pi@2.0.0', integrity, signatures, keys), false);
  assert.equal(validRegistrySignature(id, integrity, signatures, []), false);
  assert.equal(validRegistrySignature(id, integrity, [], keys), false);
});
