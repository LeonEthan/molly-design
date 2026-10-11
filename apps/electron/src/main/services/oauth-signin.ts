import { randomUUID } from 'node:crypto'
import {
  createModels,
  type AuthInteraction,
  type Credential,
  type Provider
} from '@earendil-works/pi-ai'
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding'
import {
  BeginOpenAiAuthSchema,
  PROVIDER_PRESET_DEFAULT_BASE_URLS,
  type BeginOpenAiAuth,
  type ModelConnection,
  type OAuthProviderPresetId
} from '@molly/shared/embedded-harness'
import type { ModelConnectionStore, OAuthTokenSet } from './model-connection-store'
import { revokeOAuthGrant } from './oauth-revocation.ts'
import { openAiSignInProvider } from './openai-signin.ts'

export type OAuthSignInBeginResult =
  | {
      sessionId: string
      /** Device-code flows: code the user enters at the verification page. */
      deviceCode?: { userCode: string; verificationUri: string }
      expiresAt: number
    }
  | { ok: false; reason: 'unavailable' }

export type OAuthSignInCompleteResult =
  | { ok: true; connection: ModelConnection }
  | { ok: false; reason: 'cancelled' | 'timed_out' | 'denied' | 'unreachable' | 'invalid_response' }

const FLOW_TIMEOUT_MS = 15 * 60_000

// pi-ai's providers load OAuth flows through a bundler-opaque variable specifier, which
// would leave them out of the packaged main bundle. Register the statically bundled
// flows explicitly so the lazy loaders resolve without a runtime file lookup.
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'

registerBunOAuthFlows()

const OAUTH_PROVIDERS: Record<
  OAuthProviderPresetId,
  { provider?: () => Provider; displayName: string }
> = {
  openai: { displayName: 'OpenAI (ChatGPT)' },
  'kimi-coding': { provider: kimiCodingProvider, displayName: 'Kimi Code' }
}

interface PendingFlow {
  sessionId: string
  providerPresetId: OAuthProviderPresetId
  abort: AbortController
  expiryTimer: NodeJS.Timeout
  result: Promise<OAuthSignInCompleteResult>
  target: Pick<BeginOpenAiAuth, 'id' | 'expectedRevision'>
  committing: boolean
}

/**
 * Login-time store: a scratch pad so `Models.login` can persist the credential it just
 * minted without touching the vault. The service's `finishLogin` writes the connection
 * row; the runtime refresh path uses the vault-backed store in oauth-refresh.ts.
 */
function scratchCredentialStore(providerId: string) {
  let held: Credential | undefined
  return {
    read: async () => held,
    list: async () => (held ? [{ providerId, type: 'oauth' as const }] : []),
    modify: async (
      _providerId: string,
      fn: (current: Credential | undefined) => Promise<Credential | undefined>
    ) => {
      held = await fn(held)
      return held
    },
    delete: async () => {
      held = undefined
    }
  }
}

function tokenSetFromCredential(credential: Credential): OAuthTokenSet {
  const raw = credential as {
    access?: unknown
    refresh?: unknown
    expires?: unknown
    clientId?: unknown
    idToken?: unknown
    subject?: unknown
    scopes?: unknown
  }
  return {
    accessToken: typeof raw.access === 'string' ? raw.access : '',
    refreshToken: typeof raw.refresh === 'string' ? raw.refresh : '',
    accessTokenExpiresAt: typeof raw.expires === 'number' ? raw.expires : 0,
    clientId: typeof raw.clientId === 'string' ? raw.clientId : undefined,
    ...(typeof raw.idToken === 'string' ? { idToken: raw.idToken } : {}),
    ...(typeof raw.subject === 'string' ? { subject: raw.subject } : {}),
    ...(Array.isArray(raw.scopes) && raw.scopes.every((scope) => typeof scope === 'string')
      ? { scopes: raw.scopes }
      : {})
  }
}

/** Best-effort account id from the access token JWT (chatgpt_account_id claim). */
function accountIdFromAccessToken(accessToken: string): string | undefined {
  const parts = accessToken.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      chatgpt_account_id?: unknown
    }
    return typeof payload.chatgpt_account_id === 'string' &&
      payload.chatgpt_account_id.length <= 200
      ? payload.chatgpt_account_id
      : undefined
  } catch {
    return undefined
  }
}

export class OAuthSignInService {
  private pending: PendingFlow | undefined
  private readonly store: ModelConnectionStore
  private readonly openExternal: (url: string) => void | Promise<void>
  private readonly modelsFactory: typeof createModels
  private readonly revoke: typeof revokeOAuthGrant
  private readonly openAiProvider: typeof openAiSignInProvider

