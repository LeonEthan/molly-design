import { systemPromptText } from './fixtures/model-context';
import { registerSyntheticModels } from './fixtures/synthetic-models';
import type { PersonalMemoryProvider } from '@molly/shared/personal-memory';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
  type AssistantMessage,
} from '@earendil-works/pi-ai';
import type {
  McpServer,
  SessionNotification,
  AgentSideConnection,
  CreateElicitationRequest,
  CreateElicitationResponse,
} from '@agentclientprotocol/sdk';
import { createMollySession, type CreateMollySessionInput } from '../src/session-factory';
import { MollyResourceLoader } from '../src/resource-loader';
import { failingExtension } from './fixtures/failing-extension';
import { MollyAcpAdapter, type McpCredentialProvider } from '../src/acp-adapter';
import { createApprovedTools, hashToolset } from '../src/approved-tools';
import { RunJournal } from '../src/run-journal';
import { createAutoReviewApproval } from '../src/auto-review';
import { decideAutoReview } from '../src/auto-review-policy';
import {
  HARNESS_QUESTION_DISMISS_METHOD,
  HarnessQuestionIdentitySchema,
  type HarnessRunSnapshot,
} from '@molly/shared/embedded-harness';

registerSyntheticModels();
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(
  responses = [fauxAssistantMessage('Done', { timestamp: 1 })],
  approve: Parameters<typeof createApprovedTools>[0]['approve'] = async () => false,
  mcpServers: McpServer[] = [],
  mcpCredentials?: McpCredentialProvider,
  questionPeer?: Pick<AgentSideConnection, 'unstable_createElicitation' | 'extMethod'>,
  personalMemory?: PersonalMemoryProvider,
  beforeResponse?: (systemPrompt: string | undefined) => Promise<void>,
  usagePeer?: Pick<AgentSideConnection, 'extNotification'>
) {
  const privateRoot = await mkdtemp(join(tmpdir(), 'molly-acp-test-'));
  roots.push(privateRoot);
  const cwd = join(privateRoot, 'workspace');
  await mkdir(cwd);
  const tools = createApprovedTools({ cwd, shellPath: '/bin/sh', approve });
  const input = {
    cwd,
    privateRoot,
    runtimeEpoch: randomUUID(),
    productSessionId: 'product-session',
    workspaceId: 'synthetic-workspace',
    harness: {
      id: 'molly' as const,
      engine: 'pi' as const,
      engineVersion: '0.85.1' as const,
      protocolVersion: 1 as const,
      buildId: 'test-build',
    },
    connection: {
      schemaVersion: 1 as const,
      id: 'test',
      revision: 1,
      providerPresetId: 'openai' as const,
      displayName: 'Test',
      baseUrl: 'https://example.invalid/v1',
      credentialRef: 'synthetic-ref',
      enabled: true,
    },
    selection: { connectionId: 'test', modelId: 'gpt-4o', thinking: 'off' as const },
    apiKey: 'synthetic-key',
    systemPrompt: 'Synthetic test',
    tools,
    toolsetHash: hashToolset(tools),
    pluginSetHash: '0'.repeat(64),
    permissionProfileId: 'test',
  };
  const updates: SessionNotification[] = [];
  const messages: unknown[] = [];
  const credentialRequests: string[] = [];
  const systemPrompts: Array<string | undefined> = [];
  const sessionInputs: CreateMollySessionInput[] = [];
  const adapter = new MollyAcpAdapter(
    {
      ...questionPeer,
      ...usagePeer,
      sessionUpdate: async (update) => {
        updates.push(update);
      },
    },
    input,
    async (config) => {
      sessionInputs.push(config);
      const owned = await createMollySession(config);
      owned.runtime.registerProvider('openai', {
        api: owned.session.model!.api,
        streamSimple: (_model, context) => {
          messages.push(context.messages.filter((message) => message.role !== 'system'));
          systemPrompts.push(systemPromptText(context));
          const result: AssistantMessage =
            responses.shift() ??
            fauxAssistantMessage('Unexpected dispatch', { stopReason: 'error', timestamp: 1 });
          const stream = createAssistantMessageEventStream();
          const emit = () => {
            if (result.stopReason === 'error' || result.stopReason === 'aborted') {
              stream.push({ type: 'error', reason: result.stopReason, error: result });
            } else if (result.stopReason !== 'pending')
              stream.push({ type: 'done', reason: result.stopReason, message: result });
            stream.end();
          };
          if (beforeResponse) void beforeResponse(systemPromptText(context)).then(emit);
          else emit();
          return stream;
        },
      });
      return owned;
    },
    async (snapshot) => {
      credentialRequests.push(snapshot.runId);
      return input.apiKey;
    },
    approve,
    mcpCredentials,
    personalMemory
  );
  if (questionPeer)
    await adapter.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        elicitation: { form: {} },
        _meta: { mollyQuestionUI: { version: 1 } },
      },
    });
  const { sessionId, _meta } = await adapter.newSession({ cwd, mcpServers });
  const snapshot: HarnessRunSnapshot = {
    schemaVersion: 1,
    runId: randomUUID(),
    runtimeEpoch: input.runtimeEpoch,
    sessionId: input.productSessionId,
    turnId: 'turn1',
    connection: input.connection,
    selection: input.selection,
    harness: {
      id: 'molly',
      engine: 'pi',
      engineVersion: '0.85.1',
      protocolVersion: 1,
      buildId: 'test-build',
    },
    toolsetHash: (_meta!.mollyRuntime as { toolsetHash: string }).toolsetHash,
    pluginSetHash: (_meta!.mollyRuntime as { pluginSetHash: string }).pluginSetHash,
    permissionProfileId: input.permissionProfileId,
  };
  const request = {
    sessionId,
    prompt: [{ type: 'text' as const, text: 'Synthetic task' }],
    _meta: { mollyRunSnapshot: snapshot },
  };
  return {
    adapter,
    input,
    request,
    snapshot,
    updates,
    sessionInputs,
    messages,
    credentialRequests,
    systemPrompts,
    journal: new RunJournal(join(privateRoot, 'runs')),
  };
}

