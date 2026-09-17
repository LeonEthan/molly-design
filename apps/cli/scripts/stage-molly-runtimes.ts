import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ManagedAgentRuntimeManager } from '../src/agent/managed-agent-runtime';
import {
  runtimeReleaseAssetName,
  resolveRuntimeArtifactUrl,
  DEFAULT_RUNTIME_ARTIFACTS_BASE_URL,
} from '@molly/platform';
import { getCliHttpFetch } from '../src/utils/http-transport';

// Stages public, already-pinned runtime artifacts. Never publishes or changes pins.
// Run from apps/cli: pnpm exec tsx scripts/stage-molly-runtimes.ts <output> [--download]
const sourceBase = (process.env.MOLLY_RUNTIME_SOURCE_URL ?? process.env.LODY_RUNTIME_SOURCE_URL)?.trim();
if (!sourceBase) throw Error('Set MOLLY_RUNTIME_SOURCE_URL to the public source artifact mirror');
const output = process.argv[2];
if (!output || output.startsWith('--')) throw Error('Pass an output directory before --download');
const directory = resolve(output);
const manager = new ManagedAgentRuntimeManager({ rootDir: join(directory, 'unused-cache') });
const plan = (['codex', 'claude-code', 'kimi-code', 'grok-build'] as const).map((name) => {
  const definition = manager.getDefinition(name);
  const platform = definition.platforms['darwin-arm64'] ? 'darwin-arm64' : 'node';
  const archive = definition.platforms[platform];
  if (!archive) throw Error(`No macOS arm64 artifact for ${name}`);
  const assetName = runtimeReleaseAssetName(name, definition.version, platform, archive.fileName);
  return {
    name,
    version: definition.version,
    platform,
    assetName,
    sha256: archive.sha256,
    size: archive.size,
    source: resolveRuntimeArtifactUrl(
      sourceBase,
      name,
      definition.version,
      platform,
      archive.fileName
    ),
    destination: resolveRuntimeArtifactUrl(
      DEFAULT_RUNTIME_ARTIFACTS_BASE_URL,
      name,
      definition.version,
      platform,
      archive.fileName
    ),
  };
});
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'runtime-release-plan.json'), JSON.stringify(plan, null, 2) + '\n');
if (process.argv.includes('--download')) {
  for (const artifact of plan) {
    const target = join(directory, artifact.assetName);
    const temporary = `${target}.pending`;
    const response = await getCliHttpFetch()(artifact.source, {
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok || !response.body)
      throw Error(`${artifact.name}: download HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(temporary)) hash.update(chunk);
    if ((await stat(temporary)).size !== artifact.size || hash.digest('hex') !== artifact.sha256)
      throw Error(
        `${artifact.name}: artifact does not match the existing pinned manifest; retained .pending file`
      );
    await rename(temporary, target);
    console.log(`Verified ${artifact.assetName}`);
  }
  await writeFile(
    join(directory, 'SHA256SUMS.txt'),
    plan.map((a) => `${a.sha256}  ${a.assetName}`).join('\n') + '\n'
  );
}
console.log(`Prepared ${plan.length} runtime entries in ${directory}; nothing published.`);
