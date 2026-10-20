import {
  PROVIDER_PRESET_CHECKS,
  normalizeCompatibleConnectionBaseUrl,
  type CheckImageConnection,
  type CheckModelConnection,
  type ConnectionCheckResult
} from '@molly/shared/embedded-harness'
import {
  buildCompatibleListModelsRequest,
  compatibleListModelsParseStyle
} from './compatible-list-models-request.ts'
import type { ModelConnectionStore } from './model-connection-store'

type CheckStyle = (typeof PROVIDER_PRESET_CHECKS)[keyof typeof PROVIDER_PRESET_CHECKS]

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_LISTED_MODELS = 2_000

type CheckRequest = { url: string; headers: Record<string, string> }

const CHECK_REQUESTS: Record<CheckStyle, (base: string, apiKey: string) => CheckRequest> = {
  anthropic: (base, apiKey) => ({
    url: `${base}/v1/models?limit=1000`,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  }),
  google: (base, apiKey) => ({
    url: `${base}/models?pageSize=1000`,
    headers: { 'x-goog-api-key': apiKey }
  }),
  openrouter: (base, apiKey) => ({
    url: `${base}/key`,
    headers: { authorization: `Bearer ${apiKey}` }
  }),
  openai: (base, apiKey) => ({
    url: `${base}/models`,
    headers: Object.fromEntries(apiKey ? [['authorization', `Bearer ${apiKey}`]] : [])
  })
}

/** The free request a check sends: a model listing, or OpenRouter's key endpoint. */
export function connectionCheckRequest(
  style: CheckStyle,
  baseUrl: string,
  apiKey: string
): CheckRequest {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return CHECK_REQUESTS[style](base, apiKey)
}

async function readBounded(response: Response): Promise<string | null> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function listedModels(style: CheckStyle, data: unknown): string[] | null {
  const entries = listEntries(style, data)
  if (!entries) return null
  const ids = entries
    .map((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return undefined
      const id =
        style === 'google' ? (entry as { name?: unknown }).name : (entry as { id?: unknown }).id
      return typeof id === 'string' ? id.replace(/^models\//, '') : undefined
    })
    .filter((id): id is string => id !== undefined && id.length > 0 && id.length <= 200)
  return [...new Set(ids)].slice(0, MAX_LISTED_MODELS)
}

/**
 * Locates the model entry array across the response shapes seen in the wild:
 * `{object:"list", data:[...]}` (OpenAI standard), `{data:[...]}` (OpenRouter, no
 * `object` marker), bare arrays (Together), and wrappers with extra keys
 * (new-api mixes in `success:true`). Returns null when no array of objects exists.
 */
function listEntries(style: CheckStyle, data: unknown): unknown[] | null {
  if (style === 'google') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const entries = (data as { models?: unknown }).models
    return Array.isArray(entries) ? entries : null
  }
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return null
  const entries = (data as { data?: unknown }).data
  return Array.isArray(entries) ? entries : null
}

/**
 * Settings-only and explicit: one free, unretried request with no redirects. Upstream
 * bodies and messages never leave main; failures carry a fixed reason and HTTP status.
 */
export async function runModelListHttpCheck(
  url: string,
  headers: Record<string, string>,
  style: CheckStyle,
  transport: typeof fetch = fetch
): Promise<ConnectionCheckResult> {
  let response: Response
  try {
    response = await transport(url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000)
    })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    const status = response.status
    if (status === 401 || status === 403) return { ok: false, reason: 'key_rejected', status }
    if (status === 404 || status === 405 || status === 501)
      return { ok: false, reason: 'unsupported', status }
    if (status === 429) return { ok: false, reason: 'rate_limited', status }
    return { ok: false, reason: 'http_error', status }
  }
  try {
    const text = await readBounded(response)
    if (text === null) return { ok: false, reason: 'invalid_response' }
    if (style === 'openrouter') return { ok: true }
    const models = listedModels(style, JSON.parse(text))
    return models ? { ok: true, models } : { ok: false, reason: 'invalid_response' }
  } catch {
    return { ok: false, reason: 'invalid_response' }
  }
}

