/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript test fixtures. */
import assert from 'node:assert/strict'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { compileFunction } from 'node:vm'
const require = createRequire(import.meta.url)
const { build } = createRequire(new URL('../../../../cli/package.json', import.meta.url))('esbuild')
const compiled = await build({
  stdin: {
    contents: `
    export { BROWSER_ACCOUNT_SITES, browserAccountSiteForDomain } from '@molly/shared/browser-account-sites';
    export { ElectronBrowserAccountImportInputSchema, ElectronBrowserImportProfilesInputSchema } from '@molly/shared/electron-ipc';
    export { importBrowserAccountCookies } from './browser-account-import.ts';
    export { listImportSources, listImportProfiles, assertRegularProfileFiles, readBrowserProfileCookies, removeImportCopies, sweepStaleImportCopies, selectBrowserCookies } from './browser-account-source.ts';
  `,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    loader: 'ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  external: ['electron']
})
const module = { exports: {} }
compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require'])(
  module,
  module.exports,
  require
)
const {
  BROWSER_ACCOUNT_SITES,
  browserAccountSiteForDomain,
  ElectronBrowserAccountImportInputSchema,
  ElectronBrowserImportProfilesInputSchema,
  importBrowserAccountCookies,
  listImportSources,
  listImportProfiles,
  assertRegularProfileFiles,
  readBrowserProfileCookies,
  removeImportCopies,
  sweepStaleImportCopies,
  selectBrowserCookies
} = module.exports

const now = 1_800_000_000
const cookie = {
  domain: '.pinterest.com',
  path: '/',
  secure: true,
  expires: 2_000_000_000,
  name: 'synthetic-session',
  value: 'synthetic-only',
  httpOnly: true,
  sameSite: 1
}
const context = {
  topFrameSiteKey: '',
  hasCrossSiteAncestor: false,
  sourceScheme: 2,
  sourcePort: 443,
  isPersistent: true,
  originAttributes: null,
  userContextId: null,
  partitionKey: null,
  privateBrowsingId: null
}
const details = (patch = {}, contextPatch = {}) => ({
  cookie: { ...cookie, ...patch },
  context: { ...context, ...contextPatch }
})
const input = {
  operationId: 'a0100000-0000-4000-8000-000000000001',
  browserId: 'chrome',
  profileId: 'synthetic-profile',
  siteIds: ['pinterest', 'amazon']
}
const stored = (patch = {}) => ({
  name: cookie.name,
  value: cookie.value,
  domain: cookie.domain,
  path: cookie.path,
  secure: true,
  httpOnly: true,
  expires: cookie.expires,
  session: false,
  size: 32,
  sameSite: 'Lax',
  priority: 'Medium',
  sourceScheme: 'Secure',
  sourcePort: 443,
  ...patch
})
const key = (entry) => JSON.stringify([entry.domain, entry.path, entry.name, entry.partitionKey])
function storeFixture(initial = []) {
  let rows = structuredClone(initial)
  return {
    store: {
      assertIsolated() {},
      snapshot: async () => structuredClone(rows),
      set: async (entry) => {
        rows = [...rows.filter((row) => key(row) !== key(entry)), structuredClone(entry)]
      },
      remove: async (entry) => {
        rows = rows.filter((row) => key(row) !== key(entry))
      },
      flush: async () => {}
    },
    rows: () => structuredClone(rows)
  }
}

const syntheticLocalState = (profiles) => ({
  profile: {
    info_cache: Object.fromEntries(profiles.map(([directory, name]) => [directory, { name }]))
  }
})
const profileDescriptors = (root, state) =>
  Object.entries(state.profile.info_cache).map(([directory, { name }], index) => ({
    profile: {
      profileId: directory,
      displayName: name,
      path: join(root, directory),
      pathLossy: false
    },
    isDefault: index === 0,
    sources: [
      {
        role: 'cookies',
        format: 'chromium_sqlite',
        path: join(root, directory, 'Network', 'Cookies'),
        pathLossy: false,
        precedence: 0
      }
    ]
  }))
