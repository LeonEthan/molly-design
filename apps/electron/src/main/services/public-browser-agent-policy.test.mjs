import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentBrowserDocumentKey, hostMatchesSite } from './public-browser-agent-policy.ts'

void test('Cookie context matches the site and its subdomains without matching a suffix spoof', () => {
  assert.equal(hostMatchesSite('www.pinterest.com', 'pinterest.com'), true)
  assert.equal(hostMatchesSite('PINTEREST.COM.', 'pinterest.com'), true)
  assert.equal(hostMatchesSite('pinterest.com.evil.example', 'pinterest.com'), false)
  assert.equal(hostMatchesSite('other-site.example', 'pinterest.com'), false)
})

void test('image provenance compares the native main document with normalized query encoding', () => {
  const responseUrl = 'https://example.com/search?q=poster%20design#image'
  const visibleUrl = 'https://example.com/search?q=poster+design#other'
  assert.equal(agentBrowserDocumentKey(responseUrl), agentBrowserDocumentKey(visibleUrl))
  assert.notEqual(
    agentBrowserDocumentKey(responseUrl),
    agentBrowserDocumentKey('https://example.com/other?q=poster+design')
  )
  assert.notEqual(
    agentBrowserDocumentKey(responseUrl),
    agentBrowserDocumentKey('https://example.com/search?q=other')
  )
})