  constructor(
    store: ModelConnectionStore,
    openExternal: (url: string) => void | Promise<void>,
    modelsFactory: typeof createModels = createModels,
    revoke: typeof revokeOAuthGrant = revokeOAuthGrant,
    openAiProvider: typeof openAiSignInProvider = openAiSignInProvider
  ) {
    this.store = store
    this.openExternal = openExternal
    this.modelsFactory = modelsFactory
    this.revoke = revoke
    this.openAiProvider = openAiProvider
  }

  async begin(input: BeginOpenAiAuth = {}): Promise<OAuthSignInBeginResult> {
    const parsed = BeginOpenAiAuthSchema.safeParse(input)
    if (!parsed.success || this.pending?.committing) return { ok: false, reason: 'unavailable' }
    const providerPresetId = parsed.data.provider ?? 'openai'
    this.cancelPending()
    const descriptor = OAUTH_PROVIDERS[providerPresetId]
    if (!descriptor) return { ok: false, reason: 'unavailable' }
    const sessionId = randomUUID()
    const abort = new AbortController()
    let notifyUrl: ((url: string) => void) | undefined
    let notifyDeviceCode:
      | ((code: { userCode: string; verificationUri: string }) => void)
      | undefined
    let failReady: ((error: Error) => void) | undefined
    const readyFailed = new Promise<never>((_resolve, reject) => {
      failReady = reject
    })
    // Suppress the unhandled rejection when the flow announces normally.
    readyFailed.catch(() => undefined)
    const urlReady = new Promise<string>((resolve, reject) => {
      notifyUrl = resolve
      abort.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    })
    const deviceCodeReady = new Promise<{ userCode: string; verificationUri: string }>(
      (resolve, reject) => {
        notifyDeviceCode = resolve
        abort.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      }
    )

    const interaction: AuthInteraction = {
      signal: abort.signal,
      notify: (event) => {
        if (event.type === 'auth_url') notifyUrl?.(event.url)
        if (event.type === 'device_code')
          notifyDeviceCode?.({ userCode: event.userCode, verificationUri: event.verificationUri })
      },
      // The settings form has no paste-a-code affordance; pi-ai races this prompt against
      // the callback/device poll, so it must stay pending until the flow's abort signal
      // settles it — including a cancellation that already landed.
      prompt: (authPrompt) =>
        new Promise<string>((_resolve, reject) => {
          if (authPrompt.signal?.aborted) {
            reject(new Error('manual_code_dismissed'))
            return
          }
          authPrompt.signal?.addEventListener(
            'abort',
            () => reject(new Error('manual_code_dismissed')),
            { once: true }
          )
        })
    }

    let settle: (result: OAuthSignInCompleteResult) => void = () => {}
    const result = new Promise<OAuthSignInCompleteResult>((resolve) => {
      settle = resolve
    })
    const expiryTimer = setTimeout(() => {
      // Cancel through the shared path so ownership is cleared; a save queued behind
      // the timeout must not persist.
      if (this.pending?.sessionId === sessionId) this.cancelPending()
      settle({ ok: false, reason: 'timed_out' })
    }, FLOW_TIMEOUT_MS)
    expiryTimer.unref?.()
    this.pending = {
      sessionId,
      providerPresetId,
      abort,
      expiryTimer,
      result,
      target: { id: parsed.data.id, expectedRevision: parsed.data.expectedRevision },
      committing: false
    }

    void (async () => {
      try {
        const deviceId = await this.store.deviceId()
        const snapshot = await this.store.snapshot()
        const edited = parsed.data.id
          ? snapshot.connections.find((connection) => connection.id === parsed.data.id)
          : undefined
        if (
          !parsed.data.id &&
          providerPresetId === 'openai' &&
          snapshot.connections.some(
            (connection) => connection.providerPresetId === 'openai' && connection.oauth?.signedOut
          )
        )
          throw new Error('model_connection_oauth_provider_conflict')
        if (parsed.data.id && (!edited || edited.revision !== parsed.data.expectedRevision))
          throw new Error('model_connection_revision_conflict')
        const prior =
          providerPresetId === 'openai' && parsed.data.id
            ? await this.store.openAiRegistrationForSignIn(
                parsed.data.id,
                parsed.data.expectedRevision!
              )
            : null
        if (
          providerPresetId === 'openai' &&
          edited?.providerPresetId === 'openai' &&
          edited.authType === 'openai_oauth' &&
          !prior
        )
          throw new Error('model_connection_revision_conflict')
        abort.signal.throwIfAborted()
        const models = this.modelsFactory({ credentials: scratchCredentialStore(providerPresetId) })
        const provider =
          providerPresetId === 'openai'
            ? this.openAiProvider(prior ?? undefined, async (credential) =>
                this.discardGrant('openai', tokenSetFromCredential(credential))
              )
            : descriptor.provider!()
        models.setProvider(provider)
        const credential = await models.login(providerPresetId, 'oauth', interaction, {
          getDeviceId: () => deviceId
        })
        settle(await this.finishLogin(sessionId, providerPresetId, credential))
      } catch (error) {
        const reason = abort.signal.aborted ? 'cancelled' : mapLoginError(error)
        // A failure before any notification must also release begin(): the renderer
        // awaits it before it can show a cancel control.
        failReady?.(error instanceof Error ? error : new Error(String(error)))
        settle({ ok: false, reason })
      }
    })()

    // Device-code flows announce the code instead of a URL to open; a login failure
    // before either notification settles begin() with that failure.
    const first = await Promise.race([
      urlReady.then((authorizeUrl) => ({ authorizeUrl }) as const),
      deviceCodeReady.then((deviceCode) => ({ deviceCode }) as const),
      readyFailed
    ]).catch(() => undefined)
    if (!first) {
      // Clean up only this flow; a replacement may already own the slot.
      if (this.pending?.sessionId === sessionId) this.cancelPending()
      return { ok: false, reason: 'unavailable' }
    }
    if (this.pending?.sessionId !== sessionId || abort.signal.aborted)
      return { ok: false, reason: 'unavailable' }
    if ('authorizeUrl' in first) {
      try {
        await this.openExternal(first.authorizeUrl)
      } catch {
        if (this.pending?.sessionId === sessionId) this.cancelPending()
        return { ok: false, reason: 'unavailable' }
      }
    }
    return {
      sessionId,
      ...('deviceCode' in first ? first : {}),
      expiresAt: Date.now() + FLOW_TIMEOUT_MS
    }
  }