export async function runConnectionCheck(
  style: CheckStyle,
  baseUrl: string,
  apiKey: string,
  transport: typeof fetch = fetch
): Promise<ConnectionCheckResult> {
  const { url, headers } = connectionCheckRequest(style, baseUrl, apiKey)
  return runModelListHttpCheck(url, { ...headers, accept: 'application/json' }, style, transport)
}

async function checkCompatibleModelResponse(
  input: CheckModelConnection,
  apiKey: string,
  transport: typeof fetch
): Promise<ConnectionCheckResult> {
  if (!input.modelId) return { ok: false, reason: 'invalid_response' }
  if (!apiKey) return { ok: false, reason: 'needs_key' }
  const base = normalizeCompatibleConnectionBaseUrl(input.baseUrl, input.compatibleApi)
  const google = input.compatibleApi === 'google-generative-ai'
  const url = google
    ? `${base}/models/${encodeURIComponent(input.modelId.replace(/^models\//, ''))}:generateContent`
    : `${base}/responses`
  const body = google
    ? {
        contents: [{ role: 'user', parts: [{ text: 'Reply OK.' }] }],
        generationConfig: { maxOutputTokens: 512 }
      }
    : { model: input.modelId, input: 'Reply OK.', max_output_tokens: 512, store: false }
  let response: Response
  try {
    response = await transport(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(google ? { 'x-goog-api-key': apiKey } : { authorization: `Bearer ${apiKey}` })
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000)
    })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    const status = response.status
    if (status === 401 || status === 403) return { ok: false, reason: 'key_rejected', status }
    if (status === 404 || status === 405 || status === 501)
      return { ok: false, reason: 'unsupported', status }
    if (status === 429) return { ok: false, reason: 'rate_limited', status }
    return { ok: false, reason: 'http_error', status }
  }
  let text: string | null
  try {
    text = await readBounded(response)
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  try {
    if (text === null) return { ok: false, reason: 'invalid_response' }
    const data = JSON.parse(text)
    const outputLimited =
      !google &&
      data.status === 'incomplete' &&
      data.incomplete_details?.reason === 'max_output_tokens'
    if (
      !google &&
      (data.error ||
        (data.status !== 'completed' && !outputLimited) ||
        (data.status === 'completed' && data.incomplete_details))
    )
      return { ok: false, reason: 'invalid_response' }
    const parts = google
      ? data.candidates
          ?.filter(
            (candidate: { finishReason?: unknown }) =>
              candidate.finishReason === 'STOP' || candidate.finishReason === 'MAX_TOKENS'
          )
          .flatMap(
            (candidate: { content?: { parts?: unknown[] } }) => candidate.content?.parts ?? []
          )
      : data.output
          ?.filter(
            (item: { type?: unknown; status?: unknown }) =>
              item.type === 'message' &&
              (item.status === 'completed' || (outputLimited && item.status === 'incomplete'))
          )
          .flatMap((item: { content?: unknown[] }) => item.content ?? [])
    const responded =
      Array.isArray(parts) &&
      parts.some(
        (part: unknown) =>
          part !== null &&
          typeof part === 'object' &&
          (google
            ? !('thought' in part && part.thought === true)
            : 'type' in part && part.type === 'output_text') &&
          'text' in part &&
          typeof part.text === 'string' &&
          part.text.trim().length > 0
      )
    return responded ? { ok: true } : { ok: false, reason: 'invalid_response' }
  } catch {
    return { ok: false, reason: 'invalid_response' }
  }
}

