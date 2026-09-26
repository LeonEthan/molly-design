import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The embedded CLI bundle (resources/cli/index.js) keeps native addons external
// so the packaged app must ship those packages plus their runtime require-chain
// under resources/cli/node_modules, where Node resolution from index.js finds
// them. Both bindings are N-API addons, so one prebuilt binary per platform/arch
// loads under Node and under Electron alike (the CLI runs via
// ELECTRON_RUN_AS_NODE inside the app binary) — no ABI-specific rebuild.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const electronAppRoot = path.resolve(__dirname, '..')
const cliAppRoot = path.resolve(electronAppRoot, '../cli')
const require = createRequire(import.meta.url)

// Mirror of the published CLI's runtime dependencies (enforced by
// apps/cli/scripts/check-published-bundle-imports.js): the bundle keeps
// better-sqlite3 external, and worker_threads pools
// require.resolve('loro-crdt') at module scope to hand workers a real on-disk
// package (workers cannot share the wasm module inlined into the bundle).
// better-sqlite3 >=13 has no runtime require-chain of its own (node-addon-api is
// build-time only); its prebuilt binaries live in `prebuilds/<platform>-<arch>.node`
// inside the package and are staged per packaging target by
// installEmbeddedSqliteBinding, so the whole 8-platform set never ships.
// Each entry resolves from its dependent's real directory because pnpm's
// strict layout exposes transitive deps only next to the package that
// declares them (.pnpm/<pkg>/node_modules/<dep>), not under apps/cli.
const CLI_RUNTIME_PACKAGE_CHAIN = [
  { name: 'better-sqlite3', from: 'cli' },
  { name: 'loro-crdt', from: 'cli' },
  // tinypool drives the diff line-count worker pool; it stays external because it
  // resolves its own entry/worker.js relative to its package dir. Pure JS, no deps.
  { name: 'tinypool', from: 'cli' },
  { name: 'sharp', from: 'cli' },
  { name: 'semver', from: 'sharp' },
  { name: '@img/colour', from: 'sharp' },
  { name: 'detect-libc', from: 'sharp' }
]

// Top-level package dirs that are never needed at runtime (C++ sources, the
// sqlite amalgamation, node-gyp output). `prebuilds/` is excluded here on
// purpose: better-sqlite3 ships every platform's binary (~17 MB) and
// installEmbeddedSqliteBinding copies back only the packaging target's.
const EXCLUDED_PACKAGE_DIRS = new Set([
  'build',
  'deps',
  'src',
  'prebuilds',
  'bin',
  'docs',
  'benchmark',
  'test',
  'node_modules'
])
export const stagedCliDir = path.join(electronAppRoot, 'resources', 'cli')
export const stagedNodeModulesDir = path.join(stagedCliDir, 'node_modules')
export const stagedSqliteDir = path.join(stagedNodeModulesDir, 'better-sqlite3')

/**
 * better-sqlite3 >=13 resolves `prebuilds/<target>.node` from process.platform/arch
 * (lib/binding.js). Electron only ships glibc Linux builds, so the `linuxmusl-*`
 * variants that package also carries are never the right target here.
 */
export function sqlitePrebuildFileName({ platform, arch }) {
  return `${platform}-${arch}.node`
}

export function stagedSqliteBindingPath(target) {
  return path.join(stagedSqliteDir, 'prebuilds', sqlitePrebuildFileName(target))
}

function resolvePackageDir(packageName, fromDir) {
  const resolveOptions = { paths: [fromDir] }
  try {
    // Packages with no `exports` map expose package.json directly.
    return path.dirname(require.resolve(`${packageName}/package.json`, resolveOptions))
  } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
    // The package restricts `exports` to ".", so walk up from its entry point to
    // the directory that owns package.json.
    let dir = path.dirname(require.resolve(packageName, resolveOptions))
    while (!fs.existsSync(path.join(dir, 'package.json'))) {
      const parent = path.dirname(dir)
      if (parent === dir) {
        throw new Error(`Cannot resolve the package root of ${packageName} from ${fromDir}.`)
      }
      dir = parent
    }
    return dir
  }
}

