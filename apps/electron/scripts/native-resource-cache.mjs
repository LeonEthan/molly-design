import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { spawnSync } from 'node:child_process'

const KEY_SCHEMA = 1
const BUILD_ENVIRONMENT =
  /^(RUSTFLAGS|RUSTC|RUSTC_WRAPPER|RUSTUP_TOOLCHAIN|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_\w+|CARGO_PROFILE_\w+|CARGO_TARGET_\w+|MACOSX_DEPLOYMENT_TARGET|SDKROOT|CC|CXX|AR|CFLAGS|CXXFLAGS|LDFLAGS)$/
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function logNativeResource(name, fields, log = console.log) {
  const text = Object.entries(fields)
    .map(
      ([field, value]) => `${field}=${typeof value === 'string' ? value : JSON.stringify(value)}`
    )
    .join(' ')
  log(`[native-resource] ${name} ${text}`)
}

export function recordNativeBuild(name, manifest, durationMs, env = process.env) {
  logNativeResource(name, { build: 'ok', verify: 'ok', durationMs })
  if (env.MOLLY_NATIVE_BUILD_REPORT)
    fs.appendFileSync(
      env.MOLLY_NATIVE_BUILD_REPORT,
      `${JSON.stringify({ resource: name, buildId: manifest.buildId })}\n`
    )
}

export function reuseVerifiedResource({
  name,
  directory,
  verify,
  target,
  log = console.log,
  now = () => performance.now()
}) {
  const started = now()
  try {
    verify(directory, target)
    logNativeResource(
      name,
      { verify: 'ok', durationMs: Math.round(now() - started), action: 'reuse' },
      log
    )
    return true
  } catch (error) {
    const reason = fs.existsSync(directory) ? String(error?.message ?? error) : 'missing'
    fs.rmSync(directory, { recursive: true, force: true })
    logNativeResource(
      name,
      {
        verify: 'failed',
        reason: JSON.stringify(reason),
        durationMs: Math.round(now() - started),
        action: 'rebuild'
      },
      log
    )
    return false
  }
}

export function nativeResourceCacheKey(descriptor, probe) {
  const target = descriptor.targets[`${probe.platform}-${probe.arch}`]
  if (!target)
    throw new Error(`Unsupported ${descriptor.name} cache target: ${probe.platform}-${probe.arch}`)
  const files = descriptor.inputs.map((file) => [
    path.relative(descriptor.root, file).split(path.sep).join('/'),
    sha256(fs.readFileSync(file))
  ])
  const identity = {
    schema: KEY_SCHEMA,
    resource: descriptor.name,
    runner: probe.runner,
    platform: probe.platform,
    arch: probe.arch,
    target,
    toolchain: probe.toolchain,
    environment: probe.environment,
    files
  }
  return `molly-native-${descriptor.name}-${probe.platform}-${probe.arch}-${sha256(JSON.stringify(identity))}`
}

function readCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false })
  if (result.error || result.status !== 0)
    throw new Error(`Native cache probe failed: ${command} ${args.join(' ')}`)
  return result.stdout.trim()
}

export function probeNativeBuildHost({
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  read = readCommand
} = {}) {
  if (platform !== 'darwin')
    throw new Error(`Native resource caching supports macOS hosts only, not ${platform}`)
  return {
    platform,
    arch,
    runner: {
      os: env.RUNNER_OS ?? 'local',
      image: env.ImageOS ?? 'local',
      imageVersion: env.ImageVersion ?? 'local'
    },
    toolchain: {
      rustc: read('rustc', ['-vV']),
      cargo: read('cargo', ['-V']),
      clang: read('xcrun', ['clang', '--version']),
      sdk: [
        read('xcrun', ['--sdk', 'macosx', '--show-sdk-version']),
        read('xcrun', ['--sdk', 'macosx', '--show-sdk-build-version'])
      ].join(' ')
    },
    environment: Object.fromEntries(
      Object.entries(env)
        .filter(([variable]) => BUILD_ENVIRONMENT.test(variable))
        .sort(([left], [right]) => left.localeCompare(right))
    )
  }
}
