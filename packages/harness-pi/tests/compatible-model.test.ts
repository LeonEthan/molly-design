import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { createReadToolDefinition, defineTool } from '@earendil-works/pi-coding-agent';
import { createMollySession, type CreateMollySessionInput } from '../src/session-factory';
import { MollyAcpAdapter } from '../src/acp-adapter';
import { HarnessSessionBindingSchema } from '@molly/shared/embedded-harness';
import { RunJournal } from '../src/run-journal';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<CreateMollySessionInput> {
  const root = await mkdtemp(join(tmpdir(), 'molly-compatible-'));
  roots.push(root);
  const cwd = join(root, 'project');
  await mkdir(cwd);
  return {
    cwd,
    productSessionId: 'synthetic-session',
    privateRoot: join(root, 'private'),
    connection: {
      schemaVersion: 1,
      id: 'custom',
      revision: 1,
      providerPresetId: 'openai-compatible',
      displayName: 'Custom',
      baseUrl: 'https://custom.invalid/v1',
      credentialRef: 'synthetic-ref',
      enabled: true,
      customModels: [
        {
          modelId: 'vendor/custom',
          name: 'Custom',
          input: ['text', 'image'],
          contextWindow: 32768,
          maxTokens: 2048,
          thinking: ['off', 'high'],
          toolCalls: true,
          usageInStreaming: true,
          maxTokensField: 'max_tokens',
        },
      ],
    },
    selection: { connectionId: 'custom', modelId: 'vendor/custom', thinking: 'high' },
    apiKey: 'synthetic-compatible-secret',
    tools: [],
    systemPrompt: 'SYNTHETIC_CONTEXT',
  };
}

it.each(['max_tokens', 'max_completion_tokens'] as const)(
  'uses the declared %s protocol through the real SDK and restores native history without transport',
  async (maxTokensField) => {
    const input = await fixture();
    input.connection.customModels = input.connection.customModels?.map((model) => ({
      ...model,
      maxTokensField,
    }));
    const requests: Request[] = [];
    const evidence: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (request, init) => {
      evidence.push('http');
      requests.push(new Request(request, init));
      const chunks = [
        {
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'Synthetic answer' },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        },
      ];
      return new Response(
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
        {
          headers: { 'content-type': 'text/event-stream' },
        }
      );
    });
    input.observeModelRequest = async () => {
      evidence.push('dispatch');
      return async (message) => {
        evidence.push(`settled:${message?.stopReason}`);
      };
    };
    const owned = await createMollySession(input);
    let nativeSessionId: string;
    try {
      expect(owned.session.model).toMatchObject({
        provider: 'molly-compatible',
        api: 'openai-completions',
        id: 'vendor/custom',
        contextWindow: 32768,
        maxTokens: 2048,
        input: ['text', 'image'],
      });
      expect(getSupportedThinkingLevels(owned.session.model!)).toEqual(['off', 'high']);
      expect(owned.runtime.getModel('molly-compatible', 'gpt-4o')).toBeUndefined();
      expect(evidence).toEqual([]);
      await owned.session.prompt('Synthetic request', {
        images: [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }],
      });
      expect(evidence).toEqual(['dispatch', 'http', 'settled:stop']);
      expect(requests.map((request) => request.url)).toEqual([
        'https://custom.invalid/v1/chat/completions',
      ]);
      expect(requests[0]?.headers.get('authorization')).toBe(`Bearer ${input.apiKey}`);
      const payload = await requests[0]!.json();
      expect(payload).toMatchObject({
        model: 'vendor/custom',
        stream: true,
        reasoning_effort: 'high',
        [maxTokensField]: 2048,
        stream_options: { include_usage: true },
      });
      expect(payload).not.toHaveProperty('store');
      expect(payload).not.toHaveProperty(
        maxTokensField === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'
      );
      expect(JSON.stringify(payload.messages)).toContain('data:image/png;base64,aW1hZ2U=');
      expect(owned.session.messages.at(-1)).toMatchObject({
        role: 'assistant',
        stopReason: 'stop',
        usage: { input: 10, output: 4 },
      });
      const history = await readFile(owned.manager.getSessionFile()!, 'utf8');
      expect(history).toContain('Synthetic answer');
      expect(history).not.toContain(input.apiKey);
      nativeSessionId = owned.manager.getSessionId();
    } finally {
      owned.session.dispose();
    }
    const restored = await createMollySession({ ...input, nativeSessionId });
    try {
      expect(restored.session.messages.at(-1)).toMatchObject({
        role: 'assistant',
        stopReason: 'stop',
      });
      expect(evidence).toEqual(['dispatch', 'http', 'settled:stop']);
    } finally {
      restored.session.dispose();
    }
  }
);

it('keeps same model IDs and different endpoint/metadata/credentials connection-local', async () => {
  const input = await fixture();
  const first = await createMollySession(input);
  const second = await createMollySession({
    ...input,
    productSessionId: 'other-session',
    apiKey: 'other-synthetic-key',
    connection: {
      ...input.connection,
      id: 'other',
      baseUrl: 'https://other.invalid/v1',
      customModels: input.connection.customModels?.map((model) => ({
        ...model,
        input: ['text'],
        thinking: ['off'],
      })),
    },
    selection: { ...input.selection, connectionId: 'other', thinking: 'off' },
  });
  try {
    expect(first.session.model?.baseUrl).toBe(input.connection.baseUrl);
    expect(first.session.model?.input).toEqual(['text', 'image']);
    expect(second.session.model?.input).toEqual(['text']);
    expect(second.session.model?.baseUrl).toBe('https://other.invalid/v1');
    expect((await first.runtime.getAuth('molly-compatible'))?.auth.apiKey).toBe(input.apiKey);
    expect((await second.runtime.getAuth('molly-compatible'))?.auth.apiKey).toBe(
      'other-synthetic-key'
    );
  } finally {
    first.session.dispose();
    second.session.dispose();
  }
});