export async function checkModelConnection(
  store: ModelConnectionStore,
  input: CheckModelConnection,
  transport: typeof fetch = fetch
): Promise<ConnectionCheckResult> {
  let apiKey = input.apiKey
  if (!apiKey) {
    if (!input.stored) return { ok: false, reason: 'needs_key' }
    const oauth = await store.oauthForCheck(input.stored.id, input.stored.revision)
    if (oauth) {
      if (oauth.connection.baseUrl !== input.baseUrl) return { ok: false, reason: 'needs_key' }
      // OAuth access tokens authenticate against their provider's own endpoint.
      return checkOAuthConnection(oauth.connection.providerPresetId, oauth.oauth, transport)
    }
    const saved = await store.credentialForCheck(input.stored.id, input.stored.revision)
    if (!saved) return { ok: false, reason: 'changed' }
    if (
      saved.connection.providerPresetId !== input.providerPresetId ||
      saved.connection.baseUrl !== input.baseUrl
    )
      return { ok: false, reason: 'needs_key' }
    apiKey = saved.apiKey
  }
  if (input.providerPresetId === 'openai-compatible') {
    if (
      input.compatibleApi === 'openai-responses' ||
      input.compatibleApi === 'google-generative-ai'
    )
      return checkCompatibleModelResponse(input, apiKey, transport)
    const { url, headers } = buildCompatibleListModelsRequest(
      input.baseUrl,
      input.compatibleApi,
      apiKey,
      { listLimit: 1000 }
    )
    return runModelListHttpCheck(
      url,
      headers,
      compatibleListModelsParseStyle(input.compatibleApi),
      transport
    )
  }
  return runConnectionCheck(
    PROVIDER_PRESET_CHECKS[input.providerPresetId],
    input.baseUrl,
    apiKey,
    transport
  )
}

const OAUTH_CHECK_URLS: Partial<Record<string, string>> = {
  openai: 'https://api.openai.com/v1/models',
  // Kimi's coding endpoint answers a models list for subscription tokens.
  'kimi-coding': 'https://api.kimi.com/coding/v1/models'
}

async function checkOAuthConnection(
  providerPresetId: string,
  tokens: { accessToken: string; accountId?: string },
  transport: typeof fetch
): Promise<ConnectionCheckResult> {
  const url = OAUTH_CHECK_URLS[providerPresetId] ?? OAUTH_CHECK_URLS.openai!
  let response: Response
  try {
    response = await transport(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${tokens.accessToken}`
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000)
    })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    const status = response.status
    if (status === 401 || status === 403) return { ok: false, reason: 'key_rejected', status }
    if (status === 404 || status === 405 || status === 501)
      return { ok: false, reason: 'unsupported', status }
    if (status === 429) return { ok: false, reason: 'rate_limited', status }
    return { ok: false, reason: 'http_error', status }
  }
  try {
    const text = await readBounded(response)
    if (text === null) return { ok: false, reason: 'invalid_response' }
    const data = JSON.parse(text)
    const entries: unknown[] | null = listEntries('openai', data)
    if (!entries) return { ok: true }
    const models = entries
      .map((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return undefined
        const record = entry as { id?: unknown; slug?: unknown }
        const id = typeof record.id === 'string' ? record.id : record.slug
        return typeof id === 'string' && id.length > 0 && id.length <= 200 ? id : undefined
      })
      .filter((id): id is string => id !== undefined)
    return { ok: true, models: [...new Set(models)].slice(0, MAX_LISTED_MODELS) }
  } catch {
    return { ok: false, reason: 'invalid_response' }
  }
}

export async function checkImageConnection(
  store: ModelConnectionStore,
  input: CheckImageConnection,
  transport: typeof fetch = fetch
): Promise<ConnectionCheckResult> {
  // #33: DashScope has no free discovery endpoint; every image request there is billed.
  if (input.protocol === 'dashscope') return { ok: false, reason: 'unsupported' }
  let apiKey = input.apiKey
  if (!apiKey) {
    const saved = await store.imageCredentialForCheck(input.expectedRevision)
    if (!saved) return { ok: false, reason: 'changed' }
    const savedProtocol = saved.connection.protocol ?? 'openai-images'
    const requestedProtocol = input.protocol ?? 'openai-images'
    if (
      saved.connection.baseUrl !== input.baseUrl ||
      savedProtocol !== requestedProtocol ||
      !saved.apiKey
    )
      return { ok: false, reason: 'needs_key' }
    apiKey = saved.apiKey
  }
  return runConnectionCheck('openai', input.baseUrl, apiKey, transport)
}
