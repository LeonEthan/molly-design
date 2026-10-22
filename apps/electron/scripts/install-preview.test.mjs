import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { previewPackagingConfig } from './preview-packaging.mjs'
import {
  assertPreviewBundle,
  installPreviewBundle,
  selectPreviewSigningIdentity
} from './install-preview.mjs'

void test('release configuration inheritance leaves only the Preview protocol and no update feed', async () => {
  const require = createRequire(import.meta.url)
  const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
  const { getConfig } = builderRequire('app-builder-lib/out/util/config/config')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-preview-config-'))
  try {
    const configPath = path.join(root, 'builder.json')
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        extends: fileURLToPath(new URL('../electron-builder.yml', import.meta.url)),
        ...previewPackagingConfig()
      })
    )
    const config = await getConfig(fileURLToPath(new URL('../', import.meta.url)), configPath, null)
    assert.deepEqual(config.protocols, {
      name: 'Molly Preview Desktop',
      schemes: ['molly-preview']
    })
    assert.equal(config.mac.extendInfo.SUFeedURL, '')
    assert.equal(config.mac.extendInfo.SUEnableAutomaticChecks, false)
    assert.equal(config.mac.timestamp, 'none')
    assert.equal(config.publish, null)
    assert.equal(config.extraMetadata.mollyChannel, 'preview')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

void test('selects a local signing identity in the format accepted by electron-builder', () => {
  assert.equal(
    selectPreviewSigningIdentity(
      '1) ABC "Apple Development: Test (TEAM)"\n2) DEF "Developer ID Application: Publisher (TEAM)"'
    ),
    'Publisher (TEAM)'
  )
  assert.equal(selectPreviewSigningIdentity('1) ABC "Apple Development: Test (TEAM)"'), undefined)
  assert.equal(selectPreviewSigningIdentity('0 valid identities found'), undefined)
})

void test(
  'Preview packaging rejects publication before launching the builder',
  { skip: process.platform !== 'darwin' },
  () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./package-electron.mjs', import.meta.url)),
        '--preview',
        '--publish=always'
      ],
      { encoding: 'utf8' }
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Molly Preview cannot be published/u)
  }
)

function signedFixture(
  root,
  name,
  identifier = 'dev.molly-design.preview',
  schemes = ['molly-preview']
) {
  const app = path.join(root, name)
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true })
  fs.copyFileSync('/usr/bin/true', path.join(app, 'Contents', 'MacOS', 'PreviewProbe'))
  fs.writeFileSync(
    path.join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${identifier}</string>
<key>CFBundleExecutable</key><string>PreviewProbe</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array>${schemes.map((scheme) => `<string>${scheme}</string>`).join('')}</array></dict></array>
<key>SUEnableAutomaticChecks</key><false/>
</dict></plist>`
  )
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { stdio: 'pipe' })
  return app
}

void test(
  'installs and replaces only Preview while preserving external data',
  { skip: process.platform !== 'darwin' },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-preview-installer-'))
    try {
      const source = signedFixture(root, 'source.app')
      const applications = path.join(root, 'Applications')
      const data = path.join(root, 'preview-data')
      fs.writeFileSync(data, 'preserved')
      const installed = installPreviewBundle(source, applications)
      fs.writeFileSync(path.join(installed, 'obsolete'), 'old binary content')
      assert.equal(installPreviewBundle(source, applications), installed)
      assert.equal(fs.existsSync(path.join(installed, 'obsolete')), false)
      assert.equal(fs.readFileSync(data, 'utf8'), 'preserved')
      execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed])
      assert.deepEqual(fs.readdirSync(applications), ['Molly Preview.app'])
      const mixed = signedFixture(root, 'mixed.app', 'dev.molly-design.preview', [
        'molly-preview',
        'molly-design'
      ])
      assert.throws(() => installPreviewBundle(mixed, applications), /only its own protocol/)
      assertPreviewBundle(installed)
      fs.rmSync(installed, { recursive: true })
      signedFixture(applications, 'Molly Preview.app', 'dev.molly-design.app')
      assert.throws(() => installPreviewBundle(source, applications), /non-Preview app/)
      const id = execFileSync(
        '/usr/bin/plutil',
        [
          '-extract',
          'CFBundleIdentifier',
          'raw',
          '-o',
          '-',
          path.join(installed, 'Contents', 'Info.plist')
        ],
        { encoding: 'utf8' }
      ).trim()
      assert.equal(id, 'dev.molly-design.app')
      const symlink = path.join(root, 'alias.app')
      fs.symlinkSync(source, symlink)
      assert.throws(() => assertPreviewBundle(symlink), /symlink/)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)
