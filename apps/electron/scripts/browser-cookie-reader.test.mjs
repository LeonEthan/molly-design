import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import {
  browserCookieReaderResources,
  verifyBrowserCookieReader
} from './browser-cookie-reader-resources.mjs'

const require = createRequire(import.meta.url)

void test(
  'synthetic native fixtures preserve file and Keychain denial categories',
  { skip: process.platform !== 'darwin' },
  () => {
    const manifest = verifyBrowserCookieReader(browserCookieReaderResources, {
      platform: process.platform,
      arch: process.arch
    })
    const cache = new URL('../.cache/browser-cookie-reader/', import.meta.url)
    const checkout = new URL(`${manifest.revision}-${manifest.patchSha256}/source/`, cache)
    const result = spawnSync(
      'cargo',
      [
        'test',
        '--locked',
        '--manifest-path',
        fileURLToPath(new URL('Cargo.toml', checkout)),
        '-p',
        'rookie-cookies',
        '--lib',
        'molly_',
        '--target-dir',
        fileURLToPath(new URL('target/', cache))
      ],
      { encoding: 'utf8' }
    )
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(
      result.stdout,
      /molly_profile_access_classifies_eperm_and_keeps_eacces_generic \.\.\. ok/
    )
    assert.match(
      result.stdout,
      /molly_keychain_denial_passes_through_the_platform_provider_without_decrypting \.\.\. ok/
    )
    assert.match(result.stdout, /molly_inventory_retains_raw_rows_before_main_selection \.\.\. ok/)
    assert.match(
      result.stdout,
      /molly_inventory_keeps_host_failures_and_rejects_lossy_expiry \.\.\. ok/
    )
  }
)
void test('packaging re-includes the cookie reader license after excluding Markdown', async () => {
  const yml = await readFile(new URL('../electron-builder.yml', import.meta.url), 'utf8')
  const markdownExclusion = yml.indexOf("\n  - '!**/*.{md,markdown,mkd}'\n")
  const licenseInclude = yml.indexOf("\n  - 'resources/browser-cookie-reader/LICENSE.md'\n")
  assert.notEqual(markdownExclusion, -1)
  assert.ok(
    licenseInclude > markdownExclusion,
    'LICENSE.md must be re-included after the Markdown exclusion so afterPack can verify it'
  )
})

