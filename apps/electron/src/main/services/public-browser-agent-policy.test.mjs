import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyBrowserHostname } from '@molly/shared/browser-url'
import {
  agentBrowserDocumentKey,
  assertAgentBrowserDestination,
  hostMatchesSite,
  isVerifiedAgentBrowserResponsePeer
} from './public-browser-agent-policy.ts'

const checks = (addresses, proxy = 'DIRECT') => ({
  classifyHost: classifyBrowserHostname,
  resolveAddresses: async () => addresses,
  resolveProxy: async () => proxy
})

void test('DNS and response peers accept canonical public IPv4 and IPv6 literals', async () => {
  for (const address of [
    '8.8.8.8',
    '2606:4700:4700::1111',
    '[2606:4700:4700::1111]',
    '[2606:4700:4700:0:0:0:0:AAAA]',
    '::ffff:8.8.8.8',
    '[::ffff:8.8.8.8]'
  ]) {
    assert.equal(
      isVerifiedAgentBrowserResponsePeer({ remoteIPAddress: address }, classifyBrowserHostname),
      true,
      address
    )
    assert.equal(
      await assertAgentBrowserDestination({ url: 'https://example.com/' }, checks([address])),
      'https://example.com/',
      address
    )
  }
})

void test('DNS and response peers reject nonpublic addresses in every supported form', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.9',
    '172.16.0.1',
    '192.168.1.2',
    '100.64.0.1',
    '169.254.0.1',
    '198.18.1.4',
    '224.0.0.1',
    '::ffff:127.0.0.1',
    '[::ffff:192.168.1.2]',
    '[::ffff:c0a8:102]',
    '[::ffff:198.18.1.4]',
    '::',
    '[::]',
    '::1',
    '[::1]',
    '[fc00::1]',
    '[fe80::1]',
    '[ff02::1]'
  ]) {
    assert.equal(
      isVerifiedAgentBrowserResponsePeer({ remoteIPAddress: address }, classifyBrowserHostname),
      false,
      address
    )
    await assert.rejects(
      assertAgentBrowserDestination({ url: 'https://example.com/' }, checks([address])),
      /local, private, or reserved address/,
      address
    )
  }
})

void test('malformed or missing response peers remain unverifiable', async () => {
  assert.equal(isVerifiedAgentBrowserResponsePeer({}, classifyBrowserHostname), false)
  for (const address of [
    '',
    'example.com',
    '[8.8.8.8]',
    '8.8.8.8:443',
    '[2606:4700:4700::1111]:443',
    '[2606:4700:4700::1111',
    '2606:4700:4700::1111]',
    '[[2606:4700:4700::1111]]',
    'fe80::1%en0',
    '127.1',
    '0x7f000001'
  ]) {
    assert.equal(
      isVerifiedAgentBrowserResponsePeer({ remoteIPAddress: address }, classifyBrowserHostname),
      false,
      address
    )
    await assert.rejects(
      assertAgentBrowserDestination({ url: 'https://example.com/' }, checks([address])),
      /address could not be verified/,
      address
    )
  }
})

void test('IP normalization cannot authorize cache or service-worker response peers', () => {
  for (const remoteIPAddress of ['8.8.8.8', '2606:4700:4700::1111', '[2606:4700:4700::1111]']) {
    for (const flag of ['fromDiskCache', 'fromServiceWorker']) {
      assert.equal(
        isVerifiedAgentBrowserResponsePeer(
          { remoteIPAddress, [flag]: true },
          classifyBrowserHostname
        ),
        false,
        `${remoteIPAddress}: ${flag}`
      )
    }
  }
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
