import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type {
  ACPSessionId,
  AgentConfigCliType,
  MachineId,
  SessionId,
  WorkspaceId,
} from '@molly/shared';
import { parseAskUserQuestionPermissionMeta } from '@molly/shared';
import {
  HarnessMcpPreparationSchema,
  MOLLY_PREPARE_MCP_METHOD,
  HARNESS_IMAGE_IMPORT_METHOD,
  HarnessImageImportRequestSchema,
  type HarnessImageImportRequest,
  type HarnessImageImportResult,
  HARNESS_IMAGE_RECOVERY_METHOD,
  HarnessImageRecoveryRequestSchema,
  type HarnessImageRecoveryRequest,
  type HarnessImageRecoveryResult,
  HARNESS_QUESTION_DISMISS_METHOD,
} from '@molly/shared/embedded-harness';
import type {
  CreateElicitationRequest,
  PromptRequest,
  PromptResponse,
  SessionNotification,
  RequestPermissionRequest,
} from '@agentclientprotocol/sdk';

import {
  AgentClient,
  AgentSteerNotDeliveredError,
  type AgentClientOptions,
} from '../src/agent/agent-client';
import type { SessionMcpCatalogSelector } from '../src/agent/session-mcp-resolver';
import { loadEnv } from '../src/utils/const';
import type { Logger } from '../src/utils/logger';

const createSilentLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  debug: () => {},
  setLevel: () => {},
  child: () => createSilentLogger(),
  close: async () => {},
});

/** Helper to create an AgentClient with pre-configured modes for testing. */
function createTestClient(options?: {
  cliType?: AgentConfigCliType;
  agentType?: string;
  workspaceId?: WorkspaceId;
  machineId?: MachineId;
  onHarnessImageImport?: (request: HarnessImageImportRequest) => Promise<HarnessImageImportResult>;
  onHarnessImageRecovery?: (
    request: HarnessImageRecoveryRequest
  ) => Promise<HarnessImageRecoveryResult>;
}) {
  const logger = createSilentLogger();
  const onUpdateMessage = vi.fn();
  const onContextWindowUsageUpdate = vi.fn();
  const onUsageUpdate = vi.fn();
  const onRateLimitUpdate = vi.fn();
  const onThreadGoalUpdated = vi.fn();
  const onThreadGoalCleared = vi.fn();
  const onImageGenerationBegin = vi.fn();
  const onImageGenerationEnd = vi.fn();
  const onRequestPermission = vi.fn<AgentClientOptions['onRequestPermission']>(async () => ({
    outcome: { outcome: 'selected' as const, optionId: 'opt-1' },
  }));

  const client = new AgentClient({
    sessionId: 'test-session' as SessionId,
    workspaceId: options?.workspaceId,
    machineId: options?.machineId,
    logger,
    terminalManager: {} as never,
    agentConfig: {
      cliType: options?.cliType ?? 'builtin',
      agentType: options?.agentType ?? 'codex',
    },
    onUpdateMessage,
    onContextWindowUsageUpdate,
    onUsageUpdate,
    onRateLimitUpdate,
    onThreadGoalUpdated,
    onThreadGoalCleared,
    onImageGenerationBegin,
    onImageGenerationEnd,
    onRequestPermission,
    onHarnessImageImport: options?.onHarnessImageImport,
    onHarnessImageRecovery: options?.onHarnessImageRecovery,
  });

  // Simulate session startup by setting internal fields directly
  // @ts-expect-error - accessing private field for test setup
  client.acpSessionId = 'acp-test' as ACPSessionId;

  return {
    client,
    onUpdateMessage,
    onContextWindowUsageUpdate,
    onUsageUpdate,
    onRateLimitUpdate,
    onThreadGoalUpdated,
    onThreadGoalCleared,
    onImageGenerationBegin,
    onImageGenerationEnd,
    onRequestPermission,
  };
}

function makePermissionRequest(kind?: string): RequestPermissionRequest {
  return {
    sessionId: 'acp-test',
    toolCall: {
      toolCallId: 'tc-1',
      title: 'Test tool',
      kind: kind ?? 'execute',
    },
    options: [
      { optionId: 'opt-allow', name: 'Allow', kind: 'allow_once' as const },
      { optionId: 'opt-deny', name: 'Deny' },
    ],
  } as RequestPermissionRequest;
}

it.each([
  'owned',
  'no-approval',
  'changed-query',
  'wrong-title',
  'wrong-session',
  'host-error',
] as const)(
  'guards the local recovery callback and consumes its exact query once (%s)',
  async (mode) => {
    const received: unknown[] = [];
    const { client, onRequestPermission } = createTestClient({
      agentType: 'molly',
      onHarnessImageRecovery: async (request) => {
        received.push(request);
        if (mode === 'host-error') throw new Error('PRIVATE_HOST_DIAGNOSTIC');
        return { kind: 'listed', operations: [] };
      },
    });
    const query = {};
    const permission = makePermissionRequest();
    permission.toolCall.title = mode === 'wrong-title' ? 'images/generate' : 'molly/recover_images';
    permission.toolCall.rawInput = query;
    onRequestPermission.mockResolvedValue({
      outcome: { outcome: 'selected', optionId: 'opt-allow' },
    });
    if (mode !== 'no-approval') await client.requestPermission(permission);
    const request = HarnessImageRecoveryRequestSchema.parse({
      version: 1,
      runId: 'a'.repeat(64),
      runtimeEpoch: randomUUID(),
      productSessionId: 'test-session',
      turnId: 'current-turn',
      toolCallId: 'tc-1',
      requestDigest: createHash('sha256').update(JSON.stringify(query)).digest('hex'),
      query: mode === 'changed-query' ? { operationId: 'b'.repeat(64) } : query,
    });
    const params = { sessionId: mode === 'wrong-session' ? 'foreign' : 'acp-test', request };
    if (mode === 'owned') {
      await expect(client.extMethod(HARNESS_IMAGE_RECOVERY_METHOD, params)).resolves.toEqual({
        kind: 'listed',
        operations: [],
      });
      await expect(client.extMethod(HARNESS_IMAGE_RECOVERY_METHOD, params)).rejects.toThrow(
        'harness_image_recovery_refused'
      );
    } else
      await expect(client.extMethod(HARNESS_IMAGE_RECOVERY_METHOD, params)).rejects.toThrow(
        /^harness_image_recovery_refused$/
      );
    expect(received).toEqual(['owned', 'host-error'].includes(mode) ? [request] : []);
  }
);

it.each([
  'allowed',
  'no-approval',
  'denied-again',
  'wrong-session',
  'wrong-digest',
  'wrong-tool',
  'revoked',
  'legacy',
  'host-error',
] as const)('binds the private image import to a single native approval (%s)', async (mode) => {
  const accepted: unknown[] = [];
  const sha256 = 'a'.repeat(64);
  const assets: HarnessImageImportResult = {
    assets: [
      {
        path: `media/${sha256}.png`,
        absolutePath: `/synthetic/media/${sha256}.png`,
        sha256,
        mimeType: 'image/png',
        width: 1,
        height: 1,
        bytes: 68,
      },
    ],
  };
  const { client, onRequestPermission } = createTestClient({
    agentType: mode === 'legacy' ? 'codex' : 'molly',
    onHarnessImageImport: async (request) => {
      accepted.push(request);
      if (mode === 'host-error') throw new Error('SYNTHETIC_PRIVATE_DIAGNOSTIC');
      return assets;
    },
  });
  let current = true;
  const selector: SessionMcpCatalogSelector = () => ({ servers: [], problems: [] });
  selector.guard = { isCurrent: () => current, subscribe: () => () => {} };
  // @ts-expect-error - production catalog wiring without a child process.
  await client.buildMcpServers('/tmp/synthetic', Promise.resolve(selector));
  const args = { prompt: 'Synthetic', model: 'synthetic-image' };
  const permission = makePermissionRequest();
  permission.toolCall.title = 'images/generate';
  permission.toolCall.rawInput = args;
  onRequestPermission.mockResolvedValue({
    outcome: { outcome: 'selected', optionId: 'opt-allow' },
  });
  if (mode !== 'no-approval') await client.requestPermission(permission);
  if (mode === 'denied-again') {
    onRequestPermission.mockResolvedValue({
      outcome: { outcome: 'selected', optionId: 'opt-deny' },
    });
    await client.requestPermission(permission);
  }
  if (mode === 'revoked') current = false;
  const request = HarnessImageImportRequestSchema.parse({
    version: 1,
    runId: 'b'.repeat(64),
    runtimeEpoch: randomUUID(),
    productSessionId: 'test-session',
    turnId: 'turn',
    connectionId: 'images',
    connectionRevision: 1,
    serverName: 'images',
    toolName: mode === 'wrong-tool' ? 'edit' : 'generate',
    toolCallId: 'tc-1',
    requestDigest:
      mode === 'wrong-digest'
        ? 'c'.repeat(64)
        : createHash('sha256').update(JSON.stringify(args)).digest('hex'),
    images: [{ mimeType: 'image/png', data: 'AAAA' }],
  });
  const params = { sessionId: mode === 'wrong-session' ? 'foreign-session' : 'acp-test', request };
  if (mode === 'allowed') {
    await expect(client.extMethod(HARNESS_IMAGE_IMPORT_METHOD, params)).resolves.toEqual(assets);
    await expect(client.extMethod(HARNESS_IMAGE_IMPORT_METHOD, params)).rejects.toThrow(
      'harness_image_import_refused'
    );
    expect(accepted).toEqual([request]);
  } else {
    await expect(client.extMethod(HARNESS_IMAGE_IMPORT_METHOD, params)).rejects.toThrow(
      /^harness_image_import_refused$/
    );
    expect(accepted).toEqual(mode === 'host-error' ? [request] : []);
  }
});

