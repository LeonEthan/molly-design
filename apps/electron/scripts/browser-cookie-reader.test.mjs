import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
