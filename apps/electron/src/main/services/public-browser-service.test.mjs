import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
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

function fixture({
  platform = 'darwin',
  packaged = false,
  signed = false,
  secure = true,
  getMainWindow = () => null,
  pauseActiveRuns = async () => []
} = {}) {
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
            setPermissionCheckHandler() {},
            setPermissionRequestHandler() {},
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
        let destroyed = false
        this.webContents = Object.assign(new EventEmitter(), {
          session:
            webPreferences.session ?? electron.session.fromPartition(webPreferences.partition),
          debugger: {
            attach() {},
            sendCommand: async () => ({ cookies: await webPreferences.session.cookies.get({}) })
          },
          getURL: () => '',
          getTitle: () => '',
          navigationHistory: { canGoBack: () => false, canGoForward: () => false },
          setWindowOpenHandler() {},
          isDestroyed: () => destroyed,
          close() {
            destroyed = true
            this.emit('destroyed')
          }
        })
      }
      setBounds() {}
      setVisible() {}
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
    service: new module.exports.PublicBrowserService(getMainWindow, pauseActiveRuns),
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

void test('an account sign-in pauses every active Agent page until it is resumed', async () => {
  const { service } = fixture()
  const scopes = [
    { sessionId: 'session-a', browserId: 'session-browser-session-a', runId: 'run-a' },
    { sessionId: 'session-b', browserId: 'session-browser-session-b', runId: 'run-b' }
  ]
  service.agent.activeScopes = () => scopes
  await service.pauseAgentsForAccountChange()
  assert.deepEqual(
    scopes.map((scope) => service.takeoverScope(scope.browserId)),
    scopes
  )
  service.resumeAgentControl('session-browser-session-a', 'run-a')
  assert.equal(service.takeoverScope('session-browser-session-a'), null)
  assert.deepEqual(service.takeoverScope('session-browser-session-b'), scopes[1])
})

void test('an account sign-in also pauses active runs that have not opened a page yet', async () => {
  const unleased = {
    sessionId: 'session-c',
    browserId: 'session-browser-session-c',
    runId: 'run-c'
  }
  const { service } = fixture({ pauseActiveRuns: async () => [unleased] })
  await service.pauseAgentsForAccountChange()
  assert.deepEqual(service.takeoverScope(unleased.browserId), unleased)
  assert.equal(service.getState(unleased.browserId).agentControl, 'human-takeover')
  await assert.rejects(service.executeAgentCommand(unleased, { kind: 'snapshot' }), /taken control/)
  service.resumeAgentControl(unleased.browserId, unleased.runId)
  assert.equal(service.takeoverScope(unleased.browserId), null)
  assert.equal(service.getState(unleased.browserId), null)
})

void test('an account sign-in fails when active runs cannot be paused', async () => {
  const leased = { sessionId: 'session-d', browserId: 'session-browser-session-d', runId: 'run-d' }
  const { service } = fixture({
    pauseActiveRuns: async () => {
      throw new Error('Local Molly runtime is unavailable.')
    }
  })
  service.agent.activeScopes = () => [leased]
  await assert.rejects(service.pauseAgentsForAccountChange(), /runtime is unavailable/)
  assert.deepEqual(service.takeoverScope(leased.browserId), leased)
})

void test('a website sign-in holds runs that start until its page closes', async () => {
  let window = browserWindow()
  const { service } = fixture({ getMainWindow: () => window })
  const later = { sessionId: 'session-e', browserId: 'session-browser-session-e', runId: 'run-e' }
  await assert.rejects(service.beginAccountSignIn('session-browser-session-e'), /Invalid/)
  await service.beginAccountSignIn('website-sign-in-pinterest.com')
  await assert.rejects(service.executeAgentCommand(later, { kind: 'snapshot' }), /signs in/)
  service.destroy('website-sign-in-pinterest.com')
  window = null
  await assert.rejects(
    service.executeAgentCommand(later, { kind: 'snapshot' }),
    /main Electron window is not available/
  )
})

function browserWindow() {
  const children = new Set()
  return Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getContentSize: () => [1000, 800],
    webContents: Object.assign(new EventEmitter(), { send() {} }),
    contentView: {
      addChildView: (view) => children.add(view),
      removeChildView: (view) => children.delete(view)
    },
    children
  })
}

const laterScope = { sessionId: 'later', browserId: 'session-browser-later', runId: 'later-run' }
const signInId = 'website-sign-in-pinterest.com'
const browserBounds = { x: 0, y: 0, width: 800, height: 600 }

