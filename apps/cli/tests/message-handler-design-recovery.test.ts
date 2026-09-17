import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  LocalMachineRpcRequestSchema,
  getSessionRoomId,
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
const workspaceId = 'workspace-1' as WorkspaceId;

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

const sessionMeta = (sessionId: SessionId, design: boolean): Partial<SessionMeta> => ({
  id: sessionId,
  machineId: 'machine-1' as SessionMeta['machineId'],
  createdAt: new Date().toISOString(),
  userId: 'user-1',
  title: 'A poster',
  ...(design ? { design: { artworkId: sessionId, path: 'design.json' } } : {}),
});

let client = {};
let launchId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let runtime: 'pi' | 'claude' | 'codex' | 'kimi' | 'grok' = 'pi';
const live = {
  get agentClient() {
    return client;
  },
  getDesignHookRuntime: () => runtime,
  getDesignHookLaunchId: () => launchId,
  getHostWorkdir: () => path.join(dataRoot, 'chats', DESIGN_SESSION_ID),
  getWorkdir: () => path.join(dataRoot, 'chats', DESIGN_SESSION_ID),
};
const createHandler = (
  sessions: Record<string, Partial<SessionMeta> | undefined> = {},
  _workspaceRoot?: string
): MessageHandler => {
  const sessionManager = {
    getSession: vi.fn(() => live),
    on: vi.fn(),
    setRequestPermissionHandler: vi.fn(),
    cleanUp: vi.fn(async () => {}),
  } as unknown as SessionManager;
  const workspaceDocument = {
    isTransportConnected: vi.fn(() => true),
    markMachineFlockDocDirty: vi.fn(),
    repo: {
      getDocMeta: vi.fn(async (roomId: string) => {
        for (const [sessionId, meta] of Object.entries(sessions)) {
          if (getSessionRoomId(sessionId as SessionId) === roomId && meta)
            return { meta: { ...meta } };
        }
        return undefined;
      }),
      upsertDocMeta: vi.fn(async () => {}),
      watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
      openFlockDoc: vi.fn(async () => ({
        flock: { scan: () => [], set: vi.fn(), delete: vi.fn(), commit: vi.fn() },
        syncOnce: vi.fn(async () => {}),
      })),
    },
    getOrCreateSessionDoc: vi.fn(async () => ({ getMetaState: vi.fn(async () => undefined) })),
    sendMachineHeartbeat: vi.fn(async () => {}),
  } as unknown as LoroDocumentManager;
  return new MessageHandler(sessionManager, workspaceDocument, createSilentLogger(), {
    token: 'token',
    workspaceId,
    userId: 'user-1',
    machineId: 'machine-1',
    machineName: 'machine',
    cliVersion: '0.0.0',
    cloudPort: createTestCloudPort(),
  });
};

const send = async (handler: MessageHandler, request: Record<string, unknown>) => {
  const response = await handler.handleLocalMachineRpc(
    LocalMachineRpcRequestSchema.parse({
      machineId: 'machine-1',
      workspaceId,
      ...request,
    })
  );
  if (!response.ok) throw new Error(`rpc failed: ${response.error}`);
  return response.result;
};

