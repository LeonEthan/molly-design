import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { agentBrowserCacheInputs, verifyAgentBrowser } from './agent-browser-resources.mjs'
import {
  browserCookieReaderCacheInputs,
  verifyBrowserCookieReader
} from './browser-cookie-reader-resources.mjs'
import { nativeResourceCacheKey, reuseVerifiedResource } from './native-resource-cache.mjs'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const temporaryDirectory = (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-native-cache-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

const probe = {
  platform: 'darwin',
  arch: 'arm64',
  runner: { os: 'macOS', image: 'macos15', imageVersion: '20261012.0001.1' },
  toolchain: {
    rustc: 'rustc 1.99.0 (b940084d7 2026-09-28)\nhost: aarch64-apple-darwin',
    cargo: 'cargo 1.99.0',
    sdk: '26.0 25A000'
  },
  environment: {}
}

function syntheticDescriptor(t) {
  const root = temporaryDirectory(t)
  const write = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), text)
    return path.join(root, name)
  }
  write('native/README.md', 'documentation')
  write('src/main/app.ts', 'export const app = 1')
  return {
    root,
    descriptor: {
      name: 'synthetic',
      root,
      targets: { 'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin' },
      inputs: [
        write('native/source.json', '{"revision":"a","archiveSha256":"b","rust":"1.99.0"}'),
        write('native/embedded.patch', 'diff'),
        write('native/LICENSE', 'license'),
        write('scripts/resources.mjs', 'build()'),
        write('scripts/native-resource-cache.mjs', 'key()')
      ]
    }
  }
}

void test('cache key changes with every native build input and ignores unrelated edits', (t) => {
  const { root, descriptor } = syntheticDescriptor(t)
  const base = nativeResourceCacheKey(descriptor, probe)
  assert.match(base, /^molly-native-synthetic-darwin-arm64-[0-9a-f]{64}$/)
  assert.equal(nativeResourceCacheKey(descriptor, probe), base)

  for (const name of ['native/README.md', 'src/main/app.ts']) {
    fs.appendFileSync(path.join(root, name), ' unrelated edit')
    assert.equal(nativeResourceCacheKey(descriptor, probe), base, name)
  }

  for (const file of descriptor.inputs) {
    const original = fs.readFileSync(file)
    fs.appendFileSync(file, ' changed')
    assert.notEqual(nativeResourceCacheKey(descriptor, probe), base, path.relative(root, file))
    fs.writeFileSync(file, original)
  }
  assert.equal(nativeResourceCacheKey(descriptor, probe), base)

  const variants = {
    toolchain: { ...probe, toolchain: { ...probe.toolchain, rustc: 'rustc 1.100.0' } },
    sdk: { ...probe, toolchain: { ...probe.toolchain, sdk: '27.0 26A425' } },
    target: { ...probe, arch: 'x64' },
    runnerImage: { ...probe, runner: { ...probe.runner, image: 'macos26' } },
    runnerImageVersion: { ...probe, runner: { ...probe.runner, imageVersion: '20261019.0002.1' } },
    buildEnvironment: { ...probe, environment: { RUSTFLAGS: '-C target-cpu=native' } }
  }
  for (const [label, variant] of Object.entries(variants))
    assert.notEqual(nativeResourceCacheKey(descriptor, variant), base, label)

  assert.throws(
    () => nativeResourceCacheKey(descriptor, { ...probe, platform: 'linux', arch: 'x64' }),
    /Unsupported synthetic cache target: linux-x64/
  )
})

void test('real cache keys cover source manifest, patch, licenses and build scripts', () => {
  const resources = {
    'agent-browser': [
      agentBrowserCacheInputs,
      ['LICENSE', 'LICENSE-axe-core.txt', 'LICENSE-axe-core-THIRD-PARTY.txt', 'NOTICE.txt'],
      'agent-browser-resources.mjs'
    ],
    'browser-cookie-reader': [
      browserCookieReaderCacheInputs,
      ['LICENSE.md'],
      'browser-cookie-reader-resources.mjs'
    ]
  }
  for (const [name, [descriptor, licenses, script]] of Object.entries(resources)) {
    const inputs = descriptor.inputs.map((file) =>
      path.relative(descriptor.root, file).split(path.sep).join('/')
    )
    assert.deepEqual(
      inputs.sort(),
      [
        ...licenses.map((license) => `native/${name}/${license}`),
        `native/${name}/embedded.patch`,
        `native/${name}/source.json`,
        'scripts/native-resource-cache.mjs',
        `scripts/${script}`
      ].sort()
    )
    assert.equal(descriptor.targets['darwin-arm64'], 'aarch64-apple-darwin')
  }
})

const RESOURCES = [
  {
    name: 'agent-browser',
    binary: 'agent-browser',
    licenses: ['LICENSE', 'LICENSE-axe-core.txt', 'LICENSE-axe-core-THIRD-PARTY.txt', 'NOTICE.txt'],
    verify: verifyAgentBrowser
  },
  {
    name: 'browser-cookie-reader',
    binary: 'rookie-cookies.node',
    licenses: ['LICENSE.md'],
    verify: verifyBrowserCookieReader
  }
]

