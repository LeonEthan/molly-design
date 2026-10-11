import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  HarnessIdentitySchema,
  HarnessModelCatalogSchema,
  MOLLY_PI_PACKAGES,
  ModelMetadataSnapshotSchema
} from '@molly/shared/embedded-harness'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const runtimeSchema = z.object({
  engine: z.literal('pi'),
  engineVersion: z.string(),
  protocolVersion: z.number(),
  buildId: digest,
  buildPlatform: z.string(),
  buildArch: z.string(),
  files: z.array(z.object({ path: z.string().max(4096), sha256: digest })).max(50_000)
})
const PI_ENGINE_PACKAGE = '@earendil-works/pi-coding-agent'
const packageSchema = (name: string) =>
  z.object({
    name: z.literal(name),
    version: z.string().min(1).max(100),
    license: z.string().min(1).max(100)
  })

async function openVerifiedHarness(cliEntry: string | null) {
  if (cliEntry === null || cliEntry.length === 0) throw new Error('missing_entry')
  const root = join(dirname(cliEntry), 'harness')
  const manifestBytes = await readFile(join(root, 'runtime-manifest.json'))
  if (manifestBytes.length > 8 * 1024 * 1024) throw new Error('manifest_too_large')
  const manifest = runtimeSchema.parse(JSON.parse(manifestBytes.toString('utf8')))
  if (manifest.buildPlatform !== process.platform || manifest.buildArch !== process.arch)
    throw new Error('platform_mismatch')
  const readVerified = async (file: string, limit: number) => {
    const entries = manifest.files.filter((entry) => entry.path === file)
    if (entries.length !== 1) throw new Error('invalid_resource_identity')
    const bytes = await readFile(join(root, file))
    if (
      bytes.length > limit ||
      createHash('sha256').update(bytes).digest('hex') !== entries[0]?.sha256
    )
      throw new Error('invalid_resource_digest')
    return bytes
  }
  return { manifest, readVerified }
}

/** Display bundled metadata only. Never imports extensions, discovers files or starts a worker. */
export async function readBundledCapabilities(cliEntry: string | null) {
  try {
    const { manifest, readVerified } = await openVerifiedHarness(cliEntry)
    const harness = HarnessIdentitySchema.parse({
      id: 'molly',
      engine: 'pi',
      engineVersion: manifest.engineVersion,
      protocolVersion: manifest.protocolVersion,
      buildId: manifest.buildId
    })
    const readPackage = async (name: string) => {
      const bytes = await readVerified(`node_modules/${name}/package.json`, 256 * 1024)
      const { version, license } = packageSchema(name).parse(JSON.parse(bytes.toString('utf8')))
      return { name, version, license }
    }
    const engine = await readPackage(PI_ENGINE_PACKAGE)
    if (engine.version !== manifest.engineVersion) throw new Error('engine_version_mismatch')
    return { harness, engine, addons: await Promise.all(MOLLY_PI_PACKAGES.map(readPackage)) }
  } catch {
    // Do not expose local paths or arbitrary resource contents to the renderer.
    throw new Error('bundled_capabilities_unavailable')
  }
}

/** The packaged, checksummed model catalog the conversation picker is projected from. */
export async function readBundledModelCatalog(cliEntry: string | null) {
  try {
    const { readVerified } = await openVerifiedHarness(cliEntry)
    const bytes = await readVerified('model-catalog.json', 16 * 1024 * 1024)
    return HarnessModelCatalogSchema.parse(JSON.parse(bytes.toString('utf8')))
  } catch {
    throw new Error('bundled_model_catalog_unavailable')
  }
}

/** The packaged, checksummed offline model metadata snapshot (models.dev projection). */
export async function readBundledModelMetadataSnapshot(cliEntry: string | null) {
  try {
    const { readVerified } = await openVerifiedHarness(cliEntry)
    const bytes = await readVerified('model-metadata-snapshot.json', 16 * 1024 * 1024)
    return ModelMetadataSnapshotSchema.parse(JSON.parse(bytes.toString('utf8')))
  } catch {
    throw new Error('bundled_model_metadata_unavailable')
  }
}
