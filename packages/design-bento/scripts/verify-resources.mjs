import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const resources = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]) + '/')
  : new URL('../../../apps/electron/resources/design/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('build.json', resources), 'utf8'));
for (const [file, key] of [
  ['editor.html', 'shellSha256'],
  ['sample.json', 'sampleSha256'],
]) {
  const content = readFileSync(new URL(file, resources));
  assert.equal(createHash('sha256').update(content).digest('hex'), manifest[key]);
}
for (const license of ['BENTO-LICENSE', 'SPACE-MONO-LICENSE', 'FONTAWESOME-LICENSE']) {
  assert.ok(readFileSync(new URL(license, resources)).length > 0);
}
console.log(JSON.stringify({ platform: process.platform, arch: process.arch, ...manifest }));
