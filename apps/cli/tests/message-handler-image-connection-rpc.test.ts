/**
 * The daemon's image-connection Machine RPC: public discovery and run-bound
 * credential acquisition behind `molly_generate_image`.
 *
 * `molly_generate_image` is exposed to design sessions only, and the daemon is
 * where that rule lives: the read method folds the asking session's identity and
 * the host's public metadata into availability. Only a live lease can acquire
 * the credential; discovery alone never grants execution. The read never opens,
 * creates, or writes a session document — asking must not materialize state.
 *
 * The retired daemon test action is rejected. Settings probes run in main using
 * the encrypted vault, independently of the design-session rule.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  IMAGE_CONNECTION_VERSION,
  LocalMachineRpcRequestSchema,
  getSessionRoomId,
  machineFlockKeys,
  type ImageConnectionSettings,
  type MachineFlockKey,
  type SessionId,
  type SessionMeta,
  type WorkspaceId,
} from '@molly/shared';

import { MessageHandler } from '../src/lib/message-handler';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { SessionManager } from '../src/session/session-manager';
import type { Logger } from '../src/utils/logger';
import type { HarnessCredentialBroker } from '../src/agent/harness-credential-broker';
import { createTestCloudPort } from './test-cloud-port';

const DESIGN_SESSION_ID = '11111111-2222-4333-8444-555555555555' as SessionId;
const CODING_SESSION_ID = '99999999-8888-7777-6666-555555555555' as SessionId;
const SECRET_KEY = 'sk-daemon-test-placeholder-not-real';

const workspaceId = 'workspace-1' as WorkspaceId;

/** Minimal in-memory flock: the connection gate reads a real stored row. */
class FakeFlock {
  readonly rows = new Map<string, { key: MachineFlockKey; value: unknown }>();

  scan(options?: { prefix?: readonly unknown[] }) {
    return [...this.rows.values()].filter((row) => {
      const prefix = options?.prefix;
      return !prefix || prefix.every((part, index) => row.key[index] === part);
    });
  }

  set(key: MachineFlockKey, value: unknown): void {
    this.rows.set(JSON.stringify(key), { key: [...key] as MachineFlockKey, value });
  }

  delete(key: MachineFlockKey): void {
    this.rows.delete(JSON.stringify(key));
  }

  commit(): void {}
}

