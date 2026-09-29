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
  questionPeer?: Pick<AgentSideConnection, 'unstable_createElicitation' | 'extMethod'>
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
  const sessionInputs: CreateMollySessionInput[] = [];
  const adapter = new MollyAcpAdapter(
    {
      ...questionPeer,
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
          messages.push(context.messages);
          const result: AssistantMessage =
            responses.shift() ??
            fauxAssistantMessage('Unexpected dispatch', { stopReason: 'error', timestamp: 1 });
          const stream = createAssistantMessageEventStream();
          if (result.stopReason === 'error' || result.stopReason === 'aborted') {
            stream.push({ type: 'error', reason: result.stopReason, error: result });
          } else if (result.stopReason !== 'pending')
            stream.push({ type: 'done', reason: result.stopReason, message: result });
          stream.end();
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
    mcpCredentials
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
            mode === 'answered' ? 'User answered: Wide' : 'User cancelled'
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
      fauxAssistantMessage('Done', { timestamp: 3 }),
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
