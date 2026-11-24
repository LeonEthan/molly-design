/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript packaging tests. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildMollyCore,
  probeMollyCoreComposition,
  resolveMollyCoreTarget,
  verifyMollyCore
} from './molly-core-resources.mjs'

void test('resolves supported darwin and win32 targets and rejects unsupported ones', () => {
  assert.deepEqual(resolveMollyCoreTarget({ platform: 'darwin', arch: 'arm64' }), {
    goos: 'darwin',
    goarch: 'arm64',
    binary: 'molly-core'
  })
  assert.deepEqual(resolveMollyCoreTarget({ platform: 'win32', arch: 'x64' }), {
    goos: 'windows',
    goarch: 'amd64',
    binary: 'molly-core.exe'
  })
  assert.throws(() => resolveMollyCoreTarget({ platform: 'linux', arch: 'x64' }))
})

void test('builds, verifies, caches, and probes molly-core for current host and cross-builds win32-x64', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-core-pack-test-'))
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))

  const hostOut = path.join(tempRoot, 'host')
  const manifest = await buildMollyCore({
    platform: process.platform,
    arch: process.arch,
    outputDir: hostOut
  })
  assert.equal(manifest.name, 'molly-core')
  assert.equal(manifest.files.length, 1)

  const cached = await buildMollyCore({
    platform: process.platform,
    arch: process.arch,
    outputDir: hostOut
  })
  assert.equal(cached.buildId, manifest.buildId)

  const probed = probeMollyCoreComposition(path.join(hostOut, manifest.files[0].path))
  assert.equal(probed.name, 'molly-core')
  assert.equal(probed.composition.capabilities.localOnly, true)
  assert.equal(probed.composition.capabilities.telemetryEnabled, false)

  fs.writeFileSync(path.join(hostOut, 'extra.txt'), 'tamper')
  assert.throws(() => verifyMollyCore(hostOut), /Unlisted molly-core resource/u)
  fs.unlinkSync(path.join(hostOut, 'extra.txt'))

  const winOut = path.join(tempRoot, 'win32-x64')
  const winManifest = await buildMollyCore({
    platform: 'win32',
    arch: 'x64',
    outputDir: winOut
  })
  assert.equal(winManifest.goos, 'windows')
  assert.equal(winManifest.goarch, 'amd64')
  assert.equal(winManifest.files[0].path, 'molly-core.exe')
  assert.ok(fs.existsSync(path.join(winOut, 'molly-core.exe')))
})
