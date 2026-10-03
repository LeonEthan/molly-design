/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript test fixture. */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { fetchSelectedBrowserImage } from './public-browser-asset-fetch.ts'

const MAX_BYTES = 5 * 1024 * 1024

function response(status = 200, headers = {}) {
  const result = new EventEmitter()
  result.statusCode = status
  result.headers = headers
  return result
}

function fixture(replies, cookies = [{ name: 'session', value: 'synthetic' }]) {
  const requests = []
  const cancel = new AbortController()
  const args = {
    browserSession: {
      cookies: { get: async () => cookies },
      getUserAgent: () => 'Molly test'
    },
    pageUrl: 'https://www.design.example/search?synthetic=query',
    imageUrl: 'https://design.example/image',
    signal: cancel.signal
  }
  const createRequest = (options) => {
    const state = { ...options, aborted: false, bodyDelivered: false }
    requests.push(state)
    const request = new EventEmitter()
    request.abort = () => {
      state.aborted = true
      request.emit('abort')
    }
    request.end = () => {
      const reply = replies.shift()
      assert.ok(reply, 'Unexpected native request')
      if (typeof reply === 'function') {
        reply(request)
        return
      }
      const status = reply.status ?? 200
      if (reply.location) {
        request.emit('redirect', status, 'GET', new URL(reply.location, options.url).toString(), {
          location: [reply.location]
        })
        if (!state.aborted) request.emit('error', new Error('Redirect was cancelled'))
        return
      }
      const incoming = response(
        status,
        reply.length === undefined
          ? {}
          : {
              'content-length': String(reply.length)
            }
      )
      request.emit('response', incoming)
      for (const chunk of reply.chunks ?? [reply.body ?? 'image-bytes']) {
        if (state.aborted) return
        state.bodyDelivered = true
        incoming.emit('data', Buffer.from(chunk))
      }
      if (!state.aborted) incoming.emit('end')
    }
    return request
  }
  return {
    args,
    requests,
    cancel,
    createRequest,
    fetch: () => fetchSelectedBrowserImage(args, createRequest)
  }
}

void test('uses the browser Session transport for fake IPs and preserves source metadata', async () => {
  const f = fixture([{}])
  f.args.imageUrl = 'https://198.18.0.8/image'
  const result = await f.fetch()
  assert.equal(Buffer.from(result.bytes).toString(), 'image-bytes')
  assert.equal(result.finalUrl, f.args.imageUrl)
  assert.equal(f.requests[0].session, f.args.browserSession)
  assert.equal(f.requests[0].url, f.args.imageUrl)
  assert.equal(f.requests[0].redirect, 'manual')
  assert.equal(f.requests[0].referrerPolicy, 'origin')
  assert.equal(f.requests[0].credentials, 'omit')
  assert.equal(f.requests[0].headers['User-Agent'], 'Molly test')
  assert.equal(f.requests[0].headers.Referer, 'https://www.design.example/')
  assert.ok(!('Cookie' in f.requests[0].headers))
})

void test('native transport follows local targets without transferring site cookies', async () => {
  const f = fixture([{ status: 302, location: 'http://127.0.0.1/image' }, {}])
  assert.equal((await f.fetch()).finalUrl, 'http://127.0.0.1/image')
  assert.deepEqual(
    f.requests.map(({ url, credentials }) => ({ url, credentials })),
    [
      { url: 'https://design.example/image', credentials: 'include' },
      { url: 'http://127.0.0.1/image', credentials: 'omit' }
    ]
  )
  assert.equal(f.requests[0].aborted, true)
})

void test('native cookies are enabled only for HTTPS in the page site context at each hop', async () => {
  const f = fixture([
    { status: 302, location: 'https://images.design.example/image' },
    { status: 307, location: 'https://cdn.example/image' },
    { status: 308, location: 'http://design.example/image' },
    {}
  ])
  assert.equal((await f.fetch()).finalUrl, 'http://design.example/image')
  assert.deepEqual(
    f.requests.map(({ credentials }) => credentials),
    ['include', 'include', 'omit', 'omit']
  )
  assert.ok(f.requests.every(({ headers }) => !('Cookie' in headers)))
})

void test('retains an explicit root cookie context across sibling image hosts without deriving a broader site', async () => {
  const f = fixture([{}, {}])
  f.args.pageUrl = 'https://app.design.example/search'
  f.args.imageUrl = 'https://images.design.example/image'
  f.args.imageCookieContext = 'design.example'
  await f.fetch()
  delete f.args.imageCookieContext
  await f.fetch()
  assert.deepEqual(
    f.requests.map(({ credentials }) => credentials),
    ['include', 'omit']
  )
})

void test('cookie budget is retained without hand-assembling cookie headers', async () => {
  const f = fixture([{}], [{ name: 'session', value: 'x'.repeat(16_000) }])
  await assert.rejects(f.fetch(), /too many cookies/)
  f.args.imageUrl = 'https://cdn.example/image'
  assert.equal(Buffer.from((await f.fetch()).bytes).toString(), 'image-bytes')
  assert.equal(f.requests[0].credentials, 'omit')
})

