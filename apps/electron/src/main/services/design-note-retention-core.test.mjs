import assert from 'node:assert/strict'
import test from 'node:test'
import { createRetainedNotes } from './design-note-retention-core.ts'

void test('hands retained notes to the next frame exactly once', () => {
  const retained = createRetainedNotes()
  const notes = [{ elementIds: ['title'], prompt: 'Warmer' }]
  retained.retain('host-a', notes)
  assert.deepEqual(retained.peek('host-a'), notes)
  retained.release('host-a')
  assert.deepEqual(retained.peek('host-a'), [])
})

void test('keeps each host separate', () => {
  const retained = createRetainedNotes()
  retained.retain('host-a', ['a'])
  retained.retain('host-b', ['b'])
  assert.deepEqual(retained.peek('host-b'), ['b'])
  assert.deepEqual(retained.peek('host-a'), ['a'])
})

void test('a successful read with no notes clears the earlier snapshot', () => {
  const retained = createRetainedNotes()
  retained.retain('host-a', ['cleared by the user or an accepted send'])
  retained.retain('host-a', [])
  assert.deepEqual(retained.peek('host-a'), [])
})

void test('an unreadable canvas keeps the last good snapshot', () => {
  const retained = createRetainedNotes()
  retained.retain('host-a', ['good'])
  retained.retain('host-a', null)
  assert.deepEqual(retained.peek('host-a'), ['good'])
})

void test('peek leaves the snapshot until release, so a failed restore can retry', () => {
  const retained = createRetainedNotes()
  retained.retain('host-a', ['kept'])
  assert.deepEqual(retained.peek('host-a'), ['kept'])
  assert.deepEqual(retained.peek('host-a'), ['kept'])
  retained.release('host-a')
  assert.deepEqual(retained.peek('host-a'), [])
})

void test('forget drops notes when the instance is torn down for good', () => {
  const retained = createRetainedNotes()
  retained.retain('host-a', ['kept'])
  retained.forget('host-a')
  assert.deepEqual(retained.peek('host-a'), [])
})
