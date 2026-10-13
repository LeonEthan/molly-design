import {
  DiscoveredModelSchema,
  type DiscoveredModel,
  type DiscoverModelConnection,
  type DiscoverModelConnectionResult
} from '@molly/shared/embedded-harness'
import type { ModelConnectionStore } from './model-connection-store'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_DISCOVERED_MODELS = 2_000
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

function isChatModel(entry: Record<string, unknown>, id: string): boolean {
  const endpointTypes = entry.supported_endpoint_types
  if (Array.isArray(endpointTypes) && endpointTypes.every((type) => typeof type === 'string')) {
    return endpointTypes.some((type) => type === 'chat' || type === 'chat.completions')
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
    tokenLimit(entry.context_length) ??
    tokenLimit(entry.context_window) ??
    tokenLimit(entry.max_context_length) ??
    tokenLimit(entry.max_model_len)
  const topProvider = entry.top_provider
  const maxTokens =
    tokenLimit(entry.max_output_tokens) ??
    tokenLimit(entry.max_completion_tokens) ??
    (topProvider && typeof topProvider === 'object'
      ? tokenLimit((topProvider as Record<string, unknown>).max_completion_tokens)
      : undefined)
  return { contextWindow, maxTokens }
}

/** Locates the model array across `{object,data}`, `{data}` (OpenRouter) and bare arrays (Together). */
function listEntries(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return null
  const entries = (data as { data?: unknown }).data
  return Array.isArray(entries) ? entries : null
}

export function parseDiscoveredModels(data: unknown): {
  models: DiscoveredModel[]
  filteredNonChat: number
} | null {
  const entries = listEntries(data)
  if (!entries) return null
  const seen = new Set<string>()
  const models: DiscoveredModel[] = []
  let filteredNonChat = 0
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const id = (entry as { id?: unknown }).id
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_MODEL_ID) continue
    if (!isChatModel(entry as Record<string, unknown>, id)) {
      filteredNonChat += 1
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    const record = entry as Record<string, unknown>
    const displayName = record.display_name ?? record.name
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

/**
 * Explicit settings action: one unretired `GET {base}/models` request against the typed
 * or stored destination. Unlike the free key check, discovery tolerates missing auth for
 * local servers (Ollama/LM Studio ignore the header) and returns typed metadata, not a
 * verdict on the key. Upstream bodies never leave main.
 */
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
  const base = input.baseUrl.trim().replace(/\/+$/, '')
  let response: Response
  try {
    response = await transport(`${base}/models`, {
      headers: {
        accept: 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
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
    if (status === 404 || status === 405 || status === 501)
      return { ok: false, reason: 'unsupported', status }
    return { ok: false, reason: 'http_error', status }
  }
  try {
    const text = await readBounded(response)
    if (text === null) return { ok: false, reason: 'invalid_response' }
    const parsed = parseDiscoveredModels(JSON.parse(text))
    if (!parsed) return { ok: false, reason: 'invalid_response' }
    return { ok: true, models: parsed.models, filteredNonChat: parsed.filteredNonChat }
  } catch {
    return { ok: false, reason: 'invalid_response' }
  }
}
