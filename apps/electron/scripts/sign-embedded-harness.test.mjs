/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript packaging fixtures. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import signEmbeddedHarness, { prepareEmbeddedHarnessSigning } from './sign-embedded-harness.mjs'
import { verifyEmbeddedHarness } from '../../cli/scripts/verify-embedded-harness.mjs'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const packageNames = ['pi-coding-agent', 'pi-ai', 'pi-agent-core', 'pi-tui']

function command(program, args, input) {
  const result = spawnSync(program, args, { input, encoding: 'utf8', timeout: 30_000 })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

function fixture(t, native = false) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-seal-test-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const app = path.join(temporary, 'Fixture.app')
  const directory = path.join(
    app,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'resources',
    'cli',
    'harness'
  )
  fs.mkdirSync(directory, { recursive: true })
  const paths = ['agent.js']
  fs.writeFileSync(path.join(directory, 'agent.js'), 'export const ready = true\n')
  for (const name of packageNames) {
    const relative = `node_modules/@earendil-works/${name}/package.json`
    const location = path.join(directory, relative)
    fs.mkdirSync(path.dirname(location), { recursive: true })
    fs.writeFileSync(
      location,
      JSON.stringify({ name: `@earendil-works/${name}`, version: '1.0.0' })
    )
    paths.push(relative)
  }
  const binary = path.join(directory, 'fixture.node')
  if (native) {
    command(
      '/usr/bin/clang',
      ['-dynamiclib', '-x', 'c', '-', '-o', binary],
      'int value(void) { return 42; }'
    )
    command('/usr/bin/codesign', [
      '--sign',
      '-',
      '--force',
      '--identifier',
      'original',
      '--timestamp=none',
      binary
    ])
    paths.push('fixture.node')
  }
  const files = paths.sort().map((relative) => ({
    path: relative,
    sha256: sha256(fs.readFileSync(path.join(directory, relative)))
  }))
  const manifest = {
    schemaVersion: 1,
    engineVersion: '1.0.0',
    protocolVersion: 1,
    packages: [],
    files,
    buildId: sha256(JSON.stringify(files))
  }
  fs.writeFileSync(path.join(directory, 'runtime-manifest.json'), `${JSON.stringify(manifest)}\n`)
  return { app, binary, directory, manifest }
}

void test('requires a valid full baseline seal before signing', (t) => {
  const { directory, manifest } = fixture(t)
  fs.writeFileSync(
    path.join(directory, 'runtime-manifest.json'),
    JSON.stringify({ ...manifest, buildId: 'invalid' })
  )
  assert.throws(() => prepareEmbeddedHarnessSigning(directory), /build digest mismatch/u)
})

void test('refuses unsigned resource or manifest changes and leaves the seal untouched', async (t) => {
  for (const mutation of ['plain', 'extra', 'symlink', 'missing', 'manifest']) {
    await t.test(mutation, (context) => {
      const { directory } = fixture(context)
      const reseal = prepareEmbeddedHarnessSigning(directory)
      const manifestPath = path.join(directory, 'runtime-manifest.json')
      const before = fs.readFileSync(manifestPath)
      switch (mutation) {
        case 'plain':
          fs.writeFileSync(path.join(directory, 'agent.js'), 'changed')
          break
        case 'extra':
          fs.writeFileSync(path.join(directory, 'extra.js'), 'extra')
          break
        case 'symlink':
          fs.symlinkSync('agent.js', path.join(directory, 'link'))
          break
        case 'missing':
          fs.unlinkSync(path.join(directory, 'agent.js'))
          break
        case 'manifest':
          fs.appendFileSync(manifestPath, ' ')
          break
      }
      assert.throws(reseal)
      assert.deepEqual(
        fs.readFileSync(manifestPath),
        mutation === 'manifest' ? Buffer.concat([before, Buffer.from(' ')]) : before
      )
    })
  }
})

void test(
  'refuses an otherwise valid signed native binary with a changed payload',
  { skip: process.platform !== 'darwin' },
  (t) => {
    const { directory, binary } = fixture(t, true)
    const reseal = prepareEmbeddedHarnessSigning(directory)
    command(
      '/usr/bin/clang',
      ['-dynamiclib', '-x', 'c', '-', '-o', binary],
      'int value(void) { return 43; }'
    )
    command('/usr/bin/codesign', ['--sign', '-', '--force', '--timestamp=none', binary])
    assert.throws(reseal, /native payload changed/u)
  }
)

void test(
  'public signer reseals inner native bytes before signing the root resource seal',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const { app, directory, manifest } = fixture(t, true)
    const executable = path.join(app, 'Contents', 'MacOS', 'Fixture')
    fs.mkdirSync(path.dirname(executable), { recursive: true })
    command('/usr/bin/clang', ['-x', 'c', '-', '-o', executable], 'int main(void) { return 0; }')
    fs.writeFileSync(
      path.join(app, 'Contents', 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.molly-design.seal-test</string><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`
    )
    const entitlements = path.join(path.dirname(app), 'entitlements.plist')
    fs.writeFileSync(
      entitlements,
      `<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>`
    )
    const visited = []
    await signEmbeddedHarness({
      app,
      platform: 'darwin',
      identity: '-',
      identityValidation: false,
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      optionsForFile(file) {
        visited.push(file)
        return { entitlements, hardenedRuntime: false, timestamp: 'none' }
      }
    })
    assert.equal(visited.at(-1), app)
    const signedManifest = verifyEmbeddedHarness(directory)
    assert.notEqual(signedManifest.buildId, manifest.buildId)
    assert.equal(signedManifest.buildId, sha256(JSON.stringify(signedManifest.files)))
    command('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
    assert.match(
      command('/usr/bin/codesign', ['--display', '--entitlements', '-', app]),
      /com.apple.security.cs.allow-jit/u
    )
  }
)
