/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type -- Isolated probe for dynamically loaded upstream contracts, outside the product build. */
// Throwaway integration evidence: no product runtime imports except the existing asset reader.
import { app, BrowserWindow, WebContentsView, session, net } from 'electron'
import { createRequire } from 'node:module'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { CDPBrowserProxy } from 'vscode:src/vs/platform/browserView/common/cdp/proxy.ts'
import { BrowserViewDebugger } from 'vscode:src/vs/platform/browserView/electron-main/browserViewDebugger.ts'
import { BrowserViewCDPTarget } from 'vscode:src/vs/platform/browserView/electron-main/browserViewCDPTarget.ts'
import { fetchSelectedBrowserImage } from '../src/main/services/public-browser-asset-fetch'

declare const PROBE_DEPENDENCIES: string
declare const PROBE_OUTPUT: string
const requireProbe = createRequire(join(PROBE_DEPENDENCIES, 'package.json'))
const { chromium } = requireProbe('playwright')
const { createConnection } = requireProbe('@playwright/mcp')
const { Client } = requireProbe('@modelcontextprotocol/sdk/client/index.js')
const { InMemoryTransport } = requireProbe('@modelcontextprotocol/sdk/inMemory.js')
const pageUrl = 'https://design-probe.test/search'
const imageUrl =
  'https://raw.githubusercontent.com/github/explore/main/topics/typescript/typescript.png'
const report: Record<string, unknown> = {
  versions: {
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    mcp: '0.0.82',
    playwright: requireProbe('playwright/package.json').version
  },
  checks: []
}
const checks = report.checks as string[]
const calls: unknown[] = []
const record = (message: string) => {
  checks.push(message)
  console.log(`PASS: ${message}`)
}
const userData = join(PROBE_OUTPUT, 'temporary-profile')
app.setPath('userData', userData)
app.on('window-all-closed', () => {})

