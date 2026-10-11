import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv } from 'node:crypto'
import { ModelConnectionStore } from './model-connection-store.ts'
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
  assert.deepEqual(await service.begin({ provider: 'openai' }), {
    ok: false,
    reason: 'unavailable'
  })
  assert.deepEqual(opened, [])
})

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const apiInput = {
  displayName: 'Saved name',
  providerPresetId: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  enabled: false,
  apiKey: 'SYNTHETIC_API_KEY',
  models: ['gpt-4.1']
}
const oldTokens = {
  accessToken: 'SYNTHETIC_OLD_ACCESS',
  refreshToken: 'SYNTHETIC_OLD_REFRESH',
  accessTokenExpiresAt: 2_000_000_000_000,
  clientId: 'synthetic-old-client'
}
const newCredential = {
  type: 'oauth',
  access: 'SYNTHETIC_NEW_ACCESS',
  refresh: 'SYNTHETIC_NEW_REFRESH',
  expires: 2_000_000_000_000,
  clientId: 'synthetic-new-client'
}
const oauthInput = { ...apiInput, apiKey: undefined, authType: 'openai_oauth' }

async function signInFixture(t, revocation) {
  const directory = await mkdtemp(join(tmpdir(), 'molly-signin-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const key = Buffer.alloc(32, 7)
  const iv = Buffer.alloc(16, 3)
  let failNextWrite = false
  const cipher = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString(value) {
      if (failNextWrite) {
        failNextWrite = false
        throw new Error('synthetic write failure')
      }
      const instance = createCipheriv('aes-256-cbc', key, iv)
      return Buffer.concat([instance.update(value, 'utf8'), instance.final()])
    },
    decryptString(value) {
      const instance = createDecipheriv('aes-256-cbc', key, iv)
      return Buffer.concat([instance.update(value), instance.final()]).toString('utf8')
    }
  }
  const store = new ModelConnectionStore(directory, cipher, 'darwin')
  const credential = deferred()
  const revocations = []
  const service = new OAuthSignInService(
    store,
    () => undefined,
    () => ({
      setProvider() {},
      async login(_provider, _method, interaction) {
        interaction.notify({ type: 'auth_url', url: 'https://example.invalid/synthetic-login' })
        return credential.promise
      }
    }),
    async (provider, tokens) => {
      revocations.push({ provider, refreshToken: tokens.refreshToken })
      if (revocation)
        await revocation(provider, tokens, store, () => {
          failNextWrite = true
        })
    }
  )
  return { store, service, credential, revocations }
}

void test('API-key sign-in replaces its exact edited row and preserves unrelated connections', async (t) => {
  const { store, service, credential, revocations } = await signInFixture(t)
  const edited = await store.save(apiInput)
  const unrelated = await store.save({
    ...apiInput,
    providerPresetId: 'anthropic',
    baseUrl: 'https://api.anthropic.com'
  })
  const begun = await service.begin({
    provider: 'openai',
    id: edited.id,
    expectedRevision: edited.revision
  })
  credential.resolve(newCredential)
  const result = await service.complete(begun.sessionId)
  assert.equal(result.ok, true)
  assert.equal(result.connection.id, edited.id)
  assert.equal(result.connection.credentialRef, edited.credentialRef)
  assert.equal(result.connection.revision, edited.revision + 1)
  assert.equal(result.connection.enabled, false)
  assert.equal(result.connection.displayName, edited.displayName)
  assert.deepEqual(result.connection.models, edited.models)
  assert.deepEqual((await store.snapshot()).connections, [result.connection, unrelated])
  assert.deepEqual(revocations, [])
  assert.equal((await store.oauthFor(edited.id)).refreshToken, newCredential.refresh)
})

void test('cross-provider sign-in revokes the edited grant before replacing it; commit cannot be cancelled or timed out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const revoking = deferred()
  const finish = deferred()
  t.after(() => finish.resolve())
  const { store, service, credential, revocations } = await signInFixture(
    t,
    async (_provider, tokens, vault) => {
      assert.deepEqual(await vault.oauthFor(edited.id), tokens)
      revoking.resolve()
      await finish.promise
      throw new Error('synthetic offline revocation')
    }
  )
  const { connection: edited } = await store.saveOAuthConnection(oauthInput, oldTokens, {})
  const begun = await service.begin({
    provider: 'kimi-coding',
    id: edited.id,
    expectedRevision: edited.revision
  })
  credential.resolve(newCredential)
  const complete = service.complete(begun.sessionId)
  await revoking.promise
  assert.equal((await store.snapshot()).connections[0].providerPresetId, 'openai')
  service.cancel(begun.sessionId)
  t.mock.timers.tick(15 * 60_000)
  assert.deepEqual(await service.begin({ provider: 'openai' }), {
    ok: false,
    reason: 'unavailable'
  })
  finish.resolve()
  const result = await complete
  assert.equal(result.ok, true)
  assert.equal(result.connection.id, edited.id)
  assert.equal(result.connection.credentialRef, edited.credentialRef)
  assert.equal(result.connection.revision, edited.revision + 1)
  assert.equal(result.connection.providerPresetId, 'kimi-coding')
  assert.equal(result.connection.models, undefined)
  assert.deepEqual(revocations, [{ provider: 'openai', refreshToken: oldTokens.refreshToken }])
  assert.equal((await store.oauthFor(edited.id)).refreshToken, newCredential.refresh)
})

