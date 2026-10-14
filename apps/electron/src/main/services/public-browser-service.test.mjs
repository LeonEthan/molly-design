import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mock, test } from 'node:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    sites: [{ siteId: 'pinterest', discovered: 1, imported: 1, skipped: 0, failed: 0 }]
  }
})
const listed = (id, name, path = `/synthetic/chrome/${id}`) => ({
  id,
  name,
  isDefault: id === 'Default',
  path,
  sources: [`${path}/Network/Cookies`]
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
  listFirst = true,
  listProfiles = async () => [listed('Default', 'Synthetic profile')],
  readSource = async () => source(),
  write = async () => {}
} = {}) {
  const events = []
  const copyEvents = []
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
          readBrowserProfileCookies: readSource,
          removeImportCopies: () => copyEvents.push('removed'),
          sweepStaleImportCopies: async () => {
            copyEvents.push('swept')
          }
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
  if (listFirst) {
    const importBrowserAccount = service.importBrowserAccount.bind(service)
    service.importBrowserAccount = async (request) => {
      await service.getImportProfiles(request.browserId, `listing-${request.operationId}`)
      return importBrowserAccount(request)
    }
  }
  return {
    service,
    owner,
    events,
    copyEvents,
    requests,
    rows: () => structuredClone(rows),
    partition: module.exports.publicBrowserPartition
  }
}

for (const options of [{}, { packaged: true, signed: true }])
  void test('imports into a persisted partition in development and in a signed package', async () => {
    const context = fixture(options)
    const summary = await context.service.getAccountSummary()
    assert.equal(summary.importAvailable, true)
    assert.equal(
      context.partition(),
      options.packaged ? 'persist:molly-public-browser-v1' : 'persist:molly-public-browser-dev-v1'
    )
    const report = await context.service.importBrowserAccount(input)
    assert.deepEqual(report.sites, [
      { siteId: 'pinterest', discovered: 1, imported: 1, skipped: 0, failed: 0 }
    ])
    assert.equal(context.rows()[0].value, sourceCookie.value)
    assert.equal(
      (await context.service.getAccountSummary()).sites.find((site) => site.siteId === 'pinterest')
        .cookieCount,
      1
    )
    assert.equal(JSON.stringify(report).includes(sourceCookie.value), false)
  })

