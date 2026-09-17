/**
 * The daemon's image-connection Machine RPC (P2.4): the gate behind
 * `molly_generate_image`, and the settings page's own test action.
 *
 * `molly_generate_image` is exposed to design sessions only, and the daemon is
 * where that rule lives: the read method folds the asking session's identity and
 * the machine's connection row into one `ready` bit and one credential, so no
 * caller can register the tool on half the condition. The read never opens,
 * creates, or writes a session document — asking must not materialize state.
 *
 * The settings test action (`design/image-connection-test`) stays deliberately
 * machine-scoped: a settings surface belongs to no session and has to work
 * before one exists, so it takes no session identity and is unaffected by the
 * design-session rule.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  IMAGE_CONNECTION_VERSION,
  LocalMachineRpcRequestSchema,
  getSessionRoomId,
  machineFlockKeys,
  type ImageConnectionSettings,
  type ImageHttpTransport,
  type MachineFlockKey,
  type SessionId,
  type SessionMeta,
  type WorkspaceId,
} from '@molly/shared';

import { MessageHandler } from '../src/lib/message-handler';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { SessionManager } from '../src/session/session-manager';
import type { Logger } from '../src/utils/logger';
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
};

/**
 * `sessions` records what the raw doc-meta store answers for each session id:
 * a readable meta, a deleted document (`exists: false`), or a store failure.
 * Anything absent answers like a session that was never created.
 */
const createHandler = (options: {
  imageConnection?: ImageConnectionSettings;
  sessions?: SessionMetaStore;
  imageConnectionTransport?: ImageHttpTransport;
}): Harness => {
  const sessionManager = {
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
    ...(options.imageConnectionTransport
      ? { imageConnectionTransport: options.imageConnectionTransport }
      : {}),
  });
  return { handler, upsertDocMeta, getOrCreateSessionDoc };
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
    params: {},
  });
  const response = await handler.handleLocalMachineRpc(request);
  if (!response.ok) throw new Error(`rpc failed: ${response.error}`);
  if (response.result.type !== 'design/image-connection') {
    throw new Error(`unexpected result: ${response.result.type}`);
  }
  return response.result;
};

describe('MessageHandler design/image-connection gate', () => {
  it('answers ready for a design session on a machine with a complete, enabled connection', async () => {
    const { handler, getOrCreateSessionDoc, upsertDocMeta } = createHandler({
      imageConnection: storedImageConnection(),
      sessions: { [DESIGN_SESSION_ID]: { meta: sessionMeta(DESIGN_SESSION_ID, true) } },
    });
    try {
      const result = await readConnection(handler, DESIGN_SESSION_ID);
      expect(result.ready).toBe(true);
      expect(result.credential).toEqual({ apiKey: SECRET_KEY });
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

  it('reads the settings probe as the machine, with a session identity present or not', async () => {
    const calls: string[] = [];
    const transport: ImageHttpTransport = async (request) => {
      calls.push(request.url);
      return {
        status: 200,
        bytes: new TextEncoder().encode(JSON.stringify({ data: [{ id: 'gpt-image-2' }] })),
      };
    };
    for (const ownerSessionId of [DESIGN_SESSION_ID, undefined]) {
      const { handler } = createHandler({
        imageConnection: storedImageConnection(),
        sessions: { [DESIGN_SESSION_ID]: { meta: sessionMeta(DESIGN_SESSION_ID, false) } },
        imageConnectionTransport: transport,
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
          ok: true,
          modelCount: 1,
        });
      } finally {
        await handler.cleanup();
      }
    }
    // The settings surface belongs to no session: it probes the machine's own
    // row regardless of who is asking, and no session document is touched.
    expect(calls).toEqual([
      'https://images.example.com/v1/models',
      'https://images.example.com/v1/models',
    ]);
  });
});
