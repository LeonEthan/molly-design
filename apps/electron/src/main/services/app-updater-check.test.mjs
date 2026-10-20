import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createCheckingWatchdog,
  releaseUpdaterCheckLock,
  shouldResetPhaseForManualCheck
} from './app-updater-check.ts'

void test('releasing a hung updater check lets the next check start', () => {
  let settled = false
  const hung = new Promise(() => undefined).then(() => {
    settled = true
  })
  const updater = { checkForUpdatesPromise: hung }
  releaseUpdaterCheckLock(updater)
  assert.equal(updater.checkForUpdatesPromise, null)
  assert.equal(settled, false)
})

void test('a manual check keeps an in-progress or ready download', () => {
  assert.equal(shouldResetPhaseForManualCheck('downloading'), false)
  assert.equal(shouldResetPhaseForManualCheck('downloaded'), false)
  assert.equal(shouldResetPhaseForManualCheck('disabled'), false)
  assert.equal(shouldResetPhaseForManualCheck('idle'), true)
  assert.equal(shouldResetPhaseForManualCheck('checking'), true)
  assert.equal(shouldResetPhaseForManualCheck('up_to_date'), true)
  assert.equal(shouldResetPhaseForManualCheck('error'), true)
})

void test('an unanswered check becomes retryable and a later phase cancels the timer', () => {
  let pending = null
  let phase = 'idle'
  const watchdog = createCheckingWatchdog({
    delayMs: 30_000,
    schedule(callback, delayMs) {
      assert.equal(delayMs, 30_000)
      pending = callback
      return {
        cancel() {
          pending = null
        }
      }
    },
    isChecking: () => phase === 'checking',
    onUnanswered() {
      phase = 'error'
      unanswered = true
    }
  })
  let unanswered = false

  watchdog.sync('checking')
  phase = 'checking'
  assert.equal(typeof pending, 'function')
  pending()
  assert.equal(unanswered, true)
  assert.equal(phase, 'error')

  unanswered = false
  phase = 'checking'
  watchdog.sync('checking')
  watchdog.sync('downloading')
  assert.equal(pending, null)
  assert.equal(unanswered, false)
})
