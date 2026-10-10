import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const native = path.join(root, 'native', 'agent-browser')
const source = JSON.parse(fs.readFileSync(path.join(native, 'source.json'), 'utf8'))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const LICENSES = [
  'LICENSE',
  'LICENSE-axe-core.txt',
  'LICENSE-axe-core-THIRD-PARTY.txt',
  'NOTICE.txt'
]
const patchSha256 = () => sha256(fs.readFileSync(path.join(native, 'embedded.patch')))
export const agentBrowserResources = path.join(root, 'resources', 'agent-browser')

export function verifyAgentBrowser(directory, target = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
  if (
    manifest.revision !== source.revision ||
    manifest.protocol !== source.protocol ||
    manifest.patchSha256 !== patchSha256() ||
    manifest.rust !== source.rust
  )
    throw new Error('agent-browser source identity mismatch')
  if (
    (target.platform && target.platform !== manifest.platform) ||
    (target.arch && target.arch !== manifest.arch)
  )
    throw new Error('agent-browser target mismatch')
  const binary = manifest.platform === 'win32' ? 'agent-browser.exe' : 'agent-browser'
  const expected = [binary, ...LICENSES]
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length !== expected.length ||
    manifest.files.some((file) => !expected.includes(file.path)) ||
    new Set(manifest.files.map((file) => file.path)).size !== expected.length
  )
    throw new Error('Invalid agent-browser file list')
  for (const file of manifest.files) {
    const location = path.join(directory, file.path)
    if (!fs.lstatSync(location).isFile() || sha256(fs.readFileSync(location)) !== file.sha256)
      throw new Error(`Invalid agent-browser resource: ${file.path}`)
  }
  if (manifest.buildId !== sha256(JSON.stringify(manifest.files)))
    throw new Error('agent-browser build identity mismatch')
  if (
    fs.readdirSync(directory).some((file) => file !== 'manifest.json' && !expected.includes(file))
  )
    throw new Error('Unlisted agent-browser resource')
  return manifest
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(cwd) }
  })
  if (result.error || result.status !== 0) throw new Error(`agent-browser build failed: ${command}`)
}

export async function buildAgentBrowser({ platform = process.platform, arch = process.arch } = {}) {
  try {
    verifyAgentBrowser(agentBrowserResources, { platform, arch })
    return
  } catch {}
  const target = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'win32-x64': 'x86_64-pc-windows-msvc',
    'win32-arm64': 'aarch64-pc-windows-msvc'
  }[`${platform}-${arch}`]
  if (!target) throw new Error(`Unsupported agent-browser target: ${platform}-${arch}`)
  const compiler = spawnSync('rustc', ['--version'], { encoding: 'utf8' })
  if (compiler.status !== 0 || !compiler.stdout.startsWith(`rustc ${source.rust} `))
    throw new Error(
      `Install Rust ${source.rust} and target ${target} to build the embedded browser driver.`
    )
  const patch = fs.readFileSync(path.join(native, 'embedded.patch'))
  const digest = sha256(patch)
  const cache = path.join(root, '.cache', 'agent-browser', `${source.revision}-${digest}`)
  const checkout = path.join(cache, 'source')
  fs.mkdirSync(cache, { recursive: true })
  if (!fs.existsSync(path.join(checkout, '.molly-patched'))) {
    const response = await fetch(
      `https://codeload.github.com/vercel-labs/agent-browser/tar.gz/${source.revision}`
    )
    if (!response.ok) throw new Error('agent-browser source download failed')
    const archive = Buffer.from(await response.arrayBuffer())
    if (sha256(archive) !== source.archiveSha256)
      throw new Error('agent-browser source checksum mismatch')
    fs.writeFileSync(path.join(cache, 'source.tar.gz'), archive)
    fs.rmSync(checkout, { recursive: true, force: true })
    fs.mkdirSync(checkout)
    run(
      'tar',
      ['-xzf', path.join(cache, 'source.tar.gz'), '--strip-components=1', '-C', checkout],
      cache
    )
    fs.writeFileSync(path.join(cache, 'embedded.patch'), patch)
    run('git', ['apply', path.join(cache, 'embedded.patch')], checkout)
    fs.writeFileSync(path.join(checkout, '.molly-patched'), digest)
  }
  const targetDirectory = path.join(root, '.cache', 'agent-browser', 'target')
  run(
    'cargo',
    [
      'build',
      '--target-dir',
      targetDirectory,
      '--release',
      '--locked',
      '--target',
      target,
      '--manifest-path',
      path.join(checkout, 'cli', 'Cargo.toml')
    ],
    checkout
  )
  if (patchSha256() !== digest) throw new Error('agent-browser patch changed during build')
  const binary = platform === 'win32' ? 'agent-browser.exe' : 'agent-browser'
  fs.rmSync(agentBrowserResources, { recursive: true, force: true })
  fs.mkdirSync(agentBrowserResources, { recursive: true })
  fs.copyFileSync(
    path.join(targetDirectory, target, 'release', binary),
    path.join(agentBrowserResources, binary)
  )
  fs.chmodSync(path.join(agentBrowserResources, binary), 0o755)
  for (const name of LICENSES)
    fs.copyFileSync(path.join(native, name), path.join(agentBrowserResources, name))
  const files = [binary, ...LICENSES].map((file) => ({
    path: file,
    sha256: sha256(fs.readFileSync(path.join(agentBrowserResources, file)))
  }))
  fs.writeFileSync(
    path.join(agentBrowserResources, 'manifest.json'),
    `${JSON.stringify({ ...source, platform, arch, target, patchSha256: digest, files, buildId: sha256(JSON.stringify(files)) }, null, 2)}\n`
  )
  verifyAgentBrowser(agentBrowserResources, { platform, arch })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildAgentBrowser()
