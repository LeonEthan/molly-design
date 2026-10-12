import assert from 'node:assert/strict'
import { once } from 'node:events'
import { app, WebContentsView, session } from 'electron'
import { isolateBrowserAccounts } from '../src/main/services/browser-account-isolation'
import {
  importBrowserAccountCookies,
  type StoredBrowserCookie
} from '../src/main/services/browser-account-import'
import type { BrowserImportCookie } from '@molly/shared/browser-import-cookie'

const temporary = process.env.MOLLY_BROWSER_ACCOUNT_PROBE_DIRECTORY
if (!temporary) throw new Error('Synthetic probe directory required')
app.setPath('userData', temporary)
const deadline = setTimeout(() => {
  console.error('Synthetic browser account probe did not complete')
  app.exit(2)
}, 30_000)
const sourceCookie = (patch: Partial<BrowserImportCookie> = {}): BrowserImportCookie => ({
  name: 'trigger',
  value: 'synthetic',
  domain: 'molly-probe.invalid',
  path: '/',
  hostOnly: true,
  secure: true,
  httpOnly: false,
  session: true,
  sameSite: 'lax',
  sourceScheme: 'Secure',
  sourcePort: 443,
  ...patch
})
const checks: string[] = []

async function workerProbe(stopped: boolean, clearWhilePaused = false): Promise<void> {
  const browserSession = session.fromPartition(`synthetic-worker-${stopped}-${clearWhilePaused}`)
  const script =
    "self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('cookiechange',e=>{for(const c of e.changed)if(c.name==='trigger')e.waitUntil(cookieStore.set({name:'worker_written',value:c.value,path:'/'}))});"
  browserSession.protocol.handle(
    'https',
    (request) =>
      new Response(
        new URL(request.url).pathname === '/sw.js'
          ? script
          : '<!doctype html><title>Synthetic cookie isolation</title>',
        {
          headers: {
            'Content-Type':
              new URL(request.url).pathname === '/sw.js' ? 'application/javascript' : 'text/html'
          }
        }
      )
  )
  const page = new WebContentsView({
    webPreferences: { session: browserSession, sandbox: true, contextIsolation: true }
  })
  await page.webContents.loadURL('https://molly-probe.invalid/')
  await page.webContents.executeJavaScript(
    "(async()=>{await navigator.serviceWorker.register('/sw.js');const r=await navigator.serviceWorker.ready;await r.cookies.subscribe([{name:'trigger',url:location.origin+'/'}])})()"
  )
  if (stopped) {
    page.webContents.debugger.attach('1.3')
    await page.webContents.debugger.sendCommand('ServiceWorker.enable')
    await page.webContents.debugger.sendCommand('ServiceWorker.stopAllWorkers')
    page.webContents.debugger.detach()
  }
  const destroyed = once(page.webContents, 'destroyed')
  page.webContents.close()
  await destroyed
  browserSession.webRequest.onBeforeRequest((_request, callback) => callback({ cancel: true }))
  browserSession.webRequest.onHeadersReceived((_response, callback) => callback({ cancel: true }))
  const isolation = await isolateBrowserAccounts(browserSession)
  const written = new Promise<void>((resolve) =>
    browserSession.cookies.on('changed', (_event, cookie) => {
      if (cookie.name === 'worker_written') resolve()
    })
  )
  await importBrowserAccountCookies(isolation.store, [sourceCookie()])
  assert.deepEqual(
    (await browserSession.cookies.get({})).map((cookie) => cookie.name),
    ['trigger']
  )
  if (clearWhilePaused) {
    await browserSession.clearStorageData()
    await browserSession.clearCache()
    await browserSession.clearAuthCache()
    await browserSession.cookies.flushStore()
    await isolation.release()
    assert.deepEqual(await browserSession.cookies.get({}), [])
    checks.push('All website data clears while registered Workers are paused')
    return
  }
  await isolation.release()
  await written
  assert.equal(
    (await browserSession.cookies.get({ name: 'worker_written' }))[0]?.value,
    'synthetic'
  )
  browserSession.webRequest.onBeforeRequest(null)
  browserSession.webRequest.onHeadersReceived(null)
  await browserSession.clearStorageData()
  checks.push(
    `Cookie Store writes held until release (${stopped ? 'stopped' : 'running'} service worker)`
  )
}

async function rollbackProbe(): Promise<void> {
  const browserSession = session.fromPartition('synthetic-rollback')
  const isolation = await isolateBrowserAccounts(browserSession)
  const original: StoredBrowserCookie = {
    name: 'same',
    value: 'original',
    domain: '.example.test',
    path: '/',
    secure: true,
    httpOnly: true,
    session: true,
    expires: -1,
    size: 12,
    sameSite: 'Strict',
    priority: 'High',
    sourceScheme: 'Secure',
    sourcePort: 8443
  }
  await isolation.store.set(original)
  await isolation.store.set({ ...original, path: '/account', value: 'path-preserved' })
  await isolation.store.set({ ...original, domain: 'example.test', value: 'host-preserved' })
  await isolation.store.set({
    ...original,
    name: 'partitioned',
    partitionKey: { topLevelSite: 'https://other.test', hasCrossSiteAncestor: true }
  })
  const before = await isolation.store.snapshot()
  const store = {
    ...isolation.store,
    set: async (cookie: StoredBrowserCookie): Promise<void> => {
      if (cookie.name === 'rejected') throw new Error('Synthetic write failure')
      await isolation.store.set(cookie)
    }
  }
  await assert.rejects(
    importBrowserAccountCookies(store, [
      sourceCookie({ name: 'same', domain: '.example.test', hostOnly: false }),
      sourceCookie({ name: 'rejected', domain: '.example.test', hostOnly: false })
    ]),
    { message: 'write-restored' }
  )
  const normalized = (rows: StoredBrowserCookie[]): string[] =>
    rows.map((row) => JSON.stringify(row)).sort()
  assert.deepEqual(normalized(await isolation.store.snapshot()), normalized(before))
  await isolation.release()
  checks.push('Exact rollback preserves sibling paths, host-only cookies, CHIPS and metadata')
}

void app
  .whenReady()
  .then(async () => {
    await workerProbe(false)
    await workerProbe(true)
  await workerProbe(false, true)
    await rollbackProbe()
    console.log(
      JSON.stringify({
        ok: true,
        checks,
        versions: { electron: process.versions.electron, chrome: process.versions.chrome }
      })
    )
    clearTimeout(deadline)
    app.exit(0)
  })
  .catch((error: unknown) => {
    console.error(error)
    clearTimeout(deadline)
    app.exit(1)
  })
