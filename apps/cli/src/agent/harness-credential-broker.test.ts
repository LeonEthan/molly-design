import { describe, expect, it, vi } from 'vitest';
import type {
  HarnessRunSnapshot,
  ProtectedImageConnection,
  HarnessMcpPreparation,
  McpCredentialBinding,
  HarnessMcpCredentialReport,
} from '@molly/shared/embedded-harness';
import { HarnessCredentialBroker } from './harness-credential-broker';

const connection = {
  schemaVersion: 1 as const,
  id: 'connection',
  revision: 1,
  providerPresetId: 'openai' as const,
  displayName: 'Synthetic',
  baseUrl: 'https://example.invalid/v1',
  credentialRef: 'ref',
  enabled: true,
};
const snapshot: HarnessRunSnapshot = {
  schemaVersion: 1,
  runId: 'run',
  runtimeEpoch: 'epoch',
  sessionId: 'session',
  turnId: 'turn',
  connection,
  selection: { connectionId: connection.id, modelId: 'explicit', thinking: 'off' },
  harness: {
    id: 'molly',
    engine: 'pi',
    engineVersion: '0.85.1',
    buildId: 'test',
    protocolVersion: 1,
  },
  pluginSetHash: '0'.repeat(64),
  toolsetHash: '0'.repeat(64),
  permissionProfileId: 'test',
};
function fixture(imageConnection?: ProtectedImageConnection) {
  const broker = new HarnessCredentialBroker();
  broker.exchange({ version: 1, connections: [connection], reports: [], imageConnection });
  const controller = new AbortController();
  const revoked: string[] = [];
  const lease = broker.acquire(
    { ...snapshot, imageConnection },
    {
      signal: controller.signal,
      active: () => true,
      revoke: () => revoked.push('revoked'),
    }
  );
  const requests = broker.exchange({
    version: 1,
    connections: [connection],
    reports: [],
    imageConnection,
  });
  const request = requests[0]!;
  const report = {
    requestId: request.requestId,
    runId: 'run',
    runtimeEpoch: 'epoch',
    connectionId: 'connection',
    connectionRevision: 1,
    result: { ok: true as const, apiKey: 'synthetic-canary' },
  };
  return { broker, controller, revoked, lease, request, report };
}

