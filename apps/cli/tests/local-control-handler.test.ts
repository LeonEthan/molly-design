import { PassThrough } from 'node:stream';
import { LOCAL_MACHINE_RPC_PATH } from '@molly/shared';
import { mcpToolAuthToken, receiveSupervisorIdentity } from '../src/lib/local-supervisor-control';
import { describe, expect, it, vi } from 'vitest';
import {
  LocalProjectControlResponse,
  LocalSessionControlRequest,
  LocalSessionControlResponse,
} from '@molly/shared';
import { LOCAL_PROJECT_CONTROL_PATH } from '@molly/shared/node/local-project-control';
import { LOCAL_SESSION_CONTROL_PATH } from '@molly/shared/node/local-ipc';
import { LocalControlHandler } from '../src/lib/local-control-handler';
import type { Logger } from '../src/utils/logger';

const logger: Logger = {
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  setLevel: vi.fn(),
  setDebug: vi.fn(),
  child: vi.fn(() => logger),
  close: vi.fn(async () => {}),
};

const createSessionRequest = (): LocalSessionControlRequest => ({
  type: 'session/create',
  machineId: 'machine-1',
  workspaceId: 'workspace-1',
  sessionId: 'session-1',
  acpSessionConfig: {
    prompt: 'hello',
    cliType: 'builtin',
    agentType: 'codex',
  },
  userId: 'user-1',
  userName: 'User One',
  userEmail: 'user@example.com',
});

describe('LocalControlHandler', () => {
  it('handles session-control messages without HTTP objects', async () => {
    const dispatchResponse: LocalSessionControlResponse = {
      type: 'session/create_response',
      sessionId: 'session-1',
      success: true,
    };
    const dispatchSession = vi.fn(async () => [dispatchResponse]);
    const handler = new LocalControlHandler({
      machineId: 'machine-1',
      logger,
      dispatchSession,
      dispatchProject: vi.fn(),
    });

    await expect(
      handler.handle({
        path: LOCAL_SESSION_CONTROL_PATH,
        rawBody: JSON.stringify(createSessionRequest()),
        requestId: 1,
      })
    ).resolves.toEqual({
      status: 200,
      payload: {
        ok: true,
        responses: [
          {
            type: 'session/create_ack',
            sessionId: 'session-1',
          },
          dispatchResponse,
        ],
      },
    });
    expect(dispatchSession).toHaveBeenCalledOnce();
  });

  it('handles project-control parse failures without HTTP objects', async () => {
    const dispatchProject = vi.fn<() => Promise<LocalProjectControlResponse>>();
    const handler = new LocalControlHandler({
      machineId: 'machine-1',
      logger,
      dispatchSession: vi.fn(),
      dispatchProject,
    });

    const response = await handler.handle({
      path: LOCAL_PROJECT_CONTROL_PATH,
      rawBody: '{"type":"local-project/list","machineId":1}',
      requestId: 2,
    });

    expect(response.status).toBe(400);
    expect(response.payload).toMatchObject({
      ok: false,
      type: 'local-project/list',
      error: 'invalid_request',
    });
    expect(dispatchProject).not.toHaveBeenCalled();
  });
});

it('checks coordinator and image headers independently before machine dispatch', async () => {
  const input = new PassThrough();
  vi.stubEnv('MOLLY_SUPERVISOR_TRANSPORT', 'stdin');
  try {
    const coordinatorToken = 'c'.repeat(64);
    const identity = receiveSupervisorIdentity(input);
    input.write(
      JSON.stringify({
        type: 'lody/supervisor-hello',
        token: 's'.repeat(64),
        coordinatorToken,
        supervisorPid: process.pid,
        supervisorInstanceId: 'test',
      }) + '\n'
    );
    await identity;
    const handler = new LocalControlHandler({
      machineId: 'machine',
      logger,
      dispatchProject: vi.fn(),
      dispatchSession: vi.fn(),
      dispatchMachineRpc: async () => ({ ok: false, error: 'dispatched' }),
    });
    const send = (method: string, params: unknown, headers?: Record<string, string>) =>
      handler.handle({
        path: LOCAL_MACHINE_RPC_PATH,
        requestId: 1,
        headers,
        rawBody: JSON.stringify({
          machineId: 'machine',
          workspaceId: 'workspace',
          ownerSessionId: 'session',
          method,
          params,
        }),
      });
    for (const [method, params] of [
      ['browser/pause-all', {}],
      ['browser/host', { leases: [], reports: [], takeovers: [] }],
      ['design/canvas-host', { version: 1, reports: [] }],
      ['design/render-host', { reports: [] }],
      ['mcp/catalog-entry', { serverId: 'entry' }],
      ['harness/host', { version: 1, reports: [], connections: [] }],
    ] as const) {
      expect((await send(method, params, { 'x-molly-mcp-token': mcpToolAuthToken })).status).toBe(
        403
      );
      expect(
        (await send(method, params, { 'x-molly-coordinator-token': coordinatorToken })).payload
          .error
      ).toBe('dispatched');
    }
    expect(
      (
        await send(
          'design/image-connection',
          { acquireCredential: true },
          { 'x-molly-coordinator-token': coordinatorToken }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await send(
          'design/image-connection',
          { acquireCredential: true },
          { 'x-molly-mcp-token': mcpToolAuthToken }
        )
      ).payload.error
    ).toBe('dispatched');
    expect((await send('design/image-connection', {})).payload.error).toBe('dispatched');
    expect((await send('browser/host-status', {})).payload.error).toBe('dispatched');
  } finally {
    input.destroy();
    vi.unstubAllEnvs();
  }
});
