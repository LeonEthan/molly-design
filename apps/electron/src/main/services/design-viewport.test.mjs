import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { fitDesignViewport } from './design-viewport.ts'

function surface() {
  let camera = { scale: 4, x: 70, y: 90 }
  let bounds = { x: 0, y: 0, width: 800, height: 600 }
  let visible = true
  const context = {
    innerWidth: 800,
    innerHeight: 600,
    document: { body: { getBoundingClientRect: () => bounds } },
    window: {
      addEventListener() {},
      removeEventListener() {},
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
    setTimeout() {
      return 1
    },
    clearTimeout() {},
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
      executeJavaScript: async (script) => runInNewContext(script, context)
    }
  }
  return {
    view,
    camera: () => camera,
    zoom() {
      camera = { scale: 4, x: 70, y: 90 }
    },
    resize() {
      bounds = { ...bounds, width: 1000 }
      context.innerWidth = 1000
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
