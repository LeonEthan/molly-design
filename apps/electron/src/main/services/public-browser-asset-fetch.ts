import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import type { Session } from 'electron'
import { classifyBrowserHostname } from '@molly/shared/browser-url'
import { assertAgentBrowserDestination, hostMatchesSite } from './public-browser-agent-policy.ts'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5
const REQUEST_TIMEOUT_MS = 15_000

type AssetNetwork = {
  resolveAddresses(host: string): Promise<string[]>
  request(
    url: URL,
    options: http.RequestOptions,
    callback: (response: http.IncomingMessage) => void
  ): http.ClientRequest
}
const defaultNetwork: AssetNetwork = {
  resolveAddresses: async (host) =>
    (await lookup(host, { all: true })).map((entry) => entry.address),
  request: (url, options, callback) =>
    (url.protocol === 'https:' ? https : http).request(url, options, callback)
}

/**
 * The asset path deliberately uses a pinned Node connection: Electron session.fetch
 * does not expose the peer address before its bytes are read. This function takes
 * only one selected image URL from the current page, validates every redirect,
 * and pins each DNS answer for the actual socket. Cookies remain in Electron main.
 */
export async function fetchSelectedBrowserImage(
  args: {
    browserSession: Session
    imageUrl: string
    pageUrl: string
    sites: readonly string[]
    signal: AbortSignal
  },
  network: AssetNetwork = defaultNetwork
): Promise<{ bytes: Uint8Array; finalUrl: string }> {
  const page = new URL(args.pageUrl)
  let current = args.imageUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    args.signal.throwIfAborted()
    const url = new URL(current)
    await assertAgentBrowserDestination(
      { url: url.toString() },
      {
        classifyHost: classifyBrowserHostname,
        resolveAddresses: network.resolveAddresses,
        resolveProxy: async (target) => await args.browserSession.resolveProxy(target)
      }
    )
    // A second resolution is safe because the selected address is validated and
    // pinned into Node's lookup callback. It cannot change between check/connect.
    const addresses = isIP(url.hostname.replace(/^\[|\]$/g, ''))
      ? [url.hostname.replace(/^\[|\]$/g, '')]
      : await network.resolveAddresses(url.hostname)
    const selected = addresses.find(
      (ip) => isIP(ip) > 0 && classifyBrowserHostname(ip) === 'public'
    )
    if (
      !selected ||
      addresses.some((ip) => isIP(ip) === 0 || classifyBrowserHostname(ip) !== 'public')
    ) {
      throw new Error('Selected image resolves to a local, private, or unverifiable address.')
    }
    const sameApprovedSite = args.sites.some(
      (site) => hostMatchesSite(page.hostname, site) && hostMatchesSite(url.hostname, site)
    )
    const cookies =
      sameApprovedSite && url.protocol === 'https:'
        ? await args.browserSession.cookies.get({ url: url.toString() })
        : []
    const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
    if (cookieHeader.length > 16_000) throw new Error('Selected image needs too many cookies.')
    const result = await new Promise<
      { kind: 'redirect'; location: string } | { kind: 'body'; bytes: Uint8Array }
    >((resolve, reject) => {
      const request = network.request(
        url,
        {
          method: 'GET',
          signal: args.signal,
          timeout: REQUEST_TIMEOUT_MS,
          lookup: (_host, options, callback) => {
            const family = isIP(selected)
            if (options.all) callback(null, [{ address: selected, family }])
            else callback(null, selected, family)
          },
          headers: {
            Accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif;q=0.8',
            'User-Agent': args.browserSession.getUserAgent(),
            Referer: `${page.origin}/`,
            ...(cookieHeader ? { Cookie: cookieHeader } : {})
          }
        },
        (response) => {
          const peer = response.socket.remoteAddress
          if (!peer || isIP(peer) === 0 || classifyBrowserHostname(peer) !== 'public') {
            response.destroy()
            reject(new Error('Selected image response came from an unsafe address.'))
            return
          }
          const status = response.statusCode ?? 0
          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = response.headers.location
            response.destroy()
            if (!location) reject(new Error('Selected image redirect has no location.'))
            else resolve({ kind: 'redirect', location: new URL(location, url).toString() })
            return
          }
          if (status !== 200) {
            response.destroy()
            reject(new Error(`Selected image returned HTTP ${status}.`))
            return
          }
          const length = Number(response.headers['content-length'])
          if (Number.isFinite(length) && length > MAX_BYTES) {
            response.destroy()
            reject(new Error('Selected image exceeds 5 MiB.'))
            return
          }
          void (async () => {
            const chunks: Buffer[] = []
            let size = 0
            for await (const chunk of response) {
              const bytes = Buffer.from(chunk)
              size += bytes.length
              if (size > MAX_BYTES) {
                response.destroy()
                throw new Error('Selected image exceeds 5 MiB.')
              }
              chunks.push(bytes)
            }
            if (size === 0) throw new Error('Selected image is empty.')
            resolve({ kind: 'body', bytes: Buffer.concat(chunks) })
          })().catch(reject)
        }
      )
      request.once('timeout', () => request.destroy(new Error('Selected image timed out.')))
      request.once('error', reject)
      request.end()
    })
    if (result.kind === 'body') return { bytes: result.bytes, finalUrl: url.toString() }
    current = result.location
  }
  throw new Error('Selected image followed too many redirects.')
}