async function syntheticChrome(
  profiles = [
    ['Default', 'Synthetic personal'],
    ['Profile 1', 'Synthetic studio'],
    ['Profile 2', 'Synthetic work']
  ]
) {
  const root = await mkdtemp(join(tmpdir(), 'molly-synthetic-chrome-'))
  const state = syntheticLocalState(profiles)
  await writeFile(join(root, 'Local State'), JSON.stringify(state))
  for (const [directory] of profiles) {
    await mkdir(join(root, directory, 'Network'), { recursive: true })
    await writeFile(join(root, directory, 'Network', 'Cookies'), 'synthetic')
    await writeFile(join(root, directory, 'Network', 'Cookies-wal'), 'synthetic')
  }
  return {
    root,
    reader: {
      browserProfiles: async () =>
        profileDescriptors(
          root,
          JSON.parse(await (await import('node:fs/promises')).readFile(join(root, 'Local State')))
        )
    },
    cleanup: () => rm(root, { recursive: true, force: true })
  }
}
const listedProfile = async (chrome, directory = 'Default') =>
  (await listImportProfiles('chrome', new AbortController().signal, chrome.reader)).find(
    (entry) => entry.id === directory
  )
const readerFor = (result, events = []) => ({
  CancellationHandle: class {
    cancel() {
      events.push('cancelled')
    }
  },
  fromPath: async (request) => {
    events.push(request)
    return result
  }
})

void test('catalog has 13 design and 14 commerce platforms with boundary-safe regional matching', () => {
  assert.equal(BROWSER_ACCOUNT_SITES.filter((site) => site.group === 'design').length, 13)
  assert.equal(BROWSER_ACCOUNT_SITES.filter((site) => site.group === 'commerce').length, 14)
  for (const site of BROWSER_ACCOUNT_SITES)
    for (const domain of site.domains) {
      assert.equal(browserAccountSiteForDomain(`.seller.${domain}`)?.id, site.id)
      assert.equal(browserAccountSiteForDomain(`${domain}.attacker.test`), undefined)
      assert.equal(browserAccountSiteForDomain(`attacker-${domain}`), undefined)
    }
  assert.equal(browserAccountSiteForDomain('accounts.google.com'), undefined)
  assert.equal(browserAccountSiteForDomain('tenant.myshopify.com'), undefined)
  assert.equal(ElectronBrowserAccountImportInputSchema.safeParse(input).success, true)
  for (const patch of [
    { siteIds: [] },
    { siteIds: ['arbitrary.example'] },
    { siteIds: ['pinterest', 'pinterest'] },
    { profilePath: '/private/profile' },
    { replaceExisting: true }
  ])
    assert.equal(
      ElectronBrowserAccountImportInputSchema.safeParse({ ...input, ...patch }).success,
      false
    )
})

void test('discovery checks app bundles without enumerating browser data directories', async () => {
  const observed = []
  const result = await listImportSources(['chrome', 'edge'], async (path) => {
    observed.push(path)
    return path === '/Applications/Google Chrome.app'
  })
  assert.deepEqual(result, { sources: [{ browserId: 'chrome', browserName: 'Google Chrome' }] })
  assert.ok(
    observed.every((path) => path.endsWith('.app') && !path.includes('Application Support'))
  )
})

void test('Import requires an explicit profile ID and profile paths remain forbidden', () => {
  assert.deepEqual(ElectronBrowserAccountImportInputSchema.parse(input), input)
  const withoutProfile = { ...input }
  delete withoutProfile.profileId
  for (const forbidden of [
    withoutProfile,
    { ...input, profilePath: '/private/path' },
    { ...input, profileId: '' }
  ])
    assert.equal(ElectronBrowserAccountImportInputSchema.safeParse(forbidden).success, false)
  const listing = { operationId: input.operationId, browserId: 'chrome' }
  assert.deepEqual(ElectronBrowserImportProfilesInputSchema.parse(listing), listing)
  assert.equal(
    ElectronBrowserImportProfilesInputSchema.safeParse({ browserId: 'chrome' }).success,
    false
  )
})

