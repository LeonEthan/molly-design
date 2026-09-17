import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updateTestHistory } from './history-port-fixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoroRepo } from 'loro-repo';

import type {
  AcpSessionNotification,
  LocalMachineRpcRequestValidated,
  SessionFilePayload,
  SessionHistoryInput,
  SessionId,
  WorkspaceId,
} from '@molly/shared';

import { MessageHandler } from '../src/lib/message-handler';
import {
  getSessionFileBlobPath,
  markSessionFileBlobBackfilled,
} from '../src/lib/session-file-blob-store';
import { SessionDocument } from '../src/lib/loro/doc';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { SessionManager } from '../src/session/session-manager';
import type { SessionDispatchSource } from '../src/session/session-execution-service';
import { DEFAULT_TURN_HISTORY_GATE_TIMEOUT_MS } from '../src/session/turn-history-gate';
import type { Logger } from '../src/utils/logger';
import { loadEnv } from '../src/utils/const';
import { createTestCloudPort } from './test-cloud-port';

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

const originalMollyServerUrl = process.env.MOLLY_SERVER_URL;

type MessageHandlerHost = {
  beginConversationTurn(
    sessionId: SessionId,
    userTurnId?: string,
    gateContext?: { dispatchSource?: SessionDispatchSource; sessionDoc: SessionDocument }
  ): string;
  enqueueACPUpdate(sessionId: SessionId, update: AcpSessionNotification): void;
  createAssistantEntryForTurn(
    sessionId: SessionId,
    sessionDoc: SessionDocument,
    turnId: string,
    modelInfo: undefined,
    userTurnId?: string
  ): Promise<void>;
};

// loro-repo resolves create()/destroy() on the real clock (native async), not the
// timers vitest fakes — run repo setup/teardown on real timers (same pattern as
// message-handler-acp-batching.test.ts).
const destroyRepoOnRealTimers = async (repo: LoroRepo) => {
  if (vi.isFakeTimers()) {
    vi.useRealTimers();
  }
  await repo.destroy();
};

const createHandlerHarness = async (sessionId: SessionId) => {
  const logger = createSilentLogger();
  const fakeTimersActive = vi.isFakeTimers();
  if (fakeTimersActive) {
    vi.useRealTimers();
  }
  const repo = await LoroRepo.create({});
  const doc = new SessionDocument(repo, sessionId);
  await doc.initOffline();
  if (fakeTimersActive) {
    vi.useFakeTimers();
  }

  const workspaceDocument = {
    isTransportConnected: vi.fn(() => true),
    markMachineFlockDocDirty: vi.fn(),
    registerMachine: vi.fn(),
    repo: {
      watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
      getDocMeta: vi.fn(async () => ({
        meta: { needToArchiveSessions: {}, needToDeleteSessions: {} },
      })),
    },
    getOrCreateSessionDoc: vi.fn(async () => doc),
  };
  const sessionManager = {
    on: vi.fn(),
    setRequestPermissionHandler: vi.fn(),
    getSession: vi.fn(() => null),
  };

  const handler = new MessageHandler(
    sessionManager as unknown as SessionManager,
    workspaceDocument as unknown as LoroDocumentManager,
    logger,
    {
      token: 't',
      workspaceId: 'ws-1' as WorkspaceId,
      userId: 'u-1',
      machineId: 'm-1',
      machineName: 'machine',
      cliVersion: '0.0.0',
      cloudPort: createTestCloudPort(),
    }
  );

  return { repo, doc, rpcHandler: handler, handler: handler as unknown as MessageHandlerHost };
};

const attachmentBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
);

const stageAttachment = (sessionId: SessionId): SessionFilePayload => {
  const file: SessionFilePayload = {
    type: 'file',
    fileId: 'reference-file',
    fileName: 'reference.png',
    mimeType: 'image/png',
    sizeBytes: attachmentBytes.length,
    sha256: createHash('sha256').update(attachmentBytes).digest('hex'),
    transport: 'local',
    machineId: 'm-1',
    uploadedAt: 1,
    textPreview: false,
  };
  const blobPath = getSessionFileBlobPath({ workspaceId: 'ws-1', sessionId, fileId: file.fileId });
  fs.mkdirSync(path.dirname(blobPath), { recursive: true });
  fs.writeFileSync(blobPath, attachmentBytes);
  return file;
};

const attachmentRequest = (
  sessionId: SessionId,
  file: SessionFilePayload
): LocalMachineRpcRequestValidated => ({
  machineId: 'm-1',
  workspaceId: 'ws-1',
  method: 'file/resolve-local',
  params: { v: 3, sessionId, attachment: { fileId: file.fileId, sha256: file.sha256 } },
});

const previewBeforeHistory = async (
  harness: Awaited<ReturnType<typeof createHandlerHarness>>,
  request: LocalMachineRpcRequestValidated
) => {
  const historyRead = Promise.withResolvers<void>();
  const getHistory = harness.doc.sessionData.history.readAll.bind(harness.doc.sessionData.history);
  vi.spyOn(harness.doc.sessionData.history, 'readAll').mockImplementationOnce(() => {
    const snapshot = getHistory();
    historyRead.resolve();
    return snapshot;
  });
  const response = harness.rpcHandler.handleLocalMachineRpc(request);
  await historyRead.promise;
  return { response };
};

