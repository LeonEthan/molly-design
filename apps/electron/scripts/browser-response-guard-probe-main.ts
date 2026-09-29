import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, type WebContents } from 'electron'
import { PublicBrowserAgentController } from '../src/main/services/public-browser-agent-controller.ts'

declare const PROBE_OUTPUT: string
type ProbeLease = {
  contents: Pick<WebContents, 'id' | 'isDestroyed' | 'stop'>
  disposed: boolean
  networkError: string | null
  verifiedDocuments: Set<string>
  ready: boolean
}
const record = (event: string): void => {
  const line = JSON.stringify({ event, pid: process.pid })
  appendFileSync(join(PROBE_OUTPUT, 'events.jsonl'), `${line}\n`)
  console.log(line)
}
app.setPath('userData', join(PROBE_OUTPUT, 'profile'))
app.commandLine.appendSwitch('disable-background-networking')
app.on('window-all-closed', () => {})

async function main(): Promise<void> {
  await app.whenReady()
  record('ready')
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html',
      'content-security-policy': "default-src 'none'"
    })
    response.flushHeaders()
    response.write('<!doctype html><title>Response guard fixture</title><p>Loopback only</p>')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  const contents = window.webContents
  await contents.loadURL('about:blank')
  const controller = new PublicBrowserAgentController()
  const lease: ProbeLease = {
    contents,
    disposed: false,
    networkError: null,
    verifiedDocuments: new Set(['https://previous-public-document.example/']),
    ready: true
  }
  const leases: Map<number, ProbeLease> = Reflect.get(controller, 'leases')
  const observeNetwork: (lease: ProbeLease, method: string, params: unknown) => void = Reflect.get(
    controller,
    'observeNetwork'
  ).bind(controller)
  const assertReadable: (lease: ProbeLease) => void = Reflect.get(
    controller,
    'assertReadable'
  ).bind(controller)
  leases.set(contents.id, lease)
  contents.debugger.attach('1.3')
  await contents.debugger.sendCommand('Network.enable')
  await contents.debugger.sendCommand('Network.setCacheDisabled', { cacheDisabled: true })
  await contents.debugger.sendCommand('Network.setBypassServiceWorker', { bypass: true })
  const stopped = once(contents, 'did-stop-loading')
  let received = false
  const guarded = new Promise<void>((accept, reject) => {
    contents.debugger.on('message', (_event, method, params) => {
      if (method !== 'Network.responseReceived' || params.type !== 'Document' || received) return
      received = true
      try {
        record('response-received')
        observeNetwork(lease, method, params)
        assert.equal(lease.networkError, 'The browser could not verify a public response peer.')
        assert.throws(() => assertReadable(lease), /verify a public response peer/)
        record('read-denied-synchronously')
        setImmediate(accept)
      } catch (error) {
        reject(error)
      }
    })
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const navigation = contents.loadURL(`http://127.0.0.1:${address.port}/fixture`)
  const navigationResult = navigation.then(
    () => ({ completed: true, errno: 0 }),
    (error: Error & { errno: number }) => ({ completed: false, errno: error.errno })
  )
  await guarded
  await stopped
  assert.equal(lease.ready, false)
  assert.equal(lease.verifiedDocuments.size, 0)
  assert.equal(contents.isLoading(), false)
  assert.equal(contents.isDestroyed(), false)
  assert.deepEqual(await navigationResult, { completed: false, errno: -3 })
  record('survived-response-stop')
  for (const retired of ['revoked', 'replaced', 'destroyed', 'new-navigation']) {
    let destroyed = false
    const inactive: ProbeLease = {
      contents: {
        id: -1,
        isDestroyed: () => destroyed,
        stop: () => {
          throw new Error(`Deferred stop reached ${retired} lease`)
        }
      },
      disposed: false,
      networkError: null,
      verifiedDocuments: new Set(),
      ready: true
    }
    leases.set(inactive.contents.id, inactive)
    observeNetwork(inactive, 'Network.responseReceived', {
      requestId: retired,
      type: 'Document',
      response: { url: 'http://127.0.0.1/fixture', remoteIPAddress: '127.0.0.1' }
    })
    if (retired === 'revoked') inactive.disposed = true
    if (retired === 'replaced') leases.set(inactive.contents.id, { ...inactive })
    if (retired === 'destroyed') destroyed = true
    if (retired === 'new-navigation') inactive.networkError = null
    await new Promise<void>((accept) => setImmediate(accept))
    record(`ignored-${retired}-lease`)
  }
  const result = { ok: true, navigation: await navigationResult, versions: process.versions }
  writeFileSync(join(PROBE_OUTPUT, 'result.json'), JSON.stringify(result, null, 2))
  window.destroy()
  server.closeAllConnections()
  server.close()
}

main().then(
  () => app.exit(0),
  (error) => {
    console.error(error)
    writeFileSync(
      join(PROBE_OUTPUT, 'result.json'),
      JSON.stringify({ ok: false, error: String(error) })
    )
    app.exit(1)
  }
)