function writeManifest(directory, resource, manifest) {
  const files = [resource.binary, ...resource.licenses].map((file) => ({
    path: file,
    sha256: sha256(fs.readFileSync(path.join(directory, file)))
  }))
  fs.writeFileSync(
    path.join(directory, 'manifest.json'),
    JSON.stringify({ ...manifest, files, buildId: sha256(JSON.stringify(files)) })
  )
}

function stageRestoredResource(t, resource) {
  const parent = temporaryDirectory(t)
  const directory = path.join(parent, resource.name)
  const marker = path.join(parent, 'executed')
  const native = fileURLToPath(new URL(`../native/${resource.name}/`, import.meta.url))
  const source = JSON.parse(fs.readFileSync(path.join(native, 'source.json'), 'utf8'))
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, resource.binary), `#!/bin/sh\ntouch '${marker}'\n`, {
    mode: 0o755
  })
  for (const license of resource.licenses)
    fs.copyFileSync(path.join(native, license), path.join(directory, license))
  const manifest = {
    ...source,
    platform: 'darwin',
    arch: 'arm64',
    target: 'aarch64-apple-darwin',
    patchSha256: sha256(fs.readFileSync(path.join(native, 'embedded.patch')))
  }
  writeManifest(directory, resource, manifest)
  return { directory, marker, manifest }
}

const DAMAGE = {
  missing: ({ directory }) => fs.rmSync(directory, { recursive: true }),
  corruptBinary: ({ directory }, resource) =>
    fs.appendFileSync(path.join(directory, resource.binary), 'corrupt'),
  incompleteLicense: ({ directory }, resource) =>
    fs.rmSync(path.join(directory, resource.licenses[0])),
  missingManifest: ({ directory }) => fs.rmSync(path.join(directory, 'manifest.json')),
  unlistedFile: ({ directory }) => fs.writeFileSync(path.join(directory, 'payload'), 'extra'),
  staleSourceRevision: ({ directory, manifest }, resource) =>
    writeManifest(directory, resource, { ...manifest, revision: '0'.repeat(40) }),
  otherToolchain: ({ directory, manifest }, resource) =>
    writeManifest(directory, resource, { ...manifest, rust: '1.98.0' }),
  otherArchive: ({ directory, manifest }, resource) =>
    writeManifest(directory, resource, { ...manifest, archiveSha256: '0'.repeat(64) }),
  otherTargetTriple: ({ directory, manifest }, resource) =>
    writeManifest(directory, resource, { ...manifest, target: 'x86_64-apple-darwin' }),
  otherPatch: ({ directory, manifest }, resource) =>
    writeManifest(directory, resource, { ...manifest, patchSha256: '0'.repeat(64) }),
  resealedLicense: ({ directory, manifest }, resource) => {
    fs.writeFileSync(path.join(directory, resource.licenses[0]), 'replaced license')
    writeManifest(directory, resource, manifest)
  }
}

void test('a valid restored resource is reused through the existing verifier', (t) => {
  for (const resource of RESOURCES) {
    const restored = stageRestoredResource(t, resource)
    const lines = []
    const times = [10, 35]
    assert.equal(
      reuseVerifiedResource({
        name: resource.name,
        directory: restored.directory,
        verify: resource.verify,
        target: { platform: 'darwin', arch: 'arm64' },
        log: (line) => lines.push(line),
        now: () => times.shift()
      }),
      true
    )
    assert.deepEqual(lines, [
      `[native-resource] ${resource.name} verify=ok durationMs=25 action=reuse`
    ])
    assert.ok(fs.existsSync(path.join(restored.directory, 'manifest.json')))
    assert.equal(fs.existsSync(restored.marker), false)
  }
})

void test('missing, incompatible, corrupt and incomplete resources are removed for a clean rebuild without execution', (t) => {
  const cases = [
    ...Object.entries(DAMAGE).map(([label, damage]) => [
      label,
      damage,
      { platform: 'darwin', arch: 'arm64' }
    ]),
    ['incompatibleArch', () => {}, { platform: 'darwin', arch: 'x64' }],
    ['incompatiblePlatform', () => {}, { platform: 'win32', arch: 'arm64' }]
  ]
  for (const resource of RESOURCES)
    for (const [label, damage, target] of cases) {
      const restored = stageRestoredResource(t, resource)
      damage(restored, resource)
      const lines = []
      const reused = reuseVerifiedResource({
        name: resource.name,
        directory: restored.directory,
        verify: resource.verify,
        target,
        log: (line) => lines.push(line),
        now: () => 0
      })
      assert.equal(reused, false, `${resource.name} ${label}`)
      assert.equal(fs.existsSync(restored.directory), false, `${resource.name} ${label}`)
      assert.equal(fs.existsSync(restored.marker), false, `${resource.name} ${label}`)
      assert.equal(lines.length, 1)
      assert.match(
        lines[0],
        new RegExp(
          `^\\[native-resource\\] ${resource.name} verify=failed reason=".+" durationMs=0 action=rebuild$`
        )
      )
      if (label === 'missing') assert.match(lines[0], /reason="missing"/)
      if (label === 'resealedLicense') assert.match(lines[0], /license input mismatch/)
    }
})
