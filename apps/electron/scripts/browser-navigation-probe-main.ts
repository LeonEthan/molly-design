import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, type WebContentsView } from 'electron'
import { PublicBrowserService } from '../src/main/services/public-browser-service'
import type { AgentBrowserCommand, AgentBrowserScope } from '@molly/shared/browser-agent-rpc'

declare const PROBE_OUTPUT: string
const checks: string[] = []
const record = (check: string): void => {
  checks.push(check)
  console.log(`PASS: ${check}`)
}
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY5kAAAAASUVORK5CYII=',
  'base64'
)
app.setPath('userData', join(PROBE_OUTPUT, 'profile'))
app.on('window-all-closed', () => {})

async function main(): Promise<void> {
  await app.whenReady()
  let port = 0
  const server = createServer((request, response) => {
    if (request.url === '/pixel.png') {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(png)
      return
    }
    if (request.url === '/download') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="native-download.bin"'
      })
      response.end('Native download fixture')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(
      request.url === '/next'
        ? '<!doctype html><title>Next site</title><h1>Next site</h1>'
        : `<!doctype html><title>Native research</title><h1>Native research</h1>
        <label>Search designs <input id="search"></label><button onclick="document.querySelector('h1').textContent='Results for '+document.querySelector('#search').value">Search</button>
        <input type="password" aria-label="Password">
        <a href="http://localhost:${port}/next">Visit next site</a>
        <img alt="Reference image" src="/pixel.png">`
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  port = address.port
  const host = new BrowserWindow({ width: 1000, height: 800, show: false })
  await host.loadURL('data:text/html,<h1>PRIVATE_APP_SENTINEL</h1>')
  host.showInactive()
  let pausePending: Promise<AgentBrowserScope[]> | undefined
  const browser = new PublicBrowserService(
    () => host,
    async () => pausePending ?? []
  )
  const scope = {
    sessionId: 'native-probe',
    browserId: 'session-browser-native-probe',
    runId: 'probe-run'
  }
  const created = browser.create(scope.browserId, { x: 0, y: 0, width: 900, height: 700 })
  assert.equal(created.ok, true)
  const execute = (command: AgentBrowserCommand) => browser.executeAgentCommand(scope, command)
  const snapshot = async (): Promise<string> => {
    const reply = await execute({ kind: 'snapshot' })
    assert.equal(reply.kind, 'snapshot')
    if (reply.kind !== 'snapshot') throw new Error('Missing native snapshot')
    assert.doesNotMatch(reply.snapshot, /PRIVATE_APP_SENTINEL/)
    return reply.snapshot
  }
  const ref = (text: string, label: string): string => {
    const line = text
      .split('\n')
      .find((candidate) => candidate.includes(label) && candidate.includes('[ref='))
    const reference = line?.match(/\[ref=([^\]]+)\]/)?.[1]
    assert.ok(reference, `Missing reference ${label}`)
    return reference
  }
  const records = Reflect.get(browser, 'records') as Map<string, { view: WebContentsView }>
  const view = records.get(scope.browserId)!.view
  await execute({ kind: 'navigate', url: `http://127.0.0.1:${port}/start` })
  assert.match(await snapshot(), /Native research/)
  record('Native Agent localhost navigation and observation work through the page service')
  await view.webContents.executeJavaScript('document.querySelector("img").decode()')
  const initial = await snapshot()
  await execute({ kind: 'type', ref: ref(initial, 'textbox "Search designs"'), text: 'poster' })
  await execute({ kind: 'click', ref: ref(initial, 'button "Search"') })
  assert.match(await snapshot(), /Results for poster/)
  record('Official MCP input and click retain page ownership and native readiness')
  await assert.rejects(
    execute({ kind: 'type', ref: ref(await snapshot(), 'textbox "Password"'), text: 'fixture' }),
    /password/
  )
  record('Password typing remains a takeover-only operation')
  assert.equal(await view.webContents.executeJavaScript('typeof RTCPeerConnection'), 'function')
  record('WebRTC is available in the native page')
  const image = await execute({
    kind: 'save_image',
    ref: ref(await snapshot(), 'img "Reference image"')
  })
  assert.equal(image.kind, 'asset')
  if (image.kind !== 'asset') throw new Error('Missing selected image bytes')
  assert.deepEqual(Buffer.from(image.base64, 'base64'), png)
  record('Selected loaded IMG bytes use the native browser Session transport')
  const capture = await execute({ kind: 'screenshot' })
  assert.equal(capture.kind, 'image')
  if (capture.kind !== 'image') throw new Error('Missing native screenshot')
  assert.equal(Buffer.from(capture.base64, 'base64').subarray(0, 3).toString('hex'), 'ffd8ff')
  record('Native screenshot returns bounded JPEG bytes')
  await execute({ kind: 'click', ref: ref(await snapshot(), 'link "Visit next site"') })
  assert.match(await snapshot(), /Next site/)
  assert.equal(view.webContents.getURL(), `http://localhost:${port}/next`)
  record('A page link can cross the former top-level site boundary')
  const file = join(PROBE_OUTPUT, 'native-page.html')
  writeFileSync(file, '<!doctype html><title>Native file</title><h1>Native file</h1>')
  await execute({ kind: 'navigate', url: pathToFileURL(file).href })
  assert.match(await snapshot(), /Native file/)
  await execute({ kind: 'navigate', url: 'data:text/html,<h1>Native data page</h1>' })
  assert.match(await snapshot(), /Native data page/)
  record('File and data navigation use native browser behavior')
  browser.takeAgentControl(scope.browserId)
  await assert.rejects(execute({ kind: 'snapshot' }), /taken control/)
  browser.resumeAgentControl(scope.browserId, scope.runId)
  assert.match(await snapshot(), /Native data page/)
  record('Takeover revokes reads and explicit resume observes the retained page')
  browser.destroy(scope.browserId)
  await assert.rejects(execute({ kind: 'snapshot' }), /closed/)
  record('Closing the page prevents same-run recreation')

  assert.equal(browser.create('human-download', { x: 0, y: 0, width: 900, height: 700 }).ok, true)
  const human = records.get('human-download')!.view.webContents
  await human.loadURL('about:blank')
  const destination = join(PROBE_OUTPUT, 'native-download.bin')
  const downloaded = new Promise<void>((resolve, reject) => {
    human.session.once('will-download', (event, item) => {
      assert.equal(event.defaultPrevented, false)
      item.setSavePath(destination)
      item.once('done', (_event, state) =>
        state === 'completed' ? resolve() : reject(new Error(`Download ${state}`))
      )
    })
  })
  human.downloadURL(`http://127.0.0.1:${port}/download`)
  await downloaded
  assert.equal(readFileSync(destination, 'utf8'), 'Native download fixture')
  record('Normal native downloads are available and remain separate from design assets')

  const retainedScope = {
    sessionId: 'sign-in-probe',
    browserId: 'session-browser-sign-in-probe',
    runId: 'probe-before-sign-in'
  }
  await browser.executeAgentCommand(retainedScope, {
    kind: 'navigate',
    url: 'data:text/html,<h1>Retained Session page</h1>'
  })
  const retainedView = records.get(retainedScope.browserId)!.view
  const retainedSnapshot = async (runId: string): Promise<void> => {
    assert.equal(records.get(retainedScope.browserId)?.view, retainedView)
    assert.equal(retainedView.webContents.isDestroyed(), false)
    const reply = await browser.executeAgentCommand(
      { ...retainedScope, runId },
      { kind: 'snapshot' }
    )
    assert.equal(reply.kind, 'snapshot')
    if (reply.kind !== 'snapshot') throw new Error('Missing retained Session snapshot')
    assert.match(reply.snapshot, /Retained Session page/)
  }
  const signInId = 'website-sign-in-pinterest.com'
  const createSignIn = async () => {
    await browser.beginAccountSignIn(signInId)
    assert.equal(browser.create(signInId, { x: 0, y: 0, width: 900, height: 700 }).ok, true)
    const contents = records.get(signInId)!.view.webContents
    await contents.loadURL('data:text/html,<h1>Synthetic website sign-in</h1>')
    return contents
  }
  const signInContents = await createSignIn()
  const originalSignInClose = signInContents.close.bind(signInContents)
  let closeReturned = false
  let destroyedAfterCloseReturned = false
  signInContents.once('destroyed', () => {
    destroyedAfterCloseReturned = closeReturned
  })
  signInContents.close = (options) => {
    originalSignInClose(options)
    closeReturned = true
  }
  const signInDestroyed = once(signInContents, 'destroyed')
  await host.loadURL('data:text/html,<h1>Reloaded private app</h1>')
  await signInDestroyed
  assert.equal(signInContents.isDestroyed(), true)
  assert.equal(browser.getState(signInId), null)
  await retainedSnapshot('probe-after-sign-in-reload')
  console.log(`SIGN_IN_CLOSE_OBSERVATION: ${JSON.stringify({ destroyedAfterCloseReturned })}`)
  record(
    'Host navigation destroys the native sign-in view and retains the Session page for a new run'
  )

  const delayedSignInContents = await createSignIn()
  const originalDelayedClose = delayedSignInContents.close.bind(delayedSignInContents)
  const delayedCloseRequested = Promise.withResolvers<void>()
  delayedSignInContents.close = () => delayedCloseRequested.resolve()
  const delayedSignInDestroyed = once(delayedSignInContents, 'destroyed')
  await host.loadURL('data:text/html,<h1>Reloaded during delayed sign-in close</h1>')
  await delayedCloseRequested.promise
  assert.equal(delayedSignInContents.isDestroyed(), false)
  await assert.rejects(
    browser.executeAgentCommand(
      { ...retainedScope, runId: 'probe-during-sign-in-close' },
      { kind: 'snapshot' }
    ),
    /signs in/
  )
  delayedSignInContents.close = originalDelayedClose
  originalDelayedClose()
  await delayedSignInDestroyed
  assert.equal(delayedSignInContents.isDestroyed(), true)
  await retainedSnapshot('probe-after-delayed-sign-in-close')
  record('Agent access remains held until the native sign-in WebContents destroyed event')

  const pause = Promise.withResolvers<AgentBrowserScope[]>()
  pausePending = pause.promise
  const pendingSignIn = browser.beginAccountSignIn(signInId)
  await assert.rejects(
    browser.executeAgentCommand(
      { ...retainedScope, runId: 'probe-during-sign-in-pause' },
      { kind: 'snapshot' }
    ),
    /signs in/
  )
  await host.loadURL('data:text/html,<h1>Reloaded during pending sign-in pause</h1>')
  pause.resolve([])
  await pendingSignIn
  pausePending = undefined
  assert.equal(browser.create(signInId, { x: 0, y: 0, width: 900, height: 700 }).ok, false)
  assert.equal(browser.getState(signInId), null)
  await retainedSnapshot('probe-after-pending-sign-in-reload')
  record('Host navigation retires a pending sign-in and rejects its late native view creation')
  browser.destroyAll()
  host.destroy()
  server.closeAllConnections()
  server.close()
  writeFileSync(
    join(PROBE_OUTPUT, 'result.json'),
    JSON.stringify({ ok: true, checks, versions: process.versions }, null, 2)
  )
}

main().then(
  () => app.exit(0),
  (error) => {
    console.error(error)
    writeFileSync(
      join(PROBE_OUTPUT, 'result.json'),
      JSON.stringify({ ok: false, checks, error: String(error) }, null, 2)
    )
    app.exit(1)
  }
)
