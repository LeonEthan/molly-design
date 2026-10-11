import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDiscoveredModels, discoverModelConnection } from './model-discovery.ts'

void test('parses the OpenAI-standard wrapper and keeps typed fields', () => {
  const parsed = parseDiscoveredModels({
    object: 'list',
    data: [
      {
        id: 'deepseek-chat',
        object: 'model',
        owned_by: 'deepseek',
        context_window: 65536,
        max_output_tokens: 8192
      },
      { id: 'deepseek-reasoner', object: 'model', owned_by: 'deepseek', context_window: 65536 }
    ]
  })
  assert.ok(parsed)
  assert.equal(parsed.models.length, 2)
  assert.deepEqual(parsed.models[0], {
    modelId: 'deepseek-chat',
    contextWindow: 65536,
    maxTokens: 8192
  })
  assert.equal(parsed.filteredNonChat, 0)
})

void test('parses the OpenRouter shape (no object marker) and the Together bare array', () => {
  const openRouter = parseDiscoveredModels({
    data: [
      {
        id: 'anthropic/claude-opus-4.5',
        name: 'Claude Opus 4.5',
        context_length: 200000,
        top_provider: { max_completion_tokens: 64000 }
      }
    ]
  })
  assert.ok(openRouter)
  assert.deepEqual(openRouter.models[0], {
    modelId: 'anthropic/claude-opus-4.5',
    name: 'Claude Opus 4.5',
    contextWindow: 200000,
    maxTokens: 64000
  })

  const together = parseDiscoveredModels([
    { id: 'meta-llama/Llama-4-Scout', display_name: 'Llama 4 Scout', context_length: 327680 }
  ])
  assert.ok(together)
  assert.equal(together.models[0].name, 'Llama 4 Scout')
  assert.equal(together.models[0].contextWindow, 327680)
})

void test('tolerates new-api extra keys and honors supported_endpoint_types', () => {
  const parsed = parseDiscoveredModels({
    success: true,
    data: [
      { id: 'gpt-5-chat', supported_endpoint_types: ['chat.completions'] },
      { id: 'text-embedding-3-large', supported_endpoint_types: ['embeddings'] }
    ]
  })
  assert.ok(parsed)
  assert.deepEqual(
    parsed.models.map((m) => m.modelId),
    ['gpt-5-chat']
  )
  assert.equal(parsed.filteredNonChat, 1)
})

void test('filters non-chat models by id keyword when no type field exists', () => {
  const parsed = parseDiscoveredModels({
    data: [
      { id: 'llama-3.3-70b-versatile' },
      { id: 'whisper-large-v3' },
      { id: 'tts-1-hd' },
      { id: 'dall-e-3' },
      { id: 'text-embedding-004' },
      { id: 'meta-llama/llama-guard-4-12b' }
    ]
  })
  assert.ok(parsed)
  assert.deepEqual(
    parsed.models.map((m) => m.modelId),
    ['llama-3.3-70b-versatile']
  )
  assert.equal(parsed.filteredNonChat, 5)
})

void test('dedupes ids and rejects invalid payloads', () => {
  const dupes = parseDiscoveredModels({ data: [{ id: 'a' }, { id: 'a' }, { id: 'b' }] })
  assert.ok(dupes)
  assert.deepEqual(
    dupes.models.map((m) => m.modelId),
    ['a', 'b']
  )
  assert.equal(parseDiscoveredModels({ models: [] }), null)
  assert.equal(parseDiscoveredModels('nope'), null)
  assert.equal(parseDiscoveredModels({ data: 'nope' }), null)
})

void test('drops bogus placeholder limits but keeps real ones', () => {
  const parsed = parseDiscoveredModels({
    data: [
      { id: 'ok', context_length: 128000 },
      { id: 'bogus', context_length: -1, max_completion_tokens: 0 },
      { id: 'huge', context_window: 99_999_999 }
    ]
  })
  assert.ok(parsed)
  assert.equal(parsed.models[0].contextWindow, 128000)
  assert.equal(parsed.models[1].contextWindow, undefined)
  assert.equal(parsed.models[2].contextWindow, undefined)
})

void test('discoverModelConnection: local servers without a key list models', async () => {
  const store = { credentialForCheck: async () => null }
  const result = await discoverModelConnection(
    store,
    { providerPresetId: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1' },
    async () => new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), { status: 200 })
  )
  assert.ok(result.ok)
  assert.equal(result.models[0].modelId, 'local-model')
})

void test('discoverModelConnection: typed key goes only to the typed destination', async () => {
  const seen = []
  const store = { credentialForCheck: async () => null }
  await discoverModelConnection(
    store,
    {
      providerPresetId: 'openai-compatible',
      baseUrl: 'https://gateway.invalid/v1/',
      apiKey: 'sk-synthetic'
    },
    async (url, init) => {
      seen.push({ url, headers: init.headers })
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }
  )
  assert.equal(seen[0].url, 'https://gateway.invalid/v1/models')
  assert.equal(seen[0].headers.authorization, 'Bearer sk-synthetic')
})

void test('discoverModelConnection: stored key only against its own connection and endpoint', async () => {
  const store = {
    credentialForCheck: async (id, revision) =>
      id === 'c1' && revision === 3
        ? {
            apiKey: 'sk-stored',
            connection: { providerPresetId: 'openai-compatible', baseUrl: 'https://own.invalid/v1' }
          }
        : null
  }
  const moved = await discoverModelConnection(
    store,
    {
      providerPresetId: 'openai-compatible',
      baseUrl: 'https://elsewhere.invalid/v1',
      stored: { id: 'c1', revision: 3 }
    },
    async () => {
      throw new Error('must not send')
    }
  )
  assert.deepEqual(moved, { ok: false, reason: 'needs_key' })

  const stale = await discoverModelConnection(
    store,
    {
      providerPresetId: 'openai-compatible',
      baseUrl: 'https://own.invalid/v1',
      stored: { id: 'c1', revision: 4 }
    },
    async () => {
      throw new Error('must not send')
    }
  )
  assert.deepEqual(stale, { ok: false, reason: 'changed' })
})

void test('discoverModelConnection: maps 404 to unsupported, other statuses to http_error', async () => {
  const store = { credentialForCheck: async () => null }
  const unsupported = await discoverModelConnection(
    store,
    { providerPresetId: 'openai-compatible', baseUrl: 'https://z.invalid/api' },
    async () => new Response('not found', { status: 404 })
  )
  assert.deepEqual(unsupported, { ok: false, reason: 'unsupported', status: 404 })
  const denied = await discoverModelConnection(
    store,
    { providerPresetId: 'openai-compatible', baseUrl: 'https://z.invalid/api' },
    async () => new Response('nope', { status: 401 })
  )
  assert.deepEqual(denied, { ok: false, reason: 'http_error', status: 401 })
})
