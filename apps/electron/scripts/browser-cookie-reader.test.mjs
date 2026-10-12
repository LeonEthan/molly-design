import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  browserCookieReaderResources,
  verifyBrowserCookieReader
} from './browser-cookie-reader-resources.mjs'

const require = createRequire(import.meta.url)
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
