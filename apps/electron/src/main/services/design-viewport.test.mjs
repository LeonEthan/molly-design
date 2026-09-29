import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { fitDesignViewport } from './design-viewport.ts'

function surface({ layoutReady = true } = {}) {
  let camera = { scale: 4, x: 70, y: 90 }
  let bounds = { x: 0, y: 0, width: 800, height: 600 }
  let visible = true
  let heldFit
  let nextTimer = 0
  const timers = new Map()
  const resizeListeners = new Set()
  const context = {
    innerWidth: layoutReady ? 800 : 1,
    innerHeight: layoutReady ? 600 : 1,
    document: { body: { getBoundingClientRect: () => bounds } },
    window: {
      addEventListener(event, listener) {
        if (event === 'resize') resizeListeners.add(listener)
      },
      removeEventListener(event, listener) {
        if (event === 'resize') resizeListeners.delete(listener)
      },
      bento: {
        viewport(value) {
          if (value) camera = value
          return camera
        },
        fit() {
          camera = { scale: (bounds.width - 64) / 1200, x: 600, y: 314 }
        }
      }
    },
    setTimeout(callback) {
      const timer = ++nextTimer
      timers.set(timer, callback)
      return timer
    },
    clearTimeout(timer) {
      timers.delete(timer)
    },
    setInterval() {
      return 1
    },
    clearInterval() {}
  }
  const view = {
    getBounds: () => bounds,
    getVisible: () => visible,
    setVisible(value) {
      visible = value
    },
    webContents: {
      isDestroyed: () => false,
      executeJavaScript: async (script) => {
        const result = runInNewContext(script, context)
        if (script === 'window.bento.fit()' && heldFit) {
          const fitting = heldFit
          heldFit = undefined
          fitting.enter()
          await fitting.released
        }
        return result
      }
    }
  }
  return {
    view,
    camera: () => camera,
    zoom() {
      camera = { scale: 4, x: 70, y: 90 }
    },
    resize(width = 1000) {
      bounds = { ...bounds, width }
      if (layoutReady) context.innerWidth = width
    },
    paint() {
      context.innerWidth = bounds.width
      context.innerHeight = bounds.height
      for (const listener of [...resizeListeners]) listener()
    },
    expire() {
      for (const callback of [...timers.values()]) callback()
    },
    waitingForLayout() {
      return resizeListeners.size > 0 || timers.size > 0
    },
    holdNextFit() {
      let enter
      let release
      const entered = new Promise((resolve) => {
        enter = resolve
      })
      const released = new Promise((resolve) => {
        release = resolve
      })
      heldFit = { enter, released }
      return { entered, release }
    }
  }
}

void test('a replacement fits instead of inheriting the outgoing zoom', async () => {
  const next = surface()
  await fitDesignViewport(next.view)
  assert.deepEqual(next.camera(), { scale: 736 / 1200, x: 600, y: 314 })
})

void test('same surface keeps manual zoom until its container dimensions change', async () => {
  const current = surface()
  await fitDesignViewport(current.view)
  current.zoom()
  current.view.setVisible(false)
  await fitDesignViewport(current.view)
  assert.deepEqual(current.camera(), { scale: 4, x: 70, y: 90 })
  current.resize()
  await fitDesignViewport(current.view)
  assert.deepEqual(current.camera(), { scale: 936 / 1200, x: 600, y: 314 })
})

void test('overlapping resize requests follow the final viewport without an obsolete timeout', async () => {
  const current = surface({ layoutReady: false })
  const first = fitDesignViewport(current.view)
  current.resize(1000)
  const second = fitDesignViewport(current.view)
  current.paint()
  await second
  current.expire()
  await first
  assert.equal(current.waitingForLayout(), false)
  assert.deepEqual(current.camera(), { scale: 936 / 1200, x: 600, y: 314 })
})

void test('an unchanged viewport that never reaches layout still reports its timeout', async () => {
  const current = surface({ layoutReady: false })
  const fitting = fitDesignViewport(current.view)
  current.expire()
  await assert.rejects(fitting, /Canvas layout timed out: 1x1 expected 800x600/)
  assert.equal(current.waitingForLayout(), false)
})

void test('superseded requests still fail when the latest viewport never reaches layout', async () => {
  const current = surface({ layoutReady: false })
  const first = fitDesignViewport(current.view)
  current.resize(1000)
  const second = fitDesignViewport(current.view)
  current.resize(1200)
  const third = fitDesignViewport(current.view)
  current.expire()
  for (const result of await Promise.allSettled([first, second, third])) {
    assert.equal(result.status, 'rejected')
    assert.match(result.reason.message, /Canvas layout timed out: 1x1 expected 1200x600/)
  }
  assert.equal(current.waitingForLayout(), false)
})

void test('returning to an earlier size cannot reuse a camera changed by an in-flight fit', async () => {
  const current = surface()
  await fitDesignViewport(current.view)
  current.resize(1000)
  const held = current.holdNextFit()
  const first = fitDesignViewport(current.view)
  await held.entered
  current.resize(800)
  await fitDesignViewport(current.view)
  held.release()
  await first
  assert.deepEqual(current.camera(), { scale: 736 / 1200, x: 600, y: 314 })
})
