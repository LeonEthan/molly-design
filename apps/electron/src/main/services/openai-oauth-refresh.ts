import { createModels } from '@earendil-works/pi-ai'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import type { ModelConnectionStore, OAuthTokenSet } from './model-connection-store.ts'

/**
 * Returns an access token valid for the next run. The pi-ai provider owns the refresh:
 * its CredentialStore adapter serializes the exchange inside the vault lock, so a
 * concurrent login cannot drop the rotated refresh token. A refresh rejection marks the
 * row denied so the settings UI can prompt sign-in instead of hammering the endpoint.
 */
export async function usableOAuthAccessToken(
  store: ModelConnectionStore,
  tokens: OAuthTokenSet
): Promise<
  | { ok: true; accessToken: string; accountId?: string }
  | { ok: false; reason: 'denied' | 'unreachable' | 'invalid_response' | 'changed' }
> {
  const models = createModels({
    credentials: {
      read: async () => ({
        type: 'oauth',
        access: tokens.accessToken,
        refresh: tokens.refreshToken,
        expires: tokens.accessTokenExpiresAt,
        ...(tokens.clientId ? { clientId: tokens.clientId } : {})
      }),
      list: async () => [{ providerId: 'openai', type: 'oauth' as const }],
      modify: (_id, fn): Promise<import('@earendil-works/pi-ai').Credential | undefined> =>
        store
          .mutateOAuth(async (current) => {
            const next = await fn(
              current
                ? ({
                    type: 'oauth',
                    access: current.accessToken,
                    refresh: current.refreshToken,
                    expires: current.accessTokenExpiresAt,
                    ...(current.clientId ? { clientId: current.clientId } : {})
                  } as import('@earendil-works/pi-ai').Credential)
                : undefined
            )
            if (!next) return undefined
            const raw = next as {
              access?: string
              refresh?: string
              expires?: number
              clientId?: string
            }
            if (!raw.access || !raw.refresh || typeof raw.expires !== 'number') return undefined
            return {
              accessToken: raw.access,
              refreshToken: raw.refresh,
              accessTokenExpiresAt: raw.expires,
              ...(raw.clientId ? { clientId: raw.clientId } : {}),
              ...(tokens.accountId ? { accountId: tokens.accountId } : {})
            }
          })
          .then(() => undefined),
      delete: async () => {}
    }
  })
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
      await store
        .mutateOAuth(async (current) => (current ? { ...current, denied: true } : undefined))
        .catch(() => undefined)
      return { ok: false, reason: 'denied' }
    }
    return { ok: false, reason: 'unreachable' }
  }
}