void test('profile enumeration lists every Local State profile and discards a cancelled native result', async () => {
  const chrome = await syntheticChrome()
  try {
    const pending = Promise.withResolvers(),
      started = Promise.withResolvers(),
      controller = new AbortController()
    const listing = listImportProfiles('chrome', controller.signal, {
      browserProfiles: async (browserId, options) => {
        assert.equal(browserId, 'chrome')
        assert.deepEqual(options, { timeoutMs: 300000 })
        started.resolve()
        return pending.promise
      }
    })
    await started.promise
    controller.abort()
    pending.resolve(await chrome.reader.browserProfiles())
    await assert.rejects(listing, { message: 'cancelled' })
    const profiles = await listImportProfiles('chrome', new AbortController().signal, chrome.reader)
    assert.deepEqual(
      profiles.map(({ id, name, isDefault }) => ({ id, name, isDefault })),
      [
        { id: 'Default', name: 'Synthetic personal', isDefault: true },
        { id: 'Profile 1', name: 'Synthetic studio', isDefault: false },
        { id: 'Profile 2', name: 'Synthetic work', isDefault: false }
      ]
    )
    assert.deepEqual(profiles[1].path, join(chrome.root, 'Profile 1'))
    assert.deepEqual(profiles[1].sources, [join(chrome.root, 'Profile 1', 'Network', 'Cookies')])
  } finally {
    await chrome.cleanup()
  }
})

void test('a profile whose path cannot be represented exactly is not offered', async () => {
  const chrome = await syntheticChrome([['Default', 'Synthetic']])
  try {
    const [descriptor] = await chrome.reader.browserProfiles()
    descriptor.profile.pathLossy = true
    assert.deepEqual(
      await listImportProfiles('chrome', new AbortController().signal, {
        browserProfiles: async () => [descriptor]
      }),
      []
    )
  } finally {
    await chrome.cleanup()
  }
})

for (const [nativeCode, errorCode] of [
  ['molly_source_access_denied', 'source-access-denied'],
  ['molly_source_authorization_denied', 'source-authorization-denied'],
  ['engine_failure', 'source-unavailable']
])
  void test(`native ${nativeCode} reaches only its safe import error code`, async () => {
    const chrome = await syntheticChrome([['Default', 'Synthetic']])
    try {
      const error = new Error(
        `__ROOKIE_ERROR_V1__${JSON.stringify({
          rookieCode: nativeCode,
          message: '/private/path synthetic-secret'
        })}`
      )
      await assert.rejects(
        listImportProfiles('chrome', new AbortController().signal, {
          browserProfiles: async () => {
            throw error
          }
        }),
        { message: errorCode }
      )
      await assert.rejects(
        readBrowserProfileCookies(
          'chrome',
          await listedProfile(chrome),
          input.siteIds,
          new AbortController().signal,
          {
            CancellationHandle: class {
              cancel() {
                return undefined
              }
            },
            fromPath: async () => {
              throw error
            }
          }
        ),
        { message: errorCode }
      )
    } finally {
      await chrome.cleanup()
    }
  })

void test('a generic permission-looking diagnostic is not misclassified as a file or Keychain denial', async () => {
  for (const message of [
    'Permission denied (os error 1)',
    'macOS Keychain denied',
    '__ROOKIE_ERROR_V1__invalid'
  ])
    await assert.rejects(
      listImportProfiles('chrome', new AbortController().signal, {
        browserProfiles: async () => {
          throw new Error(message)
        }
      }),
      { message: 'source-unavailable' }
    )
})

