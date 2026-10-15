import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWindowActivationAction } from './window-activation-policy.ts'

void test('activation never refocuses an already visible main window', () => {
  assert.equal(
    resolveWindowActivationAction({
      windowCount: 1,
      mainWindowVisible: true,
      mainWindowMinimized: false
    }),
    'none'
  )
})

void test('activation reveals a hidden or minimized main window', () => {
  assert.equal(
    resolveWindowActivationAction({
      windowCount: 1,
      mainWindowVisible: false,
      mainWindowMinimized: false
    }),
    'reveal'
  )
  assert.equal(
    resolveWindowActivationAction({
      windowCount: 1,
      mainWindowVisible: true,
      mainWindowMinimized: true
    }),
    'reveal'
  )
})

void test('activation opens a window when none exist', () => {
  assert.equal(
    resolveWindowActivationAction({
      windowCount: 0,
      mainWindowVisible: false,
      mainWindowMinimized: false
    }),
    'open'
  )
})