void test('resolves relative locations and accepts five redirects', async () => {
  const f = fixture([
    ...Array.from({ length: 5 }, (_, index) => ({ status: 302, location: `/image-${index}` })),
    {}
  ])
  assert.equal((await f.fetch()).finalUrl, 'https://design.example/image-4')
})

void test('rejects excess redirects, missing locations, and unsuccessful responses', async () => {
  for (const [replies, error] of [
    [Array.from({ length: 6 }, () => ({ status: 302, location: '/next' })), /too many redirects/],
    [[{ status: 302 }], /no location/],
    [[{ status: 404 }], /HTTP 404/]
  ]) {
    await assert.rejects(fixture(replies).fetch(), error)
  }
})

void test('accepts exactly five MiB and refuses empty bodies', async () => {
  const f = fixture([{ body: new Uint8Array(MAX_BYTES), length: MAX_BYTES }])
  assert.equal((await f.fetch()).bytes.length, MAX_BYTES)
  await assert.rejects(fixture([{ body: '' }]).fetch(), /empty/)
})

void test('declared oversized bodies abort the native request before data is delivered', async () => {
  const f = fixture([{ body: 'synthetic', length: MAX_BYTES + 1 }])
  await assert.rejects(f.fetch(), /5 MiB/)
  assert.equal(f.requests[0].aborted, true)
  assert.equal(f.requests[0].bodyDelivered, false)
})

void test('streamed caps abort native requests when length is missing or underreported', async () => {
  for (const length of [undefined, '1']) {
    const f = fixture([{ chunks: [new Uint8Array(MAX_BYTES), new Uint8Array(1)], length }])
    await assert.rejects(f.fetch(), /5 MiB/)
    assert.equal(f.requests[0].aborted, true)
  }
})

void test('request and response errors are returned while native work is aborted', async () => {
  for (const reply of [
    (request) => request.emit('error', new Error('synthetic transport error')),
    (request) => {
      const incoming = response()
      request.emit('response', incoming)
      incoming.emit('error', new Error('synthetic body error'))
    },
    (request) => {
      const incoming = response()
      request.emit('response', incoming)
      incoming.emit('aborted')
    }
  ]) {
    const f = fixture([reply])
    await assert.rejects(f.fetch(), /synthetic|aborted/)
    assert.equal(f.requests[0].aborted, true)
  }
})

void test('preexisting cancellation prevents a native request', async () => {
  const f = fixture([])
  const reason = new Error('synthetic cancellation')
  f.cancel.abort(reason)
  await assert.rejects(f.fetch(), (error) => error === reason)
})

void test('active native request cancellation preserves the reason', async () => {
  const started = Promise.withResolvers()
  const f = fixture([(request) => started.resolve(request)])
  const fetching = f.fetch()
  await started.promise
  const reason = new Error('synthetic takeover')
  f.cancel.abort(reason)
  await assert.rejects(fetching, (error) => error === reason)
  assert.equal(f.requests[0].aborted, true)
})

void test('the deadline aborts a native request that never receives headers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const started = Promise.withResolvers()
  const f = fixture([(request) => started.resolve(request)])
  const fetching = f.fetch()
  await started.promise
  t.mock.timers.tick(15_000)
  await assert.rejects(fetching, /timed out/)
  assert.equal(f.requests[0].aborted, true)
})

void test('the deadline includes a native body that stalls after headers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const reading = Promise.withResolvers()
  const f = fixture([
    (request) => {
      request.emit('response', response())
      reading.resolve()
    }
  ])
  const fetching = f.fetch()
  await reading.promise
  t.mock.timers.tick(15_000)
  await assert.rejects(fetching, /timed out/)
  assert.equal(f.requests[0].aborted, true)
})

void test('the deadline includes a stalled cookie query without a later request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const queried = Promise.withResolvers()
  const cookies = Promise.withResolvers()
  const f = fixture([])
  f.args.browserSession.cookies.get = () => {
    queried.resolve()
    return cookies.promise
  }
  const fetching = f.fetch()
  await queried.promise
  t.mock.timers.tick(15_000)
  await assert.rejects(fetching, /timed out/)
  cookies.resolve([])
})

void test('a native request created after cancellation is aborted before dispatch', async () => {
  const created = Promise.withResolvers()
  const nativeAborted = Promise.withResolvers()
  const gate = Promise.withResolvers()
  const request = new EventEmitter()
  request.abort = () => nativeAborted.resolve(true)
  request.end = () => assert.fail('Canceled native request must not dispatch')
  const f = fixture([])
  const fetching = fetchSelectedBrowserImage(f.args, async () => {
    created.resolve()
    await gate.promise
    return request
  })
  await created.promise
  f.cancel.abort(new Error('synthetic cancellation during import'))
  await assert.rejects(fetching, /synthetic cancellation/)
  gate.resolve()
  assert.equal(await nativeAborted.promise, true)
})
