import type { DetailedCookieObject, ReadResult } from 'rookie-cookies'
import { constants, createWriteStream, rmSync } from 'node:fs'
import { access, lstat, mkdtemp, open, readdir, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
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

export type ListedImportProfile = ElectronBrowserProfileChoice & {
  path: string
  sources: string[]
}

export async function listImportProfiles(
  browserId: AccountImportBrowserId,
  signal: AbortSignal,
  reader?: Pick<typeof import('rookie-cookies'), 'browserProfiles'>
): Promise<ListedImportProfile[]> {
  try {
    if (signal.aborted) throw new BrowserAccountError('cancelled')
    const nativeReader =
      reader ?? (await import('./browser-cookie-reader.ts')).browserCookieReader()
    const profiles = await nativeReader.browserProfiles(browserId, { timeoutMs: 5 * 60_000 })
    if (signal.aborted) throw new BrowserAccountError('cancelled')
    return profiles
      .filter(({ profile }) => !profile.pathLossy)
      .map(({ profile, isDefault, sources }) => ({
        id: profile.profileId,
        name: profile.displayName,
        isDefault,
        path: profile.path,
        sources: sources
          .filter((entry) => !entry.pathLossy)
          .sort((left, right) => left.precedence - right.precedence)
          .map((entry) => entry.path)
      }))
  } catch (error) {
    if (signal.aborted) throw new BrowserAccountError('cancelled')
    throw browserAccountSourceError(error)
  }
}

const SIDECAR_SUFFIXES = ['-wal', '-shm'] as const

async function inspectEntry(path: string, optional: boolean) {
  try {
    return await lstat(path)
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new BrowserAccountError('source-unavailable')
  }
}

export async function assertRegularProfileFiles(profile: ListedImportProfile): Promise<void> {
  const directory = await inspectEntry(profile.path, false)
  if (!directory?.isDirectory()) throw new BrowserAccountError('source-unavailable')
  for (const source of profile.sources) {
    const inside = relative(profile.path, source)
    if (inside === '' || inside.startsWith('..') || inside.startsWith(sep))
      throw new BrowserAccountError('source-unavailable')
    for (
      let parent = dirname(source);
      parent !== profile.path && parent !== dirname(parent);
      parent = dirname(parent)
    ) {
      if (!(await inspectEntry(parent, false))?.isDirectory())
        throw new BrowserAccountError('source-unavailable')
    }
    if (!(await inspectEntry(source, false))?.isFile())
      throw new BrowserAccountError('source-unavailable')
    for (const suffix of SIDECAR_SUFFIXES) {
      const sidecar = await inspectEntry(source + suffix, true)
      if (sidecar && !sidecar.isFile()) throw new BrowserAccountError('source-unavailable')
    }
  }
}

const SNAPSHOT_ATTEMPTS = 3
const COPY_PREFIX = 'molly-cookies-'
const liveCopies = new Set<string>()

export function removeImportCopies(): void {
  for (const directory of liveCopies) rmSync(directory, { recursive: true, force: true })
  liveCopies.clear()
}

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function sweepStaleImportCopies(base: string = tmpdir()): Promise<void> {
  for (const name of await readdir(base).catch(() => [] as string[])) {
    const owner = /^molly-cookies-(\d+)-/.exec(name)
    if (owner && !processIsAlive(Number(owner[1])))
      await rm(join(base, name), { recursive: true, force: true }).catch(() => undefined)
  }
}

type FileFingerprint = { dev: number; ino: number; size: number; mtimeMs: number } | null

async function fingerprint(path: string, optional: boolean): Promise<FileFingerprint> {
  const stat = await inspectEntry(path, optional)
  if (!stat) return null
  if (!stat.isFile()) throw new BrowserAccountError('source-unavailable')
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs }
}

async function copyRegularFile(source: string, destination: string): Promise<void> {
  let handle
  try {
    handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    throw new BrowserAccountError('source-unavailable')
  }
  try {
    const opened = await handle.stat()
    const named = await lstat(source)
    if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino)
      throw new BrowserAccountError('source-unavailable')
    await pipeline(
      handle.createReadStream({ autoClose: false, start: 0 }),
      createWriteStream(destination, { flags: 'wx', mode: 0o600 })
    )
  } finally {
    await handle.close()
  }
}

const sameFile = (left: FileFingerprint, right: FileFingerprint): boolean =>
  left === null || right === null
    ? left === right
    : left.dev === right.dev &&
      left.ino === right.ino &&
      left.size === right.size &&
      left.mtimeMs === right.mtimeMs

