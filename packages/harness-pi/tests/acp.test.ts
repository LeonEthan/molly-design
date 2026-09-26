import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
import {
  MollyAcpAdapter,
  type McpCredentialProvider,
  type ImageImportProvider,
} from '../src/acp-adapter';
import { mcpToolName } from '../src/mcp-bridge';
import { createApprovedTools, hashToolset } from '../src/approved-tools';
import type { ImageRecoveryProvider } from '../src/image-recovery-tool';
import { RunJournal } from '../src/run-journal';
import { createAutoReviewApproval } from '../src/auto-review';
import { decideAutoReview } from '../src/auto-review-policy';
import { ToolOperationJournal } from '../src/tool-operation-journal';
import {
  MOLLY_BUILTIN_MCP_CONNECTION,
  HARNESS_QUESTION_DISMISS_METHOD,
  HarnessQuestionIdentitySchema,
  MOLLY_PREPARE_MCP_METHOD,
  McpCredentialBindingSchema,
  HarnessSessionBindingSchema,
  type HarnessMcpPreparation,
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
  importImages?: ImageImportProvider,
  recoverImages?: ImageRecoveryProvider,
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
    undefined,
    approve,
    mcpCredentials,
    importImages,
    recoverImages
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
    // Bypass loader validation to exercise the separate production dispatch guard.
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
      const f = await fixture(outputs, undefined, [], undefined, undefined, undefined, {
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
    const f = await fixture(outputs, undefined, [], undefined, undefined, undefined, {
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
  it.each(['allowed', 'denied', 'host-error'] as const)(
    'runs native local recovery without an MCP or image request (%s)',
    async (mode) => {
      const approvals: unknown[] = [];
      const received: unknown[] = [];
      const operationId = 'c'.repeat(64);
      const f = await fixture(
        [
          fauxAssistantMessage(
            fauxToolCall('molly_recover_images', { operationId }, { id: 'recovery' }),
            { stopReason: 'toolUse', timestamp: 1 }
          ),
          fauxAssistantMessage('Recovery inspected', { timestamp: 2 }),
        ],
        async (request) => {
          approvals.push({ name: request.name, arguments: request.arguments });
          return mode !== 'denied';
        },
        [],
        undefined,
        undefined,
        async (request) => {
          received.push(request);
          if (mode === 'host-error') throw new Error('PRIVATE_HOST_DIAGNOSTIC');
          return {
            kind: 'verified',
            operationId,
            sourceTurnId: 'previous-turn',
            assets: [],
            unavailable: [],
          };
        }
      );
      f.snapshot.runId = 'b'.repeat(64);
      try {
        expect((await f.adapter.prompt(f.request)).stopReason).toBe('end_turn');
        expect(approvals).toEqual([{ name: 'molly/recover_images', arguments: { operationId } }]);
        expect(received).toEqual(
          mode === 'denied'
            ? []
            : [
                expect.objectContaining({
                  runId: f.snapshot.runId,
                  runtimeEpoch: f.snapshot.runtimeEpoch,
                  productSessionId: f.snapshot.sessionId,
                  turnId: f.snapshot.turnId,
                  toolCallId: 'recovery',
                  query: { operationId },
                }),
              ]
        );
        if (mode === 'allowed') expect(JSON.stringify(f.messages)).toContain('previous-turn');
        else expect(JSON.stringify(f.messages)).toContain('harness_image_recovery_failed');
        expect(JSON.stringify(f.messages)).not.toContain('PRIVATE_HOST_DIAGNOSTIC');
        await expect(
          readFile(join(f.input.privateRoot, 'operations', `${operationId}.json`))
        ).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await f.adapter.dispose();
      }
    }
  );
  it.each(['wrong-server', 'wrong-fields', 'cancelled'] as const)(
    'refuses %s MCP grants before discovery or inference',
    async (reason) => {
      const destination = {
        transport: 'stdio' as const,
        command: process.execPath,
        args: [fileURLToPath(new URL('./fixtures/protected-mcp.mjs', import.meta.url)), 'first'],
      };
      const binding = McpCredentialBindingSchema.parse({
        workspaceId: 'synthetic-workspace',
        serverId: 'first',
        credentialRef: randomUUID(),
        revision: 1,
        destination,
        fieldNames: ['TEST_MCP_TOKEN'],
      });
      let notifyEntered!: () => void;
      const entered = new Promise<void>((resolve) => {
        notifyEntered = resolve;
      });
      const f = await fixture(
        undefined,
        undefined,
        [
          {
            name: 'first',
            command: destination.command,
            args: destination.args,
            env: [],
            _meta: { mollyConnection: { id: 'first', revision: 1 }, mollyMcpCredential: binding },
          },
        ],
        async (_preparation, signal) => {
          notifyEntered();
          if (reason === 'cancelled')
            await new Promise<never>((_, reject) =>
              signal.addEventListener('abort', () => reject(new Error('SYNTHETIC_SECRET')), {
                once: true,
              })
            );
          const values: Record<string, string> =
            reason === 'wrong-fields'
              ? { WRONG_FIELD: 'SYNTHETIC_SECRET' }
              : { TEST_MCP_TOKEN: 'SYNTHETIC_FIRST' };
          return [
            {
              connection: reason === 'wrong-server' ? { ...binding, serverId: 'second' } : binding,
              values,
            },
          ];
        }
      );
      try {
        const result = f.adapter.extMethod(MOLLY_PREPARE_MCP_METHOD, {
          sessionId: f.request.sessionId,
          preparation: {
            version: 1,
            runId: f.snapshot.runId,
            runtimeEpoch: f.input.runtimeEpoch,
            sessionId: f.input.productSessionId,
            turnId: f.snapshot.turnId,
            workspaceId: f.input.workspaceId,
            connection: f.input.connection,
            mcpConnections: [binding],
          },
        });
        const rejected = expect(result).rejects.toThrow(/^harness_mcp_preparation_failed$/);
        await entered;
        if (reason === 'cancelled') await f.adapter.cancel({ sessionId: f.request.sessionId });
        await rejected;
        expect(f.messages).toEqual([]);
        expect(f.updates).toEqual([]);
        await expect(f.journal.read(f.snapshot.runId)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await f.adapter.dispose();
      }
    }
  );
  it('acquires protected tools only for the prepared run, preserves native history and drops them after settlement', async () => {
    const servers = ['first', 'second'].map((name) => {
      const destination = {
        transport: 'stdio' as const,
        command: process.execPath,
        args: [fileURLToPath(new URL('./fixtures/protected-mcp.mjs', import.meta.url)), name],
      };
      const binding = McpCredentialBindingSchema.parse({
        workspaceId: 'synthetic-workspace',
        serverId: name,
        credentialRef: randomUUID(),
        revision: 1,
        destination,
        fieldNames: ['TEST_MCP_TOKEN'],
      });
      return {
        name,
        command: destination.command,
        args: destination.args,
        env: [],
        _meta: { mollyConnection: { id: name, revision: 1 }, mollyMcpCredential: binding },
      };
    });
    const acquisitions: string[] = [];
    const f = await fixture(
      [
        fauxAssistantMessage(
          servers.map((server) =>
            fauxToolCall(mcpToolName(server.name, 'inspect'), {}, { id: server.name })
          ),
          { stopReason: 'toolUse', timestamp: 1 }
        ),
        fauxAssistantMessage('Both isolated', { timestamp: 2 }),
        fauxAssistantMessage('Second turn', { timestamp: 3 }),
      ],
      async () => true,
      servers,
      async (preparation) => {
        acquisitions.push(preparation.runId);
        return preparation.mcpConnections.map((connection, index) => ({
          connection,
          values: { TEST_MCP_TOKEN: index === 0 ? 'SYNTHETIC_FIRST' : 'SYNTHETIC_SECOND' },
        }));
      }
    );
    const preparation: HarnessMcpPreparation = {
      version: 1,
      runId: f.snapshot.runId,
      runtimeEpoch: f.input.runtimeEpoch,
      sessionId: f.input.productSessionId,
      turnId: f.snapshot.turnId,
      workspaceId: f.input.workspaceId,
      connection: f.input.connection,
      mcpConnections: servers.map((server) => server._meta.mollyMcpCredential),
    };
    try {
      expect(acquisitions).toEqual([]);
      await expect(f.adapter.prompt(f.request)).rejects.toThrow('harness_snapshot_mismatch');
      const prepared = HarnessSessionBindingSchema.parse(
        await f.adapter.extMethod(MOLLY_PREPARE_MCP_METHOD, {
          sessionId: f.request.sessionId,
          preparation,
        })
      );
      expect(f.adapter.currentSessionId).toBe(f.request.sessionId);
      expect(prepared.toolsetHash).not.toBe(f.snapshot.toolsetHash);
      f.snapshot.toolsetHash = prepared.toolsetHash;
      f.snapshot.mcpConnections = preparation.mcpConnections;
      expect((await f.adapter.prompt(f.request)).stopReason).toBe('end_turn');
      expect(
        f.updates
          .filter(({ update }) => update.sessionUpdate === 'tool_call_update')
          .map(({ update }) => update)
      ).toMatchObject([
        { status: 'completed', rawOutput: { content: [{ text: 'credential-isolation-ok' }] } },
        { status: 'completed', rawOutput: { content: [{ text: 'credential-isolation-ok' }] } },
      ]);
      const history = await readFile(prepared.nativeSessionFile, 'utf8');
      expect(history).toContain('Both isolated');
      for (const canary of ['SYNTHETIC_FIRST', 'SYNTHETIC_SECOND']) {
        expect(
          JSON.stringify({
            updates: f.updates,
            messages: f.messages,
            journal: await f.journal.read(f.snapshot.runId),
          })
        ).not.toContain(canary);
        expect(history).not.toContain(canary);
      }
      await expect(f.adapter.prompt(f.request)).rejects.toThrow('harness_snapshot_mismatch');
      const next = { ...preparation, runId: randomUUID(), turnId: 'turn2' };
      const rebound = HarnessSessionBindingSchema.parse(
        await f.adapter.extMethod(MOLLY_PREPARE_MCP_METHOD, {
          sessionId: f.request.sessionId,
          preparation: next,
        })
      );
      expect(rebound.nativeSessionFile).toBe(prepared.nativeSessionFile);
      Object.assign(f.snapshot, {
        runId: next.runId,
        turnId: next.turnId,
        toolsetHash: rebound.toolsetHash,
      });
      expect((await f.adapter.prompt(f.request)).stopReason).toBe('end_turn');
      expect(JSON.stringify(f.messages.at(-1))).toContain('Both isolated');
      expect(acquisitions).toEqual([preparation.runId, next.runId]);
      await expect(
        f.adapter.extMethod(MOLLY_PREPARE_MCP_METHOD, {
          sessionId: f.request.sessionId,
          preparation: next,
        })
      ).rejects.toThrow('harness_mcp_preparation_failed');
      expect(acquisitions).toEqual([preparation.runId, next.runId]);
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
  it.each([
    { mode: '--lose-response', state: 'outcome_unknown' },
    { mode: '--reject-image', state: 'failed' },
  ])(
    'returns $mode to the model as a tool result and continues native inference',
    async ({ mode, state }) => {
      const responses = [
        fauxAssistantMessage(
          fauxToolCall('molly_generate_image', { prompt: 'Synthetic' }, { id: 'unknown-image' }),
          { stopReason: 'toolUse', timestamp: 1 }
        ),
        fauxAssistantMessage('Agent decides after the tool error', { timestamp: 2 }),
      ];
      const f = await fixture(responses, async () => true, [
        {
          name: 'molly',
          command: process.execPath,
          args: [fileURLToPath(new URL('./fixtures/image-mcp.mjs', import.meta.url)), mode],
          env: [],
          _meta: { mollyConnection: MOLLY_BUILTIN_MCP_CONNECTION },
        },
      ]);
      f.snapshot.imageConnection = {
        id: randomUUID(),
        revision: 1,
        enabled: true,
        baseUrl: 'https://image.example/v1',
        model: 'synthetic-image',
        hasApiKey: true,
        legacyHistoryMayContainKey: false,
      };
      try {
        expect((await f.adapter.prompt(f.request)).stopReason).toBe('end_turn');
        expect(responses).toEqual([]);
        expect(f.messages.at(-1)).toContainEqual(
          expect.objectContaining({ role: 'toolResult', toolCallId: 'unknown-image' })
        );
        const operations = new ToolOperationJournal(join(f.input.privateRoot, 'operations'));
        expect(
          (await operations.read(operations.operationId(f.snapshot.runId, 'unknown-image'))).state
        ).toBe(state);
      } finally {
        await f.adapter.dispose();
      }
    }
  );
  it('journals built-in image dispatch against the frozen image connection, not the MCP catalog', async () => {
    const toolCallId = 'synthetic-image-call';
    const f = await fixture(
      [
        fauxAssistantMessage(
          fauxToolCall('molly_generate_image', { prompt: 'Synthetic' }, { id: toolCallId }),
          { stopReason: 'toolUse', timestamp: 1 }
        ),
        fauxAssistantMessage('Done', { timestamp: 2 }),
      ],
      async () => true,
      [
        {
          name: 'molly',
          command: process.execPath,
          args: [fileURLToPath(new URL('./fixtures/image-mcp.mjs', import.meta.url))],
          env: [],
          _meta: { mollyConnection: MOLLY_BUILTIN_MCP_CONNECTION },
        },
      ]
    );
    f.snapshot.imageConnection = {
      id: randomUUID(),
      revision: 7,
      enabled: true,
      baseUrl: 'https://image.example/v1',
      model: 'synthetic-image',
      hasApiKey: true,
      legacyHistoryMayContainKey: false,
    };
    try {
      expect((await f.adapter.prompt(f.request)).stopReason).toBe('end_turn');
      const operations = new ToolOperationJournal(join(f.input.privateRoot, 'operations'));
      expect(
        await operations.read(operations.operationId(f.snapshot.runId, toolCallId))
      ).toMatchObject({
        state: 'succeeded',
        connectionId: f.snapshot.imageConnection.id,
        connectionRevision: 7,
        toolName: 'molly_generate_image',
      });
    } finally {
      await f.adapter.dispose();
    }
  });
  it.each([
    { mode: '--reject-image', state: 'failed' },
    { mode: '--bad-image', state: 'outcome_unknown' },
    { mode: '--resource-mismatch', state: 'outcome_unknown' },
    { mode: '--resource-lost', state: 'outcome_unknown' },
  ])(
    'returns external paid $mode to the model as a tool error without an automatic retry',
    async ({ mode, state }) => {
      const callId = 'external-paid-call';
      const responses = [
        fauxAssistantMessage(
          fauxToolCall(
            mcpToolName('external-images', 'molly_generate_image'),
            { prompt: 'Synthetic' },
            { id: callId }
          ),
          { stopReason: 'toolUse', timestamp: 1 }
        ),
        fauxAssistantMessage('Agent decides after the tool error', { timestamp: 2 }),
      ];
      const f = await fixture(responses, async () => true, [
        {
          name: 'external-images',
          command: process.execPath,
          args: [fileURLToPath(new URL('./fixtures/image-mcp.mjs', import.meta.url)), mode],
          env: [],
          _meta: {
            mollyConnection: { id: 'external-images', revision: 4 },
            mollyImageBinding: {
              version: 1,
              model: 'synthetic-image',
              generate: {
                tool: 'molly_generate_image',
                fields: { prompt: 'prompt', model: 'model' },
              },
            },
          },
        },
      ]);
      try {
        expect((await f.adapter.prompt(f.request)).stopReason).toBe('end_turn');
        expect(responses).toEqual([]);
        const operations = new ToolOperationJournal(join(f.input.privateRoot, 'operations'));
        expect(
          await operations.read(operations.operationId(f.snapshot.runId, callId))
        ).toMatchObject({
          state,
          connectionId: 'external-images',
          connectionRevision: 4,
          assetDigests: [],
        });
      } finally {
        await f.adapter.dispose();
      }
    }
  );
  it.each(
    ([false, true] as const).flatMap((builtin) =>
      (
        [
          'imported',
          'host-refused',
          'no-image',
          ...(!builtin ? (['linked', 'linked-denied', 'linked-host-refused'] as const) : []),
        ] as const
      ).map((outcome) => ({ builtin, outcome }))
    )
  )(
    'settles image import through the owning host before the Agent continues (builtin=$builtin, $outcome)',
    async ({ builtin, outcome }) => {
      const serverName = builtin ? 'molly' : 'external-images';
      const connectionId = builtin ? '00000000-0000-4000-8000-000000000001' : 'external-images';
      const responses = [
        fauxAssistantMessage(
          fauxToolCall(
            mcpToolName(serverName, 'molly_generate_image'),
            { prompt: 'Synthetic' },
            { id: 'import-call' }
          ),
          { stopReason: 'toolUse', timestamp: 1 }
        ),
        fauxAssistantMessage('Imported', { timestamp: 2 }),
      ];
      const received: unknown[] = [];
      const approvals: string[] = [];
      const linked = outcome.startsWith('linked');
      const succeeded = outcome === 'imported' || outcome === 'linked';
      const sha256 = 'a'.repeat(64);
      const asset = {
        path: `media/${sha256}.png`,
        absolutePath: `/synthetic/media/${sha256}.png`,
        sha256,
        mimeType: 'image/png' as const,
        width: 1,
        height: 1,
        bytes: 68,
      };
      const f = await fixture(
        responses,
        async ({ name }) => {
          approvals.push(name);
          return !(outcome === 'linked-denied' && name.endsWith('/resources/read'));
        },
        [
          {
            name: serverName,
            command: process.execPath,
            args: [
              fileURLToPath(new URL('./fixtures/image-mcp.mjs', import.meta.url)),
              ...(outcome === 'no-image' ? [] : [linked ? '--resource' : '--inline-image']),
              ...(builtin ? ['--managed-inline'] : []),
            ],
            env: [],
            _meta: {
              mollyConnection: builtin
                ? MOLLY_BUILTIN_MCP_CONNECTION
                : { id: 'external-images', revision: 4 },
              ...(builtin
                ? {}
                : {
                    mollyImageBinding: {
                      version: 1,
                      model: 'synthetic-image',
                      generate: {
                        tool: 'molly_generate_image',
                        fields: { prompt: 'prompt', model: 'model' },
                      },
                    },
                  }),
            },
          },
        ],
        undefined,
        async (request, signal) => {
          signal.throwIfAborted();
          received.push(request);
          if (outcome === 'host-refused' || outcome === 'linked-host-refused')
            throw new Error('SYNTHETIC_SECRET_MUST_NOT_PERSIST');
          return { assets: [asset] };
        }
      );
      f.snapshot.runId = 'b'.repeat(64);
      if (builtin)
        f.snapshot.imageConnection = {
          id: connectionId,
          revision: 4,
          enabled: true,
          baseUrl: 'https://images.invalid/v1',
          model: 'synthetic-image',
          hasApiKey: true,
          legacyHistoryMayContainKey: false,
        };
      try {
        expect((await f.adapter.prompt(f.request)).stopReason).toBe('end_turn');
        if (succeeded) expect(JSON.stringify(f.messages)).toContain(asset.absolutePath);
        expect(received).toEqual(
          outcome === 'no-image' || outcome === 'linked-denied'
            ? []
            : [
                expect.objectContaining({
                  runId: f.snapshot.runId,
                  runtimeEpoch: f.input.runtimeEpoch,
                  productSessionId: f.input.productSessionId,
                  turnId: f.snapshot.turnId,
                  connectionId,
                  connectionRevision: 4,
                  serverName,
                  toolName: 'molly_generate_image',
                  toolCallId: 'import-call',
                  requestDigest: createHash('sha256')
                    .update(
                      JSON.stringify({
                        prompt: 'Synthetic',
                        ...(builtin ? {} : { model: 'synthetic-image' }),
                      })
                    )
                    .digest('hex'),
                  images: [
                    {
                      mimeType: 'image/png',
                      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
                    },
                  ],
                }),
              ]
        );
        const operations = new ToolOperationJournal(join(f.input.privateRoot, 'operations'));
        expect(
          await operations.read(operations.operationId(f.snapshot.runId, 'import-call'))
        ).toMatchObject({
          state: succeeded ? 'succeeded' : 'outcome_unknown',
          ...(!succeeded
            ? { failureStage: outcome === 'linked-denied' ? 'dispatch' : 'import' }
            : {}),
          connectionId,
          connectionRevision: 4,
          assetDigests: succeeded ? [sha256] : [],
        });
        expect(responses).toEqual([]);
        expect(
          await readFile(
            join(
              f.input.privateRoot,
              'operations',
              `${operations.operationId(f.snapshot.runId, 'import-call')}.json`
            ),
            'utf8'
          )
        ).not.toContain('SYNTHETIC_SECRET_MUST_NOT_PERSIST');
        expect(approvals).toEqual([
          `${serverName}/molly_generate_image`,
          ...(linked ? [`${serverName}/resources/read`] : []),
        ]);
        if (linked) {
          const resourceCallId = createHash('sha256')
            .update(JSON.stringify(['resource', 'import-call', 0]))
            .digest('hex');
          const resourceId = operations.operationId(f.snapshot.runId, resourceCallId);
          if (outcome === 'linked-denied')
            await expect(operations.read(resourceId)).rejects.toMatchObject({ code: 'ENOENT' });
          else
            expect(await operations.read(resourceId)).toMatchObject({
              parentOperationId: operations.operationId(f.snapshot.runId, 'import-call'),
              connectionId,
              connectionRevision: 4,
              toolName: 'resources/read',
              state: 'succeeded',
            });
        }
        expect(JSON.stringify(f.messages)).not.toContain('SYNTHETIC_SECRET_MUST_NOT_PERSIST');
      } finally {
        await f.adapter.dispose();
      }
    }
  );
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
      await expect(f.adapter.prompt(f.request)).rejects.toMatchObject({ code: 'EEXIST' });
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
      await expect(f.adapter.prompt(f.request)).rejects.toMatchObject({ code: 'EEXIST' });
      expect(f.messages).toEqual([]);
      expect(
        (await new RunJournal(join(f.input.privateRoot, 'runs')).read(f.snapshot.runId)).state
      ).toBe('dispatched');
      await expect(
        f.journal.settle(f.snapshot.runId, 'retired-epoch', { status: 'cancelled' })
      ).rejects.toThrow('harness_stale_settlement');
    } finally {
      await f.adapter.dispose();
    }
  });

  it('cancels an image resource approval without reading, importing or continuing inference', async () => {
    let notifyRequested!: () => void;
    const requested = new Promise<void>((resolve) => {
      notifyRequested = resolve;
    });
    let allowResource!: (allowed: boolean) => void;
    const permission = new Promise<boolean>((resolve) => {
      allowResource = resolve;
    });
    const responses = [
      fauxAssistantMessage(
        fauxToolCall(
          mcpToolName('images', 'molly_generate_image'),
          { prompt: 'Synthetic' },
          { id: 'image-call' }
        ),
        { stopReason: 'toolUse', timestamp: 1 }
      ),
      fauxAssistantMessage('Must remain unconsumed', { timestamp: 2 }),
    ];
    const imports: unknown[] = [];
    const f = await fixture(
      responses,
      async ({ name }) => {
        if (name.endsWith('/resources/read')) {
          notifyRequested();
          return permission;
        }
        return true;
      },
      [
        {
          name: 'images',
          command: process.execPath,
          env: [],
          args: [fileURLToPath(new URL('./fixtures/image-mcp.mjs', import.meta.url)), '--resource'],
          _meta: {
            mollyConnection: { id: 'images', revision: 1 },
            mollyImageBinding: {
              version: 1,
              model: 'synthetic-image',
              generate: {
                tool: 'molly_generate_image',
                fields: { prompt: 'prompt', model: 'model' },
              },
            },
          },
        },
      ],
      undefined,
      async (request) => {
        imports.push(request);
        throw new Error('must not import');
      }
    );
    try {
      const pending = expect(f.adapter.prompt(f.request)).resolves.toMatchObject({
        stopReason: 'cancelled',
      });
      await requested;
      await f.adapter.cancel({ sessionId: f.request.sessionId });
      await pending;
      allowResource(true);
      const journal = new ToolOperationJournal(join(f.input.privateRoot, 'operations'));
      const parent = journal.operationId(f.snapshot.runId, 'image-call');
      expect((await journal.read(parent)).state).toBe('outcome_unknown');
      const childCall = createHash('sha256')
        .update(JSON.stringify(['resource', 'image-call', 0]))
        .digest('hex');
      await expect(
        journal.read(journal.operationId(f.snapshot.runId, childCall))
      ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(imports).toEqual([]);
      expect(responses.map((r) => r.content)).toEqual([
        [{ type: 'text', text: 'Must remain unconsumed' }],
      ]);
    } finally {
      allowResource(false);
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
