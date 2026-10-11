/**
 * Subscription OAuth sign-in for model connections, driven by pi-ai's official provider
 * flows (OpenAI "Sign in with ChatGPT" dynamic client registration; Kimi Code RFC 8628
 * device authorization; more providers reuse the same shape).
 *
 * pi-ai owns the callback server / device polling, code exchange and (under the
 * vault-adapted CredentialStore lock in oauth-refresh.ts) refresh; this module owns the
 * flow ↔ renderer IPC shape and mapping the credential onto a vault connection row.
 * One flow at a time; beginning cancels any prior pending flow.
 */
import { randomUUID } from 'node:crypto'
import {
  createModels,
  type AuthInteraction,
  type Credential,
  type Provider
} from '@earendil-works/pi-ai'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding'
import {
  PROVIDER_PRESET_DEFAULT_BASE_URLS,
  type ModelConnection,
  type OAuthProviderPresetId
} from '@molly/shared/embedded-harness'
import type { ModelConnectionStore, OAuthTokenSet, StoreEntry } from './model-connection-store'

export type OAuthSignInBeginResult =
  | {
      sessionId: string
      /** Browser-callback flows: the URL the renderer opens. */
      authorizeUrl?: string
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
  { provider: () => Provider; displayName: string }
> = {
  openai: { provider: openaiProvider, displayName: 'OpenAI (ChatGPT)' },
  'kimi-coding': { provider: kimiCodingProvider, displayName: 'Kimi Code' }
}

interface PendingFlow {
  sessionId: string
  providerPresetId: OAuthProviderPresetId
  abort: AbortController
  expiryTimer: NodeJS.Timeout
  result: Promise<OAuthSignInCompleteResult>
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
  }
  return {
    accessToken: typeof raw.access === 'string' ? raw.access : '',
    refreshToken: typeof raw.refresh === 'string' ? raw.refresh : '',
    accessTokenExpiresAt: typeof raw.expires === 'number' ? raw.expires : 0,
    clientId: typeof raw.clientId === 'string' ? raw.clientId : undefined
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
  /** Rows whose own flow was cancelled, with the row they replaced (for chain walks). */
  private readonly cancelledConnections = new Map<string, StoreEntry | undefined>()

  constructor(
    private readonly store: ModelConnectionStore,
    private readonly openExternal: (url: string) => void | Promise<void>
  ) {}

  async begin(providerPresetId: OAuthProviderPresetId): Promise<OAuthSignInBeginResult> {
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

    const models = createModels({ credentials: scratchCredentialStore(providerPresetId) })
    models.setProvider(descriptor.provider())

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
    this.pending = { sessionId, providerPresetId, abort, expiryTimer, result }

    void (async () => {
      try {
        const credential = await models.login(providerPresetId, 'oauth', interaction, {
          getDeviceId: () => this.store.deviceId()
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
    if ('authorizeUrl' in first) await this.openExternal(first.authorizeUrl)
    return { sessionId, ...first, expiresAt: Date.now() + FLOW_TIMEOUT_MS }
  }

  private async finishLogin(
    sessionId: string,
    providerPresetId: OAuthProviderPresetId,
    credential: Credential
  ): Promise<OAuthSignInCompleteResult> {
    const tokens = tokenSetFromCredential(credential)
    if (!tokens.accessToken || !tokens.refreshToken)
      return { ok: false, reason: 'invalid_response' }
    // The flow may have been cancelled while the exchange was in flight; a cancelled
    // flow must not save an account.
    if (this.pending?.sessionId !== sessionId) return { ok: false, reason: 'cancelled' }
    try {
      const saved = await this.store.saveOAuthConnection(
        {
          displayName: OAUTH_PROVIDERS[providerPresetId].displayName,
          providerPresetId,
          baseUrl: PROVIDER_PRESET_DEFAULT_BASE_URLS[providerPresetId],
          enabled: true,
          authType: 'openai_oauth'
        },
        tokens,
        { accountId: accountIdFromAccessToken(tokens.accessToken) }
      )
      // The write may have queued behind a cancellation: remove the new row and
      // restore the oldest live predecessor in its replacement chain, so a cancelled
      // flow strands no grant and overlapping cancels walk back to the last live row.
      if (this.pending?.sessionId !== sessionId) {
        this.cancelledConnections.set(saved.connection.id, saved.replaced)
        let predecessor = saved.replaced
        while (predecessor && this.cancelledConnections.has(predecessor.connection.id))
          predecessor = this.cancelledConnections.get(predecessor.connection.id)
        await this.store
          .rollbackOAuthConnection(saved.connection.id, predecessor)
          .catch(() => undefined)
        return { ok: false, reason: 'cancelled' }
      }
      this.cancelledConnections.delete(saved.connection.id)
      return { ok: true, connection: saved.connection }
    } catch {
      return { ok: false, reason: 'unreachable' }
    }
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
    if (!pending) return
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

/** Best-effort RFC 7009 revocation per provider before local deletion; never throws. */
const OAUTH_REVOKE_URLS: Partial<Record<string, string>> = {
  openai: 'https://auth.openai.com/api/accounts/oauth/revoke',
  'kimi-coding': 'https://auth.kimi.com/api/oauth/revoke'
}

export async function revokeOAuthGrant(
  providerPresetId: string,
  tokens: { refreshToken: string; clientId?: string },
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const url = OAUTH_REVOKE_URLS[providerPresetId]
  if (!url) return
  try {
    await fetchFn(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json'
      },
      body: new URLSearchParams({
        token: tokens.refreshToken,
        token_type_hint: 'refresh_token',
        ...(tokens.clientId ? { client_id: tokens.clientId } : {})
      }).toString(),
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    // Best-effort: local deletion proceeds regardless.
  }
}
