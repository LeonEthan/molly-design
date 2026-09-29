import { readFile } from 'node:fs/promises';
import { createPublicKey, verify } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import semver from 'semver';

const registry = 'https://registry.npmjs.org';
async function get(path) {
  const response = await fetch(`${registry}/${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Registry HTTP ${response.status}: ${path}`);
  return response.json();
}
export function validRegistrySignature(id, integrity, signatures, keys) {
  return (
    signatures?.some((signature) => {
      const key = keys.find((candidate) => candidate.keyid === signature.keyid);
      return (
        key &&
        verify(
          'sha256',
          Buffer.from(`${id}:${integrity}`),
          createPublicKey({
            key: Buffer.from(key.key, 'base64'),
            format: 'der',
            type: 'spki',
          }),
          Buffer.from(signature.sig, 'base64')
        )
      );
    }) === true
  );
}

async function main() {
  const workspace = parse(await readFile('pnpm-workspace.yaml', 'utf8'));
  const lock = parse(await readFile('pnpm-lock.yaml', 'utf8'));
  const catalog = workspace.catalogs.pi;
  const engine = catalog['@earendil-works/pi-coding-agent'];
  for (const [name, version] of Object.entries(catalog)) {
    if (!semver.valid(version)) throw new Error(`Pi catalog must pin an exact version: ${name}`);
    if (name.startsWith('@earendil-works/') && version !== engine)
      throw new Error(`Pi family drift: ${name}`);
  }
  const previous = process.env.PI_BASE_SHA;
  if (previous && !/^[a-f0-9]{40}$/.test(previous)) throw new Error('Invalid base SHA');
  const base = previous
    ? parse(execFileSync('git', ['show', `${previous}:pnpm-lock.yaml`], { encoding: 'utf8' }))
    : undefined;
  const manifest = JSON.parse(
    await readFile('apps/cli/dist/harness/runtime-manifest.json', 'utf8')
  );
  const packages = new Map();
  for (const entry of manifest.packages) {
    const key = `${entry.name}@${entry.version}`;
    if (entry.name in catalog || (base && !base.packages?.[key])) packages.set(key, entry);
  }
  const keys = (await get('-/npm/v1/keys')).keys;
  for (const [id, entry] of packages) {
    const metadata = await get(`${encodeURIComponent(entry.name)}/${entry.version}`);
    const integrity = lock.packages?.[id]?.resolution?.integrity;
    if (!integrity || integrity !== metadata.dist?.integrity)
      throw new Error(`Lock integrity mismatch: ${id}`);
    const valid = validRegistrySignature(id, integrity, metadata.dist.signatures, keys);
    if (!valid) throw new Error(`No valid registry signature: ${id}`);
    for (const [peer, range] of Object.entries(metadata.peerDependencies ?? {})) {
      if (peer in catalog && !semver.satisfies(catalog[peer], range)) {
        throw new Error(
          `Incompatible Pi set: ${id} needs ${peer} ${range}. Keep the last green set; reassess within three days.`
        );
      }
    }
    console.log(`Verified ${id}`);
  }
  console.log(`Verified signatures and locked integrity for ${packages.size} Pi/update packages.`);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
