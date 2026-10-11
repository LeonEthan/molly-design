import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'
import type { OAuthAuth, OAuthCredential, Provider } from '@earendil-works/pi-ai'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import type { OpenAiSignInRegistration } from './model-connection-store.ts'

const ISSUER = 'https://auth.openai.com'
const RESOURCE = 'https://api.openai.com/v1'
const DIRECT_SCOPE = 'chatgpt.tokens.use.direct'
const keys = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`))
const tokenString = z.string().min(1).max(16_384)
const TokenResponseSchema = z.object({
  access_token: tokenString,
  refresh_token: tokenString,
  id_token: tokenString,
  expires_in: z.number().positive().max(31_536_000),
  scope: z.string().min(1).max(4096),
  token_type: z.string().refine((value) => value.toLowerCase() === 'bearer')
})

interface Callback {
  redirectUri: string
  result: Promise<URL>
  close(): void
}

export async function openOpenAiCallback(
  state: string,
  signal: AbortSignal,
  makeServer: typeof createServer = createServer
): Promise<Callback> {
  signal.throwIfAborted()
  let resolveResult!: (url: URL) => void
  let rejectResult!: (error: Error) => void
  const result = new Promise<URL>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  void result.catch(() => undefined)
  let consumed = false
  const server = makeServer((request, response) => {
    const raw = request.url ?? '/'
    const url = URL.canParse(raw, 'http://127.0.0.1') ? new URL(raw, 'http://127.0.0.1') : null
    const valid =
      request.method === 'GET' &&
      url?.pathname === '/auth/callback' &&
      url.searchParams.get('state') === state &&
      !consumed
    response.writeHead(valid ? 200 : 400, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'"
    })
    response.end(valid ? 'Return to Molly to finish sign-in.' : 'Invalid sign-in callback.')
    if (valid && url) {
      consumed = true
      resolveResult(url)
    }
  })
  let cancelStartup: (() => void) | undefined
  const close = () => {
    signal.removeEventListener('abort', abort)
    if (cancelStartup) signal.removeEventListener('abort', cancelStartup)
    server.close()
    server.closeAllConnections()
  }
  const abort = () => {
    rejectResult(new Error('oauth_cancelled'))
    close()
  }
  signal.addEventListener('abort', abort, { once: true })
  server.on('error', rejectResult)
  try {
    await new Promise<void>((resolve, reject) => {
      const cancel = () => reject(new Error('oauth_cancelled'))
      cancelStartup = cancel
      signal.addEventListener('abort', cancel, { once: true })
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        signal.removeEventListener('abort', cancel)
        server.removeListener('error', reject)
        if (signal.aborted) {
          close()
          reject(new Error('oauth_cancelled'))
        } else resolve()
      })
    })
    signal.throwIfAborted()
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('oauth_callback_unavailable')
    return { redirectUri: `http://127.0.0.1:${address.port}/auth/callback`, result, close }
  } catch (error) {
    close()
    throw error
  }
}

interface SignInDependencies {
  listen: typeof openOpenAiCallback
  fetch: typeof fetch
  keys: JWTVerifyGetKey
  discard: (credential: OAuthCredential) => Promise<void>
}

export function openAiSignInProvider(
  registration: OpenAiSignInRegistration | undefined,
  discard: SignInDependencies['discard'],
  overrides: Partial<Omit<SignInDependencies, 'discard'>> = {}
): Provider {
  const dependencies = { listen: openOpenAiCallback, fetch, keys, ...overrides, discard }
  const provider = openaiProvider()
  const login: OAuthAuth['login'] = async (interaction, options) => {
    const deviceId = z.uuid().parse(options?.getDeviceId?.())
    const verifier = randomBytes(32).toString('base64url')
    const nonce = randomBytes(32).toString('base64url')
    const state = randomBytes(32).toString('base64url')
    const callback = await dependencies.listen(state, interaction.signal)
    let credential: OAuthCredential | undefined
    try {
      interaction.signal.throwIfAborted()
      const registeredClient = registration?.clientId
      const url = new URL(`${ISSUER}/api/accounts/authorize`)
      url.search = new URLSearchParams({
        client_id: registeredClient ?? 'dynamic_agent_client',
        ext_agent_host_id: `urn:uuid:${deviceId.toLowerCase()}`,
        ...(registeredClient ? {} : { agent_name_hint: 'Molly' }),
        ...(registeredClient && registration?.idToken
          ? { id_token_hint: registration.idToken }
          : {}),
        response_type: 'code',
        redirect_uri: callback.redirectUri,
        resource: RESOURCE,
        scope: `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`,
        state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url')
      }).toString()
      interaction.notify({ type: 'auth_url', url: url.toString() })
      const returned = await callback.result
      if (returned.searchParams.get('state') !== state) throw new Error('oauth_state_mismatch')
      if (returned.searchParams.has('error')) throw new Error('oauth_denied')
      const suppliedClient = returned.searchParams.get('client_id')
      if (registeredClient && suppliedClient !== null && suppliedClient !== registeredClient)
        throw new Error('oauth_client_mismatch')
      const clientId = z
        .string()
        .min(1)
        .max(200)
        .parse(registeredClient ?? suppliedClient)
      if (clientId === 'dynamic_agent_client') throw new Error('oauth_invalid_client')
      const code = z.string().min(1).max(16_384).parse(returned.searchParams.get('code'))
      interaction.signal.throwIfAborted()
      const response = await dependencies.fetch(`${ISSUER}/api/accounts/oauth/token`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: callback.redirectUri,
          resource: RESOURCE
        }),
        signal: interaction.signal
      })
      if (!response.ok) throw new Error('oauth_token_exchange_failed')
      const tokens = TokenResponseSchema.parse(await response.json())
      credential = {
        type: 'oauth',
        access: tokens.access_token,
        refresh: tokens.refresh_token,
        expires: Date.now() + tokens.expires_in * 1000 - 180_000,
        clientId,
        idToken: tokens.id_token,
        scopes: tokens.scope.trim().split(/\s+/)
      }
      const { payload } = await jwtVerify(tokens.id_token, dependencies.keys, {
        issuer: ISSUER,
        audience: clientId,
        requiredClaims: ['sub', 'exp', 'iat'],
        algorithms: ['RS256'],
        clockTolerance: 5
      })
      if (
        payload.nonce !== nonce ||
        typeof payload.sub !== 'string' ||
        !payload.sub ||
        payload.sub.length > 200 ||
        (registration?.subject && payload.sub !== registration.subject)
      )
        throw new Error('oauth_identity_mismatch')
      if (!(credential.scopes as string[]).includes(DIRECT_SCOPE))
        throw new Error('oauth_scope_denied')
      credential.subject = payload.sub
      if (typeof payload.email === 'string' && payload.email.length <= 300)
        credential.email = payload.email
      interaction.signal.throwIfAborted()
      return credential
    } catch (error) {
      if (credential) await dependencies.discard(credential)
      throw error
    } finally {
      callback.close()
    }
  }
  if (!provider.auth.oauth) throw new Error('oauth_unavailable')
  return { ...provider, auth: { ...provider.auth, oauth: { ...provider.auth.oauth, login } } }
}
