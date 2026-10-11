import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv } from 'node:crypto'
import { ModelConnectionStore } from './model-connection-store.ts'
import { usableOAuthAccessToken } from './oauth-refresh.ts'
import { OAuthSignInService } from './oauth-signin.ts'
import { signOutModelConnection } from './model-connection-settings.ts'
import { revokeOAuthGrant } from './oauth-revocation.ts'
import { openAiSignInProvider, openOpenAiCallback } from './openai-signin.ts'
import { generateKeyPair, SignJWT } from 'jose'
import { EventEmitter } from 'node:events'

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

async function openAiLoginFixture(t, registration, patch = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: 2_000_000_000_000 })
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const ready = deferred()
  const callback = deferred()
  const requests = []
  const discarded = []
  const controller = new AbortController()
  let closed = false
  let authorize
  const provider = openAiSignInProvider(
    registration,
    async (credential) => {
      discarded.push(credential)
    },
    {
      async listen() {
        return {
          redirectUri: 'http://127.0.0.1:54321/auth/callback',
          result: callback.promise,
          close() {
            closed = true
          }
        }
      },
      keys: async () => {
        if (patch.validation) {
          patch.validation.started.resolve()
          await patch.validation.release.promise
        }
        return publicKey
      },
      async fetch(url, init) {
        const body = new URLSearchParams(init.body)
        requests.push({ url, body, redirect: init.redirect })
        const jwt = await new SignJWT({
          nonce: authorize.searchParams.get('nonce'),
          ...patch.claims
        })
          .setProtectedHeader({ alg: 'RS256' })
          .setIssuer(patch.issuer ?? 'https://auth.openai.com')
          .setAudience(patch.audience ?? body.get('client_id'))
          .setSubject(patch.subject ?? 'synthetic-user')
          .setIssuedAt()
          .setExpirationTime(patch.expiration ?? '1h')
          .sign(privateKey)
        return new Response(
          JSON.stringify({
            access_token: 'SYNTHETIC_ACCESS',
            refresh_token: 'SYNTHETIC_REFRESH',
            id_token: jwt,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: patch.scope ?? 'openid chatgpt.tokens.use.direct'
          })
        )
      },
      ...patch.dependencies
    }
  )
  const result = provider.auth.oauth.login(
    {
      signal: controller.signal,
      prompt: async () => {
        throw new Error('unexpected prompt')
      },
      notify(event) {
        if (event.type === 'auth_url') {
          authorize = new URL(event.url)
          ready.resolve(authorize)
        }
      }
    },
    { getDeviceId: () => '00000000-0000-4000-8000-000000000001' }
  )
  void result.catch(() => undefined)
  await ready.promise
  return {
    authorize,
    result,
    requests,
    discarded,
    controller,
    closed: () => closed,
    callback(parameters = {}) {
      callback.resolve(
        new URL(
          `http://127.0.0.1/auth/callback?${new URLSearchParams({
            code: 'synthetic-code',
            state: authorize.searchParams.get('state'),
            ...parameters
          })}`
        )
      )
    }
  }
}

void test('OpenAI initial registration validates identity and retains its issued registration', async (t) => {
  const f = await openAiLoginFixture(t)
  assert.equal(f.authorize.searchParams.get('client_id'), 'dynamic_agent_client')
  assert.equal(f.authorize.searchParams.get('agent_name_hint'), 'Molly')
  assert.equal(
    f.authorize.searchParams.get('ext_agent_host_id'),
    'urn:uuid:00000000-0000-4000-8000-000000000001'
  )
  f.callback({ client_id: 'synthetic-issued-client' })
  const credential = await f.result
  assert.equal(credential.subject, 'synthetic-user')
  assert.equal(credential.clientId, 'synthetic-issued-client')
  assert.ok(credential.idToken)
  assert.deepEqual(credential.scopes, ['openid', 'chatgpt.tokens.use.direct'])
  assert.equal(f.requests[0].body.get('redirect_uri'), f.authorize.searchParams.get('redirect_uri'))
  assert.equal(f.requests[0].redirect, 'error')
  assert.equal(f.closed(), true)
})

