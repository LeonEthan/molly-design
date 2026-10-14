import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { compileFunction } from 'node:vm'

const require = createRequire(import.meta.url)
const { build } = createRequire(new URL('../../../../cli/package.json', import.meta.url))('esbuild')
const compiled = await build({
  stdin: {
    contents: `
      export {
        browserDataPrivacySettingsUrls,
        openBrowserDataPrivacySettings
      } from './browser-data-privacy-settings.ts'
    `,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    loader: 'ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  external: ['electron', '../utils'],
  alias: {
    '@molly/shared/electron-ipc': fileURLToPath(
      new URL('../../../../../packages/shared/src/electron-ipc.ts', import.meta.url)
    )
  }
})

const module = { exports: {} }
const electronStub = {
  shell: {
    openExternal: async () => {
      throw new Error('shell stub unused when openExternal is injected')
    }
  }
}
compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require', 'process'])(
  module,
  module.exports,
  (id) => {
    if (id === 'electron') return electronStub
    if (id === '../utils')
      return {
        formatUnknownError: (error) => (error instanceof Error ? error.message : String(error))
      }
    return require(id)
  },
  process
)
const { browserDataPrivacySettingsUrls, openBrowserDataPrivacySettings } = module.exports

const APP_DATA_EXTENSION_URL =
  'x-apple.systempreferences:com.apple.Settings.PrivacySecurity.extension?Privacy_AppData'
const APP_DATA_LEGACY_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AppData'
const FILES_AND_FOLDERS_EXTENSION_URL =
  'x-apple.systempreferences:com.apple.Settings.PrivacySecurity.extension?Privacy_FilesAndFolders'
const FILES_AND_FOLDERS_LEGACY_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders'

void test('browser data privacy settings deep-link App Data first on macOS only', () => {
  assert.deepEqual(browserDataPrivacySettingsUrls('darwin'), [
    APP_DATA_EXTENSION_URL,
    APP_DATA_LEGACY_URL,
    FILES_AND_FOLDERS_EXTENSION_URL,
    FILES_AND_FOLDERS_LEGACY_URL
  ])
  assert.deepEqual(browserDataPrivacySettingsUrls('win32'), [])
  assert.deepEqual(browserDataPrivacySettingsUrls('linux'), [])
})

void test('openBrowserDataPrivacySettings tries Ventura+ App Data URL first then legacy App Data', async () => {
  const attempted = []
  const result = await openBrowserDataPrivacySettings({
    platform: 'darwin',
    openExternal: async (url) => {
      attempted.push(url)
      if (url.includes('Settings.PrivacySecurity')) throw new Error('synthetic missing pane')
    }
  })
  assert.equal(result.opened, true)
  assert.equal(result.target, APP_DATA_LEGACY_URL)
  assert.deepEqual(attempted, [APP_DATA_EXTENSION_URL, APP_DATA_LEGACY_URL])
})

void test('openBrowserDataPrivacySettings falls back to Files and Folders only after both App Data URLs fail', async () => {
  const attempted = []
  const result = await openBrowserDataPrivacySettings({
    platform: 'darwin',
    openExternal: async (url) => {
      attempted.push(url)
      if (url.includes('Privacy_AppData')) throw new Error('synthetic missing App Data pane')
    }
  })
  assert.equal(result.opened, true)
  assert.equal(result.target, FILES_AND_FOLDERS_EXTENSION_URL)
  assert.deepEqual(attempted, [
    APP_DATA_EXTENSION_URL,
    APP_DATA_LEGACY_URL,
    FILES_AND_FOLDERS_EXTENSION_URL
  ])
})

void test('openBrowserDataPrivacySettings reports the last failure when every pane fails', async () => {
  const result = await openBrowserDataPrivacySettings({
    platform: 'darwin',
    openExternal: async () => {
      throw new Error('synthetic unavailable system settings')
    }
  })
  assert.equal(result.opened, false)
  assert.equal(result.error, 'synthetic unavailable system settings')
})

void test('openBrowserDataPrivacySettings rejects non-macOS platforms', async () => {
  const result = await openBrowserDataPrivacySettings({
    platform: 'win32',
    openExternal: async () => {
      throw new Error('should not open')
    }
  })
  assert.equal(result.opened, false)
  assert.match(result.error ?? '', /macOS/)
})
