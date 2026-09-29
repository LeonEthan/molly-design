import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServer, PromptResponse } from '@agentclientprotocol/sdk';
import type { WorkerConfig } from '@molly/harness-pi/worker-config';
import {
  type HarnessRunSnapshot,
  type McpCredentialBinding,
  type ProtectedImageConnection,
} from '@molly/shared/embedded-harness';
import { HarnessCredentialBroker } from './harness-credential-broker';
import { EmbeddedHarnessControl } from './embedded-harness-control';

vi.mock('./personal-memory', () => ({
  getPersonalMemory: async () => ({
    read: async () => ({ enabled: true, revision: 'synthetic', entries: [] }),
  }),
}));

const brokers: HarnessCredentialBroker[] = [];
afterEach(() => {
  for (const broker of brokers.splice(0)) broker.dispose();
});
function fixture(
  stopFails = false,
  mcpConnections: McpCredentialBinding[] = [],
  imageConnection?: ProtectedImageConnection,
  personalMemory = false
) {
  const broker = new HarnessCredentialBroker();
  brokers.push(broker);
  const config: WorkerConfig = {
    schemaVersion: 1,
    runtimeEpoch: randomUUID(),
    productSessionId: 'synthetic-session',
    workspaceId: 'workspace',
    privateRoot: '/private/molly-test',
    cwd: '/private/molly-test/work',
    shellPath: '/bin/sh',
    connection: {
      schemaVersion: 1,
      id: 'connection',
      revision: 1,
      providerPresetId: 'openai',
      displayName: 'Test',
      baseUrl: 'https://example.invalid/v1',
      credentialRef: 'ref',
      enabled: true,
    },
    selection: { connectionId: 'connection', modelId: 'explicit', thinking: 'off' },
    systemPrompt: 'Synthetic',
    personalMemory,
    permissionProfileId: 'ask',
    harness: {
      id: 'molly',
      engine: 'pi',
      engineVersion: '0.85.1',
      buildId: 'test-build',
      protocolVersion: 1,
    },
  };
  broker.exchange({
    version: 1,
    connections: [config.connection],
    reports: [],
    mcpConnections,
    imageConnection,
  });
  const pipe = new PassThrough();
  const packets: unknown[] = [];
  pipe.on('data', (packet: Buffer) => packets.push(JSON.parse(packet.toString('utf8'))));
  const stops: string[] = [];
  const control = new EmbeddedHarnessControl(config, pipe, broker, async () => {
    if (stopFails) throw new Error('synthetic exit failure');
    stops.push('stopped');
    pipe.destroy();
  });
  const configured = control.configureMcp([
    ...mcpConnections.map((binding): McpServer => {
      if (binding.destination.transport !== 'http') throw new Error('fixture_http_required');
      return {
        type: 'http',
        name: binding.serverId,
        url: binding.destination.url,
        headers: [],
        _meta: {
          mollyConnection: { id: binding.serverId, revision: 1 },
          mollyMcpCredential: binding,
        },
      };
    }),
  ]);
  const binding = {
    version: 1,
    runtimeEpoch: config.runtimeEpoch,
    harness: config.harness,
    toolsetHash: '0'.repeat(64),
    pluginSetHash: '1'.repeat(64),
    nativeSessionFile: '/private/molly-test/native.jsonl',
  } as const;
  control.bind(binding);
  function grant() {
    const [request] = broker.exchange({
      version: 1,
      connections: [config.connection],
      reports: [],
      mcpConnections,
      imageConnection,
    });
    expect(request).toBeDefined();
    broker.exchange({
      version: 1,
      connections: [config.connection],
      mcpConnections,
      imageConnection,
      reports: [
        {
          requestId: request!.requestId,
          runId: request!.snapshot.runId,
          runtimeEpoch: config.runtimeEpoch,
          connectionId: config.connection.id,
          connectionRevision: config.connection.revision,
          result: { ok: true, apiKey: 'SYNTHETIC_SECRET' },
        },
      ],
    });
  }
  function complete(snapshot: HarnessRunSnapshot): PromptResponse {
    return {
      stopReason: 'end_turn',
      _meta: {
        mollyRunId: snapshot.runId,
        mollyRuntimeEpoch: snapshot.runtimeEpoch,
        mollyNativeOutcome: { status: 'completed', nativeEndEntryId: 'native-leaf' },
      },
    };
  }
  return { broker, config, control, pipe, packets, stops, grant, complete, binding, configured };
}