void test('one complete profile read is filtered in main and reports per-site discovered, imported, skipped and failed', async () => {
  const chrome = await syntheticChrome()
  try {
    const profile = await listedProfile(chrome, 'Profile 1')
    const events = []
    const reader = readerFor(
      {
        browserId: null,
        profileId: null,
        warnings: [],
        detailedCookies: [
          details(),
          details({ name: 'molly-session', expires: undefined }),
          details({ name: 'expired', expires: now - 1 }),
          details({ name: 'partitioned' }, { topFrameSiteKey: 'https://embedded.example' }),
          details({ name: 'invalid name' }),
          details({ domain: '.amazon.co.jp', name: 'commerce' }),
          details({ domain: '.google.com', name: 'not-selected' })
        ]
      },
      events
    )
    const source = await readBrowserProfileCookies(
      'chrome',
      profile,
      input.siteIds,
      new AbortController().signal,
      reader,
      () => now
    )
    assert.equal(events.length, 1)
    const { path, ...request } = events[0]
    assert.deepEqual(request, {
      browserId: 'chrome',
      includeExpired: true,
      mollyInventory: true,
      timeoutMs: 300000,
      appBound: 'disabled'
    })
    assert.equal(path.endsWith('/Cookies'), true)
    assert.equal(path.startsWith(profile.path), false)
    assert.deepEqual(
      source.cookies.map((entry) => entry.name),
      ['synthetic-session', 'molly-session', 'commerce']
    )
    assert.equal(source.cookies[1].session, true)
    assert.deepEqual(source.report, {
      sites: [
        { siteId: 'pinterest', discovered: 5, imported: 2, skipped: 2, failed: 1 },
        { siteId: 'amazon', discovered: 1, imported: 1, skipped: 0, failed: 0 }
      ]
    })
    assert.equal(JSON.stringify(source.report).includes('synthetic-only'), false)
  } finally {
    await chrome.cleanup()
  }
})

void test('the native reader opens a private 0700 copy of the database and sidecars that is removed afterwards', async () => {
  const chrome = await syntheticChrome([['Default', 'Synthetic']])
  try {
    const profile = await listedProfile(chrome)
    const [database] = profile.sources
    await writeFile(database, 'synthetic database bytes')
    await writeFile(database + '-wal', 'synthetic wal bytes')
    await writeFile(database + '-shm', 'synthetic shm bytes')
    const observed = []
    const reader = {
      CancellationHandle: class {
        cancel() {}
      },
      fromPath: async ({ path }) => {
        const directory = join(path, '..')
        observed.push({
          path,
          mode: (await stat(directory)).mode & 0o777,
          files: (await readdir(directory)).sort(),
          database: await readFile(path, 'utf8'),
          wal: await readFile(path + '-wal', 'utf8'),
          shm: await readFile(path + '-shm', 'utf8')
        })
        return { browserId: null, profileId: null, warnings: [], detailedCookies: [] }
      }
    }
    await readBrowserProfileCookies(
      'chrome',
      profile,
      ['pinterest'],
      new AbortController().signal,
      reader,
      () => now
    )
    assert.equal(observed.length, 1)
    assert.notEqual(observed[0].path, database)
    assert.equal(observed[0].mode, 0o700)
    assert.deepEqual(observed[0].files, ['Cookies', 'Cookies-shm', 'Cookies-wal'])
    assert.deepEqual(
      [observed[0].database, observed[0].wal, observed[0].shm],
      ['synthetic database bytes', 'synthetic wal bytes', 'synthetic shm bytes']
    )
    await assert.rejects(stat(join(observed[0].path, '..')), { code: 'ENOENT' })
    assert.equal(await readFile(database, 'utf8'), 'synthetic database bytes')
  } finally {
    await chrome.cleanup()
  }
})

void test('the private copy is removed when the native read fails', async () => {
  const chrome = await syntheticChrome([['Default', 'Synthetic']])
  try {
    let directory
    await assert.rejects(
      readBrowserProfileCookies(
        'chrome',
        await listedProfile(chrome),
        ['pinterest'],
        new AbortController().signal,
        {
          CancellationHandle: class {
            cancel() {}
          },
          fromPath: async ({ path }) => {
            directory = join(path, '..')
            throw new Error('/private/path synthetic-secret')
          }
        }
      ),
      { message: 'source-unavailable' }
    )
    await assert.rejects(stat(directory), { code: 'ENOENT' })
  } finally {
    await chrome.cleanup()
  }
})