void test('OpenAI reauthorization reuses its client and hint even when the callback omits client_id', async (t) => {
  const f = await openAiLoginFixture(t, {
    clientId: 'synthetic-issued-client',
    idToken: 'SYNTHETIC_OLD_ID_TOKEN',
    subject: 'synthetic-user'
  })
  assert.equal(f.authorize.searchParams.get('client_id'), 'synthetic-issued-client')
  assert.equal(f.authorize.searchParams.get('id_token_hint'), 'SYNTHETIC_OLD_ID_TOKEN')
  assert.equal(f.authorize.searchParams.has('agent_name_hint'), false)
  f.callback()
  assert.equal((await f.result).clientId, 'synthetic-issued-client')
  assert.equal(f.requests[0].body.get('client_id'), 'synthetic-issued-client')
  assert.equal(f.closed(), true)
})

void test('OpenAI reconnect after sign-out validates the retained subject without an ID-token hint', async (t) => {
  const f = await openAiLoginFixture(t, {
    clientId: 'synthetic-issued-client',
    subject: 'synthetic-user'
  })
  assert.equal(f.authorize.searchParams.get('client_id'), 'synthetic-issued-client')
  assert.equal(f.authorize.searchParams.has('id_token_hint'), false)
  assert.equal(f.authorize.searchParams.has('agent_name_hint'), false)
  f.callback()
  assert.equal((await f.result).subject, 'synthetic-user')
})

for (const patch of [
  { claims: { nonce: 'wrong' } },
  { issuer: 'https://other.invalid' },
  { audience: 'other-client' },
  { subject: 'other-user' },
  { expiration: 1 },
  { scope: 'openid' }
])
  void test(`OpenAI refuses unbound identity or permission: ${JSON.stringify(patch)}`, async (t) => {
    const f = await openAiLoginFixture(
      t,
      { clientId: 'synthetic-client', subject: 'synthetic-user' },
      patch
    )
    f.callback()
    await assert.rejects(f.result)
    assert.equal(f.discarded[0]?.refresh, 'SYNTHETIC_REFRESH')
    assert.equal(f.closed(), true)
  })

for (const parameters of [
  { client_id: 'other-client' },
  { state: 'wrong' },
  { state: 'wrong', error: 'access_denied' },
  { error: 'access_denied' }
])
  void test(`OpenAI refuses invalid callbacks before token exchange: ${JSON.stringify(parameters)}`, async (t) => {
    const f = await openAiLoginFixture(t, { clientId: 'synthetic-client' })
    f.callback(parameters)
    await assert.rejects(f.result)
    assert.deepEqual(f.requests, [])
    assert.equal(f.closed(), true)
  })

void test('OpenAI cancellation during identity validation discards the late grant and closes the listener', async (t) => {
  const validating = deferred()
  const release = deferred()
  const f = await openAiLoginFixture(t, undefined, { validation: { started: validating, release } })
  f.callback({ client_id: 'synthetic-client' })
  await validating.promise
  f.controller.abort()
  release.resolve()
  await assert.rejects(f.result, { name: 'AbortError' })
  assert.equal(f.discarded[0]?.refresh, 'SYNTHETIC_REFRESH')
  assert.equal(f.closed(), true)
})

