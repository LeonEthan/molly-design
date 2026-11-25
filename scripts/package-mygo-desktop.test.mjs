/* eslint-disable @typescript-eslint/explicit-function-return-type -- Experimental MyGo packager test. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { packageMyGoDesktop } from './package-mygo-desktop.mjs'

void test(
  'packages, seals, ad-hoc signs, and verifies experimental MyGo macOS .app bundle',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-mygo-app-test-'))
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

    const report = await packageMyGoDesktop({
      outputDir: outDir,
      bundleNode: true,
      adHocSign: true,
      includeCliResources: true
    })
    assert.equal(report.platform, 'darwin')
    assert.equal(report.adHocSigned, true)
    assert.equal(report.cliRuntimeComplete, true)
    assert.ok(report.bundledNodeVersion)
    assert.ok(report.sizesBytes.mollyDesktopBinary > 0)
    assert.ok(report.sizesBytes.mollyCoreDir > 0)
    assert.ok(report.sizesBytes.rendererDir > 0)
    assert.ok(report.sizesBytes.designDir > 0)
    assert.ok(report.sizesBytes.totalApp > 0)
    assert.ok(fs.existsSync(path.join(report.appPath, 'Contents', 'Info.plist')))
    assert.ok(
      fs.existsSync(path.join(report.appPath, 'Contents', 'Resources', 'bundle-manifest.json'))
    )
  }
)

void test(
  'rejects incomplete CLI runtime closure (missing loro-crdt WASM) when packaging MyGo desktop bundle',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-mygo-incomplete-cli-'))
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
    const badCliDir = path.join(tmp, 'cli')
    const realCliDir = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      'apps',
      'electron',
      'resources',
      'cli'
    )
    fs.cpSync(realCliDir, badCliDir, { recursive: true })
    fs.rmSync(path.join(badCliDir, 'node_modules', 'loro-crdt', 'nodejs', 'loro_wasm_bg.wasm'))

    await assert.rejects(
      () =>
        packageMyGoDesktop({
          outputDir: path.join(tmp, 'out'),
          bundleNode: false,
          adHocSign: false,
          includeCliResources: true,
          cliResourcesDir: badCliDir
        }),
      /loro_wasm_bg\.wasm/u
    )
  }
)

void test('signing modes and notarization credentials', async () => {
  const { signingOptions, developerIdentity } = await import('./package-mygo-desktop.mjs')
  assert.equal(signingOptions([], {}).adHocSign, true)
  assert.equal(signingOptions(['--developer-id'], {}).signIdentity, developerIdentity)
  assert.equal(
    signingOptions(['--sign-identity', developerIdentity], {}).signIdentity,
    developerIdentity
  )
  assert.equal(
    signingOptions(['--ad-hoc'], { MOLLY_MACOS_SIGN_IDENTITY: developerIdentity }).signIdentity,
    undefined
  )
  assert.throws(() => signingOptions(['--developer-id', '--no-sign'], {}), /Conflicting/)
  assert.throws(
    () => signingOptions(['--developer-id', '--notarize'], {}),
    /Missing notarization credentials/
  )
  assert.deepEqual(
    signingOptions(['--notarize', '--notary-profile', 'test'], {
      MOLLY_MACOS_SIGN_IDENTITY: developerIdentity
    }).notaryArgs,
    ['--keychain-profile', 'test']
  )
})

void test('rejects a signature with a different team or missing hardened runtime', async () => {
  const { developerIdentity, verifyDeveloperSignatureDetails } =
    await import('./package-mygo-desktop.mjs')
  const stderr = `Authority=${developerIdentity}\nTeamIdentifier=Q96C8424X6\nCodeDirectory flags=0x10000(runtime)\n`
  const inspect = (details) =>
    verifyDeveloperSignatureDetails({ status: 0, stderr: details }, 'fixture', developerIdentity)
  assert.equal(inspect(stderr).hardenedRuntime, true)
  assert.throws(
    () => inspect(stderr.replace('TeamIdentifier=Q96C8424X6', 'TeamIdentifier=OTHER')),
    /Invalid Developer ID/
  )
  assert.throws(() => inspect(stderr.replace('(runtime)', '(adhoc)')), /Invalid Developer ID/)
})
