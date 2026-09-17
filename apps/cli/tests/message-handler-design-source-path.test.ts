import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import {
  LocalMachineRpcRequestSchema,
  getSessionRoomId,
  getMachineRoomId,
  type SessionId,
  type SessionMeta,
  type WorkspaceId,
  type MachineId,
} from '@molly/shared';
import { MessageHandler } from '../src/lib/message-handler';
import { getDefaultSessionWorkdir } from '../src/session/session';
import { designTurnInputDir, DESIGN_TURN_MANIFEST_FILENAME } from '../src/design/turn-input';
import { resolveDesignWorkspace } from '../src/design/workspace';
import { ARTWORK_ENTRY } from '@molly/design-authoring';
// Historical draft fixture: path resolution must preserve old bytes without migrating them.
const ARTWORK_PAGE = 'pages/canvas.yaml';
import type { SessionManager } from '../src/session/session-manager';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { Logger } from '../src/utils/logger';
import { createTestCloudPort } from './test-cloud-port';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const workspaceId = 'workspace-test' as WorkspaceId;
const machineId = 'machine-test' as MachineId;
const logger = (): Logger => ({
  info() {},
  warn() {},
  error() {},
  success() {},
  debug() {},
  setLevel() {},
  child: logger,
  close: async () => {},
});
function createHandler(meta: Partial<SessionMeta>, projectRoot?: string, deleted = false) {
  const refuseWrite = () => {
    throw Error('Readback must not write metadata or start an Agent');
  };
  const manager = {
    getSession: () => undefined,
    getPendingSession: () => undefined,
    on() {},
    setRequestPermissionHandler() {},
    createSession: refuseWrite,
  } as unknown as SessionManager;
  const document = {
    isTransportConnected: () => false,
    markMachineFlockDocDirty: refuseWrite,
    getOrCreateSessionDoc: refuseWrite,
    repo: {
      getDocMeta: async (room: string) => {
        if (room === getSessionRoomId(meta.id as SessionId)) return { meta, exists: !deleted };
        if (room === getMachineRoomId(machineId))
          return {
            meta: {
              localProjects: projectRoot
                ? {
                    'project-test': {
                      id: 'project-test',
                      name: 'Synthetic',
                      rootPath: projectRoot,
                      createdAtMs: 1,
                    },
                  }
                : {},
            },
          };
        return undefined;
      },
      openFlockDoc: async () => ({ flock: { scan: () => [] }, syncOnce: refuseWrite }),
      watch: () => ({ unsubscribe() {} }),
      upsertDocMeta: refuseWrite,
    },
  } as unknown as LoroDocumentManager;
  return new MessageHandler(manager, document, logger(), {
    workspaceId,
    machineId,
    userId: 'local:test',
    machineName: 'Synthetic',
    cliVersion: 'test',
    token: 'synthetic',
    cloudPort: createTestCloudPort(),
  });
}
async function request(
  handler: MessageHandler,
  sessionId: SessionId,
  method: string,
  params: object
) {
  return handler.handleLocalMachineRpc(
    LocalMachineRpcRequestSchema.parse({
      workspaceId,
      machineId,
      ownerSessionId: sessionId,
      method,
      params,
    })
  );
}

