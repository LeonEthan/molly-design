import { afterEach, expect, it, vi } from 'vitest';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { configureModelConnection } from '../src/model-connection';
import { createNativeModelRuntime } from '../src/native-model-overlay';
import { syntheticNativeModelOverlay } from './fixtures/native-model-overlay';
import { managed } from './fixtures/managed';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function sse(events: unknown[]) {
  return new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } }
  );
}

it('runs K3.1 Pro with native image, reasoning and tool history', async () => {
  const credentials = new InMemoryCredentialStore();
  const runtime = await createNativeModelRuntime(syntheticNativeModelOverlay(), credentials);
  const configured = configureModelConnection(
    runtime,
    {
      schemaVersion: 1,
      id: 'synthetic',
      revision: 1,
      providerPresetId: 'kimi-coding',
      displayName: 'Synthetic Kimi',
      credentialRef: 'protected',
      enabled: true,
      baseUrl: 'https://api.kimi.com/coding/v1',
    },
    { connectionId: 'synthetic', modelId: 'k3.1-pro', thinking: 'high' }
  );
  await runtime.setRuntimeApiKey(configured.providerId, 'SYNTHETIC_KIMI_KEY');
  const model = runtime.getModel(configured.providerId, 'k3.1-pro');
  if (!model) throw new Error('missing_native_target');
  expect(configured.baseUrl).toBe('https://api.kimi.com/coding/v1');
  expect(runtime.getRegisteredProviderConfig(configured.providerId)).toBeUndefined();

  const requests: {
    url: string;
    body: { messages: Record<string, unknown>[] };
    authorization: string | null;
  }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push({
      url,
      body,
      authorization: new Headers(init.headers).get('authorization'),
    });
    const hasToolResult = JSON.stringify(body).includes('synthetic tool result');
    return sse(
      hasToolResult
        ? [
            {
              id: 'synthetic-final',
              choices: [{ index: 0, delta: { content: 'Complete' }, finish_reason: 'stop' }],
            },
          ]
        : [
            {
              id: 'synthetic-tool',
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', reasoning_content: 'Considering' },
                  finish_reason: null,
                },
              ],
            },
            {
              id: 'synthetic-tool',
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_synthetic',
                        type: 'function',
                        function: { name: 'lookup', arguments: '{"value":"sample"}' },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            },
          ]
    );
  });

  const parameters = Type.Object({ value: Type.String() });
  const lookup: AgentTool<typeof parameters> = {
    name: 'lookup',
    label: 'Lookup',
    description: 'Synthetic lookup',
    parameters,
    execute: async (_id, args) => ({
      content: [{ type: 'text', text: `synthetic tool result: ${args.value}` }],
      details: {},
    }),
  };
  const agent = new Agent({
    initialState: {
      model,
      thinkingLevel: 'high',
      tools: [lookup],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect the synthetic image.' },
            { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
          ],
          timestamp: 1,
        },
      ],
    },
    streamFn: (selectedModel, context, options) =>
      runtime.streamSimple(selectedModel, context, options),
  });
  await agent.prompt('Use lookup and report the result.');

  expect(agent.state.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'stop' });
  expect(requests).toHaveLength(2);
  expect(requests.map((request) => request.url)).toEqual([
    'https://api.kimi.com/coding/v1/chat/completions',
    'https://api.kimi.com/coding/v1/chat/completions',
  ]);
  expect(requests.map((request) => request.authorization)).toEqual([
    'Bearer SYNTHETIC_KIMI_KEY',
    'Bearer SYNTHETIC_KIMI_KEY',
  ]);
  for (const request of requests)
    expect(request.body).toMatchObject({ model: 'k3.1-pro', reasoning_effort: 'high' });
  const [first, second] = requests;
  if (!first || !second) throw new Error('missing_captured_requests');
  expect(JSON.stringify(first.body)).toContain('image_url');
  expect(second.body.messages).toContainEqual(
    expect.objectContaining({
      role: 'assistant',
      reasoning_content: 'Considering',
      tool_calls: [
        expect.objectContaining({
          id: 'call_synthetic',
          function: { name: 'lookup', arguments: '{"value":"sample"}' },
        }),
      ],
    })
  );
});

it('executes the sealed selection through the managed ACP worker', async () => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return sse([
      {
        id: 'synthetic-managed',
        choices: [{ index: 0, delta: { content: 'Managed answer' }, finish_reason: 'stop' }],
      },
    ]);
  });
  const f = await managed({
    nativeTransport: true,
    nativeModelOverlay: syntheticNativeModelOverlay(),
    config: {
      connection: {
        schemaVersion: 1,
        id: 'connection',
        revision: 1,
        providerPresetId: 'kimi-coding',
        displayName: 'Synthetic Kimi',
        baseUrl: 'https://api.kimi.com/coding/v1',
        credentialRef: 'protected-reference',
        enabled: true,
      },
      selection: { connectionId: 'connection', modelId: 'k3.1-pro', thinking: 'high' },
    },
  });
  try {
    const session = await f.open();
    f.grant(session.snapshot);
    await session.prompt('Use the sealed model.');
    expect(f.runtime().getModel('kimi-coding', 'k3.1-pro')).toBeDefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'https://api.kimi.com/coding/v1/chat/completions',
      body: { model: 'k3.1-pro', reasoning_effort: 'high' },
    });
  } finally {
    await f.agent.dispose();
  }
});