void test('a symlinked Cookies database, profile directory or sidecar is refused before any native read', async () => {
  const chrome = await syntheticChrome()
  try {
    const events = []
    const read = async (profile) =>
      readBrowserProfileCookies(
        'chrome',
        profile,
        input.siteIds,
        new AbortController().signal,
        readerFor(
          { browserId: 'chrome', profileId: profile.id, warnings: [], detailedCookies: [] },
          events
        ),
        () => now
      )
    const [source] = (await listedProfile(chrome, 'Profile 1')).sources
    await rm(source)
    await symlink(join(chrome.root, 'Default', 'Network', 'Cookies'), source)
    await assert.rejects(read(await listedProfile(chrome, 'Profile 1')), {
      message: 'source-unavailable'
    })

    const linkedProfile = await listedProfile(chrome, 'Profile 2')
    await rm(linkedProfile.path, { recursive: true })
    await symlink(join(chrome.root, 'Default'), linkedProfile.path)
    await assert.rejects(read(linkedProfile), { message: 'source-unavailable' })

    const [sidecarOwner] = (await listedProfile(chrome, 'Default')).sources
    await rm(sidecarOwner + '-wal')
    await symlink(join(chrome.root, 'Local State'), sidecarOwner + '-wal')
    await assert.rejects(read(await listedProfile(chrome, 'Default')), {
      message: 'source-unavailable'
    })
    assert.deepEqual(events, [])
    await rm(sidecarOwner + '-wal')
    await writeFile(sidecarOwner + '-wal', 'synthetic')
    await read(await listedProfile(chrome, 'Default'))
    assert.equal(events.length, 1)
  } finally {
    await chrome.cleanup()
  }
})

void test('a profile or Cookies database that disappeared or left its profile directory is refused', async () => {
  const chrome = await syntheticChrome([['Default', 'Synthetic']])
  try {
    const profile = await listedProfile(chrome)
    await assertRegularProfileFiles(profile)
    await assert.rejects(
      assertRegularProfileFiles({ ...profile, sources: [join(chrome.root, 'Local State')] }),
      { message: 'source-unavailable' }
    )
    await assert.rejects(
      assertRegularProfileFiles({ ...profile, sources: [join(profile.path, 'Missing')] }),
      { message: 'source-unavailable' }
    )
    await assert.rejects(
      assertRegularProfileFiles({ ...profile, path: join(chrome.root, 'Gone') }),
      { message: 'source-unavailable' }
    )
  } finally {
    await chrome.cleanup()
  }
})

const denied = (code) => Object.assign(new Error(`synthetic ${code}`), { code })
const modeBitsEnforced = process.platform !== 'win32' && process.getuid?.() !== 0
const readWithEvents = (profile, events) =>
  readBrowserProfileCookies(
    'chrome',
    profile,
    input.siteIds,
    new AbortController().signal,
    readerFor(
      { browserId: 'chrome', profileId: profile.id, warnings: [], detailedCookies: [] },
      events
    ),
    () => now
  )

void test('EPERM while inspecting a Cookies database is a silent access denial, not an unavailable source', async (t) => {
  const chrome = await syntheticChrome([['Default', 'Synthetic']])
  try {
    const profile = await listedProfile(chrome)
    const [source] = profile.sources
    const fs = require('node:fs/promises')
    const { lstat } = fs
    t.mock.method(fs, 'lstat', async (path, ...rest) => {
      if (path === source) throw denied('EPERM')
      return lstat(path, ...rest)
    })
    const events = []
    await assert.rejects(assertRegularProfileFiles(profile), { message: 'source-access-denied' })
    await assert.rejects(readWithEvents(profile, events), { message: 'source-access-denied' })
    assert.deepEqual(events, [])
  } finally {
    await chrome.cleanup()
  }
})

void test('EPERM while opening a Cookies database for copy is a silent access denial', async (t) => {
  const chrome = await syntheticChrome([['Default', 'Synthetic']])
  try {
    const profile = await listedProfile(chrome)
    const [source] = profile.sources
    const fs = require('node:fs/promises')
    const { open } = fs
    t.mock.method(fs, 'open', async (path, ...rest) => {
      if (path === source) throw denied('EPERM')
      return open(path, ...rest)
    })
    const events = []
    await assert.rejects(readWithEvents(profile, events), { message: 'source-access-denied' })
    assert.deepEqual(events, [])
  } finally {
    await chrome.cleanup()
  }
})

