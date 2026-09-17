import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import { DesignWorker, quitDesignWorker } from './design-worker.ts'

const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const child = () => {
  const process = new EventEmitter()
  process.pid = 100
  process.stdin = new PassThrough()
  process.stdout = new PassThrough()
  process.stderr = new PassThrough()
  return process
}

void test('shutdown drains accepted requests, seals admission and awaits actual exit after stdin end', async () => {
  const process = child()
  const writes = []
  const firstSent = deferred()
  const secondSent = deferred()
  process.stdin.on('data', (bytes) => {
    const request = JSON.parse(bytes.toString())
    writes.push(request)
    if (request.operation === 'first') firstSent.resolve()
    else secondSent.resolve()
  })
  const worker = new DesignWorker(() => process)
  const first = worker.request({ operation: 'first' })
  const second = worker.request({ operation: 'second' })
  await firstSent.promise
  let closed = false
  const ended = once(process.stdin, 'finish')
  const closing = worker.close().then(() => {
    closed = true
  })
  await assert.rejects(worker.request({ operation: 'late' }), /shutting down/)
  assert.deepEqual(writes, [{ operation: 'first' }])
  process.stdout.write(JSON.stringify({ ok: true, value: 'first-result' }) + '\n')
  await secondSent.promise
  assert.equal(await first, 'first-result')
  assert.equal(closed, false)
  process.stdout.write(JSON.stringify({ ok: true, value: 'second-result' }) + '\n')
  assert.equal(await second, 'second-result')
  await ended
  assert.equal(closed, false)
  process.emit('exit', 0)
  await closing
  await worker.close()
  await assert.rejects(worker.request({ operation: 'restart' }), /shutting down/)
  assert.deepEqual(writes, [{ operation: 'first' }, { operation: 'second' }])
})

void test('unused worker closes without starting a process, including headless use', async () => {
  const worker = new DesignWorker(() => {
    throw Error('must not spawn')
  })
  await worker.close()
  await assert.rejects(worker.request({ operation: 'read' }), /shutting down/)
})

void test('a failed request does not prevent draining accepted work and process exit', async () => {
  const process = child()
  const sent = deferred()
  process.stdin.on('data', () => sent.resolve())
  const worker = new DesignWorker(() => process)
  const invalid = worker.request({}, () => {
    throw Error('changed canvas')
  })
  const accepted = worker.request({ operation: 'read' })
  const failure = assert.rejects(invalid, /changed canvas/)
  const ended = once(process.stdin, 'finish')
  const closing = worker.close()
  await sent.promise
  process.stdout.write(JSON.stringify({ ok: false, error: 'missing drawing' }) + '\n')
  await assert.rejects(accepted, /missing drawing/)
  await failure
  await ended
  process.emit('exit', 0)
  await closing
})

void test('cancelled flush keeps the worker usable; successful flush saves before disposal and shutdown', async () => {
  const process = child()
  const sent = deferred()
  process.stdin.on('data', () => sent.resolve())
  const worker = new DesignWorker(() => process)
  const cancelled = deferred()
  let disposed = false
  const dispose = () => {
    disposed = true
  }
  const cancelledQuit = quitDesignWorker(worker, () => cancelled.promise, dispose)
  cancelled.resolve(false)
  assert.equal(await cancelledQuit, false)
  assert.equal(disposed, false)
  const save = worker.request({ operation: 'save' })
  await sent.promise
  const ended = once(process.stdin, 'finish')
  const quitting = quitDesignWorker(
    worker,
    async () => {
      assert.equal(await save, 'saved')
      return true
    },
    dispose
  )
  assert.equal(disposed, false)
  assert.equal(process.stdin.writableEnded, false)
  process.stdout.write(JSON.stringify({ ok: true, value: 'saved' }) + '\n')
  await ended
  assert.equal(disposed, true)
  await assert.rejects(worker.request({ operation: 'read' }), /shutting down/)
  process.emit('exit', 0)
  assert.equal(await quitting, true)
})
