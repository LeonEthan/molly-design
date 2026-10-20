import { afterEach, expect, it, vi } from 'vitest';
import { Agent, type AgentTool } from '@earendil-works/pi-agent-core';
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { CompatibleConnectionApi } from '@molly/shared/embedded-harness';
import { configureModelConnection } from '../src/model-connection';
import { modelErrorDiagnostic } from '../src/model-error';

const protocols = ['openai-responses', 'google-generative-ai'] as const;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function configured(
  api: CompatibleConnectionApi,
  reasoning = true,
  credentialKey: string | null = 'SYNTHETIC_KEY'
) {
  const credentials = new InMemoryCredentialStore();
  const runtime = await ModelRuntime.create({
    credentials,
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const connection = configureModelConnection(
    runtime,
    {
      schemaVersion: 1,
      id: 'synthetic',
      revision: 1,
      providerPresetId: 'openai-compatible',
      displayName: 'Synthetic',
      credentialRef: 'protected',
      enabled: true,
      compatibleApi: api,
      baseUrl:
        api === 'google-generative-ai'
          ? 'https://gateway.invalid/v1beta/v1beta/models/'
          : 'https://gateway.invalid/v1/v1/responses/',
      customModels: [
        {
          modelId: 'synthetic-model',
          name: 'Synthetic',
          input: ['text'],
          contextWindow: 8192,
          maxTokens: 1024,
          thinking: reasoning ? ['off', 'high'] : ['off'],
          toolCalls: true,
          maxTokensField: 'max_tokens',
        },
      ],
    },
    { connectionId: 'synthetic', modelId: 'synthetic-model', thinking: 'off' }
  );
  if (credentialKey !== null)
    await credentials.modify(connection.providerId, async () => ({
      type: 'api_key',
      key: credentialKey,
    }));
  const model = runtime.getModel(connection.providerId, 'synthetic-model')!;
  expect(model.api).toBe(api);
  return { runtime, model };
}

function events(api: CompatibleConnectionApi, tool: boolean): unknown[] {
  if (api === 'google-generative-ai')
    return [
      {
        candidates: [
          { content: { role: 'model', parts: [{ text: 'Considering', thought: true }] } },
        ],
      },
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: tool
                ? [{ functionCall: { name: 'lookup', args: { value: 'sample' } } }]
                : [{ text: 'Complete' }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      },
    ];
  const reasoning = {
    id: 'rs_synthetic',
    type: 'reasoning',
    summary: [{ type: 'summary_text', text: 'Considering' }],
  };
  const item = tool
    ? {
        id: 'fc_synthetic',
        type: 'function_call',
        call_id: 'call_synthetic',
        name: 'lookup',
        arguments: '{"value":"sample"}',
      }
    : {
        id: 'msg_synthetic',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Complete', annotations: [] }],
      };
  return [
    { type: 'response.created', response: { id: 'resp_synthetic' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...reasoning, summary: [] } },
    { type: 'response.reasoning_summary_text.delta', output_index: 0, delta: 'Considering' },
    { type: 'response.output_item.done', output_index: 0, item: reasoning },
    {
      type: 'response.output_item.added',
      output_index: 1,
      item: tool ? { ...item, arguments: '' } : { ...item, content: [] },
    },
    tool
      ? {
          type: 'response.function_call_arguments.delta',
          output_index: 1,
          delta: '{"value":"sample"}',
        }
      : { type: 'response.output_text.delta', output_index: 1, delta: 'Complete' },
    { type: 'response.output_item.done', output_index: 1, item },
    {
      type: 'response.completed',
      response: {
        id: 'resp_synthetic',
        status: 'completed',
        output: [reasoning, item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    },
  ];
}

function sse(streamEvents: unknown[]) {
  return new Response(streamEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

it.each(protocols)(
  '%s streams thinking/text and runs a tool with its result in the next request',
  async (api) => {
    const { runtime, model } = await configured(api);
    const requests: { url: string; body: unknown; headers: Headers }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      requests.push({ url, body, headers: new Headers(init.headers) });
      const hasResult = JSON.stringify(body).includes('synthetic tool result');
      return sse(events(api, !hasResult));
    });
    const streamed: string[] = [];
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
      initialState: { model, thinkingLevel: 'off', tools: [lookup] },
      streamFn: (selectedModel, context, options) =>
        runtime.streamSimple(selectedModel, context, options),
    });
    agent.subscribe((event) => {
      if (
        event.type === 'message_update' &&
        (event.assistantMessageEvent.type === 'text_delta' ||
          event.assistantMessageEvent.type === 'thinking_delta')
      )
        streamed.push(event.assistantMessageEvent.delta);
    });
    await agent.prompt('Use lookup and report the result.');
    expect(agent.state.messages).toContainEqual(
      expect.objectContaining({
        role: 'toolResult',
        content: [{ type: 'text', text: 'synthetic tool result: sample' }],
      })
    );
    expect(agent.state.messages.at(-1)).toMatchObject({
      role: 'assistant',
      stopReason: 'stop',
      content: expect.arrayContaining([
        {
          type: 'text',
          text: 'Complete',
          ...(api === 'openai-responses' ? { textSignature: expect.any(String) } : {}),
        },
      ]),
    });
    expect(streamed).toContain('Considering');
    expect(streamed).toContain('Complete');
    expect(requests.map((request) => request.url)).toEqual([
      api === 'google-generative-ai'
        ? 'https://gateway.invalid/v1beta/models/synthetic-model:streamGenerateContent?alt=sse'
        : 'https://gateway.invalid/v1/responses',
      api === 'google-generative-ai'
        ? 'https://gateway.invalid/v1beta/models/synthetic-model:streamGenerateContent?alt=sse'
        : 'https://gateway.invalid/v1/responses',
    ]);
    expect(
      requests[0]!.headers.get(api === 'google-generative-ai' ? 'x-goog-api-key' : 'authorization')
    ).toBe(api === 'google-generative-ai' ? 'SYNTHETIC_KEY' : 'Bearer SYNTHETIC_KEY');
    expect(JSON.stringify(requests[1]!.body)).toContain('synthetic tool result');
  }
);

it.each(protocols)('%s cancels an active response without completing it', async (api) => {
  const { runtime, model } = await configured(api);
  const abort = new AbortController();
  vi.stubGlobal(
    'fetch',
    async (_url: string, init: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            const first = events(api, false);
            const partial = api === 'openai-responses' ? first.slice(0, -2) : first.slice(0, 1);
            controller.enqueue(
              new TextEncoder().encode(
                partial.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')
              )
            );
            init.signal?.addEventListener(
              'abort',
              () => controller.error(new DOMException('Aborted', 'AbortError')),
              { once: true }
            );
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      )
  );
  const stream = runtime.streamSimple(
    model,
    { messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] },
    { signal: abort.signal }
  );
  for await (const event of stream) {
    if (event.type === 'thinking_delta') abort.abort();
  }
  expect((await stream.result()).stopReason).toBe('aborted');
});

for (const api of protocols) {
  it.each([
    [401, 'auth'],
    [404, 'not_found'],
    [0, 'unreachable'],
  ] as const)('%s sanitizes %s runtime failures', async (status, category) => {
    const { runtime, model } = await configured(api);
    vi.stubGlobal('fetch', async () => {
      if (!status) throw new TypeError('fetch failed SYNTHETIC_SECRET');
      return Response.json({ error: { message: 'SYNTHETIC_SECRET', code: status } }, { status });
    });
    const message = await runtime
      .streamSimple(model, { messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] })
      .result();
    expect(message.stopReason).toBe('error');
    const diagnostic = modelErrorDiagnostic(message);
    expect(diagnostic.category).toBe(category);
    expect(JSON.stringify(diagnostic)).not.toContain('SYNTHETIC_SECRET');
  });
}