function copyPackageDir(fromDir, toDir, { isTopLevel }) {
  fs.mkdirSync(toDir, { recursive: true })
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const fromPath = path.join(fromDir, entry.name)
    const toPath = path.join(toDir, entry.name)
    if (entry.isDirectory()) {
      if (isTopLevel && EXCLUDED_PACKAGE_DIRS.has(entry.name)) {
        continue
      }
      copyPackageDir(fromPath, toPath, { isTopLevel: false })
      continue
    }
    if (!entry.isFile()) continue
    if (/\.map$/i.test(entry.name)) continue
    // Package licenses and attribution often live in README/LICENCE.md (libvips
    // also includes notices for its codec dependencies); retain those on staging.
    if (
      /\.(md|markdown)$/i.test(entry.name) &&
      !/^(readme|licen[cs]e|notice|copying|copyright)/i.test(entry.name)
    )
      continue
    fs.copyFileSync(fromPath, toPath)
  }
}

export function stageCliRuntimePackages() {
  fs.rmSync(stagedNodeModulesDir, { recursive: true, force: true })
  const resolvedDirs = { cli: cliAppRoot }
  for (const { name, from } of CLI_RUNTIME_PACKAGE_CHAIN) {
    const fromDir = resolvePackageDir(name, resolvedDirs[from])
    resolvedDirs[name] = fromDir
    copyPackageDir(fromDir, path.join(stagedNodeModulesDir, name), { isTopLevel: true })
  }
}

/**
 * Stages the prebuilt sqlite binding matching the packaging target.
 *
 * better-sqlite3 >=13 is an N-API addon whose prebuilt binaries ship inside the npm
 * package, so this is a plain copy out of the workspace install: no node-gyp, no
 * GitHub download, and no Electron-ABI variant to fetch. Must still run once per
 * packaging target — `--arm64 --x64` mac builds share one resources/ dir, so each
 * beforePack swaps the binary.
 */
export function installEmbeddedSqliteBinding({ platform, arch }) {
  if (!fs.existsSync(path.join(stagedSqliteDir, 'package.json'))) {
    throw new Error(
      `Staged better-sqlite3 not found at ${stagedSqliteDir}. Run \`pnpm run sync:cli\` first.`
    )
  }

  const workspaceSqliteDir = resolvePackageDir('better-sqlite3', cliAppRoot)
  const fileName = sqlitePrebuildFileName({ platform, arch })
  const sourcePath = path.join(workspaceSqliteDir, 'prebuilds', fileName)
  if (!fs.existsSync(sourcePath)) {
    const available = fs.existsSync(path.join(workspaceSqliteDir, 'prebuilds'))
      ? fs.readdirSync(path.join(workspaceSqliteDir, 'prebuilds')).join(', ')
      : 'none'
    throw new Error(
      `better-sqlite3 ships no prebuilt binary for ${platform}-${arch} (has: ${available}). ` +
        `Since 13.0.2 the package has no install script, so there is no source build to ` +
        `fall back on — that platform cannot ship an embedded CLI.`
    )
  }

  // Drop previously staged binaries first: one resources/ dir is reused across the
  // arches of a `--arm64 --x64` run, and a stale wrong-arch binary left next to the
  // right one would still be picked by the loader on that other arch.
  const stagedPrebuildsDir = path.join(stagedSqliteDir, 'prebuilds')
  fs.rmSync(stagedPrebuildsDir, { recursive: true, force: true })
  fs.mkdirSync(stagedPrebuildsDir, { recursive: true })
  const bindingPath = stagedSqliteBindingPath({ platform, arch })
  fs.copyFileSync(sourcePath, bindingPath)

  console.log(`Staged embedded better-sqlite3 binding (${platform}-${arch})`)
  return bindingPath
}

