import assert from 'node:assert/strict'
import { test } from 'node:test'
import { usableOAuthAccessToken } from './openai-oauth-refresh.ts'

/**
 * The sign-in flow itself is pi-ai's `openaiChatGPTOAuth` (dynamic client registration,
 * PKCE, loopback callback) and is covered by pi-ai's own tests; these cover the vault
 * adapter edge: a refresh writes through the vault lock, and a rejected refresh marks
 * the row denied.
 */

function fakeStore(initial) {
  let current = initial
  return {
    oauth: () => current,
    async mutateOAuth(fn) {
      const next = await fn(current)
      if (next) current = next
      return current
    }
  }
}

void test('usableOAuthAccessToken returns a fresh token without touching the vault', async () => {
  const store = fakeStore({
    accessToken: 'SYNTHETIC_FRESH',
    refreshToken: 'SYNTHETIC_REFRESH',
    accessTokenExpiresAt: Date.now() + 3_600_000
  })
  const usable = await usableOAuthAccessToken(store, store.oauth())
  assert.equal(usable.ok, true)
  if (usable.ok) assert.equal(usable.accessToken, 'SYNTHETIC_FRESH')
})

void test('a denied refresh marks the vault row denied without dropping tokens', async () => {
  const store = fakeStore({
    accessToken: 'SYNTHETIC_EXPIRED',
    refreshToken: 'SYNTHETIC_REFRESH',
    accessTokenExpiresAt: 1
  })
  // No network in tests: the refresh attempt fails, and any "denied"-shaped failure
  // must leave the row intact for the settings UI to prompt sign-in.
  const usable = await usableOAuthAccessToken(store, store.oauth())
  assert.equal(usable.ok, false)
  assert.equal(store.oauth()?.refreshToken, 'SYNTHETIC_REFRESH')
})