void test('the loopback listener ignores mismatched callbacks and consumes matching state once', async () => {
  const controller = new AbortController()
  let receive
  const server = new EventEmitter()
  server.listen = (_port, host, ready) => {
    assert.equal(host, '127.0.0.1')
    ready()
  }
  server.address = () => ({ port: 54321 })
  let closed = false
  server.close = () => {
    closed = true
  }
  server.closeAllConnections = () => {}
  const callback = await openOpenAiCallback('synthetic-state', controller.signal, (handler) => {
    receive = handler
    return server
  })
  const statuses = []
  const response = {
    writeHead(status) {
      statuses.push(status)
    },
    end() {}
  }
  receive({ method: 'GET', url: '/auth/callback?state=wrong&error=access_denied' }, response)
  receive({ method: 'GET', url: '/auth/callback?state=synthetic-state&code=first' }, response)
  receive({ method: 'GET', url: '/auth/callback?state=synthetic-state&code=second' }, response)
  assert.equal((await callback.result).searchParams.get('code'), 'first')
  assert.deepEqual(statuses, [400, 200, 400])
  controller.abort()
  assert.equal(closed, true)
})

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
  const registrations = []
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
    },
    (registration, discard) => {
      registrations.push(registration)
      return openAiSignInProvider(registration, discard)
    }
  )
  return { store, service, credential, revocations, registrations }
}

void test('edited OpenAI sign-in reuses registration and revokes only the replaced renewable session', async (t) => {
  const { store, service, credential, revocations, registrations } = await signInFixture(t)
  const tokens = {
    ...oldTokens,
    subject: 'synthetic-user',
    idToken: 'SYNTHETIC_ID_TOKEN',
    scopes: ['chatgpt.tokens.use.direct']
  }
  const { connection } = await store.saveOAuthConnection(oauthInput, tokens, {})
  const begun = await service.begin({
    provider: 'openai',
    id: connection.id,
    expectedRevision: connection.revision
  })
  assert.deepEqual(registrations, [
    { clientId: tokens.clientId, subject: tokens.subject, idToken: tokens.idToken }
  ])
  assert.equal('authorizeUrl' in begun, false)
  credential.resolve({
    ...newCredential,
    clientId: tokens.clientId,
    subject: tokens.subject,
    idToken: 'SYNTHETIC_NEW_ID_TOKEN',
    scopes: tokens.scopes
  })
  const completed = await service.complete(begun.sessionId)
  assert.equal(completed.ok, true)
  assert.deepEqual(revocations, [{ provider: 'openai', refreshToken: tokens.refreshToken }])
  assert.equal((await store.oauthFor(connection.id)).idToken, 'SYNTHETIC_NEW_ID_TOKEN')
  assert.equal(JSON.stringify(await store.snapshot()).includes('SYNTHETIC_NEW_ID_TOKEN'), false)
})

void test('sign-out reconnect uses retained identity without tokens and Add cannot overwrite it', async (t) => {
  const { store, service, credential, registrations } = await signInFixture(t)
  const { connection } = await store.saveOAuthConnection(
    oauthInput,
    { ...oldTokens, subject: 'synthetic-user', idToken: 'SYNTHETIC_ID_TOKEN' },
    {}
  )
  await signOutModelConnection(
    store,
    { id: connection.id, expectedRevision: connection.revision },
    async () => true
  )
  const signedOut = (await store.snapshot()).connections[0]
  assert.deepEqual(await service.begin({ provider: 'openai' }), {
    ok: false,
    reason: 'unavailable'
  })
  assert.deepEqual(registrations, [])
  const begun = await service.begin({
    provider: 'openai',
    id: signedOut.id,
    expectedRevision: signedOut.revision
  })
  assert.deepEqual(registrations, [{ clientId: oldTokens.clientId, subject: 'synthetic-user' }])
  credential.resolve({ ...newCredential, clientId: oldTokens.clientId, subject: 'synthetic-user' })
  const completed = await service.complete(begun.sessionId)
  assert.equal(completed.ok, true)
  assert.equal(completed.connection.id, connection.id)
  assert.equal(completed.connection.credentialRef, connection.credentialRef)
  assert.deepEqual(completed.connection.models, connection.models)
  assert.equal(completed.connection.oauth.signedOut, undefined)
  assert.equal(completed.connection.enabled, false)
  const enabled = await store.save({
    ...oauthInput,
    id: connection.id,
    expectedRevision: completed.connection.revision,
    enabled: true
  })
  assert.equal(
    (await store.acquireForRun(enabled.id, enabled.revision)).oauth.refreshToken,
    newCredential.refresh
  )
})

