import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReadToolDefinition, defineTool } from '@earendil-works/pi-coding-agent';
import { createMollySession, type CreateMollySessionInput } from '../src/session-factory';
import { NativeRunOutcome } from '../src/run-outcome';

// Explicit representative IDs from the pinned SDK. These are fixtures, not product defaults.
const cases = [
  { preset: 'openai', model: 'gpt-4o', api: 'openai-responses' },
  { preset: 'anthropic', model: 'claude-haiku-4-5', api: 'anthropic-messages' },
  { preset: 'xai', model: 'grok-4.3', api: 'openai-responses' },
  { preset: 'deepseek', model: 'deepseek-v4-flash', api: 'openai-completions' },
  { preset: 'moonshot', model: 'kimi-k2-0711-preview', api: 'openai-completions' },
  { preset: 'kimi-coding', model: 'k3-256k', api: 'anthropic-messages' },
  { preset: 'zai', model: 'glm-4.7', api: 'openai-completions' },
  { preset: 'minimax', model: 'MiniMax-M2.7', api: 'anthropic-messages' },
  { preset: 'openrouter', model: 'anthropic/claude-haiku-4.5', api: 'anthropic-messages' },
] as const;
type Protocol = (typeof cases)[number]['api'];
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(
  preset: CreateMollySessionInput['connection']['providerPresetId'],
  modelId: string
): Promise<CreateMollySessionInput> {
  const root = await mkdtemp(join(tmpdir(), 'molly-provider-matrix-'));
  roots.push(root);
  const cwd = join(root, 'workspace');
  await mkdir(cwd);
  return {
    cwd,
    privateRoot: join(root, 'private'),
    productSessionId: 'synthetic-matrix',
    connection: {
      schemaVersion: 1,
      id: preset,
      revision: 1,
      providerPresetId: preset,
      displayName: preset,
      baseUrl: 'https://provider.invalid/api',
      credentialRef: 'synthetic-reference',
      enabled: true,
    },
    selection: {
      connectionId: preset,
      modelId,
      thinking: preset === 'kimi-coding' ? 'high' : 'off',
    },
    apiKey: `SYNTHETIC_${preset}_KEY`,
    tools: [],
    systemPrompt: 'SYNTHETIC_SYSTEM',
  };
}

function streamResponse(api: Protocol, model: string, truncated: boolean) {
  let events: unknown[];
  if (api === 'anthropic-messages') {
    events = [
      {
        type: 'message_start',
        message: {
          id: 'synthetic-message',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          usage: { input_tokens: 8, output_tokens: 0 },
        },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Synthetic result' },
      },
      ...(!truncated
        ? [
            { type: 'content_block_stop', index: 0 },
            {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 3 },
            },
            { type: 'message_stop' },
          ]
        : []),
    ];
  } else if (api === 'openai-responses') {
    const item = { id: 'synthetic-item', type: 'message', role: 'assistant', content: [] };
    events = [
      { type: 'response.created', response: { id: 'synthetic-response', status: 'in_progress' } },
      { type: 'response.output_item.added', output_index: 0, item },
      {
        type: 'response.output_text.delta',
        output_index: 0,
        content_index: 0,
        delta: 'Synthetic result',
      },
      ...(!truncated
        ? [
            {
              type: 'response.output_item.done',
              output_index: 0,
              item: {
                ...item,
                status: 'completed',
                content: [{ type: 'output_text', text: 'Synthetic result', annotations: [] }],
              },
            },
            {
              type: 'response.completed',
              response: {
                id: 'synthetic-response',
                status: 'completed',
                output: [],
                usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
              },
            },
          ]
        : []),
    ];
  } else {
    events = [
      {
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'Synthetic result' },
            finish_reason: null,
          },
        ],
      },
      ...(!truncated
        ? [
            {
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
            },
          ]
        : []),
    ];
  }
  return new Response(
    events
      .map((event) => {
        const eventType =
          typeof event === 'object' && event !== null && 'type' in event
            ? `event: ${event.type}\n`
            : '';
        return `${eventType}data: ${JSON.stringify(event)}\n\n`;
      })
      .join('') + (api === 'openai-completions' && !truncated ? 'data: [DONE]\n\n' : ''),
    {
      headers: { 'content-type': 'text/event-stream' },
    }
  );
}

