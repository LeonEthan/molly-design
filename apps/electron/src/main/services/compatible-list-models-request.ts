import {
  normalizeCompatibleConnectionApi,
  normalizeCompatibleConnectionBaseUrl,
  type CompatibleConnectionApi
} from '@molly/shared/embedded-harness'

export const ANTHROPIC_API_VERSION = '2023-06-01'

export type CompatibleListModelsRequest = { url: string; headers: Record<string, string> }

/** Shared GET /models wiring for compatible gateways (check + discovery). */
export function buildCompatibleListModelsRequest(
  baseUrl: string,
  compatibleApi: CompatibleConnectionApi | undefined,
  apiKey?: string,
  options?: { listLimit?: number }
): CompatibleListModelsRequest {
  const api = normalizeCompatibleConnectionApi(compatibleApi)
  const base = normalizeCompatibleConnectionBaseUrl(baseUrl, api)
  const headers: Record<string, string> = { accept: 'application/json' }
  if (api === 'anthropic-messages') {
    const limit = options?.listLimit
    const url = limit !== undefined ? `${base}/v1/models?limit=${limit}` : `${base}/v1/models`
    headers['anthropic-version'] = ANTHROPIC_API_VERSION
    if (apiKey) headers['x-api-key'] = apiKey
    return { url, headers }
  }
  const url = `${base}/models`
  if (api === 'google-generative-ai') {
    if (apiKey) headers['x-goog-api-key'] = apiKey
    return { url, headers }
  }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  return { url, headers }
}

export function compatibleListModelsParseStyle(
  compatibleApi: CompatibleConnectionApi | undefined
): 'anthropic' | 'openai' | 'google' {
  const api = normalizeCompatibleConnectionApi(compatibleApi)
  return api === 'anthropic-messages'
    ? 'anthropic'
    : api === 'google-generative-ai'
      ? 'google'
      : 'openai'
}