export async function copyProfileCookies(
  profile: ListedImportProfile,
  directory: string
): Promise<string> {
  const source = profile.sources[0]
  if (!source) throw new BrowserAccountError('source-unavailable')
  const names = [
    [source, 'Cookies', false],
    ...SIDECAR_SUFFIXES.map((suffix) => [source + suffix, `Cookies${suffix}`, true] as const)
  ] as const
  for (let attempt = 1; attempt <= SNAPSHOT_ATTEMPTS; attempt++) {
    await assertRegularProfileFiles(profile)
    const before = await Promise.all(names.map(([from, , optional]) => fingerprint(from, optional)))
    for (const [index, [from, name]] of names.entries()) {
      await rm(join(directory, name), { force: true })
      if (before[index]) await copyRegularFile(from, join(directory, name))
    }
    const after = await Promise.all(names.map(([from, , optional]) => fingerprint(from, optional)))
    if (before.every((entry, index) => sameFile(entry, after[index])))
      return join(directory, 'Cookies')
  }
  throw new BrowserAccountError('source-incomplete')
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
    sites: siteIds.map((siteId) => ({ siteId, discovered: 0, imported: 0, skipped: 0, failed: 0 }))
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
    row.discovered++
    const checked = contextSchema.safeParse(context)
    if (!checked.success) {
      row.failed++
      continue
    }
    const details = checked.data
    if (
      details.topFrameSiteKey ||
      details.partitionKey ||
      details.originAttributes ||
      details.userContextId ||
      details.privateBrowsingId ||
      (cookie.expires !== undefined && cookie.expires <= now)
    ) {
      row.skipped++
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
    const converted = value.success ? value.data : null
    const identity = converted
      ? JSON.stringify([converted.domain, converted.path, converted.name])
      : null
    if (
      !converted ||
      !identity ||
      identities.has(identity) ||
      Buffer.byteLength(converted.name + converted.value) > 4096 ||
      !/^\.?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(converted.domain) ||
      !/^[!#-'*+\-.0-9A-Z^-z|~]+$/.test(converted.name) ||
      !/^[\x20-\x3a\x3c-\x7e]*$/.test(converted.value) ||
      converted.value.startsWith(' ') ||
      converted.value.endsWith(' ') ||
      !converted.path.startsWith('/') ||
      hasCookieControlCharacters(converted.path)
    ) {
      row.failed++
      continue
    }
    identities.add(identity)
    cookies.push(converted)
    row.imported++
  }
  return { cookies, report }
}

export async function readBrowserProfileCookies(
  browserId: AccountImportBrowserId,
  profile: ListedImportProfile,
  siteIds: readonly BrowserAccountSiteId[],
  signal: AbortSignal,
  reader?: Pick<BrowserCookieReader, 'fromPath' | 'CancellationHandle'>,
  now: () => number = () => Date.now() / 1000
): Promise<BrowserAccountSource> {
  if (signal.aborted) throw new BrowserAccountError('cancelled')
  let directory: string | undefined
  let cancellation: InstanceType<BrowserCookieReader['CancellationHandle']> | undefined
  const cancel = (): void => {
    cancellation?.cancel()
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const nativeReader =
      reader ?? (await import('./browser-cookie-reader.ts')).browserCookieReader()
    cancellation = new nativeReader.CancellationHandle()
    directory = await mkdtemp(join(tmpdir(), `${COPY_PREFIX}${process.pid}-`))
    liveCopies.add(directory)
    const database = await copyProfileCookies(profile, directory)
    if (signal.aborted) throw new BrowserAccountError('cancelled')
    const result: ReadResult = await nativeReader.fromPath(
      {
        path: database,
        browserId,
        includeExpired: true,
        mollyInventory: true,
        timeoutMs: 5 * 60_000,
        appBound: 'disabled'
      },
      cancellation
    )
    if (signal.aborted) throw new BrowserAccountError('cancelled')
    if (result.warnings.some((warning) => warning.count > 0 || warning.countersSaturated))
      throw new BrowserAccountError('source-incomplete')
    return selectBrowserCookies(result.detailedCookies, siteIds, now())
  } catch (error) {
    if (signal.aborted) throw new BrowserAccountError('cancelled')
    throw browserAccountSourceError(error)
  } finally {
    signal.removeEventListener('abort', cancel)
    if (directory) {
      await rm(directory, { recursive: true, force: true })
      liveCopies.delete(directory)
    }
  }
}
