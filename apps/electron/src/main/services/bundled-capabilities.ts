import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { HarnessIdentitySchema } from '@molly/shared/embedded-harness'

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
const extensionSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.literal('pi-ask-question'),
  version: z.string().min(1).max(100),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  license: z.literal('MIT'),
  licenseSha256: digest,
  selectedTools: z.tuple([z.literal('ask_question')]),
  selectedCommands: z.tuple([])
})

/** Display bundled metadata only. Never imports extensions, discovers files or starts a worker. */
export async function readBundledCapabilities(cliEntry: string | null) {
  try {
    if (cliEntry === null || cliEntry.length === 0) throw new Error('missing_entry')
    const root = join(dirname(cliEntry), 'harness')
    const manifestBytes = await readFile(join(root, 'runtime-manifest.json'))
    if (manifestBytes.length > 8 * 1024 * 1024) throw new Error('manifest_too_large')
    const manifest = runtimeSchema.parse(JSON.parse(manifestBytes.toString('utf8')))
    if (manifest.buildPlatform !== process.platform || manifest.buildArch !== process.arch)
      throw new Error('platform_mismatch')
    const harness = HarnessIdentitySchema.parse({
      id: 'molly',
      engine: 'pi',
      engineVersion: manifest.engineVersion,
      protocolVersion: manifest.protocolVersion,
      buildId: manifest.buildId
    })
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
    const extension = extensionSchema.parse(
      JSON.parse(
        (await readVerified('extensions/pi-ask-question/manifest.json', 64 * 1024)).toString('utf8')
      )
    )
    const license = await readVerified('extensions/pi-ask-question/LICENSE', 64 * 1024)
    if (createHash('sha256').update(license).digest('hex') !== extension.licenseSha256)
      throw new Error('invalid_license_digest')
    return {
      harness,
      extensions: [
        {
          name: extension.name,
          version: extension.version,
          commit: extension.commit,
          license: extension.license,
          tools: extension.selectedTools,
          activation: 'requires-question-ui-v1' as const
        }
      ]
    }
  } catch {
    // Do not expose local paths or arbitrary resource contents to the renderer.
    throw new Error('bundled_capabilities_unavailable')
  }
}
