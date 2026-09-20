import { describe, expect, it, vi } from 'vitest';

import type {
  McpServerId,
  SessionId,
  WorkspaceFlockReadableFlock,
  WorkspaceId,
} from '@molly/shared';
import { loadSessionMcpCatalog } from './session-mcp-resolver';

const workspaceId = 'workspace-1' as WorkspaceId;
const sessionId = 'session-1' as SessionId;
const selectedId = 'server-1' as McpServerId;

const flockWithRows = (rows: Array<{ key: readonly unknown[]; value: unknown }>) =>
  ({
    scan: ({ prefix }: { prefix?: readonly unknown[] } = {}) =>
      rows.filter(({ key }) => prefix?.every((part, index) => key[index] === part) ?? true),
  }) satisfies WorkspaceFlockReadableFlock;

const catalogFlock = flockWithRows([
  {
    key: ['mcpServer', selectedId],
    value: {
      id: selectedId,
      name: 'filesystem',
      transport: 'stdio',
      connection: {
        transport: 'stdio',
        command: '${NODE_BIN}',
        args: ['${ENTRYPOINT}'],
      },
      createdAt: 1,
      updatedAt: 1,
    },
  },
]);

describe('loadSessionMcpCatalog', () => {
  it('carries image binding only into guarded startup and revokes on a model edit', async () => {
    const imageBinding = {
      version: 1 as const,
      model: 'synthetic-image',
      generate: { tool: 'draw', fields: { prompt: 'text', model: 'model_id' } },
    };
    const rows = [
      {
        key: ['mcpServer', selectedId],
        value: {
          id: selectedId,
          name: 'images',
          transport: 'http',
          revision: 1,
          connection: { transport: 'http', url: 'https://synthetic.invalid/mcp' },
          createdAt: 1,
          updatedAt: 1,
          imageBinding,
        },
      },
    ];
    const flock = { ...flockWithRows(rows), subscribe: () => () => {} };
    const load = (guarded: boolean) =>
      loadSessionMcpCatalog({
        repo: { openFlockDoc: async () => ({ flock }) },
        workspaceId,
        sessionId,
        selectedIds: [selectedId],
        guarded,
        logger: { debug: () => {} },
      });
    const legacy = await load(false);
    expect(legacy({ http: true }).servers[0]?._meta).toBeUndefined();
    const guarded = await load(true);
    expect(guarded({ http: true }).servers[0]?._meta?.mollyImageBinding).toEqual(imageBinding);
    rows[0]!.value = { ...rows[0]!.value, imageBinding: { ...imageBinding, model: 'changed' } };
    expect(guarded.guard?.isCurrent()).toBe(false);
    expect(() => guarded({ http: true })).toThrow('harness_mcp_catalog_changed');
  });
  it('preserves a protected binding through the guarded catalog and refuses it for legacy startup', async () => {
    const binding = {
      workspaceId,
      serverId: selectedId,
      credentialRef: '00000000-0000-4000-8000-000000000001',
      revision: 2,
      destination: { transport: 'http' as const, url: 'https://synthetic.invalid/mcp' },
      fieldNames: ['Authorization'],
    };
    const flock = {
      ...flockWithRows([
        {
          key: ['mcpServer', selectedId],
          value: {
            id: selectedId,
            name: 'synthetic',
            revision: 3,
            transport: 'http',
            connection: {
              transport: 'http',
              url: binding.destination.url,
              protectedCredentials: {
                credentialRef: binding.credentialRef,
                revision: binding.revision,
              },
            },
            createdAt: 1,
            updatedAt: 1,
          },
        },
      ]),
      subscribe: () => () => {},
    };
    for (const guarded of [true, false]) {
      const select = await loadSessionMcpCatalog({
        repo: { openFlockDoc: async () => ({ flock }) },
        workspaceId,
        sessionId,
        selectedIds: [selectedId],
        guarded,
        protectedMcp: { workspaceId, connections: [binding] },
        logger: { debug: () => {} },
      });
      const result = select({ http: true });
      if (guarded)
        expect(result).toEqual({
          problems: [],
          servers: [
            {
              type: 'http',
              name: 'synthetic',
              url: binding.destination.url,
              headers: [],
              _meta: {
                mollyConnection: { id: selectedId, revision: 3 },
                mollyMcpCredential: binding,
              },
            },
          ],
        });
      else {
        expect(result.servers).toEqual([]);
        expect(result.problems).toMatchObject([{ kind: 'invalid_connection' }]);
      }
    }
  });
  it('binds a versioned server and permanently revokes its worker on same-revision edits', async () => {
    const original = {
      id: selectedId,
      name: 'synthetic',
      transport: 'stdio' as const,
      revision: 3,
      connection: { transport: 'stdio' as const, command: 'node', args: ['synthetic.mjs'] },
      createdAt: 1,
      updatedAt: 1,
    };
    const rows = [{ key: ['mcpServer', selectedId], value: original }];
    const listeners = new Set<() => void>();
    const flock = {
      ...flockWithRows(rows),
      subscribe: (notify: () => void) => {
        listeners.add(notify);
        return () => {
          listeners.delete(notify);
        };
      },
    };
    const select = await loadSessionMcpCatalog({
      repo: { openFlockDoc: async () => ({ flock }) },
      workspaceId,
      sessionId,
      selectedIds: [selectedId],
      guarded: true,
      logger: { debug: () => {} },
      env: {},
    });
    expect(select({ http: true }).servers).toEqual([
      {
        name: 'synthetic',
        command: 'node',
        args: ['synthetic.mjs'],
        env: [],
        _meta: { mollyConnection: { id: selectedId, revision: 3 } },
      },
    ]);
    const observed: string[] = [];
    const unsubscribe = select.guard!.subscribe(() => observed.push('retired'));
    rows[0]!.value = { ...original, connection: { ...original.connection, args: ['changed.mjs'] } };
    for (const notify of listeners) notify();
    expect(observed).toEqual(['retired']);
    expect(select.guard!.isCurrent()).toBe(false);
    rows[0]!.value = original;
    expect(select.guard!.isCurrent()).toBe(false);
    expect(() => select({ http: true })).toThrow('harness_mcp_catalog_changed');
    unsubscribe();
    expect(listeners.size).toBe(0);
  });

  it('keeps historical and secret-bearing startup data out of guarded ACP dispatch', async () => {
    for (const revision of [undefined, 1]) {
      const flock = {
        ...flockWithRows([
          {
            key: ['mcpServer', selectedId],
            value: {
              id: selectedId,
              name: 'synthetic',
              transport: 'http',
              revision,
              connection: {
                transport: 'http',
                url: 'https://mcp.example',
                bearerToken: 'SYNTHETIC_SECRET',
              },
              createdAt: 1,
              updatedAt: 1,
            },
          },
        ]),
        subscribe: () => () => {},
      };
      const select = await loadSessionMcpCatalog({
        repo: { openFlockDoc: async () => ({ flock }) },
        workspaceId,
        sessionId,
        selectedIds: [selectedId],
        guarded: true,
        logger: { debug: () => {} },
      });
      const result = select({ http: true });
      expect(result.servers).toEqual([]);
      expect(result.problems[0]?.kind).toBe('invalid_connection');
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET');
    }
  });
  it('does not open or sync a document for an empty selection', async () => {
    const openFlockDoc = vi.fn();
    const syncFlockDoc = vi.fn();
    const select = await loadSessionMcpCatalog({
      repo: { openFlockDoc },
      syncFlockDoc,
      workspaceId,
      sessionId,
      selectedIds: [],
      logger: { debug: vi.fn() },
    });
    expect(select(undefined)).toEqual({ servers: [], problems: [] });
    expect(openFlockDoc).not.toHaveBeenCalled();
    expect(syncFlockDoc).not.toHaveBeenCalled();
  });

  it.each([
    { transport: 'stdio', command: 'node', args: ['${PRIVATE_KEY}'] },
    { transport: 'http', url: 'https://mcp.example/${PRIVATE_KEY}' },
    { transport: 'http', url: 'https://user:SYNTHETIC_SECRET@mcp.example' },
    { transport: 'http', url: 'https://mcp.example?token=SYNTHETIC_SECRET' },
  ])('does not interpolate or forward credentials in embedded startup %#', async (connection) => {
    const flock = {
      ...flockWithRows([
        {
          key: ['mcpServer', selectedId],
          value: {
            id: selectedId,
            name: 'synthetic',
            transport: connection.transport,
            connection,
            revision: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      ]),
      subscribe: () => () => {},
    };
    const logs: string[] = [];
    const select = await loadSessionMcpCatalog({
      repo: { openFlockDoc: async () => ({ flock }) },
      workspaceId,
      sessionId,
      selectedIds: [selectedId],
      guarded: true,
      env: { PRIVATE_KEY: 'SYNTHETIC_SECRET' },
      logger: { debug: (message) => logs.push(message) },
    });
    const result = select({ http: true });
    expect(result.servers).toEqual([]);
    expect(result.problems.length).toBeGreaterThan(0);
    expect(JSON.stringify({ result, logs })).not.toContain('SYNTHETIC_SECRET');
  });

  it('reads the catalog and expands target-daemon environment variables', async () => {
    const select = await loadSessionMcpCatalog({
      repo: { openFlockDoc: vi.fn(async () => ({ flock: catalogFlock })) },
      workspaceId,
      sessionId,
      selectedIds: [selectedId],
      logger: { debug: vi.fn() },
      env: { NODE_BIN: 'node', ENTRYPOINT: 'server.js' },
    });
    expect(select(undefined)).toEqual({
      servers: [{ name: 'filesystem', command: 'node', args: ['server.js'], env: [] }],
      problems: [],
    });
  });

  it('finishes every read before the agent capabilities are known', async () => {
    const openFlockDoc = vi.fn(async () => ({ flock: catalogFlock }));
    const select = await loadSessionMcpCatalog({
      repo: { openFlockDoc },
      workspaceId,
      sessionId,
      selectedIds: [selectedId],
      logger: { debug: vi.fn() },
      env: { NODE_BIN: 'node', ENTRYPOINT: 'server.js' },
    });
    expect(openFlockDoc).toHaveBeenCalledTimes(1);

    // Selecting twice with different capabilities must not touch the document
    // again: the load phase is what ACP startup overlaps with its handshake.
    expect(select({ http: true }).servers).toHaveLength(1);
    expect(select({ http: false }).servers).toHaveLength(1);
    expect(openFlockDoc).toHaveBeenCalledTimes(1);
  });

  it('turns catalog read failures into catalog_unavailable', async () => {
    const select = await loadSessionMcpCatalog({
      repo: { openFlockDoc: vi.fn(async () => Promise.reject(new Error('database unavailable'))) },
      workspaceId,
      sessionId,
      selectedIds: [selectedId],
      logger: { debug: vi.fn() },
    });
    const result = select(undefined);
    expect(result.servers).toEqual([]);
    expect(result.problems).toEqual([
      { kind: 'catalog_unavailable', reason: 'database unavailable' },
    ]);
  });

  it('refreshes first and falls back to local rows if refresh fails', async () => {
    const order: string[] = [];
    const syncFlockDoc = vi.fn(async () => {
      order.push('sync');
      throw new Error('offline');
    });
    const openFlockDoc = vi.fn(async () => {
      order.push('open');
      return { flock: catalogFlock };
    });
    const select = await loadSessionMcpCatalog({
      repo: { openFlockDoc },
      syncFlockDoc,
      workspaceId,
      sessionId,
      selectedIds: [selectedId],
      logger: { debug: vi.fn() },
      env: { NODE_BIN: 'node', ENTRYPOINT: 'server.js' },
    });
    expect(order).toEqual(['sync', 'open']);
    expect(syncFlockDoc).toHaveBeenCalledWith('workspace-1:wf:workspace', { timeoutMs: 5_000 });
    expect(select(undefined).servers).toHaveLength(1);
  });
});
