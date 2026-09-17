import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migrateLegacyUserDataDir } from './user-data-migration-core.ts'

const tempAppData = () => fs.mkdtempSync(path.join(os.tmpdir(), 'molly-userdata-migration-'))

void test('renames the legacy Geon userData dir when the Molly Design one is absent', () => {
  const appData = tempAppData()
  fs.mkdirSync(path.join(appData, 'Geon', 'Local Storage'), { recursive: true })
  const migrated = migrateLegacyUserDataDir({
    appDataDir: appData,
    productName: 'Molly Design',
    log: () => {}
  })
  assert.equal(migrated, true)
  assert.ok(fs.existsSync(path.join(appData, 'Molly Design', 'Local Storage')))
  assert.ok(!fs.existsSync(path.join(appData, 'Geon')))
})

void test('renames the legacy Folio userData dir when the Molly Design one is absent', () => {
  const appData = tempAppData()
  fs.mkdirSync(path.join(appData, 'Folio', 'Local Storage'), { recursive: true })
  const migrated = migrateLegacyUserDataDir({
    appDataDir: appData,
    productName: 'Molly Design',
    log: () => {}
  })
  assert.equal(migrated, true)
  assert.ok(fs.existsSync(path.join(appData, 'Molly Design', 'Local Storage')))
  assert.ok(!fs.existsSync(path.join(appData, 'Folio')))
})

void test('prefers the newer Geon dir when both legacy dirs exist', () => {
  const appData = tempAppData()
  fs.mkdirSync(path.join(appData, 'Folio'), { recursive: true })
  fs.mkdirSync(path.join(appData, 'Geon', 'Local Storage'), { recursive: true })
  const migrated = migrateLegacyUserDataDir({
    appDataDir: appData,
    productName: 'Molly Design',
    log: () => {}
  })
  assert.equal(migrated, true)
  assert.ok(fs.existsSync(path.join(appData, 'Molly Design', 'Local Storage')))
  assert.ok(!fs.existsSync(path.join(appData, 'Geon')))
  assert.ok(fs.existsSync(path.join(appData, 'Folio')))
})

void test('leaves an existing Molly Design userData dir untouched', () => {
  const appData = tempAppData()
  fs.mkdirSync(path.join(appData, 'Geon'), { recursive: true })
  fs.mkdirSync(path.join(appData, 'Molly Design'), { recursive: true })
  const migrated = migrateLegacyUserDataDir({
    appDataDir: appData,
    productName: 'Molly Design',
    log: () => {}
  })
  assert.equal(migrated, false)
  assert.ok(fs.existsSync(path.join(appData, 'Geon')))
})

void test('does nothing without a legacy dir', () => {
  const appData = tempAppData()
  const migrated = migrateLegacyUserDataDir({
    appDataDir: appData,
    productName: 'Molly Design',
    log: () => {}
  })
  assert.equal(migrated, false)
})

void test('skips migration when a dev userData override is set', () => {
  const appData = tempAppData()
  fs.mkdirSync(path.join(appData, 'Geon'), { recursive: true })
  const migrated = migrateLegacyUserDataDir({
    appDataDir: appData,
    productName: 'Molly Design',
    envOverride: '/tmp/molly-dev-override',
    log: () => {}
  })
  assert.equal(migrated, false)
  assert.ok(!fs.existsSync(path.join(appData, 'Molly Design')))
})

void test('never touches Lody data', () => {
  const appData = tempAppData()
  fs.mkdirSync(path.join(appData, 'Lody', 'Local Storage'), { recursive: true })
  const migrated = migrateLegacyUserDataDir({
    appDataDir: appData,
    productName: 'Molly Design',
    log: () => {}
  })
  assert.equal(migrated, false)
  assert.ok(fs.existsSync(path.join(appData, 'Lody', 'Local Storage')))
  assert.ok(!fs.existsSync(path.join(appData, 'Molly Design')))
})

void test('renames the legacy .geon data dir to .molly, keeping .folio as fallback source', () => {
  const home = tempAppData()
  fs.mkdirSync(path.join(home, '.geon'), { recursive: true })
  const migrated = migrateLegacyUserDataDir({
    appDataDir: home,
    productName: '.molly',
    legacyProductNames: ['.geon', '.folio'],
    log: () => {}
  })
  assert.equal(migrated, true)
  assert.ok(fs.existsSync(path.join(home, '.molly')))
  assert.ok(!fs.existsSync(path.join(home, '.geon')))
})

void test('renames the legacy .folio data dir to .molly when .geon is absent', () => {
  const home = tempAppData()
  fs.mkdirSync(path.join(home, '.folio'), { recursive: true })
  const migrated = migrateLegacyUserDataDir({
    appDataDir: home,
    productName: '.molly',
    legacyProductNames: ['.geon', '.folio'],
    log: () => {}
  })
  assert.equal(migrated, true)
  assert.ok(fs.existsSync(path.join(home, '.molly')))
  assert.ok(!fs.existsSync(path.join(home, '.folio')))
})

void test('never touches the .lody data dir', () => {
  const home = tempAppData()
  fs.mkdirSync(path.join(home, '.lody'), { recursive: true })
  const migrated = migrateLegacyUserDataDir({
    appDataDir: home,
    productName: '.molly',
    legacyProductNames: ['.geon', '.folio'],
    log: () => {}
  })
  assert.equal(migrated, false)
  assert.ok(fs.existsSync(path.join(home, '.lody')))
  assert.ok(!fs.existsSync(path.join(home, '.molly')))
})
