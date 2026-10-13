import type { DetailedCookieObject, ReadResult } from 'rookie-cookies'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  BrowserImportCookieSchema,
  type BrowserImportCookie
} from '@molly/shared/browser-import-cookie'
import {
  browserAccountSiteForDomain,
  type BrowserAccountSiteId
} from '@molly/shared/browser-account-sites'
import type {
  AccountImportBrowserId,
  ElectronBrowserImportSources,
  ElectronBrowserProfileChoice,
  ElectronBrowserImportReport
} from '@molly/shared/electron-ipc'
import { BrowserAccountError, browserAccountSourceError } from './browser-account-error.ts'
import type { BrowserCookieReader } from './browser-cookie-reader.ts'

const browsers: Record<AccountImportBrowserId, { name: string; bundle: string }> = {
  chrome: { name: 'Google Chrome', bundle: 'Google Chrome.app' },
  edge: { name: 'Microsoft Edge', bundle: 'Microsoft Edge.app' },
  brave: { name: 'Brave', bundle: 'Brave Browser.app' },
  arc: { name: 'Arc', bundle: 'Arc.app' },
  vivaldi: { name: 'Vivaldi', bundle: 'Vivaldi.app' },
  opera: { name: 'Opera', bundle: 'Opera.app' },
  chromium: { name: 'Chromium', bundle: 'Chromium.app' }
}

export async function listImportSources(
  browserIds: readonly AccountImportBrowserId[],
  exists: (path: string) => Promise<boolean> = async (path) =>
    access(path).then(
      () => true,
      () => false
    )
): Promise<ElectronBrowserImportSources> {
  const installed = await Promise.all(
    browserIds.map(async (browserId) => {
      const browser = browsers[browserId]
      const locations = ['/Applications', join(homedir(), 'Applications')]
      if (
        !(await Promise.all(locations.map((base) => exists(join(base, browser.bundle))))).some(
          Boolean
        )
      )
        return []
      return [{ browserId, browserName: browser.name }]
    })
  )
  return { sources: installed.flat() }
}

export async function listImportProfiles(
  browserId: AccountImportBrowserId,
  signal: AbortSignal,
  reader?: Pick<typeof import('rookie-cookies'), 'browserProfiles'>
): Promise<ElectronBrowserProfileChoice[]> {
  try {
    if (signal.aborted) throw new BrowserAccountError('cancelled')
    const nativeReader =
      reader ?? (await import('./browser-cookie-reader.ts')).browserCookieReader()
    const profiles = await nativeReader.browserProfiles(browserId, { timeoutMs: 5 * 60_000 })
    if (signal.aborted) throw new BrowserAccountError('cancelled')
    return profiles.map(({ profile, isDefault }) => ({
      id: profile.profileId,
      name: profile.displayName,
      isDefault
    }))
  } catch (error) {
    if (signal.aborted) throw new BrowserAccountError('cancelled')
    throw browserAccountSourceError(error)
  }
}

const contextSchema = z
  .object({
    topFrameSiteKey: z.string().nullable(),
    hasCrossSiteAncestor: z.boolean().nullable(),
    sourceScheme: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
    sourcePort: z.number().int().min(-1).max(65535).nullable(),
    isPersistent: z.boolean().nullable(),
    originAttributes: z.string().nullable(),
    userContextId: z.number().int().nullable(),
    partitionKey: z.string().nullable(),
    privateBrowsingId: z.number().int().nullable()
  })
  .strict()

export type BrowserAccountSource = {
  cookies: BrowserImportCookie[]
  report: ElectronBrowserImportReport
}

function hasCookieControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })
}

