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
  } catch {}
}
