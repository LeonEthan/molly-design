import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileFunction } from 'node:vm'

const require = createRequire(import.meta.url)
const { build } = createRequire(new URL('../../../../cli/package.json', import.meta.url))('esbuild')
const compiled = await build({
  stdin: {
    contents: "export * from './design-service'; export * from './design-view-visibility'",
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    loader: 'ts'
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  external: ['./design-worker', './design-session'],
  alias: Object.fromEntries(
    ['design-element-reference', 'design-selection-commands'].map((name) => [
      `@molly/shared/${name}`,
      fileURLToPath(new URL(`../../../../../packages/shared/src/${name}.ts`, import.meta.url))
    ])
  )
})

function fixture() {
  const loading = Promise.withResolvers()
  const loadStarted = Promise.withResolvers()
  const apiReady = Promise.withResolvers()
  const readyStarted = Promise.withResolvers()
  const shell = Buffer.from('synthetic editor')
  const scripts = []
  let ready = false
  let view
  const leases = []
  const loadedUrls = []
  class WebContentsView {
    visible = true
    bounds = { x: 0, y: 0, width: 800, height: 600 }
    webContents = {
      capturePage: async () => ({ isEmpty: () => false, toPNG: () => Buffer.from('pixels') }),
      setWindowOpenHandler() {},
      on() {},
      isDestroyed: () => false,
      loadURL: async (url) => {
        loadedUrls.push(url)
        loadStarted.resolve()
        await loading.promise
      },
      executeJavaScript: async (script) => {
        if (script.includes("const event = 'molly:ready'")) {
          readyStarted.resolve()
          await apiReady.promise
          ready = true
          return true
        }
        scripts.push({ ready, script, retired: leases.at(-1)?.disposed ?? false })
        if (!ready) throw new Error('Canvas API not ready')
        return true
      }
    }
    constructor(options) {
      view = this
      this.webContents.session = options.webPreferences.session
    }
    getVisible() {
      return this.visible
    }
    setVisible(value) {
      this.visible = value
    }
    getBounds() {
      return this.bounds
    }
    setBounds(value) {
      this.bounds = value
    }
  }
  const owner = Object.assign(new EventEmitter(), {
    contentView: { addChildView() {}, removeChildView() {} },
    getContentSize: () => [800, 600],
    isVisible: () => false,
    isDestroyed: () => false
  })
  const module = { exports: {} }
  compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require'])(
    module,
    module.exports,
    (name) => {
      if (name === 'electron') return { app: { getAppPath: () => '/synthetic' }, WebContentsView }
      if (name === './design-worker')
        return {
          DesignWorker: class {
            async request() {
              return { association: { sessionId: 'artwork' }, revisionId: 'revision' }
            }
          }
        }
      if (name === './design-session')
        return {
          acquireDesignSession: async () => {
            const lease = {
              session: {
                setPermissionRequestHandler() {},
                setPermissionCheckHandler() {},
                webRequest: { onBeforeRequest() {} }
              },
              disposed: false,
              handler: undefined,
              handle(next) {
                lease.handler = next
              },
              assertActive() {
                if (lease.disposed) throw Error('Retired canvas')
              },
              own: (create) => create(),
              dispose() {
                lease.disposed = true
              }
            }
            leases.push(lease)
            return lease
          }
        }
      if (name === 'node:fs/promises')
        return {
          ...require(name),
          readFile: async (path) =>
            path.endsWith('editor.html')
              ? shell
              : JSON.stringify({ shellSha256: createHash('sha256').update(shell).digest('hex') })
        }
      return require(name)
    }
  )
  return {
    ...module.exports,
    owner,
    loading,
    loadStarted,
    apiReady,
    readyStarted,
    scripts,
    leases,
    postToolbar: (lease, request) => {
      const host = new URL(loadedUrls[leases.indexOf(lease)]).host
      return lease.handler(
        new Request('molly-design://' + host + '/ws/artwork/toolbar', {
          method: 'POST',
          body: JSON.stringify(request)
        })
      )
    },
    view: () => view
  }
}

void test('overlapping attachments share initial document load and product API readiness', async () => {
  const f = fixture()
  const bounds = { x: 0, y: 0, width: 800, height: 600 }
  const opening = f.attachDesign(f.owner, 'artwork', bounds)
  await f.loadStarted.promise
  const concurrent = f.attachDesign(f.owner, 'artwork', bounds)
  const joined = Promise.allSettled([opening, concurrent])
  f.loading.resolve()
  await f.readyStarted.promise
  const duringReady = f.attachDesign(f.owner, 'artwork', bounds)
  const final = Promise.allSettled([joined, duringReady])
  f.apiReady.resolve()
  assert.deepEqual(await joined, [
    { status: 'fulfilled', value: undefined },
    { status: 'fulfilled', value: undefined }
  ])
  assert.equal((await final)[1].status, 'fulfilled')
  assert.equal(
    f.scripts.some((entry) => !entry.ready),
    false
  )
  assert.equal(f.view().getVisible(), true)
  await f.destroyDesign('artwork')
})

void test('hiding a shared pending attachment keeps the ready canvas hidden', async () => {
  const f = fixture()
  const bounds = { x: 0, y: 0, width: 800, height: 600 }
  const opening = f.attachDesign(f.owner, 'artwork', bounds)
  await f.loadStarted.promise
  const concurrent = f.attachDesign(f.owner, 'artwork', bounds)
  f.hideDesign('artwork')
  f.loading.resolve()
  f.apiReady.resolve()
  await Promise.all([opening, concurrent])
  assert.equal(f.view().getVisible(), false)
  assert.equal(
    f.scripts.some((entry) => !entry.ready),
    false
  )
  await f.destroyDesign('artwork')
})

