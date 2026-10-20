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
