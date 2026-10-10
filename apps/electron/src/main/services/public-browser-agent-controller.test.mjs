import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { compileFunction } from 'node:vm'

const require = createRequire(import.meta.url)
const { build } = createRequire(new URL('../../../../cli/package.json', import.meta.url))('esbuild')
const compiled = await build({
  stdin: {
    contents: `
      export { PublicBrowserAgentController } from './public-browser-agent-controller.ts'
      export { AgentBrowserDriver } from './browser-agent-driver.ts'
    `,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    loader: 'ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  alias: {
    'acp-extension-dsh/capabilities': fileURLToPath(
      new URL('../../../../../packages/acp-extension-dsh/src/capabilities.ts', import.meta.url)
    ),
    '@molly/shared/browser-agent-rpc': fileURLToPath(
      new URL('../../../../../packages/shared/src/browser-agent-rpc.ts', import.meta.url)
    ),
    '@molly/shared/browser-url': fileURLToPath(
      new URL('../../../../../packages/shared/src/browser-url.ts', import.meta.url)
    )
  }
})
const module = { exports: {} }
compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require'])(
  module,
  module.exports,
  (name) => (name === 'electron' ? { app: { isPackaged: false } } : require(name))
)
const { PublicBrowserAgentController, AgentBrowserDriver } = module.exports
const fixtures = new Map()
let nextContentsId = 0

