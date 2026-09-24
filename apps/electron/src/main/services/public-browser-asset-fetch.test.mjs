/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript test fixture. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { fetchSelectedBrowserImage } from './public-browser-asset-fetch.ts'

function fixture(responses, resolveAddresses = async () => ['8.8.8.8']) {
  const requests = []
  const args = {
    browserSession: {
      resolveProxy: async () => 'DIRECT',
      cookies: { get: async () => [{ name: 'session', value: 'synthetic' }] },
      getUserAgent: () => 'Molly test'
    },
    pageUrl: 'https://design.example/search',
    imageUrl: 'https://design.example/image',
    sites: ['design.example'],
    signal: new AbortController().signal
  }
  const network = {
    resolveAddresses,
    request(url, options, callback) {
      const reply = responses.shift()
      assert.ok(reply, 'Unexpected network request')
      let pinned
      options.lookup(url.hostname, { all: true }, (_error, addresses) => {
        pinned = addresses
      })
      requests.push({ url: url.toString(), headers: options.headers, pinned })
      const request = new EventEmitter()
      request.end = () => {
        const response = new PassThrough()
        response.socket = { remoteAddress: reply.peer ?? '8.8.8.8' }
        response.statusCode = reply.status ?? 200
        response.headers = reply.location ? { location: reply.location } : {}
        callback(response)
        response.end(reply.body ?? 'image-bytes')
      }
      request.destroy = (error) => {
        if (error) request.emit('error', error)
        return request
      }
      return request
    }
  }
  return { args, network, requests }
}

void test('each redirect revalidates the destination before opening another connection', async () => {
  const f = fixture([{ status: 302, location: 'http://127.0.0.1/private' }])
  await assert.rejects(fetchSelectedBrowserImage(f.args, f.network), /public|private|local/)
  assert.deepEqual(
    f.requests.map((request) => request.url),
    ['https://design.example/image']
  )
})

void test('pins the selected public DNS result and drops credentials on a different site', async () => {
  const f = fixture([{ status: 302, location: 'https://cdn.example/image' }, {}])
  const result = await fetchSelectedBrowserImage(f.args, f.network)
  assert.equal(result.finalUrl, 'https://cdn.example/image')
  assert.equal(Buffer.from(result.bytes).toString(), 'image-bytes')
  assert.deepEqual(
    f.requests.map((request) => ({ cookie: request.headers.Cookie, pinned: request.pinned })),
    [
      { cookie: 'session=synthetic', pinned: [{ address: '8.8.8.8', family: 4 }] },
      { cookie: undefined, pinned: [{ address: '8.8.8.8', family: 4 }] }
    ]
  )
})

void test('rejects a private DNS change between validation and the pinned connection', async () => {
  const answers = [['8.8.8.8'], ['192.168.1.8']]
  const f = fixture([], async () => answers.shift())
  await assert.rejects(fetchSelectedBrowserImage(f.args, f.network), /private/)
  assert.deepEqual(f.requests, [])
})

void test('refuses bytes from an unsafe response peer', async () => {
  const f = fixture([{ peer: '127.0.0.1' }])
  await assert.rejects(fetchSelectedBrowserImage(f.args, f.network), /unsafe address/)
})
