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

void test('constructs notarytool credentials from flags or the release environment', async () => {
  const { signingOptions } = await import('./package-mygo-desktop.mjs')
  const args = ['--developer-id', '--notarize']
  const expected = ['--key', 'test.p8', '--key-id', 'id', '--issuer', 'issuer']
  assert.deepEqual(
    signingOptions(
      [...args, '--notary-key', 'test.p8', '--notary-key-id', 'id', '--notary-issuer', 'issuer'],
      {}
    ).notaryArgs,
    expected
  )
  assert.deepEqual(
    signingOptions(args, {
      APPLE_API_KEY: 'test.p8',
      APPLE_API_KEY_ID: 'id',
      APPLE_API_ISSUER: 'issuer'
    }).notaryArgs,
    expected
  )
  for (const mode of ['--ad-hoc', '--no-sign']) {
    assert.throws(
      () => signingOptions([mode, '--notarize', '--notary-profile', 'test'], {}),
      /requires Developer ID/
    )
  }
})

void test('renders optional Sparkle metadata into the bundle plist', async () => {
  const { renderInfoPlist, signingOptions } = await import('./package-mygo-desktop.mjs')
  const app = { appName: 'Molly', bundleId: 'test.molly' }
  assert.doesNotMatch(renderInfoPlist(app), /SUFeedURL|SUPublicEDKey/)
  const options = signingOptions(
    ['--sparkle-feed-url', 'https://test.invalid/feed?a=1&b=2', '--sparkle-public-key', 'abc='],
    {}
  )
  const plist = renderInfoPlist({ ...app, ...options })
  assert.match(
    plist,
    /<key>SUFeedURL<\/key>\s*<string>https:\/\/test.invalid\/feed\?a=1&amp;b=2<\/string>/
  )
  assert.match(plist, /<key>SUPublicEDKey<\/key>\s*<string>abc=<\/string>/)
  assert.match(plist, /<key>SUEnableInstallerLauncherService<\/key>\s*<false\/>/)
})

void test(
  'embeds and signs Sparkle.framework inside-out and verifies EdDSA update signature + tamper rejection',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const { generateKeyPairSync, sign, verify } = await import('node:crypto')
    const { spawnSync } = await import('node:child_process')
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-mygo-sparkle-test-'))
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const spki = publicKey.export({ type: 'spki', format: 'der' })
    const rawPubKeyBase64 = spki.subarray(spki.length - 32).toString('base64')

    const report = await packageMyGoDesktop({
      outputDir: outDir,
      version: '0.2.1',
      bundleNode: false,
      adHocSign: true,
      includeCliResources: false,
      sparkleFeedUrl: 'http://127.0.0.1:4371/appcast.xml',
      sparklePublicKey: rawPubKeyBase64
    })
    assert.equal(report.sparkleEmbedded, true)
    assert.ok(report.sizesBytes.sparkleFramework > 0)
    assert.ok(
      fs.existsSync(
        path.join(report.appPath, 'Contents', 'Frameworks', 'Sparkle.framework', 'Sparkle')
      )
    )
    const plistText = fs.readFileSync(path.join(report.appPath, 'Contents', 'Info.plist'), 'utf8')
    assert.match(plistText, /<key>CFBundleShortVersionString<\/key>\s*<string>0\.2\.1<\/string>/)
    assert.match(plistText, new RegExp(rawPubKeyBase64.replaceAll('+', '\\+')))

    const versionCheck = spawnSync(
      path.join(report.appPath, 'Contents', 'MacOS', 'Molly Experimental'),
      ['--version'],
      { encoding: 'utf8' }
    )
    assert.equal(versionCheck.status, 0, versionCheck.stderr)
    assert.match(versionCheck.stdout, /molly-desktop 0\.2\.1\b/)

    // Create a release zip archive and verify Ed25519 signature acceptance + tamper rejection.
    const archivePath = path.join(outDir, 'Molly-0.2.1.zip')
    const ditto = spawnSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', report.appPath, archivePath], {
      encoding: 'utf8'
    })
    assert.equal(ditto.status, 0, ditto.stderr)
    const archiveBytes = fs.readFileSync(archivePath)
    const signature = sign(null, archiveBytes, privateKey)
    assert.equal(verify(null, archiveBytes, publicKey, signature), true)

    const tampered = Buffer.from(archiveBytes)
    tampered[tampered.length - 1] ^= 0xff
    assert.equal(verify(null, tampered, publicKey, signature), false)
  }
)
