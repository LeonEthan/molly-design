import type { ClientRequest, ClientRequestConstructorOptions, Session } from 'electron'
import { hostMatchesSite } from './public-browser-agent-policy.ts'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5
const FETCH_TIMEOUT_MS = 15_000

type RequestFactory = (
  options: ClientRequestConstructorOptions
) => ClientRequest | Promise<ClientRequest>

const nativeRequest: RequestFactory = async (options) =>
  (await import('electron')).net.request(options)

export async function fetchSelectedBrowserImage(
  args: {
    browserSession: Session
    imageUrl: string
    pageUrl: string
    imageCookieContext?: string
    signal: AbortSignal
  },
  createRequest: RequestFactory = nativeRequest
): Promise<{ bytes: Uint8Array; finalUrl: string }> {
  args.signal.throwIfAborted()
  const deadline = new AbortController()
  const signal = AbortSignal.any([args.signal, deadline.signal])
  const page = new URL(args.pageUrl)
  const cookieContext = args.imageCookieContext ?? page.hostname.replace(/^www\./i, '')
  let onAbort = (): void => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  const timer = setTimeout(
    () => deadline.abort(new Error('Selected image timed out.')),
    FETCH_TIMEOUT_MS
  )
  const download = async (): Promise<{ bytes: Uint8Array; finalUrl: string }> => {
    let current = args.imageUrl
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      signal.throwIfAborted()
      const url = new URL(current)
      const useCookies = url.protocol === 'https:' && hostMatchesSite(url.hostname, cookieContext)
      if (useCookies) {
        const cookies = await args.browserSession.cookies.get({ url: url.toString() })
        const cookieLength = cookies.reduce(
          (length, cookie) => length + cookie.name.length + cookie.value.length + 1,
          Math.max(0, (cookies.length - 1) * 2)
        )
        if (cookieLength > 16_000) throw new Error('Selected image needs too many cookies.')
      }
      signal.throwIfAborted()
      const request = await createRequest({
        session: args.browserSession,
        url: url.toString(),
        method: 'GET',
        redirect: 'manual',
        referrerPolicy: 'origin',
        credentials: useCookies ? 'include' : 'omit',
        headers: {
          Accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif;q=0.8',
          'User-Agent': args.browserSession.getUserAgent(),
          Referer: `${page.origin}/`
        }
      })
      if (signal.aborted) {
        request.abort()
        signal.throwIfAborted()
      }
      const result = await new Promise<
        { kind: 'redirect'; location: string } | { kind: 'body'; bytes: Uint8Array }
      >((resolve, reject) => {
        let settled = false
        const finish = (
          completed?: { kind: 'redirect'; location: string } | { kind: 'body'; bytes: Uint8Array },
          error?: unknown
        ): void => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', cancel)
          if (completed) resolve(completed)
          else reject(error)
        }
        const fail = (error: unknown): void => {
          finish(undefined, error)
          request.abort()
        }
        const cancel = (): void => fail(signal.reason)
        signal.addEventListener('abort', cancel, { once: true })
        request.once('error', fail)
        request.once('abort', () => finish(undefined, new Error('Selected image was aborted.')))
        request.once('redirect', (_status, _method, location) => {
          finish({ kind: 'redirect', location })
          request.abort()
        })
        request.once('response', (response) => {
          response.once('error', fail)
          response.once('aborted', () => fail(new Error('Selected image response was aborted.')))
          if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            fail(new Error('Selected image redirect has no location.'))
            return
          }
          if (response.statusCode !== 200) {
            fail(new Error(`Selected image returned HTTP ${response.statusCode}.`))
            return
          }
          const length = Number(response.headers['content-length'])
          if (Number.isFinite(length) && length > MAX_BYTES) {
            fail(new Error('Selected image exceeds 5 MiB.'))
            return
          }
          const chunks: Buffer[] = []
          let size = 0
          response.once('end', () => {
            if (size === 0) fail(new Error('Selected image is empty.'))
            else finish({ kind: 'body', bytes: Buffer.concat(chunks) })
          })
          response.on('data', (chunk) => {
            if (settled) return
            const bytes = Buffer.from(chunk)
            size += bytes.length
            if (size > MAX_BYTES) {
              fail(new Error('Selected image exceeds 5 MiB.'))
              return
            }
            chunks.push(bytes)
          })
        })
        if (signal.aborted) cancel()
        else request.end()
      })
      signal.throwIfAborted()
      if (result.kind === 'body') return { bytes: result.bytes, finalUrl: url.toString() }
      current = new URL(result.location, url).toString()
    }
    throw new Error('Selected image followed too many redirects.')
  }
  try {
    return await Promise.race([download(), aborted])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}
