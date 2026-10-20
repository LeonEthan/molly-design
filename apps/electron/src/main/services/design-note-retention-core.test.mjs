import assert from 'node:assert/strict'
import test from 'node:test'
import { createRetainedNotes } from './design-note-retention-core.ts'

void test('hands retained notes to the next frame exactly once', () => {
  const retained = createRetainedNotes()
  const notes = [{ elementIds: ['title'], prompt: 'Warmer' }]
  retained.retain('host-a', notes)
  assert.deepEqual(retained.take('host-a'), notes)
  assert.deepEqual(retained.take('host-a'), [])
})

void test('keeps each host separate', () => {
  const retained = createRetainedNotes()
  retained.retain('host-a', ['a'])
  retained.retain('host-b', ['b'])
  assert.deepEqual(retained.take('host-b'), ['b'])
  assert.deepEqual(retained.take('host-a'), ['a'])
})

void test('an empty retain replaces an earlier snapshot with nothing', () => {
  const retained = createRetainedNotes()
  retained.retain('host-a', ['stale'])
  retained.retain('host-a', [])
  assert.deepEqual(retained.take('host-a'), [])
})

void test('forget drops notes when the instance is destroyed', () => {
  const retained = createRetainedNotes()
  retained.retain('host-a', ['kept'])
  retained.forget('host-a')
  assert.deepEqual(retained.take('host-a'), [])
})
