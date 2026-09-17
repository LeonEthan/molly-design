/**
 * The desktop's preview render loop (P2.4b), driven without timers or Electron.
 *
 * The loop is a state machine about what it owes the daemon: one render per
 * request, one report per render, and a report that is only delivered once the
 * daemon has actually heard it. Every case below is about that promise rather
 * than about rasterizing anything.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DesignRenderHostLoop,
  MAX_REPORT_ERROR_CHARS,
  MAX_REPORTS_PER_POLL
} from './design-render-host-core.ts'

/** Let every already-scheduled promise callback run. */
const flush = () => new Promise((resolve) => setImmediate(resolve))

const work = (requestId, overrides = {}) => ({
  requestId,
  payloadPath: `/data/design-preview-stage/${requestId}.json`,
  outputPath: `/data/chats/session-1/design-preview/${requestId}.png`,
  width: 320,
  height: 200,
  ...overrides
})

/**
 * A loop whose every call is recorded and whose renders finish only when the
 * test says so — which is what makes "reported on a later poll" a real state
 * rather than a race.
 */
function createLoop(overrides = {}) {
  const state = {
    sent: [],
    rendered: [],
    written: [],
    pollErrors: [],
    gates: new Map()
  }
  const gateFor = (requestId) => {
    const existing = state.gates.get(requestId)
    if (existing) return existing
    let release
    let reject
    const promise = new Promise((resolve, fail) => {
      release = resolve
      reject = fail
    })
    const gate = { promise, release, reject }
    state.gates.set(requestId, gate)
    return gate
  }
  state.gateFor = gateFor
  const queue = []
  state.queue = queue
  const loop = new DesignRenderHostLoop({
    exchange: async (reports) => {
      state.sent.push(reports)
      if (state.failNextExchange) {
        state.failNextExchange = false
        throw new Error('the daemon is not there')
      }
      return queue.shift() ?? []
    },
    // The staged payload the daemon wrote carries the request's identity (the
    // daemon names the staging file after it), which is what lets the render and
    // its report be addressed to the same request.
    readPayload: async (payloadPath) => ({
      requestId: payloadPath.slice(payloadPath.lastIndexOf('/') + 1, -'.json'.length),
      payloadPath
    }),
    renderPng: async (payload) => {
      state.rendered.push(payload.payloadPath)
      return await gateFor(payload.requestId).promise
    },
    writeOutput: async (outputPath, bytes) => {
      state.written.push({ outputPath, bytes })
    },
    log: (message) => state.pollErrors.push(message),
    ...overrides
  })
  return { loop, state, queue, gateFor }
}

void test('reports nothing until a render finishes, then reports it on a later poll', async () => {
  const { loop, state } = createLoop()
  // Seeded before the poll: the render only finishes when the test says so, so
  // "handed out but not yet rendered" is a state we can hold and assert.
  const gate = state.gateFor('one')
  state.queue.push([work('one')])

  await loop.pollOnce()
  // Handed out, nothing to say yet: the daemon must not hear "done" early.
  assert.deepEqual(state.sent, [[]])
  assert.deepEqual(state.rendered, ['/data/design-preview-stage/one.json'])

  gate.release(new Uint8Array([1, 2, 3]))
  await flush()

  await loop.pollOnce()
  assert.deepEqual(state.sent[1], [{ requestId: 'one', ok: true }])
  // The bytes went to the path the daemon chose, once.
  assert.deepEqual(state.written, [
    { outputPath: '/data/chats/session-1/design-preview/one.png', bytes: new Uint8Array([1, 2, 3]) }
  ])
})

void test('keeps a report through a failed poll instead of losing or re-sending it once', async () => {
  const { loop, state } = createLoop()
  const gate = state.gateFor('one')
  state.queue.push([work('one')])
  await loop.pollOnce()
  gate.release(new Uint8Array([7]))
  await flush()

  // The daemon is unreachable for the poll that would have carried the report.
  state.failNextExchange = true
  await loop.pollOnce()
  assert.equal(state.pollErrors.length, 1)

  // Nothing was delivered, so nothing was recorded as delivered: the next poll
  // carries it, and it is still only reported once.
  await loop.pollOnce()
  assert.deepEqual(state.sent[2], [{ requestId: 'one', ok: true }])
  await loop.pollOnce()
  assert.deepEqual(state.sent[3], [])
})

