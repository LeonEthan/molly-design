import type {
  ExtractionReportObject,
  CookieObject,
  DetailedCookieObject,
  SourceExtractionObject,
  ReadResult,
  ReadWarningObject
} from 'rookie-cookies'
import { z } from 'zod'
import type { BrowserImportCookie } from '@molly/shared/browser-import-cookie'
import type {
  AccountImportBrowserId,
  ElectronBrowserAccountSiteInput,
  ElectronBrowserImportSources,
  ElectronBrowserProfileChoice
} from '@molly/shared/electron-ipc'
import { BrowserImportCookieSchema } from '@molly/shared/browser-import-cookie'
import { hostMatchesSite } from './public-browser-agent-policy.ts'

type Site = ElectronBrowserAccountSiteInput['site']

const readTimeoutMessage =
  'Browser authorization or cookie reading timed out. Complete any macOS Keychain prompt, then click Import again. Existing Molly cookies were not changed.'

export type BrowserProfileChoice = ElectronBrowserProfileChoice
export type BrowserImportSources = ElectronBrowserImportSources

const sameSite = (value: number): BrowserImportCookie['sameSite'] => {
  switch (value) {
    case -1:
      return 'unspecified'
    case 0:
      return 'no_restriction'
    case 1:
      return 'lax'
    case 2:
      return 'strict'
    default:
      throw new Error('The browser returned a cookie with an unsupported SameSite value.')
  }
}

function convertCookie(cookie: CookieObject, site: Site): BrowserImportCookie {
  const host = cookie.domain.replace(/^\./, '').toLowerCase()
  if (!hostMatchesSite(host, site))
    throw new Error('The browser returned a cookie outside the selected website.')
  const session = cookie.expires === undefined
  const candidate = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    hostOnly: !cookie.domain.startsWith('.'),
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    session,
    ...(session ? {} : { expirationDate: cookie.expires }),
    sameSite: sameSite(cookie.sameSite)
  }
  const checked = BrowserImportCookieSchema.safeParse(candidate)
  if (!checked.success) throw new Error('The browser returned an unsupported cookie field.')
  return checked.data
}

