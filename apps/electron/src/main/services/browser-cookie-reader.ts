import { app } from 'electron'
import { createHash } from 'node:crypto'
import { readFileSync, lstatSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { z } from 'zod'
import { BrowserAccountError } from './browser-account-error.ts'
import source from '../../../native/browser-cookie-reader/source.json'

const manifestSchema = z.object({
  revision: z.literal(source.revision),
  version: z.literal(source.version),
  platform: z.literal('darwin'),
  arch: z.literal(process.arch),
  files: z
    .array(z.object({ path: z.enum(['rookie-cookies.node', 'LICENSE.md']), sha256: z.string() }))
    .length(2),
  buildId: z.string()
})

export function browserCookieReader(): typeof import('rookie-cookies') {
  try {
    if (process.platform !== 'darwin') throw new Error('unsupported')
    const directory = join(
      app.getAppPath().replace(/\.asar$/, '.asar.unpacked'),
      'resources',
      'browser-cookie-reader'
    )
    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
    )
    const digest = (bytes: string | Buffer): string =>
      createHash('sha256').update(bytes).digest('hex')
    if (
      new Set(manifest.files.map((file) => file.path)).size !== 2 ||
      digest(JSON.stringify(manifest.files)) !== manifest.buildId
    )
      throw new Error('invalid manifest')
    for (const file of manifest.files) {
      const location = join(directory, file.path)
      if (!lstatSync(location).isFile() || digest(readFileSync(location)) !== file.sha256)
        throw new Error('invalid resource')
    }
    const reader: typeof import('rookie-cookies') = createRequire(import.meta.url)(
      join(directory, 'rookie-cookies.node')
    )
    if (reader.version() !== source.version) throw new Error('invalid reader')
    return reader
  } catch {
    throw new BrowserAccountError('unavailable')
  }
}