it('rejects a permission approved after the bound MCP catalog was revoked', async () => {
  const { client, onRequestPermission } = createTestClient({ agentType: 'molly' });
  let current = true;
  const selector: SessionMcpCatalogSelector = () => ({ servers: [], problems: [] });
  selector.guard = { isCurrent: () => current, subscribe: () => () => {} };
  // @ts-expect-error - exercise the production catalog wiring before permission delivery.
  await client.buildMcpServers('/tmp/synthetic', Promise.resolve(selector));
  onRequestPermission.mockImplementation(async () => {
    current = false;
    return { outcome: { outcome: 'selected', optionId: 'opt-1' } };
  });
  expect(await client.requestPermission(makePermissionRequest())).toEqual({
    outcome: { outcome: 'cancelled' },
  });
});

it.each(['ready', 'cancelled', 'revoked'] as const)(
  'owns public MCP preparation until its actual RPC settles (%s)',
  async (outcome) => {
    const { client } = createTestClient({ agentType: 'molly' });
    let current = true;
    const selector: SessionMcpCatalogSelector = () => ({ servers: [], problems: [] });
    selector.guard = { isCurrent: () => current, subscribe: () => () => {} };
    // @ts-expect-error - use the production catalog wiring without starting a provider.
    await client.buildMcpServers('/tmp/synthetic', Promise.resolve(selector));
    const pending = Promise.withResolvers<Record<string, unknown>>();
    const controller = new AbortController();
    const preparation = HarnessMcpPreparationSchema.parse({
      version: 1,
      runId: 'run',
      runtimeEpoch: 'epoch',
      sessionId: 'test-session',
      turnId: 'turn',
      workspaceId: 'workspace',
      connection: {
        schemaVersion: 1,
        id: 'model',
        revision: 1,
        providerPresetId: 'openai',
        displayName: 'Synthetic',
        baseUrl: 'https://model.invalid',
        credentialRef: 'model-ref',
        enabled: true,
      },
      mcpConnections: [
        {
          workspaceId: 'workspace',
          serverId: 'server',
          credentialRef: '00000000-0000-4000-8000-000000000001',
          revision: 1,
          destination: { transport: 'http', url: 'https://mcp.invalid' },
          fieldNames: ['Authorization'],
        },
      ],
    });
    const submitted: unknown[] = [];
    // @ts-expect-error - inject only the public outbound RPC seam used by this method.
    client.connection = {
      extMethod: (method: string, params: unknown) => {
        submitted.push({ method, params });
        return pending.promise;
      },
    };
    const response = client.prepareEmbeddedMcp(
      'acp-test' as ACPSessionId,
      preparation,
      controller.signal
    );
    expect(submitted).toEqual([
      { method: MOLLY_PREPARE_MCP_METHOD, params: { sessionId: 'acp-test', preparation } },
    ]);
    const settled = client.pendingPromptCompletion;
    expect(settled).not.toBeNull();
    if (outcome === 'cancelled') {
      controller.abort();
      await expect(response).rejects.toThrow('harness_mcp_preparation_cancelled');
      expect(client.pendingPromptCompletion).not.toBeNull();
    }
    if (outcome === 'revoked') current = false;
    pending.resolve({ public: 'ready' });
    if (outcome === 'ready') expect(await response).toEqual({ public: 'ready' });
    if (outcome === 'revoked')
      await expect(response).rejects.toThrow('harness_mcp_preparation_unavailable');
    await settled;
    expect(client.pendingPromptCompletion).toBeNull();
  }
);

function makeCurrentModeUpdateNotification(modeId: string): SessionNotification {
  return {
    sessionId: 'acp-test',
    update: {
      sessionUpdate: 'current_mode_update',
      currentModeId: modeId,
    },
  } as SessionNotification;
}

function makeUsageUpdateNotification(params?: {
  size?: unknown;
  used?: unknown;
}): SessionNotification {
  return {
    sessionId: 'acp-test',
    update: {
      sessionUpdate: 'usage_update',
      size: params?.size ?? 4096,
      used: params?.used ?? 1024,
    },
  } as SessionNotification;
}