void test(
  'sealed native addon reads a synthetic SQLite/WAL snapshot and rejects oversized profiles',
  { skip: process.platform !== 'darwin' },
  async () => {
    const manifest = verifyBrowserCookieReader(browserCookieReaderResources, {
      platform: process.platform,
      arch: process.arch
    })
    const reader = require(join(browserCookieReaderResources, 'rookie-cookies.node'))
    assert.equal(reader.version(), manifest.version)
    const directory = await mkdtemp(join(tmpdir(), 'molly-native-cookie-fixture-'))
    const path = join(directory, 'Cookies')
    const database = new DatabaseSync(path)
    try {
      database.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta VALUES ('version', '23');
      CREATE TABLE cookies (host_key TEXT, path TEXT, is_secure INTEGER, expires_utc INTEGER, name TEXT, value TEXT, encrypted_value BLOB, is_httponly INTEGER, samesite INTEGER);
      INSERT INTO cookies VALUES ('.example.test', '/', 1, 0, 'synthetic', 'fixture-only', X'', 1, 1);
    `)
      const read = await reader.fromPath({
        path,
        plaintextOnly: true,
        includeExpired: true,
        appBound: 'disabled'
      })
      assert.equal(read.detailedCookies[0].cookie.value, 'fixture-only')
      assert.equal(read.detailedCookies[0].cookie.domain, '.example.test')
      database.exec(
        "INSERT INTO cookies VALUES ('.example.test', '/', 1, 0, 'invalid name', 'fixture-only', X'', 1, 1)"
      )
      const stock = await reader.fromPath({
        path,
        plaintextOnly: true,
        includeExpired: true,
        appBound: 'disabled'
      })
      assert.equal(stock.detailedCookies.length, 1)
      assert.equal(
        stock.warnings.some((warning) => warning.count > 0),
        true
      )
      const inventory = await reader.fromPath({
        path,
        plaintextOnly: true,
        includeExpired: true,
        mollyInventory: true,
        appBound: 'disabled'
      })
      assert.deepEqual(inventory.detailedCookies.map((entry) => entry.cookie.name).sort(), [
        'invalid name',
        'synthetic'
      ])
      assert.equal(
        inventory.warnings.every((warning) => warning.count === 0),
        true
      )
      const insert = database.prepare(
        "INSERT INTO cookies VALUES ('.example.test', '/', 1, 0, ?, 'fixture-only', X'', 1, 1)"
      )
      database.exec('BEGIN')
      for (let index = 0; index < 50000; index++) insert.run(`synthetic-${index}`)
      database.exec('COMMIT')
      await assert.rejects(
        reader.fromPath({ path, plaintextOnly: true, includeExpired: true, appBound: 'disabled' })
      )
    } finally {
      database.close()
      await rm(directory, { recursive: true, force: true })
    }
  }
)

void test(
  'explicit-path reads report rows that failed extraction instead of dropping them',
  { skip: process.platform !== 'darwin' },
  async () => {
    const reader = require(join(browserCookieReaderResources, 'rookie-cookies.node'))
    const directory = await mkdtemp(join(tmpdir(), 'molly-native-failing-rows-'))
    const path = join(directory, 'Cookies')
    const database = new DatabaseSync(path)
    try {
      database.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta VALUES ('version', '23');
      CREATE TABLE cookies (host_key TEXT, path TEXT, is_secure INTEGER, expires_utc INTEGER, name TEXT, value TEXT, encrypted_value BLOB, is_httponly INTEGER, samesite INTEGER);
      INSERT INTO cookies VALUES ('.example.test', '/', 1, 0, 'plain', 'fixture-only', X'', 1, 1);
      INSERT INTO cookies VALUES ('.example.test', '/', 1, 0, 'broken-one', '', X'763130626164', 1, 1);
      INSERT INTO cookies VALUES ('.example.test', '/', 1, 0, 'broken-two', '', X'763130626164', 1, 1);
    `)
      database.close()
      // An absent browser identity carries no Keychain item, so no system prompt is involved.
      const result = await reader.fromPath({
        path,
        browserId: 'chromium',
        includeExpired: true,
        mollyInventory: true,
        appBound: 'disabled'
      })
      assert.equal(result.detailedCookies.length, 1)
      assert.equal(result.detailedCookies[0].cookie.name, 'plain')
      assert.equal(
        result.warnings.reduce((total, warning) => total + warning.count, 0) >= 2,
        true,
        JSON.stringify(result.warnings)
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
)

void test(
  'native discovery does not offer a symlinked profile directory',
  { skip: process.platform !== 'darwin' },
  async () => {
    const reader = require(join(browserCookieReaderResources, 'rookie-cookies.node'))
    const home = await realpath(await mkdtemp(join(tmpdir(), 'molly-native-symlink-home-')))
    const previous = process.env.HOME
    try {
      const root = join(home, 'Library', 'Application Support', 'Google', 'Chrome')
      await mkdir(join(root, 'Default', 'Network'), { recursive: true })
      await writeFile(join(root, 'Default', 'Network', 'Cookies'), '')
      await mkdir(join(home, 'elsewhere', 'Network'), { recursive: true })
      await writeFile(join(home, 'elsewhere', 'Network', 'Cookies'), '')
      await symlink(join(home, 'elsewhere'), join(root, 'Profile 1'))
      await mkdir(join(home, 'Applications', 'Google Chrome.app'), { recursive: true })
      await writeFile(
        join(root, 'Local State'),
        JSON.stringify({
          profile: {
            info_cache: { Default: { name: 'Synthetic' }, 'Profile 1': { name: 'Linked' } }
          }
        })
      )
      process.env.HOME = home
      const profiles = await reader.browserProfiles('chrome', { timeoutMs: 30000 })
      assert.deepEqual(
        profiles.map((entry) => entry.profile.displayName),
        ['Synthetic']
      )
    } finally {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  }
)

void test(
  'native discovery does not offer a symlinked flat user-data root',
  { skip: process.platform !== 'darwin' },
  async () => {
    const reader = require(join(browserCookieReaderResources, 'rookie-cookies.node'))
    const home = await realpath(await mkdtemp(join(tmpdir(), 'molly-native-flat-root-')))
    const previous = process.env.HOME
    try {
      const support = join(home, 'Library', 'Application Support')
      const root = join(support, 'com.operasoftware.Opera')
      const elsewhere = join(home, 'elsewhere')
      await mkdir(root, { recursive: true })
      await writeFile(join(root, 'Cookies'), '')
      await mkdir(elsewhere, { recursive: true })
      await writeFile(join(elsewhere, 'Cookies'), '')
      process.env.HOME = home
      const control = await reader.browserProfiles('opera', { timeoutMs: 30000 })
      assert.equal(control.length, 1)
      await rm(root, { recursive: true, force: true })
      await symlink(elsewhere, root)
      await assert.rejects(reader.browserProfiles('opera', { timeoutMs: 30000 }), (error) =>
        error.message.includes('installation root path contains a symbolic link')
      )
    } finally {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  }
)

void test(
  'native discovery does not offer a user-data root behind a symlinked ancestor',
  { skip: process.platform !== 'darwin' },
  async () => {
    const reader = require(join(browserCookieReaderResources, 'rookie-cookies.node'))
    const home = await realpath(await mkdtemp(join(tmpdir(), 'molly-native-ancestor-')))
    const previous = process.env.HOME
    try {
      const vendor = join(home, 'Library', 'Application Support', 'Google')
      const relocated = join(home, 'elsewhere', 'Google')
      for (const base of [vendor, relocated]) {
        await mkdir(join(base, 'Chrome', 'Default', 'Network'), { recursive: true })
        await writeFile(join(base, 'Chrome', 'Default', 'Network', 'Cookies'), '')
        await writeFile(
          join(base, 'Chrome', 'Local State'),
          JSON.stringify({ profile: { info_cache: { Default: { name: 'Synthetic' } } } })
        )
      }
      await mkdir(join(home, 'Applications', 'Google Chrome.app'), { recursive: true })
      process.env.HOME = home
      const control = await reader.browserProfiles('chrome', { timeoutMs: 30000 })
      assert.equal(control.length, 1)
      await rm(vendor, { recursive: true, force: true })
      await symlink(relocated, vendor)
      const offered = await reader
        .browserProfiles('chrome', { timeoutMs: 30000 })
        .then((profiles) => profiles.length)
        .catch((error) => {
          assert.match(error.message, /installation root path contains a symbolic link/u)
          return 0
        })
      assert.equal(offered, 0)
    } finally {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
      await rm(home, { recursive: true, force: true })
    }
  }
)