describe('owned ACP boundary', () => {
  it('refuses an unmapped native command before dispatch or command side effects', async () => {
    const resources = failingExtension('agent_end', []);
    const extension = resources.extensions[0]!;
    extension.handlers.clear();
    const effects: string[] = [];
    extension.commands.set('synthetic-command', {
      name: 'synthetic-command',
      sourceInfo: extension.sourceInfo,
      handler: async () => {
        effects.push('executed');
      },
    });
    vi.spyOn(MollyResourceLoader.prototype, 'getExtensions').mockReturnValue(resources);
    const f = await fixture();
    try {
      await expect(
        f.adapter.prompt({
          ...f.request,
          prompt: [{ type: 'text', text: '/synthetic-command arguments' }],
        })
      ).rejects.toThrow('harness_extension_command_unmapped');
      expect(effects).toEqual([]);
      expect(f.messages).toEqual([]);
      await expect(f.journal.read(f.snapshot.runId)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await f.adapter.dispose();
    }
  });

  it('preserves an ordinary slash-prefixed prompt as model input', async () => {
    const f = await fixture();
    const text = '/ordinary-path is an input reference, not an installed command';
    try {
      const result = await f.adapter.prompt({ ...f.request, prompt: [{ type: 'text', text }] });
      expect(result.stopReason).toBe('end_turn');
      expect(JSON.stringify(f.messages)).toContain(text);
    } finally {
      await f.adapter.dispose();
    }
  });

  it('accepts resource_link attachments under the shared attachments root and rejects escapes', async () => {
    // Regression for issue #49: the adapter validated containment against the
    // pre-rename `.lody/attachments` while the daemon materializes into the
    // shared contract root `.molly/attachments`, failing every
    // attachment-bearing prompt with ENOENT.
    const f = await fixture();
    try {
      const dir = join(f.input.cwd, '.molly', 'attachments');
      await mkdir(dir, { recursive: true });
      const file = join(dir, 'abc12345-palette.png');
      await writeFile(file, 'synthetic-bytes');
      const result = await f.adapter.prompt({
        ...f.request,
        prompt: [
          { type: 'text', text: 'continue the design' },
          {
            type: 'resource_link',
            uri: pathToFileURL(file).href,
            name: 'palette.png',
            mimeType: 'image/png',
            size: 15,
          },
        ],
      });
      expect(result.stopReason).toBe('end_turn');
      const dispatched = JSON.stringify(f.messages);
      expect(dispatched).toContain('User attachment:');
      expect(dispatched).toContain('palette.png');
    } finally {
      await f.adapter.dispose();
    }

    const escape = await fixture();
    try {
      await mkdir(join(escape.input.cwd, '.molly', 'attachments'), { recursive: true });
      const outside = join(escape.input.privateRoot, 'outside.png');
      await writeFile(outside, 'x');
      await expect(
        escape.adapter.prompt({
          ...escape.request,
          prompt: [
            {
              type: 'resource_link',
              uri: pathToFileURL(outside).href,
              name: 'outside.png',
              mimeType: 'image/png',
              size: 1,
            },
          ],
        })
      ).rejects.toThrow('harness_attachment_outside_scope');
      expect(escape.messages).toEqual([]);
    } finally {
      await escape.adapter.dispose();
    }
  });
  it('does not turn a failed completion hook into success or reuse its failed context', async () => {
    const events: string[] = [];
    vi.spyOn(MollyResourceLoader.prototype, 'getExtensions').mockReturnValue(
      failingExtension('agent_end', events)
    );
    const f = await fixture();
    try {
      await expect(f.adapter.prompt(f.request)).rejects.toThrow('harness_failed');
      expect(events).toEqual(['agent_end']);
      const record = await f.journal.read(f.snapshot.runId);
      expect(record.outcome).toEqual({ status: 'failed', errorCode: 'extension_hook_failed' });
      expect(JSON.stringify({ record, updates: f.updates })).not.toContain(
        'SYNTHETIC_PRIVATE_EXTENSION_DIAGNOSTIC'
      );
      const next = { ...f.snapshot, runId: randomUUID(), turnId: 'next-turn' };
      await expect(
        f.adapter.prompt({ ...f.request, _meta: { mollyRunSnapshot: next } })
      ).rejects.toThrow('harness_extension_failed');
      await expect(f.journal.read(next.runId)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(events).toEqual(['agent_end']);
    } finally {
      await f.adapter.dispose();
    }
  });
  it.each(['answered', 'closed', 'host-error', 'dismiss-error'] as const)(
    'negotiates the curated question tool with frozen hashes and native settlement (%s)',
    async (mode) => {
      const questions: CreateElicitationRequest[] = [];
      const dismissals: unknown[] = [];
      const continuation = fauxAssistantMessage('Synthetic continuation', { timestamp: 2 });
      const outputs = [
        fauxAssistantMessage(
          fauxToolCall(
            'ask_question',
            { question: 'Layout?', options: ['Wide', 'Tall'] },
            { id: 'native-question' }
          ),
          { stopReason: 'toolUse', timestamp: 1 }
        ),
        continuation,
      ];
      const f = await fixture(outputs, undefined, [], undefined, {
        unstable_createElicitation: async (request) => {
          questions.push(request);
          if (mode === 'host-error') throw new Error('PRIVATE_UI_DIAGNOSTIC');
          const identity = HarnessQuestionIdentitySchema.parse(request._meta?.mollyQuestion);
          return mode === 'closed'
            ? { action: 'cancel' }
            : { action: 'accept', content: { [identity.questionId]: 'Wide' } };
        },
        extMethod: async (method, params) => {
          expect(method).toBe(HARNESS_QUESTION_DISMISS_METHOD);
          dismissals.push(params.request);
          if (mode === 'dismiss-error') throw new Error('PRIVATE_DISMISS_DIAGNOSTIC');
          return { version: 1, dismissed: true };
        },
      });
      try {
        expect(f.snapshot.pluginSetHash).not.toBe(f.input.pluginSetHash);
        expect(f.snapshot.toolsetHash).not.toBe(hashToolset(f.input.tools));
        if (mode === 'host-error' || mode === 'dismiss-error') {
          await expect(f.adapter.prompt(f.request)).rejects.toThrow('harness_failed');
          expect((await f.journal.read(f.snapshot.runId)).outcome).toEqual({
            status: 'failed',
            errorCode: 'extension_question_failed',
          });
          expect(outputs).toEqual([continuation]);
        } else {
          expect((await f.adapter.prompt(f.request)).stopReason).toBe('end_turn');
          expect(JSON.stringify(f.messages)).toContain(
            mode === 'answered' ? 'question_1: Wide' : 'No answer was provided'
          );
        }
        const identity = HarnessQuestionIdentitySchema.parse(questions[0]?._meta?.mollyQuestion);
        expect(identity).toMatchObject({
          runId: f.snapshot.runId,
          runtimeEpoch: f.snapshot.runtimeEpoch,
        });
        expect(dismissals).toEqual([identity]);
        expect(JSON.stringify(f.messages)).not.toContain('PRIVATE_');
      } finally {
        await f.adapter.dispose();
      }
    }
  );

  it('closes the pending question on stop and ignores a late affirmative answer', async () => {
    let release: (value: CreateElicitationResponse) => void = () => {};
    let opened: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      opened = resolve;
    });
    let question: CreateElicitationRequest | undefined;
    const dismissed: unknown[] = [];
    const continuation = fauxAssistantMessage('Must not run after stop', { timestamp: 2 });
    const outputs = [
      fauxAssistantMessage(
        fauxToolCall(
          'ask_question',
          { question: 'Proceed?', options: ['Yes', 'No'] },
          { id: 'native-question' }
        ),
        { stopReason: 'toolUse', timestamp: 1 }
      ),
      continuation,
    ];
    const f = await fixture(outputs, undefined, [], undefined, {
      unstable_createElicitation: (request) =>
        new Promise((resolve) => {
          question = request;
          release = resolve;
          opened();
        }),
      extMethod: async (_method, params) => {
        dismissed.push(params.request);
        return { version: 1, dismissed: true };
      },
    });
    try {
      const pending = f.adapter.prompt(f.request);
      await ready;
      // A late notification from a replaced native context must not fail this run.
      f.sessionInputs[0]?.onExtensionError?.(Symbol('retired-extension-context'));
      await f.adapter.cancel({ sessionId: f.request.sessionId });
      expect((await pending).stopReason).toBe('cancelled');
      const identity = HarnessQuestionIdentitySchema.parse(question?._meta?.mollyQuestion);
      expect(dismissed).toEqual([identity]);
      release({ action: 'accept', content: { [identity.questionId]: 'Yes' } });
      expect((await pending).stopReason).toBe('cancelled');
      expect(outputs).toEqual([continuation]);
    } finally {
      await f.adapter.dispose();
    }
  });
  it('publishes the complete native bash command before permission is answered', async () => {
    const command = 'printf "synthetic\\n"\nls .scratch';
    const f = await fixture([
      fauxAssistantMessage(fauxToolCall('bash', { command }, { id: 'command-target' }), {
        stopReason: 'toolUse',
        timestamp: 1,
      }),
      fauxAssistantMessage('Permission was denied', { timestamp: 2 }),
    ]);
    try {
      await f.adapter.prompt(f.request);
      expect(
        f.updates.find(({ update }) => update.sessionUpdate === 'tool_call')?.update
      ).toMatchObject({
        toolCallId: 'command-target',
        kind: 'execute',
        title: `bash: ${command}`,
        rawInput: { command },
      });
    } finally {
      await f.adapter.dispose();
    }
  });
  it('publishes the native read target and operation kind before permission is answered', async () => {
    const f = await fixture([
      fauxAssistantMessage(fauxToolCall('read', { path: 'design.yaml' }, { id: 'read-target' }), {
        stopReason: 'toolUse',
        timestamp: 1,
      }),
      fauxAssistantMessage('Permission was denied', { timestamp: 2 }),
    ]);
    try {
      await f.adapter.prompt(f.request);
      expect(
        f.updates.find(({ update }) => update.sessionUpdate === 'tool_call')?.update
      ).toMatchObject({
        toolCallId: 'read-target',
        kind: 'read',
        title: 'read design.yaml',
        rawInput: { path: 'design.yaml' },
        locations: [{ path: join(f.input.cwd, 'design.yaml') }],
      });
    } finally {
      await f.adapter.dispose();
    }
  });
  it('persists concurrent request receipts, rejects replay and restores connection-qualified usage', async () => {
    const f = await fixture();
    try {
      await f.journal.begin(f.snapshot);
      const first = randomUUID();
      const second = randomUUID();
      await Promise.all(
        [first, second].map((id) =>
          f.journal.modelRequest(f.snapshot.runId, f.snapshot.runtimeEpoch, {
            id,
            state: 'dispatched',
          })
        )
      );
      await f.journal.modelRequest(f.snapshot.runId, f.snapshot.runtimeEpoch, {
        id: first,
        state: 'succeeded',
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          cacheReadInputTokens: 3,
          cacheCreationInputTokens: 2,
        },
      });
      await expect(
        f.journal.modelRequest(f.snapshot.runId, f.snapshot.runtimeEpoch, {
          id: second,
          state: 'dispatched',
        })
      ).rejects.toThrow('harness_model_request_replayed');
      await f.journal.settle(f.snapshot.runId, f.snapshot.runtimeEpoch, { status: 'cancelled' });
      const restored = new RunJournal(join(f.input.privateRoot, 'runs'));
      expect((await restored.read(f.snapshot.runId)).modelRequests).toEqual([
        {
          id: first,
          state: 'succeeded',
          usage: {
            inputTokens: 11,
            outputTokens: 7,
            cacheReadInputTokens: 3,
            cacheCreationInputTokens: 2,
          },
        },
        { id: second, state: 'dispatched' },
      ]);
      const rows = await restored.modelUsage(f.input.productSessionId);
      expect(rows.map((row) => row.model)).toEqual([
        'molly-model:test/gpt-4o',
        'molly-model:test/gpt-4o',
      ]);
      expect(rows[0]?.usage.inputTokens).toBe(11);
      expect(rows.every((row) => row.usage.costUSD === undefined)).toBe(true);
      expect(await restored.modelUsage('other-session')).toEqual([]);
      await expect(
        restored.modelRequest(f.snapshot.runId, f.snapshot.runtimeEpoch, {
          id: second,
          state: 'outcome_unknown',
        })
      ).rejects.toThrow('harness_stale_request');
    } finally {
      await f.adapter.dispose();
    }
  });
  it('accounts one session past truncated and schema-invalid records and leaves them untouched', async () => {
    const f = await fixture();
    try {
      await f.journal.begin(f.snapshot);
      const id = randomUUID();
      await f.journal.modelRequest(f.snapshot.runId, f.snapshot.runtimeEpoch, {
        id,
        state: 'dispatched',
      });
      await f.journal.modelRequest(f.snapshot.runId, f.snapshot.runtimeEpoch, {
        id,
        state: 'succeeded',
        usage: {
          inputTokens: 5,
          outputTokens: 2,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      });
      const other = { ...f.snapshot, runId: randomUUID(), sessionId: 'other-session' };
      await f.journal.begin(other);
      await f.journal.modelRequest(other.runId, other.runtimeEpoch, {
        id: randomUUID(),
        state: 'dispatched',
      });
      const directory = join(f.input.privateRoot, 'runs');
      const bad = {
        truncated: `${'a'.repeat(64)}.json`,
        invalid: `${'b'.repeat(64)}.json`,
        ownedInvalid: `${'c'.repeat(64)}.json`,
        empty: `${'d'.repeat(64)}.json`,
      };
      const contents = {
        [bad.truncated]: '{"schemaVersion":1,"snapshot":{"runId":',
        [bad.invalid]: JSON.stringify({
          schemaVersion: 2,
          snapshot: { sessionId: 'other-session' },
        }),
        [bad.ownedInvalid]: JSON.stringify({
          schemaVersion: 1,
          snapshot: { ...f.snapshot, runId: randomUUID() },
          state: 'settled',
        }),
        [bad.empty]: '',
      };
      for (const [name, text] of Object.entries(contents))
        await writeFile(join(directory, name), text);
      const rows = await f.journal.modelUsage(f.input.productSessionId);
      expect(rows.map((row) => row.id)).toEqual([id]);
      expect(rows[0]?.usage.inputTokens).toBe(5);
      expect((await f.journal.modelUsage('other-session')).length).toBe(1);
      for (const [name, text] of Object.entries(contents))
        expect(await readFile(join(directory, name), 'utf8')).toBe(text);
    } finally {
      await f.adapter.dispose();
    }
  });

  it('keeps a partial record as an exclusive-open dispatch fence', async () => {
    const f = await fixture();
    try {
      const directory = join(f.input.privateRoot, 'runs');
      await mkdir(directory, { recursive: true });
      const { createHash } = await import('node:crypto');
      const path = join(
        directory,
        `${createHash('sha256').update(f.snapshot.runId).digest('hex')}.json`
      );
      await writeFile(path, '{"schemaVersion":1,');
      await expect(f.journal.begin(f.snapshot)).rejects.toMatchObject({ code: 'EEXIST' });
      expect(await readFile(path, 'utf8')).toBe('{"schemaVersion":1,');
    } finally {
      await f.adapter.dispose();
    }
  });

  it('completes and settles a run whose runs directory holds a corrupt record', async () => {
    const notifications: string[] = [];
    const f = await fixture(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        extNotification: async (method) => {
          notifications.push(method);
        },
      }
    );
    try {
      const directory = join(f.input.privateRoot, 'runs');
      await mkdir(directory, { recursive: true });
      const corrupt = join(directory, `${'e'.repeat(64)}.json`);
      await writeFile(corrupt, '{"schemaVersion":1,"snapshot":');
      const result = await f.adapter.prompt(f.request);
      expect(result.stopReason).toBe('end_turn');
      expect(result._meta).toMatchObject({ mollyNativeOutcome: { status: 'completed' } });
      expect((await f.journal.read(f.snapshot.runId)).outcome?.status).toBe('completed');
      expect(await readFile(corrupt, 'utf8')).toBe('{"schemaVersion":1,"snapshot":');
    } finally {
      await f.adapter.dispose();
    }
  });

  it('does not fail a settled run when usage delivery fails', async () => {
    const f = await fixture(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        extNotification: async () => {
          throw new Error('synthetic delivery failure');
        },
      }
    );
    try {
      const prior = { ...f.snapshot, runId: randomUUID(), turnId: 'prior-turn' };
      await f.journal.begin(prior);
      await f.journal.modelRequest(prior.runId, prior.runtimeEpoch, {
        id: randomUUID(),
        state: 'dispatched',
      });
      const result = await f.adapter.prompt(f.request);
      expect(result.stopReason).toBe('end_turn');
      expect(result._meta).toMatchObject({ mollyNativeOutcome: { status: 'completed' } });
      expect((await f.journal.read(f.snapshot.runId)).outcome?.status).toBe('completed');
    } finally {
      await f.adapter.dispose();
    }
  });
  it('reviews an auto-review escalation with the session model before running it', async () => {
    const responses = [
      fauxAssistantMessage(
        fauxToolCall(
          'write',
          { path: '../outside-workspace.txt', content: 'synthetic' },
          { id: 'escalated-write' }
        ),
        { stopReason: 'toolUse', timestamp: 1 }
      ),
      fauxAssistantMessage('{"outcome":"allow"}', { timestamp: 2 }),
      fauxAssistantMessage('{"outcome":"allow"}', { timestamp: 3 }),
      fauxAssistantMessage('Done', { timestamp: 4 }),
    ];
    const asked: string[] = [];
    let adapter: MollyAcpAdapter | undefined;
    const f = await fixture(responses, async (request) => {
      const current = adapter!;
      return createAutoReviewApproval({
        mode: () => current.currentRunScope?.permissionMode,
        decide: (pending) =>
          decideAutoReview(pending, {
            cwd: f.input.cwd,
            writableRoots: [f.input.cwd],
            deniedReadRoots: [],
            sandboxAvailable: false,
          }),
        review: (subject, signal) => current.reviewEscalation(subject, signal),
        record: (pending, source, decision) =>
          current
            .recordApproval({
              toolCallId: pending.toolCallId,
              tool: pending.name,
              source,
              decision,
            })
            .then(() => true),
        askUser: async (pending) => {
          asked.push(pending.name);
          return false;
        },
      })(request);
    });
    adapter = f.adapter;
    f.snapshot.permissionMode = 'auto-review';
    try {
      expect((await f.adapter.prompt(f.request)).stopReason).toBe('end_turn');
      expect(responses).toEqual([]);
      expect(asked).toEqual([]);
      expect(JSON.stringify(f.messages)).toContain('Write outside the workspace');
      await expect(
        readFile(join(f.input.cwd, '..', 'outside-workspace.txt'), 'utf8')
      ).resolves.toBe('synthetic');
      expect((await f.journal.read(f.snapshot.runId)).approvals).toEqual([
        { toolCallId: 'escalated-write', tool: 'write', source: 'classifier', decision: 'allow' },
        { toolCallId: 'escalated-write', tool: 'write', source: 'classifier', decision: 'allow' },
      ]);
    } finally {
      await f.adapter.dispose();
    }
  });
  it('persists native settlement and rejects a repeated dispatch identity', async () => {
    const f = await fixture();
    try {
      const result = await f.adapter.prompt(f.request);
      expect(result.stopReason).toBe('end_turn');
      expect(result._meta?.mollyRunId).toBe(f.snapshot.runId);
      expect(f.updates.some((event) => event.update.sessionUpdate === 'agent_message_chunk')).toBe(
        true
      );
      expect((await f.journal.read(f.snapshot.runId)).outcome?.status).toBe('completed');
      await expect(f.adapter.prompt(f.request)).rejects.toMatchObject({
        code: -32603,
        data: { code: 'harness_run_already_dispatched' },
      });
    } finally {
      await f.adapter.dispose();
    }
  });

  it.each(['length', 'error'] as const)(
    'does not report %s as successful ACP completion',
    async (stopReason) => {
      const f = await fixture([fauxAssistantMessage('Incomplete', { stopReason, timestamp: 1 })]);
      try {
        await expect(f.adapter.prompt(f.request)).rejects.toThrow(
          stopReason === 'error' ? 'harness_failed' : 'harness_interrupted'
        );
        expect((await f.journal.read(f.snapshot.runId)).outcome?.status).toBe(
          stopReason === 'error' ? 'failed' : 'interrupted'
        );
      } finally {
        await f.adapter.dispose();
      }
    }
  );

  it('refuses changed epochs, permission profiles and toolsets before model dispatch', async () => {
    const f = await fixture();
    try {
      for (const changed of [
        { runtimeEpoch: randomUUID() },
        { toolsetHash: '1'.repeat(64) },
        { permissionProfileId: 'other' },
        { sessionId: 'other-session' },
      ]) {
        await expect(
          f.adapter.prompt({
            ...f.request,
            _meta: { mollyRunSnapshot: { ...f.snapshot, ...changed } },
          })
        ).rejects.toThrow('harness_snapshot_mismatch');
      }
      expect(f.messages).toEqual([]);
    } finally {
      await f.adapter.dispose();
    }
  });

  it('preserves an interrupted dispatch fence across journal instances without retrying inference', async () => {
    const f = await fixture();
    try {
      await f.journal.begin(f.snapshot);
      const prior = await f.journal.read(f.snapshot.runId);
      await expect(f.adapter.prompt(f.request)).rejects.toMatchObject({
        code: -32603,
        data: { code: 'harness_run_already_dispatched' },
      });
      expect(f.messages).toEqual([]);
      expect(f.credentialRequests).toEqual([]);
      expect(
        await new RunJournal(join(f.input.privateRoot, 'runs')).read(f.snapshot.runId)
      ).toEqual(prior);
      await expect(
        f.journal.settle(f.snapshot.runId, 'retired-epoch', { status: 'cancelled' })
      ).rejects.toThrow('harness_stale_settlement');
      const next = { ...f.snapshot, runId: randomUUID(), turnId: 'explicit-new-turn' };
      await expect(
        f.adapter.prompt({ ...f.request, _meta: { mollyRunSnapshot: next } })
      ).resolves.toMatchObject({ stopReason: 'end_turn' });
      expect(f.credentialRequests).toEqual([next.runId]);
      expect((await f.journal.read(next.runId)).outcome?.status).toBe('completed');
    } finally {
      await f.adapter.dispose();
    }
  });

  it('keeps a journal directory collision as a storage failure instead of an existing run', async () => {
    const f = await fixture();
    const directory = join(f.input.privateRoot, 'runs');
    try {
      await writeFile(directory, 'existing unrelated file');
      await expect(f.adapter.prompt(f.request)).rejects.toMatchObject({
        code: 'EEXIST',
        syscall: 'mkdir',
      });
      expect(await readFile(directory, 'utf8')).toBe('existing unrelated file');
      expect(f.credentialRequests).toEqual([]);
      expect(f.messages).toEqual([]);
    } finally {
      await f.adapter.dispose();
    }
  });

  it('cancels while a permission UI is unanswered; late approval cannot execute the write', async () => {
    let notify!: () => void;
    const requested = new Promise<void>((resolve) => {
      notify = resolve;
    });
    let allow!: (value: boolean) => void;
    const permission = new Promise<boolean>((resolve) => {
      allow = resolve;
    });
    const f = await fixture(
      [
        fauxAssistantMessage(
          fauxToolCall('write', { path: 'unauthorized.txt', content: 'no' }, { id: 'tool-test' }),
          { stopReason: 'toolUse', timestamp: 1 }
        ),
      ],
      async () => {
        notify();
        return permission;
      }
    );
    try {
      const result = f.adapter.prompt(f.request);
      await requested;
      await f.adapter.cancel({ sessionId: f.request.sessionId });
      expect((await result).stopReason).toBe('cancelled');
      allow(true);
      const { access } = await import('node:fs/promises');
      await expect(access(join(f.input.cwd, 'unauthorized.txt'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect((await f.journal.read(f.snapshot.runId)).outcome?.status).toBe('cancelled');
    } finally {
      allow(false);
      await f.adapter.dispose();
    }
  });
});

it('captures preferences after native completion through the selected model', async () => {
  const captured: unknown[] = [];
  const f = await fixture(
    [
      fauxAssistantMessage('Done', { timestamp: 1 }),
      fauxAssistantMessage('{"changes":[{"text":"Prefers concise explanations."}]}', {
        timestamp: 2,
      }),
    ],
    undefined,
    [],
    undefined,
    undefined,
    async (request) => {
      if (request.operation.action === 'capture') captured.push(request.operation.changes);
      return { enabled: true, revision: 'initial', entries: [] };
    }
  );
  const result = await f.adapter.prompt(f.request);
  expect(result.stopReason).toBe('end_turn');
  expect(captured).toEqual([[{ text: 'Prefers concise explanations.' }]]);
  await f.adapter.dispose();
});

it('recalls preferences in transient system context rather than persisted user history', async () => {
  const f = await fixture(
    [
      fauxAssistantMessage('Done', { timestamp: 1 }),
      fauxAssistantMessage('{"changes":[]}', { timestamp: 2 }),
    ],
    undefined,
    [],
    undefined,
    undefined,
    async () => ({
      enabled: true,
      revision: 'first',
      entries: [{ id: 'preference', text: 'Prefers concise explanations.' }],
    })
  );
  await f.adapter.prompt(f.request);
  expect(f.systemPrompts[0]).toContain('Prefers concise explanations.');
  expect(JSON.stringify(f.messages[0])).not.toContain('Prefers concise explanations.');
  await f.adapter.dispose();
});

it('cancels extraction before a late result can save preferences', async () => {
  let announce: () => void = () => undefined;
  let release: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saved: unknown[] = [];
  const f = await fixture(
    [
      fauxAssistantMessage('Done', { timestamp: 1 }),
      fauxAssistantMessage('{"changes":[{"text":"Prefers blue."}]}', { timestamp: 2 }),
    ],
    undefined,
    [],
    undefined,
    undefined,
    async (request) => {
      if (request.operation.action === 'capture') saved.push(request.operation.changes);
      return { enabled: true, revision: 'initial', entries: [] };
    },
    async (systemPrompt) => {
      if (systemPrompt?.startsWith('Extract only')) {
        announce();
        await held;
      }
    }
  );
  const completion = f.adapter.prompt(f.request);
  await started;
  await f.adapter.cancel({ sessionId: f.request.sessionId });
  release();
  expect((await completion).stopReason).toBe('cancelled');
  expect(saved).toEqual([]);
  await f.adapter.dispose();
});

it('keeps native completion when memory extraction fails and reports the failure separately', async () => {
  const f = await fixture(
    [
      fauxAssistantMessage('Done', { timestamp: 1 }),
      fauxAssistantMessage('invalid JSON', { timestamp: 2 }),
    ],
    undefined,
    [],
    undefined,
    undefined,
    async () => ({ enabled: true, revision: 'initial', entries: [] })
  );
  const result = await f.adapter.prompt(f.request);
  expect(result.stopReason).toBe('end_turn');
  expect(result._meta?.mollyPersonalMemory).toBe('capture_failed');
  await f.adapter.dispose();
});

it('omits a deleted preference from recall on the next turn in the same session', async () => {
  let entries = [{ id: 'preference', text: 'Prefers concise explanations.' }];
  const f = await fixture(
    [
      fauxAssistantMessage('Done', { timestamp: 1 }),
      fauxAssistantMessage('{"changes":[]}', { timestamp: 2 }),
      fauxAssistantMessage('Done again', { timestamp: 3 }),
      fauxAssistantMessage('{"changes":[]}', { timestamp: 4 }),
    ],
    undefined,
    [],
    undefined,
    undefined,
    async () => ({ enabled: true, revision: 'snapshot', entries })
  );
  await f.adapter.prompt(f.request);
  entries = [];
  await f.adapter.prompt({
    ...f.request,
    _meta: { mollyRunSnapshot: { ...f.snapshot, runId: randomUUID(), turnId: 'turn2' } },
  });
  expect(f.systemPrompts[0]).toContain('Prefers concise explanations.');
  expect(f.systemPrompts[2]).not.toContain('Prefers concise explanations.');
  await f.adapter.dispose();
});
