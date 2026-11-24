/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript packaging hook. */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { recordNativeBuild, reuseVerifiedResource } from './native-resource-cache.mjs'

const electronRoot = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const TARGETS = {
  'darwin-arm64': { goos: 'darwin', goarch: 'arm64', binary: 'molly-core' },
  'darwin-x64': { goos: 'darwin', goarch: 'amd64', binary: 'molly-core' },
  'win32-x64': { goos: 'windows', goarch: 'amd64', binary: 'molly-core.exe' },
  'win32-arm64': { goos: 'windows', goarch: 'arm64', binary: 'molly-core.exe' }
}

const SOURCE_ROOTS = ['go.mod', 'go.sum', 'cmd/molly-core', 'internal']

export const mollyCoreResources = path.join(electronRoot, 'resources', 'molly-core')

export function resolveMollyCoreTarget({ platform = process.platform, arch = process.arch } = {}) {
  const key = `${platform}-${arch}`
  const target = TARGETS[key]
  if (!target) {
    throw new Error(`Unsupported molly-core target: ${key}`)
  }
  return target
}

function collectGoSourceFiles(current, root, output) {
  if (!fs.existsSync(current)) return
  const stat = fs.lstatSync(current)
  if (stat.isFile()) {
    output.push(path.relative(root, current).split(path.sep).join('/'))
    return
  }
  if (!stat.isDirectory()) return
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name)
    if (entry.isDirectory()) {
      collectGoSourceFiles(full, root, output)
    } else if (entry.isFile() && entry.name.endsWith('.go') && !entry.name.endsWith('_test.go')) {
      output.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
}

export function computeMollyCoreSourceDigest(root = repoRoot) {
  const files = []
  for (const rel of SOURCE_ROOTS) {
    collectGoSourceFiles(path.join(root, rel), root, files)
  }
  files.sort()
  const hash = createHash('sha256')
  for (const rel of files) {
    hash.update(rel)
    hash.update('\0')
    hash.update(fs.readFileSync(path.join(root, rel)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function verifyMollyCore(directory, target = {}, options = {}) {
  const manifestPath = path.join(directory, 'manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.name !== 'molly-core') {
    throw new Error('molly-core manifest identity mismatch')
  }
  const resolvedTarget = resolveMollyCoreTarget({
    platform: manifest.platform,
    arch: manifest.arch
  })
  if (
    (target.platform && target.platform !== manifest.platform) ||
    (target.arch && target.arch !== manifest.arch) ||
    manifest.goos !== resolvedTarget.goos ||
    manifest.goarch !== resolvedTarget.goarch
  ) {
    throw new Error('molly-core target mismatch')
  }
  if (options.expectedSourceDigest && manifest.sourceDigest !== options.expectedSourceDigest) {
    throw new Error('molly-core source digest mismatch')
  }
  const expectedBinary = resolvedTarget.binary
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length !== 1 ||
    manifest.files[0]?.path !== expectedBinary
  ) {
    throw new Error('Invalid molly-core file list')
  }
  const fileEntry = manifest.files[0]
  const binaryPath = path.join(directory, fileEntry.path)
  if (
    !fs.lstatSync(binaryPath).isFile() ||
    sha256(fs.readFileSync(binaryPath)) !== fileEntry.sha256
  ) {
    throw new Error(`Invalid molly-core resource: ${fileEntry.path}`)
  }
  if (manifest.buildId !== sha256(JSON.stringify(manifest.files))) {
    throw new Error('molly-core build identity mismatch')
  }
  const entries = fs.readdirSync(directory)
  if (entries.some((entry) => entry !== 'manifest.json' && entry !== expectedBinary)) {
    throw new Error('Unlisted molly-core resource')
  }
  return manifest
}

export function probeMollyCoreComposition(binaryPath, timeoutMs = 15_000) {
  const probe = spawnSync(binaryPath, ['--check-local-composition'], {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true
  })
  if (probe.error || probe.status !== 0) {
    throw new Error(
      `[molly-core] local composition probe failed: ${probe.error?.message ?? probe.stderr ?? probe.stdout}`
    )
  }
  const parsed = JSON.parse(probe.stdout.trim())
  const caps = parsed?.composition?.capabilities
  if (
    parsed?.name !== 'molly-core' ||
    caps?.localOnly !== true ||
    caps?.telemetryEnabled !== false ||
    (Array.isArray(caps?.cloud) && caps.cloud.length > 0)
  ) {
    throw new Error('[molly-core] local composition probe reported incompatible capabilities')
  }
  return parsed
}

export async function buildMollyCore({
  platform = process.platform,
  arch = process.arch,
  outputDir = mollyCoreResources,
  root = repoRoot
} = {}) {
  const target = resolveMollyCoreTarget({ platform, arch })
  const sourceDigest = computeMollyCoreSourceDigest(root)
  if (
    reuseVerifiedResource({
      name: 'molly-core',
      directory: outputDir,
      verify: (dir, t) => verifyMollyCore(dir, t, { expectedSourceDigest: sourceDigest }),
      target: { platform, arch }
    })
  ) {
    return verifyMollyCore(outputDir, { platform, arch })
  }

  const started = performance.now()
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })
  const outputBinary = path.join(outputDir, target.binary)

  const build = spawnSync(
    'go',
    ['build', '-trimpath', '-ldflags=-s -w', '-o', outputBinary, './cmd/molly-core'],
    {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        CGO_ENABLED: '0',
        GOFLAGS: '-mod=readonly',
        GOTOOLCHAIN: process.env.GOTOOLCHAIN ?? 'go1.27.3',
        GOOS: target.goos,
        GOARCH: target.goarch
      }
    }
  )
  if (build.error || build.status !== 0) {
    throw new Error(
      `[molly-core] go build failed for ${platform}-${arch}: ${build.error?.message ?? build.stderr ?? build.stdout}`
    )
  }
  if (platform !== 'win32') {
    fs.chmodSync(outputBinary, 0o755)
  }

  const files = [
    {
      path: target.binary,
      sha256: sha256(fs.readFileSync(outputBinary))
    }
  ]
  const manifest = {
    schemaVersion: 1,
    name: 'molly-core',
    platform,
    arch,
    goos: target.goos,
    goarch: target.goarch,
    sourceDigest,
    files,
    buildId: sha256(JSON.stringify(files))
  }
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const verified = verifyMollyCore(
    outputDir,
    { platform, arch },
    { expectedSourceDigest: sourceDigest }
  )
  recordNativeBuild('molly-core', verified, Math.round(performance.now() - started))
  return verified
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildMollyCore()
}
