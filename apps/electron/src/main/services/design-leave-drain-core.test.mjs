import assert from 'node:assert/strict'
import test from 'node:test'
import { drainRelevantLoads } from './design-leave-drain-core.ts'

// Thenables, not real promises: touching one must invoke `then`, so each
// record proves exactly which loads the drain awaited. No timers anywhere.
// Like production (`opening.finally(() => loading.delete(hostId))`), a
// settled load leaves the map; without that the drain could never end.
const settled = (loading, calls, name, effect) => ({
  then(resolve, _reject) {
    calls.push(name)
    loading.delete(name)
    if (effect) effect()
    return resolve === undefined ? undefined : resolve()
  }
})
const failing = (loading, calls, name) => ({
  then(resolve, reject) {
    calls.push(name)
    loading.delete(name)
    return reject === undefined ? undefined : reject(Error('load failed'))
  }
})

void test('awaits the requested host only', async () => {
  const calls = []
  const loading = new Map()
  loading.set('a', settled(loading, calls, 'a'))
  loading.set('b', settled(loading, calls, 'b'))
  await drainRelevantLoads(loading, new Map(), 'art', 'a')
  assert.deepEqual(calls, ['a'])
})

void test('leave-all awaits this artwork plus unknown hosts, not others', async () => {
  const calls = []
  const loading = new Map()
  loading.set('mine', settled(loading, calls, 'mine'))
  loading.set('hidden', settled(loading, calls, 'hidden'))
  loading.set('other', settled(loading, calls, 'other'))
  const hosts = new Map([
    ['mine', 'art'],
    ['other', 'different']
  ])
  await drainRelevantLoads(loading, hosts, 'art')
  assert.deepEqual(calls.sort(), ['hidden', 'mine'])
})

void test('re-checks loads that start mid-drain', async () => {
  const calls = []
  const loading = new Map()
  loading.set(
    'first',
    settled(loading, calls, 'first', () => {
      loading.set('second', settled(loading, calls, 'second'))
    })
  )
  await drainRelevantLoads(loading, new Map(), 'art')
  assert.deepEqual(calls, ['first', 'second'])
})

void test('a failed load continues instead of throwing', async () => {
  const calls = []
  const loading = new Map()
  loading.set('broken', failing(loading, calls, 'broken'))
  await drainRelevantLoads(loading, new Map(), 'art')
  assert.deepEqual(calls, ['broken'])
})

void test('returns at once when nothing relevant is loading', async () => {
  const calls = []
  const loading = new Map()
  loading.set('other', settled(loading, calls, 'other'))
  await drainRelevantLoads(loading, new Map([['other', 'different']]), 'art')
  assert.deepEqual(calls, [])
})