export function selectBrowserCookies(
  entries: DetailedCookieObject[],
  siteIds: readonly BrowserAccountSiteId[],
  now: number
): BrowserAccountSource {
  if (entries.length > 50_000) throw new BrowserAccountError('source-too-large')
  const selected = new Set(siteIds)
  const report: ElectronBrowserImportReport = {
    imported: 0,
    skippedExpired: 0,
    skippedPartitioned: 0,
    sites: siteIds.map((siteId) => ({
      siteId,
      imported: 0,
      skippedExpired: 0,
      skippedPartitioned: 0
    }))
  }
  const cookies: BrowserImportCookie[] = []
  const identities = new Set<string>()
  let bytes = 0
  for (const { cookie, context } of entries) {
    bytes += Buffer.byteLength(cookie.name + cookie.value + cookie.domain + cookie.path)
    if (bytes > 32 * 1024 * 1024) throw new BrowserAccountError('source-too-large')
    const site = browserAccountSiteForDomain(cookie.domain)
    if (!site || !selected.has(site.id)) continue
    const row = report.sites.find((entry) => entry.siteId === site.id)!
    const checked = contextSchema.safeParse(context)
    if (!checked.success) throw new BrowserAccountError('source-invalid')
    const details = checked.data
    if (
      details.topFrameSiteKey ||
      details.partitionKey ||
      details.originAttributes ||
      details.userContextId ||
      details.privateBrowsingId
    ) {
      row.skippedPartitioned++
      report.skippedPartitioned++
      continue
    }
    if (cookie.expires !== undefined && cookie.expires <= now) {
      row.skippedExpired++
      report.skippedExpired++
      continue
    }
    const value = BrowserImportCookieSchema.safeParse({
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      domain: cookie.domain.toLowerCase(),
      hostOnly: !cookie.domain.startsWith('.'),
      session: cookie.expires === undefined,
      ...(cookie.expires === undefined ? {} : { expirationDate: cookie.expires }),
      sameSite: (
        { '-1': 'unspecified', '0': 'no_restriction', '1': 'lax', '2': 'strict' } as Record<
          string,
          string
        >
      )[cookie.sameSite],
      sourceScheme: (['Unset', 'NonSecure', 'Secure'] as const)[details.sourceScheme ?? 0],
      sourcePort: details.sourcePort ?? -1
    })
    if (!value.success) throw new BrowserAccountError('source-invalid')
    const converted = value.data
    if (
      !/^\.?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(converted.domain) ||
      !/^[!#-'*+\-.0-9A-Z^-z|~]+$/.test(converted.name) ||
      !/^[\x20-\x3a\x3c-\x7e]*$/.test(converted.value) ||
      converted.value.startsWith(' ') ||
      converted.value.endsWith(' ') ||
      !converted.path.startsWith('/') ||
      hasCookieControlCharacters(converted.path)
    )
      throw new BrowserAccountError('source-invalid')
    const identity = JSON.stringify([converted.domain, converted.path, converted.name])
    if (identities.has(identity)) throw new BrowserAccountError('source-invalid')
    identities.add(identity)
    cookies.push(converted)
    row.imported++
    report.imported++
  }
  return { cookies, report }
}

export async function readBrowserProfileCookies(
  browserId: AccountImportBrowserId,
  profileId: string,
  siteIds: readonly BrowserAccountSiteId[],
  signal: AbortSignal,
  reader?: Pick<BrowserCookieReader, 'read' | 'CancellationHandle'>,
  now: () => number = () => Date.now() / 1000
): Promise<BrowserAccountSource> {
  const nativeReader = reader ?? (await import('./browser-cookie-reader.ts')).browserCookieReader()
  const cancellation = new nativeReader.CancellationHandle()
  const cancel = (): void => {
    cancellation.cancel()
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) throw new BrowserAccountError('cancelled')
    const result: ReadResult = await nativeReader.read(
      {
        browser: browserId,
        profile: profileId,
        includeExpired: true,
        includeSession: true,
        mollyInventory: true,
        timeoutMs: 5 * 60_000,
        appBound: 'disabled'
      },
      cancellation
    )
    if (signal.aborted) throw new BrowserAccountError('cancelled')
    if (
      result.browserId !== browserId ||
      result.profileId !== profileId ||
      result.warnings.some((warning) => warning.count > 0 || warning.countersSaturated)
    )
      throw new BrowserAccountError('source-incomplete')
    return selectBrowserCookies(result.detailedCookies, siteIds, now())
  } catch (error) {
    if (signal.aborted) throw new BrowserAccountError('cancelled')
    throw browserAccountSourceError(error)
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}
