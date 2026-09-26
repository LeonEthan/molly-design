import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpServer, PromptResponse } from '@agentclientprotocol/sdk';
import type { WorkerConfig } from '@molly/harness-pi/worker-config';
import {
  HarnessImageImportRequestSchema,
  HarnessImageRecoveryRequestSchema,
  type HarnessImageImportResult,
  type HarnessRunSnapshot,
  type McpCredentialBinding,
  type ProtectedImageConnection,
  MOLLY_BUILTIN_MCP_CONNECTION,
} from '@molly/shared/embedded-harness';
import { HarnessCredentialBroker } from './harness-credential-broker';
import { EmbeddedHarnessControl } from './embedded-harness-control';

const brokers: HarnessCredentialBroker[] = [];
afterEach(() => {
  for (const broker of brokers.splice(0)) broker.dispose();
});
function fixture(
  stopFails = false,
  mcpConnections: McpCredentialBinding[] = [],
  imageServers: McpServer[] = [],
  recoveryEnabled = false,
  imageConnection?: ProtectedImageConnection
) {
  const broker = new HarnessCredentialBroker();
  brokers.push(broker);
  const config: WorkerConfig = {
    schemaVersion: 1,
    runtimeEpoch: randomUUID(),
    productSessionId: 'synthetic-session',
    workspaceId: 'workspace',
    privateRoot: '/private/molly-test',
    designImageImport: imageServers.length > 0,
    designImageRecovery: recoveryEnabled,
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
  control.configureMcp([
    ...imageServers,
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
  return { broker, config, control, pipe, packets, stops, grant, complete, binding };
}

describe('owned worker host control', () => {
  it.each([
    'owned',
    'wrong-run',
    'wrong-turn',
    'wrong-epoch',
    'wrong-session',
    'disabled',
    'revoked',
  ] as const)(
    'keeps local recovery inside its active design owner without the old MCP connection (%s)',
    async (mode) => {
      const f = fixture(false, [], [], mode !== 'disabled');
      const received: unknown[] = [];
      let previous: ReturnType<typeof HarnessImageRecoveryRequestSchema.parse> | undefined;
      const receive = async (request: unknown, signal: AbortSignal) => {
        received.push(request);
        if (mode === 'revoked') await f.control.invalidate();
        if (mode === 'revoked') expect(signal.aborted).toBe(true);
        return { kind: 'listed' as const, operations: [] };
      };
      const result = f.control.prompt({
        turnId: 'turn',
        signal: new AbortController().signal,
        prompt: async (snapshot) => {
          const request = HarnessImageRecoveryRequestSchema.parse({
            version: 1,
            runId: mode === 'wrong-run' ? 'b'.repeat(64) : snapshot.runId,
            turnId: mode === 'wrong-turn' ? 'foreign' : snapshot.turnId,
            runtimeEpoch: mode === 'wrong-epoch' ? randomUUID() : snapshot.runtimeEpoch,
            productSessionId: mode === 'wrong-session' ? 'foreign' : snapshot.sessionId,
            toolCallId: 'recover',
            requestDigest: 'a'.repeat(64),
            query: {},
          });
          previous = request;
          if (mode === 'owned')
            await expect(f.control.recoverImages(request, receive)).resolves.toEqual({
              kind: 'listed',
              operations: [],
            });
          else await expect(f.control.recoverImages(request, receive)).rejects.toThrow();
          return f.complete(snapshot);
        },
      });
      f.grant();
      if (mode === 'revoked') await expect(result).rejects.toThrow();
      else await result;
      if (!previous) throw new Error('missing request');
      await expect(f.control.recoverImages(previous, receive)).rejects.toThrow(
        'harness_image_recovery_not_owned'
      );
      expect(received).toEqual(['owned', 'revoked'].includes(mode) ? [previous] : []);
    }
  );
  it.each([
    'owned',
    'wrong-run',
    'wrong-turn',
    'wrong-epoch',
    'wrong-session',
    'wrong-connection',
    'wrong-revision',
    'wrong-tool',
    'revoked',
  ] as const)(
    'imports only within the active design run and selected catalog (%s)',
    async (mode) => {
      const f = fixture(
        false,
        [],
        [
          {
            type: 'http',
            name: 'images',
            url: 'https://images.invalid/mcp',
            headers: [],
            _meta: {
              mollyConnection: { id: 'images', revision: 2 },
              mollyImageBinding: {
                version: 1,
                model: 'synthetic-image',
                generate: { tool: 'generate', fields: { prompt: 'prompt', model: 'model' } },
              },
            },
          },
        ]
      );
      const controller = new AbortController();
      const received: unknown[] = [];
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
      const result = f.control.prompt({
        turnId: 'turn',
        signal: controller.signal,
        prompt: async (snapshot) => {
          const request = HarnessImageImportRequestSchema.parse({
            version: 1,
            runId: mode === 'wrong-run' ? 'c'.repeat(64) : snapshot.runId,
            runtimeEpoch: mode === 'wrong-epoch' ? randomUUID() : snapshot.runtimeEpoch,
            productSessionId: mode === 'wrong-session' ? 'foreign' : snapshot.sessionId,
            turnId: mode === 'wrong-turn' ? 'foreign' : snapshot.turnId,
            connectionId: mode === 'wrong-connection' ? 'foreign' : 'images',
            connectionRevision: mode === 'wrong-revision' ? 3 : 2,
            serverName: 'images',
            toolName: mode === 'wrong-tool' ? 'edit' : 'generate',
            toolCallId: 'call',
            requestDigest: 'b'.repeat(64),
            images: [{ mimeType: 'image/png', data: 'AAAA' }],
          });
          const receive = async (_request: unknown, signal: AbortSignal) => {
            received.push(_request);
            if (mode === 'revoked') await f.control.invalidate();
            if (mode === 'revoked') expect(signal.aborted).toBe(true);
            return assets;
          };
          if (mode === 'owned')
            await expect(f.control.importImages(request, receive)).resolves.toEqual(assets);
          else await expect(f.control.importImages(request, receive)).rejects.toThrow();
          return f.complete(snapshot);
        },
      });
      f.grant();
      if (mode === 'revoked') await expect(result).rejects.toThrow();
      else await result;
      expect(received).toEqual(
        ['owned', 'revoked'].includes(mode)
          ? [expect.objectContaining({ connectionRevision: 2 })]
          : []
      );
    }
  );
  it.each(['owned', 'wrong-id', 'wrong-revision', 'wrong-tool', 'unselected', 'revoked'] as const)(
    'binds built-in image import to the frozen image connection, not MCP contract revision (%s)',
    async (mode) => {
      const imageConnection: ProtectedImageConnection = {
        id: '00000000-0000-4000-8000-000000000001',
        revision: 7,
        enabled: true,
        baseUrl: 'https://images.invalid/v1',
        model: 'synthetic-image',
        hasApiKey: true,
        legacyHistoryMayContainKey: false,
      };
      const f = fixture(
        false,
        [],
        [
          {
            type: 'http',
            name: mode === 'unselected' ? 'other-server' : 'molly',
            url: 'http://127.0.0.1:1234/mcp',
            headers: [],
            _meta: { mollyConnection: MOLLY_BUILTIN_MCP_CONNECTION },
          },
        ],
        false,
        imageConnection
      );
      const received: unknown[] = [];
      const execution = f.control.prompt({
        turnId: 'turn',
        signal: new AbortController().signal,
        prompt: async (snapshot) => {
          const request = HarnessImageImportRequestSchema.parse({
            version: 1,
            runId: snapshot.runId,
            runtimeEpoch: snapshot.runtimeEpoch,
            productSessionId: snapshot.sessionId,
            turnId: snapshot.turnId,
            serverName: 'molly',
            connectionId:
              mode === 'wrong-id' ? MOLLY_BUILTIN_MCP_CONNECTION.id : imageConnection.id,
            connectionRevision: mode === 'wrong-revision' ? 8 : 7,
            toolName: mode === 'wrong-tool' ? 'molly_render_preview' : 'molly_generate_image',
            toolCallId: 'builtin-call',
            requestDigest: 'b'.repeat(64),
            images: [{ mimeType: 'image/png', data: 'AAAA' }],
          });
          if (mode === 'revoked')
            f.broker.exchange({
              version: 1,
              connections: [f.config.connection],
              reports: [],
              imageConnection: { ...imageConnection, revision: 8 },
            });
          const receive = async (value: unknown) => {
            received.push(value);
            return { assets: [] };
          };
          if (mode === 'owned')
            await expect(f.control.importImages(request, receive)).resolves.toEqual({ assets: [] });
          else
            await expect(f.control.importImages(request, receive)).rejects.toThrow(
              'harness_image_import_not_owned'
            );
          return f.complete(snapshot);
        },
      });
      f.grant();
      if (mode === 'revoked') await expect(execution).rejects.toThrow();
      else await execution;
      expect(received).toEqual(
        mode === 'owned'
          ? [expect.objectContaining({ connectionId: imageConnection.id, connectionRevision: 7 })]
          : []
      );
    }
  );
  it('prepares authenticated MCP over the private pipe before granting inference with the final frozen toolset', async () => {
    const binding: McpCredentialBinding = {
      workspaceId: 'workspace',
      serverId: 'protected',
      credentialRef: randomUUID(),
      revision: 1,
      destination: { transport: 'http', url: 'https://mcp.invalid/mcp' },
      fieldNames: ['Authorization'],
    };
    const f = fixture(false, [binding]);
    const prepared = Promise.withResolvers<void>();
    const modelRequested = Promise.withResolvers<void>();
    const acquire = f.broker.acquire.bind(f.broker);
    f.broker.acquire = (...args) => {
      const lease = acquire(...args);
      modelRequested.resolve();
      return lease;
    };
    const snapshots: HarnessRunSnapshot[] = [];
    const result = f.control.prompt({
      turnId: 'protected-turn',
      signal: new AbortController().signal,
      prepareMcp: async (preparation) => {
        expect(JSON.stringify(preparation)).not.toContain('SYNTHETIC_MCP');
        expect(f.packets).toMatchObject([
          {
            type: 'mcp-credentials',
            credentials: [{ connection: binding, values: { Authorization: 'SYNTHETIC_MCP' } }],
          },
        ]);
        prepared.resolve();
        return { ...f.binding, toolsetHash: '2'.repeat(64) };
      },
      prompt: async (snapshot) => {
        snapshots.push(snapshot);
        return f.complete(snapshot);
      },
    });
    expect(f.packets).toEqual([]);
    const [request] = f.broker.pendingMcpRequests();
    expect(request).toBeDefined();
    expect(
      f.broker.exchange({
        version: 1,
        connections: [f.config.connection],
        mcpConnections: [binding],
        reports: [],
        mcpReports: [
          {
            requestId: request!.requestId,
            runId: request!.preparation.runId,
            runtimeEpoch: f.config.runtimeEpoch,
            credentialRef: binding.credentialRef,
            credentialRevision: 1,
            result: { ok: true, values: { Authorization: 'SYNTHETIC_MCP' } },
          },
        ],
      })
    ).toEqual([]);
    await prepared.promise;
    await modelRequested.promise;
    f.grant();
    expect((await result).stopReason).toBe('end_turn');
    expect(snapshots).toMatchObject([{ toolsetHash: '2'.repeat(64), mcpConnections: [binding] }]);
    expect(JSON.stringify(snapshots)).not.toContain('SYNTHETIC_MCP');
    expect(f.broker.pendingMcpRequests()).toEqual([]);
    expect(f.stops).toEqual([]);
    f.pipe.destroy();
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

  it('freezes the requested permission mode into the run snapshot', async () => {
    const f = fixture();
    await f.control.bootstrap();
    const snapshots: HarnessRunSnapshot[] = [];
    const result = f.control.prompt({
      turnId: 'turn-auto',
      signal: new AbortController().signal,
      permissionMode: 'auto-review',
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