function toolResponse(api: Protocol, model: string) {
  const args = JSON.stringify({ path: 'synthetic.txt' });
  let events: unknown[];
  if (api === 'anthropic-messages') {
    events = [
      {
        type: 'message_start',
        message: {
          id: 'synthetic-tool-message',
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          usage: { input_tokens: 8, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'synthetic-call', name: 'read', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: args },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 3 },
      },
      { type: 'message_stop' },
    ];
  } else if (api === 'openai-responses') {
    const item = {
      type: 'function_call',
      id: 'fc_synthetic',
      call_id: 'synthetic-call',
      name: 'read',
      arguments: '',
    };
    events = [
      {
        type: 'response.created',
        response: { id: 'synthetic-tool-response', status: 'in_progress' },
      },
      { type: 'response.output_item.added', output_index: 0, item },
      { type: 'response.function_call_arguments.delta', output_index: 0, delta: args },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { ...item, arguments: args, status: 'completed' },
      },
      {
        type: 'response.completed',
        response: {
          id: 'synthetic-tool-response',
          status: 'completed',
          output: [],
          usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
        },
      },
    ];
  } else {
    events = [
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'synthetic-call',
                  type: 'function',
                  function: { name: 'read', arguments: args },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
      },
    ];
  }
  return new Response(
    events
      .map((event) => {
        const eventType =
          typeof event === 'object' && event !== null && 'type' in event
            ? `event: ${event.type}\n`
            : '';
        return `${eventType}data: ${JSON.stringify(event)}\n\n`;
      })
      .join('') + (api === 'openai-completions' ? 'data: [DONE]\n\n' : ''),
    { headers: { 'content-type': 'text/event-stream' } }
  );
}

