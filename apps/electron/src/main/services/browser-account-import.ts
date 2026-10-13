import { z } from 'zod'
import { getDomain } from 'tldts'
import type { BrowserImportCookie } from '@molly/shared/browser-import-cookie'
import { BrowserAccountError } from './browser-account-error.ts'

export const storedCookieSchema = z
  .object({
    name: z.string(),
    value: z.string(),
    domain: z.string(),
    path: z.string(),
    expires: z.number(),
    size: z.number(),
    httpOnly: z.boolean(),
    secure: z.boolean(),
    session: z.boolean(),
    sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
    priority: z.enum(['Low', 'Medium', 'High']),
    sameParty: z.boolean().optional(),
    sourceScheme: z.enum(['Unset', 'NonSecure', 'Secure']),
    sourcePort: z.number().int(),
    partitionKey: z
      .object({ topLevelSite: z.string(), hasCrossSiteAncestor: z.boolean() })
      .strict()
      .optional(),
    partitionKeyOpaque: z.boolean().optional()
  })
  .strict()
export type StoredBrowserCookie = z.infer<typeof storedCookieSchema>
export type BrowserCookieStore = {
  snapshot: () => Promise<StoredBrowserCookie[]>
  set: (cookie: StoredBrowserCookie) => Promise<void>
  remove: (cookie: StoredBrowserCookie) => Promise<void>
  flush: () => Promise<void>
  assertIsolated: () => void
}
const identity = (cookie: StoredBrowserCookie): string =>
  JSON.stringify([cookie.domain, cookie.path, cookie.name])
const completeIdentity = (cookie: StoredBrowserCookie): string =>
  JSON.stringify([identity(cookie), cookie.partitionKey, cookie.partitionKeyOpaque])
const live = (cookie: StoredBrowserCookie, now: number): boolean =>
  cookie.session || cookie.expires > now
const fingerprint = (cookie: StoredBrowserCookie): string =>
  JSON.stringify([
    completeIdentity(cookie),
    cookie.value,
    cookie.expires,
    cookie.httpOnly,
    cookie.secure,
    cookie.session,
    cookie.sameSite,
    cookie.priority,
    cookie.sameParty ?? false,
    cookie.sourceScheme,
    cookie.sourcePort
  ])

export function browserCookieParam(cookie: StoredBrowserCookie): Record<string, unknown> {
  return {
    url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}/`,
    name: cookie.name,
    value: cookie.value,
    ...(cookie.domain.startsWith('.') ? { domain: cookie.domain } : {}),
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
    ...(cookie.session ? {} : { expires: cookie.expires }),
    priority: cookie.priority,
    sourceScheme: cookie.sourceScheme,
    sourcePort: cookie.sourcePort,
    ...(cookie.sameParty !== undefined ? { sameParty: cookie.sameParty } : {}),
    ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {})
  }
}

function importedCookie(cookie: BrowserImportCookie): StoredBrowserCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.session ? -1 : cookie.expirationDate!,
    session: cookie.session,
    size: Buffer.byteLength(cookie.name + cookie.value),
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    ...(cookie.sameSite === 'unspecified'
      ? {}
      : {
          sameSite: ({ lax: 'Lax', strict: 'Strict', no_restriction: 'None' } as const)[
            cookie.sameSite
          ]
        }),
    priority: 'Medium',
    sourceScheme: cookie.sourceScheme,
    sourcePort: cookie.sourcePort
  }
}

function assertCapacity(before: StoredBrowserCookie[], after: StoredBrowserCookie[]): void {
  if (after.length > before.length && after.length > 3000)
    throw new BrowserAccountError('cookie-capacity')
  const counts = (cookies: StoredBrowserCookie[]): Map<string, number> => {
    const result = new Map<string, number>()
    for (const cookie of cookies) {
      if (cookie.partitionKey || cookie.partitionKeyOpaque) continue
      const key = getDomain(cookie.domain.replace(/^\./, ''), { allowPrivateDomains: true })
      if (!key) throw new BrowserAccountError('destination-unsupported')
      result.set(key, (result.get(key) ?? 0) + 1)
    }
    return result
  }
  const oldCounts = counts(before)
  for (const [domain, count] of counts(after)) {
    if (count > 170 && count > (oldCounts.get(domain) ?? 0))
      throw new BrowserAccountError('cookie-capacity')
  }
}

function matches(
  expected: StoredBrowserCookie[],
  actual: StoredBrowserCookie[],
  now: number
): boolean {
  const stable = (cookies: StoredBrowserCookie[]): string[] =>
    cookies
      .filter((cookie) => live(cookie, now))
      .map(fingerprint)
      .sort()
  const left = stable(expected),
    right = stable(actual)
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export async function importBrowserAccountCookies(
  store: BrowserCookieStore,
  source: BrowserImportCookie[],
  now: () => number = () => Date.now() / 1000
): Promise<Set<string>> {
  store.assertIsolated()
  const before = await store.snapshot()
  const incoming = source.map(importedCookie).filter((cookie) => live(cookie, now()))
  const ids = new Set(incoming.map(identity))
  if (ids.size !== incoming.length || incoming.some((cookie) => cookie.size > 4096))
    throw new BrowserAccountError('source-invalid')
  for (const id of ids) {
    const previous = before.filter((cookie) => identity(cookie) === id)
    if (
      previous.length > 1 ||
      previous.some((cookie) => cookie.partitionKey || cookie.partitionKeyOpaque)
    )
      throw new BrowserAccountError('destination-unsupported')
  }
  const expected = [...before.filter((cookie) => !ids.has(identity(cookie))), ...incoming]
  assertCapacity(before, expected)
  store.assertIsolated()
  const attempted: StoredBrowserCookie[] = []
  try {
    for (const cookie of incoming) {
      store.assertIsolated()
      attempted.push(cookie)
      const previous = before.find((entry) => identity(entry) === identity(cookie))
      if (previous) await store.remove(previous)
      await store.set(cookie)
    }
    await store.flush()
    store.assertIsolated()
    const actual = await store.snapshot()
    if (!matches(expected, actual, now())) throw new Error('cookie write verification failed')
    store.assertIsolated()
    return new Set(
      actual.filter((cookie) => ids.has(identity(cookie)) && live(cookie, now())).map(identity)
    )
  } catch {
    let restored = true
    for (const cookie of attempted) {
      try {
        await store.remove(cookie)
      } catch {
        restored = false
      }
    }
    for (const cookie of before.filter((entry) => ids.has(identity(entry)) && live(entry, now()))) {
      try {
        await store.set(cookie)
      } catch {
        restored = false
      }
    }
    try {
      await store.flush()
      restored = matches(before, await store.snapshot(), now()) && restored
      store.assertIsolated()
    } catch {
      restored = false
    }
    throw new BrowserAccountError(restored ? 'write-restored' : 'restore-incomplete')
  }
}

export const importedCookieIdentity = (cookie: BrowserImportCookie): string =>
  JSON.stringify([cookie.domain, cookie.path, cookie.name])
