/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript test fixtures. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  assertStoredCookiesUnpartitioned,
  importChromeAccountCookies
} from './browser-account-import.ts'
import { cookiesFromChromeReport, readChromeSiteCookies } from './browser-account-source.ts'

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
const details = (cookies = [cookie]) =>
  cookies.map((entry) => ({ cookie: entry, context: { ...context } }))
const convert = (input = report(), detailed = [details()]) =>
  cookiesFromChromeReport(input, 'synthetic-profile', 'pinterest.com', detailed)
const report = (overrides = {}) => ({
  schemaVersion: 1,
  status: 'succeeded',
  termination: 'completed',
  summary: {},
  issues: [],
  profiles: [
    {
      profile: { profileId: 'synthetic-profile' },
      issues: [],
      sources: [{ selected: true, status: 'succeeded', cookies: [cookie], issues: [] }]
    }
  ],
  ...overrides
})

void test('selected Chrome profile imports only the requested website', () => {
  const cookies = convert()
  assert.deepEqual(cookies, [
    {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: '/',
      hostOnly: false,
      secure: true,
      httpOnly: true,
      session: false,
      expirationDate: cookie.expires,
      sameSite: 'lax'
    }
  ])
  assert.throws(
    () => cookiesFromChromeReport(report(), 'another-profile', 'pinterest.com', [details()]),
    /profile is no longer available/
  )
})

void test('partial decrypts and off-site cookies never reach Molly', () => {
  const partial = report()
  partial.profiles[0].sources[0].issues.push({ code: 'decrypt_failed', severity: 'warning' })
  assert.throws(() => convert(partial), /could not be fully decrypted/)
  const offSite = report()
  offSite.profiles[0].sources[0].cookies = [{ ...cookie, domain: '.pinterest.com.evil.test' }]
  assert.throws(
    () => convert(offSite, [details(offSite.profiles[0].sources[0].cookies)]),
    /outside the selected website/
  )
})

void test('single CHIPS cookie and same-name partition collisions reject the whole import', () => {
  const partitioned = { cookie, context: { ...context, topFrameSiteKey: 'https://example.test' } }
  assert.throws(() => convert(report(), [[partitioned]]), /partitioned cookies/)
  const collision = report()
  collision.profiles[0].sources[0].cookies = [cookie, cookie]
  assert.throws(() => convert(collision, [[...details(), partitioned]]), /partitioned cookies/)
})

void test('unknown or missing contexts reject, while ordinary Chrome ancestry remains supported', () => {
  for (const unsupported of [undefined, {}, { ...context, futurePartition: 'opaque' }]) {
    assert.throws(
      () => convert(report(), [[{ cookie, context: unsupported }]]),
      /unsupported cookie context/
    )
  }
  for (const unsupported of [
    { partitionKey: 'opaque' },
    { originAttributes: '^userContextId=1' }
  ]) {
    assert.throws(
      () => convert(report(), [[{ cookie, context: { ...context, ...unsupported } }]]),
      /partitioned cookies/
    )
  }
  assert.deepEqual(
    convert(report(), [[{ cookie, context: { ...context, hasCrossSiteAncestor: true } }]]),
    convert()
  )
})

void test('detailed reads must match report values and multiplicity without exposing values', () => {
  for (const incomplete of [[], [{ ...cookie, value: 'private-value-must-not-appear' }]]) {
    assert.throws(
      () => convert(report(), [details(incomplete)]),
      (error) => {
        assert.match(error.message, /No cookies|changed or could not be fully read/)
        assert.doesNotMatch(error.message, /synthetic-only|private-value-must-not-appear/)
        return true
      }
    )
  }
  const duplicate = report()
  duplicate.profiles[0].sources[0].cookies = [cookie, cookie]
  assert.throws(() => convert(duplicate), /changed or could not be fully read/)
  assert.throws(
    () => convert(duplicate, [details([cookie, cookie])]),
    /conflicting cookie identities/
  )
})

void test('ordinary session, host-only, and persistent cookie fields retain their meaning', () => {
  const sessionCookie = { ...cookie, name: 'session', domain: 'www.pinterest.com', sameSite: -1 }
  delete sessionCookie.expires
  const input = report()
  input.profiles[0].sources[0].cookies = [cookie, sessionCookie]
  const result = convert(input, [details([sessionCookie, cookie])])
  assert.deepEqual(result[0], {
    name: 'session',
    value: cookie.value,
    domain: 'www.pinterest.com',
    path: '/',
    hostOnly: true,
    secure: true,
    httpOnly: true,
    session: true,
    sameSite: 'unspecified'
  })
  assert.deepEqual(result[1], convert()[0])
})