void test('renders a request once even if the daemon hands it out again', async () => {
  const { loop, state } = createLoop()
  const gate = state.gateFor('one')
  state.queue.push([work('one')])
  await loop.pollOnce()
  // A daemon that never saw it settle hands out the same id again while the
  // first render is still in flight; a second render would race for the path.
  state.queue.push([work('one')])
  await loop.pollOnce()

  assert.equal(state.rendered.length, 1)

  gate.release(new Uint8Array([1]))
  await flush()
  await loop.pollOnce()
  assert.deepEqual(state.sent[2], [{ requestId: 'one', ok: true }])
})

void test('turns a render failure into the daemon’s honest refusal', async () => {
  const { loop, state } = createLoop()
  const gate = state.gateFor('one')
  state.queue.push([work('one')])
  await loop.pollOnce()
  gate.reject(new Error('font failed to load'))
  await flush()

  await loop.pollOnce()
  assert.deepEqual(state.sent[1], [{ requestId: 'one', ok: false, error: 'font failed to load' }])
  assert.deepEqual(state.written, [])
})

void test('bounds a render error, and never reports an empty one', async () => {
  const { loop, state } = createLoop()
  const first = state.gateFor('one')
  const second = state.gateFor('two')
  state.queue.push([work('one'), work('two')])
  await loop.pollOnce()
  first.reject(new Error('x'.repeat(MAX_REPORT_ERROR_CHARS + 250)))
  second.reject(new Error('   '))
  await flush()

  await loop.pollOnce()
  const reports = state.sent[1]
  assert.equal(reports.length, 2)
  assert.equal(reports[0].error.length, MAX_REPORT_ERROR_CHARS)
  // The daemon's schema rejects an empty message, so the loop must not send one.
  assert.equal(reports[1].error, 'the preview could not be rendered')
})

void test(`delivers at most ${MAX_REPORTS_PER_POLL} reports per poll and holds the rest`, async () => {
  const { loop, state } = createLoop()
  const batch = Array.from({ length: MAX_REPORTS_PER_POLL + 1 }, (_, index) => work(`w-${index}`))
  const gates = batch.map((item) => state.gateFor(item.requestId))
  state.queue.push(batch)
  await loop.pollOnce()
  for (const gate of gates) gate.release(new Uint8Array([1]))
  await flush()

  await loop.pollOnce()
  assert.equal(state.sent[1].length, MAX_REPORTS_PER_POLL)
  // An oversized batch would fail the daemon's schema and cost every report in
  // it, so the overflow waits for the next poll rather than being sent.
  await loop.pollOnce()
  assert.deepEqual(state.sent[2], [{ requestId: `w-${MAX_REPORTS_PER_POLL}`, ok: true }])
})

void test('polls immediately, then on the interval, and stops when told', async () => {
  const timers = []
  let cleared = 0
  const { loop, state } = createLoop({
    setTimer: (handler, ms) => {
      const handle = { handler, ms }
      timers.push(handle)
      return handle
    },
    clearTimer: () => {
      cleared += 1
    }
  })

  loop.start(2_000)
  await flush()
  assert.equal(state.sent.length, 1, 'the first poll happens on start, not after an interval')
  assert.equal(timers.length, 1)
  assert.equal(timers[0].ms, 2_000)

  timers[0].handler()
  await flush()
  assert.equal(state.sent.length, 2)
  assert.equal(timers.length, 2)

  loop.stop()
  assert.equal(cleared, 1)
  // A stopped loop schedules nothing further: the daemon notices the liveness
  // gap itself and fails whatever the old host was holding.
  assert.equal(timers.length, 2)

  // Stopping is idempotent and starting twice does not double the period.
  loop.stop()
  assert.equal(cleared, 1)
  loop.start(2_000)
  loop.start(2_000)
  await flush()
  assert.equal(timers.length, 3)
})

void test('stop() only stops scheduling: an answer the loop already owes is still delivered', async () => {
  const { loop, state } = createLoop()
  const gate = state.gateFor('one')
  state.queue.push([work('one')])
  await loop.pollOnce()
  loop.stop()
  gate.release(new Uint8Array([1]))
  await flush()

  await loop.pollOnce()
  // `pollOnce` is independent of `running`, so the report is still owed — the
  // loop only stops *scheduling*, it does not abandon an answer it already has.
  assert.deepEqual(state.sent[1], [{ requestId: 'one', ok: true }])
})
