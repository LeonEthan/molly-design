/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native integration probe outside the product build. */
import { app, BrowserWindow, WebContentsView, session, net } from 'electron'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { BrowserMcpDriver, browserMcpSnapshot } from '../src/main/services/browser-mcp-driver'
import { PublicBrowserAgentController } from '../src/main/services/public-browser-agent-controller'
import { fetchSelectedBrowserImage } from '../src/main/services/public-browser-asset-fetch'

declare const PROBE_OUTPUT: string
const checks: string[] = []
const record = (message: string) => {
  checks.push(message)
  console.log(`PASS: ${message}`)
}
app.setPath('userData', join(PROBE_OUTPUT, 'temporary-profile'))
app.on('window-all-closed', () => {})

async function main() {
  await app.whenReady()
  const isolated = session.fromPartition('molly-driver-probe-memory')
  await isolated.setProxy({ mode: 'direct' })
  isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  isolated.on('will-download', (event) => event.preventDefault())
  const pageUrl = 'https://design-probe.test/search'
  const imageUrl =
    'https://raw.githubusercontent.com/github/explore/main/topics/typescript/typescript.png'
  isolated.protocol.handle('https', (request) =>
    request.url !== pageUrl
      ? net.fetch(request.url, { bypassCustomProtocolHandlers: true })
      : new Response(
          `<!doctype html><title>Design search</title><h1>Design search</h1><label>Search designs <input></label><button>Search</button><main></main><script>
    document.querySelector('button').onclick=()=>{document.querySelector('main').innerHTML='<h2>Results for '+document.querySelector('input').value+'</h2><img alt="Design image" src="${imageUrl}">';};
    </script>`,
          { headers: { 'content-type': 'text/html' } }
        )
  )
  const host = new BrowserWindow({ width: 1000, height: 800, show: false })
  await host.loadURL('data:text/html,<h1>PRIVATE_APP_SENTINEL</h1>')
  const view = new WebContentsView({
    webPreferences: {
      session: isolated,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  host.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 1000, height: 760 })
  await view.webContents.loadURL(pageUrl)
  host.showInactive()
  const pageId = view.webContents.id
  let active = true
  let dispatching = false
  const blockInput = (event: Electron.Event) => {
    if (!dispatching) event.preventDefault()
  }
  view.webContents.on('before-input-event', blockInput)
  view.webContents.on('before-mouse-event', blockInput)
  const driver = new BrowserMcpDriver(view.webContents, {
    assertActive: () => {
      if (!active) throw new Error('Agent browser control was revoked.')
    },
    beforeNavigate: async (url) => {
      assert.equal(url, pageUrl)
    },
    observeNetwork: () => {},
    detached: () => {
      active = false
    },
    dispatchInput: (send) => {
      dispatching = true
      try {
        return send()
      } finally {
        dispatching = false
      }
    }
  })
  await driver.connect()
  const snapshot = async () => {
    const response = await driver.execute({ kind: 'snapshot' })
    assert.equal(response.kind, 'tool')
    if (response.kind !== 'tool') throw new Error('Missing snapshot')
    const text = browserMcpSnapshot(response.result)
    assert.doesNotMatch(text, /PRIVATE_APP_SENTINEL/)
    return text
  }
  const ref = (text: string, label: string) => {
    const line = text.split('\n').find((line) => line.includes(label) && line.includes('[ref='))
    assert.ok(line, `Missing reference ${label}`)
    return line.match(/\[ref=([^\]]+)\]/)![1]
  }
  const initial = await snapshot()
  await driver.execute({ kind: 'type', ref: ref(initial, 'textbox'), text: 'poster' })
  await driver.execute({ kind: 'click', ref: ref(initial, 'button') })
  const after = await snapshot()
  assert.match(after, /Results for poster/)
  assert.equal(view.webContents.id, pageId)
  record(
    'Product MCP driver types and clicks with human-input guards on the original WebContentsView'
  )
  const screenshot = await driver.execute({ kind: 'screenshot' })
  assert.equal(screenshot.kind, 'tool')
  if (screenshot.kind === 'tool') {
    const part = screenshot.result.content.find((part) => part.type === 'image')
    assert.ok(part?.type === 'image' && part.mimeType === 'image/jpeg')
    await writeFile(join(PROBE_OUTPUT, 'screenshot.jpg'), Buffer.from(part.data, 'base64'))
  }
  record('Official MCP screenshot returns JPEG bytes')
  // An explicit fixture load signal, not a sleep or relaxed production guard.
  await view.webContents.executeJavaScript('document.querySelector("img").decode()')
  const selected = await driver.execute({ kind: 'save_image', ref: ref(await snapshot(), 'img') })
  assert.equal(selected.kind, 'image')
  if (selected.kind !== 'image') throw new Error('Missing image metadata')
  const saved = await fetchSelectedBrowserImage({
    browserSession: isolated,
    pageUrl: selected.image.pageUrl,
    imageUrl: selected.image.imageUrl,
    sites: ['design-probe.test'],
    signal: new AbortController().signal
  })
  assert.equal(Buffer.from(saved.bytes).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  await writeFile(join(PROBE_OUTPUT, 'selected-image.png'), saved.bytes)
  record(
    'Production driver resolves an upstream image ref for the existing controlled asset reader'
  )

  // Remove only the fixture protocol. Subsequent controller navigation uses real
  // DNS, Chromium traffic and response peers; no policy or driver substitution.
  isolated.protocol.unhandle('https')
  active = false
  await driver.dispose()
  await assert.rejects(driver.execute({ kind: 'snapshot' }), /revoked|unavailable/)
  assert.equal(view.webContents.debugger.isAttached(), false)
  record('Revocation detaches the production adapter and rejects subsequent reads')
  view.webContents.off('before-input-event', blockInput)
  view.webContents.off('before-mouse-event', blockInput)
  const controller = new PublicBrowserAgentController()
  const scope = {
    runId: 'native-probe-run',
    browserId: 'session-browser-native-probe',
    sites: ['example.com'],
    sessionId: 'native-probe-session'
  }
  await controller.execute(view.webContents, scope, {
    kind: 'navigate',
    url: 'https://example.com/'
  })
  const observed = await controller.execute(view.webContents, scope, { kind: 'snapshot' })
  assert.equal(observed.kind, 'text')
  if (observed.kind === 'text') assert.match(observed.text, /Example Domain/)
  record(
    'Production controller navigates and reads a real public response through its unchanged network guard'
  )
  await assert.rejects(
    controller.execute(view.webContents, scope, { kind: 'navigate', url: 'http://127.0.0.1/' }),
    /public|local|private/
  )
  controller.revokeAll()
  assert.equal(controller.hasLease(view.webContents), false)
  record('Production controller rejects private navigation and revokes its lease')
  await writeFile(
    join(PROBE_OUTPUT, 'result.json'),
    JSON.stringify({ ok: true, checks, versions: process.versions }, null, 2)
  )
  view.webContents.close()
  host.destroy()
}
main()
  .then(() => app.quit())
  .catch(async (error) => {
    console.error(error)
    await mkdir(PROBE_OUTPUT, { recursive: true })
    await writeFile(
      join(PROBE_OUTPUT, 'result.json'),
      JSON.stringify({ ok: false, checks, error: String(error) }, null, 2)
    )
    app.exit(1)
  })