describe('main to owned-worker credential handoff', () => {
  function mcpFixture() {
    const broker = new HarnessCredentialBroker();
    const bindings: McpCredentialBinding[] = [1, 2].map((index) => ({
      workspaceId: 'workspace',
      serverId: `server-${index}`,
      credentialRef: `00000000-0000-4000-8000-00000000000${index}`,
      revision: 1,
      destination: { transport: 'http', url: `https://mcp${index}.invalid/mcp` },
      fieldNames: ['Authorization'],
    }));
    const preparation: HarnessMcpPreparation = {
      version: 1,
      runId: 'run',
      runtimeEpoch: 'epoch',
      sessionId: 'session',
      turnId: 'turn',
      workspaceId: 'workspace',
      connection,
      mcpConnections: bindings,
    };
    const controller = new AbortController();
    const revoked: string[] = [];
    const exchange = (mcpReports: HarnessMcpCredentialReport[] = [], mcpConnections = bindings) =>
      broker.exchange({
        version: 1,
        connections: [connection],
        reports: [],
        mcpConnections,
        mcpReports,
      });
    exchange();
    const options = {
      signal: controller.signal,
      active: () => !controller.signal.aborted,
      revoke: () => {
        revoked.push('retired');
        controller.abort();
      },
    };
    const lease = broker.acquireMcp(preparation, options);
    const requests = broker.pendingMcpRequests();
    const reports: HarnessMcpCredentialReport[] = requests.map((request, index) => ({
      requestId: request.requestId,
      runId: preparation.runId,
      runtimeEpoch: preparation.runtimeEpoch,
      credentialRef: request.connection.credentialRef,
      credentialRevision: request.connection.revision,
      result: { ok: true, values: { Authorization: `SYNTHETIC_${index}` } },
    }));
    return {
      broker,
      preparation,
      options,
      bindings,
      controller,
      revoked,
      exchange,
      lease,
      requests,
      reports,
    };
  }

  it('matches each MCP grant to its exact server/ref/revision/epoch and keeps public exchange secret-free', async () => {
    const f = mcpFixture();
    try {
      for (const changed of [
        { credentialRef: f.bindings[1]!.credentialRef },
        { credentialRevision: 2 },
        { runtimeEpoch: 'stale' },
        { runId: 'other' },
      ]) {
        f.exchange([{ ...f.reports[0]!, ...changed }]);
        expect(f.broker.pendingMcpRequests()).toEqual(f.requests);
      }
      expect(f.exchange(f.reports)).toEqual([]);
      expect(await f.lease.credentials).toEqual(
        f.bindings.map((binding, index) => ({
          connection: binding,
          values: { Authorization: `SYNTHETIC_${index}` },
        }))
      );
      expect(f.broker.pendingMcpRequests()).toEqual([]);
      expect(
        JSON.stringify({ catalog: f.broker.mcpCatalog(), requests: f.requests })
      ).not.toContain('SYNTHETIC_');
      f.lease.release();
      f.exchange(f.reports);
      expect(f.broker.pendingMcpRequests()).toEqual([]);
    } finally {
      f.broker.dispose();
    }
  });

  it.each(['rotate', 'delete', 'cancel', 'bad-fields', 'unavailable', 'host-timeout'] as const)(
    'retires MCP acquisition on %s without accepting late reports',
    async (reason) => {
      vi.useFakeTimers();
      const f = mcpFixture();
      const rejected = expect(f.lease.credentials).rejects.toThrow('harness_run_retired');
      try {
        if (reason === 'rotate')
          f.exchange(
            [],
            f.bindings.map((binding) => ({ ...binding, revision: 2 }))
          );
        if (reason === 'delete') f.exchange([], []);
        if (reason === 'cancel') f.controller.abort();
        if (reason === 'bad-fields')
          f.exchange([{ ...f.reports[0]!, result: { ok: true, values: { Wrong: 'SYNTHETIC' } } }]);
        if (reason === 'unavailable')
          f.exchange([
            { ...f.reports[0]!, result: { ok: false, error: 'credential_unavailable' } },
          ]);
        if (reason === 'host-timeout') await vi.advanceTimersByTimeAsync(10_000);
        await rejected;
        f.lease.release();
        f.exchange(f.reports);
        expect(f.broker.pendingMcpRequests()).toEqual([]);
      } finally {
        f.broker.dispose();
        vi.useRealTimers();
      }
    }
  );

  it('revokes an already delivered MCP grant on rotation and refuses unauthorized preparation bindings', async () => {
    const f = mcpFixture();
    try {
      for (const patch of [
        { serverId: 'other' },
        { revision: 2 },
        { destination: { transport: 'http' as const, url: 'https://other.invalid' } },
      ])
        expect(() =>
          f.broker.acquireMcp(
            { ...f.preparation, mcpConnections: [{ ...f.bindings[0]!, ...patch }] },
            f.options
          )
        ).toThrow('harness_mcp_credential_unavailable');
      expect(() =>
        f.broker.acquireMcp(f.preparation, { ...f.options, active: () => false })
      ).toThrow('harness_run_retired');
      f.exchange(f.reports);
      await f.lease.credentials;
      f.exchange(
        [],
        f.bindings.map((binding) => ({ ...binding, revision: 2 }))
      );
      expect(f.controller.signal.aborted).toBe(true);
      expect(f.revoked).toContain('retired');
      expect(f.broker.pendingMcpRequests()).toEqual([]);
    } finally {
      f.broker.dispose();
    }
  });
  it('never acquires an image connection that was added after the model run started', async () => {
    const f = fixture();
    try {
      f.broker.exchange({
        version: 1,
        connections: [connection],
        reports: [f.report],
        imageConnection: {
          id: '00000000-0000-4000-8000-000000000001',
          revision: 1,
          enabled: true,
          baseUrl: 'https://images.invalid/v1',
          model: 'image',
          hasApiKey: true,
          legacyHistoryMayContainKey: false,
        },
      });
      await f.lease.credential;
      await expect(f.broker.acquireImageForSession('session')).rejects.toThrow(
        'image_connection_unavailable'
      );
    } finally {
      f.broker.dispose();
    }
  });

  it('revokes the owning run when its frozen image connection changes before first use', async () => {
    const imageConnection: ProtectedImageConnection = {
      id: '00000000-0000-4000-8000-000000000001',
      revision: 1,
      enabled: true,
      baseUrl: 'https://images.invalid/v1',
      model: 'image',
      hasApiKey: true,
      legacyHistoryMayContainKey: false,
    };
    const f = fixture(imageConnection);
    try {
      f.broker.exchange({
        version: 1,
        connections: [connection],
        reports: [f.report],
        imageConnection,
      });
      await f.lease.credential;
      f.broker.exchange({
        version: 1,
        connections: [connection],
        reports: [],
        imageConnection: { ...imageConnection, revision: 2 },
      });
      expect(f.revoked).toEqual(['revoked']);
      await expect(f.broker.acquireImageForSession('session')).rejects.toThrow(
        'image_connection_unavailable'
      );
    } finally {
      f.broker.dispose();
    }
  });
  it('binds image credentials to an active model run, exact revision and parent lifetime', async () => {
    const imageConnection = {
      id: '00000000-0000-4000-8000-000000000001',
      revision: 1,
      enabled: true,
      baseUrl: 'https://images.invalid/v1',
      model: 'image',
      hasApiKey: true,
      legacyHistoryMayContainKey: false,
    };
    const f = fixture(imageConnection);
    try {
      f.broker.exchange({
        version: 1,
        connections: [connection],
        imageConnection,
        reports: [f.report],
      });
      await f.lease.credential;
      await expect(f.broker.acquireImageForSession('other-session')).rejects.toThrow(
        'image_connection_unavailable'
      );
      const pendingImage = f.broker.acquireImageForSession('session');
      const requests = f.broker.exchange({
        version: 1,
        connections: [connection],
        imageConnection,
        reports: [],
      });
      expect(requests.map((request) => request.imageConnection)).toEqual([imageConnection]);
      const imageRequest = requests[0]!;
      const report = {
        ...f.report,
        requestId: imageRequest.requestId,
        imageConnectionId: imageConnection.id,
        imageConnectionRevision: 1,
        result: { ok: true as const, apiKey: 'synthetic-image-key' },
      };
      expect(
        f.broker.exchange({
          version: 1,
          connections: [connection],
          imageConnection,
          reports: [{ ...report, imageConnectionRevision: 2 }],
        })
      ).toEqual(requests);
      f.broker.exchange({
        version: 1,
        connections: [connection],
        imageConnection,
        reports: [report],
      });
      expect(await pendingImage).toEqual({
        connection: imageConnection,
        apiKey: 'synthetic-image-key',
      });
      expect(await f.broker.acquireImageForSession('session')).toEqual(await pendingImage);
      f.lease.release();
      await expect(f.broker.acquireImageForSession('session')).rejects.toThrow(
        'image_connection_unavailable'
      );
      expect(
        f.broker.exchange({
          version: 1,
          connections: [connection],
          imageConnection,
          reports: [report],
        })
      ).toEqual([]);
    } finally {
      f.broker.dispose();
    }
  });

  it('revokes an active worker when the frozen model connection revision changes', async () => {
    const f = fixture();
    try {
      f.broker.exchange({ version: 1, connections: [connection], reports: [f.report] });
      await f.lease.credential;
      f.broker.exchange({ version: 1, connections: [{ ...connection, revision: 2 }], reports: [] });
      expect(f.revoked).toEqual(['revoked']);
    } finally {
      f.broker.dispose();
    }
  });
  it('revokes a live worker and its catalog when the main-process heartbeat expires', async () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.broker.exchange({ version: 1, connections: [connection], reports: [f.report] });
      await f.lease.credential;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(f.broker.catalog()).toEqual([]);
      expect(f.revoked).toEqual(['revoked']);
    } finally {
      f.broker.dispose();
      vi.useRealTimers();
    }
  });
  it('only consumes a complete matching lease and never includes secrets in exchange results', async () => {
    const f = fixture();
    const pending = f.broker.exchange({
      version: 1,
      connections: [connection],
      reports: [{ ...f.report, runtimeEpoch: 'stale' }],
    });
    expect(pending).toEqual([f.request]);
    const result = f.broker.exchange({
      version: 1,
      connections: [connection],
      reports: [f.report],
    });
    expect(result).toEqual([]);
    expect(await f.lease.credential).toBe('synthetic-canary');
    expect(JSON.stringify({ result, catalog: f.broker.catalog() })).not.toContain(
      'synthetic-canary'
    );
    f.lease.release();
  });

  it('rejects arbitrary references, changed endpoints and inactive runs', () => {
    const f = fixture();
    void f.lease.credential.catch(() => undefined);
    for (const changed of [
      { ...connection, credentialRef: 'other' },
      { ...connection, baseUrl: 'https://other.invalid' },
    ]) {
      expect(() =>
        f.broker.acquire(
          { ...snapshot, connection: changed },
          { signal: f.controller.signal, active: () => true, revoke: () => undefined }
        )
      ).toThrow('harness_connection_unavailable');
    }
    expect(() =>
      f.broker.acquire(snapshot, {
        signal: f.controller.signal,
        active: () => false,
        revoke: () => undefined,
      })
    ).toThrow('harness_run_retired');
    f.lease.release();
  });

  it('revokes acquired workers after disable and drops late reports after cancellation', async () => {
    const first = fixture();
    first.broker.exchange({ version: 1, connections: [connection], reports: [first.report] });
    await first.lease.credential;
    first.broker.exchange({
      version: 1,
      connections: [{ ...connection, enabled: false }],
      reports: [],
    });
    expect(first.revoked).toEqual(['revoked']);
    const second = fixture();
    const rejected = expect(second.lease.credential).rejects.toThrow('harness_run_retired');
    second.controller.abort();
    await rejected;
    expect(
      second.broker.exchange({ version: 1, connections: [connection], reports: [second.report] })
    ).toEqual([]);
  });
});