describe('owned worker host control', () => {
  it('allows memory only inside its owning run and rejects cancelled or settled access', async () => {
    const f = fixture(false, [], undefined, true);
    const controller = new AbortController();
    const request = {
      productSessionId: f.config.productSessionId,
      runtimeEpoch: f.config.runtimeEpoch,
      runId: 'not-started',
      turnId: 'memory-turn',
      operation: { action: 'read' as const },
    };
    await expect(f.control.personalMemory(request)).rejects.toThrow('harness_memory_not_owned');
    const result = f.control.prompt({
      turnId: request.turnId,
      signal: controller.signal,
      prompt: async (snapshot) => {
        request.runId = snapshot.runId;
        await expect(f.control.personalMemory(request)).resolves.toEqual({
          enabled: true,
          revision: 'synthetic',
          entries: [],
        });
        await expect(
          f.control.personalMemory({ ...request, turnId: 'other-turn' })
        ).rejects.toThrow('harness_memory_not_owned');
        return f.complete(snapshot);
      },
    });
    f.grant();
    expect((await result).stopReason).toBe('end_turn');
    await expect(f.control.personalMemory(request)).rejects.toThrow('harness_memory_not_owned');
    const cancelled = f.control.prompt({
      turnId: 'cancelled-memory-turn',
      signal: controller.signal,
      prompt: async (snapshot) => {
        request.runId = snapshot.runId;
        request.turnId = snapshot.turnId;
        controller.abort();
        await expect(f.control.personalMemory(request)).rejects.toThrow('harness_memory_not_owned');
        return f.complete(snapshot);
      },
    });
    f.grant();
    await expect(cancelled).rejects.toThrow();
  });

  it('configures MCP once for the session and revokes its idle worker after credential rotation', async () => {
    const binding: McpCredentialBinding = {
      workspaceId: 'workspace',
      serverId: 'protected',
      credentialRef: randomUUID(),
      revision: 1,
      destination: { transport: 'http', url: 'https://mcp.invalid/mcp' },
      fieldNames: ['Authorization'],
    };
    const f = fixture(false, [binding]);
    const [request] = f.broker.pendingMcpRequests();
    expect(request?.session.sessionId).toBe(f.config.productSessionId);
    f.broker.exchange({
      version: 1,
      connections: [f.config.connection],
      mcpConnections: [binding],
      reports: [],
      mcpReports: [
        {
          requestId: request!.requestId,
          sessionId: f.config.productSessionId,
          runtimeEpoch: f.config.runtimeEpoch,
          credentialRef: binding.credentialRef,
          credentialRevision: 1,
          result: { ok: true, values: { Authorization: 'SYNTHETIC_MCP' } },
        },
      ],
    });
    await f.configured;
    expect(f.packets).toMatchObject([
      {
        type: 'mcp-credentials',
        credentials: [{ connection: binding, values: { Authorization: 'SYNTHETIC_MCP' } }],
      },
    ]);
    const snapshots: HarnessRunSnapshot[] = [];
    for (const turnId of ['first', 'second']) {
      const result = f.control.prompt({
        turnId,
        signal: new AbortController().signal,
        prompt: async (snapshot) => {
          snapshots.push(snapshot);
          return f.complete(snapshot);
        },
      });
      f.grant();
      expect((await result).stopReason).toBe('end_turn');
    }
    expect(f.packets).toHaveLength(3);
    expect(snapshots.map((snapshot) => snapshot.toolsetHash)).toEqual([
      f.binding.toolsetHash,
      f.binding.toolsetHash,
    ]);
    expect(JSON.stringify(snapshots)).not.toContain('SYNTHETIC_MCP');
    f.broker.exchange({
      version: 1,
      connections: [f.config.connection],
      mcpConnections: [{ ...binding, revision: 2 }],
      reports: [],
    });
    expect(f.stops).toEqual(['stopped']);
    await expect(
      f.control.prompt({
        turnId: 'third',
        signal: new AbortController().signal,
        prompt: async (snapshot) => f.complete(snapshot),
      })
    ).rejects.toThrow('harness_worker_unavailable');
  });
  it('refuses late native success after a live MCP catalog invalidation', async () => {
    const f = fixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const result = f.control.prompt({
      turnId: 'mcp-revoked',
      signal: new AbortController().signal,
      prompt: async (snapshot) => {
        entered.resolve();
        await release.promise;
        return f.complete(snapshot);
      },
    });
    f.grant();
    await entered.promise;
    await f.control.invalidate();
    release.resolve();
    await expect(result).rejects.toThrow();
    expect(f.control.needsReplacement(f.config.selection)).toBe(true);
    expect(f.stops).toEqual(['stopped']);
  });
  it('requires a new worker for changed selection or connection revision, never a silent credential swap', () => {
    const f = fixture();
    expect(f.control.needsReplacement(f.config.selection)).toBe(false);
    expect(f.control.needsReplacement({ ...f.config.selection, thinking: 'high' })).toBe(true);
    expect(() =>
      f.control.needsReplacement({ ...f.config.selection, connectionId: 'missing' })
    ).toThrow('harness_connection_unavailable');
    f.broker.exchange({
      version: 1,
      connections: [{ ...f.config.connection, revision: 2 }],
      reports: [],
    });
    expect(f.control.needsReplacement(f.config.selection)).toBe(true);
    expect(f.packets).toEqual([]);
    expect(f.stops).toEqual([]);
    f.pipe.destroy();
  });
  it.each([false, true])(
    'refuses late success after revocation, including failed process cleanup (%s)',
    async (stopFails) => {
      const f = fixture(stopFails);
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      let complete!: () => void;
      const settle = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const result = f.control.prompt({
        turnId: 'revoked-turn',
        signal: new AbortController().signal,
        prompt: async (snapshot) => {
          started();
          await settle;
          return f.complete(snapshot);
        },
      });
      f.grant();
      await ready;
      f.broker.exchange({ version: 1, connections: [], reports: [] });
      complete();
      if (stopFails) await expect(result).rejects.toThrow('harness_worker_exit_unconfirmed');
      else await expect(result).rejects.toThrow();
      await expect(
        f.control.prompt({
          turnId: 'later',
          signal: new AbortController().signal,
          prompt: async (snapshot) => f.complete(snapshot),
        })
      ).rejects.toThrow('harness_worker_unavailable');
      f.pipe.destroy();
    }
  );
  it('rejects changed or missing model selections instead of running the old model', () => {
    const f = fixture();
    expect(() => f.control.assertSelection(f.config.selection)).not.toThrow();
    expect(() => f.control.assertSelection(undefined)).toThrow(
      'harness_model_selection_requires_new_worker'
    );
    expect(() =>
      f.control.assertSelection({ ...f.config.selection, modelId: 'different' })
    ).toThrow('harness_model_selection_requires_new_worker');
    expect(f.packets).toEqual([]);
    f.pipe.destroy();
  });
  it('sends only public bootstrap and bound private grants; ACP receives no secret', async () => {
    const f = fixture();
    await f.control.bootstrap();
    expect(JSON.stringify(f.packets)).not.toContain('SYNTHETIC_SECRET');
    const publicSnapshots: HarnessRunSnapshot[] = [];
    const result = f.control.prompt({
      turnId: 'turn-1',
      signal: new AbortController().signal,
      prompt: async (snapshot) => {
        publicSnapshots.push(snapshot);
        return f.complete(snapshot);
      },
    });
    f.grant();
    expect((await result).stopReason).toBe('end_turn');
    expect(JSON.stringify(publicSnapshots)).not.toContain('SYNTHETIC_SECRET');
    expect(f.packets[1]).toMatchObject({
      type: 'credential',
      apiKey: 'SYNTHETIC_SECRET',
      runtimeEpoch: f.config.runtimeEpoch,
    });
    expect(f.stops).toEqual([]);
    f.pipe.destroy();
  });

  it('freezes auto-review into every run snapshot', async () => {
    const f = fixture();
    await f.control.bootstrap();
    const snapshots: HarnessRunSnapshot[] = [];
    const result = f.control.prompt({
      turnId: 'turn-auto',
      signal: new AbortController().signal,
      prompt: async (snapshot) => {
        snapshots.push(snapshot);
        return f.complete(snapshot);
      },
    });
    f.grant();
    await result;
    expect(snapshots.map((snapshot) => snapshot.permissionMode)).toEqual(['auto-review']);
    f.pipe.destroy();
  });

  it.each(['missing', 'stale', 'failed'] as const)(
    'refuses a resolved ACP prompt with %s native proof',
    async (kind) => {
      const f = fixture();
      const result = f.control.prompt({
        turnId: 'turn-1',
        signal: new AbortController().signal,
        prompt: async (snapshot) =>
          kind === 'missing'
            ? { stopReason: 'end_turn' }
            : {
                ...f.complete(snapshot),
                _meta: {
                  ...f.complete(snapshot)._meta,
                  ...(kind === 'stale'
                    ? { mollyRuntimeEpoch: randomUUID() }
                    : { mollyNativeOutcome: { status: 'failed', errorCode: 'provider' } }),
                },
              },
      });
      f.grant();
      await expect(result).rejects.toThrow('harness_native_outcome_invalid');
      expect(f.stops).toEqual(['stopped']);
      await expect(
        f.control.prompt({
          turnId: 'turn-2',
          signal: new AbortController().signal,
          prompt: async (snapshot) => f.complete(snapshot),
        })
      ).rejects.toThrow('harness_worker_unavailable');
    }
  );

  it('cancel before grant retires the worker without dispatching a model request', async () => {
    const f = fixture();
    const controller = new AbortController();
    const dispatched: string[] = [];
    const result = f.control.prompt({
      turnId: 'turn-1',
      signal: controller.signal,
      prompt: async (snapshot) => {
        dispatched.push(snapshot.runId);
        return f.complete(snapshot);
      },
    });
    controller.abort();
    await expect(result).rejects.toThrow('harness_run_retired');
    expect(dispatched).toEqual([]);
    expect(f.packets).toEqual([]);
    expect(f.stops).toEqual(['stopped']);
  });
});
