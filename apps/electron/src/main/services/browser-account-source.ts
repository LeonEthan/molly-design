import type {
  ExtractionReportObject,
  CookieObject,
  DetailedCookieObject,
  SourceExtractionObject
} from 'rookie-cookies'
import { z } from 'zod'
import type { BrowserImportCookie } from '@molly/shared/browser-import-cookie'
import type { ElectronBrowserAccountSiteInput } from '@molly/shared/electron-ipc'
import { BrowserImportCookieSchema } from '@molly/shared/browser-import-cookie'
import { hostMatchesSite } from './public-browser-agent-policy.ts'

type Site = ElectronBrowserAccountSiteInput['site']

const chromeReadTimeoutMessage =
  'Chrome authorization or cookie reading timed out. Complete any macOS Keychain prompt, then click Import from Chrome again. Existing Molly cookies were not changed.'

export type ChromeProfileChoice = { id: string; name: string; isDefault: boolean }

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
      throw new Error('Chrome returned a cookie with an unsupported SameSite value.')
  }
}

function convertCookie(cookie: CookieObject, site: Site): BrowserImportCookie {
  const host = cookie.domain.replace(/^\./, '').toLowerCase()
  if (!hostMatchesSite(host, site))
    throw new Error('Chrome returned a cookie outside the selected website.')
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
  if (!checked.success) throw new Error('Chrome returned an unsupported cookie field.')
  return checked.data
}

/** Do not accept a partial profile read as a successful sign-in transfer. */
function selectedSources(
  report: ExtractionReportObject,
  profileId: string
): SourceExtractionObject[] {
  if (report.termination === 'timed_out') throw new Error(chromeReadTimeoutMessage)
  if (report.schemaVersion !== 1 || report.termination !== 'completed')
    throw new Error('Chrome profile import did not finish.')
  const profiles = report.profiles.filter((entry) => entry.profile.profileId === profileId)
  if (profiles.length !== 1) throw new Error('The selected Chrome profile is no longer available.')
  const sources = profiles[0].sources.filter((entry) => entry.selected)
  if (sources.length === 0 || sources.some((entry) => entry.status !== 'succeeded'))
    throw new Error('Molly could not read this Chrome profile’s cookies.')
  if (
    [...report.issues, ...profiles[0].issues, ...sources.flatMap((entry) => entry.issues)].some(
      (issue) => issue.severity === 'error' || issue.code === 'decrypt_failed'
    )
  )
    throw new Error('Chrome profile cookies could not be fully decrypted.')
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

export function cookiesFromChromeReport(
  report: ExtractionReportObject,
  profileId: string,
  site: Site,
  detailedSources: DetailedCookieObject[][]
): BrowserImportCookie[] {
  const sources = selectedSources(report, profileId)
  if (sources.length !== detailedSources.length)
    throw new Error('Chrome cookie details are incomplete. No cookies were imported.')
  const cookies = detailedSources.flat()
  if (cookies.length === 0)
    throw new Error('No cookies for this website were found in that Chrome profile.')
  if (cookies.length > 200) throw new Error('This website has more than 200 Chrome cookies.')
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
      throw new Error('Chrome cookies changed or could not be fully read. Retry the import.')
  }
  const identities = new Set<string>()
  const convertedCookies = cookies.map(({ cookie, context }) => {
    const checked = contextSchema.safeParse(context)
    if (!checked.success)
      throw new Error('Chrome returned an unsupported cookie context. No cookies were imported.')
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
      throw new Error('Chrome returned conflicting cookie identities. No cookies were imported.')
    identities.add(identity)
    return converted
  })
  if (Buffer.byteLength(JSON.stringify(convertedCookies), 'utf8') > 512 * 1024)
    throw new Error('This website’s Chrome cookies exceed the import size limit.')
  return convertedCookies
}

export async function listChromeProfiles(): Promise<ChromeProfileChoice[]> {
  const { chromeProfiles } = await import('rookie-cookies')
  const profiles = await chromeProfiles()
  return profiles.map(({ profile, isDefault }) => ({
    id: profile.profileId,
    name: profile.displayName,
    isDefault
  }))
}

export async function readChromeSiteCookies(
  profileId: string,
  site: Site,
  reader?: Pick<typeof import('rookie-cookies'), 'browserReport' | 'chromiumBasedDetailed'>
): Promise<BrowserImportCookie[]> {
  const { browserReport, chromiumBasedDetailed } = reader ?? (await import('rookie-cookies'))
  let report: ExtractionReportObject
  try {
    report = await browserReport({
      browserId: 'chrome',
      profileId,
      domains: [site],
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
      throw new Error(chromeReadTimeoutMessage)
    // eslint-disable-next-line preserve-caught-error -- Native causes must not cross renderer IPC.
    throw new Error(
      'Molly could not read the selected Chrome profile. Check macOS access and retry.'
    )
  }
  const sources = selectedSources(report, profileId)
  const detailedSources: DetailedCookieObject[][] = []
  for (const { source } of sources) {
    if (source.pathLossy || !source.path)
      throw new Error('Molly cannot safely read this Chrome cookie source.')
    try {
      // Pinned 0.6.0 compatibility API: unlike read()/fromPath(), this Unix
      // entry point keeps domain filtering AND partition metadata. The path
      // comes only from the validated native profile report, never the UI.
      detailedSources.push(await chromiumBasedDetailed(source.path, [site], 'chrome'))
    } catch {
      throw new Error('Molly could not read Chrome cookie details. No cookies were imported.')
    }
  }
  return cookiesFromChromeReport(report, profileId, site, detailedSources)
}