describe('AgentClient plan mode permission restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Molly MCP server config', () => {
    it('binds the embedded built-in MCP to its public contract revision without changing legacy clients', async () => {
      const embedded = createTestClient({
        agentType: 'molly',
        workspaceId: 'workspace-1' as WorkspaceId,
        machineId: 'machine-1' as MachineId,
      }).client;
      const legacy = createTestClient({
        agentType: 'codex',
        workspaceId: 'workspace-1' as WorkspaceId,
        machineId: 'machine-1' as MachineId,
      }).client;
      // @ts-expect-error - inspect the exact ACP startup payload without spawning a provider
      const servers = await embedded.buildMcpServers('/tmp/synthetic-session', undefined);
      expect(servers.map((server) => server._meta?.mollyConnection)).toEqual([
        { id: 'molly:builtin', revision: 1 },
      ]);
      // @ts-expect-error - inspect the legacy projection without a provider process
      const previous = await legacy.buildMcpServers('/tmp/synthetic-session', undefined);
      expect(previous.every((server) => server._meta?.mollyConnection === undefined)).toBe(true);
    });
    it('passes public deployment endpoints to the MCP subprocess', () => {
      const keys = ['MOLLY_AUTH_URL', 'MOLLY_AUTH_SITE_URL', 'MOLLY_SERVER_URL'] as const;
      const previous = new Map(keys.map((key) => [key, process.env[key]]));
      process.env.MOLLY_AUTH_URL = 'https://convex.example.test';
      process.env.MOLLY_AUTH_SITE_URL = 'https://site.example.test';
      process.env.MOLLY_SERVER_URL = 'https://server.example.test';
      loadEnv();

      try {
        const { client } = createTestClient({
          workspaceId: 'workspace-1' as WorkspaceId,
          machineId: 'machine-1' as MachineId,
        });

        // @ts-expect-error - exercising private config builder for a focused regression test
        const [server] = client.buildBuiltinMcpServers('/tmp/lody-session');

        expect(server.env).toEqual(
          expect.arrayContaining([
            { name: 'MOLLY_AUTH_URL', value: 'https://convex.example.test' },
            { name: 'MOLLY_AUTH_SITE_URL', value: 'https://site.example.test' },
            { name: 'MOLLY_SERVER_URL', value: 'https://server.example.test' },
          ])
        );
        expect(server.env).not.toContainEqual(expect.objectContaining({ name: 'MOLLY_CLI_TOKEN' }));
      } finally {
        for (const key of keys) {
          const value = previous.get(key);
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
        loadEnv();
      }
    });

    it('passes ELECTRON_RUN_AS_NODE through when the embedded Electron CLI is running as Node', () => {
      const previous = process.env.ELECTRON_RUN_AS_NODE;
      process.env.ELECTRON_RUN_AS_NODE = '1';
      try {
        const { client } = createTestClient({
          workspaceId: 'workspace-1' as WorkspaceId,
          machineId: 'machine-1' as MachineId,
        });

        // @ts-expect-error - exercising private config builder for a focused regression test
        const [server] = client.buildBuiltinMcpServers('/tmp/lody-session');

        expect(server.env).toContainEqual({ name: 'ELECTRON_RUN_AS_NODE', value: '1' });
      } finally {
        if (previous === undefined) {
          delete process.env.ELECTRON_RUN_AS_NODE;
        } else {
          process.env.ELECTRON_RUN_AS_NODE = previous;
        }
      }
    });

    it('does not add Electron-only env when running from a normal Node CLI', () => {
      const previous = process.env.ELECTRON_RUN_AS_NODE;
      delete process.env.ELECTRON_RUN_AS_NODE;
      try {
        const { client } = createTestClient({
          workspaceId: 'workspace-1' as WorkspaceId,
          machineId: 'machine-1' as MachineId,
        });

        // @ts-expect-error - exercising private config builder for a focused regression test
        const [server] = client.buildBuiltinMcpServers('/tmp/lody-session');

        expect(server.env).not.toContainEqual({ name: 'ELECTRON_RUN_AS_NODE', value: '1' });
      } finally {
        if (previous === undefined) {
          delete process.env.ELECTRON_RUN_AS_NODE;
        } else {
          process.env.ELECTRON_RUN_AS_NODE = previous;
        }
      }
    });
  });

  describe('requestPermission', () => {
    it('sends all permission requests through the normal flow', async () => {
      const { client, onRequestPermission } = createTestClient();

      await client.requestPermission(makePermissionRequest('execute'));

      expect(onRequestPermission).toHaveBeenCalled();
    });

    it('sends switch_mode requests through normal flow', async () => {
      const { client, onRequestPermission } = createTestClient();

      await client.requestPermission(makePermissionRequest('switch_mode'));

      expect(onRequestPermission).toHaveBeenCalled();
    });
  });

  describe('permission mode routing', () => {
    it('does not treat current_mode_update as Codex plan-mode control state', async () => {
      const { client } = createTestClient();
      const setSessionModeSpy = vi.fn(async () => ({}));
      // @ts-expect-error - accessing private field for test setup
      client.connection = { setSessionMode: setSessionModeSpy };

      await client.setSessionMode('acp-test' as ACPSessionId, 'default');
      setSessionModeSpy.mockClear();

      await client.sessionUpdate(makeCurrentModeUpdateNotification('plan'));
      await client.sessionUpdate(makeCurrentModeUpdateNotification('acceptEdits'));

      expect(setSessionModeSpy).not.toHaveBeenCalled();
    });

    it('does not restore mode when agent transitions between non-plan modes', async () => {
      const { client } = createTestClient();
      const setSessionModeSpy = vi.fn(async () => ({}));
      // @ts-expect-error - accessing private field for test setup
      client.connection = { setSessionMode: setSessionModeSpy };

      // User selects default mode
      await client.setSessionMode('acp-test' as ACPSessionId, 'default');
      setSessionModeSpy.mockClear();

      // Agent transitions from default to acceptEdits (not from plan)
      await client.sessionUpdate(makeCurrentModeUpdateNotification('acceptEdits'));

      // Should NOT trigger a mode restore
      expect(setSessionModeSpy).not.toHaveBeenCalled();
    });

    it('does not restore mode when agent exits plan to the same mode user selected', async () => {
      const { client } = createTestClient();
      const setSessionModeSpy = vi.fn(async () => ({}));
      // @ts-expect-error - accessing private field for test setup
      client.connection = { setSessionMode: setSessionModeSpy };

      // User selects acceptEdits mode
      await client.setSessionMode('acp-test' as ACPSessionId, 'acceptEdits');
      setSessionModeSpy.mockClear();

      // Agent enters plan mode
      await client.sessionUpdate(makeCurrentModeUpdateNotification('plan'));

      // Agent exits plan mode → transitions to acceptEdits (same as user's selection)
      await client.sessionUpdate(makeCurrentModeUpdateNotification('acceptEdits'));

      // Should NOT trigger a mode restore since modes already match
      expect(setSessionModeSpy).not.toHaveBeenCalled();
    });

    it('keeps plan mode separate from session/set_mode permission routing', async () => {
      const { client } = createTestClient();
      const setSessionModeSpy = vi.fn(async () => ({}));
      // @ts-expect-error - accessing private field for test setup
      client.connection = { setSessionMode: setSessionModeSpy };

      // User selects default mode
      await client.setSessionMode('acp-test' as ACPSessionId, 'default');

      // Agent enters plan mode
      await client.sessionUpdate(makeCurrentModeUpdateNotification('plan'));

      // Agent exits plan mode → transitions to acceptEdits
      await client.sessionUpdate(makeCurrentModeUpdateNotification('acceptEdits'));

      expect(setSessionModeSpy).toHaveBeenCalledTimes(1);
      expect(setSessionModeSpy).toHaveBeenCalledWith({
        sessionId: 'acp-test',
        modeId: 'default',
      });
    });

    it('does not track user-selected mode for auto-restore', async () => {
      const { client } = createTestClient();
      const setSessionModeSpy = vi.fn(async () => ({}));
      // @ts-expect-error - accessing private field for test setup
      client.connection = { setSessionMode: setSessionModeSpy };

      await client.setSessionMode('acp-test' as ACPSessionId, 'acceptEdits');
      await client.setSessionMode('acp-test' as ACPSessionId, 'default');

      expect(setSessionModeSpy).toHaveBeenNthCalledWith(1, {
        sessionId: 'acp-test',
        modeId: 'acceptEdits',
      });
      expect(setSessionModeSpy).toHaveBeenNthCalledWith(2, {
        sessionId: 'acp-test',
        modeId: 'default',
      });
    });
  });

  describe('context window usage updates', () => {
    it('handles usage_update via context callback only', async () => {
      const { client, onUpdateMessage, onContextWindowUsageUpdate } = createTestClient();

      await client.sessionUpdate(makeUsageUpdateNotification({ size: 8192, used: 2048 }));

      expect(onContextWindowUsageUpdate).toHaveBeenCalledWith({ size: 8192, used: 2048 });
      expect(onUpdateMessage).not.toHaveBeenCalled();
    });

    it('ignores invalid usage_update payloads', async () => {
      const { client, onUpdateMessage, onContextWindowUsageUpdate } = createTestClient();

      await client.sessionUpdate(makeUsageUpdateNotification({ size: 'bad', used: 100 }));

      expect(onContextWindowUsageUpdate).not.toHaveBeenCalled();
      expect(onUpdateMessage).not.toHaveBeenCalled();
    });

    it('ignores non-finite and negative usage_update values', async () => {
      const { client, onUpdateMessage, onContextWindowUsageUpdate } = createTestClient();

      await client.sessionUpdate(makeUsageUpdateNotification({ size: Number.NaN, used: 100 }));
      await client.sessionUpdate(makeUsageUpdateNotification({ size: 8192, used: -1 }));

      expect(onContextWindowUsageUpdate).not.toHaveBeenCalled();
      expect(onUpdateMessage).not.toHaveBeenCalled();
    });
  });

  describe('ACP extension updates', () => {
    it.each(['resolve', 'reject'] as const)(
      'keeps cancelled raw prompts pending until they %s',
      async (outcome) => {
        const { client } = createTestClient();
        const raw = Promise.withResolvers<PromptResponse>();
        // @ts-expect-error - focused transport-boundary setup
        client.connection = { prompt: () => raw.promise, cancel: async () => {} };
        const controller = new AbortController();
        const local = client.prompt('acp-test' as ACPSessionId, [], {
          signal: controller.signal,
        });
        controller.abort();
        await expect(local).rejects.toThrow('Agent prompt aborted');

        const drain = client.pendingPromptCompletion;
        expect(drain).not.toBeNull();
        let drained = false;
        void drain?.then(() => {
          drained = true;
        });
        await Promise.resolve();
        expect(drained).toBe(false);

        if (outcome === 'resolve') raw.resolve({ stopReason: 'cancelled' });
        else raw.reject(new Error('ACP connection closed'));
        await drain;
        expect(client.pendingPromptCompletion).toBeNull();
      }
    );

    it.each(['original', 'steer'] as const)(
      'drains both Claude handoff requests when %s finishes first',
      async (first) => {
        const { client } = createTestClient({ agentType: 'claude' });
        const original = Promise.withResolvers<PromptResponse>();
        const steered = Promise.withResolvers<PromptResponse>();
        let steerId = '';
        const sendPrompt = (request: PromptRequest) => {
          const metadata = request._meta?.claudeCode as { steer?: { id: string } } | undefined;
          if (metadata?.steer) {
            steerId = metadata.steer.id;
            return steered.promise;
          }
          return original.promise;
        };
        // @ts-expect-error - focused transport-boundary setup
        client.connection = { prompt: sendPrompt };
        // @ts-expect-error - focused capability-negotiation setup
        client.acknowledgedSteerCapability = {
          transport: 'prompt',
          promptMetaNamespace: 'claudeCode',
          appliedNotificationMethod: 'claude/steerApplied',
          upstreamTurn: 'handoff',
          configPolicy: 'apply',
        };
        const initial = client.prompt('acp-test' as ACPSessionId, []);
        const steer = client.steerPrompt('acp-test' as ACPSessionId, []);
        const application = client.extNotification?.('_claude/steerApplied', {
          sessionId: 'acp-test',
          steerId,
        });
        const outcome = await steer.outcome;
        expect(outcome.outcome).toBe('applied');
        if (outcome.outcome !== 'applied') throw new Error('Expected applied steer');
        outcome.application.release();
        await application;
        const drain = client.pendingPromptCompletion;
        let drained = false;
        void drain?.then(() => {
          drained = true;
        });
        if (first === 'original') {
          original.resolve({ stopReason: 'end_turn' });
          await initial;
        } else {
          steered.resolve({ stopReason: 'end_turn' });
          await steer.completion;
        }
        expect(drained).toBe(false);
        expect(client.pendingPromptCompletion).not.toBeNull();
        original.resolve({ stopReason: 'end_turn' });
        steered.resolve({ stopReason: 'end_turn' });
        await Promise.all([initial, steer.completion, drain]);
        expect(client.pendingPromptCompletion).toBeNull();
      }
    );

    it('holds the steer application notification until its ownership lease is released', async () => {
      const { client, onUpdateMessage } = createTestClient({ agentType: 'claude' });
      const prompt = vi.fn(() => new Promise(() => {}));
      // @ts-expect-error - focused protocol-boundary setup
      client.connection = { prompt };
      // @ts-expect-error - focused capability-negotiation setup
      client.acknowledgedSteerCapability = {
        transport: 'prompt',
        promptMetaNamespace: 'claudeCode',
        appliedNotificationMethod: 'claude/steerApplied',
        upstreamTurn: 'handoff',
        configPolicy: 'apply',
      };

      const steerRun = client.steerPrompt('acp-test' as ACPSessionId, [
        { type: 'text', text: 'guide' },
      ]);
      const request = prompt.mock.calls[0]?.[0];
      const steerId = request?._meta?.claudeCode?.steer?.id;
      expect(steerId).toEqual(expect.any(String));

      let notificationCompleted = false;
      const notification = client
        .extNotification?.('_claude/steerApplied', {
          sessionId: 'acp-test',
          steerId,
        })
        .then(() => {
          notificationCompleted = true;
        });
      const outcome = await steerRun.outcome;
      expect(outcome.outcome).toBe('applied');
      if (outcome.outcome !== 'applied') throw new Error('Expected applied steer');
      expect(notificationCompleted).toBe(false);
      const postApplicationUpdate = client.sessionUpdate({
        sessionId: 'acp-test',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'after application' },
        },
      });
      await Promise.resolve();
      expect(onUpdateMessage).not.toHaveBeenCalled();

      outcome.application.release();
      await notification;
      await postApplicationUpdate;
      expect(notificationCompleted).toBe(true);
      expect(onUpdateMessage).toHaveBeenCalledOnce();
    });

    /** Wire an acknowledged-steer-capable Codex client around one steer request. */
    const createSteerClient = (
      request: () => Promise<unknown>,
      completion: Promise<never> = new Promise(() => {})
    ) => {
      const { client } = createTestClient({ agentType: 'codex' });
      const requestSpy = vi.fn(request);
      // @ts-expect-error - focused protocol-boundary setup
      client.connection = { request: requestSpy };
      // @ts-expect-error - focused session-identity setup
      client.acpSessionId = 'acp-test' as ACPSessionId;
      // @ts-expect-error - focused capability-negotiation setup
      client.acknowledgedSteerCapability = {
        transport: 'request',
        requestMethod: '_session/steering',
        appliedNotificationMethod: 'codex/steerApplied',
        upstreamTurn: 'same',
        configPolicy: 'active',
      };
      // @ts-expect-error - the steer rides the turn's own prompt completion
      client.activePromptCompletion = {
        sessionId: 'acp-test' as ACPSessionId,
        promise: completion,
      };
      return { client, request: requestSpy };
    };

    it('maps the Codex adapter failed verdict to not-applied', async () => {
      const { client, request } = createSteerClient(async () => ({ outcome: 'failed' }));

      const steerRun = client.steerPrompt('acp-test' as ACPSessionId, [
        { type: 'text', text: 'guide' },
      ]);

      await expect(steerRun.outcome).resolves.toMatchObject({
        outcome: 'not-applied',
        error: expect.any(AgentSteerNotDeliveredError),
      });
      expect(request).toHaveBeenCalledWith(
        '_session/steering',
        expect.objectContaining({ sessionId: 'acp-test', steerId: expect.any(String) })
      );
    });

    it('keeps a steer whose request died in transport ambiguous', async () => {
      // The frame may already have reached the agent, so re-sending this user
      // turn could deliver the same message twice. Only the agent's own
      // `invalid request` answer proves it declined.
      const { client } = createSteerClient(async () => {
        throw new Error('ACP connection closed');
      });

      const steerRun = client.steerPrompt('acp-test' as ACPSessionId, [
        { type: 'text', text: 'guide' },
      ]);

      await expect(steerRun.outcome).resolves.toMatchObject({
        outcome: 'unknown',
        error: expect.not.objectContaining({ name: 'AgentSteerNotDeliveredError' }),
      });
    });

    it('settles unknown delivery only from the matching late native application', async () => {
      const { client, request } = createSteerClient(async () => {
        throw new Error('transport closed');
      });
      const evidence: string[] = [];
      const run = client.steerPrompt(
        'acp-test' as ACPSessionId,
        [{ type: 'text', text: 'guide' }],
        {
          onLateApplied: async () => {
            evidence.push('applied');
          },
        }
      );
      expect((await run.outcome).outcome).toBe('unknown');
      const params = request.mock.calls[0]?.[1] as { steerId: string };
      await client.extNotification?.('_codex/steerApplied', {
        sessionId: 'another-session',
        steerId: params.steerId,
      });
      expect(evidence).toEqual([]);
      await client.extNotification?.('_codex/steerApplied', {
        sessionId: 'acp-test',
        steerId: 'another-input',
      });
      expect(evidence).toEqual([]);
      await client.extNotification?.('_codex/steerApplied', {
        sessionId: 'acp-test',
        steerId: params.steerId,
      });
      await client.extNotification?.('_codex/steerApplied', {
        sessionId: 'acp-test',
        steerId: params.steerId,
      });
      expect(evidence).toEqual(['applied']);
    });

    it('lets the refusal win when the steered turn ends before the agent answers', async () => {
      // The Codex adapter drains session notifications before it refuses, so the
      // upstream turn's own response routinely lands first. Rejecting on that
      // response alone would downgrade a provable refusal to an ambiguous
      // failure and strand the user's message.
      let refuse!: (error: unknown) => void;
      let completeTurn!: () => void;
      const completion = new Promise<never>((resolve) => {
        completeTurn = () => resolve(undefined as never);
      });
      const { client } = createSteerClient(
        () =>
          new Promise((_, reject) => {
            refuse = reject;
          }),
        completion
      );

      const steerRun = client.steerPrompt('acp-test' as ACPSessionId, [
        { type: 'text', text: 'guide' },
      ]);
      completeTurn();
      await Promise.resolve();
      const drain = client.pendingPromptCompletion;
      expect(drain).not.toBeNull();
      let drained = false;
      void drain?.then(() => {
        drained = true;
      });
      await Promise.resolve();
      expect(drained).toBe(false);
      refuse(
        Object.assign(new Error('Invalid request: No active Codex turn to steer'), { code: -32600 })
      );

      await expect(steerRun.outcome).resolves.toMatchObject({
        outcome: 'not-applied',
        error: expect.any(AgentSteerNotDeliveredError),
      });
      await drain;
      expect(client.pendingPromptCompletion).toBeNull();
    });

    it('handles rate limit extension notifications', async () => {
      const { client, onRateLimitUpdate } = createTestClient();
      const limits = {
        schemaVersion: 2 as const,
        planName: '"pro"',
        limitName: null,
        limitId: 'codex',
        windows: [
          {
            usedPercent: 18,
            windowDurationMins: 7 * 24 * 60,
            resetsAt: 1777400602,
          },
        ],
        fiveHour: 3,
        sevenDay: 82,
        fiveHourResetAt: 1777288209,
        sevenDayResetAt: 1777400602,
      };

      await expect(client.extNotification?.('_acp_ext:session_rate_limits', limits)).resolves.toBe(
        undefined
      );

      expect(onRateLimitUpdate).toHaveBeenCalledWith({
        limitId: 'codex',
        limitName: null,
        planName: '"pro"',
        scope: { providerId: 'codex' },
        windows: [
          {
            usedPercent: 18,
            windowDurationSeconds: 604800,
            resetsAtEpochSeconds: 1777400602,
          },
        ],
      });
    });

    it('keeps handling rate limit extension method requests', async () => {
      const { client, onRateLimitUpdate } = createTestClient();
      const limits = {
        planName: null,
        fiveHour: 3,
        sevenDay: 82,
        fiveHourResetAt: 1777288209,
        sevenDayResetAt: 1777400602,
      };

      await expect(client.extMethod('_acp_ext:session_rate_limits', limits)).resolves.toEqual({});

      expect(onRateLimitUpdate).toHaveBeenCalledWith({
        limitId: 'codex',
        planName: null,
        scope: { providerId: 'codex' },
        windows: [
          {
            usedPercent: 3,
            windowDurationSeconds: 18000,
            resetsAtEpochSeconds: 1777288209,
          },
          {
            usedPercent: 82,
            windowDurationSeconds: 604800,
            resetsAtEpochSeconds: 1777400602,
          },
        ],
      });
    });

    it('routes completed Codex proposed plan extension notifications through proposed plan updates', async () => {
      const { client, onUpdateMessage } = createTestClient();

      await client.extNotification?.('_acp_ext:codex_proposed_plan', {
        schemaVersion: 1,
        sessionId: 'acp-test',
        turnId: 'codex-turn-1',
        markdown: '- Inspect event routing',
        status: 'completed',
        isLatest: true,
      });

      expect(onUpdateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'acp-test',
          update: expect.objectContaining({
            sessionUpdate: 'plan_update',
            plan: {
              type: 'markdown',
              planId: 'codex-turn-1',
              content: '- Inspect event routing',
            },
          }),
        })
      );
    });

    it('ignores non-standard Codex proposed plan extension method names', async () => {
      const { client, onUpdateMessage } = createTestClient();

      await client.extNotification?.('codex_proposed_plan', {
        schemaVersion: 1,
        sessionId: 'acp-test',
        turnId: 'codex-turn-1',
        markdown: '- Inspect event routing',
        status: 'completed',
        isLatest: true,
      });

      expect(onUpdateMessage).not.toHaveBeenCalled();
    });

    it('routes in-progress Codex proposed plan deltas through proposed plan updates', async () => {
      const { client, onUpdateMessage } = createTestClient();

      await client.extNotification?.('_acp_ext:codex_proposed_plan', {
        schemaVersion: 1,
        sessionId: 'acp-test',
        turnId: 'codex-turn-1',
        markdown: '- Inspect event routing',
        status: 'delta',
        isLatest: true,
      });

      expect(onUpdateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: 'plan_update',
            plan: expect.objectContaining({ planId: 'codex-turn-1' }),
          }),
        })
      );
    });

    it('routes image generation tool calls to begin/end callbacks and suppresses them', async () => {
      const { client, onUpdateMessage, onImageGenerationBegin, onImageGenerationEnd } =
        createTestClient();

      await client.sessionUpdate({
        sessionId: 'acp-test',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'ig-1',
          title: 'Image generation',
          _meta: { lody: { toolName: 'ImageGeneration' } },
          kind: 'other',
          status: 'in_progress',
        },
      } as SessionNotification);

      await client.sessionUpdate({
        sessionId: 'acp-test',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'ig-1',
          status: 'completed',
          content: [
            { type: 'content', content: { type: 'text', text: 'Revised prompt: a calmer prompt' } },
            {
              type: 'content',
              content: {
                type: 'image',
                data: 'aGVsbG8=',
                mimeType: 'image/png',
                uri: '/tmp/codex-image.png',
              },
            },
          ],
        },
      } as SessionNotification);

      expect(onImageGenerationBegin).toHaveBeenCalledWith({
        acpSessionId: 'acp-test',
        callId: 'ig-1',
      });
      expect(onImageGenerationEnd).toHaveBeenCalledWith({
        acpSessionId: 'acp-test',
        callId: 'ig-1',
        status: 'completed',
        revisedPrompt: 'a calmer prompt',
        savedPath: '/tmp/codex-image.png',
        image: {
          data: 'aGVsbG8=',
          mimeType: 'image/png',
          uri: '/tmp/codex-image.png',
        },
      });
      // Image generation notifications must not reach the history pipeline —
      // upload-and-attach happens on the host side via the begin/end callbacks.
      expect(onUpdateMessage).not.toHaveBeenCalled();
    });

    it('extracts image generation output fields from rawOutput fallback', async () => {
      const { client, onUpdateMessage, onImageGenerationEnd } = createTestClient();

      await client.sessionUpdate({
        sessionId: 'acp-test',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'ig-raw-output',
          title: 'Image generation',
          _meta: { lody: { toolName: 'ImageGeneration' } },
          kind: 'other',
          status: 'in_progress',
        },
      } as SessionNotification);

      await client.sessionUpdate({
        sessionId: 'acp-test',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'ig-raw-output',
          status: 'completed',
          rawOutput: {
            call_id: 'ig-raw-output',
            status: 'completed',
            revised_prompt: 'raw output prompt',
            result: 'aGVsbG8=',
            saved_path: '/tmp/codex-image-from-raw-output.png',
          },
        },
      } as SessionNotification);

      expect(onImageGenerationEnd).toHaveBeenCalledWith({
        acpSessionId: 'acp-test',
        callId: 'ig-raw-output',
        status: 'completed',
        revisedPrompt: 'raw output prompt',
        savedPath: '/tmp/codex-image-from-raw-output.png',
        image: {
          data: 'aGVsbG8=',
          mimeType: 'image/png',
          uri: '/tmp/codex-image-from-raw-output.png',
        },
      });
      expect(onUpdateMessage).not.toHaveBeenCalled();
    });

    it('emits in-progress end events for streaming image generation updates', async () => {
      const { client, onImageGenerationEnd } = createTestClient();

      await client.sessionUpdate({
        sessionId: 'acp-test',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'ig-1',
          title: 'Image generation',
          _meta: { lody: { toolName: 'ImageGeneration' } },
          kind: 'other',
          status: 'in_progress',
        },
      } as SessionNotification);

      await client.sessionUpdate({
        sessionId: 'acp-test',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'ig-1',
          status: 'in_progress',
        },
      } as SessionNotification);

      expect(onImageGenerationEnd).toHaveBeenCalledWith({
        acpSessionId: 'acp-test',
        callId: 'ig-1',
        status: 'in_progress',
        revisedPrompt: undefined,
        savedPath: undefined,
      });
    });

    it('handles a fresh terminal tool_call when the begin notification was lost on resume', async () => {
      const { client, onImageGenerationBegin, onImageGenerationEnd } = createTestClient();

      await client.sessionUpdate({
        sessionId: 'acp-test',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'ig-2',
          title: 'Image generation',
          _meta: { lody: { toolName: 'ImageGeneration' } },
          kind: 'other',
          status: 'completed',
          content: [
            {
              type: 'content',
              content: {
                type: 'image',
                data: 'aGVsbG8=',
                mimeType: 'image/png',
                uri: '/tmp/codex-image.png',
              },
            },
          ],
        },
      } as SessionNotification);

      expect(onImageGenerationBegin).toHaveBeenCalledWith({
        acpSessionId: 'acp-test',
        callId: 'ig-2',
      });
      expect(onImageGenerationEnd).toHaveBeenCalledWith({
        acpSessionId: 'acp-test',
        callId: 'ig-2',
        status: 'completed',
        revisedPrompt: undefined,
        savedPath: '/tmp/codex-image.png',
        image: {
          data: 'aGVsbG8=',
          mimeType: 'image/png',
          uri: '/tmp/codex-image.png',
        },
      });
    });

    it('preserves completed-only inline image data when no saved path is available', async () => {
      const { client, onImageGenerationEnd, onUpdateMessage } = createTestClient();

      await client.sessionUpdate({
        sessionId: 'acp-test',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'ig-inline-only',
          title: 'Image generation',
          _meta: { lody: { toolName: 'ImageGeneration' } },
          kind: 'other',
          status: 'completed',
          content: [
            {
              type: 'content',
              content: { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
            },
          ],
        },
      } as SessionNotification);

      expect(onImageGenerationEnd).toHaveBeenCalledWith({
        acpSessionId: 'acp-test',
        callId: 'ig-inline-only',
        status: 'completed',
        revisedPrompt: undefined,
        savedPath: undefined,
        image: { data: 'aGVsbG8=', mimeType: 'image/png' },
      });
      expect(onUpdateMessage).not.toHaveBeenCalled();
    });

    it('routes canonical image generation tool calls without provider branching', async () => {
      const { client, onUpdateMessage, onImageGenerationBegin, onImageGenerationEnd } =
        createTestClient({
          agentType: 'claude',
        });

      await client.sessionUpdate({
        sessionId: 'acp-test',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'ig-1',
          title: 'Image generation',
          _meta: { lody: { toolName: 'ImageGeneration' } },
          kind: 'other',
          status: 'in_progress',
        },
      } as SessionNotification);

      expect(onImageGenerationBegin).toHaveBeenCalledWith({
        acpSessionId: 'acp-test',
        callId: 'ig-1',
      });
      expect(onImageGenerationEnd).toHaveBeenCalledWith({
        acpSessionId: 'acp-test',
        callId: 'ig-1',
        status: 'in_progress',
        revisedPrompt: undefined,
        savedPath: undefined,
      });
      expect(onUpdateMessage).not.toHaveBeenCalled();
    });
  });

  describe('session close', () => {
    it('uses closeSession when the agent advertises close support', async () => {
      const { client } = createTestClient({ cliType: 'builtin', agentType: 'claude' });
      const closeSessionSpy = vi.fn(async () => ({}));

      // @ts-expect-error - accessing private field for test setup
      client.connection = { closeSession: closeSessionSpy };
      // @ts-expect-error - accessing private field for test setup
      client.supportsClose = true;

      await expect(client.closeSession('acp-test' as ACPSessionId)).resolves.toBe(true);
      expect(closeSessionSpy).toHaveBeenCalledWith({ sessionId: 'acp-test' });
    });

    it('skips closeSession when the agent does not advertise close support', async () => {
      const { client } = createTestClient({ cliType: 'builtin', agentType: 'claude' });
      const closeSessionSpy = vi.fn(async () => ({}));

      // @ts-expect-error - accessing private field for test setup
      client.connection = { closeSession: closeSessionSpy };
      // @ts-expect-error - accessing private field for test setup
      client.supportsClose = false;

      await expect(client.closeSession('acp-test' as ACPSessionId)).resolves.toBe(false);
      expect(closeSessionSpy).not.toHaveBeenCalled();
    });
  });

  describe('config option routing', () => {
    it('routes model changes through setSessionConfigOption for builtin agents', async () => {
      const { client } = createTestClient({ cliType: 'builtin', agentType: 'codex' });
      const unstableSetSessionModelSpy = vi.fn(async () => ({}));
      const setSessionConfigOptionSpy = vi.fn(async () => ({
        configOptions: [],
      }));

      // @ts-expect-error - accessing private field for test setup
      client.connection = {
        unstable_setSessionModel: unstableSetSessionModelSpy,
        setSessionConfigOption: setSessionConfigOptionSpy,
      };
      // @ts-expect-error - accessing private field for test setup
      client.configOptions = [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'gpt-5.4',
          options: [],
        },
      ];

      await client.unstable_setSessionModel('acp-test' as ACPSessionId, 'gpt-5.4');

      expect(setSessionConfigOptionSpy).toHaveBeenCalledTimes(1);
      expect(setSessionConfigOptionSpy).toHaveBeenCalledWith({
        sessionId: 'acp-test',
        configId: 'model',
        value: 'gpt-5.4',
      });
      expect(unstableSetSessionModelSpy).not.toHaveBeenCalled();
    });

    it('codex agents use legacy setSessionMode for mode changes, not setSessionConfigOption', async () => {
      const { client } = createTestClient({ cliType: 'builtin', agentType: 'codex' });
      const setSessionModeSpy = vi.fn(async () => ({}));
      const setSessionConfigOptionSpy = vi.fn(async () => ({
        configOptions: [],
      }));

      // @ts-expect-error - accessing private field for test setup
      client.connection = {
        setSessionMode: setSessionModeSpy,
        setSessionConfigOption: setSessionConfigOptionSpy,
      };
      // @ts-expect-error - accessing private field for test setup
      client.configOptions = [
        {
          id: 'mode',
          name: 'Mode',
          category: 'mode',
          type: 'select',
          currentValue: 'default',
          options: [],
        },
      ];

      await client.setSessionMode('acp-test' as ACPSessionId, 'default');

      // Should use legacy setSessionMode, NOT setSessionConfigOption
      expect(setSessionConfigOptionSpy).not.toHaveBeenCalled();
      expect(setSessionModeSpy).toHaveBeenCalledWith({
        sessionId: 'acp-test',
        modeId: 'default',
      });
    });

    it('non-codex agents use setSessionConfigOption for mode changes', async () => {
      const { client } = createTestClient({ cliType: 'builtin', agentType: 'claude' });
      const setSessionModeSpy = vi.fn(async () => ({}));
      const setSessionConfigOptionSpy = vi.fn(async () => ({
        configOptions: [],
      }));

      // @ts-expect-error - accessing private field for test setup
      client.connection = {
        setSessionMode: setSessionModeSpy,
        setSessionConfigOption: setSessionConfigOptionSpy,
      };
      // @ts-expect-error - accessing private field for test setup
      client.configOptions = [
        {
          id: 'mode',
          name: 'Mode',
          category: 'mode',
          type: 'select',
          currentValue: 'default',
          options: [],
        },
      ];

      await client.setSessionMode('acp-test' as ACPSessionId, 'default');

      // Should use setSessionConfigOption
      expect(setSessionConfigOptionSpy).toHaveBeenCalledWith({
        sessionId: 'acp-test',
        configId: 'mode',
        value: 'default',
      });
      expect(setSessionModeSpy).not.toHaveBeenCalled();
    });

    it('uses config options for registry model changes', async () => {
      const { client } = createTestClient({ cliType: 'registry', agentType: 'opencode' });
      const unstableSetSessionModelSpy = vi.fn(async () => ({}));
      const setSessionConfigOptionSpy = vi.fn(async () => ({
        configOptions: [],
      }));

      // @ts-expect-error - accessing private field for test setup
      client.connection = {
        unstable_setSessionModel: unstableSetSessionModelSpy,
        setSessionConfigOption: setSessionConfigOptionSpy,
      };
      // @ts-expect-error - accessing private field for test setup
      client.configOptions = [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'kimi-k2',
          options: [],
        },
      ];

      await client.unstable_setSessionModel('acp-test' as ACPSessionId, 'kimi-k2');

      expect(setSessionConfigOptionSpy).toHaveBeenCalledWith({
        sessionId: 'acp-test',
        configId: 'model',
        value: 'kimi-k2',
      });
      expect(unstableSetSessionModelSpy).not.toHaveBeenCalled();
    });

    it('uses legacy session/set_model when the session advertises legacy models', async () => {
      const { client } = createTestClient({ cliType: 'registry', agentType: 'grok' });
      const requestSpy = vi.fn(async () => ({}));

      // @ts-expect-error - accessing private field for test setup
      client.connection = { request: requestSpy };
      // @ts-expect-error - accessing private field for test setup
      client.legacySessionModelState = {
        currentModelId: 'grok-4.5',
        availableModels: [
          { modelId: 'grok-4.5', name: 'Grok 4.5' },
          { modelId: 'grok-code-fast-1', name: 'Grok Code Fast 1' },
        ],
      };

      await client.unstable_setSessionModel('acp-test' as ACPSessionId, 'grok-code-fast-1');

      expect(requestSpy).toHaveBeenCalledWith('session/set_model', {
        sessionId: 'acp-test',
        modelId: 'grok-code-fast-1',
      });
      expect(client.currentModel).toEqual({
        modelId: 'grok-code-fast-1',
        name: 'Grok Code Fast 1',
      });
    });

    it('falls back to legacy session/set_model only for method-not-found', async () => {
      const { client } = createTestClient({ cliType: 'registry', agentType: 'hybrid' });
      const setSessionConfigOptionSpy = vi.fn(async () => {
        throw Object.assign(new Error('Method not found'), { code: -32601 });
      });
      const requestSpy = vi.fn(async () => ({}));

      // @ts-expect-error - accessing private field for test setup
      client.connection = {
        request: requestSpy,
        setSessionConfigOption: setSessionConfigOptionSpy,
      };
      // @ts-expect-error - accessing private field for test setup
      client.configOptions = [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: 'old',
          options: [{ value: 'new', name: 'New' }],
        },
      ];
      // @ts-expect-error - accessing private field for test setup
      client.legacySessionModelState = {
        currentModelId: 'old',
        availableModels: [{ modelId: 'new', name: 'New' }],
      };

      await client.unstable_setSessionModel('acp-test' as ACPSessionId, 'new');

      expect(setSessionConfigOptionSpy).toHaveBeenCalledTimes(1);
      expect(requestSpy).toHaveBeenCalledWith('session/set_model', {
        sessionId: 'acp-test',
        modelId: 'new',
      });
    });

    it('rejects model changes when the session advertises no switching surface', async () => {
      const { client } = createTestClient({ cliType: 'custom', agentType: 'modeless' });
      // @ts-expect-error - accessing private field for test setup
      client.connection = { request: vi.fn() };

      await expect(
        client.unstable_setSessionModel('acp-test' as ACPSessionId, 'unknown')
      ).rejects.toThrow('[ACP_MODEL_SWITCH_UNSUPPORTED]');
      expect(client.currentModel).toBeUndefined();
    });

    it('sends boolean config options with the ACP boolean request type', async () => {
      const { client } = createTestClient({ cliType: 'builtin', agentType: 'codex' });
      const setSessionConfigOptionSpy = vi.fn(async () => ({
        configOptions: [],
      }));

      // @ts-expect-error - accessing private field for test setup
      client.connection = {
        setSessionConfigOption: setSessionConfigOptionSpy,
      };

      await client.setSessionConfigOption('acp-test' as ACPSessionId, 'fast-mode', true);

      expect(setSessionConfigOptionSpy).toHaveBeenCalledWith({
        sessionId: 'acp-test',
        configId: 'fast-mode',
        type: 'boolean',
        value: true,
      });
    });
  });
});

