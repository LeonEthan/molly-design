/**
 * `mcp/catalog-entry`: main's Settings tool listing asks the daemon which connection the saved
 * workspace catalog row names, so a caller can never choose the command or URL that runs.
 */
import { Flock } from '@loro-dev/flock-wasm';
import { describe, expect, it, vi } from 'vitest';
import {
  LocalMachineRpcRequestSchema,
  workspaceFlockKeys,
  type McpServerId,
  type WorkspaceId,
  type WorkspaceMcpServerMeta,
} from '@molly/shared';
import { MessageHandler } from '../src/lib/message-handler';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
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

const handlerWith = (entry?: WorkspaceMcpServerMeta) => {
  const flock = new Flock();
  if (entry) flock.put(workspaceFlockKeys.mcpServer(entry.id), entry);
  const workspaceDocument = {
    isTransportConnected: vi.fn(() => true),
    markMachineFlockDocDirty: vi.fn(),
    repo: {
      getDocMeta: vi.fn(async () => undefined),
      upsertDocMeta: vi.fn(async () => {}),
      watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
      openFlockDoc: vi.fn(async () => ({ flock, syncOnce: vi.fn(async () => {}) })),
    },
    sendMachineHeartbeat: vi.fn(async () => {}),
  } as unknown as LoroDocumentManager;
  const sessionManager = {
    on: vi.fn(),
    setRequestPermissionHandler: vi.fn(),
    cleanUp: vi.fn(async () => {}),
  } as unknown as SessionManager;
  return new MessageHandler(sessionManager, workspaceDocument, silent(), {
    token: 'token',
    workspaceId,
    userId: 'user-1',
    machineId: 'machine-1',
    machineName: 'machine',
    cliVersion: '0.0.0',
    cloudPort: createTestCloudPort(),
  });
};

const ask = (handler: MessageHandler, serverId: string) =>
  handler.handleLocalMachineRpc(
    LocalMachineRpcRequestSchema.parse({
      method: 'mcp/catalog-entry',
      machineId: 'machine-1',
      workspaceId,
      params: { serverId },
    })
  );

describe('mcp/catalog-entry', () => {
  const saved: WorkspaceMcpServerMeta = {
    id: 'synthetic-server' as McpServerId,
    name: 'Synthetic',
    transport: 'stdio',
    revision: 1,
    connection: {
      transport: 'stdio',
      command: '/synthetic/mcp',
      args: ['--stdio'],
      protectedCredentials: { credentialRef: '00000000-0000-4000-8000-000000000001', revision: 2 },
    },
    createdAt: 1,
    updatedAt: 1,
  };

  it('returns the saved row connection', async () => {
    expect(await ask(handlerWith(saved), saved.id)).toEqual({
      ok: true,
      result: { type: 'mcp/catalog-entry', connection: saved.connection },
    });
  });

  it('answers null for a server the catalog does not hold', async () => {
    expect(await ask(handlerWith(saved), 'synthetic-unknown')).toEqual({
      ok: true,
      result: { type: 'mcp/catalog-entry', connection: null },
    });
  });
});
