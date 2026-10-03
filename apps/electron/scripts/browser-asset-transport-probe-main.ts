import assert from 'node:assert/strict'
import { randomUUID, X509Certificate } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import { join } from 'node:path'
import { app, net, session, type Session } from 'electron'
import { fetchSelectedBrowserImage } from '../src/main/services/public-browser-asset-fetch.ts'

declare const PROBE_OUTPUT: string

const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/K1sAAAAASUVORK5CYII=',
  'base64'
)
const observations: Array<Record<string, unknown>> = []
const signals = new EventEmitter()
const certificate = readFileSync(join(PROBE_OUTPUT, 'fixture-cert.pem'), 'utf8')
const certificateFingerprint = new X509Certificate(certificate).fingerprint256
let plainOrigin = ''
let secureOrigin = ''
let crossOrigin = ''

app.setPath('userData', join(PROBE_OUTPUT, 'temporary-profile'))
app.commandLine.appendSwitch('disable-background-networking')

function fixture(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', 'http://fixture.invalid')
  observations.push({
    event: 'request',
    path: url.pathname,
    case: url.searchParams.get('case'),
    host: request.headers.host,
    cookie: request.headers.cookie ?? '',
    userAgent: request.headers['user-agent'] ?? '',
    referer: request.headers.referer ?? ''
  })
  if (url.pathname.startsWith('/redirect')) {
    const destination =
      url.pathname === '/redirect-cross'
        ? crossOrigin
        : url.pathname === '/redirect-http'
          ? plainOrigin
          : ''
    response.writeHead(302, {
      location: `${destination}/body?case=${url.searchParams.get('case') ?? 'native-redirect'}`,
      'x-synthetic-redirect': 'observed'
    })
    response.end()
    return
  }
  if (url.pathname === '/waiting') {
    response.once('close', () => signals.emit('waiting-closed'))
    response.writeHead(200, { 'content-type': 'image/png' })
    response.flushHeaders()
    signals.emit('waiting-started')
    return
  }
  if (url.pathname === '/header-cap') {
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': 5 * 1024 * 1024 + 1
    })
    response.end(image)
    return
  }
  if (url.pathname === '/stream-cap') {
    response.writeHead(200, { 'content-type': 'image/png' })
    response.end(Buffer.alloc(5 * 1024 * 1024 + 1))
    return
  }
  response.writeHead(200, {
    'content-type': 'image/png',
    'content-length': image.length,
    'x-synthetic-body': 'observed'
  })
  response.end(image)
}

async function nativeRequest(
  browserSession: Session,
  url: string
): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const request = net.request({
      url,
      session: browserSession,
      redirect: 'manual',
      credentials: 'include'
    })
    let complete = false
    request.once('error', (error) => {
      if (!complete) reject(error)
    })
    request.once('redirect', (status, method, destination, headers) => {
      complete = true
      resolve({ kind: 'redirect', status, method, destination, headers })
      request.abort()
    })
    request.once('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.once('error', reject)
      response.once('aborted', () => reject(new Error('Synthetic native body aborted')))
      response.once('end', () => {
        complete = true
        resolve({
          kind: 'body',
          status: response.statusCode,
          headers: response.headers,
          bytes: Buffer.concat(chunks).toString('base64')
        })
      })
    })
    request.end()
  })
}

function requestObservation(name: string): Record<string, unknown> {
  const observed = observations.filter((entry) => entry.case === name && entry.path === '/body')
  assert.equal(observed.length, 1)
  return observed[0]
}