/** Do not accept a partial profile read as a successful sign-in transfer. */
function selectedSources(
  report: ExtractionReportObject,
  profileId: string
): SourceExtractionObject[] {
  if (report.termination === 'timed_out') throw new Error(readTimeoutMessage)
  if (report.schemaVersion !== 1 || report.termination !== 'completed')
    throw new Error('The browser profile import did not finish.')
  const profiles = report.profiles.filter((entry) => entry.profile.profileId === profileId)
  if (profiles.length !== 1) throw new Error('The selected browser profile is no longer available.')
  const sources = profiles[0].sources.filter((entry) => entry.selected)
  if (sources.length === 0 || sources.some((entry) => entry.status !== 'succeeded'))
    throw new Error('Molly could not read this browser profile’s cookies.')
  const requestIssues = report.issues.filter(
    (issue) =>
      !(
        issue.code === 'profile_excluded_service_directory' &&
        issue.stage === 'discovery' &&
        issue.profileId === null
      )
  )
  if (
    [...requestIssues, ...profiles[0].issues, ...sources.flatMap((entry) => entry.issues)].some(
      (issue) => issue.severity === 'error' || issue.code === 'decrypt_failed'
    )
  )
    throw new Error('This browser profile’s cookies could not be fully decrypted.')
  return sources
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

function assertNoDecryptWarnings(warnings: readonly ReadWarningObject[]): void {
  if (
    warnings.some(
      (warning) =>
        warning.code === 'decrypt_failed' ||
        warning.code === 'provider_failed' ||
        /decrypt/i.test(warning.message)
    )
  )
    throw new Error('This browser profile’s cookies could not be fully decrypted.')
}

/** Convert one detailed snapshot; cookie values must already be decrypted. */
export function cookiesFromDetailedCookies(
  detailed: readonly DetailedCookieObject[],
  site: Site
): BrowserImportCookie[] {
  if (detailed.length === 0)
    throw new Error('No cookies for this website were found in that browser profile.')
  if (detailed.length > 200) throw new Error('This website has more than 200 browser cookies.')
  const identities = new Set<string>()
  const convertedCookies = detailed.map(({ cookie, context }) => {
    const checked = contextSchema.safeParse(context)
    if (!checked.success)
      throw new Error(
        'The browser returned an unsupported cookie context. No cookies were imported.'
      )
    const details = checked.data
    if (
      details.topFrameSiteKey ||
      details.partitionKey ||
      details.originAttributes ||
      details.userContextId ||
      details.privateBrowsingId
    )
      throw new Error(
        'This website uses partitioned cookies that Molly cannot import yet. No cookies were imported. Sign in inside Molly instead.'
      )
    // hasCrossSiteAncestor alone does not imply partitioning: Chromium can set
    // it on ordinary cookies too. The top-frame site identifies CHIPS.
    const converted = convertCookie(cookie, site)
    const identity = JSON.stringify([
      converted.domain.toLowerCase(),
      converted.path,
      converted.name
    ])
    if (identities.has(identity))
      throw new Error(
        'The browser returned conflicting cookie identities. No cookies were imported.'
      )
    identities.add(identity)
    return converted
  })
  if (Buffer.byteLength(JSON.stringify(convertedCookies), 'utf8') > 512 * 1024)
    throw new Error('This website’s browser cookies exceed the import size limit.')
  return convertedCookies
}

/**
 * Legacy dual-read converter kept for unit tests of report diagnostics.
 * Production import uses a single `read()` so macOS Keychain is queried once.
 */
export function cookiesFromBrowserReport(
  report: ExtractionReportObject,
  profileId: string,
  site: Site,
  detailedSources: DetailedCookieObject[][]
): BrowserImportCookie[] {
  const sources = selectedSources(report, profileId)
  if (sources.length !== detailedSources.length)
    throw new Error('Browser cookie details are incomplete. No cookies were imported.')
  const cookies = detailedSources.flat()
  // The report preserves extraction diagnostics, but its cookies omit CHIPS.
  // Compare multisets, not just counts: the two reads must describe the same
  // cookies, including duplicate entries. Neither values nor paths leave main.
  for (const [index, source] of sources.entries()) {
    const reported = source.cookies
      .map((cookie) => JSON.stringify(convertCookie(cookie, site)))
      .sort()
    const detailed = detailedSources[index]
      .map(({ cookie }) => JSON.stringify(convertCookie(cookie, site)))
      .sort()
    if (reported.length !== detailed.length || reported.some((value, i) => value !== detailed[i]))
      throw new Error('The browser’s cookies changed or could not be fully read. Retry the import.')
  }
  return cookiesFromDetailedCookies(cookies, site)
}

/** A rejected listing means an installed browser Molly could not enumerate, not an absent one. */
export async function listImportSources(
  browserIds: readonly AccountImportBrowserId[],
  lister?: Pick<typeof import('rookie-cookies'), 'supportedBrowsers' | 'browserProfiles'>
): Promise<BrowserImportSources> {
  const { supportedBrowsers, browserProfiles } = lister ?? (await import('rookie-cookies'))
  const names = new Map(
    (await supportedBrowsers()).map((browser) => [browser.id, browser.displayName])
  )
  const result: BrowserImportSources = { sources: [], unreadable: [] }
  for (const browserId of browserIds) {
    const browserName = names.get(browserId)
    if (!browserName) continue
    try {
      const profiles = await browserProfiles(browserId)
      if (profiles.length > 0)
        result.sources.push({
          browserId,
          browserName,
          profiles: profiles.map(({ profile, isDefault }) => ({
            id: profile.profileId,
            name: profile.displayName,
            isDefault
          }))
        })
    } catch {
      result.unreadable.push(browserName)
    }
  }
  return result
}

export async function readBrowserSiteCookies(
  browserId: AccountImportBrowserId,
  profileId: string,
  site: Site,
  reader?: Pick<typeof import('rookie-cookies'), 'read'>
): Promise<BrowserImportCookie[]> {
  // One `read()` hits macOS Keychain once via `/usr/bin/security`. The older
  // browserReport + chromiumBasedDetailed path queried Safe Storage twice and
  // re-prompted even after Always Allow.
  const { read } = reader ?? (await import('rookie-cookies'))
  let snapshot: ReadResult
  try {
    snapshot = await read({
      browser: browserId,
      profile: profileId,
      // This native deadline includes the user's first macOS Keychain approval.
      // Keep the wait bounded without racing an uncancellable native read.
      timeoutMs: 5 * 60_000,
      appBound: 'disabled'
    })
  } catch (error) {
    // Native errors can contain profile paths; only fixed messages leave main.
    if (
      typeof error === 'object' &&
      error !== null &&
      'stopReason' in error &&
      error.stopReason === 'timed_out'
    )
      // eslint-disable-next-line preserve-caught-error -- Native causes may contain private paths or cookies.
      throw new Error(readTimeoutMessage)
    // eslint-disable-next-line preserve-caught-error -- Native causes must not cross renderer IPC.
    throw new Error(
      'Molly could not read the selected browser profile. Check macOS access and retry.'
    )
  }
  if (snapshot.profileId !== null && snapshot.profileId !== profileId)
    throw new Error('The selected browser profile is no longer available.')
  if (snapshot.browserId !== null && snapshot.browserId !== browserId)
    throw new Error('Molly could not read this browser profile’s cookies.')
  assertNoDecryptWarnings(snapshot.warnings)
  const forSite = snapshot.detailedCookies.filter(({ cookie }) =>
    hostMatchesSite(cookie.domain.replace(/^\./, ''), site)
  )
  return cookiesFromDetailedCookies(forSite, site)
}
