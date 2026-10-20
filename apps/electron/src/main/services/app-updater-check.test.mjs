import assert from 'node:assert/strict'
import test from 'node:test'
import {
  beginSparkleCheck,
  createCheckingWatchdog,
  nextSparkleEventGate,
  recoverUnansweredCheck,
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

void test('an unanswered Sparkle check is cancelled before another check can start', () => {
  const hung = new Promise(() => undefined)
  const updater = { checkForUpdatesPromise: hung }
  const order = []
  const sparkle = {
    cancelCheck() {
      order.push('cancel')
    },
    checkForUpdates() {
      order.push('check')
    }
  }

  const recovered = recoverUnansweredCheck({
    electronUpdater: updater,
    sparkle,
    sparkleSessionOpen: true
  })
  assert.equal(updater.checkForUpdatesPromise, null)
  assert.deepEqual(order, ['cancel'])
  assert.equal(recovered.sparkleSessionOpen, false)
  assert.equal(recovered.ignoreUntilChecking, true)

  const started = beginSparkleCheck({ bridge: sparkle, sessionOpen: recovered.sparkleSessionOpen })
  assert.deepEqual(order, ['cancel', 'check'])
  assert.equal(started.started, true)
  assert.equal(started.sessionOpen, true)
  assert.equal(started.ignoreUntilChecking, false)

  const dropped = nextSparkleEventGate(recovered.ignoreUntilChecking, 'error')
  assert.equal(dropped.deliver, false)
  assert.equal(dropped.ignoreUntilChecking, true)
  const delivered = nextSparkleEventGate(dropped.ignoreUntilChecking, 'checking')
  assert.equal(delivered.deliver, true)
  assert.equal(delivered.ignoreUntilChecking, false)
})

void test('a second Sparkle check cancels the session that is still open', () => {
  const order = []
  const sparkle = {
    cancelCheck() {
      order.push('cancel')
    },
    checkForUpdates() {
      order.push('check')
    }
  }
  const started = beginSparkleCheck({ bridge: sparkle, sessionOpen: true })
  assert.deepEqual(order, ['cancel'])
  assert.equal(started.started, false)
  assert.equal(started.sessionOpen, false)
  assert.equal(started.ignoreUntilChecking, true)
  const retried = beginSparkleCheck({ bridge: sparkle, sessionOpen: started.sessionOpen })
  assert.deepEqual(order, ['cancel', 'check'])
  assert.equal(retried.started, true)
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
