import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkspaceId } from '@molly/shared';
import { getLocalLoroDataPlaneSocketPath } from '@molly/shared/node/local-ipc';
import { getLogger } from '../src/utils/logger';
import { LoroDocumentManager } from '../src/lib/loro/doc';
import {
  confirmWorkspaceManagerDelivery,
  resolveWorkspaceOrThrow,
  withWorkspaceManager,
  type AuthContext,
} from '../src/lib/command-runtime';
import {
  startLocalLoroDataPlaneServer,
  stopLocalLoroDataPlaneServer,
} from '../src/lib/local-loro-data-plane-server';

const workspaceId = 'lw_mcp_local_test' as WorkspaceId;
const auth: AuthContext = {
  token: '',
  userId: 'local:mcp-test',
  userName: 'Molly',
  userEmail: 'local@molly-design.invalid',
  machineId: 'machine-mcp-test' as AuthContext['machineId'],
  machineName: 'Local machine',
};

describe('MCP one-shot workspace manager on the local daemon data plane', () => {
  let tempHome: string;
  let source: LoroDocumentManager;
  const savedEnv = {
    HOME: process.env.HOME,
    MOLLY_DATA_DIR: process.env.MOLLY_DATA_DIR,
    MOLLY_PLATFORM: process.env.MOLLY_PLATFORM,
  };

  beforeAll(async () => {
    tempHome = fs.mkdtempSync(
      path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'molly-mcp-local-')
    );
    process.env.HOME = tempHome;
    process.env.MOLLY_PLATFORM = 'local';
    delete process.env.MOLLY_DATA_DIR;
    fs.mkdirSync(path.dirname(getLocalLoroDataPlaneSocketPath('local')), { recursive: true });
    source = await LoroDocumentManager.create(workspaceId, auth.userId, getLogger('mcp-source'));
    await source.repo.upsertDocMeta('s/mcp-local-session', { title: 'Local session' });
    const server = source.getLocalLoroDataPlaneServer();
    if (!server) throw Error('Local daemon data-plane engine missing');
    await startLocalLoroDataPlaneServer({
      logger: getLogger('mcp-socket'),
      getWorkspaceServer: (id) => (id === workspaceId ? server : null),
    });
  });

  afterAll(async () => {
    await stopLocalLoroDataPlaneServer();
    await source?.cleanUp({ fast: true, preserveSessionStatus: true });
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('resolves the implicit local workspace without a product-cloud lookup', async () => {
    const workspace = await resolveWorkspaceOrThrow(auth, workspaceId);
    expect(workspace.id).toBe(workspaceId);
    expect(workspace.role).toBe('owner');
  });

  it('keeps an accepted dispatch successful when final delivery confirmation disconnects', async () => {
    const repo = {
      transportRooms: () => [
        {
          subscription: {
            onStatusChange: () => () => undefined,
            rejoin: async () => {
              throw new Error('socket closed after dispatch');
            },
          },
        },
      ],
    } as unknown as Parameters<typeof confirmWorkspaceManagerDelivery>[0]['repo'];
    const warnings: string[] = [];

    await expect(
      confirmWorkspaceManagerDelivery({
        repo,
        mode: 'best-effort',
        logger: { warn: (message) => warnings.push(String(message)) },
      })
    ).resolves.toBeUndefined();
    expect(warnings.join('\n')).toContain('durable dispatch will converge on reconnect');
    await expect(confirmWorkspaceManagerDelivery({ repo, mode: 'required' })).rejects.toThrow(
      'socket closed after dispatch'
    );
  });

  it('reads a daemon-owned session over the local Loro plane', async () => {
    const workspace = await resolveWorkspaceOrThrow(auth, workspaceId);
    const title = await withWorkspaceManager(auth, workspace, 'mcp-test', async (manager) => {
      await manager.syncMetaOrThrow({ reason: 'mcp-local-test' });
      return (await manager.repo.getDocMeta('s/mcp-local-session'))?.meta?.title;
    });
    expect(title).toBe('Local session');
  });

  it('delivers a one-shot metadata write back to the running daemon', async () => {
    const workspace = await resolveWorkspaceOrThrow(auth, workspaceId);
    await withWorkspaceManager(auth, workspace, 'mcp-test', async (manager) => {
      expect(manager.repo.transportRooms('local').some(({ room }) => room.kind === 'meta')).toBe(
        true
      );
      await manager.repo.upsertDocMeta('s/mcp-local-session', { title: 'Updated locally' });
      await manager.syncMetaOrThrow({ reason: 'mcp-local-write' });
    });
    expect((await source.repo.getDocMeta('s/mcp-local-session'))?.meta?.title).toBe(
      'Updated locally'
    );
  });
});