void test('EPERM while re-checking an opened Cookies database is a silent access denial', async (t) => {
  const chrome = await syntheticChrome([['Default', 'Synthetic']])
  try {
    const profile = await listedProfile(chrome)
    const [source] = profile.sources
    const fs = require('node:fs/promises')
    const { lstat, open } = fs
    let opened = false
    t.mock.method(fs, 'open', async (path, ...rest) => {
      const handle = await open(path, ...rest)
      if (path === source) opened = true
      return handle
    })
    t.mock.method(fs, 'lstat', async (path, ...rest) => {
      if (opened && path === source) throw denied('EPERM')
      return lstat(path, ...rest)
    })
    const events = []
    await assert.rejects(readWithEvents(profile, events), { message: 'source-access-denied' })
    assert.deepEqual(events, [])
  } finally {
    await chrome.cleanup()
  }
})

void test(
  'EACCES while inspecting a Cookies database is a silent access denial',
  { skip: !modeBitsEnforced && 'file modes are not enforced for root or on Windows' },
  async () => {
    const chrome = await syntheticChrome([['Default', 'Synthetic']])
    const network = join(chrome.root, 'Default', 'Network')
    try {
      const profile = await listedProfile(chrome)
      await chmod(network, 0)
      await assert.rejects(assertRegularProfileFiles(profile), {
        message: 'source-access-denied'
      })
    } finally {
      await chmod(network, 0o700)
      await chrome.cleanup()
    }
  }
)

void test(
  'EACCES while opening a Cookies database for copy is a silent access denial',
  { skip: !modeBitsEnforced && 'file modes are not enforced for root or on Windows' },
  async () => {
    const chrome = await syntheticChrome([['Default', 'Synthetic']])
    const source = join(chrome.root, 'Default', 'Network', 'Cookies')
    try {
      const profile = await listedProfile(chrome)
      await chmod(source, 0)
      const events = []
      await assert.rejects(readWithEvents(profile, events), { message: 'source-access-denied' })
      assert.deepEqual(events, [])
    } finally {
      await chmod(source, 0o600)
      await chrome.cleanup()
    }
  }
)

void test('a missing Cookies database stays source-unavailable on the copy path', async () => {
  const chrome = await syntheticChrome([['Default', 'Synthetic']])
  try {
    const profile = await listedProfile(chrome)
    await rm(profile.sources[0])
    const events = []
    await assert.rejects(readWithEvents(profile, events), { message: 'source-unavailable' })
    assert.deepEqual(events, [])
  } finally {
    await chrome.cleanup()
  }
})

void test('cancellation discards a late native read and never exposes its secret or diagnostic', async () => {
  const chrome = await syntheticChrome([['Default', 'Synthetic']])
  try {
    const profile = await listedProfile(chrome)
    const pending = Promise.withResolvers()
    const controller = new AbortController()
    const started = Promise.withResolvers()
    const cancelled = Promise.withResolvers()
    class CancellationHandle {
      cancel() {
        cancelled.resolve()
      }
    }
    const read = readBrowserProfileCookies('chrome', profile, ['pinterest'], controller.signal, {
      CancellationHandle,
      fromPath: () => {
        started.resolve()
        return pending.promise
      }
    })
    await started.promise
    controller.abort()
    await cancelled.promise
    pending.resolve({
      browserId: 'chrome',
      profileId: profile.id,
      warnings: [],
      detailedCookies: [details()]
    })
    await assert.rejects(read, { message: 'cancelled' })
  } finally {
    await chrome.cleanup()
  }
})

void test('raw inventory validates only selected import candidates and counts raw partition markers', () => {
  const source = selectBrowserCookies(
    [
      details(),
      details({ domain: '.unselected.test', name: 'invalid name', value: 'invalid\tvalue' }),
      details({ name: 'opaque-partition', expires: now - 1 }, { topFrameSiteKey: 'opaque' }),
      details({ domain: '.unselected.test' }, { partitionKey: 'opaque' })
    ],
    ['pinterest'],
    now
  )
  assert.deepEqual(
    source.cookies.map(({ name }) => name),
    ['synthetic-session']
  )
  assert.deepEqual(source.report, {
    sites: [{ siteId: 'pinterest', discovered: 2, imported: 1, skipped: 1, failed: 0 }]
  })
  for (const patch of [
    { name: 'invalid name' },
    { name: 'invalid\tname' },
    { name: 'invalid\n' },
    { name: 'invalid\r' },
    { name: 'invalid\u2028' },
    { name: 'invalid=name' },
    { value: 'invalid\tvalue' },
    { value: 'invalid\n' },
    { value: 'invalid\u2028' },
    { value: 'invalid\u007fvalue' },
    { value: 'invalid;value' },
    { value: 'invalid\u00e9value' },
    { value: ' leading-space' },
    { value: 'trailing-space ' },
    { path: '/invalid\tpath' }
  ]) {
    const rejected = selectBrowserCookies([details(patch)], ['pinterest'], now)
    assert.deepEqual(rejected.cookies, [])
    assert.deepEqual(rejected.report.sites, [
      { siteId: 'pinterest', discovered: 1, imported: 0, skipped: 0, failed: 1 }
    ])
  }
})

