import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import { SESSION_FILE_MAX_COUNT, getSessionRoomId, type SessionId } from '@molly/shared';
import {
  LocalDaemonAvailabilityError,
  WORKSPACE_SYNC_UNAVAILABLE_MESSAGE,
  WorkspaceSyncUnavailableError,
} from '@/lib/command-runtime';
import type { LoroDocumentManager } from '@/lib/loro/doc';
import {
  getMollyOperationStorePath,
  MollyOperationStoreError,
} from '@/orchestration/operation-store';

import {
  __mollyMcpServerInternals,
  buildMollyMcpServer,
  runWithMcpSessionContext,
} from './molly-mcp-server';

const {
  FileUploadToolInputSchema,
  SessionCreateOptionsToolInputSchema,
  SessionCreateToolInputSchema,
  SessionCreateManyToolInputSchema,
  SessionChatToolInputSchema,
  SessionChatManyToolInputSchema,
  SessionCancelToolInputSchema,
  SessionHistoryToolInputSchema,
  SessionListToolInputSchema,
  SessionRenameToolInputSchema,
  SessionRenameManyToolInputSchema,
  SessionStatusManyToolInputSchema,
  mcpErrorResult,
  assertDifferentMcpSession,
  assertBatchSize,
  resolveSessionRenameItems,
  applySessionRenameItems,
  persistSessionRenameItems,
  buildWaitErrorResponse,
  buildMcpCreateOptions,
  bindMcpCreateContext,
  buildMcpTurnDispatchConfig,
  resolveMcpSessionCreate,
  buildOperationTargetCancelArgs,
  summarizeAgentConfig,
  getSessionContext,
  resolveOperationStorePathForContext,
  resolveUploadPath,
  buildInvocationIdentity,
  summarizeProjectRefForMcp,
  resolveSessionExecutionSnapshot,
  makeMachineOnlineLookupForMcp,
  truncateUtf8HeadTail,
} = __mollyMcpServerInternals;

const createMcpContext = (): ReturnType<typeof getSessionContext> => ({
  machineId: 'machine-id',
  workspaceId: 'workspace-id',
  sessionId: 'current-session-id',
  localControlSocketPath: '/tmp/lody-control.sock',
  workdir: '/tmp/workspace',
});

