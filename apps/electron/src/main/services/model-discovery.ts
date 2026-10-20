import {
  DiscoveredModelSchema,
  compatibleConnectionApiRequiresKey,
  type CompatibleConnectionApi,
  type DiscoveredModel,
  type DiscoverModelConnection,
  type DiscoverModelConnectionResult
} from '@molly/shared/embedded-harness'
import { buildCompatibleListModelsRequest } from './compatible-list-models-request.ts'
import type { ModelConnectionStore } from './model-connection-store'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_DISCOVERED_MODELS = 2_000
const MAX_DISCOVERY_PAGES = 100
const MAX_PAGE_TOKEN_LENGTH = 4096
const MAX_MODEL_ID = 200
const MAX_MODEL_NAME = 300
const MAX_TOKEN_LIMIT = 16_777_216

/**
 * Services mix embedding, audio and image models into `/models` without any type field
 * (one-api gateways, Groq). Molly only consumes chat (+ optional vision) models, so
 * discovery drops the rest by id keyword; gateways that do declare types
 * (new-api `supported_endpoint_types`) are honored first.
 */
const NON_CHAT_ID_PATTERN =
  /(?:^|[/:._-])(embed|embedding|tts|whisper|transcribe|speech|audio|realtime|sora|dall-e|babbage|davinci|moderation|rerank|guard)(?:[/:._-]|$)|(?:^|\/)(?:text-embedding|whisper|dall-e|tts)-/i

function isChatModel(
  entry: Record<string, unknown>,
  id: string,
  api?: CompatibleConnectionApi
): boolean {
  if (api === 'google-generative-ai' && Array.isArray(entry.supportedGenerationMethods))
    return entry.supportedGenerationMethods.includes('generateContent')
  const endpointTypes = entry.supported_endpoint_types
  if (Array.isArray(endpointTypes) && endpointTypes.every((type) => typeof type === 'string')) {
    return endpointTypes.some((type) =>
      api === 'openai-responses'
        ? type === 'responses'
        : type === 'chat' || type === 'chat.completions'
    )
  }
  return !NON_CHAT_ID_PATTERN.test(id)
}

function tokenLimit(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return undefined
  return value <= MAX_TOKEN_LIMIT ? value : undefined
}

/** Context/output limits ship under at least five different field names across providers. */
function entryLimits(entry: Record<string, unknown>) {
  const contextWindow =
    tokenLimit(entry.inputTokenLimit) ??
    tokenLimit(entry.context_length) ??
    tokenLimit(entry.context_window) ??
    tokenLimit(entry.max_context_length) ??
    tokenLimit(entry.max_model_len)
  const topProvider = entry.top_provider
  const maxTokens =
    tokenLimit(entry.outputTokenLimit) ??
    tokenLimit(entry.max_output_tokens) ??
    tokenLimit(entry.max_completion_tokens) ??
    (topProvider && typeof topProvider === 'object'
      ? tokenLimit((topProvider as Record<string, unknown>).max_completion_tokens)
      : undefined)
  return { contextWindow, maxTokens }
}

/** Locates the model array across `{object,data}`, `{data}` (OpenRouter) and bare arrays (Together). */
function listEntries(data: unknown, api?: CompatibleConnectionApi): unknown[] | null {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return null
  const entries =
    api === 'google-generative-ai'
      ? (data as { models?: unknown }).models
      : (data as { data?: unknown }).data
  return Array.isArray(entries) ? entries : null
}

