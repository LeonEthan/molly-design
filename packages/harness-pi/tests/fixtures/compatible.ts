import type { CompatibleConnectionApi, ModelConnection } from '@molly/shared/embedded-harness';

export function syntheticConnection(compatibleApi: CompatibleConnectionApi): ModelConnection {
  return {
    schemaVersion: 1,
    id: 'connection',
    revision: 1,
    providerPresetId: 'openai-compatible',
    displayName: 'Synthetic',
    credentialRef: 'protected',
    enabled: true,
    compatibleApi,
    baseUrl:
      compatibleApi === 'google-generative-ai'
        ? 'https://selected.invalid/v1beta'
        : 'https://selected.invalid/v1',
    customModels: [
      {
        modelId: 'model',
        name: 'Synthetic',
        input: ['text'],
        contextWindow: 8192,
        maxTokens: 1024,
        thinking: ['off'],
        toolCalls: true,
        maxTokensField: 'max_tokens',
      },
    ],
  };
}

export function syntheticReply(api: CompatibleConnectionApi, text: string): string {
  const item = {
    id: 'msg_synthetic',
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
  const events =
    api === 'google-generative-ai'
      ? [
          {
            candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
          },
        ]
      : [
          { type: 'response.created', response: { id: 'resp_synthetic' } },
          { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
          { type: 'response.output_text.delta', output_index: 0, delta: text },
          { type: 'response.output_item.done', output_index: 0, item },
          {
            type: 'response.completed',
            response: {
              id: 'resp_synthetic',
              status: 'completed',
              output: [item],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          },
        ];
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}