it.each(['missing', 'model', 'thinking', 'tools'] as const)(
  'rejects unsupported %s before model transport',
  async (kind) => {
    const input = await fixture();
    const requests: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (request) => {
      requests.push(request);
      throw new Error('unexpected transport');
    });
    if (kind === 'missing') input.connection.customModels = undefined;
    if (kind === 'model') input.selection.modelId = 'gpt-4o';
    if (kind === 'thinking') input.selection.thinking = 'medium';
    if (kind === 'tools') {
      input.tools = [defineTool(createReadToolDefinition(input.cwd))];
      input.connection.customModels = input.connection.customModels?.map((model) => ({
        ...model,
        toolCalls: false,
      }));
    }
    await expect(createMollySession(input)).rejects.toThrow(
      kind === 'thinking'
        ? 'harness_thinking_level_unsupported'
        : kind === 'tools'
          ? 'harness_model_tools_unsupported'
          : 'harness_model_not_in_catalog'
    );
    expect(requests).toEqual([]);
  }
);

it('completes a native tool loop with declared compatible models', async () => {
  const input = await fixture();
  await writeFile(join(input.cwd, 'synthetic.txt'), 'SYNTHETIC_TOOL_RESULT');
  input.tools = [defineTool(createReadToolDefinition(input.cwd))];
  const bodies: Array<Record<string, unknown>> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (request, init) => {
    const body = await new Request(request, init).json();
    bodies.push(body);
    const toolResultPresent = JSON.stringify(body.messages).includes('SYNTHETIC_TOOL_RESULT');
    const chunk = {
      choices: [
        {
          index: 0,
          delta: toolResultPresent
            ? { content: 'Read completed' }
            : {
                tool_calls: [
                  {
                    index: 0,
                    id: 'synthetic-call',
                    type: 'function',
                    function: {
                      name: 'read',
                      arguments: JSON.stringify({ path: 'synthetic.txt' }),
                    },
                  },
                ],
              },
          finish_reason: toolResultPresent ? 'stop' : 'tool_calls',
        },
      ],
    };
    // Bound the fixture explicitly so a regression cannot create an unbounded model loop.
    if (bodies.length > 2) throw new Error('unexpected additional dispatch');
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  const owned = await createMollySession(input);
  try {
    await owned.session.prompt('Read the synthetic file');
    expect(bodies.map((body) => body.model)).toEqual(['vendor/custom', 'vendor/custom']);
    expect(bodies[0]).toMatchObject({ tools: [{ type: 'function', function: { name: 'read' } }] });
    expect(owned.session.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'toolResult', toolName: 'read', isError: false }),
      ])
    );
    expect(owned.session.messages.at(-1)).toMatchObject({
      stopReason: 'stop',
      content: [{ type: 'text', text: 'Read completed' }],
    });
  } finally {
    owned.session.dispose();
  }
});

it.each([
  { usageInStreaming: true, reported: true },
  { usageInStreaming: false, reported: false },
  { usageInStreaming: true, reported: false },
])(
  'journals streaming usage declared=$usageInStreaming reported=$reported through ACP',
  async ({ usageInStreaming, reported }) => {
    const input = await fixture();
    input.connection.customModels = input.connection.customModels?.map((model) => ({
      ...model,
      usageInStreaming,
    }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          `data: ${JSON.stringify({
            choices: [{ index: 0, delta: { content: 'Done' }, finish_reason: 'stop' }],
            ...(reported
              ? { usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }
              : {}),
          })}\n\ndata: [DONE]\n\n`,
          { headers: { 'content-type': 'text/event-stream' } }
        )
    );
    const harness = {
      id: 'molly',
      engine: 'pi',
      engineVersion: '0.85.1',
      protocolVersion: 1,
      buildId: 'test-build',
    } as const;
    const runtimeEpoch = randomUUID();
    const adapter = new MollyAcpAdapter(
      { sessionUpdate: async () => {} },
      {
        ...input,
        runtimeEpoch,
        harness,
        toolsetHash: '0'.repeat(64),
        pluginSetHash: '0'.repeat(64),
        permissionProfileId: 'test',
      }
    );
    try {
      const created = await adapter.newSession({ cwd: input.cwd, mcpServers: [] });
      const binding = HarnessSessionBindingSchema.parse(created._meta?.mollyRuntime);
      const runId = randomUUID();
      const response = await adapter.prompt({
        sessionId: created.sessionId,
        prompt: [{ type: 'text', text: 'Synthetic accounting request' }],
        _meta: {
          mollyRunSnapshot: {
            schemaVersion: 1,
            runId,
            runtimeEpoch,
            sessionId: input.productSessionId,
            turnId: 'turn',
            connection: input.connection,
            selection: input.selection,
            harness,
            toolsetHash: binding.toolsetHash,
            pluginSetHash: binding.pluginSetHash,
            permissionProfileId: 'test',
          },
        },
      });
      expect(response.stopReason).toBe('end_turn');
      const receipt = await new RunJournal(join(input.privateRoot, 'runs')).read(runId);
      expect(receipt.modelRequests).toEqual([expect.objectContaining({ state: 'succeeded' })]);
      expect(receipt.modelRequests?.[0]?.usage).toEqual(
        reported
          ? {
              inputTokens: 7,
              outputTokens: 3,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
            }
          : undefined
      );
      expect(receipt.modelRequests?.[0]?.usage ?? {}).not.toHaveProperty('costUSD');
    } finally {
      await adapter.dispose();
    }
  }
);
