/**
 * OpenAI "Sign in with ChatGPT" OAuth for model connections, driven by pi-ai's
 * official third-party flow: OpenAI dynamically registers a client per login
 * (agent name hint "Molly") and issues an access token that goes straight to
 * api.openai.com — no borrowed Codex CLI client id.
 *
 * pi-ai owns the callback server, code exchange and (under the vault-adapted
 * CredentialStore lock) refresh; this module owns the flow ↔ renderer IPC
 * shape and mapping the credential onto a vault connection row.
 */
import { randomUUID } from 'node:crypto'
import { createModels, type AuthInteraction, type Credential } from '@earendil-works/pi-ai'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import {
  PROVIDER_PRESET_DEFAULT_BASE_URLS,
  type ModelConnection
} from '@molly/shared/embedded-harness'
import type { ModelConnectionStore, OAuthTokenSet } from './model-connection-store'

export type OpenAiAuthBeginResult =
  | { sessionId: string; authorizeUrl: string; expiresAt: number }
  | { ok: false; reason: 'unavailable' }

export type OpenAiAuthCompleteResult =
  | { ok: true; connection: ModelConnection }
  | { ok: false; reason: 'cancelled' | 'timed_out' | 'denied' | 'unreachable' | 'invalid_response' }

const FLOW_TIMEOUT_MS = 120_000

interface PendingFlow {
  sessionId: string
  abort: AbortController
  expiryTimer: NodeJS.Timeout
  result: Promise<OpenAiAuthCompleteResult>
}

/**
 * Login-time store: a scratch pad so `Models.login` can persist the credential it just
 * minted without touching the vault. The service's `finishLogin` writes the connection
 * row; the runtime refresh path uses the vault-backed store in openai-oauth-refresh.ts.
 */
function scratchCredentialStore() {
  let held: Credential | undefined
  return {
    read: async () => held,
    list: async () => (held ? [{ providerId: 'openai', type: 'oauth' as const }] : []),
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

export class OpenAiAuthService {
  private pending: PendingFlow | undefined

  constructor(
    private readonly store: ModelConnectionStore,
    private readonly openExternal: (url: string) => void | Promise<void>
  ) {}

  /** One flow at a time; beginning cancels any prior pending flow. */
  async begin(): Promise<OpenAiAuthBeginResult> {
    this.cancelPending()
    const sessionId = randomUUID()
    const abort = new AbortController()
    let notifyUrl: ((url: string) => void) | undefined
    const urlReady = new Promise<string>((resolve, reject) => {
      notifyUrl = resolve
      abort.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    })

    const interaction: AuthInteraction = {
      signal: abort.signal,
      notify: (event) => {
        if (event.type === 'auth_url') notifyUrl?.(event.url)
      },
      // The settings form has no paste-a-redirect-URL affordance yet.
      prompt: () => Promise.reject(new Error('manual_code_unsupported'))
    }

    const models = createModels({ credentials: scratchCredentialStore() })
    models.setProvider(openaiProvider())

    let settle: (result: OpenAiAuthCompleteResult) => void = () => {}
    const result = new Promise<OpenAiAuthCompleteResult>((resolve) => {
      settle = resolve
    })
    const expiryTimer = setTimeout(() => {
      abort.abort()
      settle({ ok: false, reason: 'timed_out' })
    }, FLOW_TIMEOUT_MS)
    expiryTimer.unref?.()
    this.pending = { sessionId, abort, expiryTimer, result }

    void (async () => {
      try {
        const credential = await models.login('openai', 'oauth', interaction, {
          getDeviceId: () => this.store.deviceId()
        })
        settle(await this.finishLogin(credential))
      } catch (error) {
        settle({ ok: false, reason: abort.signal.aborted ? 'cancelled' : mapLoginError(error) })
      }
    })()

    const authorizeUrl = await urlReady.catch(() => undefined)
    if (!authorizeUrl) {
      this.cancelPending()
      return { ok: false, reason: 'unavailable' }
    }
    await this.openExternal(authorizeUrl)
    return { sessionId, authorizeUrl, expiresAt: Date.now() + FLOW_TIMEOUT_MS }
  }

  private async finishLogin(credential: Credential): Promise<OpenAiAuthCompleteResult> {
    const tokens = tokenSetFromCredential(credential)
    if (!tokens.accessToken || !tokens.refreshToken)
      return { ok: false, reason: 'invalid_response' }
    try {
      const connection = await this.store.saveOAuthConnection(
        {
          displayName: 'OpenAI (ChatGPT)',
          providerPresetId: 'openai',
          baseUrl: PROVIDER_PRESET_DEFAULT_BASE_URLS.openai,
          enabled: true,
          authType: 'openai_oauth'
        },
        tokens,
        {}
      )
      return { ok: true, connection }
    } catch {
      return { ok: false, reason: 'unreachable' }
    }
  }

  /** Resolves when the flow completes (browser callback), times out or is cancelled. */
  complete(sessionId: string): Promise<OpenAiAuthCompleteResult> {
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
  if (/access_denied|denied/i.test(message)) return 'denied'
  if (/fetch|network|ECONN|ENOTFOUND|timeout/i.test(message)) return 'unreachable'
  return 'invalid_response'
}

/** Dynamic-client sign-out has no server-side revoke; the caller deletes the vault row. */
export async function revokeOAuthTokens(): Promise<void> {}