for (const api of protocols) {
  it.each([
    [401, 'auth'],
    [404, 'not_found'],
  ] as const)(`${api} sanitizes a %s stream failure after text`, async (status, category) => {
    const { runtime, model } = await configured(api);
    vi.stubGlobal('fetch', async () => {
      const partial =
        api === 'openai-responses'
          ? events(api, false).slice(0, -2)
          : [{ candidates: [{ content: { role: 'model', parts: [{ text: 'Partial' }] } }] }];
      const error = {
        code: status,
        message: 'SYNTHETIC_SECRET',
        status: status === 401 ? 'UNAUTHENTICATED' : 'NOT_FOUND',
      };
      if (api === 'openai-responses')
        return sse([
          ...partial,
          { type: 'response.failed', response: { status: 'failed', error } },
        ]);
      const chunks = [
        partial.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
        JSON.stringify({ error }),
      ];
      return new Response(
        new ReadableStream({
          pull(controller) {
            const chunk = chunks.shift();
            if (chunk === undefined) controller.close();
            else controller.enqueue(new TextEncoder().encode(chunk));
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    });
    const deltas: string[] = [];
    const stream = runtime.streamSimple(model, {
      messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
    });
    for await (const event of stream) {
      if (event.type === 'text_delta') deltas.push(event.delta);
    }
    expect(deltas.length).toBeGreaterThan(0);
    const message = await stream.result();
    expect(message.stopReason).toBe('error');
    expect(modelErrorDiagnostic(message)).toMatchObject({ category });
    expect(JSON.stringify(modelErrorDiagnostic(message))).not.toContain('SYNTHETIC_SECRET');
  });
}

it.each(protocols)('%s completes without requiring tool or reasoning support', async (api) => {
  const { runtime, model } = await configured(api, false);
  let request: unknown;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    request = JSON.parse(String(init.body));
    return sse(
      api === 'google-generative-ai'
        ? [
            {
              candidates: [
                {
                  content: { role: 'model', parts: [{ text: 'Plain reply' }] },
                  finishReason: 'STOP',
                },
              ],
            },
          ]
        : events(api, false)
            .filter(
              (event) =>
                !JSON.stringify(event).includes('reasoning') &&
                !JSON.stringify(event).includes('rs_synthetic')
            )
            .concat([{ type: 'response.completed', response: { status: 'completed', output: [] } }])
    );
  });
  const message = await runtime
    .streamSimple(model, { messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] })
    .result();
  expect(message.stopReason).toBe('stop');
  expect(message.content.some((part) => part.type === 'text' && part.text.length > 0)).toBe(true);
  expect(message.content.some((part) => part.type === 'thinking' || part.type === 'toolCall')).toBe(
    false
  );
  expect(JSON.stringify(request)).not.toMatch(/thinkingConfig|"reasoning"/);
});

for (const api of protocols) {
  it.each(['', null])(
    `${api} refuses missing credential %s before any request`,
    async (credentialKey) => {
      vi.stubEnv('OPENAI_API_KEY', 'SYNTHETIC_AMBIENT');
      vi.stubEnv('GEMINI_API_KEY', 'SYNTHETIC_AMBIENT');
      vi.stubEnv('GOOGLE_API_KEY', 'SYNTHETIC_AMBIENT');
      const { runtime, model } = await configured(api, false, credentialKey);
      const outbound: unknown[] = [];
      vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
        outbound.push({ url, headers: new Headers(init.headers), body: init.body });
        return sse(events(api, false));
      });
      const message = await runtime
        .streamSimple(model, {
          messages: [{ role: 'user', content: 'Synthetic prompt', timestamp: 1 }],
        })
        .result();
      expect(message.stopReason).toBe('error');
      expect(outbound).toEqual([]);
    }
  );
}
