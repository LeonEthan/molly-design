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
      export { PublicBrowserService } from './public-browser-service.ts'
      export { publicBrowserPartition } from './public-browser-agent-controller.ts'
    `,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    loader: 'ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  external: ['../utils', './browser-account-source', './browser-account-signing'],
  alias: {
    '@molly/shared/browser-url': fileURLToPath(
      new URL('../../../../../packages/shared/src/browser-url.ts', import.meta.url)
    ),
    '@molly/shared/electron-ipc': fileURLToPath(
      new URL('../../../../../packages/shared/src/electron-ipc.ts', import.meta.url)
    )
  }
})

const sources = {
  sources: [
    {
      browserId: 'chrome',
      browserName: 'Google Chrome',
      profiles: [{ id: 'Default', name: 'Synthetic profile', isDefault: true }]
    }
  ],
  unreadable: []
}
const sourceCookie = {
  name: 'synthetic_session',
  value: 'synthetic-cookie-main-only',
  domain: '.pinterest.com',
  path: '/',
  hostOnly: false,
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  session: false,
  expirationDate: 4_000_000_000
}

function fixture({ platform = 'darwin', packaged = false, signed = false, secure = true } = {}) {
  const sessions = new Map()
  const acquisitions = []
  const electron = {
    app: { isPackaged: packaged, getPath: () => '/synthetic/Molly' },
    safeStorage: { isEncryptionAvailable: () => secure },
    session: {
      fromPartition(partition) {
        if (!sessions.has(partition)) {
          const rows = []
          sessions.set(partition, {
            cookies: {
              get: async () => [...rows],
              set: async (cookie) => {
                rows.push({ ...cookie, domain: cookie.domain ?? new URL(cookie.url).hostname })
              },
              remove: async (_url, name) => {
                const index = rows.findIndex((cookie) => cookie.name === name)
                if (index >= 0) rows.splice(index, 1)
              },
              flushStore: async () => {}
            }
          })
        }
        return sessions.get(partition)
      }
    },
    WebContentsView: class {
      constructor({ webPreferences }) {
        this.webContents = {
          debugger: {
            attach() {},
            sendCommand: async () => ({ cookies: await webPreferences.session.cookies.get({}) })
          },
          isDestroyed: () => false,
          close() {}
        }
      }
    }
  }
  const module = { exports: {} }
  compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require', 'process'])(
    module,
    module.exports,
    (name) => {
      if (name === 'electron') return electron
      if (name === './browser-account-signing') return { isStableSignedMacApp: () => signed }
      if (name === '../utils') return { formatUnknownError: (error) => error.message }
      if (name === './browser-account-source')
        return {
          listImportSources: async (browsers) => {
            acquisitions.push({ kind: 'profiles', browsers })
            return sources
          },
          readBrowserSiteCookies: async (...selection) => {
            acquisitions.push({ kind: 'cookies', selection })
            return [sourceCookie]
          }
        }
      return require(name)
    },
    { platform }
  )
  return {
    service: new module.exports.PublicBrowserService(() => null),
    partition: module.exports.publicBrowserPartition,
    sessions,
    acquisitions
  }
}

for (const { name, options, partition, persistent } of [
  {
    name: 'unpackaged macOS imports into memory without a stable signing identity',
    options: {},
    partition: 'molly-public-browser-v1',
    persistent: false
  },
  {
    name: 'stably signed macOS packages retain persistent browser import',
    options: { packaged: true, signed: true },
    partition: 'persist:molly-public-browser-v1',
    persistent: true
  }
]) {
  void test(name, async () => {
    const context = fixture(options)
    assert.deepEqual(await context.service.getAccountSummary(), {
      persistent,
      importAvailable: true,
      sites: [{ site: 'pinterest.com', cookieCount: 0 }]
    })
    assert.deepEqual(await context.service.getImportSources(), sources)
    assert.equal(
      await context.service.importBrowserAccount('chrome', 'Default', 'pinterest.com', false),
      1
    )
    assert.deepEqual(context.acquisitions.at(-1), {
      kind: 'cookies',
      selection: ['chrome', 'Default', 'pinterest.com']
    })
    assert.equal(context.partition(), partition)
    assert.deepEqual([...context.sessions.keys()], [partition])
    const cookies = await context.sessions.get(partition).cookies.get({ domain: 'pinterest.com' })
    assert.equal(cookies[0].value, sourceCookie.value)
    assert.equal(cookies[0].expirationDate, sourceCookie.expirationDate)
    const summary = await context.service.getAccountSummary()
    assert.deepEqual(summary.sites, [{ site: 'pinterest.com', cookieCount: 1 }])
    assert.equal(JSON.stringify(summary).includes(sourceCookie.value), false)
  })
}

for (const { name, options, reason, persistent } of [
  {
    name: 'development import fails closed without OS secure storage',
    options: { secure: false },
    reason: 'secure-storage-unavailable',
    persistent: false
  },
  {
    name: 'packaged macOS still rejects an unstable signing identity',
    options: { packaged: true },
    reason: 'signing-required',
    persistent: false
  },
  {
    name: 'signed packages still reject unavailable OS secure storage',
    options: { packaged: true, signed: true, secure: false },
    reason: 'secure-storage-unavailable',
    persistent: true
  },
  {
    name: 'packaged Windows cannot import macOS browser accounts',
    options: { platform: 'win32', packaged: true },
    reason: 'macos-required',
    persistent: true
  },
  {
    name: 'unpackaged Linux cannot import macOS browser accounts',
    options: { platform: 'linux' },
    reason: 'macos-required',
    persistent: false
  }
]) {
  void test(name, async () => {
    const context = fixture(options)
    const before = await context.service.getAccountSummary()
    assert.equal(before.persistent, persistent)
    assert.equal(before.importAvailable, false)
    assert.equal(before.importUnavailableReason, reason)
    await assert.rejects(context.service.getImportSources())
    await assert.rejects(
      context.service.importBrowserAccount('chrome', 'Default', 'pinterest.com', false)
    )
    assert.deepEqual(context.acquisitions, [])
    assert.deepEqual(await context.service.getAccountSummary(), before)
  })
}
