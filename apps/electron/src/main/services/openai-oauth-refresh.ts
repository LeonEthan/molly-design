import { refreshOAuthTokens } from './openai-oauth.ts'
import type { ModelConnectionStore, OAuthTokenSet } from './model-connection-store.ts'

const REFRESH_SKEW_MS = 5 * 60_000

export function oauthNeedsRefresh(tokens: OAuthTokenSet, now = Date.now()): boolean {
  return tokens.accessTokenExpiresAt - now <= REFRESH_SKEW_MS
}

/**
 * Returns an access token valid for at least the next run: the stored one when fresh,
 * otherwise a refreshed and rotated set. `denied` means the refresh token is dead and the
 * user must sign in again; `unreachable` means a transient network problem. Neither falls
 * back to anything.
 */
export async function usableOAuthAccessToken(
  store: ModelConnectionStore,
  connection: { id: string; revision: number },
  tokens: OAuthTokenSet,
  fetchFn: typeof fetch = fetch
): Promise<
  | { ok: true; accessToken: string; accountId?: string; grantId?: string }
  | { ok: false; reason: 'denied' | 'unreachable' | 'invalid_response' | 'changed' }
> {
  if (!oauthNeedsRefresh(tokens))
    return {
      ok: true,
      accessToken: tokens.accessToken,
      ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
      ...(tokens.grantId ? { grantId: tokens.grantId } : {})
    }
  const refreshed = await refreshOAuthTokens(fetchFn, tokens)
  if (!refreshed.ok) {
    if (refreshed.reason === 'denied') {
      // Persist the denial so the row can prompt sign-in instead of hammering refresh.
      await store
        .rotateOAuthTokens(connection.id, { ...tokens, denied: true })
        .catch(() => undefined)
    }
    return { ok: false, reason: refreshed.reason }
  }
  let rotated: OAuthTokenSet
  // Refresh rotates the refresh token the moment OpenAI answers; if the connection was
  // edited meanwhile, persist onto the current row so the renewed token is not dropped
  // while its predecessor is already burned.
  try {
    rotated = await store.rotateOAuthTokens(connection.id, refreshed.tokens)
  } catch {
    return { ok: false, reason: 'changed' }
  }
  return {
    ok: true,
    accessToken: rotated.accessToken,
    ...(rotated.accountId ? { accountId: rotated.accountId } : {}),
    ...(rotated.grantId ? { grantId: rotated.grantId } : {})
  }
}
