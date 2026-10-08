import assert from 'node:assert/strict'
import test from 'node:test'
import { DesignThumbnails } from './design-thumbnail-core.ts'

function harness(initialRevision = 'r1') {
  const state = {
    revision: initialRevision,
    cache: new Map(),
    rendered: [],
    gate: undefined,
    blank: false
  }
  const thumbnails = new DesignThumbnails({
    readSaved: async () => ({
      revisionId: state.revision,
      doc: { elements: state.blank ? [] : [{ id: 'a' }] }
    }),
    render: async (saved) => {
      if (state.gate) await state.gate
      if (saved.revisionId === 'broken') throw Error('render failed')
      state.rendered.push(saved.revisionId)
      return `data:${saved.revisionId}`
    },
    readCached: async (id) => state.cache.get(id),
    writeCached: async (id, thumbnail) => {
      state.cache.set(id, thumbnail)
    }
  })
  return { state, thumbnails }
}

void test('showing a row renders once, then serves the cache even after edits', async () => {
  const { state, thumbnails } = harness()
  assert.equal(await thumbnails.get('art'), 'data:r1')
  state.revision = 'r2'
  assert.equal(await thumbnails.get('art'), 'data:r1')
  assert.deepEqual(state.rendered, ['r1'])
})

void test('refresh renders only when the saved revision moved', async () => {
  const { state, thumbnails } = harness()
  await thumbnails.get('art')
  assert.equal(await thumbnails.refresh('art'), 'data:r1')
  state.revision = 'r2'
  assert.equal(await thumbnails.refresh('art'), 'data:r2')
  assert.equal(await thumbnails.get('art'), 'data:r2')
  assert.deepEqual(state.rendered, ['r1', 'r2'])
})

void test('concurrent refreshes of one artwork share a render', async () => {
  const { state, thumbnails } = harness()
  let open
  state.gate = new Promise((resolve) => (open = resolve))
  const first = thumbnails.refresh('art')
  const second = thumbnails.refresh('art')
  open()
  assert.deepEqual(await Promise.all([first, second]), ['data:r1', 'data:r1'])
  assert.deepEqual(state.rendered, ['r1'])
})

void test('a refresh requested during a render picks up the newer save', async () => {
  const { state, thumbnails } = harness()
  let open
  state.gate = new Promise((resolve) => (open = resolve))
  const first = thumbnails.refresh('art')
  await new Promise((resolve) => setImmediate(resolve))
  state.revision = 'r2'
  const second = thumbnails.refresh('art')
  const third = thumbnails.refresh('art')
  open()
  assert.deepEqual(await Promise.all([first, second, third]), ['data:r1', 'data:r2', 'data:r2'])
  assert.equal(await thumbnails.get('art'), 'data:r2')
  assert.deepEqual(state.rendered, ['r1', 'r2'])
})

void test('a failed render is not cached and does not block the next artwork', async () => {
  const { state, thumbnails } = harness('broken')
  await assert.rejects(thumbnails.get('art'), /render failed/)
  assert.equal(state.cache.has('art'), false)
  state.revision = 'r3'
  assert.equal(await thumbnails.get('other'), 'data:r3')
  assert.equal(await thumbnails.get('art'), 'data:r3')
})

void test('a canvas with no elements is cached as blank without rendering', async () => {
  const { state, thumbnails } = harness()
  state.blank = true
  assert.equal(await thumbnails.get('art'), '')
  assert.deepEqual(state.cache.get('art'), { revisionId: 'r1', dataUrl: '' })
  assert.deepEqual(state.rendered, [])
  state.blank = false
  state.revision = 'r2'
  assert.equal(await thumbnails.refresh('art'), 'data:r2')
})
