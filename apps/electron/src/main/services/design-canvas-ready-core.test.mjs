import assert from 'node:assert/strict'
import test from 'node:test'
import { waitForCanvasReady } from './design-canvas-ready-core.ts'

function controlledDeadline() {
  let expire
  let active = false
  return {
    options: {
      timeoutMs: 30_000,
      setTimer(handler) {
        expire = handler
        active = true
        return 1
      },
      clearTimer() {
        active = false
      }
    },
    expire: () => expire(),
    active: () => active
  }
}

void test('accepts canvas readiness that is already established', async () => {
  const deadline = controlledDeadline()
  await waitForCanvasReady(() => Promise.resolve(), deadline.options)
  assert.equal(deadline.active(), false)
})

void test('waits for canvas readiness published after the listener begins', async () => {
  const deadline = controlledDeadline()
  let ready
  const pending = new Promise((resolve) => {
    ready = resolve
  })
  const waiting = waitForCanvasReady(() => pending, deadline.options)
  await Promise.resolve()
  assert.equal(deadline.active(), true)
  ready()
  await waiting
  assert.equal(deadline.active(), false)
})

void test('rejects on the main-process deadline and releases its timer', async () => {
  const deadline = controlledDeadline()
  const waiting = waitForCanvasReady(() => new Promise(() => {}), deadline.options)
  deadline.expire()
  await assert.rejects(waiting, /Canvas product API did not become ready/)
  assert.equal(deadline.active(), false)
})
