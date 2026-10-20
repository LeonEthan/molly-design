import assert from 'node:assert/strict'
import test from 'node:test'
import { checkModelConnection } from './connection-check.ts'

void test('checkModelConnection: anthropic-messages uses /v1/models, x-api-key, and anthropic-version', async () => {
  const seen = []
  const store = {
    credentialForCheck: async () => null,
    oauthForCheck: async () => null
  }
  await checkModelConnection(
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
  assert.equal(seen[0].url, 'https://api.deepseek.com/anthropic/v1/models?limit=1000')
  assert.equal(seen[0].headers['x-api-key'], 'sk-synthetic')
  assert.equal(seen[0].headers['anthropic-version'], '2023-06-01')
  assert.equal(seen[0].headers.authorization, undefined)
})

for (const compatibleApi of ['openai-responses', 'google-generative-ai']) {
  const google = compatibleApi === 'google-generative-ai'
  const input = {
    providerPresetId: 'openai-compatible',
    compatibleApi,
    baseUrl: google
      ? 'https://gateway.invalid/v1beta/v1beta/models/'
      : 'https://gateway.invalid/v1/v1/responses/',
    modelId: 'synthetic-model',
    apiKey: 'SYNTHETIC_SECRET'
  }
  const reply = google
    ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'OK' }] } }] }
    : {
        status: 'completed',
        output: [
          { type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'OK' }] }
        ]
      }
  void test(`${compatibleApi} checks the selected model with a normalized POST and requires a response`, async () => {
    let request
    const result = await checkModelConnection({}, input, async (url, init) => {
      request = { url, ...init, body: JSON.parse(init.body) }
      return Response.json(reply)
    })
    assert.deepEqual(result, { ok: true })
    assert.equal(request.method, 'POST')
    assert.equal(
      request.url,
      google
        ? 'https://gateway.invalid/v1beta/models/synthetic-model:generateContent'
        : 'https://gateway.invalid/v1/responses'
    )
    assert.equal(
      request.headers[google ? 'x-goog-api-key' : 'authorization'],
      google ? input.apiKey : `Bearer ${input.apiKey}`
    )
    assert.equal(request.redirect, 'error')
    assert.equal(
      google ? request.body.generationConfig.maxOutputTokens : request.body.max_output_tokens,
      512
    )
    if (!google) assert.equal(request.body.model, input.modelId)
    assert.deepEqual(
      await checkModelConnection({}, input, async () =>
        Response.json({ data: [{ id: input.modelId }] })
      ),
      { ok: false, reason: 'invalid_response' }
    )
    assert.deepEqual(
      await checkModelConnection({}, { ...input, modelId: undefined }, async () => {
        throw new Error('must not send')
      }),
      { ok: false, reason: 'invalid_response' }
    )
  })
  void test(`${compatibleApi} rejects thought-only, failed and unsettled model replies`, async () => {
    const rejected = google
      ? [
          {
            candidates: [
              {
                finishReason: 'STOP',
                content: { parts: [{ thought: true, text: 'Private thinking' }] }
              }
            ]
          },
          {
            candidates: [
              {
                finishReason: 'MAX_TOKENS',
                content: { parts: [{ thought: true, text: 'Private thinking' }] }
              }
            ]
          },
          {
            candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'Partial' }] } }]
          },
          { candidates: [{ content: { parts: [{ text: 'No settlement' }] } }] }
        ]
      : [
          { ...reply, status: 'incomplete', incomplete_details: { reason: 'content_filter' } },
          { ...reply, status: 'incomplete' },
          {
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: [
              {
                type: 'reasoning',
                status: 'completed',
                content: [{ type: 'output_text', text: 'Private thinking' }]
              }
            ]
          },
          {
            ...reply,
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            output: []
          },
          {
            ...reply,
            status: 'incomplete',
            incomplete_details: { reason: 'max_output_tokens' },
            error: { message: 'SYNTHETIC_SECRET' }
          },
          { ...reply, status: 'in_progress' },
          { ...reply, status: 'failed', error: { message: 'SYNTHETIC_SECRET' } },
          {
            status: 'completed',
            output: [
              {
                type: 'message',
                status: 'in_progress',
                content: [{ type: 'output_text', text: 'Partial' }]
              }
            ]
          },
          {
            status: 'completed',
            output: [
              {
                type: 'reasoning',
                status: 'completed',
                content: [{ type: 'output_text', text: 'Private thinking' }]
              }
            ]
          }
        ]
    for (const body of rejected)
      assert.deepEqual(await checkModelConnection({}, input, async () => Response.json(body)), {
        ok: false,
        reason: 'invalid_response'
      })
    if (google)
      assert.deepEqual(
        await checkModelConnection({}, input, async () =>
          Response.json({
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [{ thought: true, text: 'Private thinking' }, { text: 'Visible reply' }]
                }
              }
            ]
          })
        ),
        { ok: true }
      )
  })
  void test(`${compatibleApi} accepts visible text when the probe exhausts its token budget`, async () => {
    const limited = google
      ? {
          candidates: [
            {
              finishReason: 'MAX_TOKENS',
              content: {
                parts: [{ thought: true, text: 'Private thinking' }, { text: 'Visible answer' }]
              }
            }
          ]
        }
      : {
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [
            {
              type: 'message',
              status: 'incomplete',
              content: [{ type: 'output_text', text: 'Visible answer' }]
            }
          ]
        }
    assert.deepEqual(await checkModelConnection({}, input, async () => Response.json(limited)), {
      ok: true
    })
    if (!google) {
      limited.output[0].status = 'completed'
      assert.deepEqual(await checkModelConnection({}, input, async () => Response.json(limited)), {
        ok: true
      })
      limited.output[0].status = 'in_progress'
      assert.deepEqual(await checkModelConnection({}, input, async () => Response.json(limited)), {
        ok: false,
        reason: 'invalid_response'
      })
    }
    const empty = google
      ? { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '  ' }] } }] }
      : {
          ...limited,
          output: [
            {
              type: 'message',
              status: 'incomplete',
              content: [{ type: 'output_text', text: '  ' }]
            }
          ]
        }
    assert.deepEqual(await checkModelConnection({}, input, async () => Response.json(empty)), {
      ok: false,
      reason: 'invalid_response'
    })
  })
  for (const [status, reason] of [
    [401, 'key_rejected'],
    [403, 'key_rejected'],
    [404, 'unsupported'],
    [429, 'rate_limited'],
    [500, 'http_error']
  ]) {
    void test(`${compatibleApi} sanitizes ${status} errors`, async () => {
      assert.deepEqual(
        await checkModelConnection(
          {},
          input,
          async () => new Response('SYNTHETIC_SECRET provider stack', { status })
        ),
        { ok: false, reason, status }
      )
    })
  }
  void test(`${compatibleApi} sanitizes fetch and timeout failures`, async () => {
    assert.deepEqual(
      await checkModelConnection({}, input, async () => {
        throw new Error('SYNTHETIC_SECRET network stack')
      }),
      { ok: false, reason: 'unreachable' }
    )
  })
  void test(`${compatibleApi} reports a body-stream network failure without diagnostics`, async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new DOMException('SYNTHETIC_SECRET', 'TimeoutError'))
      }
    })
    assert.deepEqual(await checkModelConnection({}, input, async () => new Response(body)), {
      ok: false,
      reason: 'unreachable'
    })
  })
  void test(`${compatibleApi} uses the exact stored credential binding`, async () => {
    const saved = {
      connection: { providerPresetId: input.providerPresetId, baseUrl: input.baseUrl },
      apiKey: input.apiKey
    }
    const store = { oauthForCheck: async () => null, credentialForCheck: async () => saved }
    assert.deepEqual(
      await checkModelConnection(
        store,
        { ...input, apiKey: undefined, stored: { id: 'saved', revision: 2 } },
        async () => Response.json(reply)
      ),
      { ok: true }
    )
    assert.deepEqual(
      await checkModelConnection(
        store,
        {
          ...input,
          apiKey: undefined,
          baseUrl: 'https://other.invalid/v1',
          stored: { id: 'saved', revision: 2 }
        },
        async () => {
          throw new Error('must not send')
        }
      ),
      { ok: false, reason: 'needs_key' }
    )
  })
}
