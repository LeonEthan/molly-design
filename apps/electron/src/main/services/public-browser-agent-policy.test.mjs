import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  agentBrowserDocumentKey,
  assertAgentBrowserDestination,
  hostMatchesSite,
  isVerifiedAgentBrowserResponsePeer
} from './public-browser-agent-policy.ts'

const blockedAddresses = new Set([
  '127.0.0.1',
  '10.0.0.9',
  '[::1]',
  '[::ffff:7f00:1]',
  '198.18.1.4',
  '192.168.1.2'
])
const checks = (addresses, proxy = 'DIRECT') => ({
  classifyHost: (host) => (blockedAddresses.has(host) ? 'private-lan' : 'public'),
  resolveAddresses: async () => addresses,
  resolveProxy: async () => proxy
})

void test('redirect URL encoding still identifies the verified main document', () => {
  const responseUrl =
    'https://commons.wikimedia.org/w/index.php?search=poster+design&title=Special:MediaSearch&type=image'
  const visibleUrl =
    'https://commons.wikimedia.org/w/index.php?search=poster%20design&title=Special%3AMediaSearch&type=image'
  assert.equal(agentBrowserDocumentKey(responseUrl), agentBrowserDocumentKey(visibleUrl))
  assert.notEqual(
    agentBrowserDocumentKey(responseUrl),
    agentBrowserDocumentKey('https://commons.wikimedia.org/w/index.php?search=other')
  )
})

void test('agent navigation stays within an approved site without suffix spoofing', async () => {
  assert.equal(hostMatchesSite('www.pinterest.com', 'pinterest.com'), true)
  assert.equal(hostMatchesSite('pinterest.com.evil.example', 'pinterest.com'), false)
  assert.equal(
    await assertAgentBrowserDestination(
      { url: 'https://www.pinterest.com/search/pins/', topLevelSites: ['pinterest.com'] },
      checks(['8.8.8.8'])
    ),
    'https://www.pinterest.com/search/pins/'
  )
  await assert.rejects(
    assertAgentBrowserDestination(
      { url: 'https://pinterest.com.evil.example/', topLevelSites: ['pinterest.com'] },
      checks(['8.8.8.8'])
    ),
    /approved sites/
  )
  await assert.rejects(
    assertAgentBrowserDestination(
      { url: 'https://www.amazon.com/product', topLevelSites: ['pinterest.com'] },
      checks(['8.8.8.8'])
    ),
    /approved sites/
  )
})

void test('a DNS-safe preflight cannot authorize a private response peer', async () => {
  assert.equal(
    await assertAgentBrowserDestination({ url: 'https://example.com/' }, checks(['8.8.8.8'])),
    'https://example.com/'
  )
  const classifyHost = checks(['8.8.8.8']).classifyHost
  assert.equal(
    isVerifiedAgentBrowserResponsePeer({ remoteIPAddress: '198.18.1.4' }, classifyHost),
    false
  )
  assert.equal(
    isVerifiedAgentBrowserResponsePeer({ remoteIPAddress: '8.8.8.8' }, classifyHost),
    true
  )
  assert.equal(
    isVerifiedAgentBrowserResponsePeer(
      { remoteIPAddress: '8.8.8.8', fromServiceWorker: true },
      classifyHost
    ),
    false
  )
})

void test('agent read refuses resolved private, mapped, and fake-IP addresses', async () => {
  for (const address of ['127.0.0.1', '10.0.0.9', '::1', '::ffff:127.0.0.1', '198.18.1.4']) {
    await assert.rejects(
      assertAgentBrowserDestination({ url: 'https://example.com/' }, checks([address])),
      /local, private, or reserved address/,
      address
    )
  }
  await assert.rejects(
    assertAgentBrowserDestination(
      { url: 'https://example.com/' },
      checks(['8.8.8.8', '192.168.1.2'])
    ),
    /local, private, or reserved address/
  )
})

void test('agent read refuses unverifiable proxies and URL schemes', async () => {
  await assert.rejects(
    assertAgentBrowserDestination(
      { url: 'https://example.com/' },
      checks(['8.8.8.8'], 'PROXY 127.0.0.1:7890')
    ),
    /proxy destination/
  )
  await assert.rejects(
    assertAgentBrowserDestination({ url: 'file:///etc/passwd' }, checks(['8.8.8.8'])),
    /HTTP\(S\)/
  )
})
