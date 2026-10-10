import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { compileFunction } from 'node:vm'

const require = createRequire(import.meta.url)
const { build } = createRequire(new URL('../../../../cli/package.json', import.meta.url))('esbuild')
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('./design-source-preview.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  external: ['./design-service', './design-frame', './design-viewport', '../ui-locale']
})

function fixture({ retainDestroyedContents = false } = {}) {
  const loading = Promise.withResolvers()
  const loadStarted = Promise.withResolvers()
  const nativeViews = []
  const resources = []
  const watchers = []
  const publications = []
  class WebContentsView {
    visible = true
    constructor() {
      let destroyed = false
      const contents = Object.assign(new EventEmitter(), {
        isDestroyed: () => destroyed,
        setWindowOpenHandler() {},
        loadURL: async () => {
          loadStarted.resolve()
          await loading.promise
        },
        executeJavaScript: async () => {
          if (destroyed) throw new Error('Object has been destroyed')
        },
        close: () => {
          destroyed = true
          if (!retainDestroyedContents) this.webContents = undefined
          contents.emit('destroyed')
        }
      })
      this.webContents = contents
      nativeViews.push(this)
    }
    setBounds() {}
    setVisible(value) {
      this.visible = value
    }
    getVisible() {
      return this.visible
    }
  }
  const children = new Set()
  let ownerDestroyed = false
  const owner = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), {
      isDestroyed: () => ownerDestroyed,
      send: (_channel, value) => publications.push(value)
    }),
    contentView: {
      addChildView: (view) => children.add(view),
      removeChildView: (view) => children.delete(view)
    },
    getContentSize: () => [800, 600],
    isDestroyed: () => ownerDestroyed,
    destroy() {
      ownerDestroyed = true
      children.clear()
      this.emit('closed')
    }
  })
  const module = { exports: {} }
  compileFunction(compiled.outputFiles[0].text, ['module', 'exports', 'require'])(
    module,
    module.exports,
    (name) => {
      if (name === 'electron') return { WebContentsView }
      if (name === 'node:fs')
        return { lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }) }
      if (name === '@molly/ignore')
        return {
          startWorkspaceFileWatcher() {
            const watcher = {
              closed: false,
              update() {},
              close() {
                this.closed = true
              }
            }
            watchers.push(watcher)
            return watcher
          }
        }
      if (name === './design-service')
        return {
          designCanvasAccess: { state: () => ({}) },
          currentDesignBounds: () => undefined,
          isDesignVisible: () => false,
          hideDesign() {},
          designRequest: async ({ operation }) =>
            operation === 'source-preview'
              ? { status: 'ok', sourceIdentity: 'snapshot', dependencies: ['design.yaml'] }
              : { association: { sessionId: 'artwork' } },
          surface: async () => {
            const owned = new Set()
            const resource = {
              disposed: false,
              isolated: {},
              url: 'molly-design://synthetic',
              own: (create) => {
                const view = create()
                owned.add(view.webContents)
                return view
              },
              dispose: () => {
                resource.disposed = true
                for (const contents of owned) if (!contents.isDestroyed()) contents.close()
                owned.clear()
              }
            }
            resources.push(resource)
            return resource
          }
        }
      if (name === './design-frame') return { prepareDesignFrame: async () => {} }
      if (name === './design-viewport') return { fitDesignViewport: async () => {} }
      if (name === '../ui-locale') return { translateUi: (_key, fallback) => fallback }
      return require(name)
    }
  )
  return {
    ...module.exports,
    loading,
    loadStarted,
    nativeViews,
    resources,
    watchers,
    publications,
    children,
    owner
  }
}

const source = async () => '/synthetic/authoring/design.yaml'

void test('hide and close tolerate a host that never created a preview', () => {
  const f = fixture()
  assert.doesNotThrow(() => {
    f.hideSourcePreview('missing')
    f.closeSourcePreview('missing')
    f.closeSourcePreview('missing')
  })
  assert.deepEqual(f.nativeViews, [])
})