describe('shared Operation store path', () => {
  // Regression: the daemon-hosted HTTP MCP transport carries its session
  // context in AsyncLocalStorage and its process has no MOLLY_MCP_MACHINE_ID,
  // so an env-derived store path silently falls back to the 'local' store that
  // no daemon coordinator reconciles — accepted Operations never finish and
  // the requester Session never receives its completion turn.
  it('resolves the coordinator-visible store from the context machineId without env', () => {
    const savedEnv = {
      MOLLY_MCP_MACHINE_ID: process.env.MOLLY_MCP_MACHINE_ID,
      MOLLY_PREVIEW_MCP_MACHINE_ID: process.env.MOLLY_PREVIEW_MCP_MACHINE_ID,
    };
    delete process.env.MOLLY_MCP_MACHINE_ID;
    delete process.env.MOLLY_PREVIEW_MCP_MACHINE_ID;
    try {
      const context = { ...createMcpContext(), machineId: 'http-host-machine-id' };
      const storePath = runWithMcpSessionContext(context, () =>
        resolveOperationStorePathForContext()
      );
      // Same path the daemon coordinator opens for this machine id...
      expect(storePath).toBe(getMollyOperationStorePath(context.machineId));
      // ...and NOT the legacy 'local'-keyed store nobody reconciles.
      expect(storePath).not.toBe(getMollyOperationStorePath('local'));
    } finally {
      for (const [name, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

const listPublishedToolNames = async (): Promise<string[]> => {
  const server = buildMollyMcpServer();
  const client = new Client({ name: 'tool-list-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return (await client.listTools()).tools.map((tool) => tool.name);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
};

describe('Molly developer workflow retirement', () => {
  it('publishes generic session tools without retired review and Task tools', async () => {
    const names = await listPublishedToolNames();
    expect(names).not.toContain('lody_review_submit');
    expect(names.filter((name) => name.startsWith('molly_task_'))).toEqual([]);
    expect(names).toContain('molly_session_list');
    expect(names).toContain('molly_session_history');
  });
});

describe('molly_upload_files input schema', () => {
  it('accepts 1..N file paths', () => {
    expect(FileUploadToolInputSchema.safeParse({ paths: ['a.log'] }).success).toBe(true);
    const max = Array.from({ length: SESSION_FILE_MAX_COUNT }, (_, index) => `f${index}.bin`);
    expect(FileUploadToolInputSchema.safeParse({ paths: max }).success).toBe(true);
  });

  it('rejects empty, oversized, blank, and unknown inputs', () => {
    expect(FileUploadToolInputSchema.safeParse({ paths: [] }).success).toBe(false);
    const tooMany = Array.from(
      { length: SESSION_FILE_MAX_COUNT + 1 },
      (_, index) => `f${index}.bin`
    );
    expect(FileUploadToolInputSchema.safeParse({ paths: tooMany }).success).toBe(false);
    expect(FileUploadToolInputSchema.safeParse({ paths: ['  '] }).success).toBe(false);
    expect(FileUploadToolInputSchema.safeParse({ paths: ['a'], extra: 1 }).success).toBe(false);
  });
});

describe('resolveUploadPath', () => {
  it('keeps absolute paths and resolves relative ones against the workdir', () => {
    const workdir = '/tmp/workspace';
    expect(resolveUploadPath('/abs/x.txt', workdir)).toBe('/abs/x.txt');
    expect(resolveUploadPath('sub/x.txt', workdir)).toBe(path.join(workdir, 'sub/x.txt'));
  });
});

describe('session MCP input schemas', () => {
  it('preserves retryable daemon overload errors at the MCP boundary', () => {
    const result = mcpErrorResult(
      new LocalDaemonAvailabilityError({
        code: 'DAEMON_BUSY',
        message: 'daemon busy',
        retryable: true,
      })
    );
    const content = result.content[0];
    if (!content || content.type !== 'text') throw new Error('expected text result');
    expect(JSON.parse(content.text)).toEqual({
      ok: false,
      error: { code: 'DAEMON_BUSY', message: 'daemon busy', retryable: true },
    });
    expect(result.isError).toBe(true);
  });

  it('reports workspace sync failures as retryable at the MCP boundary', () => {
    const result = mcpErrorResult(
      new WorkspaceSyncUnavailableError({
        message: 'sync failed; use --offline',
        cause: new Error('transport unavailable'),
      })
    );
    const content = result.content[0];
    if (!content || content.type !== 'text') throw new Error('expected text result');
    expect(JSON.parse(content.text)).toEqual({
      ok: false,
      error: {
        code: 'SYNC_UNAVAILABLE',
        message: WORKSPACE_SYNC_UNAVAILABLE_MESSAGE,
        retryable: true,
      },
    });
    expect(result.isError).toBe(true);
  });

  it('keeps unknown MCP failures nonretryable', () => {
    const result = mcpErrorResult(new Error('unexpected failure'));
    const content = result.content[0];
    if (!content || content.type !== 'text') throw new Error('expected text result');
    expect(JSON.parse(content.text)).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'unexpected failure',
        retryable: false,
      },
    });
    expect(result.isError).toBe(true);
  });

  it('derives delegated identity from the exact driving Turn', () => {
    expect(
      buildInvocationIdentity({ id: 'source-turn', userId: 'collaborator-b', inputConfig: {} })
    ).toEqual({ userId: 'collaborator-b', sourceTurnId: 'source-turn' });
    expect(() =>
      buildInvocationIdentity({ id: 'legacy-turn', userId: ' ', inputConfig: {} })
    ).toThrow('has no authenticated human identity');
  });

  it('uses stable ids and rejects legacy selector names', () => {
    expect(SessionCreateOptionsToolInputSchema.safeParse({ machineId: 'machine-id' }).success).toBe(
      true
    );
    expect(
      SessionCreateOptionsToolInputSchema.safeParse({
        agentConfigQuery: 'codex',
        localProjectQuery: 'lody',
      }).success
    ).toBe(true);
    expect(SessionCreateOptionsToolInputSchema.safeParse({ machine: 'local' }).success).toBe(false);
    expect(
      SessionCreateToolInputSchema.safeParse({
        operationId: 'review-1',
        prompt: 'review this',
        machineId: 'machine-id',
        agentConfigId: 'agent-config-id',
        workContext: {
          kind: 'local',
          projectId: 'project-id',
          branch: 'feature/session-orchestration',
          worktree: true,
        },
      }).success
    ).toBe(true);
    expect(
      SessionCreateToolInputSchema.safeParse({
        prompt: 'review this',
        requestId: 'request-1',
      }).success
    ).toBe(false);
    expect(
      SessionCreateToolInputSchema.safeParse({
        prompt: 'review this',
        workContext: { kind: 'local', project: 'project-id' },
      }).success
    ).toBe(false);
    expect(
      SessionCreateToolInputSchema.safeParse({
        prompt: 'review this',
        workContext: { repo: 'loro-dev/lody' },
      }).success
    ).toBe(false);
    expect(
      SessionCreateToolInputSchema.safeParse({
        operationId: 'reject-github',
        prompt: 'review this',
        workContext: { kind: 'github', repo: 'loro-dev/lody' },
      }).success
    ).toBe(false);
    expect(
      SessionCreateToolInputSchema.safeParse({
        prompt: 'review this',
        parentSessionId: 'other-session',
      }).success
    ).toBe(false);
    expect(
      SessionCreateToolInputSchema.safeParse({
        operationId: 'review-1',
        prompt: 'review this',
        useCurrentSessionAsParent: true,
        workContext: { kind: 'chat' },
      }).success
    ).toBe(false);
    expect(
      SessionCreateToolInputSchema.safeParse({
        operationId: 'review-1',
        resume: true,
      }).success
    ).toBe(true);
    expect(
      SessionCreateToolInputSchema.safeParse({
        operationId: 'review-1',
        resume: true,
        prompt: 'must not be resent',
      }).success
    ).toBe(false);
  });

  it('publishes session create work contexts and child workspace sharing over MCP', async () => {
    const server = new McpServer({ name: 'schema-test-server', version: '1.0.0' });
    server.registerTool(
      'molly_session_create',
      { inputSchema: SessionCreateToolInputSchema },
      async () => ({ content: [] })
    );
    server.registerTool(
      'molly_session_create_many',
      { inputSchema: SessionCreateManyToolInputSchema },
      async () => ({ content: [] })
    );
    const client = new Client({ name: 'schema-test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.listTools();
      const createTool = result.tools.find((tool) => tool.name === 'molly_session_create');
      const createManyTool = result.tools.find((tool) => tool.name === 'molly_session_create_many');

      const workContextSchema = {
        oneOf: expect.arrayContaining([
          expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({ kind: { const: 'chat', type: 'string' } }),
          }),
          expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              kind: { const: 'local', type: 'string' },
              projectId: expect.objectContaining({ type: 'string' }),
            }),
          }),
        ]),
      };

      expect(createTool?.inputSchema).toMatchObject({
        type: 'object',
        properties: {
          useCurrentSessionAsParent: {
            description:
              'Create a child of the current Session that reuses the exact same workspace directory; cannot be combined with workContext.',
          },
          workContext: workContextSchema,
        },
      });
      expect(createManyTool?.inputSchema).toMatchObject({
        type: 'object',
        properties: {
          defaults: {
            type: 'object',
            properties: {
              useCurrentSessionAsParent: {
                description:
                  'Create a child of the current Session that reuses the exact same workspace directory; cannot be combined with workContext.',
              },
              workContext: workContextSchema,
            },
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                useCurrentSessionAsParent: {
                  description:
                    'Create a child of the current Session that reuses the exact same workspace directory; cannot be combined with workContext.',
                },
                workContext: workContextSchema,
              },
            },
          },
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('maps stable ids and current-parent semantics into the shared CLI core', () => {
    const options = buildMcpCreateOptions(
      {
        operationId: 'review-1',
        prompt: 'review this',
        machineId: 'machine-id',
        agentConfigId: 'agent-config-id',
        useCurrentSessionAsParent: true,
      },
      createMcpContext()
    );
    bindMcpCreateContext(
      options,
      {
        userId: 'collaborator-b',
        sourceTurnId: 'source-turn',
      },
      { machineId: 'machine-id' }
    );

    expect(options).toMatchObject({
      workspace: 'workspace-id',
      currentSessionId: 'current-session-id',
      machine: 'machine-id',
      agentConfig: 'agent-config-id',
      useCurrentSessionAsParent: true,
      delegatedRequester: { userId: 'collaborator-b' },
      defaultMachineId: 'machine-id',
    });
  });

  it('accepts semantic run config on single and batch creates and rejects raw ACP ids', () => {
    expect(
      SessionCreateToolInputSchema.safeParse({
        operationId: 'review-1',
        prompt: 'review this',
        modelId: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        fastMode: true,
        planMode: false,
      }).success
    ).toBe(true);
    expect(
      SessionCreateToolInputSchema.safeParse({
        operationId: 'review-1',
        prompt: 'review this',
        configOptionValues: { reasoning_effort: 'high' },
      }).success
    ).toBe(false);
    expect(
      SessionCreateToolInputSchema.safeParse({
        operationId: 'review-1',
        prompt: 'review this',
        fastMode: 'on',
      }).success
    ).toBe(false);
    expect(
      SessionCreateManyToolInputSchema.safeParse({
        operationId: 'review-batch-1',
        defaults: { reasoningEffort: 'high' },
        items: [{ prompt: 'review this', planMode: true }],
      }).success
    ).toBe(true);
    expect(
      SessionCreateManyToolInputSchema.safeParse({
        operationId: 'review-batch-2',
        items: [
          {
            prompt: 'review this',
            useCurrentSessionAsParent: true,
            workContext: { kind: 'chat' },
          },
        ],
      }).success
    ).toBe(false);
    expect(
      SessionCreateManyToolInputSchema.safeParse({
        operationId: 'review-batch-default-parent',
        defaults: { useCurrentSessionAsParent: true },
        items: [{ prompt: 'review this', workContext: { kind: 'chat' } }],
      }).success
    ).toBe(false);
    expect(
      SessionCreateManyToolInputSchema.safeParse({
        operationId: 'review-batch-override-parent',
        defaults: { useCurrentSessionAsParent: true },
        items: [
          {
            prompt: 'review this',
            useCurrentSessionAsParent: false,
            workContext: { kind: 'chat' },
          },
        ],
      }).success
    ).toBe(true);
    expect(
      SessionCreateManyToolInputSchema.safeParse({
        operationId: 'review-batch-default-context',
        defaults: { workContext: { kind: 'chat' } },
        items: [{ prompt: 'review this', useCurrentSessionAsParent: true }],
      }).success
    ).toBe(false);
  });

  it.each([{ mcpServerIds: [] }, { mcpServerIds: ['synthetic-causal-mcp'] }])(
    'freezes ordinary create MCP selection from the invoking turn %#',
    ({ mcpServerIds }) => {
      const expected = [...mcpServerIds];
      const resolved = resolveMcpSessionCreate(
        { operationId: 'synthetic-create', prompt: 'Synthetic task' },
        {
          chainDepth: 0,
          frozenInputConfig: { cliType: 'builtin', agentType: 'molly', mcpServerIds },
        }
      );
      mcpServerIds.push('later-mcp');
      expect(resolved.dispatchConfig.mcpServerIds).toEqual(expected);
    }
  );

  it('rejects retired Role arguments for new single and batch creates', () => {
    const single = { operationId: 'synthetic-create', prompt: 'Synthetic task' };
    expect(SessionCreateToolInputSchema.safeParse(single).success).toBe(true);
    expect(
      SessionCreateToolInputSchema.safeParse({ ...single, agentRoleId: 'retired-role' }).success
    ).toBe(false);
    for (const request of [
      {
        operationId: 'synthetic-batch',
        defaults: { agentRoleId: 'retired-role' },
        items: [{ prompt: 'Synthetic task' }],
      },
      {
        operationId: 'synthetic-batch',
        items: [{ prompt: 'Synthetic task', agentRoleId: 'retired-role' }],
      },
    ]) {
      expect(SessionCreateManyToolInputSchema.safeParse(request).success).toBe(false);
    }
    expect(
      SessionCreateToolInputSchema.safeParse({ operationId: 'previously-accepted', resume: true })
        .success
    ).toBe(true);
  });

  it('defers run config to capability resolution instead of guessing ACP option ids', () => {
    expect(
      buildMcpTurnDispatchConfig({
        modelId: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        planMode: true,
      })
    ).toEqual({
      modeId: undefined,
      modelId: undefined,
      configOptionValues: undefined,
      runConfig: { modelId: 'gpt-5.6-sol', reasoningEffort: 'high', planMode: true },
    });
    expect(buildMcpTurnDispatchConfig({})).toEqual({
      modeId: undefined,
      modelId: undefined,
      configOptionValues: undefined,
    });
  });

  it('reports the run config choices an agent supports next to its stable id', () => {
    expect(
      summarizeAgentConfig(
        {
          id: 'agent-config-id',
          machineId: 'machine-id',
          name: 'Codex',
          cliType: 'builtin',
          agentType: 'codex',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
        {
          cliType: 'builtin',
          agentType: 'codex',
          modes: [],
          models: [],
          configOptions: [
            {
              id: 'model',
              name: 'Model',
              category: 'model',
              type: 'select',
              currentValue: 'gpt-5.6-sol',
              options: [{ value: 'gpt-5.6-sol', name: 'GPT-5.6-Sol' }],
            },
            {
              id: 'reasoning_effort',
              name: 'Reasoning effort',
              category: 'thought_level',
              type: 'select',
              currentValue: 'medium',
              options: [{ value: 'high', name: 'High' }],
            },
          ],
          fetchedAt: 1,
        }
      ).runConfig
    ).toEqual({
      models: [{ id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol' }],
      reasoningEffortValues: ['high'],
      measuredForModelId: 'gpt-5.6-sol',
      fastMode: false,
      planMode: false,
    });
  });

  it('returns local work contexts with the same projectId field accepted by create', () => {
    const workContext = summarizeProjectRefForMcp({
      kind: 'local',
      localProjectId: 'project-id',
      branch: 'feature/session-orchestration',
      useWorktree: true,
    });

    expect(workContext).toEqual({
      kind: 'local',
      projectId: 'project-id',
      branch: 'feature/session-orchestration',
      worktree: true,
    });
    expect(
      SessionCreateToolInputSchema.safeParse({
        operationId: 'continue-1',
        prompt: 'continue',
        workContext,
      }).success
    ).toBe(true);
  });

  it('requires explicit chat and cancel targets and bounds list/history output', () => {
    expect(SessionChatToolInputSchema.safeParse({ prompt: 'follow up' }).success).toBe(false);
    expect(
      SessionChatToolInputSchema.safeParse({ sessionId: 'target-session', prompt: 'follow up' })
        .success
    ).toBe(false);
    expect(
      SessionChatToolInputSchema.safeParse({
        operationId: 'follow-up-1',
        sessionId: 'target-session',
        prompt: 'follow up',
      }).success
    ).toBe(true);
    expect(SessionCancelToolInputSchema.safeParse({ sessionId: 'target-session' }).success).toBe(
      true
    );
    expect(SessionCancelToolInputSchema.safeParse({}).success).toBe(false);
    expect(SessionListToolInputSchema.safeParse({ limit: 100 }).success).toBe(true);
    expect(SessionListToolInputSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(SessionHistoryToolInputSchema.safeParse({ limit: 50 }).success).toBe(true);
    expect(SessionHistoryToolInputSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(SessionHistoryToolInputSchema.safeParse({ all: true }).success).toBe(false);
    expect(
      SessionChatToolInputSchema.safeParse({
        sessionId: 'target-session',
        prompt: 'follow up',
        wait: true,
        timeoutSeconds: 3_601,
      }).success
    ).toBe(false);
  });

  it('validates single and batch session renames', () => {
    expect(SessionRenameToolInputSchema.safeParse({ title: 'Current title' }).success).toBe(true);
    expect(
      SessionRenameToolInputSchema.safeParse({ sessionId: 'session-1', title: 'New title' }).success
    ).toBe(true);
    expect(SessionRenameToolInputSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(SessionRenameToolInputSchema.safeParse({ title: 'x'.repeat(201) }).success).toBe(false);

    expect(
      SessionRenameManyToolInputSchema.safeParse({
        items: [
          { sessionId: 'session-1', title: 'One' },
          { sessionId: 'session-2', title: 'Two' },
        ],
      }).success
    ).toBe(true);
    expect(SessionRenameManyToolInputSchema.safeParse({ items: [] }).success).toBe(false);
    expect(
      SessionRenameManyToolInputSchema.safeParse({
        items: [
          { sessionId: 'session-1', title: 'One' },
          { sessionId: 'session-1', title: 'Two' },
        ],
      }).success
    ).toBe(false);
    expect(
      SessionRenameManyToolInputSchema.safeParse({
        items: Array.from({ length: 21 }, (_, index) => ({
          sessionId: `session-${index}`,
          title: `Title ${index}`,
        })),
      }).success
    ).toBe(false);
  });

  it('resolves current session renames and preserves ordered independent results', async () => {
    expect(
      resolveSessionRenameItems(
        [{ sessionId: 'current', title: 'Current title' }],
        createMcpContext()
      )
    ).toEqual([{ sessionId: 'current-session-id', title: 'Current title' }]);
    expect(() =>
      resolveSessionRenameItems(
        [
          { sessionId: 'current', title: 'First' },
          { sessionId: 'current-session-id', title: 'Second' },
        ],
        createMcpContext()
      )
    ).toThrow(/appear only once/);

    const results = await applySessionRenameItems(
      [
        { sessionId: 'session-1' as SessionId, title: 'One' },
        { sessionId: 'missing' as SessionId, title: 'Missing' },
        { sessionId: 'session-3' as SessionId, title: 'Three' },
      ],
      async ({ sessionId }) => {
        if (sessionId === 'missing') {
          throw new MollyOperationStoreError(
            'SESSION_NOT_FOUND',
            'Session not found: missing',
            false
          );
        }
      }
    );

    expect(results).toEqual([
      { sessionId: 'session-1', ok: true, title: 'One' },
      {
        sessionId: 'missing',
        ok: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found: missing',
          retryable: false,
        },
      },
      { sessionId: 'session-3', ok: true, title: 'Three' },
    ]);
  });

  it('persists only existing sessions as user titles and confirms successful writes', async () => {
    const upsertDocMeta = vi.fn(async () => undefined);
    const waitUntilMetaSynced = vi.fn(async () => true);
    const manager = {
      repo: {
        getDocMeta: vi.fn(async (roomId: string) =>
          roomId === getSessionRoomId('missing' as SessionId)
            ? undefined
            : { meta: { id: roomId }, exists: true }
        ),
        upsertDocMeta,
      },
      waitUntilMetaSynced,
    } as unknown as LoroDocumentManager;

    const results = await persistSessionRenameItems(
      manager,
      [
        { sessionId: 'session-1' as SessionId, title: 'One' },
        { sessionId: 'missing' as SessionId, title: 'Missing' },
        { sessionId: 'session-3' as SessionId, title: 'Three' },
      ],
      'mcp.session_rename_many:current-session-id'
    );

    expect(results).toEqual([
      { sessionId: 'session-1', ok: true, title: 'One' },
      {
        sessionId: 'missing',
        ok: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found: missing',
          retryable: false,
        },
      },
      { sessionId: 'session-3', ok: true, title: 'Three' },
    ]);
    expect(upsertDocMeta.mock.calls).toEqual([
      [getSessionRoomId('session-1' as SessionId), { title: 'One', titleSource: 'user' }],
      [getSessionRoomId('session-3' as SessionId), { title: 'Three', titleSource: 'user' }],
    ]);
    expect(waitUntilMetaSynced).toHaveBeenCalledOnce();
    expect(waitUntilMetaSynced).toHaveBeenCalledWith({
      reason: 'mcp.session_rename_many:current-session-id',
    });
  });

  it('does not request write confirmation when every session is missing', async () => {
    const waitUntilMetaSynced = vi.fn(async () => true);
    const manager = {
      repo: {
        getDocMeta: vi.fn(async () => undefined),
        upsertDocMeta: vi.fn(async () => undefined),
      },
      waitUntilMetaSynced,
    } as unknown as LoroDocumentManager;

    await expect(
      persistSessionRenameItems(
        manager,
        [{ sessionId: 'missing' as SessionId, title: 'Missing' }],
        'mcp.session_rename_many:current-session-id'
      )
    ).resolves.toEqual([
      {
        sessionId: 'missing',
        ok: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found: missing',
          retryable: false,
        },
      },
    ]);
    expect(manager.repo.upsertDocMeta).not.toHaveBeenCalled();
    expect(waitUntilMetaSynced).not.toHaveBeenCalled();
  });

  it('cancels only the assistant turn created by the Operation item', () => {
    expect(
      buildOperationTargetCancelArgs('workspace-1', {
        status: 'active',
        inputDurable: true,
        target: { sessionId: 'target-session' as SessionId, userTurnId: 'target-user-turn' },
      })
    ).toEqual([
      'session',
      'cancel',
      '--workspace',
      'workspace-1',
      '--json',
      '--turn-id',
      'assistant:target-user-turn',
      'target-session',
    ]);
  });

  it('accepts only the finite list filters and bounded batch shapes', () => {
    expect(
      SessionListToolInputSchema.safeParse({
        archive: 'any',
        openedBy: 'current',
        executionContext: { kind: 'github', repo: 'loro-dev/lody' },
        pullRequest: { exists: true, state: 'open', draft: false },
      }).success
    ).toBe(true);
    expect(
      SessionListToolInputSchema.safeParse({ pullRequest: { exists: false, state: 'open' } })
        .success
    ).toBe(false);
    expect(
      SessionCreateManyToolInputSchema.safeParse({
        operationId: 'batch-create-1',
        defaults: { machineId: 'machine-id' },
        items: [{ prompt: 'one' }, { prompt: 'two' }],
      }).success
    ).toBe(true);
    expect(
      SessionChatManyToolInputSchema.safeParse({
        operationId: 'batch-chat-1',
        items: [{ sessionId: 's', prompt: 'p' }],
      }).success
    ).toBe(true);
    expect(() => assertBatchSize(21, 20)).toThrow(/BATCH_TOO_LARGE|between 1 and 20/);
    expect(() => assertBatchSize(0, 20)).toThrow(/BATCH_TOO_LARGE|between 1 and 20/);
    expect(SessionStatusManyToolInputSchema.safeParse({ sessionIds: ['a', 'b'] }).success).toBe(
      true
    );
    expect(SessionStatusManyToolInputSchema.safeParse({ sessionIds: ['a', 'a'] }).success).toBe(
      false
    );
    expect(() =>
      assertDifferentMcpSession({ id: 'parent' as SessionId }, { id: 'child' as SessionId })
    ).not.toThrow();
    expect(() =>
      assertDifferentMcpSession({ id: 'same' as SessionId }, { id: 'same' as SessionId })
    ).toThrow(/own active session/);
  });

  it('keeps session and turn ids when an optional wait times out', () => {
    const response = buildWaitErrorResponse(
      {
        ok: true,
        sessionId: 'session-id',
        workspaceId: 'workspace-id',
        machineId: 'machine-id',
        userTurnId: 'user-turn-id',
      },
      new Error('Timed out waiting for session turn completion after 1s.')
    );

    expect(response).toMatchObject({
      ok: false,
      sessionId: 'session-id',
      userTurnId: 'user-turn-id',
      error: 'Timed out waiting for session turn completion after 1s.',
    });
    expect(response).not.toHaveProperty('wait');
  });

  it('derives one authoritative execution phase and state', () => {
    expect(
      resolveSessionExecutionSnapshot({
        live: { working: false, source: 'none' },
        queuedTurnCount: 1,
      })
    ).toEqual({
      executionState: 'busy',
      phase: 'queued',
      queuedTurnCount: 1,
    });
    expect(
      resolveSessionExecutionSnapshot({
        live: { working: true, status: 'requestPermission', source: 'rpc' },
        activeTurnId: 'assistant:turn-1',
        queuedTurnCount: 1,
      })
    ).toEqual({
      executionState: 'busy',
      phase: 'waiting',
      activeTurnId: 'assistant:turn-1',
      queuedTurnCount: 1,
    });
  });

  it('shares one remote Machine presence read across a batch', async () => {
    const getOnlineMachineIds = vi.fn(async () => new Set(['remote-a', 'remote-b']));
    const isMachineOnline = makeMachineOnlineLookupForMcp(
      { getOnlineMachineIds } as never,
      createMcpContext()
    );

    await expect(
      Promise.all([
        isMachineOnline('machine-id'),
        isMachineOnline('remote-a'),
        isMachineOnline('remote-b'),
      ])
    ).resolves.toEqual([true, true, true]);
    expect(getOnlineMachineIds).toHaveBeenCalledTimes(1);
  });

  it('truncates history text on Unicode boundaries with exact omitted bytes', () => {
    const original = '🚀审查'.repeat(100);
    const result = truncateUtf8HeadTail(original, 101);
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(101);
    expect(result.text).not.toContain('�');
    expect(result.omittedBytes).toBe(
      Buffer.byteLength(original, 'utf8') -
        Buffer.byteLength(result.text.replace('\n…\n', ''), 'utf8')
    );
  });
});