import type { DesignToolEvent } from '../src/design/sync-service';
import type { SessionExecutionService } from '../src/session/session-execution-service';
import { DesignCanvasHost } from '../src/design/canvas-host';
import { designOperation } from '../src/design/store';
import { readDesignArtifact } from '../src/design/artifact';
let dataRoot: string;
let handler: MessageHandler;
beforeEach(async () => {
  dataRoot = mkdtempSync(path.join(tmpdir(), 'molly-t21-rpc-'));
  vi.stubEnv('MOLLY_DATA_DIR', dataRoot);
  client = {};
  launchId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  runtime = 'pi';
  const meta = sessionMeta(DESIGN_SESSION_ID, true);
  handler = createHandler({ [DESIGN_SESSION_ID]: meta });
  const internal = handler as unknown as {
    executionService: SessionExecutionService;
    designCanvasHost: DesignCanvasHost;
  };
  vi.spyOn(internal.executionService, 'getActiveInvocationContext').mockReturnValue({
    sourceTurnId: 'turn-one',
  } as ReturnType<SessionExecutionService['getActiveInvocationContext']>);
  vi.spyOn(internal.executionService, 'getActiveDesignCanvasTurnId').mockReturnValue('canvas-one');
  const preparation = internal.designCanvasHost.prepare(
    DESIGN_SESSION_ID,
    DESIGN_SESSION_ID,
    'canvas-one',
    new AbortController().signal
  );
  internal.designCanvasHost.exchange([
    { artworkId: DESIGN_SESSION_ID, turnId: 'canvas-one', ok: true },
  ]);
  await preparation;
  await designOperation(dataRoot, {
    operation: 'create',
    association: {
      sessionId: DESIGN_SESSION_ID,
      name: 'Synthetic',
      userId: 'test',
      machineId: 'machine-1',
      createdAt: '2026-09-11T00:00:00Z',
    },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(dataRoot, { recursive: true, force: true });
});
async function hook(event: DesignToolEvent, producer = launchId) {
  return send(handler, {
    method: 'design/tool-hook',
    ownerSessionId: DESIGN_SESSION_ID,
    params: { version: 2, launchId: producer, event },
  });
}
const firstRun = '11111111-1111-4111-8111-111111111111';
const secondRun = '22222222-2222-4222-8222-222222222222';
it('replacement rejects late native settlement and explicit submission from the old launch', async () => {
  expect(await hook({ phase: 'start', runId: firstRun })).toMatchObject({ ok: true });
  const oldLaunch = launchId;
  client = {};
  launchId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  expect(
    await hook({ phase: 'terminal', runId: firstRun, status: 'end_turn' }, oldLaunch)
  ).toMatchObject({ ok: false });
  expect(
    await hook(
      { phase: 'resubmit', expectedRevisionId: 'a'.repeat(64), artifactDigest: 'b'.repeat(64) },
      oldLaunch
    )
  ).toMatchObject({ ok: false });
  expect(await hook({ phase: 'start', runId: secondRun })).toMatchObject({ ok: true });
  expect(await hook({ phase: 'terminal', runId: firstRun, status: 'end_turn' })).toMatchObject({
    ok: false,
  });
  expect(await hook({ phase: 'terminal', runId: secondRun, status: 'failed' })).toMatchObject({
    ok: true,
  });
});
it('Claude reminders cannot attest a Pi native terminal result', async () => {
  runtime = 'claude';
  expect(await hook({ phase: 'start', runId: firstRun })).toMatchObject({ ok: false });
  expect(
    await send(handler, {
      method: 'design/tool-hook',
      ownerSessionId: DESIGN_SESSION_ID,
      params: { version: 2, launchId, event: { phase: 'resubmit-capability' } },
    })
  ).toMatchObject({ supported: true });
});
it('an in-flight old launch cannot replace the fresh service after workspace resolution', async () => {
  const internal = handler as unknown as {
    resolveActiveDesignContext: (...args: unknown[]) => Promise<unknown>;
  };
  const original = internal.resolveActiveDesignContext.bind(handler);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  vi.spyOn(internal, 'resolveActiveDesignContext').mockImplementationOnce(async (...args) => {
    entered.resolve();
    await release.promise;
    return original(...args);
  });
  const old = hook({ phase: 'start', runId: firstRun });
  await entered.promise;
  client = {};
  launchId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  expect(await hook({ phase: 'start', runId: secondRun })).toMatchObject({ ok: true });
  release.resolve();
  expect(await old).toMatchObject({ ok: false });
  expect(await hook({ phase: 'terminal', runId: secondRun, status: 'end_turn' })).toMatchObject({
    ok: true,
  });
});

it.each(['claude', 'codex', 'kimi', 'grok'] as const)(
  '%s accepts exact submission through existing launch ownership without Pi hooks',
  async (agent) => {
    runtime = agent;
    const directory = path.join(dataRoot, 'chats', DESIGN_SESSION_ID);
    for (const item of ['design.yaml'])
      cpSync(path.join(directory, 'design-current', item), path.join(directory, item), {
        recursive: true,
      });
    const canonical = await designOperation(dataRoot, {
      operation: 'read',
      sessionId: DESIGN_SESSION_ID,
    });
    const artifact = await readDesignArtifact(directory);
    if (artifact.status !== 'present') throw Error('Synthetic draft unavailable');
    const event = {
      phase: 'resubmit' as const,
      expectedRevisionId: canonical.revisionId,
      artifactDigest: artifact.digest,
    };
    expect(await hook(event, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).toMatchObject({ ok: false });
    expect(await hook({ phase: 'terminal', runId: firstRun, status: 'end_turn' })).toMatchObject({
      ok: false,
    });
    expect(await hook(event)).toMatchObject({ ok: true });
    expect(
      (await designOperation(dataRoot, { operation: 'read', sessionId: DESIGN_SESSION_ID }))
        .revisionId
    ).toBe(canonical.revisionId);
  }
);