  private async finishLogin(
    sessionId: string,
    providerPresetId: OAuthProviderPresetId,
    credential: Credential
  ): Promise<OAuthSignInCompleteResult> {
    const tokens = tokenSetFromCredential(credential)
    const accountId = accountIdFromAccessToken(tokens.accessToken)
    if (!tokens.accessToken || !tokens.refreshToken)
      return { ok: false, reason: 'invalid_response' }
    const pending = this.pending
    if (pending?.sessionId !== sessionId) {
      await this.discardGrant(providerPresetId, tokens)
      return { ok: false, reason: 'cancelled' }
    }
    try {
      const saved = await this.store.saveOAuthConnection(
        {
          ...pending.target,
          displayName: OAUTH_PROVIDERS[providerPresetId].displayName,
          providerPresetId,
          baseUrl: PROVIDER_PRESET_DEFAULT_BASE_URLS[providerPresetId],
          enabled: true,
          authType: 'openai_oauth'
        },
        tokens,
        {
          ...(accountId ? { accountId } : {}),
          ...(credential.type === 'oauth' && typeof credential.email === 'string'
            ? { email: credential.email }
            : {})
        },
        async (previous) => {
          if (this.pending !== pending || pending.abort.signal.aborted)
            throw new Error('oauth_cancelled')
          pending.committing = true
          clearTimeout(pending.expiryTimer)
          if (!previous?.oauth) return false
          if (
            previous.connection.providerPresetId === providerPresetId &&
            previous.oauth.clientId === tokens.clientId &&
            previous.oauth.refreshToken === tokens.refreshToken
          )
            return false
          await this.revoke(previous.connection.providerPresetId, previous.oauth).catch(
            () => undefined
          )
          return true
        }
      )
      return { ok: true, connection: saved.connection }
    } catch {
      await this.discardGrant(providerPresetId, tokens)
      return { ok: false, reason: pending.abort.signal.aborted ? 'cancelled' : 'unreachable' }
    } finally {
      pending.committing = false
      clearTimeout(pending.expiryTimer)
    }
  }

  private async discardGrant(providerPresetId: OAuthProviderPresetId, tokens: OAuthTokenSet) {
    try {
      if (await this.store.hasOAuthGrant(providerPresetId, tokens)) return
      await this.revoke(providerPresetId, tokens).catch(() => undefined)
    } catch {}
  }

  /** Resolves when the flow completes, times out or is cancelled. */
  complete(sessionId: string): Promise<OAuthSignInCompleteResult> {
    if (this.pending?.sessionId !== sessionId)
      return Promise.resolve({ ok: false, reason: 'cancelled' })
    return this.pending.result
  }

  cancel(sessionId: string) {
    if (this.pending?.sessionId === sessionId) this.cancelPending()
  }

  private cancelPending() {
    const pending = this.pending
    if (!pending || pending.committing) return
    this.pending = undefined
    clearTimeout(pending.expiryTimer)
    pending.abort.abort()
  }
}

function mapLoginError(error: unknown): 'denied' | 'unreachable' | 'invalid_response' {
  const message = error instanceof Error ? error.message : ''
  if (/access_denied|denied|unauthorized|invalid_grant/i.test(message)) return 'denied'
  if (/fetch|network|ECONN|ENOTFOUND|timeout/i.test(message)) return 'unreachable'
  return 'invalid_response'
}