const storedImageConnection = (
  overrides: Partial<ImageConnectionSettings> = {}
): ImageConnectionSettings => ({
  v: IMAGE_CONNECTION_VERSION,
  enabled: true,
  baseUrl: 'https://images.example.com/v1',
  apiKey: SECRET_KEY,
  model: 'gpt-image-2',
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

const sessionMeta = (sessionId: SessionId, design: boolean): Partial<SessionMeta> => ({
  id: sessionId,
  machineId: 'machine-1' as SessionMeta['machineId'],
  createdAt: new Date().toISOString(),
  ...(design ? { design: { artworkId: sessionId, path: 'design.json' } } : {}),
});

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

type SessionMetaStore = Record<
  string,
  { meta?: Partial<SessionMeta>; deleted?: boolean; unreadable?: boolean } | undefined
>;

type Harness = {
  handler: MessageHandler;
  upsertDocMeta: ReturnType<typeof vi.fn>;
  getOrCreateSessionDoc: ReturnType<typeof vi.fn>;
  announceImage: () => Promise<HarnessCredentialBroker>;
};

/**
 * `sessions` records what the raw doc-meta store answers for each session id:
 * a readable meta, a deleted document (`exists: false`), or a store failure.
 * Anything absent answers like a session that was never created.
 */
const createHandler = (options: {
  imageConnection?: ImageConnectionSettings;
  sessions?: SessionMetaStore;
}): Harness => {
  let broker: HarnessCredentialBroker | undefined;
  const sessionManager = {
    setHarnessCredentials: (value: HarnessCredentialBroker) => {
      broker = value;
    },
    getSession: vi.fn((id: string) =>
      options.sessions?.[id]
        ? {
            getHostWorkdir: () => '/synthetic/molly-test-project',
            getWorkdir: () => '/synthetic/molly-test-project',
          }
        : null
    ),
    on: vi.fn(),
    setRequestPermissionHandler: vi.fn(),
    cleanUp: vi.fn(async () => {}),
  } as unknown as SessionManager;
  const flock = new FakeFlock();
  if (options.imageConnection) {
    flock.set(machineFlockKeys.imageConnection(), options.imageConnection);
  }
  const getDocMeta = vi.fn(async (roomId: string) => {
    for (const [sessionId, stored] of Object.entries(options.sessions ?? {})) {
      if (getSessionRoomId(sessionId as SessionId) !== roomId || !stored) continue;
      if (stored.unreadable) throw new Error('meta store unavailable');
      return {
        meta: { ...stored.meta },
        ...(stored.deleted ? { exists: false } : {}),
      };
    }
    return undefined;
  });
  const upsertDocMeta = vi.fn(async () => {});
  const getOrCreateSessionDoc = vi.fn(async () => ({
    getMetaState: vi.fn(async () => undefined),
  }));
  const workspaceDocument = {
    isTransportConnected: vi.fn(() => true),
    markMachineFlockDocDirty: vi.fn(),
    repo: {
      getDocMeta,
      upsertDocMeta,
      watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
      openFlockDoc: vi.fn(async () => ({ flock, syncOnce: vi.fn(async () => {}) })),
    },
    getOrCreateSessionDoc,
    sendMachineHeartbeat: vi.fn(async () => {}),
  } as unknown as LoroDocumentManager;
  const handler = new MessageHandler(sessionManager, workspaceDocument, createSilentLogger(), {
    token: 'token',
    workspaceId,
    userId: 'user-1',
    machineId: 'machine-1',
    machineName: 'machine',
    cliVersion: '0.0.0',
    cloudPort: createTestCloudPort(),
  });
  const announceImage = async () => {
    const connection = options.imageConnection;
    await handler.handleLocalMachineRpc(
      LocalMachineRpcRequestSchema.parse({
        method: 'harness/host',
        machineId: 'machine-1',
        workspaceId,
        params: {
          version: 1,
          connections: [],
          reports: [],
          imageConnection: connection
            ? {
                id: '00000000-0000-4000-8000-000000000001',
                revision: 1,
                enabled: connection.enabled,
                baseUrl: connection.baseUrl,
                model: connection.model,
                hasApiKey: Boolean(connection.apiKey),
                legacyHistoryMayContainKey: true,
              }
            : null,
        },
      })
    );
    if (!broker) throw Error('host not bound');
    return broker;
  };
  return { handler, upsertDocMeta, getOrCreateSessionDoc, announceImage };
};

const readConnection = async (
  handler: MessageHandler,
  ownerSessionId?: SessionId
): Promise<{ ready: boolean; credential: unknown; connection: unknown }> => {
  const request = LocalMachineRpcRequestSchema.parse({
    method: 'design/image-connection',
    machineId: 'machine-1',
    workspaceId,
    ...(ownerSessionId ? { ownerSessionId } : {}),
    params: { acquireCredential: true },
  });
  const response = await handler.handleLocalMachineRpc(request);
  if (!response.ok) throw new Error(`rpc failed: ${response.error}`);
  if (response.result.type !== 'design/image-connection') {
    throw new Error(`unexpected result: ${response.result.type}`);
  }
  return response.result;
};

describe('MessageHandler design/image-connection gate', () => {
  it('answers ready using the broker-authorized image lease, not the legacy row', async () => {
    const { handler, getOrCreateSessionDoc, upsertDocMeta, announceImage } = createHandler({
      imageConnection: storedImageConnection(),
      sessions: { [DESIGN_SESSION_ID]: { meta: sessionMeta(DESIGN_SESSION_ID, true) } },
    });
    try {
      const broker = await announceImage();
      const connection = broker.imageCatalog();
      if (!connection) throw Error('missing public image metadata');
      const requested: string[] = [];
      vi.spyOn(broker, 'acquireImageForSession').mockImplementation(async (sessionId) => {
        requested.push(sessionId);
        return { connection, apiKey: 'synthetic-protected-key' };
      });
      const result = await readConnection(handler, DESIGN_SESSION_ID);
      expect(result.ready).toBe(true);
      expect(result.credential).toEqual({ apiKey: 'synthetic-protected-key' });
      expect(requested).toEqual([DESIGN_SESSION_ID]);
      expect(result.connection).toMatchObject({ hasApiKey: true, model: 'gpt-image-2' });
      // The lookup asks the raw doc-meta store: no session document is opened,
      // created, or written just to answer a capability question.
      expect(getOrCreateSessionDoc).not.toHaveBeenCalled();
      expect(upsertDocMeta).not.toHaveBeenCalled();
    } finally {
      await handler.cleanup();
    }
  });

  it('answers not-ready for a coding session even when the connection is ready', async () => {
    const { handler, getOrCreateSessionDoc, upsertDocMeta } = createHandler({
      imageConnection: storedImageConnection(),
      sessions: { [CODING_SESSION_ID]: { meta: sessionMeta(CODING_SESSION_ID, false) } },
    });
    try {
      const result = await readConnection(handler, CODING_SESSION_ID);
      expect(result.ready).toBe(false);
      // No credential leaves the daemon for a session that must not hold the
      // tool: a coding session's workdir is the user's own repository.
      expect(result.credential).toBeNull();
      expect(getOrCreateSessionDoc).not.toHaveBeenCalled();
      expect(upsertDocMeta).not.toHaveBeenCalled();
    } finally {
      await handler.cleanup();
    }
  });

  it('answers not-ready when the request names no session at all', async () => {
    const { handler } = createHandler({
      imageConnection: storedImageConnection(),
      sessions: { [DESIGN_SESSION_ID]: { meta: sessionMeta(DESIGN_SESSION_ID, true) } },
    });
    try {
      const result = await readConnection(handler);
      expect(result.ready).toBe(false);
      expect(result.credential).toBeNull();
    } finally {
      await handler.cleanup();
    }
  });

  it('resolves "no capability" for a missing, deleted, or unreadable session document', async () => {
    const cases: SessionMetaStore[] = [
      // Never created.
      {},
      // Deleted tombstone.
      { [DESIGN_SESSION_ID]: { meta: sessionMeta(DESIGN_SESSION_ID, true), deleted: true } },
      // The meta store itself fails.
      { [DESIGN_SESSION_ID]: { unreadable: true } },
      // A stored meta with no design association.
      { [DESIGN_SESSION_ID]: { meta: { id: DESIGN_SESSION_ID } } },
    ];
    for (const sessions of cases) {
      const { handler } = createHandler({
        imageConnection: storedImageConnection(),
        sessions,
      });
      try {
        const result = await readConnection(handler, DESIGN_SESSION_ID);
        expect(result.ready).toBe(false);
        expect(result.credential).toBeNull();
      } finally {
        await handler.cleanup();
      }
    }
  });

  it('keeps the machine row part of the gate for a design session', async () => {
    for (const imageConnection of [
      undefined,
      storedImageConnection({ enabled: false }),
      storedImageConnection({ apiKey: '' }),
    ]) {
      const { handler } = createHandler({
        ...(imageConnection ? { imageConnection } : {}),
        sessions: { [DESIGN_SESSION_ID]: { meta: sessionMeta(DESIGN_SESSION_ID, true) } },
      });
      try {
        const result = await readConnection(handler, DESIGN_SESSION_ID);
        expect(result.ready).toBe(false);
        expect(result.credential).toBeNull();
      } finally {
        await handler.cleanup();
      }
    }
  });

  it('refuses the retired plaintext settings probe without sending any request', async () => {
    const calls: string[] = [];
    const fetchGuard = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      calls.push(String(input));
      throw new Error('unexpected_network_request');
    });
    for (const ownerSessionId of [DESIGN_SESSION_ID, undefined]) {
      const { handler } = createHandler({
        imageConnection: storedImageConnection(),
        sessions: { [DESIGN_SESSION_ID]: { meta: sessionMeta(DESIGN_SESSION_ID, false) } },
      });
      try {
        const request = LocalMachineRpcRequestSchema.parse({
          method: 'design/image-connection-test',
          machineId: 'machine-1',
          workspaceId,
          ...(ownerSessionId ? { ownerSessionId } : {}),
          params: {},
        });
        const response = await handler.handleLocalMachineRpc(request);
        expect(response.ok).toBe(true);
        if (!response.ok) continue;
        expect(response.result).toEqual({
          type: 'design/image-connection-test',
          ok: false,
          error: 'image_connection_probe_requires_desktop',
        });
      } finally {
        await handler.cleanup();
      }
    }
    fetchGuard.mockRestore();
    // This retired daemon endpoint never touches a provider, even for settings.
    expect(calls).toEqual([]);
  });
});
