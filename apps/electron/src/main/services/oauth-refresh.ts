import {
  createModels,
  type Credential,
  type CredentialStore,
  type Provider
} from '@earendil-works/pi-ai'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { kimiCodingProvider } from '@earendil-works/pi-ai/providers/kimi-coding'
import type { OAuthProviderPresetId } from '@molly/shared/embedded-harness'
import type { ModelConnectionStore, OAuthTokenSet } from './model-connection-store.ts'

const OAUTH_PROVIDERS: Record<OAuthProviderPresetId, () => Provider> = {
  openai: openaiProvider,
  'kimi-coding': kimiCodingProvider
}

function toCredential(tokens: OAuthTokenSet): Credential {
  return {
    type: 'oauth',
    access: tokens.accessToken,
    refresh: tokens.refreshToken,
    expires: tokens.accessTokenExpiresAt,
    ...(tokens.clientId ? { clientId: tokens.clientId } : {})
  } as Credential
}

function toTokenSet(credential: Credential, accountId?: string): OAuthTokenSet | undefined {
  const raw = credential as {
    access?: unknown
    refresh?: unknown
    expires?: unknown
    clientId?: unknown
  }
  if (typeof raw.access !== 'string' || !raw.access) return undefined
  if (typeof raw.refresh !== 'string' || !raw.refresh) return undefined
  if (typeof raw.expires !== 'number') return undefined
  return {
    accessToken: raw.access,
    refreshToken: raw.refresh,
    accessTokenExpiresAt: raw.expires,
    ...(typeof raw.clientId === 'string' ? { clientId: raw.clientId } : {}),
    ...(accountId ? { accountId } : {})
  }
}

export async function usableOAuthAccessToken(
  store: ModelConnectionStore,
  connectionId: string,
  providerPresetId: OAuthProviderPresetId,
  tokens: OAuthTokenSet,
  connectionRevision?: number
): Promise<
  | { ok: true; accessToken: string; accountId?: string }
  | { ok: false; reason: 'denied' | 'unreachable' | 'invalid_response' | 'changed' }
> {
  const providerFactory = OAUTH_PROVIDERS[providerPresetId]
  if (!providerFactory) return { ok: false, reason: 'changed' }
  const credentials: CredentialStore = {
    read: async () => toCredential(tokens),
    list: async () => [{ providerId: providerPresetId, type: 'oauth' as const }],
    modify: async (_id, fn) => {
      const next = await store.mutateOAuth(
        connectionId,
        async (current) => {
          if (!current || current.denied) return undefined
          const refreshed = await fn(toCredential(current))
          return refreshed ? (toTokenSet(refreshed, current.accountId) ?? current) : current
        },
        connectionRevision
      )
      return next ? toCredential(next) : undefined
    },
    delete: async () => {}
  }
  const models = createModels({ credentials })
  models.setProvider(providerFactory())
  try {
    const auth = await models.getAuth(providerPresetId)
    // Providers hand back either an apiKey (OpenAI) or an Authorization header (Kimi).
    const headerAuth =
      auth?.auth.headers?.['Authorization'] ?? auth?.auth.headers?.['authorization']
    const bearer =
      typeof headerAuth === 'string' && headerAuth.startsWith('Bearer ')
        ? headerAuth.slice('Bearer '.length)
        : undefined
    const apiKey = typeof auth?.auth.apiKey === 'string' ? auth.auth.apiKey : bearer
    if (!apiKey) return { ok: false, reason: 'unreachable' }
    return {
      ok: true,
      accessToken: apiKey,
      ...(tokens.accountId ? { accountId: tokens.accountId } : {})
    }
  } catch (error) {
    // pi-ai wraps provider rejections in ModelsError; the real reason rides in cause.
    const chain: unknown[] = [error]
    const seen = new Set<unknown>()
    let message = ''
    while (chain.length) {
      const current = chain.pop()
      if (seen.has(current)) continue
      seen.add(current)
      if (current instanceof Error) {
        message += ` ${current.message}`
        if (current.cause) chain.push(current.cause)
      }
    }
    if (/invalid_grant|denied|unauthorized/i.test(message)) {
      // Mark denied only when the vault still holds the grant that failed; a
      // replacement login queued during the exchange must not be denied by it.
      await store
        .mutateOAuth(
          connectionId,
          async (current) =>
            current &&
            current.refreshToken === tokens.refreshToken &&
            current.clientId === tokens.clientId
              ? { ...current, denied: true }
              : undefined,
          connectionRevision
        )
        .catch(() => undefined)
      return { ok: false, reason: 'denied' }
    }
    return { ok: false, reason: 'unreachable' }
  }
}
