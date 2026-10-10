import { createHash, randomBytes, randomUUID } from 'node:crypto'
import http from 'node:http'
import {
  PROVIDER_PRESET_DEFAULT_BASE_URLS,
  type ModelConnection,
  type OpenAiAuthCompleteResult,
  type OpenAiAuthSession,
  type SaveModelConnection
} from '@molly/shared/embedded-harness'
import type { ModelConnectionStore } from './model-connection-store'
import type { OAuthTokenSet } from './model-connection-store'

/**
 * OpenAI account sign-in for model connections. This reuses the public Codex CLI OAuth
 * client (`openai/codex`, Apache-2.0): the redirect whitelist is fixed by OpenAI to
 * localhost:1455/1457, so third-party clients share that client_id and callback pair.
 * This is tolerated but not a formally documented third-party program; the flow must stay
 * a single explicit user action, degrade to API key on any failure, and never hide which
 * account it signed into.
 */
const ISSUER = 'https://auth.openai.com'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const REDIRECT_PORTS = [1455, 1457] as const
const REDIRECT_PATH = '/auth/callback'
const SCOPES = 'openid profile email offline_access'
const OAUTH_TIMEOUT_MS = 120_000

const base64url = (input: Buffer) =>
  input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function pkcePair() {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** Claims Molly reads from the id_token JWT; nothing else is trusted from it. */
export function readIdTokenClaims(idToken: string): {
  email?: string
  plan?: string
  accountId?: string
} {
  const parts = idToken.split('.')
  if (parts.length !== 3) return {}
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
    const auth = (payload['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>
    return {
      email: typeof payload.email === 'string' ? payload.email : undefined,
      plan: typeof auth.chatgpt_plan_type === 'string' ? auth.chatgpt_plan_type : undefined,
      accountId: typeof auth.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : undefined
    }
  } catch {
    return {}
  }
}

async function exchangeCode(
  fetchFn: typeof fetch,
  input: { code: string; verifier: string; redirectUri: string }
): Promise<
  | { ok: true; tokens: { idToken: string; tokenSet: OAuthTokenSet } }
  | { ok: false; reason: 'denied' | 'unreachable' | 'invalid_response' }
> {
  let response: Response
  try {
    response = await fetchFn(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code: input.code,
        code_verifier: input.verifier,
        redirect_uri: input.redirectUri
      }),
      signal: AbortSignal.timeout(15_000)
    })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return {
      ok: false,
      reason: response.status === 400 || response.status === 401 ? 'denied' : 'unreachable'
    }
  }
  let data: {
    id_token?: unknown
    access_token?: unknown
    refresh_token?: unknown
    expires_in?: unknown
  }
  try {
    data = (await response.json()) as typeof data
  } catch {
    return { ok: false, reason: 'invalid_response' }
  }
  if (
    typeof data.id_token !== 'string' ||
    typeof data.access_token !== 'string' ||
    typeof data.refresh_token !== 'string' ||
    typeof data.expires_in !== 'number'
  )
    return { ok: false, reason: 'invalid_response' }
  return {
    ok: true,
    tokens: {
      idToken: data.id_token,
      tokenSet: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        accessTokenExpiresAt: Date.now() + data.expires_in * 1000
      }
    }
  }
}

/**
 * Refreshes an OAuth token set; the rotated set replaces the old one. A reused or revoked
 * refresh token is `denied` and must surface as re-authentication, never a silent key drop.
 */
export async function refreshOAuthTokens(
  fetchFn: typeof fetch,
  current: OAuthTokenSet
): Promise<
  | { ok: true; tokens: OAuthTokenSet }
  | { ok: false; reason: 'denied' | 'unreachable' | 'invalid_response' }
