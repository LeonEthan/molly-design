import { createHash } from 'node:crypto';
import type { McpServer, PromptResponse } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import {
  PI_ENGINE_VERSION,
  type HarnessSessionBinding,
  type McpCredentialBinding,
} from '../src/embedded-harness';
import {
  acceptRunResponse,
  acceptRunSnapshot,
  acceptSessionBinding,
  buildRunSnapshot,
  readMcpBindings,
  readRunIdentity,
  readRunResponseMeta,
  runRequestMeta,
  runResponseMeta,
} from '../src/embedded-run-contract';

const config = {
  runtimeEpoch: '00000000-0000-4000-8000-000000000001',
  productSessionId: 'synthetic-session',
  harness: {
    id: 'molly',
    engine: 'pi',
    engineVersion: PI_ENGINE_VERSION,
    buildId: 'test',
    protocolVersion: 1,
  },
  connection: {
    schemaVersion: 1,
    id: 'connection',
    revision: 1,
    providerPresetId: 'openai',
    displayName: 'Synthetic',
    baseUrl: 'https://example.invalid/v1',
    credentialRef: 'ref',
    enabled: true,
  },
  selection: { connectionId: 'connection', modelId: 'explicit', thinking: 'off' },
  permissionProfileId: 'ask',
} as const;
const binding: HarnessSessionBinding = {
  version: 1,
  runtimeEpoch: config.runtimeEpoch,
  harness: config.harness,
  toolsetHash: '0'.repeat(64),
  pluginSetHash: '1'.repeat(64),
  nativeSessionFile: '/synthetic/native.jsonl',
};
const credential: McpCredentialBinding = {
  workspaceId: 'workspace',
  serverId: 'server',
  credentialRef: config.runtimeEpoch,
  revision: 1,
  destination: { transport: 'http', url: 'https://mcp.invalid/mcp' },
  fieldNames: ['Authorization'],
};
const server: McpServer = {
  type: 'http',
  name: 'Synthetic',
  url: 'https://mcp.invalid/mcp',
  headers: [],
  _meta: {
    mollyConnection: { id: credential.serverId, revision: 1 },
    mollyMcpCredential: credential,
  },
};
const mcpConnections = [credential];
const expected = { config, binding, mcpConnections };
const snapshot = buildRunSnapshot({ ...expected, turnId: 'turn' });
const outcome = { status: 'completed', nativeEndEntryId: 'native' } as const;
const response: PromptResponse = {
  stopReason: 'end_turn',
  _meta: runResponseMeta({ snapshot, outcome }),
};

