import assert from 'node:assert/strict'
import test from 'node:test'
import { readIdTokenClaims, refreshOAuthTokens } from './openai-oauth.ts'
import { usableOAuthAccessToken } from './openai-oauth-refresh.ts'

void test('readIdTokenClaims extracts email, plan and account id and ignores malformed tokens', () => {
  const token = `aaa.${Buffer.from(
    JSON.stringify({
      email: 'designer@example.com',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'plus',
        chatgpt_account_id: 'acct-1'
      }
    })
  ).toString('base64url')}.sig`
  assert.deepEqual(readIdTokenClaims(token), {
    email: 'designer@example.com',
    plan: 'plus',
    accountId: 'acct-1'
  })
  assert.deepEqual(readIdTokenClaims('not-a-jwt'), {})
  assert.deepEqual(readIdTokenClaims(`a.${Buffer.from('nope').toString('base64url')}.b`), {})
})

void test('refreshOAuthTokens rotates the whole set and maps 400/401 to denied', async () => {
  const rotated = await refreshOAuthTokens(
    async () =>
      new Response(JSON.stringify({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }), {
        status: 200
      }),
    { accessToken: 'a1', refreshToken: 'r1', accessTokenExpiresAt: 1, accountId: 'acct' }
  )
  assert.ok(rotated.ok)
  assert.equal(rotated.tokens.refreshToken, 'r2')
  assert.equal(rotated.tokens.accountId, 'acct')

  const denied = await refreshOAuthTokens(
    async () => new Response('{"error":"refresh token was already used"}', { status: 401 }),
    { accessToken: 'a1', refreshToken: 'r1', accessTokenExpiresAt: 1 }
  )
  assert.deepEqual(denied, { ok: false, reason: 'denied' })

  const down = await refreshOAuthTokens(
    async () => {
      throw new Error('offline')
    },
    { accessToken: 'a1', refreshToken: 'r1', accessTokenExpiresAt: 1 }
  )
  assert.deepEqual(down, { ok: false, reason: 'unreachable' })
})

void test('usableOAuthAccessToken keeps a fresh token and rotates an expired one', async () => {
  const future = Date.now() + 60 * 60_000
  const store = {
    rotateOAuthTokens: async () => undefined,
    saveOAuthTokens: async () => undefined
  }
  const fresh = await usableOAuthAccessToken(
    store,
    { id: 'c1', revision: 1 },
    { accessToken: 'a1', refreshToken: 'r1', accessTokenExpiresAt: future, accountId: 'acct' },
    async () => {
      throw new Error('must not refresh')
    }
  )
  assert.deepEqual(fresh, { ok: true, accessToken: 'a1', accountId: 'acct' })

  let rotatedWith
  const stale = await usableOAuthAccessToken(
    {
      rotateOAuthTokens: async (_id, _revision, tokens) => {
        rotatedWith = { ...tokens, grantId: 'grant-2' }
        return rotatedWith
      },
      saveOAuthTokens: async () => undefined
    },
    { id: 'c1', revision: 2 },
    { accessToken: 'a1', refreshToken: 'r1', accessTokenExpiresAt: 1, accountId: 'acct' },
    async () =>
      new Response(JSON.stringify({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }), {
        status: 200
      })
  )
  assert.equal(stale.ok, true)
  if (stale.ok) assert.equal(stale.accessToken, 'a2')
  if (stale.ok) assert.equal(stale.grantId, 'grant-2')

  const dead = await usableOAuthAccessToken(
    store,
    { id: 'c1', revision: 1 },
    { accessToken: 'a1', refreshToken: 'r1', accessTokenExpiresAt: 1 },
    async () => new Response('no', { status: 401 })
  )
  assert.deepEqual(dead, { ok: false, reason: 'denied' })

  let denialMarked = false
  const denied = await usableOAuthAccessToken(
    {
      saveOAuthTokens: async (_id, _revision, tokens) => {
        if (tokens.denied) denialMarked = true
      },
      rotateOAuthTokens: async () => undefined
    },
    { id: 'c1', revision: 1 },
    { accessToken: 'a1', refreshToken: 'r1', accessTokenExpiresAt: 1 },
    async () => new Response('no', { status: 401 })
  )
  assert.deepEqual(denied, { ok: false, reason: 'denied' })
  assert.equal(denialMarked, true)
})