void test('Add connection revokes the existing provider grant before replacing it', async (t) => {
  const { store, service, credential, revocations } = await signInFixture(
    t,
    async (_provider, tokens, vault) => {
      assert.deepEqual(await vault.oauthFor(edited.id), tokens)
    }
  )
  const { connection: edited } = await store.saveOAuthConnection(oauthInput, oldTokens, {})
  const begun = await service.begin({ provider: 'openai' })
  credential.resolve(newCredential)
  const result = await service.complete(begun.sessionId)
  assert.equal(result.ok, true)
  assert.equal(result.connection.id, edited.id)
  assert.deepEqual(revocations, [{ provider: 'openai', refreshToken: oldTokens.refreshToken }])
  assert.equal((await store.snapshot()).connections.length, 1)
})

void test('a stale edited revision retains the saved grant and revokes only the abandoned new login', async (t) => {
  const { store, service, credential, revocations } = await signInFixture(t)
  const { connection: edited } = await store.saveOAuthConnection(oauthInput, oldTokens, {})
  const begun = await service.begin({
    provider: 'openai',
    id: edited.id,
    expectedRevision: edited.revision
  })
  const updated = await store.save({
    ...oauthInput,
    id: edited.id,
    expectedRevision: edited.revision,
    displayName: 'Concurrent name'
  })
  credential.resolve(newCredential)
  assert.equal((await service.complete(begun.sessionId)).ok, false)
  assert.deepEqual((await store.snapshot()).connections, [updated])
  assert.deepEqual(await store.oauthFor(edited.id), oldTokens)
  assert.deepEqual(revocations, [{ provider: 'openai', refreshToken: newCredential.refresh }])
})

void test('an edit cannot overwrite an unrelated destination-provider OAuth connection', async (t) => {
  const { store, service, credential, revocations } = await signInFixture(t)
  const edited = await store.save(apiInput)
  const { connection: unrelated } = await store.saveOAuthConnection(
    {
      ...oauthInput,
      providerPresetId: 'kimi-coding',
      baseUrl: 'https://api.kimi.com/coding',
      models: undefined
    },
    oldTokens,
    {}
  )
  const begun = await service.begin({
    provider: 'kimi-coding',
    id: edited.id,
    expectedRevision: edited.revision
  })
  credential.resolve(newCredential)
  assert.equal((await service.complete(begun.sessionId)).ok, false)
  assert.deepEqual((await store.snapshot()).connections, [edited, unrelated])
  assert.deepEqual(await store.oauthFor(unrelated.id), oldTokens)
  assert.deepEqual(revocations, [{ provider: 'kimi-coding', refreshToken: newCredential.refresh }])
})

void test('cancellation before commit retains the old grant and revokes a late issued grant', async (t) => {
  const discarded = deferred()
  const { store, service, credential, revocations } = await signInFixture(t, async () => {
    discarded.resolve()
  })
  const { connection: edited } = await store.saveOAuthConnection(oauthInput, oldTokens, {})
  const begun = await service.begin({
    provider: 'openai',
    id: edited.id,
    expectedRevision: edited.revision
  })
  service.cancel(begun.sessionId)
  credential.resolve(newCredential)
  assert.deepEqual(await service.complete(begun.sessionId), { ok: false, reason: 'cancelled' })
  await discarded.promise
  assert.deepEqual((await store.snapshot()).connections, [edited])
  assert.deepEqual(await store.oauthFor(edited.id), oldTokens)
  assert.deepEqual(revocations, [{ provider: 'openai', refreshToken: newCredential.refresh }])
})

void test('a failed replacement after revocation marks only the surviving old grant denied', async (t) => {
  const { store, service, credential, revocations } = await signInFixture(
    t,
    async (_provider, tokens, _vault, failWrite) => {
      if (tokens.refreshToken === oldTokens.refreshToken) failWrite()
    }
  )
  const { connection: edited } = await store.saveOAuthConnection(oauthInput, oldTokens, {})
  const begun = await service.begin({
    provider: 'openai',
    id: edited.id,
    expectedRevision: edited.revision
  })
  credential.resolve(newCredential)
  assert.equal((await service.complete(begun.sessionId)).ok, false)
  const snapshot = await store.snapshot()
  assert.equal(snapshot.connections[0].id, edited.id)
  assert.equal(snapshot.connections[0].oauth.denied, true)
  assert.equal((await store.oauthFor(edited.id)).refreshToken, oldTokens.refreshToken)
  assert.deepEqual(revocations, [
    { provider: 'openai', refreshToken: oldTokens.refreshToken },
    { provider: 'openai', refreshToken: newCredential.refresh }
  ])
})

void test('an uncertain write outcome never revokes the new grant actually persisted', async (t) => {
  const { store, service, credential, revocations } = await signInFixture(t)
  const { connection: edited } = await store.saveOAuthConnection(oauthInput, oldTokens, {})
  const save = store.saveOAuthConnection.bind(store)
  t.mock.method(store, 'saveOAuthConnection', async (...args) => {
    await save(...args)
    throw new Error('synthetic post-rename failure')
  })
  const begun = await service.begin({
    provider: 'openai',
    id: edited.id,
    expectedRevision: edited.revision
  })
  credential.resolve(newCredential)
  assert.equal((await service.complete(begun.sessionId)).ok, false)
  assert.equal((await store.oauthFor(edited.id)).refreshToken, newCredential.refresh)
  assert.deepEqual(revocations, [{ provider: 'openai', refreshToken: oldTokens.refreshToken }])
})