> {
  let response: Response
  try {
    response = await fetchFn(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: current.refreshToken
      }),
      signal: AbortSignal.timeout(15_000)
    })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return {
      ok: false,
      reason: response.status === 400 || response.status === 401 ? 'denied' : 'unreachable'
    }
  }
  let data: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }
  try {
    data = (await response.json()) as typeof data
  } catch {
    return { ok: false, reason: 'invalid_response' }
  }
  if (
    typeof data.access_token !== 'string' ||
    typeof data.refresh_token !== 'string' ||
    typeof data.expires_in !== 'number'
  )
    return { ok: false, reason: 'invalid_response' }
  return {
    ok: true,
    tokens: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accessTokenExpiresAt: Date.now() + data.expires_in * 1000,
      accountId: current.accountId
    }
  }
}

/** Best-effort revocation; local deletion proceeds even when the network call fails. */
export async function revokeOAuthTokens(fetchFn: typeof fetch, current: OAuthTokenSet) {
  try {
    await fetchFn(`${ISSUER}/oauth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, token: current.refreshToken }),
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    /* sign-out stays local */
  }
}

type Pending = {
  sessionId: string
  verifier: string
  state: string
  redirectUri: string
  server: http.Server
  expiresAt: number
  expiryTimer: ReturnType<typeof setTimeout>
  promise: Promise<OpenAiAuthCompleteResult>
  resolve: (result: OpenAiAuthCompleteResult) => void
}

/**
 * One in-flight flow per process. The callback server listens on 127.0.0.1 only, answers
 * exactly one request, and closes; state and PKCE verifier never leave main.
 */
export class OpenAiAuthService {
  private pending: Pending | null = null
  private readonly store: ModelConnectionStore
  private readonly fetchFn: typeof fetch
  private readonly openExternal: (url: string) => Promise<void>

  constructor(
    store: ModelConnectionStore,
    fetchFn: typeof fetch = fetch,
    openExternal: (url: string) => Promise<void>
  ) {
    this.store = store
    this.fetchFn = fetchFn
    this.openExternal = openExternal
  }

  async begin(): Promise<OpenAiAuthSession | { ok: false; reason: 'unavailable' }> {
    this.cancelPending('cancelled')
    const { verifier, challenge } = pkcePair()
    const state = base64url(randomBytes(32))
    const sessionId = randomUUID()
    const { server, port } = await this.listen()
    if (!server || !port) return { ok: false, reason: 'unavailable' }
    const redirectUri = `http://localhost:${port}${REDIRECT_PATH}`
    const authorizeUrl =
      `${ISSUER}/oauth/authorize?` +
      new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        scope: SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        originator: 'molly'
      }).toString()
    const expiresAt = Date.now() + OAUTH_TIMEOUT_MS
    let resolvePromise: (result: OpenAiAuthCompleteResult) => void = () => undefined
    const promise = new Promise<OpenAiAuthCompleteResult>((resolve) => {
      resolvePromise = resolve
    })
    this.pending = {
      sessionId,
      verifier,
      state,
      redirectUri,
      server,
      expiresAt,
      expiryTimer: setTimeout(() => this.cancelPending('timed_out'), OAUTH_TIMEOUT_MS),
      promise,
      resolve: resolvePromise
    }
    server.on('request', (request, response) => {
      void this.handleCallback(request, response).catch(() => {
        response.statusCode = 500
        response.end('Sign-in failed. Return to Molly.')
      })
    })
    await this.openExternal(authorizeUrl)
    return { sessionId, authorizeUrl, expiresAt }
  }

  private listen(): Promise<{ server: http.Server | null; port: number | null }> {
    return new Promise((resolve) => {
      const tryPort = (index: number) => {
        const port = REDIRECT_PORTS[index]
        if (port === undefined) return resolve({ server: null, port: null })
        const server = http.createServer()
        server.once('error', () => tryPort(index + 1))
        server.listen(port, '127.0.0.1', () => resolve({ server, port }))
      }
      tryPort(0)
    })
  }

  private async handleCallback(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ): Promise<void> {
    const pending = this.pending
    if (!pending || Date.now() > pending.expiresAt) {
      if (pending) this.cancelPending('timed_out')
      response.statusCode = 410
      response.end('This sign-in session has ended. Return to Molly.')
      return
    }
    const url = new URL(request.url ?? '', 'http://127.0.0.1')
    if (url.pathname !== REDIRECT_PATH) {
      response.statusCode = 404
      response.end()
      return
    }
    const finish = (result: OpenAiAuthCompleteResult) => {
      pending.server.close()
      // Clear only when this flow still owns the slot; a replacement may already be pending.
      if (this.pending === pending) this.pending = null
      pending.resolve(result)
    }
    const fail = (reason: 'denied' | 'timed_out' | 'invalid_response' | 'unreachable') => {
      response.statusCode = 200
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(
        '<!doctype html><meta charset="utf-8"><title>Molly</title><p>Sign-in did not complete. You can close this tab and return to Molly.</p>'
      )
      finish({ ok: false, reason })
    }
    const error = url.searchParams.get('error')
    if (error) return fail('denied')
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (!code || !state || state !== pending.state) return fail('invalid_response')
    const exchanged = await exchangeCode(this.fetchFn, {
      code,
      verifier: pending.verifier,
      redirectUri: pending.redirectUri
    })
    // The user may have cancelled while the exchange was in flight; a replacement flow
    // (or none) now owns `this.pending`, and this callback must not touch it.
    if (this.pending !== pending) {
      response.statusCode = 410
      response.end('This sign-in session has ended. Return to Molly.')
      return
    }
    if (!exchanged.ok) return fail(exchanged.reason)
    const claims = readIdTokenClaims(exchanged.tokens.idToken)
    const input: SaveModelConnection = {
      providerPresetId: 'openai',
      displayName: claims.email ? `OpenAI · ${claims.email}` : 'OpenAI',
      baseUrl: PROVIDER_PRESET_DEFAULT_BASE_URLS.openai,
      enabled: true,
      authType: 'openai_oauth'
    }
    if (this.pending !== pending) {
      response.statusCode = 410
      response.end('This sign-in session has ended. Return to Molly.')
      return
    }
    let connection: ModelConnection
    try {
      connection = await this.store.saveOAuthConnection(
        input,
        {
          ...exchanged.tokens.tokenSet,
          ...(claims.accountId ? { accountId: claims.accountId } : {})
        },
        {
          ...(claims.email ? { email: claims.email } : {}),
          ...(claims.plan ? { plan: claims.plan } : {}),
          ...(claims.accountId ? { accountId: claims.accountId } : {})
        }
      )
    } catch {
      return fail('invalid_response')
    }
    if (this.pending !== pending) {
      // Cancelled while the vault wrote; remove the just-saved account rather than leaving it.
      await this.store
        .delete({ id: connection.id, expectedRevision: connection.revision })
        .catch(() => undefined)
      response.statusCode = 410
      response.end('This sign-in session has ended. Return to Molly.')
      return
    }
    response.statusCode = 200
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(
      '<!doctype html><meta charset="utf-8"><title>Molly</title><p>Sign-in complete. You can close this tab and return to Molly.</p>'
    )
    finish({ ok: true, connection })
  }

  async complete(sessionId: string): Promise<OpenAiAuthCompleteResult> {
    const pending = this.pending
    if (!pending || pending.sessionId !== sessionId) return { ok: false, reason: 'cancelled' }
    if (Date.now() > pending.expiresAt) {
      this.cancelPending('timed_out')
      return { ok: false, reason: 'timed_out' }
    }
    return pending.promise
  }

  cancelPending(reason: 'cancelled' | 'timed_out' = 'cancelled') {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    clearTimeout(pending.expiryTimer)
    pending.server.close()
    pending.resolve({ ok: false, reason })
  }

  /** Cancels only when the id matches the pending flow. */
  cancel(sessionId: string) {
    if (this.pending?.sessionId === sessionId) this.cancelPending('cancelled')
  }
}
