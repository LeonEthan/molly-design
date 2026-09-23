import type { Cookies } from 'electron'
import type { BrowserImportCookie } from '@molly/shared/browser-import-cookie'
import type { ElectronBrowserAccountSiteInput } from '@molly/shared/electron-ipc'
import { z } from 'zod'
import { hostMatchesSite } from './public-browser-agent-policy.ts'

type Site = ElectronBrowserAccountSiteInput['site']

const storedCookiesSchema = z.object({
  cookies: z.array(
    z.object({
      domain: z.string(),
      partitionKey: z.unknown().optional(),
      partitionKeyOpaque: z.boolean().optional()
    })
  )
})

/** Electron's Cookie API omits CHIPS identity; never use it to back up CHIPS. */
export function assertStoredCookiesUnpartitioned(snapshot: unknown, site: Site): void {
  const checked = storedCookiesSchema.safeParse(snapshot)
  if (!checked.success)
    throw new Error('Molly could not verify existing cookie identities. No cookies were imported.')
  if (
    checked.data.cookies.some(
      (cookie) =>
        hostMatchesSite(cookie.domain.replace(/^\./, ''), site) &&
        (cookie.partitionKey !== undefined || cookie.partitionKeyOpaque)
    )
  )
    throw new Error(
      'Molly already has partitioned cookies for this website. Import was stopped to keep its current sign-in unchanged.'
    )
}

/** Main-only transaction; the complete source is validated before any mutation. */
export async function importChromeAccountCookies({
  store,
  site,
  replaceExisting,
  readSource,
  beforeWrite
}: {
  store: Pick<Cookies, 'get' | 'set' | 'remove' | 'flushStore'>
  site: Site
  replaceExisting: boolean
  readSource: () => Promise<BrowserImportCookie[]>
  beforeWrite: () => Promise<void>
}): Promise<number> {
  let existing = (await store.get({ domain: site })).filter((cookie) =>
    hostMatchesSite((cookie.domain ?? '').replace(/^\./, ''), site)
  )
  if (existing.length > 0 && !replaceExisting)
    throw new Error('This site already has Molly cookies. Confirm replacement before importing.')
  const cookies: BrowserImportCookie[] = await readSource()
  for (const cookie of cookies) {
    const host = cookie.domain.replace(/^\./, '').toLowerCase()
    if (
      !hostMatchesSite(host, site) ||
      !cookie.path.startsWith('/') ||
      ['\r', '\n', '\0'].some((character) => cookie.name.includes(character)) ||
      ['\r', '\n', '\0'].some((character) => cookie.value.includes(character))
    ) {
      throw new Error('Chrome returned a cookie outside the selected site or with invalid fields.')
    }
  }
  await beforeWrite()
  existing = (await store.get({ domain: site })).filter((cookie) =>
    hostMatchesSite((cookie.domain ?? '').replace(/^\./, ''), site)
  )
  if (existing.length > 0 && !replaceExisting)
    throw new Error('Molly sign-in changed during import. Confirm replacement before retrying.')
  let imported = 0
  try {
    if (replaceExisting) {
      for (const cookie of existing) {
        const host = (cookie.domain ?? '').replace(/^\./, '')
        await store.remove(
          `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path}`,
          cookie.name
        )
      }
    }
    for (const cookie of cookies) {
      const host = cookie.domain.replace(/^\./, '')
      await store.set({
        url: `https://${host}${cookie.path}`,
        name: cookie.name,
        value: cookie.value,
        ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        ...(cookie.session ? {} : { expirationDate: cookie.expirationDate })
      })
    }
    await store.flushStore()
    // Source identities have been checked before writing. Report the
    // cookies actually retained, since expired cookies can disappear.
    imported = (await store.get({ domain: site })).filter((cookie) =>
      hostMatchesSite((cookie.domain ?? '').replace(/^\./, ''), site)
    ).length
    if (imported === 0) throw new Error('No usable website cookies were retained.')
  } catch {
    let restored = true
    for (const cookie of cookies) {
      try {
        await store.remove(`https://${cookie.domain.replace(/^\./, '')}${cookie.path}`, cookie.name)
      } catch {
        restored = false
      }
    }
    for (const cookie of existing) {
      const host = (cookie.domain ?? '').replace(/^\./, '')
      try {
        await store.set({
          url: `https://${host}${cookie.path}`,
          name: cookie.name,
          value: cookie.value,
          ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          ...(cookie.session ? {} : { expirationDate: cookie.expirationDate })
        })
      } catch {
        restored = false
      }
    }
    try {
      await store.flushStore()
    } catch {
      restored = false
    }
    throw new Error(
      restored
        ? 'Chrome import failed; Molly restored its previous website cookies.'
        : 'Chrome import failed and Molly could not fully restore its previous website cookies. Sign in again in Molly.'
    )
  }
  return imported
}