describe('unstable_createElicitation (AskUserQuestion bridge)', () => {
  function managedRun() {
    const f = createTestClient({ agentType: 'molly' });
    const raw = Promise.withResolvers<PromptResponse>();
    // @ts-expect-error - drive the production prompt ownership without a child process.
    f.client.connection = { prompt: () => raw.promise, cancel: async () => {} };
    const identity = {
      version: 1 as const,
      questionId: randomUUID(),
      runId: 'synthetic-run',
      runtimeEpoch: randomUUID(),
    };
    const execution = f.client.prompt('acp-test' as ACPSessionId, [], {
      _meta: { mollyRunSnapshot: identity },
    });
    const form = {
      mode: 'form',
      sessionId: 'acp-test',
      toolCallId: identity.questionId,
      message: 'Layout?',
      requestedSchema: {
        type: 'object',
        properties: { [identity.questionId]: { type: 'string', enum: ['Wide', 'Tall'] } },
      },
      _meta: { lody: { elicitation: { version: 1 } }, mollyQuestion: identity },
    } satisfies CreateElicitationRequest;
    return {
      ...f,
      identity,
      form,
      finish: async () => {
        raw.resolve({ stopReason: 'end_turn' });
        await execution;
      },
    };
  }

  it('acknowledges dismissal only after the owned permission request settles', async () => {
    const f = managedRun();
    const persisted = Promise.withResolvers<void>();
    const events: string[] = [];
    f.onRequestPermission.mockImplementation(
      (_id, _request, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener(
            'abort',
            () => {
              events.push('cancel');
              void persisted.promise.then(() =>
                resolve({ outcome: { outcome: 'selected', optionId: 'answer' } })
              );
            },
            { once: true }
          );
        })
    );
    const question = f.client.unstable_createElicitation(f.form);
    const dismiss = f.client
      .extMethod(HARNESS_QUESTION_DISMISS_METHOD, { sessionId: 'acp-test', request: f.identity })
      .then((result) => {
        events.push('dismissed');
        return result;
      });
    expect(events).toEqual(['cancel']);
    persisted.resolve();
    expect(await dismiss).toEqual({ version: 1, dismissed: true });
    expect(await question).toEqual({ action: 'cancel' });
    expect(events).toEqual(['cancel', 'dismissed']);
    await f.finish();
  });

  it.each(['runId', 'runtimeEpoch', 'questionId'] as const)(
    'refuses mismatched %s without opening another permission',
    async (key) => {
      const f = managedRun();
      const observed: string[] = [];
      f.onRequestPermission.mockImplementation(async () => {
        observed.push('opened');
        return { outcome: { outcome: 'cancelled' } };
      });
      const identity = { ...f.identity, [key]: randomUUID() };
      await expect(
        f.client.unstable_createElicitation({
          ...f.form,
          _meta: { ...f.form._meta, mollyQuestion: identity },
        })
      ).rejects.toThrow('harness_question_outside_run');
      expect(observed).toEqual([]);
      await f.finish();
    }
  );

  it('rejects stale-run dismissal while preserving the current request', async () => {
    const f = managedRun();
    let cancelled = false;
    f.onRequestPermission.mockImplementation(
      (_id, _request, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener(
            'abort',
            () => {
              cancelled = true;
              resolve({ outcome: { outcome: 'cancelled' } });
            },
            { once: true }
          );
        })
    );
    const pending = f.client.unstable_createElicitation(f.form);
    await expect(
      f.client.extMethod(HARNESS_QUESTION_DISMISS_METHOD, {
        sessionId: 'acp-test',
        request: { ...f.identity, runId: 'old-run' },
      })
    ).rejects.toThrow('harness_question_dismiss_refused');
    expect(cancelled).toBe(false);
    await expect(f.client.unstable_createElicitation(f.form)).rejects.toThrow(
      'harness_question_outside_run'
    );
    await f.client.cancel('acp-test' as ACPSessionId);
    expect(await pending).toEqual({ action: 'cancel' });
    expect(cancelled).toBe(true);
    await f.finish();
  });

  it('retires questions when the raw prompt ends and refuses subsequent forms', async () => {
    const f = managedRun();
    f.onRequestPermission.mockImplementation(
      (_id, _request, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener('abort', () => resolve({ outcome: { outcome: 'cancelled' } }), {
            once: true,
          });
        })
    );
    const pending = f.client.unstable_createElicitation(f.form);
    await f.finish();
    expect(await pending).toEqual({ action: 'cancel' });
    await expect(f.client.unstable_createElicitation(f.form)).rejects.toThrow(
      'harness_question_outside_run'
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Shaped like acp-extension-claude >= 0.44.0's AskUserQuestion form elicitation.
  const askUserQuestionForm = {
    mode: 'form',
    sessionId: 'acp-test',
    toolCallId: 'tc-elicit',
    message: 'Which database should we use?',
    requestedSchema: {
      type: 'object',
      properties: {
        question_0: {
          type: 'string',
          title: 'Database',
          oneOf: [
            { const: 'Postgres', title: 'Postgres — Use PostgreSQL' },
            { const: 'SQLite', title: 'SQLite' },
          ],
        },
        question_0_custom: {
          type: 'string',
          title: 'Other',
          description: 'optional',
          _meta: {
            lody: { elicitation: { version: 1, customAnswerFor: 'question_0' } },
          },
        },
      },
    },
  } as unknown as CreateElicitationRequest;

  it('bridges the form onto the permission flow and folds answers back', async () => {
    const { client, onRequestPermission } = createTestClient({ agentType: 'claude' });
    onRequestPermission.mockResolvedValueOnce({
      outcome: {
        outcome: 'selected',
        optionId: 'answer',
        _meta: {
          lody: {
            elicitation: {
              version: 1,
              answers: { question_0: 'Postgres' },
            },
          },
        },
      },
    } as unknown as Awaited<ReturnType<typeof onRequestPermission>>);

    const result = await client.unstable_createElicitation(askUserQuestionForm);

    expect(onRequestPermission).toHaveBeenCalledTimes(1);
    const calls = onRequestPermission.mock.calls as unknown as Array<
      [string, RequestPermissionRequest]
    >;
    const request = calls[0]?.[1];
    expect(request?.toolCall.toolCallId).toBe('tc-elicit');
    expect(request?.options.map((option) => option.optionId)).toEqual(['answer', 'cancel']);
    const parsed = parseAskUserQuestionPermissionMeta(request?._meta);
    expect(parsed?.questions[0]?.question).toBe('Which database should we use?');
    expect(request?._meta).toMatchObject({
      lody: { elicitation: { version: 1 } },
      claudeCode: {
        requestType: 'askUserQuestion',
        askUserQuestion: {
          questions: [expect.objectContaining({ question: 'Which database should we use?' })],
        },
      },
    });
    expect(result).toEqual({ action: 'accept', content: { question_0: 'Postgres' } });
  });

  it('folds an older renderer Claude answer back into the Core form', async () => {
    const { client, onRequestPermission } = createTestClient({ agentType: 'claude' });
    onRequestPermission.mockResolvedValueOnce({
      outcome: {
        outcome: 'selected',
        optionId: 'answer',
        _meta: {
          claudeCode: {
            askUserQuestion: {
              answers: { 'Which database should we use?': 'Postgres' },
            },
          },
        },
      },
    } as unknown as Awaited<ReturnType<typeof onRequestPermission>>);

    await expect(client.unstable_createElicitation(askUserQuestionForm)).resolves.toEqual({
      action: 'accept',
      content: { question_0: 'Postgres' },
    });
  });

  it('returns cancel when the user dismisses the question', async () => {
    const { client, onRequestPermission } = createTestClient({ agentType: 'claude' });
    onRequestPermission.mockResolvedValueOnce({
      outcome: { outcome: 'cancelled' },
    } as unknown as Awaited<ReturnType<typeof onRequestPermission>>);

    await expect(client.unstable_createElicitation(askUserQuestionForm)).resolves.toEqual({
      action: 'cancel',
    });
  });

  it('declines non-AskUserQuestion elicitations without prompting', async () => {
    const { client, onRequestPermission } = createTestClient({ agentType: 'claude' });

    const result = await client.unstable_createElicitation({
      mode: 'url',
      sessionId: 'acp-test',
      url: 'https://example.com',
      message: 'Open this',
      elicitationId: 'e1',
    } as unknown as CreateElicitationRequest);

    expect(result).toEqual({ action: 'decline' });
    expect(onRequestPermission).not.toHaveBeenCalled();
  });

  it('bridges Codex fields and folds an older renderer answer into the Core form', async () => {
    const { client, onRequestPermission } = createTestClient();
    onRequestPermission.mockResolvedValueOnce({
      outcome: {
        outcome: 'selected',
        optionId: 'answer',
        _meta: {
          codex: {
            requestUserInput: {
              answers: { next_step: { answers: ['Custom path'] } },
            },
          },
        },
      },
    } as unknown as Awaited<ReturnType<typeof onRequestPermission>>);

    const result = await client.unstable_createElicitation({
      mode: 'form',
      sessionId: 'acp-test',
      toolCallId: 'codex-question',
      message: 'What next?',
      requestedSchema: {
        type: 'object',
        properties: {
          next_step: {
            type: 'string',
            title: 'Next step',
            description: 'What next?',
            oneOf: [{ const: 'Ship', title: 'Ship' }],
            _meta: { lody: { elicitation: { version: 1, secret: false } } },
          },
          next_step__other: {
            type: 'string',
            title: 'Other',
            _meta: {
              lody: {
                elicitation: { version: 1, customAnswerFor: 'next_step', secret: false },
              },
            },
          },
        },
      },
      _meta: { lody: { elicitation: { version: 1, autoResolveAfterSeconds: 60 } } },
    } as unknown as CreateElicitationRequest);

    const request = (
      onRequestPermission.mock.calls as unknown as [string, RequestPermissionRequest][]
    ).at(0)?.[1];
    const parsed = parseAskUserQuestionPermissionMeta(request?._meta);
    expect(parsed?.source).toBe('lody');
    expect(parsed?.autoResolveAt).toEqual(expect.any(Number));
    expect(parsed?.questions[0]?.allowCustomAnswer).toBe(true);
    expect(request?._meta).toMatchObject({
      lody: { elicitation: { version: 1 } },
      codex: {
        requestUserInput: {
          questions: [expect.objectContaining({ id: 'next_step', question: 'What next?' })],
          autoResolveAt: expect.any(Number),
        },
      },
    });
    expect(result).toEqual({ action: 'accept', content: { next_step__other: 'Custom path' } });
  });
});

