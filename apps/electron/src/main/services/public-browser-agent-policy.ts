/**
 * Preflight for network requests whose result may be read by the design Agent.
 * Human browsing keeps its existing routing behavior. The caller must also
 * verify the actual response peer before releasing page bytes to an Agent:
 * DNS may change between this check and Chromium's connection.
 */
import { isIP } from 'node:net'

export type AgentBrowserNetworkChecks = {
  classifyHost: (host: string) => 'public' | 'loopback' | 'private-lan' | 'prohibited'
  resolveAddresses: (host: string) => Promise<readonly string[]>
  resolveProxy: (url: string) => Promise<string>
}

export type AgentBrowserDestination = {
  url: string
  topLevelSites?: readonly string[]
}

const normalizedIp = (value: string): string => {
  const ip = value.trim()
  if (isIP(ip) === 0) throw new Error('Browser network address could not be verified.')
  try {
    return new URL(ip.includes(':') ? `http://[${ip}]/` : `http://${ip}/`).hostname
  } catch {
    throw new Error('Browser network address could not be verified.')
  }
}

export const hostMatchesSite = (hostname: string, site: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  const approved = site.toLowerCase().replace(/\.$/, '')
  return approved.length > 0 && (host === approved || host.endsWith(`.${approved}`))
}

/** CDP response URLs and WebContents.getURL() can encode the same query differently. */
export const agentBrowserDocumentKey = (rawUrl: string): string => {
  const url = new URL(rawUrl)
  url.hash = ''
  if (url.search) url.search = url.searchParams.toString()
  return url.toString()
}

/** DNS preflight alone is insufficient: Chromium's connected response peer must be public. */
export const isVerifiedAgentBrowserResponsePeer = (
  response: {
    remoteIPAddress?: string
    fromDiskCache?: boolean
    fromServiceWorker?: boolean
  },
  classifyHost: AgentBrowserNetworkChecks['classifyHost']
): boolean => {
  const peer = response.remoteIPAddress
  return Boolean(
    peer &&
    isIP(peer) > 0 &&
    !response.fromDiskCache &&
    !response.fromServiceWorker &&
    classifyHost(peer) === 'public'
  )
}

export async function assertAgentBrowserDestination(
  destination: AgentBrowserDestination,
  checks: AgentBrowserNetworkChecks
): Promise<string> {
  let url: URL
  try {
    url = new URL(destination.url)
  } catch {
    throw new Error('Browser address must be an absolute HTTP(S) URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Browser address must be HTTP(S) without embedded credentials.')
  }
  if (checks.classifyHost(url.hostname) !== 'public') {
    throw new Error('Agent browser cannot access local, private, or reserved hosts.')
  }
  if (
    destination.topLevelSites &&
    !destination.topLevelSites.some((site) => hostMatchesSite(url.hostname, site))
  ) {
    throw new Error('Browser navigation left the approved sites for this task.')
  }
  // Chromium may resolve through a different proxy than Node. Until the actual
  // proxy destination can be verified, reject Agent reads in proxied sessions.
  const proxy = (await checks.resolveProxy(url.toString())).trim().toUpperCase()
  if (proxy !== 'DIRECT') {
    throw new Error('Agent browser cannot verify this proxy destination.')
  }
  const addresses = await checks.resolveAddresses(url.hostname)
  if (addresses.length === 0) throw new Error('Browser host did not resolve.')
  for (const address of addresses) {
    if (checks.classifyHost(normalizedIp(address)) !== 'public') {
      throw new Error('Agent browser resolved a local, private, or reserved address.')
    }
  }
  return url.toString()
}