describe.each(cases)('$preset native SDK protocol', ({ preset, model, api }) => {
  it('settles a native read tool before continuing the same selected model', async () => {
    const input = await fixture(preset, model);
    await writeFile(join(input.cwd, 'synthetic.txt'), 'SYNTHETIC_TOOL_RESULT');
    input.tools = [defineTool(createReadToolDefinition(input.cwd))];
    const requests: Array<Record<string, unknown>> = [];
    const effects: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (request, init) => {
      const body = await new Request(request, init).json();
      requests.push(body);
      effects.push('http');
      if (requests.length > 2) throw new Error('unexpected additional dispatch');
      return JSON.stringify(body).includes('SYNTHETIC_TOOL_RESULT')
        ? streamResponse(api, model, false)
        : toolResponse(api, model);
    });
    const owned = await createMollySession({
      ...input,
      observeModelRequest: async (selected) => {
        effects.push(`dispatch:${selected.id}`);
        return async (message) => {
          effects.push(`settled:${message?.stopReason ?? 'unknown'}`);
        };
      },
    });
    const outcome = new NativeRunOutcome();
    owned.session.subscribe((event) => {
      outcome.accept(event);
      if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end')
        effects.push(event.type);
    });
    try {
      await owned.session.prompt('Read the synthetic file');
      expect(outcome.finish(owned.manager.getLeafId()).status).toBe('completed');
      expect(requests.map((body) => body.model)).toEqual([model, model]);
      expect(effects).toEqual([
        `dispatch:${model}`,
        'http',
        'settled:toolUse',
        'tool_execution_start',
        'tool_execution_end',
        `dispatch:${model}`,
        'http',
        'settled:stop',
      ]);
      expect(owned.session.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'toolResult',
            toolName: 'read',
            isError: false,
            content: [{ type: 'text', text: 'SYNTHETIC_TOOL_RESULT' }],
          }),
        ])
      );
      expect(owned.session.messages.at(-1)).toMatchObject({
        stopReason: 'stop',
        content: [{ type: 'text', text: 'Synthetic result' }],
      });
    } finally {
      owned.session.dispose();
    }
  });
  it.each(['success', '401', '429', 'network', 'truncated'] as const)(
    'settles %s without automatic fallback or repeated HTTP',
    async (mode) => {
      const input = await fixture(preset, model);
      const requests: Request[] = [];
      const accounting: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (request, init) => {
        requests.push(new Request(request, init));
        accounting.push('http');
        if (mode === 'network') throw new Error('SYNTHETIC_PRIVATE_DIAGNOSTIC');
        return mode === '401' || mode === '429'
          ? new Response(JSON.stringify({ error: { message: 'SYNTHETIC_PRIVATE_DIAGNOSTIC' } }), {
              status: Number(mode),
              headers: { 'content-type': 'application/json' },
            })
          : streamResponse(api, model, mode === 'truncated');
      });
      const owned = await createMollySession({
        ...input,
        observeModelRequest: async (selected) => {
          accounting.push(`dispatch:${selected.id}`);
          return async (message) => {
            accounting.push(`settled:${message?.stopReason ?? 'unknown'}`);
          };
        },
      });
      const outcome = new NativeRunOutcome();
      owned.session.subscribe((event) => outcome.accept(event));
      try {
        expect(owned.session.model?.api).toBe(api);
        expect(accounting).toEqual([]);
        await owned.session.prompt('Synthetic provider contract');
        expect(outcome.finish(owned.manager.getLeafId()).status).toBe(
          mode === 'success' ? 'completed' : 'failed'
        );
        expect(accounting).toEqual([
          `dispatch:${model}`,
          'http',
          `settled:${mode === 'success' ? 'stop' : 'error'}`,
        ]);
        expect(requests.map((request) => new URL(request.url).origin)).toEqual([
          'https://provider.invalid',
        ]);
        const request = requests[0]!;
        expect(await request.json()).toMatchObject({ model, stream: true });
        expect(
          request.headers.get('authorization') === `Bearer ${input.apiKey}` ||
            request.headers.get('x-api-key') === input.apiKey
        ).toBe(true);
        const history = await readFile(owned.manager.getSessionFile()!, 'utf8');
        expect(history).not.toContain(input.apiKey);
        expect(history).not.toContain('SYNTHETIC_PRIVATE_DIAGNOSTIC');
        if (mode === 'success') expect(history).toContain('Synthetic result');
      } finally {
        owned.session.dispose();
      }
    }
  );
  it('rejects an unknown explicit model before provider transport', async () => {
    const input = await fixture(preset, 'synthetic-model-not-in-catalog');
    const requests: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (request) => {
      requests.push(request);
      throw new Error('unexpected model transport');
    });
    await expect(createMollySession(input)).rejects.toThrow('harness_model_not_in_catalog');
    expect(requests).toEqual([]);
  });
});

it('records the pinned Google adapter transport incompatibility instead of claiming native support', async () => {
  const input = await fixture('google', 'gemini-2.5-flash');
  const effects: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    effects.push('http');
    throw new Error('unexpected network');
  });
  const owned = await createMollySession({
    ...input,
    observeModelRequest: async () => {
      effects.push('dispatch');
      return async () => {};
    },
  });
  const outcome = new NativeRunOutcome();
  owned.session.subscribe((event) => outcome.accept(event));
  try {
    expect(owned.session.model?.api).toBe('google-generative-ai');
    await owned.session.prompt('Synthetic Google transport check');
    // T06 remains incomplete: upstream rejects the required per-request fetch boundary.
    expect(outcome.finish(owned.manager.getLeafId()).status).toBe('failed');
    expect(effects).toEqual([]);
    expect(owned.session.messages.at(-1)).toMatchObject({
      errorMessage: 'harness_provider_failed',
    });
  } finally {
    owned.session.dispose();
  }
});
