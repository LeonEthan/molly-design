import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveDefaultMainWindowBounds } from './window-default-bounds.ts'

function assertInside(bounds, workArea) {
  assert.ok(bounds.x >= workArea.x, 'left edge stays in the work area')
  assert.ok(bounds.y >= workArea.y, 'top edge stays in the work area')
  assert.ok(bounds.x + bounds.width <= workArea.x + workArea.width, 'right edge stays inside')
  assert.ok(bounds.y + bounds.height <= workArea.y + workArea.height, 'bottom edge stays inside')
}

void test('uses the minimum comfortable size on a 13-inch laptop work area', () => {
  const workArea = { x: 0, y: 25, width: 1440, height: 875 }
  const bounds = resolveDefaultMainWindowBounds(workArea)

  assert.deepEqual(bounds, { x: 130, y: 73, width: 1180, height: 780 })
  assertInside(bounds, workArea)
})

void test('scales with larger laptop and 1080p work areas', () => {
  assert.deepEqual(resolveDefaultMainWindowBounds({ x: 0, y: 38, width: 1728, height: 1079 }), {
    x: 173,
    y: 146,
    width: 1382,
    height: 863
  })
  assert.deepEqual(resolveDefaultMainWindowBounds({ x: 0, y: 0, width: 1920, height: 1040 }), {
    x: 192,
    y: 104,
    width: 1536,
    height: 832
  })
})

void test('caps the size on 1440p and 4K work areas', () => {
  assert.deepEqual(resolveDefaultMainWindowBounds({ x: 0, y: 25, width: 2560, height: 1415 }), {
    x: 480,
    y: 233,
    width: 1600,
    height: 1000
  })
  assert.deepEqual(resolveDefaultMainWindowBounds({ x: 0, y: 25, width: 3840, height: 2135 }), {
    x: 1120,
    y: 593,
    width: 1600,
    height: 1000
  })
})

void test('fits a work area smaller than the comfortable size', () => {
  const workArea = { x: 0, y: 0, width: 1024, height: 700 }
  const bounds = resolveDefaultMainWindowBounds(workArea)

  assert.deepEqual(bounds, { x: 0, y: 0, width: 1024, height: 700 })
  assertInside(bounds, workArea)
})

void test('never goes below the window minimum on a tiny work area', () => {
  const bounds = resolveDefaultMainWindowBounds({ x: 0, y: 0, width: 600, height: 560 })

  assert.equal(bounds.width, 620)
  assert.equal(bounds.height, 600)
})

void test('centres on a display that does not start at the origin', () => {
  const workArea = { x: -2560, y: -200, width: 2560, height: 1415 }
  const bounds = resolveDefaultMainWindowBounds(workArea)

  assert.deepEqual(bounds, { x: -2080, y: 8, width: 1600, height: 1000 })
  assertInside(bounds, workArea)
})