/**
 * Fetches a binary package for a platform/arch the build host is not. npm refuses to
 * install across its `os`/`cpu` fields without `--force`; the download itself is
 * platform-agnostic. Installed into a throwaway prefix so the workspace tree is untouched.
 */
function fetchNativePackage(packageName, version) {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-native-package-'))
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    [
      'install',
      `${packageName}@${version}`,
      '--prefix',
      downloadDir,
      '--no-save',
      '--no-audit',
      '--no-fund',
      '--ignore-scripts',
      '--omit=optional',
      '--force'
    ],
    { stdio: 'inherit' }
  )

  const packageDir = path.join(downloadDir, 'node_modules', ...packageName.split('/'))
  if (result.status !== 0 || !fs.existsSync(path.join(packageDir, 'package.json'))) {
    fs.rmSync(downloadDir, { recursive: true, force: true })
    throw new Error(
      `Failed to download ${packageName}@${version} for the embedded CLI native binding. ` +
        `It is fetched from the npm registry because the build host is ` +
        `${process.platform}-${process.arch}; set a registry mirror on restricted networks.`
    )
  }
  return { packageDir, cleanup: () => fs.rmSync(downloadDir, { recursive: true, force: true }) }
}

/** Sharp has a target-specific Node-API addon and (except Windows) a libvips package. */
export function sharpTargetPackages({ platform, arch }) {
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch))
    throw new Error(`Unsupported embedded image decoder target: ${platform}-${arch}`)
  return [
    `@img/sharp-${platform}-${arch}`,
    ...(platform === 'win32' ? [] : [`@img/sharp-libvips-${platform}-${arch}`])
  ]
}

export function installEmbeddedSharpBinding(target) {
  const names = sharpTargetPackages(target)
  const sharpDir = resolvePackageDir('sharp', cliAppRoot)
  const metadata = JSON.parse(fs.readFileSync(path.join(sharpDir, 'package.json'), 'utf8'))
  const scope = path.join(stagedNodeModulesDir, '@img')
  if (!fs.existsSync(path.join(stagedNodeModulesDir, 'sharp', 'package.json')))
    throw new Error('Stage CLI runtime packages before its image decoder binding')
  fs.mkdirSync(scope, { recursive: true })
  for (const entry of fs.readdirSync(scope, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('sharp-'))
      fs.rmSync(path.join(scope, entry.name), { recursive: true, force: true })
  }
  for (const name of names) {
    const version = metadata.optionalDependencies?.[name]
    if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`Unpinned decoder package ${name}`)
    const installed = path.resolve(sharpDir, '..', name)
    const present = fs.existsSync(path.join(installed, 'package.json'))
    const downloaded = present ? undefined : fetchNativePackage(name, version)
    try {
      const source = present ? installed : downloaded.packageDir
      const actual = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
      if (actual.name !== name || actual.version !== version)
        throw new Error(`Unexpected decoder package ${name}`)
      copyPackageDir(source, path.join(stagedNodeModulesDir, name), { isTopLevel: false })
    } finally {
      downloaded?.cleanup()
    }
  }
  assertEmbeddedSharpPackages(stagedNodeModulesDir, target)
}

export function assertEmbeddedSharpPackages(nodeModulesDir, target) {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(nodeModulesDir, 'sharp/package.json'), 'utf8')
  )
  for (const name of sharpTargetPackages(target)) {
    const directory = path.join(nodeModulesDir, name)
    const actual = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
    if (actual.name !== name || actual.version !== metadata.optionalDependencies[name])
      throw new Error(`Mismatched packaged image decoder ${name}`)
    const resources = fs.readdirSync(path.join(directory, 'lib'))
    if (!resources.some((file) => /\.(node|dll|dylib|so(?:\.\d+)*)$/.test(file)))
      throw new Error(`Packaged image decoder binary missing: ${name}`)
  }
}