async function main() {
  await app.whenReady()
  const isolated = session.fromPartition('molly-mcp-probe-memory')
  await isolated.setProxy({ mode: 'direct' })
  isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  isolated.on('will-download', (event) => event.preventDefault())
  const fixture = `<!doctype html><title>Design search probe</title><style>body{font:20px system-ui;padding:40px;background:#f5f2eb}input,button{font:inherit;padding:10px}img{width:220px}article{padding:20px;background:white;margin-top:24px;width:300px}</style>
    <h1>Design search</h1><form><label>Search designs <input name="q"></label><button>Search</button></form><main></main>
    <script>
      window.fixtureReady = new Promise(resolve => {
        window.fixtureWorker = new Worker(URL.createObjectURL(new Blob(["postMessage('ready')"], {type:'text/javascript'})));
        window.fixtureWorker.onmessage = () => resolve(true);
      });
      document.querySelector('form').onsubmit = event => {
        event.preventDefault();
        const query = new FormData(event.target).get('q');
        document.querySelector('main').innerHTML = '<h2></h2><article><img alt="Selected design image" src="${imageUrl}"><p>Design reference</p><button>Choose image</button></article>';
        document.querySelector('h2').textContent = 'Results for '+query;
        document.querySelector('article button').onclick = event => { event.target.textContent = 'Saved selection'; };
      };
    </script>`
  isolated.protocol.handle('https', (request) => {
    if (request.url === imageUrl)
      return net.fetch(request.url, { bypassCustomProtocolHandlers: true })
    if (request.url === pageUrl)
      return new Response(fixture, { headers: { 'content-type': 'text/html' } })
    if (request.url === 'https://molly-probe.test/app')
      return new Response('<title>Excluded app renderer</title><h1>APP_PRIVATE_SENTINEL</h1>', {
        headers: { 'content-type': 'text/html' }
      })
    return new Response('Not a probe fixture', { status: 404 })
  })
  const host = new BrowserWindow({
    width: 1000,
    height: 800,
    show: false,
    webPreferences: {
      session: isolated,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  await host.loadURL('https://molly-probe.test/app')
  const contents = new WebContentsView({
    webPreferences: {
      session: isolated,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  host.contentView.addChildView(contents)
  contents.setBounds({ x: 0, y: 0, width: 1000, height: 760 })
  await contents.webContents.loadURL(pageUrl)
  await contents.webContents.executeJavaScript('window.fixtureReady')
  host.showInactive()
  const initialId = contents.webContents.id
  // Electron 39 lacks VS Code's getOrCreateDevToolsTargetId method. Adapt that
  // one accessor using the existing CDP API; do not patch Electron or upstream.
  contents.webContents.debugger.attach('1.3')
  const { targetInfo } = await contents.webContents.debugger.sendCommand('Target.getTargetInfo')
  const version = await contents.webContents.debugger.sendCommand('Browser.getVersion')
  contents.webContents.debugger.detach()
  const view: any = {
    id: 'authorized-fixture',
    session: { id: 'molly-probe-context' },
    webContents: {
      debugger: contents.webContents.debugger,
      isDestroyed: () => contents.webContents.isDestroyed(),
      emit: (...args: any[]) => contents.webContents.emit(...args),
      getOrCreateDevToolsTargetId: () => targetInfo.targetId
    }
  }
  view.debugger = new BrowserViewDebugger(view)
  const denied = () => {
    throw new Error('Probe only permits the existing authorized page')
  }
  const proxy = new CDPBrowserProxy({
    targetInfo: {
      targetId: 'molly-probe-browser',
      type: 'browser',
      title: '',
      url: '',
      attached: true,
      canAccessOpener: false
    },
    getVersion: () => version,
    getBrowserContexts: () => [],
    getWindowForTarget: () => ({
      windowId: host.id,
      bounds: { left: 0, top: 0, width: 1000, height: 760, windowState: 'normal' }
    }),
    createBrowserContext: denied,
    disposeBrowserContext: denied,
    createTarget: denied,
    activateTarget: async () => undefined,
    closeTarget: denied
  })
  const targets: any[] = []
  const register = (info: any) => {
    const target = new BrowserViewCDPTarget(view, info)
    targets.push(target)
    proxy.registerTarget(target)
  }
  view.debugger.onTargetDiscovered((info: any) => {
    if (['iframe', 'worker'].includes(info.type)) register(info)
  })
  view.debugger.onSessionCreated(({ session, waitingForDebugger }: any) =>
    proxy.notifySessionCreated(session, waitingForDebugger)
  )
  register(targetInfo)
  const transport: any = {
    send: (message: any) => {
      void proxy.sendMessage(message)
    },
    close() {
      subscription.dispose()
      this.onclose?.()
    }
  }
  const subscription = proxy.onMessage((message: any) => transport.onmessage?.(message))
  const browser = await chromium.connectOverCDP(transport, { timeout: 15000 })
  const context = browser.contexts()[0]
  assert.equal(context.pages().length, 1)
  assert.equal(context.pages()[0].url(), pageUrl)
  record(
    'Playwright connects to the existing WebContentsView through the unchanged VS Code proxy; no CDP listener'
  )
  const server = await createConnection(
    {
      browser: { browserName: 'chromium' },
      webmcp: false,
      saveSession: false,
      outputDir: join(PROBE_OUTPUT, 'mcp-output'),
      imageResponses: 'allow',
      timeouts: { action: 5000, navigation: 10000, settle: 0, idle: 0 }
    },
    async () => context
  )
  const client = new Client({ name: 'molly-isolated-probe', version: '1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  const tools = await client.listTools()
  await writeFile(join(PROBE_OUTPUT, 'tools.json'), JSON.stringify(tools, null, 2))
  async function call(name: string, args: object = {}, allowError = false) {
    const result = await client.callTool({ name, arguments: args })
    calls.push({
      name,
      arguments: args,
      result: {
        ...result,
        content: result.content?.map((part: any) =>
          part.type === 'image'
            ? {
                type: 'image',
                mimeType: part.mimeType,
                bytes: Buffer.from(part.data, 'base64').length
              }
            : part
        )
      }
    })
    if (!allowError) assert.notEqual(result.isError, true, JSON.stringify(result))
    return result
  }
  const text = (result: any) =>
    result.content
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text)
      .join('\n')
  const ref = (snapshot: string, label: string) => {
    const line = snapshot.split('\n').find((line) => line.includes(label) && line.includes('[ref='))
    assert.ok(line, `Missing snapshot reference: ${label}`)
    return line.match(/\[ref=([^\]]+)\]/)![1]
  }
  const snapshot = text(await call('browser_snapshot'))
  assert.match(snapshot, /Design search/)
  const tabs = text(await call('browser_tabs', { action: 'list' }))
  assert.doesNotMatch(
    tabs + snapshot,
    /APP_PRIVATE_SENTINEL|Excluded app renderer|molly-probe\.test/
  )
  const targetList: any = await proxy.sendCommand('Target.getTargets')
  assert.ok(
    targetList.targetInfos.every(
      (info: any) =>
        info.targetId === targetInfo.targetId || ['iframe', 'worker'].includes(info.type)
    )
  )
  const excludedId = (host.webContents as any).getOrCreateDevToolsTargetId?.()
  host.webContents.debugger.attach('1.3')
  const excludedInfo = await host.webContents.debugger.sendCommand('Target.getTargetInfo')
  host.webContents.debugger.detach()
  await assert.rejects(
    proxy.sendCommand('Target.attachToTarget', {
      targetId: excludedId ?? excludedInfo.targetInfo.targetId,
      flatten: true
    }),
    /Unable to resolve target/
  )
  assert.ok(targetList.targetInfos.some((info: any) => info.type === 'worker'))
  record(
    'MCP lists only the authorized page and its worker; attaching the excluded app renderer is rejected'
  )
  await call('browser_type', { target: ref(snapshot, 'textbox'), text: 'poster design' })
  await call('browser_click', { target: ref(snapshot, 'button "Search"') })
  const results = text(await call('browser_snapshot'))
  assert.match(results, /Results for poster design/)
  const imageRef = ref(results, 'img "Selected design image"')
  await call('browser_click', { target: ref(results, 'button "Choose image"') })
  assert.match(text(await call('browser_snapshot')), /Saved selection/)
  assert.equal(contents.webContents.id, initialId)
  record('Official MCP snapshot references drive typing and clicks in the same embedded page')
  const shot = await call('browser_take_screenshot', { type: 'png', scale: 'css' })
  const png = shot.content.find((part: any) => part.type === 'image')
  assert.ok(png, 'MCP screenshot must return image bytes')
  await writeFile(join(PROBE_OUTPUT, 'screenshot.png'), Buffer.from(png.data, 'base64'))
  record('Official MCP returns a screenshot of the embedded page')
  // This fixed host-owned function is not exposed as agent-authored JavaScript.
  // The upstream tool resolves its own ref; Molly needs no element-reference table.
  const image = text(
    await call('browser_evaluate', {
      target: imageRef,
      function:
        '(element) => ({ tag: element.tagName, imageUrl: element.currentSrc, pageUrl: element.ownerDocument.URL })'
    })
  )
  const metadata = JSON.parse(image.match(/### Result\n([\s\S]*?)(?:\n###|$)/)![1])
  assert.equal(metadata.tag, 'IMG')
  assert.equal(metadata.imageUrl, imageUrl)
  assert.equal(metadata.pageUrl, pageUrl)
  const asset = await fetchSelectedBrowserImage({
    browserSession: isolated,
    imageUrl: metadata.imageUrl,
    pageUrl: metadata.pageUrl,
    sites: ['design-probe.test'],
    signal: new AbortController().signal
  })
  assert.ok(Buffer.from(asset.bytes).subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
  await writeFile(join(PROBE_OUTPUT, 'selected-image.png'), asset.bytes)
  report.asset = {
    bytes: asset.bytes.length,
    sha256: createHash('sha256').update(asset.bytes).digest('hex'),
    url: asset.finalUrl
  }
  record(
    'Upstream image ref resolves through a fixed MCP call and succeeds through the existing guarded asset reader'
  )
  for (const target of targets) target.dispose()
  view.debugger.dispose()
  assert.deepEqual(((await proxy.sendCommand('Target.getTargets')) as any).targetInfos, [])
  await assert.rejects(
    proxy.sendCommand('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: true }),
    /Unable to resolve target/
  )
  const revoked = await call('browser_snapshot', {}, true)
  assert.equal(revoked.isError, true)
  assert.doesNotMatch(text(revoked), /Results for poster design|Saved selection/)
  record('Revocation removes the authorized target and prevents subsequent MCP snapshots')
  await writeFile(join(PROBE_OUTPUT, 'mcp-calls.json'), JSON.stringify(calls, null, 2))
  await client.close()
  await server.close()
  await browser.close()
  proxy.dispose()
  contents.webContents.close()
  host.destroy()
  await isolated.clearStorageData()
  report.status = 'passed'
}
main()
  .then(async () => {
    await writeFile(join(PROBE_OUTPUT, 'result.json'), JSON.stringify(report, null, 2))
    app.exit(0)
  })
  .catch(async (error) => {
    console.error(error)
    report.status = 'failed'
    report.error = String(error)
    await mkdir(PROBE_OUTPUT, { recursive: true })
    await writeFile(join(PROBE_OUTPUT, 'result.json'), JSON.stringify(report, null, 2))
    await writeFile(join(PROBE_OUTPUT, 'mcp-calls.json'), JSON.stringify(calls, null, 2))
    app.exit(1)
  })