export function parseDiscoveredModels(
  data: unknown,
  api?: CompatibleConnectionApi
): {
  models: DiscoveredModel[]
  filteredNonChat: number
} | null {
  const entries = listEntries(data, api)
  if (!entries) return null
  const seen = new Set<string>()
  const models: DiscoveredModel[] = []
  let filteredNonChat = 0
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const id =
      api === 'google-generative-ai' && typeof record.name === 'string'
        ? record.name.replace(/^models\//, '')
        : record.id
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_MODEL_ID) continue
    if (!isChatModel(record, id, api)) {
      filteredNonChat += 1
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    const displayName = record.displayName ?? record.display_name ?? record.name
    const { contextWindow, maxTokens } = entryLimits(record)
    const parsed = DiscoveredModelSchema.safeParse({
      modelId: id,
      ...(typeof displayName === 'string' &&
      displayName.trim().length > 0 &&
      displayName.length <= MAX_MODEL_NAME
        ? { name: displayName.trim() }
        : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {})
    })
    if (parsed.success) models.push(parsed.data)
    if (models.length >= MAX_DISCOVERED_MODELS) break
  }
  return { models, filteredNonChat }
}

async function readBounded(
  response: Response,
  maxBytes: number
): Promise<{ text: string; bytes: number } | null> {
  const reader = response.body?.getReader()
  if (!reader) return { text: '', bytes: 0 }
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes: size }
}

export async function discoverModelConnection(
  store: ModelConnectionStore,
  input: DiscoverModelConnection,
  transport: typeof fetch = fetch
): Promise<DiscoverModelConnectionResult> {
  let apiKey = input.apiKey
  if (!apiKey && input.stored) {
    const saved = await store.credentialForCheck(input.stored.id, input.stored.revision)
    if (!saved) return { ok: false, reason: 'changed' }
    if (saved.connection.baseUrl !== input.baseUrl) return { ok: false, reason: 'needs_key' }
    apiKey = saved.apiKey
  }
  const compatibleApi =
    input.providerPresetId === 'openai-compatible' ? input.compatibleApi : undefined
  if (
    compatibleConnectionApiRequiresKey(compatibleApi) &&
    (apiKey === undefined || apiKey.length === 0)
  )
    return { ok: false, reason: 'needs_key' }
  const { url, headers } = buildCompatibleListModelsRequest(input.baseUrl, compatibleApi, apiKey)
  const paginated = compatibleApi === 'google-generative-ai'
  const signal = AbortSignal.timeout(15_000)
  const models = new Map<string, DiscoveredModel>()
  const tokens = new Set<string>()
  let filteredNonChat = 0
  let remainingBytes = MAX_RESPONSE_BYTES
  let nextUrl = url
  for (let page = 0; page < MAX_DISCOVERY_PAGES; page += 1) {
    let response: Response
    try {
      signal.throwIfAborted()
      response = await transport(nextUrl, { headers, redirect: 'error', signal })
    } catch {
      return { ok: false, reason: 'unreachable' }
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      const status = response.status
      if (status === 404 || status === 405 || status === 501)
        return { ok: false, reason: 'unsupported', status }
      return { ok: false, reason: 'http_error', status }
    }
    try {
      const body = await readBounded(response, remainingBytes)
      if (paginated) signal.throwIfAborted()
      if (body === null) return { ok: false, reason: 'invalid_response' }
      remainingBytes -= body.bytes
      const data = JSON.parse(body.text)
      const parsed = parseDiscoveredModels(data, compatibleApi)
      if (!parsed) return { ok: false, reason: 'invalid_response' }
      filteredNonChat += parsed.filteredNonChat
      for (const model of parsed.models) {
        if (!models.has(model.modelId)) models.set(model.modelId, model)
        if (models.size >= MAX_DISCOVERED_MODELS) break
      }
      const token = paginated ? data.nextPageToken : undefined
      if (token === undefined || token === '' || models.size >= MAX_DISCOVERED_MODELS)
        return { ok: true, models: [...models.values()], filteredNonChat }
      if (typeof token !== 'string' || token.length > MAX_PAGE_TOKEN_LENGTH || tokens.has(token))
        return { ok: false, reason: 'invalid_response' }
      tokens.add(token)
      const next = new URL(url)
      next.searchParams.set('pageToken', token)
      nextUrl = next.toString()
    } catch {
      return { ok: false, reason: paginated && signal.aborted ? 'unreachable' : 'invalid_response' }
    }
  }
  return { ok: false, reason: 'invalid_response' }
}
