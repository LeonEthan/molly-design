import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LocalMachineRpcRequestSchema,
  type LocalSessionControlResponse,
  type SessionHistory,
  type SessionId,
} from '@molly/shared';
import { MessageHandler } from '../src/lib/message-handler';
import { LocalControlHandler } from '../src/lib/local-control-handler';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { SessionManager } from '../src/session/session-manager';
import type { Logger } from '../src/utils/logger';
import { buildMollyMcpServer, runWithMcpSessionContext } from '../src/mcp/molly-mcp-server';
import { withHistoryPort } from './history-port-fixture';
import { createTestCloudPort } from './test-cloud-port';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
  vi.unstubAllEnvs();
});

const imageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
);

async function uploadFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'molly-upload-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const workdir = path.join(root, 'workspace');
  await mkdir(workdir);
  vi.stubEnv('MOLLY_DATA_DIR', path.join(root, 'data'));
  const sessionId = 'session-upload' as SessionId;
  let history: SessionHistory[] = [];
  const sessionDoc = withHistoryPort({
    getHistory: () => history,
    updateHistory: async (update: (current: SessionHistory[]) => SessionHistory[]) => {
      history = update(history);
    },
    getMetaState: async () => ({ status: { type: 'idle' } }),
    setLastMessageAt: async () => {},
  });
  const sessionManager = {
    getSession: () => ({ getHostWorkdir: () => workdir, getWorkdir: () => workdir }),
    on: () => {},
    setRequestPermissionHandler: () => {},
    cleanUp: async () => {},
  } as unknown as SessionManager;
  const workspaceDocument = {
    isTransportConnected: () => true,
    markMachineFlockDocDirty: () => {},
    repo: {
      getDocMeta: async () => ({ meta: {} }),
      watch: () => ({ unsubscribe: () => {} }),
    },
    getOrCreateSessionDoc: async () => sessionDoc,
    sendMachineHeartbeat: async () => {},
  } as unknown as LoroDocumentManager;
  const logger: Logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    success: () => {},
    debug: () => {},
    setLevel: () => {},
    child: () => logger,
    close: async () => {},
  };
  const handler = new MessageHandler(sessionManager, workspaceDocument, logger, {
    token: 'synthetic',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    machineId: 'machine-1',
    machineName: 'synthetic',
    cliVersion: '0.0.0',
    cloudPort: createTestCloudPort(),
  });
  cleanup.push(() => handler.cleanup());
  const control = new LocalControlHandler({
    machineId: 'machine-1',
    logger,
    dispatchProject: async () => {
      throw new Error('unexpected project request');
    },
    dispatchSession: async (message) => {
      const responses: LocalSessionControlResponse[] = [];
      await handler.handleMessage(message, {
        source: 'local',
        send: (response) => {
          if (
            !response ||
            typeof response !== 'object' ||
            !('type' in response) ||
            response.type !== 'session/file-upload_response'
          )
            throw new Error('unexpected session response');
          responses.push(response as LocalSessionControlResponse);
        },
      });
      return responses;
    },
  });
  const server = http.createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = await control.handle({
        path: request.url ?? '',
        rawBody: Buffer.concat(chunks).toString('utf8'),
        requestId: 1,
      });
      response.writeHead(result.status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(result.payload));
    })().catch((error) => response.destroy(error));
  });
  const socketPath = path.join(root, 'control.sock');
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  );
  const mcp = buildMollyMcpServer();
  const client = new Client({ name: 'synthetic-upload', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(async () => {
    await client.close();
    await mcp.close();
  });
  const upload = (name: string, paths: string[]) =>
    runWithMcpSessionContext(
      {
        machineId: 'machine-1',
        workspaceId: 'workspace-1',
        sessionId,
        localControlSocketPath: socketPath,
        workdir,
        taskToolsEnabled: false,
      },
      () => client.callTool({ name, arguments: { paths } })
    );
  return { root, workdir, sessionId, handler, upload, history: () => history };
}

describe('Molly local attachment upload', () => {
  it.each(['molly_upload_images', 'molly_upload_files'])(
    '%s publishes one local attachment and returns success through local control',
    async (tool) => {
      const f = await uploadFixture();
      await writeFile(path.join(f.workdir, 'result.png'), imageBytes);
      const result = await f.upload(tool, ['result.png']);
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(JSON.stringify(result.content)).toContain('Uploaded 1');
      expect(f.history()).toHaveLength(1);
      const entry = f.history()[0];
      if (!entry) throw new Error('missing attachment entry');
      const items = entry.items;
      expect(items).toHaveLength(1);
      const file = items?.[0];
      if (!file || file.type !== 'file') throw new Error('missing local file');
      expect(file).toMatchObject({
        transport: 'local',
        machineId: 'machine-1',
        sourcePath: 'result.png',
        sha256: createHash('sha256').update(imageBytes).digest('hex'),
      });
      expect(file).not.toHaveProperty('downloadUrl');
      const reopened = await f.handler.handleLocalMachineRpc(
        LocalMachineRpcRequestSchema.parse({
          machineId: 'machine-1',
          workspaceId: 'workspace-1',
          method: 'file/resolve-local',
          params: {
            v: 3,
            sessionId: f.sessionId,
            attachment: { fileId: file.fileId, sha256: file.sha256 },
          },
        })
      );
      if (!reopened.ok || !('status' in reopened.result) || reopened.result.status !== 'local-file')
        throw new Error('local attachment unavailable');
      expect(await readFile(reopened.result.absolutePath)).toEqual(imageBytes);
    }
  );

  it.each(['absolute', 'symlink'])(
    'refuses %s paths outside the session workspace without publishing an attachment',
    async (kind) => {
      const f = await uploadFixture();
      const outside = path.join(f.root, 'private.png');
      await writeFile(outside, imageBytes);
      const requested = kind === 'absolute' ? outside : path.join(f.workdir, 'linked.png');
      if (kind === 'symlink') await symlink(outside, requested);
      const result = await f.upload('molly_upload_images', [requested]);
      expect(result.isError).toBe(true);
      expect(f.history()).toEqual([]);
    }
  );
});
