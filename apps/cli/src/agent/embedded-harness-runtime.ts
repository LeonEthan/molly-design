import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { HarnessIdentitySchema, HarnessModelCatalogSchema } from '@molly/shared/embedded-harness';

/** Execution policy, not historical metadata parsing. There is no legacy fallback. */
export function assertEmbeddedHarnessTarget(input: {
  cliType: string;
  agentType: string;
  customAcp?: unknown;
  runtimeOverrides?: unknown;
  extraArgs?: readonly string[];
}): void {
  if (input.cliType !== 'builtin' || input.agentType !== 'molly')
    throw new Error('legacy_harness_execution_disabled');
  if (
    input.customAcp !== undefined ||
    input.runtimeOverrides !== undefined ||
    input.extraArgs?.length
  )
    throw new Error('harness_launch_override_forbidden');
}

/** Resolves only an application-bundled sibling. No PATH, install, override or fallback. */
export async function resolveEmbeddedHarnessLaunch() {
  const entryDirectory = process.argv[1]
    ? dirname(resolve(process.argv[1]))
    : dirname(fileURLToPath(import.meta.url));
  const entry = await realpath(join(entryDirectory, 'molly-pi-agent.js'));
  const manifest = JSON.parse(
    await readFile(join(entryDirectory, 'harness', 'runtime-manifest.json'), 'utf8')
  );
  const harness = HarnessIdentitySchema.parse({
    id: 'molly',
    engine: 'pi',
    engineVersion: manifest.engineVersion,
    protocolVersion: manifest.protocolVersion,
    buildId: manifest.buildId,
  });
  if (manifest.buildPlatform !== process.platform || manifest.buildArch !== process.arch)
    throw new Error('harness_platform_mismatch');
  return {
    command: process.execPath,
    args: [entry],
    harness,
    capabilitySourceVersion: `molly-pi:${harness.engineVersion}:${harness.buildId}`,
  };
}

/** Read only the public, checksummed build projection; the daemon never imports the SDK. */
export async function readEmbeddedHarnessCatalog(entryDirectory: string) {
  // Do not advertise an Agent whose fixed sibling entry was not packaged.
  await realpath(join(entryDirectory, 'molly-pi-agent.js'));
  const root = join(entryDirectory, 'harness');
  const manifest = JSON.parse(await readFile(join(root, 'runtime-manifest.json'), 'utf8'));
  if (manifest.buildPlatform !== process.platform || manifest.buildArch !== process.arch)
    throw new Error('harness_platform_mismatch');
  const bytes = await readFile(join(root, 'model-catalog.json'));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (
    !Array.isArray(manifest.files) ||
    !manifest.files.some(
      (entry: { path?: string; sha256?: string }) =>
        entry.path === 'model-catalog.json' && entry.sha256 === hash
    )
  )
    throw new Error('harness_model_catalog_checksum_mismatch');
  const catalog = HarnessModelCatalogSchema.parse(JSON.parse(bytes.toString('utf8')));
  const harness = HarnessIdentitySchema.parse({
    id: 'molly',
    engine: 'pi',
    engineVersion: manifest.engineVersion,
    buildId: manifest.buildId,
    protocolVersion: manifest.protocolVersion,
  });
  return { catalog, sourceVersion: `molly-pi:${harness.engineVersion}:${harness.buildId}` };
}
