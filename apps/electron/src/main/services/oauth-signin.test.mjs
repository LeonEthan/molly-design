import assert from 'node:assert/strict'
import { test } from 'node:test'
import { usableOAuthAccessToken } from './oauth-refresh.ts'
import { OAuthSignInService } from './oauth-signin.ts'

function fakeStore(initial) {
  let current = initial
  return {
    oauth: () => current,
    async mutateOAuth(_connectionId, fn) {
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
  const usable = await usableOAuthAccessToken(store, 'conn-1', 'openai', store.oauth())
  assert.equal(usable.ok, true)
  if (usable.ok) assert.equal(usable.accessToken, 'SYNTHETIC_FRESH')
})

void test('a wrapped denied refresh marks the vault row denied without dropping tokens', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })
  )
  const store = fakeStore({
    accessToken: 'SYNTHETIC_EXPIRED',
    refreshToken: 'SYNTHETIC_REFRESH',
    accessTokenExpiresAt: 1,
    clientId: 'synthetic-client'
  })
  // No network in tests: the refresh attempt fails, and any "denied"-shaped failure
  // must leave the row intact for the settings UI to prompt sign-in.
  const usable = await usableOAuthAccessToken(store, 'conn-1', 'openai', store.oauth())
  assert.deepEqual(usable, { ok: false, reason: 'denied' })
  assert.equal(store.oauth()?.denied, true)
  assert.equal(store.oauth()?.refreshToken, 'SYNTHETIC_REFRESH')
})

void test('registration failure settles begin without waiting for a notification or opening a browser', async () => {
  const opened = []
  const service = new OAuthSignInService(
    { deviceId: async () => 'synthetic-host-id' },
    (url) => {
      opened.push(url)
    },
    () => ({
      setProvider() {},
      async login() {
        throw new Error('synthetic registration failure')
      }
    })
  )
  assert.deepEqual(await service.begin('openai'), { ok: false, reason: 'unavailable' })
  assert.deepEqual(opened, [])
})
