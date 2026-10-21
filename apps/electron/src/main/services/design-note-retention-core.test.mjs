import assert from 'node:assert/strict'
import test from 'node:test'
import { createRetainedNotes, flushBeforeTeardown } from './design-note-retention-core.ts'

const note = (prompt, elementId = 'title') => ({ elementIds: [elementId], prompt })
const retainedFor = (max = 10) => createRetainedNotes({ max })

void test('a published canvas state is retained for the next attach', () => {
  const retained = retainedFor()
  const notes = [note('Warmer')]
  retained.publish('artwork:host-a', 3, 'page-1', notes)
  assert.deepEqual(retained.peek('artwork:host-a'), notes)
})

void test('publishing no notes clears the copy the user emptied', () => {
  const retained = retainedFor()
  retained.publish('artwork:host-a', 3, 'page-1', [note('Warmer')])
  retained.publish('artwork:host-a', 3, 'page-1', [])
  assert.deepEqual(retained.peek('artwork:host-a'), [])
})

void test('keeps each artwork and host scope separate', () => {
  const retained = retainedFor()
  retained.publish('artwork:host-a', 3, 'page-1', [note('a')])
  retained.publish('artwork:host-b', 3, 'page-1', [note('b')])
  assert.deepEqual(retained.peek('artwork:host-b'), [note('b')])
  assert.deepEqual(retained.peek('artwork:host-a'), [note('a')])
})

void test('a crashed canvas leaves its last published copy for the next attach', () => {
  const retained = retainedFor()
  retained.publish('a', 3, 'page-1', [note('Warmer')])
  retained.publish('a', 3, 'page-1', [note('Warmer'), note('Crop', 'photo')])
  assert.deepEqual(retained.peek('a'), [note('Warmer'), note('Crop', 'photo')])
})

void test('an accepted send clears the copy, so a reload cannot resurface sent notes', () => {
  const retained = retainedFor()
  retained.publish('a', 3, 'page-1', [note('Warmer')])
  retained.accept('a', 3)
  assert.deepEqual(retained.peek('a'), [])
})

void test('an accepted settle drops the flight for good', () => {
  const retained = retainedFor()
  retained.publish('a', 3, 'page-1', [note('Warmer')])
  retained.accept('a', 3)
  assert.deepEqual(retained.settle('a', 3, true), [])
  assert.deepEqual(retained.peek('a'), [])
  assert.deepEqual(retained.settle('a', 3, false), [])
  assert.deepEqual(retained.peek('a'), [])
})

void test('a rejected send keeps its notes for the next attach', () => {
  const retained = retainedFor()
  retained.publish('a', 3, 'page-1', [note('Warmer')])
  retained.accept('a', 3)
  assert.deepEqual(retained.settle('a', 3, false), [note('Warmer')])
  assert.deepEqual(retained.peek('a'), [note('Warmer')])
})

void test('a rejected send merges its notes with notes the reloaded canvas already holds', () => {
  const retained = retainedFor()
  retained.publish('a', 3, 'page-1', [note('Warmer')])
  retained.accept('a', 3)
  retained.publish('a', 3, 'page-1', [note('Crop', 'photo')])
  retained.settle('a', 3, false)
  assert.deepEqual(retained.peek('a'), [note('Warmer'), note('Crop', 'photo')])
})

void test('a merge after a rejection drops duplicates and respects the note limit', () => {
  const retained = retainedFor(2)
  retained.publish('a', 3, 'page-1', [note('Warmer')])
  retained.accept('a', 3)
  retained.publish('a', 3, 'page-1', [
    note('Warmer'),
    note('Crop', 'photo'),
    note('Lift', 'poster')
  ])
  retained.settle('a', 3, false)
  assert.deepEqual(retained.peek('a'), [note('Warmer'), note('Crop', 'photo')])
})

void test('a settle for another epoch leaves the flight in place', () => {
  const retained = retainedFor()
  retained.publish('a', 3, 'page-1', [note('Warmer')])
  retained.accept('a', 3)
  assert.deepEqual(retained.settle('a', 4, false), [])
  assert.deepEqual(retained.peek('a'), [])
  assert.deepEqual(retained.settle('a', 3, false), [note('Warmer')])
})