for (const event of ['did-start-navigation', 'render-process-gone', 'closed']) {
  void test(`owner ${event} after cancelling a loading preview is safe`, async () => {
    const f = fixture()
    const pending = f.refreshSourcePreview(f.owner, 'artwork', 'host', source)
    await f.loadStarted.promise
    f.hideSourcePreview('host')
    assert.equal(f.nativeViews[0].webContents, undefined)
    assert.doesNotThrow(() => {
      if (event === 'closed') f.owner.destroy()
      else f.owner.webContents.emit(event, {}, 'about:blank', false, true)
      f.closeSourcePreview('host')
    })
    f.loading.reject(new Error('Load cancelled'))
    assert.deepEqual(await pending, { status: 'superseded' })
    assert.equal(
      f.resources.every((resource) => resource.disposed),
      true
    )
    assert.equal(
      f.watchers.every((watcher) => watcher.closed),
      true
    )
    assert.equal(f.children.size, 0)
    assert.deepEqual(f.publications, [])
  })
}

void test('a ready preview whose contents were destroyed can be closed repeatedly', async () => {
  const f = fixture()
  f.loading.resolve()
  assert.equal((await f.refreshSourcePreview(f.owner, 'artwork', 'host', source)).status, 'ready')
  f.nativeViews[0].webContents.close()
  assert.doesNotThrow(() => {
    f.hideSourcePreview('host')
    f.closeSourcePreview('host')
    f.closeSourcePreview('host')
  })
  assert.equal(f.resources[0].disposed, true)
  assert.equal(f.watchers[0].closed, true)
  assert.equal(f.children.size, 0)
})

void test('temporary hiding retains a live preview until final close', async () => {
  const f = fixture()
  f.loading.resolve()
  await f.refreshSourcePreview(f.owner, 'artwork', 'host', source)
  const contents = f.nativeViews[0].webContents
  f.hideSourcePreview('host', false)
  assert.equal(contents.isDestroyed(), false)
  assert.equal(f.resources[0].disposed, false)
  assert.equal(f.watchers[0].closed, false)
  await f.attachSourcePreview('host', { x: 0, y: 0, width: 800, height: 600 })
  assert.equal(f.nativeViews[0].getVisible(), true)
  assert.equal(f.nativeViews[0].webContents, contents)
  f.closeSourcePreview('host')
  assert.equal(contents.isDestroyed(), true)
  assert.equal(f.resources[0].disposed, true)
  assert.equal(f.watchers[0].closed, true)
})

void test('late load completion after cancellation releases destroyed contents', async () => {
  const f = fixture({ retainDestroyedContents: true })
  const pending = f.refreshSourcePreview(f.owner, 'artwork', 'host', source)
  await f.loadStarted.promise
  f.hideSourcePreview('host')
  assert.equal(f.nativeViews[0].webContents.isDestroyed(), true)
  f.closeSourcePreview('host')
  f.loading.resolve()
  assert.deepEqual(await pending, { status: 'superseded' })
  assert.equal(f.resources[0].disposed, true)
  assert.equal(f.children.size, 0)
  assert.deepEqual(f.publications, [])
})

void test('closing one consumer preserves the shared source and its live sibling', async () => {
  const f = fixture()
  f.loading.resolve()
  await f.refreshSourcePreview(f.owner, 'artwork', 'first', source)
  await f.refreshSourcePreview(f.owner, 'artwork', 'second', source)
  const sibling = f.nativeViews[1]
  f.closeSourcePreview('first')
  assert.equal(f.resources[0].disposed, true)
  assert.equal(f.resources[1].disposed, false)
  assert.equal(sibling.webContents.isDestroyed(), false)
  assert.deepEqual([...f.children], [sibling])
  assert.equal(
    f.watchers.every((watcher) => !watcher.closed),
    true
  )
  f.closeSourcePreview('second')
  assert.equal(
    f.watchers.every((watcher) => watcher.closed),
    true
  )
  assert.equal(f.children.size, 0)
})

void test('owner destruction before source resolution prevents preview creation', async () => {
  const f = fixture()
  const resolution = Promise.withResolvers()
  const pending = f.refreshSourcePreview(f.owner, 'artwork', 'host', () => resolution.promise)
  f.owner.destroy()
  resolution.resolve(await source())
  assert.deepEqual(await pending, { status: 'superseded' })
  assert.deepEqual(f.nativeViews, [])
  assert.deepEqual(f.publications, [])
})
