/**
 * `browser/pause-all`: before a website account change, main fences every active run,
 * including runs that have not yet asked for a browser page.
 */
import { describe, expect, it, vi } from 'vitest';
import { LocalMachineRpcRequestSchema, type SessionId, type WorkspaceId } from '@molly/shared';
import { MessageHandler } from '../src/lib/message-handler';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { SessionExecutionService } from '../src/session/session-execution-service';
import type { SessionManager } from '../src/session/session-manager';
import type { Logger } from '../src/utils/logger';
import { createTestCloudPort } from './test-cloud-port';

const workspaceId = 'workspace-1' as WorkspaceId;
const silent = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  debug: () => {},
  setLevel: () => {},
  child: () => silent(),
  close: async () => {},
});

const sessionId = 'session-1' as SessionId;
const runId = 'turn-1';

const handlerWithActiveRun = () => {
  const workspaceDocument = {
    isTransportConnected: vi.fn(() => true),
    markMachineFlockDocDirty: vi.fn(),
    repo: {
      getDocMeta: vi.fn(async () => undefined),
      upsertDocMeta: vi.fn(async () => {}),
      watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
    },
    sendMachineHeartbeat: vi.fn(async () => {}),
  } as unknown as LoroDocumentManager;
  const sessionManager = {
    on: vi.fn(),
    setRequestPermissionHandler: vi.fn(),
    cleanUp: vi.fn(async () => {}),
  } as unknown as SessionManager;
  const handler = new MessageHandler(sessionManager, workspaceDocument, silent(), {
    token: 'token',
    workspaceId,
    userId: 'user-1',
    machineId: 'machine-1',
    machineName: 'machine',
    cliVersion: '0.0.0',
    cloudPort: createTestCloudPort(),
  });
  const executionService = {
    activeTurnSessionIds: () => [sessionId],
    getActiveInvocationContext: (id: SessionId) =>
      id === sessionId ? { requesterUserId: 'user-1', sourceTurnId: runId } : undefined,
  } as unknown as SessionExecutionService;
  Object.assign(handler, { executionService });
  return handler;
};

const send = (handler: MessageHandler, request: Record<string, unknown>) =>
  handler.handleLocalMachineRpc(
    LocalMachineRpcRequestSchema.parse({ machineId: 'machine-1', workspaceId, ...request })
  );

const resume = (handler: MessageHandler) =>
  send(handler, { method: 'browser/resume', ownerSessionId: sessionId, params: { runId } });

describe('browser/pause-all', () => {
  it('takes over every active run until that run is explicitly resumed', async () => {
    const handler = handlerWithActiveRun();
    expect(await resume(handler)).toEqual({
      ok: true,
      result: { type: 'browser/control', ok: false },
    });

    expect(await send(handler, { method: 'browser/pause-all', params: {} })).toEqual({
      ok: true,
      result: {
        type: 'browser/pause-all',
        paused: [{ sessionId, browserId: `session-browser-${sessionId}`, runId }],
      },
    });

    expect(await resume(handler)).toEqual({
      ok: true,
      result: { type: 'browser/control', ok: true },
    });
  });
});