async function main(): Promise<void> {
  await app.whenReady()
  const plain = createServer(fixture)
  const secure = createSecureServer(
    { key: readFileSync(join(PROBE_OUTPUT, 'fixture-key.pem')), cert: certificate },
    fixture
  )
  plain.listen(0, '127.0.0.1')
  secure.listen(0, '127.0.0.1')
  await Promise.all([once(plain, 'listening'), once(secure, 'listening')])
  const plainAddress = plain.address()
  const secureAddress = secure.address()
  assert.ok(plainAddress && typeof plainAddress === 'object')
  assert.ok(secureAddress && typeof secureAddress === 'object')
  plainOrigin = `http://localhost:${plainAddress.port}`
  secureOrigin = `https://localhost:${secureAddress.port}`
  crossOrigin = `https://127.0.0.1:${secureAddress.port}`
  const browserSession = session.fromPartition(`molly-asset-transport-probe-${randomUUID()}`)
  assert.equal(browserSession.getStoragePath(), null)
  browserSession.setUserAgent('Molly synthetic asset transport probe')
  browserSession.setCertificateVerifyProc((request, callback) => {
    const trusted =
      ['localhost', '127.0.0.1'].includes(request.hostname) &&
      new X509Certificate(request.certificate.data).fingerprint256 === certificateFingerprint
    callback(trusted ? 0 : -3)
  })
  await browserSession.cookies.set({
    url: secureOrigin,
    name: 'synthetic_local',
    value: 'local-cookie',
    secure: true,
    sameSite: 'no_restriction'
  })
  await browserSession.cookies.set({
    url: crossOrigin,
    name: 'synthetic_cross',
    value: 'cross-cookie',
    secure: true,
    sameSite: 'no_restriction'
  })
  await browserSession.cookies.set({
    url: plainOrigin,
    name: 'synthetic_plain',
    value: 'plain-cookie'
  })
  try {
    const manualFailure = await browserSession
      .fetch(`${plainOrigin}/redirect?case=fetch-manual`, {
        redirect: 'manual'
      })
      .then(
        () => null,
        (error: unknown) => String(error)
      )
    assert.match(manualFailure ?? '', /Redirect was cancelled/)
    observations.push({ event: 'session-fetch-manual-rejected', error: manualFailure })
    const redirect = await nativeRequest(browserSession, `${plainOrigin}/redirect?case=native`)
    assert.equal(redirect.kind, 'redirect')
    assert.equal(redirect.status, 302)
    assert.equal(redirect.method, 'GET')
    assert.equal(redirect.destination, `${plainOrigin}/body?case=native`)
    assert.deepEqual(Reflect.get(redirect.headers as object, 'x-synthetic-redirect'), ['observed'])
    observations.push({ event: 'native-redirect-metadata', ...redirect })
    const body = await nativeRequest(browserSession, redirect.destination as string)
    assert.equal(body.status, 200)
    assert.equal(body.bytes, image.toString('base64'))
    observations.push({ event: 'native-body-metadata', ...body })
    const download = async (
      path: string,
      name: string
    ): Promise<{ bytes: Uint8Array; finalUrl: string }> =>
      await fetchSelectedBrowserImage({
        browserSession,
        imageUrl: `${secureOrigin}${path}?case=${name}`,
        pageUrl: `${secureOrigin}/synthetic-page?private=not-in-referer`,
        signal: new AbortController().signal
      })
    const same = await download('/body', 'same-context')
    assert.deepEqual(Buffer.from(same.bytes), image)
    assert.equal(same.finalUrl, `${secureOrigin}/body?case=same-context`)
    const sameObservation = requestObservation('same-context')
    assert.match(String(sameObservation.cookie), /synthetic_local=local-cookie/)
    assert.equal(sameObservation.userAgent, browserSession.getUserAgent())
    assert.equal(sameObservation.referer, `${secureOrigin}/`)
    const localRedirect = await download('/redirect', 'local-redirect')
    assert.equal(localRedirect.finalUrl, `${secureOrigin}/body?case=local-redirect`)
    assert.match(
      String(requestObservation('local-redirect').cookie),
      /synthetic_local=local-cookie/
    )
    const crossRedirect = await download('/redirect-cross', 'cross-redirect')
    assert.equal(crossRedirect.finalUrl, `${crossOrigin}/body?case=cross-redirect`)
    assert.equal(requestObservation('cross-redirect').cookie, '')
    const httpRedirect = await download('/redirect-http', 'http-redirect')
    assert.equal(httpRedirect.finalUrl, `${plainOrigin}/body?case=http-redirect`)
    assert.equal(requestObservation('http-redirect').cookie, '')
    observations.push({ event: 'product-cookie-context-and-headers-verified' })
    const waitingStarted = once(signals, 'waiting-started')
    const waitingClosed = once(signals, 'waiting-closed')
    const cancelled = new AbortController()
    const reason = new Error('Synthetic asset cancellation')
    const waiting = fetchSelectedBrowserImage({
      browserSession,
      imageUrl: `${secureOrigin}/waiting`,
      pageUrl: `${secureOrigin}/synthetic-page`,
      signal: cancelled.signal
    })
    const rejected = assert.rejects(waiting, (error: unknown) => error === reason)
    await waitingStarted
    cancelled.abort(reason)
    await Promise.all([rejected, waitingClosed])
    observations.push({ event: 'product-cancellation-closed-native-request' })
    await assert.rejects(download('/header-cap', 'header-cap'), /exceeds 5 MiB/)
    await assert.rejects(download('/stream-cap', 'stream-cap'), /exceeds 5 MiB/)
    observations.push({ event: 'product-header-and-stream-body-cap-verified' })
  } finally {
    await browserSession.clearStorageData()
    plain.closeAllConnections()
    secure.closeAllConnections()
    await Promise.all([
      new Promise<void>((resolve) => plain.close(() => resolve())),
      new Promise<void>((resolve) => secure.close(() => resolve()))
    ])
  }
  writeFileSync(
    join(PROBE_OUTPUT, 'result.json'),
    JSON.stringify({ ok: true, versions: process.versions, observations }, null, 2)
  )
  console.log(
    JSON.stringify({ ok: true, observations: observations.length, versions: process.versions })
  )
}

main().then(
  () => app.exit(0),
  (error) => {
    console.error(error)
    writeFileSync(
      join(PROBE_OUTPUT, 'result.json'),
      JSON.stringify({ ok: false, error: String(error), observations }, null, 2)
    )
    app.exit(1)
  }
)