void test('a staged draft keeps its copy: settling it unsent is a no-op without a flight', () => {
  const retained = retainedFor()
  retained.publish('a', 3, 'page-1', [note('Warmer')])
  assert.deepEqual(retained.settle('a', 3, false, 'page-1'), [])
  assert.deepEqual(retained.peek('a'), [note('Warmer')])
})

void test('an accepted staged send retires the copy whose epoch and instance the composer sent', () => {
  const retained = retainedFor()
  retained.publish('a', 3, 'page-1', [note('Warmer')])
  assert.deepEqual(retained.settle('a', 3, true, 'page-1'), [])
  assert.deepEqual(retained.peek('a'), [])
})

void test('an accepted staged send keeps the copy when the pins changed since staging', () => {
  const retained = retainedFor()
  retained.publish('a', 3, 'page-1', [note('Warmer')])
  retained.publish('a', 4, 'page-1', [note('Warmer'), note('Crop', 'photo')])
  assert.deepEqual(retained.settle('a', 3, true, 'page-1'), [])
  assert.deepEqual(retained.peek('a'), [note('Warmer'), note('Crop', 'photo')])
})

void test('an accepted staged send keeps a copy from a recreated canvas at the same epoch', () => {
  const retained = retainedFor()
  retained.publish('a', 3, 'page-1', [note('Warmer')])
  // The canvas was closed and reopened: the restored pins publish a fresh
  // instance whose epoch restarts and collides with the staged draft's.
  retained.publish('a', 3, 'page-2', [note('Warmer'), note('Retitled', 'poster')])
  assert.deepEqual(retained.settle('a', 3, true, 'page-1'), [])
  assert.deepEqual(retained.peek('a'), [note('Warmer'), note('Retitled', 'poster')])
})

void test('a failed restore does not fail the attach and keeps the copy for the next attach', async () => {
  const retained = retainedFor()
  retained.publish('a', 3, 'page-1', [note('Warmer')])
  await retained.restoreInto('a', async () => {
    throw Error('canvas not ready')
  })
  let restored
  await retained.restoreInto('a', async (notes) => {
    restored = notes
  })
  assert.deepEqual(restored, [note('Warmer')])
})

void test('a successful restore keeps the copy until the canvas publishes its own state', async () => {
  const retained = retainedFor()
  retained.publish('a', 3, 'page-1', [note('Warmer')])
  await retained.restoreInto('a', async () => {})
  assert.deepEqual(retained.peek('a'), [note('Warmer')])
})

void test('a restore is skipped when nothing is retained', async () => {
  const retained = retainedFor()
  let calls = 0
  await retained.restoreInto('a', async () => {
    calls += 1
  })
  assert.equal(calls, 0)
})

void test('a flush that never settles times out, keeps the last copy, and reports failure', async () => {
  const retained = retainedFor()
  retained.publish('artwork:host-a', 3, 'page-1', [note('Warmer')])
  const timers = []
  const clock = {
    setTimeout: (run, ms) => {
      const timer = { run, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimeout: (timer) => {
      timer.cleared = true
    }
  }
  const pending = flushBeforeTeardown(() => new Promise(() => {}), 1500, clock)
  assert.equal(timers.length, 1)
  assert.equal(timers[0].ms, 1500)
  timers[0].run()
  assert.equal(await pending, false)
  assert.deepEqual(retained.peek('artwork:host-a'), [note('Warmer')])
})

void test('a flush that settles in time reports success and clears its timer', async () => {
  const timers = []
  const clock = {
    setTimeout: (run, ms) => {
      const timer = { run, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimeout: (timer) => {
      timer.cleared = true
    }
  }
  assert.equal(await flushBeforeTeardown(async () => {}, 1500, clock), true)
  assert.equal(timers[0].cleared, true)
})

void test('a flush that rejects reports failure without waiting for the timeout', async () => {
  const clock = { setTimeout: () => 0, clearTimeout: () => {} }
  assert.equal(
    await flushBeforeTeardown(() => Promise.reject(Error('Retired canvas')), 1500, clock),
    false
  )
})
