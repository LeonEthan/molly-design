/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript packaging hook. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { signAsync } from '@electron/osx-sign'
import { verifyEmbeddedHarness } from '../../cli/scripts/verify-embedded-harness.mjs'

const MANIFEST = 'runtime-manifest.json'
const MACH_O_MAGICS = new Set([
  'feedface',
  'cefaedfe',
  'feedfacf',
  'cffaedfe',
  'cafebabe',
  'bebafeca',
  'cafebabf',
  'bfbafeca'
])
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const isMachO = (bytes) => MACH_O_MAGICS.has(bytes.subarray(0, 4).toString('hex'))

function codesign(args) {
  const result = spawnSync('/usr/bin/codesign', args, { encoding: 'utf8', timeout: 30_000 })
  if (result.error || result.status !== 0) {
    throw new Error(
      `Embedded harness signing check failed: ${result.error?.message ?? result.stderr}`
    )
  }
}

/** Compare payloads using Apple's signer, without touching either shipped binary. */
function assertSignatureOnlyChange(original, signed, temporaryDirectory) {
  const digests = [original, signed].map((bytes, index) => {
    const copy = path.join(temporaryDirectory, `payload-${index}`)
    fs.writeFileSync(copy, bytes)
    codesign(['--remove-signature', copy])
    // Removal alone can retain different signature allocation in Mach-O headers.
    // A fixed, timestamp-free ad-hoc signature normalizes that allocation too.
    codesign([
      '--sign',
      '-',
      '--force',
      '--identifier',
      'dev.molly-design.seal-payload',
      '--timestamp=none',
      copy
    ])
    return sha256(fs.readFileSync(copy))
  })
  if (digests[0] !== digests[1]) throw new Error('Embedded harness native payload changed')
}

/** Capture the verified pre-sign seal; return a synchronous pre-root reseal operation. */
export function prepareEmbeddedHarnessSigning(directory) {
  const manifest = verifyEmbeddedHarness(directory)
  const root = fs.realpathSync(directory)
  const manifestPath = path.join(root, MANIFEST)
  const manifestBytes = fs.readFileSync(manifestPath)
  const originals = new Map()
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(root, file.path))
    if (sha256(bytes) !== file.sha256)
      throw new Error(`Embedded harness resource changed: ${file.path}`)
    if (isMachO(bytes)) originals.set(file.path, bytes)
  }

  return function resealSignedHarness() {
    if (!fs.readFileSync(manifestPath).equals(manifestBytes)) {
      throw new Error('Embedded harness manifest changed during signing')
    }
    const listed = new Set(manifest.files.map((file) => file.path))
    function checkResources(current) {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const location = path.join(current, entry.name)
        if (entry.isDirectory()) checkResources(location)
        else {
          const relative = path.relative(root, location).split(path.sep).join('/')
          if (!entry.isFile() || (relative !== MANIFEST && !listed.has(relative))) {
            throw new Error(`Unlisted embedded harness resource: ${relative}`)
          }
        }
      }
    }
    checkResources(root)
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-sign-payload-'))
    try {
      const files = manifest.files.map((file) => {
        const location = path.join(root, file.path)
        if (
          !fs.lstatSync(location).isFile() ||
          !fs.realpathSync(location).startsWith(`${root}${path.sep}`)
        ) {
          throw new Error(`Invalid embedded harness resource: ${file.path}`)
        }
        const bytes = fs.readFileSync(location)
        const digest = sha256(bytes)
        if (digest !== file.sha256) {
          const original = originals.get(file.path)
          if (!original || !isMachO(bytes)) {
            throw new Error(`Embedded harness resource changed during signing: ${file.path}`)
          }
          codesign(['--verify', '--strict', location])
          assertSignatureOnlyChange(original, bytes, temporaryDirectory)
        }
        return { ...file, sha256: digest }
      })
      const signedManifest = {
        ...manifest,
        files,
        buildId: sha256(JSON.stringify(files))
      }
      fs.writeFileSync(manifestPath, `${JSON.stringify(signedManifest, null, 2)}\n`)
      verifyEmbeddedHarness(root)
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  }
}

/** Preserve Builder's signing options and refresh the seal before the root app is signed. */
export default async function signEmbeddedHarness(options) {
  const app = path.resolve(options.app)
  const directory = path.join(
    app,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'resources',
    'cli',
    'harness'
  )
  const reseal = prepareEmbeddedHarnessSigning(directory)
  let rootReached = false
  await signAsync({
    ...options,
    optionsForFile(file) {
      const perFileOptions = options.optionsForFile?.(file)
      // @electron/osx-sign 1.3.3 signs children sequentially, then the root app.
      // This callback is synchronous: finish the manifest before its resource seal.
      if (path.resolve(file) === app) {
        if (rootReached) throw new Error('Embedded harness root signing repeated')
        reseal()
        rootReached = true
      }
      return perFileOptions
    }
  })
  if (!rootReached) throw new Error('Embedded harness root app was not signed')
  verifyEmbeddedHarness(directory)
}