const deferred = () => {
  let resolve
  const promise = new Promise((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}

AgentBrowserDriver.prototype.connect = async function () {
  const contents = Reflect.get(Reflect.get(this, 'connection'), 'contents')
  const fixture = fixtures.get(contents.id)
  Reflect.set(Reflect.get(this, 'runtime'), 'call', (args) => fixture.perform(args))
  fixture.connected.resolve()
}

class BrowserFixture {
  constructor({ url = 'http://192.168.1.10/design', loading = false } = {}) {
    this.controller = new PublicBrowserAgentController()
    this.scope = { sessionId: 'session', browserId: 'browser', runId: 'run' }
    this.connected = deferred()
    this.url = url
    this.loading = loading
    this.contents = Object.assign(new EventEmitter(), {
      id: ++nextContentsId,
      session: {
        resolveProxy: async () => {
          throw new Error('Native proxy preflight was requested')
        }
      },
      debugger: Object.assign(new EventEmitter(), { isAttached: () => false }),
      isDestroyed: () => false,
      isLoadingMainFrame: () => this.loading,
      getURL: () => this.url,
      getTitle: () => 'Native title',
      loadURL: async (nextUrl) => this.navigate(nextUrl)
    })
    fixtures.set(this.contents.id, this)
    this.perform = async ([name, destination]) => {
      if (name === 'open') this.navigate(destination)
      return {
        success: true,
        data: name === 'snapshot' ? { snapshot: '- heading "Native page"' } : {}
      }
    }
  }

  navigate(url) {
    this.loading = true
    this.contents.emit('did-start-navigation', {}, url, false, true)
    this.url = url
    this.ready()
  }

  ready() {
    this.loading = false
    this.contents.emit('dom-ready')
  }

  execute(command) {
    return this.controller.execute(this.contents, this.scope, command)
  }
}

void test('Agent can observe an existing native page without approved sites or response proofs', async () => {
  const fixture = new BrowserFixture()
  const { observationId, ...reply } = await fixture.execute({ kind: 'snapshot' })
  assert.match(observationId, /^[a-f0-9-]{36}$/)
  assert.deepEqual(reply, {
    kind: 'snapshot',
    url: 'http://192.168.1.10/design',
    title: 'Native title',
    snapshot: '- heading "Native page"',
    truncated: false
  })
  fixture.controller.revoke(fixture.contents)
})

void test('native navigation accepts private, fake-IP, cross-site and non-HTTP browser destinations', async () => {
  const fixture = new BrowserFixture()
  for (const url of [
    'http://127.0.0.1:8080/',
    'https://198.18.0.119/',
    'http://192.168.1.10/',
    'https://another-site.example/',
    'data:text/html,Native page'
  ]) {
    const result = await fixture.execute({ kind: 'navigate', url })
    assert.deepEqual(result, { kind: 'page', url, title: 'Native title' })
    assert.equal(fixture.contents.getURL(), url)
    assert.match((await fixture.execute({ kind: 'snapshot' })).snapshot, /Native page/)
  }
  fixture.controller.revoke(fixture.contents)
})

void test('snapshot waits for native document readiness without a response-peer event', async () => {
  const fixture = new BrowserFixture({ loading: true })
  const result = fixture.execute({ kind: 'snapshot' })
  await fixture.connected.promise
  fixture.ready()
  assert.match((await result).snapshot, /Native page/)
  fixture.controller.revoke(fixture.contents)
})

void test('revocation rejects a late operation result and keeps the human page', async () => {
  const fixture = new BrowserFixture()
  const started = deferred()
  const release = deferred()
  fixture.perform = async () => {
    started.resolve()
    await release.promise
    return {
      success: true,
      data: { snapshot: '- heading "Late page"' }
    }
  }
  const result = fixture.execute({ kind: 'snapshot' })
  await started.promise
  fixture.controller.revoke(fixture.contents)
  release.resolve()
  await assert.rejects(result, /control was revoked/)
  assert.equal(fixture.contents.getURL(), 'http://192.168.1.10/design')
})

void test('revocation during initial native loading prevents late attachment and preserves a replacement lease', async () => {
  const fixture = new BrowserFixture({ url: '' })
  const started = deferred()
  const release = deferred()
  fixture.contents.loadURL = async (url) => {
    started.resolve()
    await release.promise
    fixture.navigate(url)
  }
  const result = fixture.execute({ kind: 'snapshot' })
  await started.promise
  fixture.controller.revoke(fixture.contents)
  fixture.navigate('http://192.168.1.10/replacement')
  const replacement = { ...fixture.scope, runId: 'replacement-run' }
  assert.match(
    (await fixture.controller.execute(fixture.contents, replacement, { kind: 'snapshot' }))
      .snapshot,
    /Native page/
  )
  release.resolve()
  await assert.rejects(result, /control was revoked/)
  assert.deepEqual(fixture.controller.activeScopes(), [replacement])
  fixture.controller.revoke(fixture.contents)
})

void test('human input remains blocked across asynchronous Agent waits and resumes on takeover', async () => {
  const fixture = new BrowserFixture()
  await fixture.execute({ kind: 'snapshot' })
  const lease = Reflect.get(fixture.controller, 'leases').get(fixture.contents.id)
  const guards = Reflect.get(lease.driver, 'guards')
  const release = deferred()
  const input = () => {
    const event = {
      prevented: false,
      preventDefault() {
        this.prevented = true
      }
    }
    fixture.contents.emit('before-input-event', event)
    return event.prevented
  }
  assert.equal(input(), true)
  const dispatch = guards.dispatchInput(() => {
    assert.equal(input(), false)
    return release.promise
  })
  assert.equal(input(), true)
  release.resolve()
  await dispatch
  fixture.controller.revoke(fixture.contents)
  assert.equal(input(), false)
})

void test('navigation failure retains its loading error and permits another observation', async () => {
  const fixture = new BrowserFixture()
  const snapshot = fixture.perform
  fixture.perform = async () => ({
    success: false,
    error: 'Timeout 15000ms exceeded during navigation.'
  })
  await assert.rejects(fixture.execute({ kind: 'navigate', url: 'https://198.18.0.119/' }), {
    message: 'Browser operation failed; its effects may be incomplete. Observe before continuing.'
  })
  fixture.perform = snapshot
  assert.match((await fixture.execute({ kind: 'snapshot' })).snapshot, /Native page/)
  fixture.controller.revoke(fixture.contents)
})

void test('long snapshots are cut to a bounded body and flagged as truncated', async () => {
  const fixture = new BrowserFixture()
  const body = '- text "x"\n'.repeat(6_000)
  fixture.perform = async () => ({
    success: true,
    data: { snapshot: body }
  })
  const result = await fixture.execute({ kind: 'snapshot' })
  assert.equal(result.truncated, true)
  assert.equal(result.snapshot, body.slice(0, 50_000))
  fixture.controller.revoke(fixture.contents)
})
