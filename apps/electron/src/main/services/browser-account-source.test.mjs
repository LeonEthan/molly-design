/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript test fixtures. */
import assert from 'node:assert/strict'
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
    export { ElectronBrowserAccountImportInputSchema } from '@molly/shared/electron-ipc';
    export { importBrowserAccountCookies } from './browser-account-import.ts';
    export { listImportSources, listImportProfiles, readBrowserProfileCookies, selectBrowserCookies } from './browser-account-source.ts';
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
  importBrowserAccountCookies,
  listImportSources,
  listImportProfiles,
  readBrowserProfileCookies,
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

void test('browser-only Import is a bounded ID request and profile paths remain forbidden', () => {
  const browserOnly = { ...input }
  delete browserOnly.profileId
  assert.deepEqual(ElectronBrowserAccountImportInputSchema.parse(browserOnly), browserOnly)
  assert.equal(
    ElectronBrowserAccountImportInputSchema.safeParse({
      ...browserOnly,
      profilePath: '/private/path'
    }).success,
    false
  )
})

void test('profile enumeration returns only choice metadata and discards a cancelled native result', async () => {
  const pending = Promise.withResolvers(),
    started = Promise.withResolvers(),
    controller = new AbortController()
  const nativeProfiles = [
    {
      profile: { profileId: 'opaque-profile', displayName: 'Synthetic', path: '/private/path' },
      isDefault: true
    }
  ]
  const reader = {
    browserProfiles: async (browserId, options) => {
      assert.equal(browserId, 'chrome')
      assert.deepEqual(options, { timeoutMs: 300000 })
      started.resolve()
      return pending.promise
    }
  }
  const listing = listImportProfiles('chrome', controller.signal, reader)
  await started.promise
  controller.abort()
  pending.resolve(nativeProfiles)
  await assert.rejects(listing, { message: 'cancelled' })
  assert.deepEqual(
    await listImportProfiles('chrome', new AbortController().signal, {
      browserProfiles: async () => nativeProfiles
    }),
    [{ id: 'opaque-profile', name: 'Synthetic', isDefault: true }]
  )
})

for (const [nativeCode, errorCode] of [
  ['molly_source_access_denied', 'source-access-denied'],
  ['molly_source_authorization_denied', 'source-authorization-denied'],
  ['engine_failure', 'source-unavailable']
])
  void test(`native ${nativeCode} reaches only its safe import error code`, async () => {
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
        input.profileId,
        input.siteIds,
        new AbortController().signal,
        {
          CancellationHandle: class {
            cancel() {
              return undefined
            }
          },
          read: async () => {
            throw error
          }
        }
      ),
      { message: errorCode }
    )
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

void test('one complete profile read is filtered in main and reports selected expiration and CHIPS separately', async () => {
  const events = []
  class CancellationHandle {
    cancel() {
      events.push('cancelled')
    }
  }
  const reader = {
    CancellationHandle,
    read: async (request) => {
      events.push(request)
      return {
        browserId: 'chrome',
        profileId: input.profileId,
        warnings: [],
        detailedCookies: [
          details(),
          details({ name: 'molly-session', expires: undefined }),
          details({ name: 'expired', expires: now - 1 }),
          details({ name: 'partitioned' }, { topFrameSiteKey: 'https://embedded.example' }),
          details({ domain: '.amazon.co.jp', name: 'commerce' }),
          details({ domain: '.google.com', name: 'not-selected' })
        ]
      }
    }
  }
  const source = await readBrowserProfileCookies(
    'chrome',
    input.profileId,
    input.siteIds,
    new AbortController().signal,
    reader,
    () => now
  )
  assert.deepEqual(events, [
    {
      browser: 'chrome',
      profile: input.profileId,
      includeExpired: true,
      includeSession: true,
      mollyInventory: true,
      timeoutMs: 300000,
      appBound: 'disabled'
    }
  ])
  assert.deepEqual(
    source.cookies.map((entry) => entry.name),
    ['synthetic-session', 'molly-session', 'commerce']
  )
  assert.equal(source.cookies[1].session, true)
  assert.deepEqual(source.report, {
    imported: 3,
    skippedExpired: 1,
    skippedPartitioned: 1,
    sites: [
      { siteId: 'pinterest', imported: 2, skippedExpired: 1, skippedPartitioned: 1 },
      { siteId: 'amazon', imported: 1, skippedExpired: 0, skippedPartitioned: 0 }
    ]
  })
  assert.equal(JSON.stringify(source.report).includes('synthetic-only'), false)
})

void test('cancellation discards a late native read and never exposes its secret or diagnostic', async () => {
  const pending = Promise.withResolvers()
  const controller = new AbortController()
  const cancelled = Promise.withResolvers()
  class CancellationHandle {
    cancel() {
      cancelled.resolve()
    }
  }
  const read = readBrowserProfileCookies(
    'chrome',
    input.profileId,
    ['pinterest'],
    controller.signal,
    { CancellationHandle, read: () => pending.promise }
  )
  controller.abort()
  await cancelled.promise
  pending.resolve({
    browserId: 'chrome',
    profileId: input.profileId,
    warnings: [],
    detailedCookies: [details()]
  })
  await assert.rejects(read, { message: 'cancelled' })
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
    imported: 1,
    skippedExpired: 0,
    skippedPartitioned: 1,
    sites: [{ siteId: 'pinterest', imported: 1, skippedExpired: 0, skippedPartitioned: 1 }]
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
  ])
    assert.throws(() => selectBrowserCookies([details(patch)], ['pinterest'], now), {
      message: 'source-invalid'
    })
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
    assert.equal(source.report.imported, 1)
  }
})

void test('partial or mismatched native results fail closed with redacted errors', async () => {
  class CancellationHandle {
    cancel() {}
  }
  for (const patch of [
    { profileId: 'another' },
    { browserId: 'edge' },
    ...['decrypt_failed', 'row_read_failed', 'malformed_host_identity', 'unknown_warning'].map(
      (code) => ({ warnings: [{ code, count: 1, message: '/private/path synthetic-secret' }] })
    ),
    { warnings: [{ code: 'unknown_warning', count: 0, countersSaturated: true }] }
  ]) {
    await assert.rejects(
      readBrowserProfileCookies(
        'chrome',
        input.profileId,
        ['pinterest'],
        new AbortController().signal,
        {
          CancellationHandle,
          read: async () => ({
            browserId: 'chrome',
            profileId: input.profileId,
            warnings: [],
            detailedCookies: [details()],
            ...patch
          })
        }
      ),
      { message: 'source-incomplete' }
    )
  }
  await assert.rejects(
    readBrowserProfileCookies(
      'chrome',
      input.profileId,
      ['pinterest'],
      new AbortController().signal,
      {
        CancellationHandle,
        read: async () => {
          throw new Error('/private/path synthetic-secret')
        }
      }
    ),
    { message: 'source-unavailable' }
  )
})

void test('unsupported contexts, duplicate identities and bounded profiles reject before writing', () => {
  for (const entries of [
    [details({}, { unknownField: true })],
    [details(), details()],
    [details({ value: 'a'.repeat(8193) })]
  ])
    assert.throws(() => selectBrowserCookies(entries, ['pinterest'], now), {
      message: 'source-invalid'
    })
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