test.each([
  'legacy-chat',
  'legacy-project',
  'project',
  'archived-project',
  'archived-chat',
] as const)('unloaded %s draft reopens original bytes without creating a Session', async (kind) => {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-source-'));
  roots.push(root);
  vi.stubEnv('MOLLY_DATA_DIR', root);
  const sessionId = randomUUID() as SessionId;
  const artworkId = randomUUID(); // Deliberately different from history owner.
  const projectRoot = kind.endsWith('chat') ? undefined : path.join(root, 'project');
  const legacyWorkdir = getDefaultSessionWorkdir(sessionId);
  const workspace = resolveDesignWorkspace({
    workspaceRoot: projectRoot ?? legacyWorkdir,
    sessionId,
    artworkId,
    legacyWorkdir,
  });
  const isLegacy = kind.startsWith('legacy');
  const draftRoot = isLegacy ? legacyWorkdir : workspace.artifactWorkdir;
  const turnId = 'cancelled-turn';
  const input = designTurnInputDir(legacyWorkdir, turnId);
  await mkdir(input, { recursive: true });
  await mkdir(path.join(draftRoot, 'pages'), { recursive: true });
  await mkdir(path.join(draftRoot, 'media'), { recursive: true });
  const original = `size: [800, 600]\npages: [${ARTWORK_PAGE}]\n`;
  const page = 'background: {type: solid, color: "#ff0000"}\nelements: []\n';
  const asset = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4IScHAAK2AQU0pnWqAAAAAElFTkSuQmCC',
    'base64'
  );
  await writeFile(path.join(draftRoot, ARTWORK_ENTRY), original);
  await writeFile(path.join(draftRoot, ARTWORK_PAGE), page);
  await writeFile(path.join(draftRoot, 'media/original.png'), asset);
  await writeFile(path.join(draftRoot, 'design.pptd'), 'version: v2\nsize: [800, 600]\n');
  await writeFile(
    path.join(input, DESIGN_TURN_MANIFEST_FILENAME),
    JSON.stringify({
      version: 1,
      turnId,
      baselineRevisionId: 'a'.repeat(64),
      ...(isLegacy ? {} : { artworkId, artifactWorkdir: draftRoot }),
    })
  );
  const meta: Partial<SessionMeta> = {
    id: sessionId,
    machineId,
    userId: 'local:test',
    design: { artworkId, path: 'design.json' },
    isArchived: kind.startsWith('archived'),
    ...(projectRoot
      ? { project: { kind: 'local', localProjectId: 'project-test' } as SessionMeta['project'] }
      : {}),
  };
  const handler = createHandler(meta, projectRoot);
  const source = await request(handler, sessionId, 'design/source-path', { turnId });
  expect(source.ok).toBe(true);
  if (!source.ok || source.result.type !== 'design/source-path' || !source.result.ok)
    throw Error(JSON.stringify(source));
  expect(source.result.path).toBe(path.join(draftRoot, ARTWORK_ENTRY));
  expect(source.result.path).not.toMatch(/design\.pptd$/);
  for (const [relative, expected] of [
    [ARTWORK_ENTRY, Buffer.from(original)],
    [ARTWORK_PAGE, Buffer.from(page)],
    ['media/original.png', asset],
  ] as const) {
    const resolved = await request(handler, sessionId, 'file/resolve-local', {
      v: 3,
      sessionId,
      path: path.join(draftRoot, relative),
    });
    if (!resolved.ok || !('status' in resolved.result) || resolved.result.status !== 'local-file')
      throw Error('Expected ordinary local file resolution');
    expect(await readFile(resolved.result.absolutePath)).toEqual(expected);
  }
  if (kind.startsWith('archived')) {
    const forbidden = await request(handler, sessionId, 'code-collab/get-file-index', {
      sessionId,
    });
    expect(forbidden.ok && 'code' in forbidden.result ? forbidden.result.code : undefined).toBe(
      'permission_denied'
    );
  }
  if (!isLegacy && projectRoot) {
    const manifestPath = path.join(input, DESIGN_TURN_MANIFEST_FILENAME);
    const frozenBytes = await readFile(manifestPath);
    const manifest = JSON.parse(frozenBytes.toString());
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, artifactWorkdir: path.join(root, 'other-workspace') })
    );
    expect(await request(handler, sessionId, 'design/source-path', { turnId })).toMatchObject({
      ok: true,
      result: { ok: false },
    });
    await rm(manifestPath);
    // Even though today's draft exists, missing history cannot be replaced by a guess.
    expect(await request(handler, sessionId, 'design/source-path', { turnId })).toMatchObject({
      ok: true,
      result: { ok: false },
    });
    // Explicit current-source reads do not need historical dispatch facts.
    expect(await request(handler, sessionId, 'design/source-path', {})).toMatchObject({
      ok: true,
      result: { ok: true, path: path.join(draftRoot, ARTWORK_ENTRY) },
    });
    expect(await readFile(path.join(draftRoot, ARTWORK_ENTRY), 'utf8')).toBe(original);
    expect(await readFile(path.join(draftRoot, 'design.pptd'), 'utf8')).toBe(
      'version: v2\nsize: [800, 600]\n'
    );
    await writeFile(manifestPath, frozenBytes);
  }
  const missing = await request(
    createHandler(meta, projectRoot, true),
    sessionId,
    'design/source-path',
    { turnId }
  );
  expect(
    await request(createHandler(meta, projectRoot, true), sessionId, 'design/source-path', {})
  ).toMatchObject({
    ok: true,
    result: { ok: false },
  });
  expect(missing).toMatchObject({ ok: true, result: { type: 'design/source-path', ok: false } });
  await rm(path.join(draftRoot, ARTWORK_ENTRY));
  expect(await request(handler, sessionId, 'design/source-path', {})).toMatchObject({
    ok: true,
    result: { ok: true, path: path.join(workspace.artifactWorkdir, ARTWORK_ENTRY) },
  });
  expect(await request(handler, sessionId, 'design/source-path', { turnId })).toMatchObject({
    ok: true,
    result: { ok: false },
  });
});