void test('a failed initial load rejects every waiting attachment', async () => {
  const f = fixture()
  const bounds = { x: 0, y: 0, width: 800, height: 600 }
  const opening = f.attachDesign(f.owner, 'artwork', bounds)
  await f.loadStarted.promise
  const concurrent = f.attachDesign(f.owner, 'artwork', bounds)
  const joined = Promise.allSettled([opening, concurrent])
  const failure = new Error('Synthetic load failure')
  f.loading.reject(failure)
  assert.deepEqual(await joined, [
    { status: 'rejected', reason: failure },
    { status: 'rejected', reason: failure }
  ])
  assert.deepEqual(f.scripts, [])
})

async function openedCanvas() {
  const f = fixture()
  const opening = f.attachDesign(f.owner, 'artwork', { x: 0, y: 0, width: 800, height: 600 })
  await f.loadStarted.promise
  f.loading.resolve()
  await f.readyStarted.promise
  f.apiReady.resolve()
  await opening
  return f
}

void test('captures the visible host only for its owning window and artwork', async () => {
  const f = await openedCanvas()
  assert.equal(await f.captureDesignFrame({}, 'artwork', 'artwork'), null)
  assert.equal(await f.captureDesignFrame(f.owner, 'another', 'artwork'), null)
  assert.deepEqual(await f.captureDesignFrame(f.owner, 'artwork', 'artwork'), {
    src: 'data:image/png;base64,cGl4ZWxz',
    x: 0,
    y: 0,
    width: 800,
    height: 600
  })
  f.hideDesign('artwork')
  assert.equal(await f.captureDesignFrame(f.owner, 'artwork', 'artwork'), null)
})

void test('a capture started while visible may finish after hiding without revealing the editor', async () => {
  const f = await openedCanvas()
  const capture = Promise.withResolvers()
  f.view().webContents.capturePage = () => capture.promise
  const pending = f.captureDesignFrame(f.owner, 'artwork', 'artwork')
  f.hideDesign('artwork')
  capture.resolve({ isEmpty: () => false, toPNG: () => Buffer.from('pixels') })
  assert.equal((await pending).src, 'data:image/png;base64,cGl4ZWxz')
  assert.equal(f.view().getVisible(), false)
})

void test('discards captured pixels when the viewport changed during capture', async () => {
  const f = await openedCanvas()
  const capture = Promise.withResolvers()
  f.view().webContents.capturePage = () => capture.promise
  const pending = f.captureDesignFrame(f.owner, 'artwork', 'artwork')
  f.view().setBounds({ x: 0, y: 0, width: 400, height: 600 })
  capture.resolve({ isEmpty: () => false, toPNG: () => Buffer.from('pixels') })
  assert.equal(await pending, null)
})

void test('a loading editor cannot reveal itself under an overlapping shell menu', async () => {
  const f = fixture()
  const bounds = { x: 0, y: 0, width: 800, height: 600 }
  const opening = f.attachDesign(f.owner, 'artwork', bounds)
  await f.loadStarted.promise
  f.coverDesignHost(f.owner, 'artwork')
  f.hideDesign('artwork')
  f.loading.resolve()
  await f.readyStarted.promise
  f.apiReady.resolve()
  await opening
  assert.equal(f.view().getVisible(), false)
  const retained = f.view()
  await f.attachDesign(f.owner, 'artwork', bounds)
  assert.equal(f.view().getVisible(), false)
  f.uncoverDesignHost(f.owner, 'artwork')
  await f.attachDesign(f.owner, 'artwork', bounds)
  assert.equal(f.view(), retained)
  assert.equal(f.view().getVisible(), true)
})

const pinnedNote = [
  { elementIds: ['photo'], prompt: 'Lighter here', pin: { elementId: 'photo', at: [0.5, 0.5] } }
]

void test('a hidden editor still publishes its edited and cleared notes', async () => {
  const f = await openedCanvas()
  const lease = f.leases.at(-1)
  f.hideDesign('artwork')
  assert.equal((await f.postToolbar(lease, { type: 'notes-sync', notes: pinnedNote })).status, 200)
  assert.equal((await f.postToolbar(lease, { type: 'notes-sync', notes: [] })).status, 200)
})

void test('notes-sync from a destroyed or replaced canvas instance is refused', async () => {
  const f = await openedCanvas()
  const retired = f.leases.at(-1)
  await f.destroyDesign('artwork')
  assert.equal((await f.postToolbar(retired, { type: 'notes-sync', notes: [] })).status, 400)
  await f.attachDesign(f.owner, 'artwork', { x: 0, y: 0, width: 800, height: 600 })
  const replacement = f.leases.at(-1)
  assert.equal((await f.postToolbar(retired, { type: 'notes-sync', notes: [] })).status, 400)
  assert.equal((await f.postToolbar(replacement, { type: 'notes-sync', notes: [] })).status, 200)
})

void test('closing a canvas asks it to publish unsent notes before disposal', async () => {
  const f = await openedCanvas()
  const lease = f.leases.at(-1)
  await f.destroyDesign('artwork')
  const flush = f.scripts.find((entry) => entry.script.includes('flushNotes'))
  assert.equal(flush?.retired, false)
  assert.equal(lease.disposed, true)
})

void test('closing the window asks its canvases to publish unsent notes before disposal', async () => {
  const f = await openedCanvas()
  const lease = f.leases.at(-1)
  const closed = Promise.withResolvers()
  f.owner.close = closed.resolve
  f.owner.emit('close', { preventDefault() {} })
  await closed.promise
  const flush = f.scripts.find((entry) => entry.script.includes('flushNotes'))
  assert.equal(flush?.retired, false)
  assert.equal(lease.disposed, true)
})
