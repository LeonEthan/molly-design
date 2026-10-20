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

void test('discoverModelConnection: anthropic messages uses /v1/models and x-api-key', async () => {
  const seen = []
  const store = { credentialForCheck: async () => null }
  await discoverModelConnection(
    store,
    {
      providerPresetId: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/anthropic',
      compatibleApi: 'anthropic-messages',
      apiKey: 'sk-synthetic'
    },
    async (url, init) => {
      seen.push({ url, headers: init.headers })
      return new Response(JSON.stringify({ data: [{ id: 'deepseek-chat' }] }), { status: 200 })
    }
  )
  assert.equal(seen[0].url, 'https://api.deepseek.com/anthropic/v1/models')
  assert.equal(seen[0].headers['x-api-key'], 'sk-synthetic')
  assert.equal(seen[0].headers['anthropic-version'], '2023-06-01')
  assert.equal(seen[0].headers.authorization, undefined)
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

void test('Gemini discovery reads native metadata and filters models without generateContent', async () => {
  const data = {
    models: [
      {
        name: 'models/gemini-synthetic',
        displayName: 'Synthetic Gemini',
        inputTokenLimit: 1048576,
        outputTokenLimit: 8192,
        supportedGenerationMethods: ['generateContent', 'countTokens']
      },
      { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-synthetic', supportedGenerationMethods: ['generateContent'] }
    ]
  }
  const parsed = parseDiscoveredModels(data, 'google-generative-ai')
  assert.deepEqual(parsed, {
    models: [
      {
        modelId: 'gemini-synthetic',
        name: 'Synthetic Gemini',
        contextWindow: 1048576,
        maxTokens: 8192
      }
    ],
    filteredNonChat: 1
  })
  let request
  const result = await discoverModelConnection(
    {},
    {
      providerPresetId: 'openai-compatible',
      compatibleApi: 'google-generative-ai',
      baseUrl: 'https://gateway.invalid/v1beta/v1beta/',
      apiKey: 'synthetic-key'
    },
    async (url, init) => {
      request = { url, ...init }
      return Response.json(data)
    }
  )
  assert.deepEqual(result, { ok: true, ...parsed })
  assert.equal(request.url, 'https://gateway.invalid/v1beta/models?pageSize=1000')
  assert.equal(request.headers['x-goog-api-key'], 'synthetic-key')
  assert.equal(request.headers.authorization, undefined)
})

void test('Responses discovery uses /models and protocol-specific endpoint declarations', async () => {
  const data = {
    data: [
      { id: 'responses-model', supported_endpoint_types: ['responses'] },
      { id: 'chat-only', supported_endpoint_types: ['chat.completions'] }
    ]
  }
  let destination
  const result = await discoverModelConnection(
    {},
    {
      providerPresetId: 'openai-compatible',
      compatibleApi: 'openai-responses',
      baseUrl: 'https://gateway.invalid/v1/responses/responses/',
      apiKey: 'synthetic-key'
    },
    async (url) => {
      destination = url
      return Response.json(data)
    }
  )
  assert.equal(destination, 'https://gateway.invalid/v1/models')
  assert.deepEqual(result, {
    ok: true,
    models: [{ modelId: 'responses-model' }],
    filteredNonChat: 1
  })
})

for (const compatibleApi of ['openai-responses', 'google-generative-ai']) {
  void test(`${compatibleApi} discovery refuses missing keys before transport`, async () => {
    const outbound = []
    const result = await discoverModelConnection(
      {},
      {
        providerPresetId: 'openai-compatible',
        compatibleApi,
        baseUrl: 'https://synthetic.invalid/v1'
      },
      async (url) => {
        outbound.push(url)
        return Response.json({ data: [] })
      }
    )
    assert.deepEqual(result, { ok: false, reason: 'needs_key' })
    assert.deepEqual(outbound, [])
  })
}

const geminiDiscovery = {
  providerPresetId: 'openai-compatible',
  compatibleApi: 'google-generative-ai',
  baseUrl: 'https://selected.invalid/gateway/v1beta/models/',
  apiKey: 'SYNTHETIC_KEY'
}

void test('Gemini discovery aggregates and dedupes pages on the selected destination with one abort signal', async () => {
  const token = 'https://unselected.invalid/collect?key=other&next=#fragment'
  const requests = []
  const result = await discoverModelConnection({}, geminiDiscovery, async (url, init) => {
    requests.push({ url, ...init })
    const page = new URL(url).searchParams.get('pageToken')
    return Response.json(
      page === null
        ? {
            models: [
              {
                name: 'models/first',
                displayName: 'First',
                supportedGenerationMethods: ['generateContent']
              },
              { name: 'models/embedding-first', supportedGenerationMethods: ['embedContent'] }
            ],
            nextPageToken: token
          }
        : {
            models: [
              { name: 'models/first', displayName: 'Duplicate' },
              { name: 'models/later', inputTokenLimit: 32768, outputTokenLimit: 2048 },
              { name: 'models/embedding-later', supportedGenerationMethods: ['embedContent'] }
            ]
          }
    )
  })
  assert.deepEqual(result, {
    ok: true,
    models: [
      { modelId: 'first', name: 'First' },
      { modelId: 'later', name: 'models/later', contextWindow: 32768, maxTokens: 2048 }
    ],
    filteredNonChat: 2
  })
  assert.deepEqual(
    requests.map(({ url }) => {
      const destination = new URL(url)
      return {
        origin: destination.origin,
        path: destination.pathname,
        size: destination.searchParams.get('pageSize'),
        token: destination.searchParams.get('pageToken')
      }
    }),
    [
      {
        origin: 'https://selected.invalid',
        path: '/gateway/v1beta/models',
        size: '1000',
        token: null
      },
      { origin: 'https://selected.invalid', path: '/gateway/v1beta/models', size: '1000', token }
    ]
  )
  for (const request of requests) {
    assert.equal(request.headers['x-goog-api-key'], geminiDiscovery.apiKey)
    assert.equal(request.headers.authorization, undefined)
    assert.equal(request.redirect, 'error')
    assert.equal(request.signal, requests[0].signal)
  }
})

for (const [name, response, expected] of [
  [
    'http failure',
    () => new Response('SYNTHETIC_SECRET', { status: 502 }),
    { ok: false, reason: 'http_error', status: 502 }
  ],
  [
    'unsupported page',
    () => new Response('SYNTHETIC_SECRET', { status: 404 }),
    { ok: false, reason: 'unsupported', status: 404 }
  ],
  [
    'invalid JSON',
    () => new Response('SYNTHETIC_SECRET'),
    { ok: false, reason: 'invalid_response' }
  ],
  [
    'invalid model list',
    () => Response.json({ models: {} }),
    { ok: false, reason: 'invalid_response' }
  ],
  [
    'transport failure',
    () => {
      throw new TypeError('fetch failed SYNTHETIC_SECRET')
    },
    { ok: false, reason: 'unreachable' }
  ]
]) {
  void test(`Gemini discovery fails without partial results after second-page ${name}`, async () => {
    const pages = []
    const result = await discoverModelConnection({}, geminiDiscovery, async (url) => {
      const page = new URL(url).searchParams.get('pageToken')
      pages.push(page)
      return page === null
        ? Response.json({ models: [{ name: 'models/first' }], nextPageToken: 'second' })
        : response()
    })
    assert.deepEqual(result, expected)
    assert.deepEqual(pages, [null, 'second'])
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC_SECRET'))
  })
}

void test('Gemini discovery rejects repeated and malformed continuation tokens', async () => {
  for (const token of ['same', 42, { url: 'https://unselected.invalid' }, 'x'.repeat(4097)]) {
    const pages = []
    const result = await discoverModelConnection({}, geminiDiscovery, async (url) => {
      pages.push(new URL(url).searchParams.get('pageToken'))
      return Response.json({ models: [], nextPageToken: token })
    })
    assert.deepEqual(result, { ok: false, reason: 'invalid_response' })
    assert.deepEqual(
      pages,
      typeof token === 'string' && token.length <= 4096 ? [null, token] : [null]
    )
  }
})

void test('Gemini discovery bounds the entire response budget across pages', async () => {
  const pages = []
  const result = await discoverModelConnection({}, geminiDiscovery, async (url) => {
    pages.push(new URL(url).searchParams.get('pageToken'))
    return Response.json({ models: [], padding: 'x'.repeat(1024 * 1024), nextPageToken: 'second' })
  })
  assert.deepEqual(result, { ok: false, reason: 'invalid_response' })
  assert.deepEqual(pages, [null, 'second'])
})

void test('Gemini discovery stops at the existing model limit across pages', async () => {
  const pages = []
  const result = await discoverModelConnection({}, geminiDiscovery, async (url) => {
    const token = new URL(url).searchParams.get('pageToken')
    pages.push(token)
    const start = token === null ? 0 : 1000
    return Response.json({
      models: Array.from({ length: 1000 }, (_, index) => ({ name: `models/m-${start + index}` })),
      nextPageToken: token === null ? 'second' : 'third'
    })
  })
  assert.equal(result.ok, true)
  assert.equal(result.models.length, 2000)
  assert.equal(result.models.at(-1).modelId, 'm-1999')
  assert.deepEqual(pages, [null, 'second'])
})

void test('Gemini discovery bounds pages even when every continuation token is unique', async () => {
  let page = 0
  const result = await discoverModelConnection({}, geminiDiscovery, async () => {
    page += 1
    assert.ok(page <= 100)
    return Response.json({ models: [], nextPageToken: `next-${page}` })
  })
  assert.deepEqual(result, { ok: false, reason: 'invalid_response' })
})

void test('Gemini discovery stops pagination when its shared abort signal expires', async (context) => {
  const controller = new AbortController()
  context.mock.method(AbortSignal, 'timeout', () => controller.signal)
  const pages = []
  const result = await discoverModelConnection({}, geminiDiscovery, async (url, init) => {
    pages.push(new URL(url).searchParams.get('pageToken'))
    assert.equal(init.signal, controller.signal)
    controller.abort(new DOMException('SYNTHETIC_SECRET', 'TimeoutError'))
    return Response.json({ models: [{ name: 'models/first' }], nextPageToken: 'second' })
  })
  assert.deepEqual(result, { ok: false, reason: 'unreachable' })
  assert.deepEqual(pages, [null])
})

for (const compatibleApi of ['anthropic-messages', 'openai-completions', 'openai-responses']) {
  void test(`${compatibleApi} discovery retains one GET and ignores continuation metadata`, async () => {
    const requests = []
    const result = await discoverModelConnection(
      {},
      { ...geminiDiscovery, compatibleApi, baseUrl: 'https://selected.invalid/gateway' },
      async (url) => {
        requests.push(url)
        return Response.json({ data: [{ id: 'first' }], nextPageToken: 'must-not-follow' })
      }
    )
    assert.deepEqual(result, { ok: true, models: [{ modelId: 'first' }], filteredNonChat: 0 })
    assert.deepEqual(requests, [
      compatibleApi === 'anthropic-messages'
        ? 'https://selected.invalid/gateway/v1/models'
        : 'https://selected.invalid/gateway/models'
    ])
  })

  void test(`${compatibleApi} retains its body-read failure mapping on timeout`, async (context) => {
    const controller = new AbortController()
    context.mock.method(AbortSignal, 'timeout', () => controller.signal)
    const result = await discoverModelConnection(
      {},
      { ...geminiDiscovery, compatibleApi, baseUrl: 'https://selected.invalid/gateway' },
      async () => {
        controller.abort(new DOMException('Synthetic timeout', 'TimeoutError'))
        return new Response(
          new ReadableStream({
            start(body) {
              body.error(controller.signal.reason)
            }
          })
        )
      }
    )
    assert.deepEqual(result, { ok: false, reason: 'invalid_response' })
  })
}
