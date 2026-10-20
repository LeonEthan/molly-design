import { expect, it } from 'vitest';
import {
  MockAgent,
  Headers as TransportHeaders,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from 'undici';
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { syntheticConnection } from './fixtures/compatible';
import { configureModelConnection } from '../src/model-connection';

const protocols = ['openai-responses', 'google-generative-ai'] as const;
const methods = ['stream', 'streamSimple', 'complete', 'completeSimple'] as const;
const messages = [{ role: 'user' as const, content: 'Synthetic private prompt', timestamp: 1 }];

const scenarios = protocols.flatMap((api) =>
  methods.flatMap((method) =>
    [307, 308].flatMap((status) =>
      [false, true].flatMap((sameOrigin) =>
        [false, true].map((replacePayload) => ({ api, method, status, sameOrigin, replacePayload }))
      )
    )
  )
);

it.each(scenarios)(
  '$api $method refuses $status sameOrigin=$sameOrigin replacePayload=$replacePayload',
  async ({ api, method, status, sameOrigin, replacePayload }) => {
    const previousDispatcher = getGlobalDispatcher();
    const transport = new MockAgent();
    transport.disableNetConnect();
    setGlobalDispatcher(transport);
    try {
      const credentials = new InMemoryCredentialStore();
      const runtime = await ModelRuntime.create({
        credentials,
        modelsStore: new InMemoryModelsStore(),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      const { providerId } = configureModelConnection(runtime, syntheticConnection(api), {
        connectionId: 'connection',
        modelId: 'model',
        thinking: 'off',
      });
      await credentials.modify(providerId, async () => ({
        type: 'api_key',
        key: 'SYNTHETIC_ONLY',
      }));
      const redirectOrigin = sameOrigin ? 'https://selected.invalid' : 'https://unselected.invalid';
      let sourceBody = '';
      transport
        .get('https://selected.invalid')
        .intercept({
          path:
            api === 'google-generative-ai'
              ? '/v1beta/models/model:streamGenerateContent?alt=sse'
              : '/v1/responses',
          method: 'POST',
        })
        .reply((request) => {
          sourceBody = String(request.body);
          return {
            statusCode: status,
            data: '',
            responseOptions: { headers: { location: `${redirectOrigin}/collect` } },
          };
        });
      const redirectTarget: { key: string | null; authorization: string | null; body: string }[] =
        [];
      transport
        .get(redirectOrigin)
        .intercept({ path: '/collect', method: 'POST' })
        .reply((request) => {
          const headers = new TransportHeaders(request.headers);
          redirectTarget.push({
            key: headers.get('x-goog-api-key'),
            authorization: headers.get('authorization'),
            body: String(request.body),
          });
          return { statusCode: 401, data: '{}' };
        });
      let callerFetchUsed = false;
      const unsafeFetch: typeof fetch = (input, init) => {
        callerFetchUsed = true;
        return globalThis.fetch(input, { ...init, redirect: 'follow' });
      };
      let callbackCompleted = false;
      const options: SimpleStreamOptions = {
        ...(api === 'openai-responses' ? { fetch: unsafeFetch } : {}),
        onPayload: async (payload) => {
          await Promise.resolve();
          callbackCompleted = true;
          if (!replacePayload) return undefined;
          const original = z.record(z.string(), z.unknown()).parse(payload);
          return api === 'openai-responses'
            ? { ...original, input: 'Replacement private prompt' }
            : {
                ...original,
                contents: [{ role: 'user', parts: [{ text: 'Replacement private prompt' }] }],
                config: {
                  ...z.record(z.string(), z.unknown()).parse(original.config),
                  httpOptions: { fetch: unsafeFetch },
                },
              };
        },
      };
      const model = runtime.getModel(providerId, 'model');
      if (!model) throw new Error('missing_synthetic_model');
      const result =
        method === 'stream'
          ? await runtime.stream(model, { messages }, options).result()
          : method === 'streamSimple'
            ? await runtime.streamSimple(model, { messages }, options).result()
            : method === 'complete'
              ? await runtime.complete(model, { messages }, options)
              : await runtime.completeSimple(model, { messages }, options);
      expect(result.stopReason).toBe('error');
      expect(callbackCompleted).toBe(true);
      expect(callerFetchUsed).toBe(false);
      expect(sourceBody).toContain(
        replacePayload ? 'Replacement private prompt' : 'Synthetic private prompt'
      );
      expect(redirectTarget).toEqual([]);
    } finally {
      setGlobalDispatcher(previousDispatcher);
      await transport.close();
    }
  }
);
