import { createModels, type Credential, type CredentialStore } from '@earendil-works/pi-ai'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import type { ModelConnectionStore, OAuthTokenSet } from './model-connection-store.ts'

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

/**
 * Returns an access token valid for the next run. The pi-ai provider owns the refresh:
 * its CredentialStore adapter serializes the exchange inside the vault lock scoped to
 * this connection, so a concurrent login cannot drop a rotated refresh token and a
 * failed refresh can only mark this same row denied when its tokens are still in place.
 */
export async function usableOAuthAccessToken(
  store: ModelConnectionStore,
  connectionId: string,
  tokens: OAuthTokenSet
): Promise<
  | { ok: true; accessToken: string; accountId?: string }
  | { ok: false; reason: 'denied' | 'unreachable' | 'invalid_response' | 'changed' }
> {
  const credentials: CredentialStore = {
    read: async () => toCredential(tokens),
    list: async () => [{ providerId: 'openai', type: 'oauth' as const }],
    modify: async (_id, fn) => {
      const next = await store.mutateOAuth(connectionId, async (current) => {
        // The row may have been reconnected while the exchange was in flight; only
        // persist onto the token set this exchange was made from.
        if (!current || current.refreshToken !== tokens.refreshToken) return undefined
        const refreshed = await fn(toCredential(current))
        return refreshed ? toTokenSet(refreshed, current.accountId) : undefined
      })
      return next ? toCredential(next) : undefined
    },
    delete: async () => {}
  }
  const models = createModels({ credentials })
  models.setProvider(openaiProvider())
  try {
    const auth = await models.getAuth('openai')
    const apiKey = typeof auth?.auth.apiKey === 'string' ? auth.auth.apiKey : undefined
    if (!apiKey) return { ok: false, reason: 'unreachable' }
    return {
      ok: true,
      accessToken: apiKey,
      ...(tokens.accountId ? { accountId: tokens.accountId } : {})
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/invalid_grant|denied|unauthorized/i.test(message)) {
      // Mark denied only when the vault still holds the grant that failed; a
      // replacement login queued during the exchange must not be denied by it.
      await store
        .mutateOAuth(connectionId, async (current) =>
          current && current.refreshToken === tokens.refreshToken
            ? { ...current, denied: true }
            : undefined
        )
        .catch(() => undefined)
      return { ok: false, reason: 'denied' }
    }
    return { ok: false, reason: 'unreachable' }
  }
}
