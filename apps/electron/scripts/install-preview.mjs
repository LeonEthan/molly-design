import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { previewProfile } from './preview-packaging.mjs'

const electronDirectory = fileURLToPath(new URL('../', import.meta.url))

export function selectPreviewSigningIdentity(identities) {
  const name = identities.match(/"(Developer ID Application:[^"]+)"/u)?.[1]
  return name?.replace(/^Developer ID Application:\s*/u, '')
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.status}`)
  }
  return result.stdout?.trim() ?? ''
}

export function assertPreviewBundle(bundle) {
  if (fs.lstatSync(bundle).isSymbolicLink()) throw new Error(`Refusing a symlink app: ${bundle}`)
  const identifier = run('/usr/bin/plutil', [
    '-extract',
    'CFBundleIdentifier',
    'raw',
    '-o',
    '-',
    path.join(bundle, 'Contents', 'Info.plist')
  ])
  if (identifier !== previewProfile.desktopAppId) {
    throw new Error(`Refusing to replace or install a non-Preview app: ${bundle}`)
  }
}

export function assertPreviewStopped(destination) {
  const commands = run('/bin/ps', ['-axo', 'comm='])
  if (
    commands.split('\n').some((command) => command.trim().startsWith(`${destination}/Contents/`))
  ) {
    throw new Error(
      'Quit Molly Preview before rebuilding or replacing it. Your data will be preserved.'
    )
  }
}

function assertPreviewIsolation(bundle) {
  const info = JSON.parse(
    run('/usr/bin/plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      path.join(bundle, 'Contents', 'Info.plist')
    ])
  )
  const schemes = (info.CFBundleURLTypes ?? []).flatMap((entry) => entry.CFBundleURLSchemes ?? [])
  if (
    schemes.length !== 1 ||
    schemes[0] !== previewProfile.desktopProtocol ||
    info.SUFeedURL ||
    info.SUPublicEDKey ||
    info.SUEnableAutomaticChecks !== false
  ) {
    throw new Error(
      'Preview package must have only its own protocol and disabled application updates'
    )
  }
}

export function installPreviewBundle(source, applicationsDirectory) {
  fs.mkdirSync(applicationsDirectory, { recursive: true })
  const destination = path.join(applicationsDirectory, `${previewProfile.desktopProductName}.app`)
  assertPreviewBundle(source)
  assertPreviewIsolation(source)
  assertPreviewStopped(destination)
  if (fs.existsSync(destination)) assertPreviewBundle(destination)
  const staging = fs.mkdtempSync(path.join(applicationsDirectory, '.molly-preview-install-'))
  const stagedApp = path.join(staging, path.basename(destination))
  const previous = path.join(staging, 'previous.app')
  let installed = false
  try {
    run('/usr/bin/ditto', [source, stagedApp])
    assertPreviewBundle(stagedApp)
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', stagedApp])
    assertPreviewStopped(destination)
    if (fs.existsSync(destination)) {
      assertPreviewBundle(destination)
      fs.renameSync(destination, previous)
    }
    try {
      fs.renameSync(stagedApp, destination)
      installed = true
    } catch (error) {
      if (fs.existsSync(previous)) fs.renameSync(previous, destination)
      throw error
    }
  } finally {
    if (installed || !fs.existsSync(previous)) fs.rmSync(staging, { recursive: true, force: true })
  }
  return destination
}

function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('Local Molly Preview currently supports Apple Silicon macOS only')
  }
  const applicationsDirectory = path.join(os.homedir(), 'Applications')
  const destination = path.join(applicationsDirectory, `${previewProfile.desktopProductName}.app`)
  assertPreviewStopped(destination)
  if (fs.existsSync(destination)) assertPreviewBundle(destination)
  const packageManager = process.env.npm_execpath
  if (!packageManager || !/\.(?:cjs|mjs|js)$/iu.test(packageManager)) {
    throw new Error('Run pnpm preview:install from the repository root')
  }
  const env = { ...process.env }
  if (!env.CSC_NAME?.trim() && !env.CSC_LINK?.trim()) {
    const identities = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'])
    env.CSC_NAME = selectPreviewSigningIdentity(identities)
  }
  const commit = run('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: electronDirectory })
  const dirty =
    run('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: electronDirectory
    }) !== ''
  const manifest = JSON.parse(fs.readFileSync(path.join(electronDirectory, 'package.json'), 'utf8'))
  const version = `${manifest.version.split('-')[0]}-preview.g${commit}${dirty ? '.dirty' : ''}`
  run(process.execPath, [packageManager, 'run', 'build'], {
    cwd: electronDirectory,
    env,
    stdio: 'inherit'
  })
  run(
    process.execPath,
    [
      packageManager,
      'run',
      'package',
      '--',
      '--preview',
      '--dir',
      '--mac',
      '--arm64',
      `--version=${version}`
    ],
    {
      cwd: electronDirectory,
      env,
      stdio: 'inherit'
    }
  )
  const source = path.join(
    electronDirectory,
    'dist',
    'preview',
    'mac-arm64',
    `${previewProfile.desktopProductName}.app`
  )
  const installed = installPreviewBundle(source, applicationsDirectory)
  console.log(
    `Installed ${installed}\nVersion: ${version}\nData: ~/.molly-preview\nSettings: ~/Library/Application Support/Molly Preview\nSigning: ${env.CSC_NAME || (env.CSC_LINK ? 'configured certificate' : 'ad-hoc; browser account import unavailable')}\nOpen Molly Preview from Finder. Quit it before running this command again.`
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