describe('embedded run contract', () => {
  it.each([{ connections: [] }, { connections: mcpConnections }])(
    'builds and accepts the same snapshot with MCP %j',
    ({ connections }) => {
      const built = buildRunSnapshot({
        config,
        binding,
        mcpConnections: connections,
        turnId: 'turn',
      });
      expect(
        acceptRunSnapshot(JSON.parse(JSON.stringify(built)), {
          config,
          binding,
          mcpConnections: connections,
        })
      ).toEqual({ ok: true, value: built });
      expect(built.runId).toBe(
        createHash('sha256')
          .update(JSON.stringify([config.productSessionId, 'turn']))
          .digest('hex')
      );
      expect(built.permissionMode).toBeUndefined();
      if (!connections.length) expect(built).not.toHaveProperty('mcpConnections');
    }
  );

  it('preserves request and response JSON bytes and typed metadata', () => {
    expect(JSON.stringify(runRequestMeta(snapshot))).toBe(
      JSON.stringify({ mollyRunSnapshot: snapshot })
    );
    expect(readRunIdentity(runRequestMeta(snapshot))).toEqual({
      ok: true,
      value: { runId: snapshot.runId, runtimeEpoch: snapshot.runtimeEpoch },
    });
    const meta = runResponseMeta({
      snapshot,
      outcome,
      memory: 'capture_failed',
      memoryDiagnostic: 'synthetic_failure',
    });
    expect(JSON.stringify(meta)).toBe(
      JSON.stringify({
        mollyPersonalMemory: 'capture_failed',
        mollyPersonalMemoryDiagnostic: 'synthetic_failure',
        mollyRunId: snapshot.runId,
        mollyRuntimeEpoch: snapshot.runtimeEpoch,
        mollyNativeOutcome: outcome,
      })
    );
    expect(acceptRunResponse({ stopReason: 'end_turn', _meta: meta }, snapshot)).toEqual({
      ok: true,
      value: { outcome, memory: 'capture_failed', memoryDiagnostic: 'synthetic_failure' },
    });
    expect(
      readRunResponseMeta({
        ...meta,
        mollyPersonalMemory: {},
        mollyPersonalMemoryDiagnostic: 'unsafe\ntext',
      })
    ).toEqual({
      ok: true,
      value: { runId: snapshot.runId, runtimeEpoch: snapshot.runtimeEpoch, outcome },
    });
  });

  it.each([undefined, {}, { mollyRunSnapshot: { runId: 'run', runtimeEpoch: 'invalid' } }])(
    'refuses invalid request identity %j',
    (meta) => {
      expect(readRunIdentity(meta)).toEqual({
        ok: false,
        mismatch: { reason: 'snapshot', field: 'identity' },
      });
    }
  );

  it.each([
    ['schema', { ...snapshot, schemaVersion: 2 }],
    ['schema', { ...snapshot, extra: true }],
    ['schema', { ...snapshot, selection: { ...config.selection, connectionId: 'other' } }],
    ['runtimeEpoch', { ...snapshot, runtimeEpoch: 'other' }],
    ['sessionId', { ...snapshot, sessionId: 'other' }],
    ['harness', { ...snapshot, harness: { ...config.harness, buildId: 'other' } }],
    ['connection', { ...snapshot, connection: { ...config.connection, revision: 2 } }],
    ['selection', { ...snapshot, selection: { ...config.selection, modelId: 'other' } }],
    ['permissionProfileId', { ...snapshot, permissionProfileId: 'other' }],
    ['permissionMode', { ...snapshot, permissionMode: 'auto-review' }],
    ['toolsetHash', { ...snapshot, toolsetHash: '2'.repeat(64) }],
    ['pluginSetHash', { ...snapshot, pluginSetHash: '2'.repeat(64) }],
    ['mcpConnections', { ...snapshot, mcpConnections: [] }],
  ])('refuses snapshot mismatch %s', (field, raw) => {
    expect(acceptRunSnapshot(raw, expected)).toEqual({
      ok: false,
      mismatch: { reason: 'snapshot', field },
    });
  });

  it('accepts a schema-valid image binding and an explicitly empty MCP list', () => {
    const imageConnection = {
      id: config.runtimeEpoch,
      revision: 1,
      enabled: true,
      baseUrl: 'https://image.invalid/v1',
      model: 'explicit',
      hasApiKey: true,
      legacyHistoryMayContainKey: false,
    };
    const built = buildRunSnapshot({
      config,
      binding,
      mcpConnections: [],
      turnId: 'image',
      imageConnection,
    });
    expect(built.imageConnection).toEqual(imageConnection);
    expect(
      acceptRunSnapshot({ ...built, mcpConnections: [] }, { config, binding, mcpConnections: [] })
        .ok
    ).toBe(true);
  });

  it.each([
    ['schema', { ...binding, version: 2 }],
    ['runtimeEpoch', { ...binding, runtimeEpoch: '00000000-0000-4000-8000-000000000002' }],
    ['harness', { ...binding, harness: { ...binding.harness, buildId: 'other' } }],
  ])('refuses session binding mismatch %s', (field, raw) => {
    expect(acceptSessionBinding(raw, config)).toEqual({
      ok: false,
      mismatch: { reason: 'binding_identity', field },
    });
  });

  it('accepts the announced session binding', () => {
    expect(acceptSessionBinding(binding, config)).toEqual({ ok: true, value: binding });
  });

  it.each([
    ['schema', [{ ...server, _meta: { ...server._meta, mollyMcpCredential: {} } }], 'workspace'],
    ['workspaceId', [server], 'other'],
    ['workspaceId', [server], undefined],
    ['destination', [{ ...server, url: 'https://other.invalid/mcp' }], 'workspace'],
    ['serverId', [{ ...server, _meta: { mollyMcpCredential: credential } }], 'workspace'],
    [
      'serverId',
      [{ ...server, _meta: { ...server._meta, mollyConnection: { id: 'other' } } }],
      'workspace',
    ],
    ['duplicateServerId', [server, server], 'workspace'],
  ] as const)('refuses MCP binding mismatch %s', (field, servers, workspaceId) => {
    expect(readMcpBindings(servers, workspaceId)).toEqual({
      ok: false,
      mismatch: { reason: 'mcp_binding', field },
    });
  });

  it('reads HTTP and stdio bindings and skips unprotected servers', () => {
    const stdio = {
      ...credential,
      serverId: 'stdio',
      destination: { transport: 'stdio', command: '/synthetic/mcp', args: ['--serve'] },
    } as const;
    const stdioServer: McpServer = {
      name: 'stdio',
      command: stdio.destination.command,
      args: ['--serve'],
      env: [],
      _meta: { mollyConnection: { id: 'stdio' }, mollyMcpCredential: stdio },
    };
    expect(
      readMcpBindings(
        [
          server,
          { type: 'http', name: 'public', url: 'https://public.invalid', headers: [] },
          stdioServer,
        ],
        'workspace'
      )
    ).toEqual({ ok: true, value: [credential, stdio] });
    expect(readMcpBindings([{ ...stdioServer, args: [] }], 'workspace')).toEqual({
      ok: false,
      mismatch: { reason: 'mcp_binding', field: 'destination' },
    });
  });

  it.each([
    ['schema', undefined],
    ['schema', { ...response._meta, mollyNativeOutcome: { status: 'completed' } }],
    ['runId', { ...response._meta, mollyRunId: 'other' }],
    [
      'runtimeEpoch',
      { ...response._meta, mollyRuntimeEpoch: '00000000-0000-4000-8000-000000000002' },
    ],
  ])('refuses response mismatch %s', (field, meta) => {
    expect(acceptRunResponse({ ...response, _meta: meta }, snapshot)).toEqual({
      ok: false,
      mismatch: { reason: 'outcome', field },
    });
  });

  it.each(['end_turn', 'cancelled', 'max_tokens', 'refusal', 'max_turn_requests'] as const)(
    'requires native settlement consistent with %s',
    (stopReason) => {
      for (const native of [
        outcome,
        { status: 'cancelled' },
        { status: 'failed', errorCode: 'synthetic' },
        { status: 'interrupted', reason: 'synthetic' },
      ] as const) {
        const accepted =
          (stopReason === 'end_turn' && native.status === 'completed') ||
          (stopReason === 'cancelled' && native.status === 'cancelled');
        const result = acceptRunResponse(
          { stopReason, _meta: runResponseMeta({ snapshot, outcome: native }) },
          snapshot
        );
        expect(result).toEqual(
          accepted
            ? { ok: true, value: { outcome: native } }
            : { ok: false, mismatch: { reason: 'outcome', field: 'stopReason' } }
        );
      }
    }
  );
});