describe('AgentClient goal session info', () => {
  it('shows a retry activity until Codex resumes streaming', async () => {
    const { client, onUpdateMessage } = createTestClient();

    await client.sessionUpdate({
      sessionId: 'acp-test',
      update: {
        sessionUpdate: 'session_info_update',
        _meta: {
          codex: {
            error: { message: 'connection lost', turnId: 'turn-1', willRetry: true },
          },
        },
      },
    });
    await client.sessionUpdate({
      sessionId: 'acp-test',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Recovered' },
      },
    });

    expect(onUpdateMessage.mock.calls.map(([notification]) => notification.update)).toEqual([
      expect.objectContaining({
        sessionUpdate: 'tool_call',
        toolCallId: 'codex-retry:turn-1',
        status: 'in_progress',
      }),
      expect.objectContaining({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'codex-retry:turn-1',
        status: 'completed',
      }),
      expect.objectContaining({ sessionUpdate: 'agent_message_chunk' }),
    ]);
  });

  it('normalizes provider-neutral goal metadata for non-canonical agents', async () => {
    const { client, onThreadGoalUpdated, onUpdateMessage } = createTestClient({
      agentType: 'claude',
    });

    await client.sessionUpdate({
      sessionId: 'acp-test',
      update: {
        sessionUpdate: 'session_info_update',
        _meta: {
          goal: {
            objective: 'ship the release',
            status: 'limited',
            tokenBudget: 42_000,
            iterations: 7,
            lastReason: 'waiting for review',
            tokensUsed: 12_000,
            timeUsedSeconds: 90,
            createdAt: 100,
            updatedAt: 200,
            controlMethod: '_session/goal',
          },
        },
      },
    } as unknown as SessionNotification);

    expect(onThreadGoalUpdated).toHaveBeenCalledWith({
      type: 'goal',
      threadId: 'acp-test',
      objective: 'ship the release',
      status: 'blocked',
      tokenBudget: 42_000,
      tokensUsed: 12_000,
      timeUsedSeconds: 90,
      createdAt: 100,
      updatedAt: 200,
    });
    expect(onUpdateMessage).toHaveBeenCalledTimes(1);
  });

  it('prefers valid provider-neutral metadata over a legacy Codex duplicate', async () => {
    const { client, onThreadGoalUpdated } = createTestClient();

    await client.sessionUpdate({
      sessionId: 'acp-test',
      update: {
        sessionUpdate: 'session_info_update',
        _meta: {
          goal: {
            objective: 'neutral objective',
            status: 'active',
            controlMethod: '_session/goal',
          },
          codex: {
            goal: {
              objective: 'legacy objective',
              status: 'paused',
            },
          },
        },
      },
    } as unknown as SessionNotification);

    expect(onThreadGoalUpdated).toHaveBeenCalledWith({
      type: 'goal',
      threadId: 'acp-test',
      objective: 'neutral objective',
      status: 'active',
      tokenBudget: null,
    });
  });

  it('keeps parsing legacy Codex goal metadata', async () => {
    const { client, onThreadGoalUpdated, onUpdateMessage } = createTestClient();

    await client.sessionUpdate({
      sessionId: 'acp-test',
      update: {
        sessionUpdate: 'session_info_update',
        _meta: {
          codex: {
            goal: {
              objective: 'ship the release',
              status: 'budgetLimited',
              tokenBudget: 42_000,
            },
          },
        },
      },
    });

    expect(onThreadGoalUpdated).toHaveBeenCalledWith({
      type: 'goal',
      threadId: 'acp-test',
      objective: 'ship the release',
      status: 'budgetLimited',
      tokenBudget: 42_000,
    });
    expect(onUpdateMessage).toHaveBeenCalledTimes(1);
  });

  it('handles a null provider-neutral goal as cleared', async () => {
    const { client, onThreadGoalCleared } = createTestClient({ agentType: 'claude' });

    await client.sessionUpdate({
      sessionId: 'acp-test',
      update: {
        sessionUpdate: 'session_info_update',
        _meta: {
          goal: null,
          codex: {
            goal: {
              objective: 'legacy objective',
              status: 'active',
            },
          },
        },
      },
    } as unknown as SessionNotification);

    expect(onThreadGoalCleared).toHaveBeenCalledWith('acp-test');
  });

  it('ignores invalid provider-neutral goal metadata without breaking the session stream', async () => {
    const { client, onThreadGoalUpdated, onUpdateMessage } = createTestClient({
      agentType: 'claude',
    });

    await client.sessionUpdate({
      sessionId: 'acp-test',
      update: {
        sessionUpdate: 'session_info_update',
        _meta: {
          goal: {
            objective: 'neutral objective',
            status: 'active',
            controlMethod: '_wrong/goal',
          },
          codex: {
            goal: {
              objective: 'legacy objective',
              status: 'active',
            },
          },
        },
      },
    } as unknown as SessionNotification);

    expect(onThreadGoalUpdated).not.toHaveBeenCalled();
    expect(onUpdateMessage).toHaveBeenCalledTimes(1);
  });
});

describe('provider prompt settlement', () => {
  it.each(['response', 'disconnect'] as const)(
    'local abort is not provider completion: %s',
    async (ending) => {
      const { client } = createTestClient();
      let finish!: () => void;
      let disconnect!: (error: Error) => void;
      const provider = new Promise<void>((resolve, reject) => {
        finish = resolve;
        disconnect = reject;
      });
      // @ts-expect-error - minimal synthetic ACP connection at the protocol boundary
      client.connection = { prompt: () => provider, cancel: async () => {} };
      const abort = new AbortController();
      const prompt = client.prompt(
        'acp-test' as ACPSessionId,
        [{ type: 'text', text: 'synthetic' }],
        { signal: abort.signal }
      );
      const settled = client.getProviderPromptSettlement('acp-test' as ACPSessionId);
      let providerEnded = false;
      void settled.then(() => {
        providerEnded = true;
      });
      abort.abort();
      await expect(prompt).rejects.toThrow('Agent prompt aborted');
      expect(providerEnded).toBe(false);
      // A consumer holding this settlement is bound to the old invocation, not a later prompt.
      if (ending === 'response') finish();
      else disconnect(Error('transport closed'));
      await settled;
      expect(providerEnded).toBe(true);
    }
  );
});
