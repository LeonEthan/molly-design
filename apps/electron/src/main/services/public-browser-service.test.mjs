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
    contents: `export { PublicBrowserService } from './public-browser-service.ts'; export { publicBrowserPartition } from './public-browser-agent-controller.ts'`,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    loader: 'ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: [
    'electron',
    '../utils',
    './browser-account-source',
    './browser-account-signing',
    './browser-account-isolation'
  ]
})
const sourceCookie = {
  name: 'synthetic_session',
  value: 'synthetic-cookie-main-only',
  domain: '.pinterest.com',
  path: '/',
  hostOnly: false,
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  sourceScheme: 'Secure',
  sourcePort: 443,
  session: true
}
const source = () => ({
  cookies: [sourceCookie],
  report: {
    imported: 1,
    skippedExpired: 0,
    skippedPartitioned: 0,
    sites: [{ siteId: 'pinterest', imported: 1, skippedExpired: 0, skippedPartitioned: 0 }]
  }
})
const input = {
  operationId: 'a0100000-0000-4000-8000-000000000001',
  browserId: 'chrome',
  profileId: 'Default',
  siteIds: ['pinterest']
}
const bounds = { x: 0, y: 0, width: 800, height: 600 }
const scope = { sessionId: 'synthetic', browserId: 'session-browser-synthetic', runId: 'run-1' }
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
function fixture({
  platform = 'darwin',
  packaged = false,
  signed = false,
  secure = true,
  owner = browserWindow(),
  pauseActiveRuns = async () => [],
  listProfiles = async () => [{ id: 'Default', name: 'Synthetic profile', isDefault: true }],
  readSource = async () => source(),
  write = async () => {}
} = {}) {
  const events = []
  let rows = []
  const requests = {}
  const browserSession = {
    setPermissionCheckHandler() {},
    setPermissionRequestHandler() {},
    webRequest: {
      onBeforeRequest: (handler) => {
        requests.before = handler
      },
      onHeadersReceived: (handler) => {
        requests.headers = handler
      }
    },
    closeAllConnections: async () => {
      events.push('connections-closed')
    },
    clearStorageData: async () => {
      rows = []
      events.push('storage-cleared')
    },
    clearCache: async () => {
      events.push('cache-cleared')
    },
    clearAuthCache: async () => {
      events.push('auth-cleared')
    },
    cookies: { get: async () => structuredClone(rows), flushStore: async () => {} }
  }
  const electron = {
    app: { isPackaged: packaged, getPath: () => '/synthetic/Molly' },
    safeStorage: { isEncryptionAvailable: () => secure },
    session: { fromPartition: () => browserSession },
    WebContentsView: class {
      constructor() {
        let destroyed = false,
          url = ''
        this.webContents = Object.assign(new EventEmitter(), {
          session: browserSession,
          getURL: () => url,
          getTitle: () => '',
          loadURL: async (next) => {
            url = next
          },
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
  const key = (cookie) => JSON.stringify([cookie.domain, cookie.path, cookie.name])
  const module = { exports: {} }
  compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require', 'process'])(
    module,
    module.exports,
    (name) => {
      if (name === 'electron') return electron
      if (name === '../utils') return { formatUnknownError: (error) => error.message }
      if (name === './browser-account-signing') return { isStableSignedMacApp: () => signed }
      if (name === './browser-account-source')
        return {
          listImportSources: async () => ({
            sources: [{ browserId: 'chrome', browserName: 'Google Chrome' }]
          }),
          listImportProfiles: listProfiles,
          readBrowserProfileCookies: readSource
        }
      if (name === './browser-account-isolation')
        return {
          isolateBrowserAccounts: async () => {
            events.push('isolated')
            return {
              release: async () => {
                events.push('released')
              },
              store: {
                assertIsolated() {},
                snapshot: async () => structuredClone(rows),
                set: async (cookie) => {
                  await write(cookie)
                  rows = [...rows.filter((row) => key(row) !== key(cookie)), cookie]
                  events.push('written')
                },
                remove: async (cookie) => {
                  rows = rows.filter((row) => key(row) !== key(cookie))
                },
                flush: async () => {}
              }
            }
          }
        }
      return require(name)
    },
    { ...process, platform }
  )
  const service = new module.exports.PublicBrowserService(() => owner, pauseActiveRuns)
  return {
    service,
    owner,
    events,
    requests,
    rows: () => structuredClone(rows),
    partition: module.exports.publicBrowserPartition
  }
}

for (const options of [{}, { packaged: true, signed: true }])
  void test('imports locally with the existing signed or development partition policy', async () => {
    const context = fixture(options)
    const summary = await context.service.getAccountSummary()
    assert.equal(summary.importAvailable, true)
    assert.equal(summary.persistent, Boolean(options.packaged))
    assert.equal(
      context.partition(),
      options.packaged ? 'persist:molly-public-browser-v1' : 'molly-public-browser-v1'
    )
    const report = await context.service.importBrowserAccount(input)
    assert.equal(report.imported, 1)
    assert.equal(context.rows()[0].value, sourceCookie.value)
    assert.equal(
      (await context.service.getAccountSummary()).sites.find((site) => site.siteId === 'pinterest')
        .cookieCount,
      1
    )
    assert.equal(JSON.stringify(report).includes(sourceCookie.value), false)
  })

for (const [options, reason] of [
  [{ secure: false }, 'secure-storage-unavailable'],
  [{ packaged: true }, 'signing-required'],
  [{ platform: 'win32', packaged: true }, 'macos-required']
])
  void test(`unavailable import: ${reason}`, async () => {
    const { service, rows } = fixture(options)
    assert.equal((await service.getAccountSummary()).importUnavailableReason, reason)
    await assert.rejects(service.getImportSources())
    await assert.rejects(service.importBrowserAccount(input))
    assert.deepEqual(rows(), [])
  })

void test('renderer supplied profiles must exist in a fresh main-process listing', async () => {
  const context = fixture()
  assert.deepEqual(
    await context.service.importBrowserAccount({ ...input, profileId: '/foreign/path' }),
    { profiles: [{ id: 'Default', name: 'Synthetic profile', isDefault: true }] }
  )
  assert.deepEqual(context.events, [])
})

void test('a browser-only Import lists its one profile and continues the same request into cookie import', async () => {
  const observed = []
  const context = fixture({
    listProfiles: async (browserId) => {
      observed.push({ stage: 'profiles', browserId })
      return [{ id: 'opaque-only-profile', name: 'Synthetic', isDefault: false }]
    },
    readSource: async (browserId, profileId, siteIds) => {
      observed.push({ stage: 'cookies', browserId, profileId, siteIds })
      return source()
    }
  })
  const browserOnly = { ...input }
  delete browserOnly.profileId
  const report = await context.service.importBrowserAccount(browserOnly)
  assert.equal(report.imported, 1)
  assert.deepEqual(observed, [
    { stage: 'profiles', browserId: 'chrome' },
    {
      stage: 'cookies',
      browserId: 'chrome',
      profileId: 'opaque-only-profile',
      siteIds: ['pinterest']
    }
  ])
  assert.equal(context.rows()[0].value, sourceCookie.value)
})

void test('multiple profiles return a choice without reading cookies and the chosen profile is revalidated', async () => {
  const profiles = [
    { id: 'Default', name: 'Synthetic personal', isDefault: true },
    { id: 'work', name: 'Synthetic work', isDefault: false }
  ]
  let available = profiles
  const context = fixture({
    listProfiles: async () => available,
    readSource: async (_browserId, profileId) => {
      assert.equal(profileId, 'work')
      return source()
    }
  })
  const browserOnly = { ...input }
  delete browserOnly.profileId
  assert.deepEqual(await context.service.importBrowserAccount(browserOnly), { profiles })
  assert.deepEqual(context.events, [])
  assert.deepEqual(context.rows(), [])
  available = [profiles[0]]
  assert.deepEqual(await context.service.importBrowserAccount({ ...input, profileId: 'work' }), {
    profiles: available
  })
  assert.deepEqual(context.events, [])
  available = [profiles[1]]
  assert.equal(
    (await context.service.importBrowserAccount({ ...input, profileId: 'work' })).imported,
    1
  )
  assert.equal(context.rows()[0].value, sourceCookie.value)
})

for (const ending of ['cancel', 'navigation', 'close', 'quit'])
  void test(`${ending} revokes profile enumeration while retaining its native operation lease`, async () => {
    const profiles = Promise.withResolvers(),
      started = Promise.withResolvers()
    const context = fixture({
      listProfiles: async () => {
        started.resolve()
        return profiles.promise
      },
      readSource: async () => {
        assert.fail('a revoked profile listing must not read cookies')
      }
    })
    const browserOnly = { ...input }
    delete browserOnly.profileId
    const pending = context.service.importBrowserAccount(browserOnly)
    await started.promise
    if (ending === 'cancel')
      assert.equal(context.service.cancelAccountImport(input.operationId), 'cancelled')
    if (ending === 'navigation')
      context.owner.webContents.emit('did-start-navigation', {
        isMainFrame: true,
        isSameDocument: false
      })
    if (ending === 'close') context.owner.emit('closed')
    if (ending === 'quit') await context.service.shutdownForQuit()
    await assert.rejects(context.service.importBrowserAccount(input), { message: 'busy' })
    await assert.rejects(context.service.getImportProfiles('chrome'), { message: 'busy' })
    profiles.resolve([{ id: 'Default', name: 'Synthetic', isDefault: true }])
    await assert.rejects(pending, { message: 'cancelled' })
    assert.deepEqual(context.events, [])
    assert.deepEqual(context.rows(), [])
  })

void test('an empty successful profile listing leaves website data unchanged and can be explicitly retried', async () => {
  let profiles = []
  const context = fixture({ listProfiles: async () => profiles })
  await assert.rejects(context.service.importBrowserAccount(input), {
    message: 'source-unavailable'
  })
  assert.deepEqual(context.events, [])
  profiles = [{ id: 'Default', name: 'Synthetic', isDefault: true }]
  assert.equal((await context.service.importBrowserAccount(input)).imported, 1)
})

for (const ending of ['cancel', 'navigation', 'close', 'quit'])
  void test(`${ending} revokes late reads while retaining the single native operation lease`, async () => {
    const read = Promise.withResolvers(),
      started = Promise.withResolvers()
    const context = fixture({
      readSource: async () => {
        started.resolve()
        return read.promise
      }
    })

    const pending = context.service.importBrowserAccount(input)
    await started.promise
    if (ending === 'cancel')
      assert.equal(context.service.cancelAccountImport(input.operationId), 'cancelled')
    if (ending === 'navigation')
      context.owner.webContents.emit('did-start-navigation', {
        isMainFrame: true,
        isSameDocument: false
      })
    if (ending === 'close') context.owner.emit('closed')
    if (ending === 'quit') await context.service.shutdownForQuit()
    await assert.rejects(
      context.service.importBrowserAccount({
        ...input,
        operationId: 'a0100000-0000-4000-8000-000000000002'
      }),
      { message: 'busy' }
    )
    read.resolve(source())
    await assert.rejects(pending, { message: 'cancelled' })
    assert.deepEqual(context.rows(), [])
    assert.deepEqual(context.events, [])
  })

void test('the write fence blocks late pages and new Agent runs before asynchronous pause settles', async () => {
  const pause = Promise.withResolvers(),
    pausing = Promise.withResolvers()
  const context = fixture({
    pauseActiveRuns: async () => {
      pausing.resolve()
      return pause.promise
    }
  })

  const importing = context.service.importBrowserAccount(input)
  await pausing.promise
  assert.equal(context.service.create('new-page', bounds).ok, false)
  await assert.rejects(
    context.service.executeAgentCommand(scope, { kind: 'snapshot' }),
    /being updated/
  )
  assert.equal(context.service.cancelAccountImport(input.operationId), 'finishing')
  pause.resolve([])
  await importing
  assert.equal(context.rows().length, 1)
})

void test('native page destruction completes before isolation or any destination mutation', async () => {
  const context = fixture()
  assert.equal(context.service.create('page', bounds).ok, true)
  const view = [...context.owner.children][0]
  const closing = Promise.withResolvers()
  const close = view.webContents.close.bind(view.webContents)
  view.webContents.close = () => closing.resolve()
  const importing = context.service.importBrowserAccount(input)
  await closing.promise
  assert.deepEqual(context.rows(), [])
  assert.equal(context.events.includes('isolated'), false)
  close()
  await importing
  assert.equal(context.rows().length, 1)
})

void test('quit waits for an accepted write and clear removes all destination storage', async () => {
  const writing = Promise.withResolvers(),
    release = Promise.withResolvers()
  const context = fixture({
    write: async () => {
      writing.resolve()
      await release.promise
    }
  })

  const importing = context.service.importBrowserAccount(input)
  await writing.promise
  let drained = false
  const quitting = context.service.shutdownForQuit().then(() => {
    drained = true
  })
  assert.equal(drained, false)
  release.resolve()
  await importing
  await quitting
  assert.equal(drained, true)
  assert.equal(context.service.create('late', bounds).ok, false)
  const cleared = fixture()
  await cleared.service.importBrowserAccount(input)
  assert.equal(await cleared.service.clearAccountData(), 1)
  assert.deepEqual(cleared.rows(), [])
  assert.ok(
    ['storage-cleared', 'cache-cleared', 'auth-cleared'].every((event) =>
      cleared.events.includes(event)
    )
  )
})

void test('manual account takeover holds fresh runs until explicit resume or native page closure', async () => {
  const context = fixture({ pauseActiveRuns: async () => [scope] })
  assert.equal(context.service.create(scope.browserId, bounds).ok, true)
  context.service.agent.activeScopes = () => [scope]
  await context.service.takeHumanAccountControl(scope.browserId)
  await assert.rejects(
    context.service.executeAgentCommand({ ...scope, runId: 'fresh' }, { kind: 'snapshot' }),
    /user controls/
  )
  const view = [...context.owner.children][0]
  const close = view.webContents.close.bind(view.webContents)
  view.webContents.close = () => {}
  context.service.destroy(scope.browserId)
  await assert.rejects(
    context.service.executeAgentCommand(
      { sessionId: 'new', browserId: 'session-browser-new', runId: 'new-run' },
      { kind: 'snapshot' }
    ),
    /user controls/
  )
  close()
  const fresh = { sessionId: 'new', browserId: 'session-browser-new', runId: 'new-run' }
  context.service.create(fresh.browserId, bounds)
  const answer = { kind: 'snapshot', snapshot: 'Synthetic resumed page' }
  context.service.agent.execute = async () => answer
  assert.deepEqual(await context.service.executeAgentCommand(fresh, { kind: 'snapshot' }), answer)
})

void test('pause failure leaves destination unchanged and preserves paused run scopes', async () => {
  const context = fixture({
    pauseActiveRuns: async () => {
      throw new Error('pause failed')
    }
  })

  context.service.agent.activeScopes = () => [scope]
  await assert.rejects(context.service.importBrowserAccount(input), /pause failed/)
  assert.deepEqual(context.rows(), [])
  assert.deepEqual(context.service.takeoverScope(scope.browserId), scope)
})

void test('a new run can browse after import paused an older run in the same session', async () => {
  const context = fixture({ pauseActiveRuns: async () => [scope] })
  context.service.create(scope.browserId, bounds)
  await context.service.importBrowserAccount(input)
  await assert.rejects(
    context.service.executeAgentCommand(scope, { kind: 'snapshot' }),
    /taken control/
  )
  const answer = { kind: 'snapshot', snapshot: 'Synthetic new run' }
  context.service.agent.execute = async () => answer
  assert.deepEqual(
    await context.service.executeAgentCommand(
      { ...scope, runId: 'next-run' },
      { kind: 'snapshot' }
    ),
    answer
  )
  assert.equal(context.service.takeoverScope(scope.browserId), null)
})