for (const cancel of [false, true])
  void test(`an exactly retained renewable session is never revoked: cancelled=${cancel}`, async (t) => {
    const { store, service, credential, revocations } = await signInFixture(t)
    const { connection } = await store.saveOAuthConnection(oauthInput, oldTokens, {})
    const begun = await service.begin({
      provider: 'openai',
      id: connection.id,
      expectedRevision: connection.revision
    })
    const completed = service.complete(begun.sessionId)
    if (cancel) service.cancel(begun.sessionId)
    credential.resolve({
      ...newCredential,
      clientId: oldTokens.clientId,
      refresh: oldTokens.refreshToken
    })
    assert.equal((await completed).ok, !cancel)
    assert.deepEqual(revocations, [])
    assert.equal((await store.oauthFor(connection.id)).refreshToken, oldTokens.refreshToken)
  })

for (const status of [200, 400, 500, 'offline'])
  void test(`revocation confirms only the successful token-targeted response: ${status}`, async () => {
    const confirmed = await revokeOAuthGrant('openai', oldTokens, async (url, init) => {
      assert.equal(url, 'https://auth.openai.com/api/accounts/oauth/revoke')
      assert.equal(init.method, 'POST')
      assert.equal(init.redirect, 'error')
      assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)), {
        token: oldTokens.refreshToken,
        token_type_hint: 'refresh_token',
        client_id: oldTokens.clientId
      })
      if (status === 'offline') throw new Error('synthetic offline')
      return new Response('', { status })
    })
    assert.equal(confirmed, status === 200)
  })

void test('abandoning OpenAI reauthorization revokes its new session while retaining the saved one', async (t) => {
  const { store, service, credential, revocations } = await signInFixture(t)
  const { connection } = await store.saveOAuthConnection(oauthInput, oldTokens, {})
  const begun = await service.begin({
    provider: 'openai',
    id: connection.id,
    expectedRevision: connection.revision
  })
  const completed = service.complete(begun.sessionId)
  service.cancel(begun.sessionId)
  credential.resolve({ ...newCredential, clientId: oldTokens.clientId })
  assert.deepEqual(await completed, { ok: false, reason: 'cancelled' })
  assert.deepEqual(await store.oauthFor(connection.id), oldTokens)
  assert.deepEqual(revocations, [{ provider: 'openai', refreshToken: newCredential.refresh }])
})

void test('OAuth refresh retains validated identity and hint while replacing token scopes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 2_000_000_000_000 })
  const store = fakeStore({
    ...oldTokens,
    accessTokenExpiresAt: 1,
    subject: 'synthetic-user',
    idToken: 'SYNTHETIC_ID_TOKEN',
    scopes: ['old-scope']
  })
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          access_token: 'SYNTHETIC_ROTATED_ACCESS',
          refresh_token: 'SYNTHETIC_ROTATED_REFRESH',
          expires_in: 3600,
          scope: 'openid chatgpt.tokens.use.direct'
        })
      )
  )
  assert.equal((await usableOAuthAccessToken(store, 'conn', 'openai', store.oauth())).ok, true)
  assert.equal(store.oauth().refreshToken, 'SYNTHETIC_ROTATED_REFRESH')
  assert.equal(store.oauth().idToken, 'SYNTHETIC_ID_TOKEN')
  assert.equal(store.oauth().subject, 'synthetic-user')
  assert.deepEqual(store.oauth().scopes, ['openid', 'chatgpt.tokens.use.direct'])
})

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

void test('an uncertain write outcome never revokes the same-client new grant actually persisted', async (t) => {
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
  credential.resolve({ ...newCredential, clientId: oldTokens.clientId })
  assert.equal((await service.complete(begun.sessionId)).ok, false)
  assert.equal((await store.oauthFor(edited.id)).refreshToken, newCredential.refresh)
  assert.deepEqual(revocations, [{ provider: 'openai', refreshToken: oldTokens.refreshToken }])
})