const userEntry = (id: string): SessionHistoryInput => ({
  id,
  role: 'user',
  timestamp: new Date().toISOString(),
  read: false,
  userId: 'u-1',
  fileDiff: [],
  items: [{ type: 'text', text: 'hi agent' }] as unknown as SessionHistoryInput['items'],
});

const agentChunk = (sessionId: SessionId, text: string): AcpSessionNotification => ({
  sessionId,
  update: {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text },
  },
});

describe('MessageHandler turn history gate (RPC fast path ordering)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.MOLLY_SERVER_URL = 'https://server.example.test';
    loadEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    if (originalMollyServerUrl === undefined) {
      delete process.env.MOLLY_SERVER_URL;
    } else {
      process.env.MOLLY_SERVER_URL = originalMollyServerUrl;
    }
    loadEnv();
  });

  it('holds RPC-turn output until the user entry syncs, then orders it after the user entry', async () => {
    const sessionId = 's-gate-1' as SessionId;
    const userTurnId = 'user-turn-1';
    const { repo, doc, handler } = await createHandlerHarness(sessionId);

    try {
      const turnId = handler.beginConversationTurn(sessionId, userTurnId, {
        dispatchSource: 'rpc',
        sessionDoc: doc,
      });
      expect(turnId).toBe(`assistant:${userTurnId}`);

      // The eager assistant-entry creation (execution service does this before
      // the prompt) must defer while the user entry is missing locally.
      await handler.createAssistantEntryForTurn(sessionId, doc, turnId, undefined, userTurnId);
      expect(await doc.sessionData.history.readAll()).toHaveLength(0);

      // Streamed output arrives and the batch window elapses — still nothing
      // may be persisted ahead of the user entry.
      handler.enqueueACPUpdate(sessionId, agentChunk(sessionId, 'hello'));
      handler.enqueueACPUpdate(sessionId, agentChunk(sessionId, ' world'));
      await vi.advanceTimersByTimeAsync(200);
      expect(await doc.sessionData.history.readAll()).toHaveLength(0);

      // The user entry syncs in (as the web client's CRDT write would land).
      await updateTestHistory(doc, (history) => [...history, userEntry(userTurnId)]);
      await vi.advanceTimersByTimeAsync(200);

      const history = await doc.sessionData.history.readAll();
      expect(history.map((entry) => [entry.role, entry.id])).toEqual([
        ['user', userTurnId],
        ['assistant', turnId],
      ]);
      const items = history[1]?.items as unknown as Array<{ type: string; text: string }>;
      expect(items).toEqual([{ type: 'text', text: 'hello world' }]);
    } finally {
      await destroyRepoOnRealTimers(repo);
    }
  });

  it('releases output after the gate timeout when the user entry never syncs', async () => {
    const sessionId = 's-gate-2' as SessionId;
    const userTurnId = 'user-turn-2';
    const { repo, doc, handler } = await createHandlerHarness(sessionId);

    try {
      const turnId = handler.beginConversationTurn(sessionId, userTurnId, {
        dispatchSource: 'rpc',
        sessionDoc: doc,
      });
      handler.enqueueACPUpdate(sessionId, agentChunk(sessionId, 'stalled sync'));
      await vi.advanceTimersByTimeAsync(200);
      expect(await doc.sessionData.history.readAll()).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(DEFAULT_TURN_HISTORY_GATE_TIMEOUT_MS);

      const history = await doc.sessionData.history.readAll();
      expect(history.map((entry) => [entry.role, entry.id])).toEqual([['assistant', turnId]]);
    } finally {
      await destroyRepoOnRealTimers(repo);
    }
  });

  it('does not gate turns dispatched from local history (crdt source)', async () => {
    const sessionId = 's-gate-3' as SessionId;
    const userTurnId = 'user-turn-3';
    const { repo, doc, handler } = await createHandlerHarness(sessionId);

    try {
      await updateTestHistory(doc, (history) => [...history, userEntry(userTurnId)]);
      const turnId = handler.beginConversationTurn(sessionId, userTurnId, {
        dispatchSource: 'crdt',
        sessionDoc: doc,
      });
      await handler.createAssistantEntryForTurn(sessionId, doc, turnId, undefined, userTurnId);
      handler.enqueueACPUpdate(sessionId, agentChunk(sessionId, 'immediate'));
      await vi.advanceTimersByTimeAsync(20);

      const history = await doc.sessionData.history.readAll();
      expect(history.map((entry) => [entry.role, entry.id])).toEqual([
        ['user', userTurnId],
        ['assistant', turnId],
      ]);
    } finally {
      await destroyRepoOnRealTimers(repo);
    }
  });

  describe('sent local attachment preview', () => {
    let dataDir: string;

    beforeEach(() => {
      dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lody-attachment-history-'));
      vi.stubEnv('MOLLY_DATA_DIR', dataDir);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('resolves the original pending request after the sent attachment syncs into history', async () => {
      const sessionId = 's-attachment-sync' as SessionId;
      const harness = await createHandlerHarness(sessionId);
      const file = stageAttachment(sessionId);
      try {
        harness.handler.beginConversationTurn(sessionId, 'sent-image', {
          dispatchSource: 'rpc',
          sessionDoc: harness.doc,
        });
        const { response } = await previewBeforeHistory(
          harness,
          attachmentRequest(sessionId, file)
        );
        await updateTestHistory(harness.doc, (history) => [
          ...history,
          { ...userEntry('sent-image'), items: [file] },
        ]);
        const result = await response;
        expect(result.ok).toBe(true);
        if (!result.ok || !('status' in result.result) || result.result.status !== 'local-file')
          throw new Error('Expected the synced local attachment');
        expect(fs.readFileSync(result.result.absolutePath)).toEqual(attachmentBytes);
      } finally {
        await destroyRepoOnRealTimers(harness.repo);
      }
    });

    it.each(['missing', 'wrong-hash', 'wrong-machine'])(
      'does not authorize a %s attachment when the user entry syncs',
      async (scenario) => {
        const sessionId = 's-attachment-denied' as SessionId;
        const harness = await createHandlerHarness(sessionId);
        const file = stageAttachment(sessionId);
        try {
          harness.handler.beginConversationTurn(sessionId, 'sent-image', {
            dispatchSource: 'rpc',
            sessionDoc: harness.doc,
          });
          const { response } = await previewBeforeHistory(
            harness,
            attachmentRequest(sessionId, file)
          );
          const syncedFile: SessionFilePayload = {
            ...file,
            ...(scenario === 'wrong-hash' ? { sha256: '0'.repeat(64) } : {}),
            ...(scenario === 'wrong-machine' ? { machineId: 'another-machine' } : {}),
          };
          await updateTestHistory(harness.doc, (history) => [
            ...history,
            { ...userEntry('sent-image'), items: scenario === 'missing' ? [] : [syncedFile] },
          ]);
          expect(await response).toEqual({
            ok: false,
            error: 'Local attachment is not present in this session',
          });
        } finally {
          await destroyRepoOnRealTimers(harness.repo);
        }
      }
    );

    it('resolves a legacy relay attachment from the retained local backfill cache', async () => {
      const sessionId = 's-legacy-relay-attachment' as SessionId;
      const harness = await createHandlerHarness(sessionId);
      const file = stageAttachment(sessionId);
      try {
        await markSessionFileBlobBackfilled({
          workspaceId: 'ws-1',
          sessionId,
          fileId: file.fileId,
        });
        const legacyFile: SessionFilePayload = {
          ...file,
          transport: 'r2',
          machineId: undefined,
        };
        await updateTestHistory(harness.doc, () => [
          { ...userEntry('legacy-file'), items: [legacyFile] },
        ]);
        const result = await harness.rpcHandler.handleLocalMachineRpc(
          attachmentRequest(sessionId, legacyFile)
        );
        expect(result.ok).toBe(true);
        if (!result.ok || !('status' in result.result) || result.result.status !== 'local-file') {
          throw new Error('Expected the cached legacy attachment');
        }
        expect(fs.readFileSync(result.result.absolutePath)).toEqual(attachmentBytes);
      } finally {
        await destroyRepoOnRealTimers(harness.repo);
      }
    });

    it('rejects a staged blob if history is still missing when the existing gate times out', async () => {
      const sessionId = 's-attachment-timeout' as SessionId;
      const harness = await createHandlerHarness(sessionId);
      const file = stageAttachment(sessionId);
      try {
        harness.handler.beginConversationTurn(sessionId, 'sent-image', {
          dispatchSource: 'rpc',
          sessionDoc: harness.doc,
        });
        const { response } = await previewBeforeHistory(
          harness,
          attachmentRequest(sessionId, file)
        );
        await vi.advanceTimersByTimeAsync(DEFAULT_TURN_HISTORY_GATE_TIMEOUT_MS);
        expect(await response).toEqual({
          ok: false,
          error: 'Local attachment is not present in this session',
        });
      } finally {
        await destroyRepoOnRealTimers(harness.repo);
      }
    });

    it('reads an older sent attachment without waiting for an unrelated pending user turn', async () => {
      const sessionId = 's-attachment-old' as SessionId;
      const harness = await createHandlerHarness(sessionId);
      const file = stageAttachment(sessionId);
      try {
        await updateTestHistory(harness.doc, () => [{ ...userEntry('old-image'), items: [file] }]);
        harness.handler.beginConversationTurn(sessionId, 'new-message', {
          dispatchSource: 'rpc',
          sessionDoc: harness.doc,
        });
        const result = await harness.rpcHandler.handleLocalMachineRpc(
          attachmentRequest(sessionId, file)
        );
        expect(result.ok).toBe(true);
        expect((await harness.doc.sessionData.history.readAll()).map((entry) => entry.id)).toEqual([
          'old-image',
        ]);
      } finally {
        await destroyRepoOnRealTimers(harness.repo);
      }
    });
  });
});
