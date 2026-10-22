import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openBrowserImportSettings } from './browser-import-settings.ts'

void test('browser import opens only the fixed Files & Folders destination on macOS', async () => {
  const destinations = []
  assert.deepEqual(
    await openBrowserImportSettings(async (url) => {
      destinations.push(url)
    }, 'darwin'),
    { opened: true }
  )
  assert.deepEqual(destinations, [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders'
  ])
})

void test('unsupported platforms and shell failures leave settings unopened', async () => {
  const destinations = []
  const open = async (url) => {
    destinations.push(url)
  }
  assert.deepEqual(await openBrowserImportSettings(open, 'win32'), { opened: false })
  assert.deepEqual(await openBrowserImportSettings(open, 'linux'), { opened: false })
  assert.deepEqual(destinations, [])
  assert.deepEqual(
    await openBrowserImportSettings(async () => {
      throw new Error('Synthetic launch failure')
    }, 'darwin'),
    { opened: false }
  )
})