void test('selected Chromium Cookie values retain destination-verified browser syntax exactly', () => {
  for (const value of [
    '"synthetic-only"',
    '{"session":"synthetic-only","route":2}',
    'synthetic,only',
    'synthetic only',
    'synthetic\\only',
    'synthetic"quoted,only'
  ]) {
    const source = selectBrowserCookies([details({ value })], ['pinterest'], now)
    assert.equal(source.cookies[0].value, value)
    assert.equal(source.report.sites[0].imported, 1)
  }
})

void test('partial or mismatched native results fail closed with redacted errors', async () => {
  const chrome = await syntheticChrome([['Default', 'Synthetic']])
  try {
    const profile = await listedProfile(chrome)
    class CancellationHandle {
      cancel() {}
    }
    for (const patch of [
      ...['decrypt_failed', 'row_read_failed', 'malformed_host_identity', 'unknown_warning'].map(
        (code) => ({ warnings: [{ code, count: 1, message: '/private/path synthetic-secret' }] })
      ),
      { warnings: [{ code: 'unknown_warning', count: 0, countersSaturated: true }] }
    ]) {
      await assert.rejects(
        readBrowserProfileCookies('chrome', profile, ['pinterest'], new AbortController().signal, {
          CancellationHandle,
          fromPath: async () => ({
            browserId: null,
            profileId: null,
            warnings: [],
            detailedCookies: [details()],
            ...patch
          })
        }),
        { message: 'source-incomplete' }
      )
    }
    await assert.rejects(
      readBrowserProfileCookies('chrome', profile, ['pinterest'], new AbortController().signal, {
        CancellationHandle,
        fromPath: async () => {
          throw new Error('/private/path synthetic-secret')
        }
      }),
      { message: 'source-unavailable' }
    )
  } finally {
    await chrome.cleanup()
  }
})

void test('unsupported contexts, duplicate identities and oversized values are counted as failed and never written', () => {
  for (const entries of [
    [details({}, { unknownField: true })],
    [details(), details()],
    [details({ value: 'a'.repeat(8193) })]
  ]) {
    const source = selectBrowserCookies(entries, ['pinterest'], now)
    const row = source.report.sites[0]
    assert.equal(row.discovered, entries.length)
    assert.equal(row.imported + row.skipped + row.failed, entries.length)
    assert.equal(row.imported, source.cookies.length)
    assert.equal(row.failed > 0, true)
  }
  assert.throws(() => selectBrowserCookies(Array(50001).fill(details()), ['pinterest'], now), {
    message: 'source-too-large'
  })
  assert.equal(
    selectBrowserCookies([details({}, { hasCrossSiteAncestor: true })], ['pinterest'], now).cookies
      .length,
    1
  )
})

void test('merge updates exact identities and keeps Molly-only paths, domains, names and partitions', async () => {
  const unchanged = [
    stored({ name: 'other' }),
    stored({ path: '/account' }),
    stored({ domain: 'pinterest.com' }),
    stored({ domain: '.figma.com' }),
    stored({
      name: 'partitioned',
      partitionKey: { topLevelSite: 'https://other.example', hasCrossSiteAncestor: true }
    })
  ]
  const fixture = storeFixture([stored({ value: 'old', priority: 'High' }), ...unchanged])
  const source = selectBrowserCookies([details()], ['pinterest'], now)
  const retained = await importBrowserAccountCookies(fixture.store, source.cookies, () => now)
  assert.equal(retained.has(JSON.stringify([cookie.domain, cookie.path, cookie.name])), true)
  assert.deepEqual(
    fixture.rows().filter((entry) => key(entry) !== key(stored())),
    unchanged
  )
  assert.equal(fixture.rows().find((entry) => key(entry) === key(stored())).value, cookie.value)
})