void test('renderer reload closes sign-in views before releasing Agent browsing', async () => {
  const window = browserWindow()
  const { service } = fixture({ getMainWindow: () => window })
  await service.beginAccountSignIn(signInId)
  assert.equal(service.create(signInId, browserBounds).ok, true)
  const [signInView] = window.children
  assert.equal(service.create(laterScope.browserId, browserBounds).ok, true)
  const reply = { kind: 'snapshot', snapshot: 'Synthetic retained session page' }
  service.agent.execute = async () => reply

  for (const details of [
    { isMainFrame: false, isSameDocument: false },
    { isMainFrame: true, isSameDocument: true }
  ]) {
    window.webContents.emit('did-start-navigation', details)
    assert.equal(signInView.webContents.isDestroyed(), false)
    await assert.rejects(service.executeAgentCommand(laterScope, { kind: 'snapshot' }), /signs in/)
  }

  let whileClosing
  signInView.webContents.once('destroyed', () => {
    whileClosing = service.executeAgentCommand(laterScope, { kind: 'snapshot' })
  })
  window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  await assert.rejects(whileClosing, /signs in/)
  assert.equal(signInView.webContents.isDestroyed(), true)
  assert.equal(window.children.has(signInView), false)
  assert.equal(service.getState(signInId), null)
  assert.notEqual(service.getState(laterScope.browserId), null)
  assert.deepEqual(await service.executeAgentCommand(laterScope, { kind: 'snapshot' }), reply)
  assert.equal(service.create(signInId, browserBounds).ok, false)
  await service.beginAccountSignIn(signInId)
  assert.equal(service.create(signInId, browserBounds).ok, true)
})

for (const cleanup of ['reload', 'closed', 'destroyAll']) {
  void test(`${cleanup} retires a pending sign-in without restoring it when pause finishes`, async () => {
    const window = browserWindow()
    const pause = Promise.withResolvers()
    let currentWindow = window
    const { service } = fixture({
      getMainWindow: () => currentWindow,
      pauseActiveRuns: () => pause.promise
    })
    const opening = service.beginAccountSignIn(signInId)
    await assert.rejects(service.executeAgentCommand(laterScope, { kind: 'snapshot' }), /signs in/)
    if (cleanup === 'reload') {
      window.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    } else if (cleanup === 'closed') window.emit('closed')
    else service.destroyAll()
    pause.resolve([])
    await opening
    assert.equal(service.create(signInId, browserBounds).ok, false)
    currentWindow = null
    await assert.rejects(
      service.executeAgentCommand(laterScope, { kind: 'snapshot' }),
      /main Electron window is not available/
    )
  })
}

void test('navigation in a previous window does not retire the current sign-in', async () => {
  const previousWindow = browserWindow()
  const currentWindow = browserWindow()
  let window = previousWindow
  const { service } = fixture({ getMainWindow: () => window })
  await service.beginAccountSignIn(signInId)
  service.destroy(signInId)
  window = currentWindow
  await service.beginAccountSignIn(signInId)
  previousWindow.webContents.emit('did-start-navigation', {
    isMainFrame: true,
    isSameDocument: false
  })
  previousWindow.emit('closed')
  await assert.rejects(service.executeAgentCommand(laterScope, { kind: 'snapshot' }), /signs in/)
  assert.equal(service.create(signInId, browserBounds).ok, true)
})

void test('Agent browsing waits for native destruction even after the sign-in is detached', async () => {
  const window = browserWindow()
  const { service } = fixture({ getMainWindow: () => window })
  await service.beginAccountSignIn(signInId)
  assert.equal(service.create(signInId, browserBounds).ok, true)
  const [view] = window.children
  const finishClose = view.webContents.close.bind(view.webContents)
  view.webContents.close = () => {}
  service.destroy(signInId)
  assert.equal(window.children.has(view), false)
  assert.equal(view.webContents.isDestroyed(), false)
  await assert.rejects(service.executeAgentCommand(laterScope, { kind: 'snapshot' }), /signs in/)
  await service.beginAccountSignIn(signInId)
  assert.equal(service.create(signInId, browserBounds).ok, true)
  finishClose()
  await assert.rejects(service.executeAgentCommand(laterScope, { kind: 'snapshot' }), /signs in/)
  service.destroy(signInId)
  assert.equal(service.create(laterScope.browserId, browserBounds).ok, true)
  const reply = { kind: 'snapshot', snapshot: 'Synthetic session after native destruction' }
  service.agent.execute = async () => reply
  assert.deepEqual(await service.executeAgentCommand(laterScope, { kind: 'snapshot' }), reply)
})

void test('rejected sign-in bounds do not leave an orphaned native hold after close', async () => {
  const window = browserWindow()
  const { service } = fixture({ getMainWindow: () => window })
  await service.beginAccountSignIn(signInId)
  assert.equal(service.create(signInId, { ...browserBounds, width: 2000 }).ok, false)
  service.destroy(signInId)
  assert.equal(service.create(laterScope.browserId, browserBounds).ok, true)
  const reply = { kind: 'snapshot', snapshot: 'Synthetic session after rejected sign-in creation' }
  service.agent.execute = async () => reply
  assert.deepEqual(await service.executeAgentCommand(laterScope, { kind: 'snapshot' }), reply)
})