void test('cookie count and byte limits still reject the whole import', () => {
  for (const [count, value, message] of [
    [201, 'value', /more than 200/],
    [100, 'x'.repeat(8192), /size limit/]
  ]) {
    const cookies = Array.from({ length: count }, (_, i) => ({
      ...cookie,
      name: `cookie-${i}`,
      value
    }))
    const input = report()
    input.profiles[0].sources[0].cookies = cookies
    assert.throws(() => convert(input, [details(cookies)]), message)
  }
})

// A synthetic database exercises the actual pinned native API. Without a
// browserId this entry point is plaintext-only: no Chrome profile or Keychain.
void test(
  'pinned detailed reader filters domains and preserves actual CHIPS metadata',
  { skip: process.platform === 'win32' },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'molly-cookie-fixture-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const path = join(directory, 'Cookies')
    const db = new DatabaseSync(path)
    try {
      db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta VALUES ('version', '23');
      CREATE TABLE cookies (
        host_key TEXT, path TEXT, is_secure INTEGER, expires_utc INTEGER,
        name TEXT, value TEXT, encrypted_value BLOB, is_httponly INTEGER,
        samesite INTEGER, top_frame_site_key TEXT, has_cross_site_ancestor INTEGER,
        source_scheme INTEGER, source_port INTEGER, is_persistent INTEGER
      );
    `)
      const insert = db.prepare(
        'INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      for (const [domain, partition] of [
        ['.pinterest.com', ''],
        ['.pinterest.com', 'https://example.test'],
        ['.unselected.test', '']
      ]) {
        insert.run(
          domain,
          '/',
          1,
          13644473600000000n,
          cookie.name,
          cookie.value,
          new Uint8Array(),
          1,
          1,
          partition,
          0,
          2,
          443,
          1
        )
      }
    } finally {
      db.close()
    }
    const { chromiumBasedDetailed } = await import('rookie-cookies')
    const actual = await chromiumBasedDetailed(path, ['pinterest.com'])
    assert.equal(actual.length, 2)
    assert.ok(actual.every((entry) => entry.cookie.domain === '.pinterest.com'))
    assert.deepEqual(actual.map((entry) => entry.context.topFrameSiteKey ?? '').sort(), [
      '',
      'https://example.test'
    ])
    const ordinary = actual.filter((entry) => !entry.context.topFrameSiteKey)
    const ordinaryReport = report()
    ordinaryReport.profiles[0].sources[0].cookies = ordinary.map((entry) => entry.cookie)
    assert.equal(convert(ordinaryReport, [ordinary]).length, 1)
    const partitionedReport = report()
    partitionedReport.profiles[0].sources[0].cookies = actual.map((entry) => entry.cookie)
    assert.throws(() => convert(partitionedReport, [actual]), /partitioned cookies/)
  }
)

function cookieStore() {
  const state = [{ ...convert()[0], value: 'existing-molly-only' }]
  const key = (entry) => JSON.stringify([entry.domain, entry.path, entry.name])
  return {
    state,
    async get() {
      return structuredClone(state)
    },
    async set(nextCookie) {
      const index = state.findIndex((entry) => key(entry) === key(nextCookie))
      if (index >= 0) state.splice(index, 1)
      const stored = { ...nextCookie }
      delete stored.url
      state.push(stored)
    },
    async remove(url, name) {
      const index = state.findIndex(
        (entry) => entry.name === name && new URL(url).pathname === entry.path
      )
      if (index >= 0) state.splice(index, 1)
    },
    async flushStore() {
      // This fixture stores cookies in memory.
    }
  }
}

void test('first Keychain authorization can take two minutes without losing existing cookies', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const store = cookieStore()
  const before = structuredClone(store.state)
  const started = Promise.withResolvers()
  const input = report()
  input.profiles[0].sources[0].source = { path: '/synthetic/Cookies', pathLossy: false }
  const reader = {
    browserReport: ({ timeoutMs }) =>
      new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(report({ termination: 'timed_out' })), timeoutMs)
        setTimeout(() => {
          clearTimeout(timeout)
          resolve(input)
        }, 120_000)
        started.resolve()
      }),
    chromiumBasedDetailed: async () => details()
  }
  const importing = importChromeAccountCookies({
    store,
    site: 'pinterest.com',
    replaceExisting: true,
    readSource: () => readChromeSiteCookies('synthetic-profile', 'pinterest.com', reader),
    beforeWrite: async () => {}
  })
  await started.promise
  t.mock.timers.tick(90_000)
  assert.deepEqual(store.state, before)
  t.mock.timers.tick(30_000)
  assert.equal(await importing, 1)
  assert.equal(store.state[0].value, cookie.value)
})

void test('native authorization timeouts give a safe manual retry and preserve the destination', async () => {
  for (const browserReport of [
    async () => report({ termination: 'timed_out' }),
    async () => {
      throw Object.assign(new Error('/private/profile/secret'), { stopReason: 'timed_out' })
    }
  ]) {
    const store = cookieStore()
    const before = structuredClone(store.state)
    await assert.rejects(
      importChromeAccountCookies({
        store,
        site: 'pinterest.com',
        replaceExisting: true,
        readSource: () =>
          readChromeSiteCookies('synthetic-profile', 'pinterest.com', {
            browserReport,
            chromiumBasedDetailed: async () => {
              throw new Error('A timed out read must stop here.')
            }
          }),
        beforeWrite: async () => {
          throw new Error('A timed out read must not mutate cookies.')
        }
      }),
      (error) => {
        assert.match(error.message, /timed out.*Keychain.*Import from Chrome again/)
        assert.doesNotMatch(error.message, /private|secret|synthetic-only/)
        return true
      }
    )
    assert.deepEqual(store.state, before)
  }
})

void test('rejected source or existing CHIPS leaves destination cookies unchanged', async () => {
  for (const scenario of [
    'source-chips',
    'source-unknown',
    'destination-chips',
    'destination-opaque',
    'destination-unknown'
  ]) {
    const store = cookieStore()
    const before = structuredClone(store.state)
    await assert.rejects(
      importChromeAccountCookies({
        store,
        site: 'pinterest.com',
        replaceExisting: true,
        readSource: async () => {
          if (scenario === 'source-chips')
            return convert(report(), [
              [{ cookie, context: { ...context, topFrameSiteKey: 'https://example.test' } }]
            ])
          if (scenario === 'source-unknown') return convert(report(), [[{ cookie, context: {} }]])
          return convert()
        },
        beforeWrite: async () =>
          assertStoredCookiesUnpartitioned(
            scenario === 'destination-unknown'
              ? {}
              : {
                  cookies: [
                    {
                      domain: '.pinterest.com',
                      ...(scenario === 'destination-chips'
                        ? {
                            partitionKey: {
                              topLevelSite: 'https://example.test',
                              hasCrossSiteAncestor: false
                            }
                          }
                        : {}),
                      ...(scenario === 'destination-opaque' ? { partitionKeyOpaque: true } : {})
                    }
                  ]
                },
            'pinterest.com'
          )
      }),
      /partitioned|unsupported cookie context|could not verify/
    )
    assert.deepEqual(store.state, before)
  }
})

void test('ordinary import succeeds and rollback restores prior ordinary cookies', async () => {
  const store = cookieStore()
  const input = {
    store,
    site: 'pinterest.com',
    replaceExisting: true,
    readSource: async () => convert(),
    beforeWrite: async () =>
      assertStoredCookiesUnpartitioned(
        {
          cookies: [
            { domain: '.pinterest.com' },
            { domain: '.unselected.test', partitionKey: { topLevelSite: 'https://example.test' } }
          ]
        },
        'pinterest.com'
      )
  }
  assert.equal(await importChromeAccountCookies(input), 1)
  assert.equal(store.state[0].value, cookie.value)
  const before = structuredClone(store.state)
  const originalSet = store.set.bind(store)
  store.set = async (incoming) => {
    if (incoming.value === 'failed-import-value') throw new Error('synthetic-store-error')
    return originalSet(incoming)
  }
  await assert.rejects(
    importChromeAccountCookies({
      ...input,
      readSource: async () => [{ ...convert()[0], value: 'failed-import-value' }]
    }),
    /restored its previous/
  )
  assert.deepEqual(store.state, before)
})