void test('write failure restores overwritten metadata and removes only inserted exact identities', async () => {
  const original = [
    stored({ value: 'original', priority: 'High', sameSite: 'Strict', sourcePort: 8443 }),
    stored({ path: '/keep', value: 'keep' })
  ]
  const fixture = storeFixture(original)
  const write = fixture.store.set
  fixture.store.set = async (entry) => {
    if (entry.name === 'new' && entry.value === 'reject') throw new Error('rejected')
    await write(entry)
  }
  await assert.rejects(
    importBrowserAccountCookies(
      fixture.store,
      selectBrowserCookies(
        [details(), details({ name: 'new', value: 'reject' })],
        ['pinterest'],
        now
      ).cookies,
      () => now
    ),
    { message: 'write-restored' }
  )
  assert.deepEqual(
    fixture.rows().sort((a, b) => key(a).localeCompare(key(b))),
    original.sort((a, b) => key(a).localeCompare(key(b)))
  )
})

void test('silent write or restore failure is found by readback', async () => {
  const fixture = storeFixture([stored({ value: 'original' })])
  fixture.store.set = async () => {}
  await assert.rejects(
    importBrowserAccountCookies(
      fixture.store,
      selectBrowserCookies([details()], ['pinterest'], now).cookies,
      () => now
    ),
    { message: 'restore-incomplete' }
  )
})

void test('conflicting destination CHIPS and capacity pressure leave the destination untouched', async () => {
  for (const initial of [
    [
      stored({
        partitionKey: { topLevelSite: 'https://other.example', hasCrossSiteAncestor: false }
      })
    ],
    Array.from({ length: 170 }, (_, index) => stored({ name: `existing-${index}` }))
  ]) {
    const fixture = storeFixture(initial)
    await assert.rejects(
      importBrowserAccountCookies(
        fixture.store,
        selectBrowserCookies([details()], ['pinterest'], now).cookies,
        () => now
      ),
      { message: initial.length === 1 ? 'destination-unsupported' : 'cookie-capacity' }
    )
    assert.deepEqual(fixture.rows(), initial)
  }
})

void test('a synchronous quit sweep removes the tracked private copy while a native read is still pending', async () => {
  const chrome = await syntheticChrome([['Default', 'Synthetic']])
  try {
    const pending = Promise.withResolvers(),
      started = Promise.withResolvers()
    let directory
    const read = readBrowserProfileCookies(
      'chrome',
      await listedProfile(chrome),
      ['pinterest'],
      new AbortController().signal,
      {
        CancellationHandle: class {
          cancel() {}
        },
        fromPath: async ({ path }) => {
          directory = join(path, '..')
          started.resolve()
          return pending.promise
        }
      },
      () => now
    )
    await started.promise
    assert.equal(existsSync(directory), true)
    assert.match(directory, new RegExp(`molly-cookies-${process.pid}-`))
    removeImportCopies()
    assert.equal(existsSync(directory), false)
    pending.resolve({ browserId: null, profileId: null, warnings: [], detailedCookies: [] })
    await read
    assert.equal(existsSync(directory), false)
  } finally {
    await chrome.cleanup()
  }
})

void test('the startup sweep removes only copies left by a process that no longer exists', async () => {
  const base = await mkdtemp(join(tmpdir(), 'molly-sweep-base-'))
  try {
    const finished = spawnSync(process.execPath, ['-e', ''])
    const stale = join(base, `molly-cookies-${finished.pid}-abc`)
    const live = join(base, `molly-cookies-${process.pid}-abc`)
    const unrelated = join(base, 'unrelated-dir')
    for (const directory of [stale, live, unrelated]) {
      await mkdir(directory)
      await writeFile(join(directory, 'Cookies'), 'synthetic')
    }
    await sweepStaleImportCopies(base)
    assert.equal(existsSync(stale), false)
    assert.equal(existsSync(live), true)
    assert.equal(existsSync(unrelated), true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