void test('a packaged ad-hoc macOS build keeps the in-memory partition', () => {
  const context = fixture({ packaged: true, signed: false })
  assert.equal(context.partition(), 'molly-public-browser-v1')
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

void test('a renderer supplied profile must come from this process listing and match a fresh one', async () => {
  const context = fixture({ listFirst: false })
  await assert.rejects(context.service.importBrowserAccount(input), {
    message: 'profile-changed'
  })
  await context.service.getImportProfiles('chrome', 'a0100000-0000-4000-8000-000000000009')
  await assert.rejects(
    context.service.importBrowserAccount({ ...input, profileId: '/foreign/path' }),
    { message: 'profile-changed' }
  )
  assert.deepEqual(context.events, [])
  assert.deepEqual(context.rows(), [])
})

void test('listing returns every profile as choice metadata only and requests no cookies', async () => {
  const observed = []
  const context = fixture({
    listFirst: false,
    listProfiles: async (browserId) => {
      observed.push({ stage: 'profiles', browserId })
      return [
        listed('Default', 'Synthetic personal'),
        listed('Profile 1', 'Synthetic studio'),
        listed('Profile 2', 'Synthetic work')
      ]
    },
    readSource: async () => assert.fail('listing must not read cookies')
  })
  const profiles = await context.service.getImportProfiles(
    'chrome',
    'a0100000-0000-4000-8000-000000000009'
  )
  assert.deepEqual(profiles, [
    { id: 'Default', name: 'Synthetic personal', isDefault: true },
    { id: 'Profile 1', name: 'Synthetic studio', isDefault: false },
    { id: 'Profile 2', name: 'Synthetic work', isDefault: false }
  ])
  assert.deepEqual(observed, [{ stage: 'profiles', browserId: 'chrome' }])
  assert.deepEqual(context.events, [])
  assert.deepEqual(context.rows(), [])
})

void test('only the chosen listed profile is read and a changed path is refused before any read', async () => {
  const read = []
  let current = [listed('Default', 'Synthetic personal'), listed('work', 'Synthetic work')]
  const context = fixture({
    listFirst: false,
    listProfiles: async () => current,
    readSource: async (_browserId, profile) => {
      read.push(profile.id)
      return source()
    }
  })
  const operation = 'a0100000-0000-4000-8000-000000000009'
  await context.service.getImportProfiles('chrome', operation)
  current = [listed('Default', 'Synthetic personal'), listed('work', 'Synthetic work', '/moved')]
  await assert.rejects(context.service.importBrowserAccount({ ...input, profileId: 'work' }), {
    message: 'profile-changed'
  })
  current = [listed('Default', 'Synthetic personal')]
  await assert.rejects(context.service.importBrowserAccount({ ...input, profileId: 'work' }), {
    message: 'profile-changed'
  })
  assert.deepEqual(read, [])
  assert.deepEqual(context.events, [])
  assert.deepEqual(context.rows(), [])
  current = [listed('Default', 'Synthetic personal'), listed('work', 'Synthetic work')]
  await context.service.getImportProfiles('chrome', operation)
  const report = await context.service.importBrowserAccount({ ...input, profileId: 'work' })
  assert.equal(report.sites[0].imported, 1)
  assert.deepEqual(read, ['work'])
  assert.equal(context.rows()[0].value, sourceCookie.value)
})

void test('a denied listing stays a typed silent error and re-enumerates after access is allowed', async () => {
  let denied = true
  const context = fixture({
    listFirst: false,
    listProfiles: async () => {
      if (denied)
        throw Object.assign(new Error('source-access-denied'), { code: 'source-access-denied' })
      return [listed('Default', 'Synthetic')]
    }
  })
  await assert.rejects(
    context.service.getImportProfiles('chrome', 'a0100000-0000-4000-8000-000000000009'),
    { message: 'source-access-denied' }
  )
  assert.deepEqual(context.events, [])
  denied = false
  assert.deepEqual(
    await context.service.getImportProfiles('chrome', 'a0100000-0000-4000-8000-000000000010'),
    [{ id: 'Default', name: 'Synthetic', isDefault: true }]
  )
})

for (const ending of ['cancel', 'navigation', 'close', 'quit'])
  void test(`${ending} revokes profile enumeration while retaining its native operation lease`, async () => {
    const profiles = Promise.withResolvers(),
      started = Promise.withResolvers()
    const context = fixture({
      listFirst: false,
      listProfiles: async () => {
        started.resolve()
        return profiles.promise
      },
      readSource: async () => {
        assert.fail('a revoked profile listing must not read cookies')
      }
    })
    const listingId = 'a0100000-0000-4000-8000-000000000009'
    const pending = context.service.getImportProfiles('chrome', listingId)
    await started.promise
    if (ending === 'cancel')
      assert.equal(context.service.cancelAccountImport(listingId), 'cancelled')
    if (ending === 'navigation')
      context.owner.webContents.emit('did-start-navigation', {
        isMainFrame: true,
        isSameDocument: false
      })
    if (ending === 'close') context.owner.emit('closed')
    if (ending === 'quit') await context.service.shutdownForQuit()
    await assert.rejects(context.service.importBrowserAccount(input), { message: 'busy' })
    await assert.rejects(context.service.getImportProfiles('chrome', 'listing-two'), {
      message: 'busy'
    })
    profiles.resolve([listed('Default', 'Synthetic')])
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
  profiles = [listed('Default', 'Synthetic')]
  assert.equal((await context.service.importBrowserAccount(input)).sites[0].imported, 1)
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

void test('quit waits for a revoked read to finish removing its private copy before exiting', async () => {
  const read = Promise.withResolvers(),
    started = Promise.withResolvers()
  const directory = await mkdtemp(join(tmpdir(), 'molly-quit-copy-'))
  await writeFile(join(directory, 'Cookies'), 'synthetic')
  const context = fixture({
    readSource: async () => {
      try {
        started.resolve()
        return await read.promise
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  })
  const pending = context.service.importBrowserAccount(input)
  await started.promise
  let finished = false
  const quitting = context.service.shutdownForQuit().then(() => {
    finished = true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(finished, false)
  assert.equal(existsSync(directory), true)
  read.resolve(source())
  await assert.rejects(pending, { message: 'cancelled' })
  await quitting
  assert.equal(existsSync(directory), false)
  assert.deepEqual(context.copyEvents, ['swept', 'removed'])
})

void test('quit stops waiting for a native read that cannot settle and still removes tracked copies', async () => {
  const started = Promise.withResolvers()
  const context = fixture({
    readSource: async () => {
      started.resolve()
      return new Promise(() => {})
    }
  })
  void context.service.importBrowserAccount(input).catch(() => undefined)
  await started.promise
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const quitting = context.service.shutdownForQuit()
    mock.timers.tick(5000)
    await quitting
  } finally {
    mock.timers.reset()
  }
  assert.deepEqual(context.copyEvents, ['swept', 'removed'])
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
