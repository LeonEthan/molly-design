import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm, open, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalFileResources } from './local-file-resource.ts'

async function fixture(t, name, content) {
  const dir = await mkdtemp(join(tmpdir(), 'molly-resource-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, name)
  await writeFile(path, content)
  return { status: 'local-file', path: name, absolutePath: path, external: false }
}

void test('small UTF-8 documents retain full content and a save-compatible digest', async (t) => {
  const file = await fixture(t, 'small.txt', '\ufeff中文\r\n')
  const result = await new LocalFileResources().preview(1, file)
  assert.equal(result.status, 'ok')
  assert.equal(result.content.text, '\ufeff中文\r\n')
  assert.deepEqual(result.format, { bom: true, eol: 'crlf' })
  assert.match(result.digest, /^sha256:[0-9a-f]{64}$/)
})

void test('a small local attachment downloads its original bytes through a resource', async (t) => {
  const bytes = Buffer.from('\ufeff中文\r\n', 'utf8')
  const file = await fixture(t, 'attachment.txt', bytes)
  const resources = new LocalFileResources()
  const result = await resources.preview(1, file, true)
  assert.equal(result.status, 'resource')
  assert.equal(result.kind, 'text')
  const response = await resources.respond(
    new Request(result.url, { headers: { Range: `bytes=0-${bytes.length - 1}` } })
  )
  assert.equal(response.status, 206)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
})

void test('a multi-gigabyte sparse file opens as a resource and only requested bytes are returned', async (t) => {
  const file = await fixture(t, 'large.txt', 'header\n'.repeat(1200))
  const handle = await open(file.absolutePath, 'r+')
  await handle.truncate(3 * 1024 ** 3)
  await handle.write(Buffer.from('tail'), 0, 4, 3 * 1024 ** 3 - 4)
  await handle.close()
  const resources = new LocalFileResources()
  const result = await resources.preview(1, file)
  assert.equal(result.status, 'resource')
  assert.equal(result.kind, 'text')
  assert.equal(result.sizeBytes, 3 * 1024 ** 3)
  assert.equal((await resources.respond(new Request(result.url))).status, 416)
  const response = await resources.respond(
    new Request(result.url, { headers: { Range: `bytes=${result.sizeBytes - 4}-` } })
  )
  assert.equal(response.status, 206)
  assert.equal(await response.text(), 'tail')
  const excessive = await resources.respond(
    new Request(result.url, { headers: { Range: 'bytes=0-1000000' } })
  )
  assert.equal(excessive.status, 416)
})

void test('binary resources stream raw bytes, support ranges, and expire with their owner', async (t) => {
  const bytes = syntheticPng(1024 * 1024)
  const file = await fixture(t, 'image.png', bytes)
  const resources = new LocalFileResources()
  const result = await resources.preview(8, file)
  assert.equal(result.status, 'resource')
  assert.equal(result.kind, 'binary')
  const response = await resources.respond(
    new Request(result.url, { headers: { Range: 'bytes=10-19' } })
  )
  assert.equal(response.status, 206)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(10, 20))
  assert.equal(response.headers.get('Content-Security-Policy'), "default-src 'none'; sandbox")
  resources.releaseOwner(9)
  assert.equal((await resources.respond(new Request(result.url, { method: 'HEAD' }))).status, 200)
  resources.releaseOwner(8)
  assert.equal((await resources.respond(new Request(result.url))).status, 404)
})

void test('replacing a file invalidates every existing resource URL', async (t) => {
  const file = await fixture(t, 'large.txt', 'a'.repeat(600_000))
  const resources = new LocalFileResources()
  const result = await resources.preview(1, file)
  await writeFile(file.absolutePath + '.new', 'b'.repeat(600_000))
  await rename(file.absolutePath + '.new', file.absolutePath)
  assert.equal(
    (await resources.respond(new Request(result.url, { headers: { Range: 'bytes=0-10' } }))).status,
    409
  )
})

void test('cancelling a binary stream releases it without reading the remaining file', async (t) => {
  const file = await fixture(t, 'image.png', syntheticPng(1024 * 1024))
  const resources = new LocalFileResources()
  const result = await resources.preview(1, file)
  const response = await resources.respond(new Request(result.url))
  const reader = response.body.getReader()
  const first = await reader.read()
  assert.equal(first.value.length, 64 * 1024)
  await reader.cancel()
  assert.equal((await reader.read()).done, true)
})

function syntheticPng(length, width = 16, height = 16) {
  const bytes = Buffer.alloc(length)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

void test('image decode budget is based on dimensions, not encoded file length', async (t) => {
  const file = await fixture(t, 'huge.png', syntheticPng(32, 32768, 32768))
  const result = await new LocalFileResources().preview(1, file)
  assert.equal(result.status, 'error')
  assert.equal(result.code, 'too_large')
  assert.match(result.message, /dimensions/)
})

void test('a change during a stream read is rejected before its bytes are exposed', async (t) => {
  const file = await fixture(t, 'large.txt', 'a'.repeat(600_000))
  const resources = new LocalFileResources()
  const result = await resources.preview(1, file)
  const writer = await open(file.absolutePath, 'r+')
  t.after(() => writer.close())
  const prototype = Object.getPrototypeOf(writer)
  const read = prototype.read
  t.mock.method(prototype, 'read', async function (...args) {
    const chunk = await read.apply(this, args)
    // Explicitly change the revision between the read and delivery; no timer race.
    await writer.truncate(600_001)
    return chunk
  })
  const response = await resources.respond(
    new Request(result.url, { headers: { Range: 'bytes=0-10' } })
  )
  await assert.rejects(response.arrayBuffer(), /File changed/)
})

for (const extension of ['bmp', 'ico']) {
  void test(`${extension} headers remain previewable without library dimension support`, async (t) => {
    const bytes = Buffer.alloc(64)
    if (extension === 'bmp') {
      bytes.write('BM')
      bytes.writeUInt32LE(40, 14)
      bytes.writeInt32LE(16, 18)
      bytes.writeInt32LE(16, 22)
    } else {
      bytes.writeUInt16LE(1, 2)
      bytes.writeUInt16LE(1, 4)
      bytes[6] = 16
      bytes[7] = 16
    }
    const file = await fixture(t, `image.${extension}`, bytes)
    const resources = new LocalFileResources()
    const result = await resources.preview(1, file)
    assert.equal(result.status, 'resource')
    const response = await resources.respond(new Request(result.url))
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
  })
}

void test('historical JSON and embedded assets survive reopening through opaque paged file resources', async (t) => {
  const content = JSON.parse(
    await readFile(
      new URL('../../../../../packages/design-bento/sample.json', import.meta.url),
      'utf8'
    )
  )
  const original = Buffer.from(' '.repeat(600_000) + JSON.stringify({ version: 1, content }))
  const file = await fixture(t, 'historical.json', original)
  file.external = true
  const first = new LocalFileResources()
  const preview = await first.preview(1, file)
  assert.equal(preview.status, 'resource')
  assert.equal(preview.external, true)
  assert.equal(preview.url.includes(file.absolutePath), false)
  first.releaseOwner(1)
  assert.equal((await first.respond(new Request(preview.url))).status, 404)
  const reopened = new LocalFileResources()
  const current = await reopened.preview(2, file)
  const chunks = []
  for (let offset = 0; offset < original.length; offset += 64 * 1024) {
    const response = await reopened.respond(
      new Request(current.url, {
        headers: { Range: `bytes=${offset}-${Math.min(offset + 64 * 1024, original.length) - 1}` }
      })
    )
    assert.equal(response.status, 206)
    chunks.push(Buffer.from(await response.arrayBuffer()))
  }
  const actual = Buffer.concat(chunks)
  assert.deepEqual(actual, original)
  const restored = JSON.parse(actual.toString()).content
  assert.deepEqual(restored.doc, content.doc)
  assert.ok(Object.keys(restored.assets).length > 0)
  for (const [hash, dataUri] of Object.entries(restored.assets)) {
    const bytes = Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64')
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash)
  }
})
