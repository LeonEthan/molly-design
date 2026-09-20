import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoroDoc } from 'loro-crdt';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  LocalMachineRpcRequestSchema,
  LocalMachineRpcResponseSchema,
  getSessionRoomId,
  buildDesignContinuationMeta,
  type SessionInputBlock,
  type SessionFilePayload,
  type SessionTurnInputConfig,
  type SessionId,
  type WorkspaceId,
} from '@molly/shared';
import { SessionDocument, type LoroDocumentManager } from '../src/lib/loro/doc';
import { MessageHandler } from '../src/lib/message-handler';
import { getSessionFileBlobPath } from '../src/lib/session-file-blob-store';
import type { SessionManager } from '../src/session/session-manager';
import type { Logger } from '../src/utils/logger';
import { createTestCloudPort } from './test-cloud-port';
import type { ContentBlock } from '@agentclientprotocol/sdk';
import type { DownloadedSessionImagePromptBlock } from '../src/lib/session-image-download';

const sourceId = 'source-1' as SessionId;
const workspaceId = 'workspace-1' as WorkspaceId;
const bytes = Buffer.from('Synthetic continuation attachment');
const request = {
  method: 'session/design-continuation-prepare',
  workspaceId,
  machineId: 'machine-1',
  params: {
    version: 1,
    sourceSessionId: sourceId,
    targetAgentConfigId: 'molly-config',
    requestedByUserId: 'user-1',
  },
};
const logger: Logger = {
  info() {},
  warn() {},
  error() {},
  success() {},
  debug() {},
  setLevel() {},
  child: () => logger,
  close: async () => {},
};

function fixture(
  saved = new Map<string, Uint8Array>(),
  options: { attachmentBytes?: Buffer; mimeType?: string } = {}
) {
  const attachmentBytes = options.attachmentBytes ?? bytes;
  const source = {
    id: sourceId,
    userId: 'user-1',
    machineId: 'machine-1',
    cliType: 'builtin',
    agentType: 'codex',
    design: { artworkId: 'artwork-1', path: 'design.json' },
    isArchived: true,
    acpSessionId: 'old-native-id',
    latestUserMsgId: 'old-turn',
  };
  const metas = new Map<string, unknown>([[getSessionRoomId(sourceId), { meta: source }]]);
  const docs = new Map<SessionId, { doc: SessionDocument; loro: LoroDoc }>();
  const state = {
    failPersist: false,
    configAvailable: true,
    sourceBusy: false,
    invocation: {
      requesterUserId: 'user-1',
      sourceTurnId: 'new-first-turn',
      inputConfig: { agentConfigId: 'molly-config' as never },
    } as
      | { requesterUserId: string; sourceTurnId: string; inputConfig: SessionTurnInputConfig }
      | undefined,
  };
  const repo = {
    getDocMeta: async (room: string) => metas.get(room),
    upsertDocMeta: async () => {
      throw new Error('Preparation must not publish metadata');
    },
    watch: () => ({ unsubscribe() {} }),
    openFlockDoc: async () => ({
      flock: { scan: () => [], set() {}, delete() {}, commit() {} },
      syncOnce: async () => {},
    }),
  };
  const open = async (id: SessionId) => {
    const current = docs.get(id);
    if (current) return current.doc;
    const loro = new LoroDoc();
    const snapshot = saved.get(id);
    if (snapshot) loro.import(snapshot);
    const doc = new SessionDocument(repo as never, id, async () => {});
    doc.handle = { doc: loro } as never;
    doc.composeSessionData(loro, {
      history:
        id === sourceId
          ? [
              {
                id: 'old-turn',
                role: 'user',
                status: 'handled',
                timestamp: '2026-09-20T00:00:00.000Z',
                fileDiff: [],
                items: [
                  { type: 'text', text: 'Synthetic legacy design reference' },
                  ...['present-file', 'missing-file'].map((fileId) => ({
                    type: 'file' as const,
                    fileId,
                    fileName: `${fileId}.txt`,
                    mimeType: options.mimeType ?? 'text/plain',
                    sizeBytes: attachmentBytes.length,
                    sha256: createHash('sha256').update(attachmentBytes).digest('hex'),
                    transport: 'local' as const,
                    machineId: 'machine-1',
                    uploadedAt: 1,
                    textPreview: true,
                  })),
                ],
              },
            ]
          : [],
    });
    docs.set(id, { doc, loro });
    return doc;
  };
  const workspace = {
    repo,
    isTransportConnected: () => true,
    markMachineFlockDocDirty() {},
    sendMachineHeartbeat: async () => {},
    getOrCreateSessionDoc: open,
    getAgentConfigById: async () =>
      state.configAvailable
        ? { id: 'molly-config', machineId: 'machine-1', cliType: 'builtin', agentType: 'molly' }
        : undefined,
    persistPendingChanges: async () => {
      if (state.failPersist) throw new Error('/private/synthetic-disk-path secret-marker');
      for (const [id, value] of docs) saved.set(id, value.loro.export({ mode: 'snapshot' }));
    },
  } as unknown as LoroDocumentManager;
  const sessionManager = {
    getSession: () => ({
      getHostWorkdir: () => path.join(process.env.MOLLY_DATA_DIR ?? '', 'first-turn-workspace'),
      getWorkdir: () => path.join(process.env.MOLLY_DATA_DIR ?? '', 'first-turn-workspace'),
    }),
    getPendingSession: () => undefined,
    on() {},
    setRequestPermissionHandler() {},
    setHarnessCredentials() {},
    cleanUp: async () => {},
  } as unknown as SessionManager;
  const handler = new MessageHandler(sessionManager, workspace, logger, {
    token: 'synthetic-token',
    workspaceId,
    userId: 'user-1',
    machineId: 'machine-1',
    machineName: 'Synthetic machine',
    cliVersion: '0.0.0',
    cloudPort: createTestCloudPort(),
  });
  // Drive the existing live execution source without changing persisted Session status.
  const execution = (
    handler as unknown as {
      executionService: {
        getExecutionSnapshot: () => unknown;
        getActiveInvocationContext: () => typeof state.invocation;
      };
    }
  ).executionService;
  execution.getExecutionSnapshot = () => ({
    hasActiveTurn: state.sourceBusy,
    hasBlockingPendingCreate: false,
    hasReusableSession: false,
    hasRewriteBarrier: false,
    hasActiveAutomation: false,
    ...(state.sourceBusy ? { activeTurnId: 'running-turn' } : {}),
  });
  execution.getActiveInvocationContext = () => state.invocation;
  const send = (value: unknown = request) =>
    handler.handleLocalMachineRpc(LocalMachineRpcRequestSchema.parse(value));
  const forwardedReferences: DownloadedSessionImagePromptBlock[][] = [];
  const prompt = handler as unknown as {
    buildAcpPromptBlocks: (args: {
      workspaceId: WorkspaceId;
      sessionId: SessionId;
      userTurnId?: string;
      inputBlocks: SessionInputBlock[];
    }) => Promise<ContentBlock[]>;
    prepareDesignTurn: (args: {
      imageAttachments: DownloadedSessionImagePromptBlock[];
    }) => Promise<string | null>;
    materializeSessionFileAttachments: (args: {
      workspaceId: WorkspaceId;
      sessionId: SessionId;
      fileBlocks: SessionFilePayload[];
      imageReferences?: DownloadedSessionImagePromptBlock[];
      localOnly?: boolean;
    }) => Promise<ContentBlock[]>;
    copyLocalSessionFileBlobToDisk: (args: {
      workspaceId: WorkspaceId;
      sessionId: SessionId;
      fileId: string;
      expectedSha256: string;
      expectedSizeBytes: number;
      destPath: string;
    }) => Promise<boolean>;
  };
  prompt.prepareDesignTurn = async ({ imageAttachments }) => {
    forwardedReferences.push(imageAttachments);
    return 'Synthetic frozen design pointer';
  };
  return { send, source, docs, metas, open, state, saved, prompt, forwardedReferences };
}

describe('production design continuation preparation RPC', () => {
  let temporaryRoot: string;
  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'molly-continuation-rpc-'));
    vi.stubEnv('MOLLY_DATA_DIR', path.join(temporaryRoot, '.molly'));
    vi.stubEnv('MOLLY_PLATFORM', 'local');
    const blob = getSessionFileBlobPath({
      workspaceId,
      sessionId: sourceId,
      fileId: 'present-file',
    });
    await mkdir(path.dirname(blob), { recursive: true });
    await writeFile(blob, bytes);
    await mkdir(path.join(temporaryRoot, '.molly', 'first-turn-workspace'));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  const readyTarget = async (f: ReturnType<typeof fixture>) => {
    const response = await f.send();
    if (!response.ok || response.result.type !== 'session/design-continuation-prepare')
      throw Error('preparation failed');
    const meta = buildDesignContinuationMeta(response.result.record);
    f.metas.set(getSessionRoomId(meta.id), { meta });
    const doc = await f.open(meta.id);
    await doc.sessionData.commands.appendTurn({
      id: 'new-first-turn',
      role: 'user',
      userId: 'user-1',
      status: 'processing',
      timestamp: '2026-09-20T01:00:00.000Z',
      fileDiff: [],
      items: [{ type: 'text', text: 'Current instruction' }],
    });
    return { meta, doc };
  };
  const buildFirst = (
    f: ReturnType<typeof fixture>,
    sessionId: SessionId,
    extra: SessionInputBlock[] = []
  ) =>
    f.prompt.buildAcpPromptBlocks({
      workspaceId,
      sessionId,
      userTurnId: 'new-first-turn',
      inputBlocks: [{ type: 'text', text: 'Current instruction' }, ...extra],
    });

  it.each(['multi-chunk', 'wrong-hash', 'wrong-size', 'symlink', 'directory'] as const)(
    'bounds local copy and publishes only verified bytes: %s',
    async (kind) => {
      const f = fixture();
      const content = Buffer.alloc(150_001, 97);
      const blob = getSessionFileBlobPath({
        workspaceId,
        sessionId: sourceId,
        fileId: 'copy-test',
      });
      if (kind === 'symlink') {
        const external = path.join(temporaryRoot, 'external-file');
        await writeFile(external, content);
        await symlink(external, blob);
      } else if (kind === 'directory') await mkdir(blob);
      else await writeFile(blob, content);
      const destPath = path.join(temporaryRoot, '.molly', 'first-turn-workspace', 'copy-test');
      const copied = await f.prompt.copyLocalSessionFileBlobToDisk({
        workspaceId,
        sessionId: sourceId,
        fileId: 'copy-test',
        expectedSha256:
          kind === 'wrong-hash'
            ? 'a'.repeat(64)
            : createHash('sha256').update(content).digest('hex'),
        expectedSizeBytes: kind === 'wrong-size' ? content.length - 1 : content.length,
        destPath,
      });
      expect(copied).toBe(kind === 'multi-chunk');
      expect(await readdir(path.dirname(destPath))).toEqual(
        kind === 'multi-chunk' ? ['copy-test'] : []
      );
      if (copied) expect(await readFile(destPath)).toEqual(content);
    }
  );

  it('hands off verified old files only on the first new human turn without copying history', async () => {
    const f = fixture();
    const { meta, doc } = await readyTarget(f);
    const source = f.docs.get(sourceId);
    if (!source) throw Error('missing source');
    const sourceVersion = source.loro.version().toJSON();
    const targetVersion = doc.handle?.doc.version().toJSON();
    source.doc.sessionData.history.readAll = () => {
      throw Error('Dispatch must not read all old bodies');
    };
    const first = await buildFirst(f, meta.id);
    const links = first.filter((block) => block.type === 'resource_link');
    expect(links.map((block) => block.name)).toEqual(['present-file.txt']);
    const link = links[0];
    if (!link) throw Error('missing link');
    expect(await readFile(fileURLToPath(link.uri))).toEqual(bytes);
    const text = first
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    expect(text).toContain('"sourceSessionId":"source-1"');
    expect(text).toContain('"fileId":"missing-file","status":"unavailable","reason":"missing"');
    expect(text).toContain('Current instruction');
    expect(text).not.toContain('Synthetic legacy design reference');
    expect(source.loro.version().toJSON()).toEqual(sourceVersion);
    expect(doc.handle?.doc.version().toJSON()).toEqual(targetVersion);
    await doc.sessionData.commands.appendTurn({
      id: 'second',
      role: 'user',
      userId: 'user-1',
      timestamp: '2026-09-20T02:00:00.000Z',
      items: [],
      fileDiff: [],
    });
    f.metas.delete(getSessionRoomId(sourceId));
    const second = await f.prompt.buildAcpPromptBlocks({
      workspaceId,
      sessionId: meta.id,
      userTurnId: 'second',
      inputBlocks: [{ type: 'text', text: 'Next instruction' }],
    });
    expect(second).toEqual([
      { type: 'text', text: 'Next instruction\n\nSynthetic frozen design pointer' },
    ]);
  });

  it('supplies historical raster bytes both to ACP vision and frozen design references', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64'
    );
    await writeFile(
      getSessionFileBlobPath({ workspaceId, sessionId: sourceId, fileId: 'present-file' }),
      png
    );
    const f = fixture(undefined, { attachmentBytes: png, mimeType: 'image/png' });
    const { meta } = await readyTarget(f);
    const blocks = await buildFirst(f, meta.id);
    expect(blocks.filter((block) => block.type === 'image')).toEqual([
      { type: 'image', mimeType: 'image/png', data: png.toString('base64') },
    ]);
    expect(f.forwardedReferences).toEqual([
      [
        {
          bytes: png,
          mimeType: 'image/png',
          sizeBytes: png.length,
          block: { type: 'image', mimeType: 'image/png', data: png.toString('base64') },
        },
      ],
    ]);
  });

  it.each(['missing-invocation', 'requester', 'provider', 'stale-turn', 'deleted-source'] as const)(
    'refuses unbound first-turn handoff: %s',
    async (kind) => {
      const f = fixture();
      const { meta } = await readyTarget(f);
      if (kind === 'missing-invocation') f.state.invocation = undefined;
      if (kind === 'requester' && f.state.invocation) f.state.invocation.requesterUserId = 'other';
      if (kind === 'provider' && f.state.invocation)
        f.state.invocation.inputConfig.agentConfigId = 'other' as never;
      if (kind === 'stale-turn' && f.state.invocation)
        f.state.invocation.sourceTurnId = 'other-turn';
      if (kind === 'deleted-source') f.metas.delete(getSessionRoomId(sourceId));
      await expect(buildFirst(f, meta.id)).rejects.toThrow(/design_continuation_/);
      expect(await readdir(path.join(temporaryRoot, '.molly', 'first-turn-workspace'))).toEqual([]);
    }
  );

  it('does not fetch or publish bytes that change after migration verification', async () => {
    const f = fixture();
    const { meta } = await readyTarget(f);
    const materialize = f.prompt.materializeSessionFileAttachments.bind(f.prompt);
    f.prompt.materializeSessionFileAttachments = async (args) => {
      if (args.localOnly)
        await writeFile(
          getSessionFileBlobPath({ workspaceId, sessionId: sourceId, fileId: 'present-file' }),
          'changed after inspection'
        );
      return materialize(args);
    };
    await expect(buildFirst(f, meta.id)).rejects.toThrow(
      'design_continuation_attachment_unavailable'
    );
    expect(
      await readdir(
        path.join(temporaryRoot, '.molly', 'first-turn-workspace', '.molly', 'attachments')
      )
    ).toEqual([]);
  });

  it('rejects ownership changes while files are being materialized', async () => {
    const f = fixture();
    const { meta } = await readyTarget(f);
    const materialize = f.prompt.materializeSessionFileAttachments.bind(f.prompt);
    f.prompt.materializeSessionFileAttachments = async (args) => {
      const blocks = await materialize(args);
      if (args.localOnly && f.state.invocation)
        f.state.invocation = { ...f.state.invocation, sourceTurnId: 'newer-turn' };
      return blocks;
    };
    await expect(buildFirst(f, meta.id)).rejects.toThrow('design_continuation_invocation_changed');
    expect(f.forwardedReferences).toEqual([]);
  });

  it('keeps current attachments first, deduplicates history identities, and reports turn limits', async () => {
    const f = fixture();
    const { meta } = await readyTarget(f);
    const old: SessionFilePayload = {
      type: 'file',
      fileId: 'present-file',
      fileName: 'present-file.txt',
      mimeType: 'text/plain',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      transport: 'local',
      machineId: 'machine-1',
      storageSessionId: sourceId,
      uploadedAt: 1,
      textPreview: true,
    };
    const duplicate = await buildFirst(f, meta.id, [old]);
    expect(
      duplicate.filter((block) => block.type === 'resource_link').map((block) => block.name)
    ).toEqual(['present-file.txt']);
    const current: SessionFilePayload[] = [];
    for (let i = 0; i < 8; i++) {
      const file = {
        ...old,
        fileId: `current-${i}`,
        fileName: `current-${i}.txt`,
        storageSessionId: meta.id,
      };
      const blob = getSessionFileBlobPath({ workspaceId, sessionId: meta.id, fileId: file.fileId });
      await mkdir(path.dirname(blob), { recursive: true });
      await writeFile(blob, bytes);
      current.push(file);
    }
    const limited = await buildFirst(f, meta.id, current);
    expect(
      limited.filter((block) => block.type === 'resource_link').map((block) => block.name)
    ).toEqual(current.map((file) => file.fileName));
    expect(
      limited
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
    ).toContain('"omittedByTurnLimit":["present-file"]');
  });

  it('persists one receipt, reports actual local bytes, and preserves the archived source', async () => {
    const f = fixture();
    await f.open(sourceId);
    const before = f.docs.get(sourceId)?.loro.version().toJSON();
    const result = LocalMachineRpcResponseSchema.parse(await f.send());
    expect(result.ok).toBe(true);
    if (!result.ok || result.result.type !== request.method) throw Error('wrong result');
    if (!('record' in result.result)) throw Error('missing receipt');
    expect(result.result.attachments).toEqual([
      { sourceTurnId: 'old-turn', fileId: 'present-file', status: 'available' },
      {
        sourceTurnId: 'old-turn',
        fileId: 'missing-file',
        status: 'unavailable',
        reason: 'missing',
      },
    ]);
    expect(result.result.record.reference.messages[0]?.text).toBe(
      'Synthetic legacy design reference'
    );
    expect(JSON.stringify(result)).not.toContain('old-native-id');
    expect(f.saved.has(result.result.record.target.sessionId)).toBe(true);
    expect(f.docs.get(sourceId)?.loro.version().toJSON()).toEqual(before);
    expect([...f.metas.keys()]).toEqual([getSessionRoomId(sourceId)]);
    expect(f.source.isArchived).toBe(true);
    const reopened = fixture(f.saved);
    expect(await reopened.send()).toEqual(result);
  });

  it.each(['workspace', 'machine', 'requester', 'agent-context'] as const)(
    'rejects a foreign envelope before reading any history: %s',
    async (kind) => {
      const f = fixture();
      const value = structuredClone(request);
      if (kind === 'workspace') value.workspaceId = 'other-workspace' as WorkspaceId;
      if (kind === 'machine') value.machineId = 'other-machine';
      if (kind === 'requester') value.params.requestedByUserId = 'other-user';
      expect(
        await f.send(kind === 'agent-context' ? { ...value, ownerSessionId: sourceId } : value)
      ).toEqual({ ok: false, error: 'design_continuation_access_denied' });
      expect([...f.docs.keys()]).toEqual([]);
    }
  );

  it.each(['owner', 'busy', 'deleted', 'config'] as const)(
    'reuses service eligibility checks: %s',
    async (kind) => {
      const f = fixture();
      if (kind === 'owner') f.source.userId = 'other-user';
      if (kind === 'busy') f.state.sourceBusy = true;
      if (kind === 'deleted')
        f.metas.set(getSessionRoomId(sourceId), { meta: f.source, deleted: true });
      if (kind === 'config') f.state.configAvailable = false;
      expect(await f.send()).toEqual({
        ok: false,
        error: {
          owner: 'design_continuation_access_denied',
          busy: 'design_continuation_source_busy',
          deleted: 'design_continuation_source_unavailable',
          config: 'design_continuation_target_unavailable',
        }[kind],
      });
      expect([...f.docs.keys()]).toEqual([]);
    }
  );

  it('redacts unexpected storage errors and permits explicit retry of the same receipt', async () => {
    const f = fixture();
    f.state.failPersist = true;
    expect(await f.send()).toEqual({ ok: false, error: 'design_continuation_prepare_failed' });
    expect([...f.saved.keys()]).toEqual([]);
    const receipt = [...f.docs.values()]
      .map((entry) => entry.doc.getDesignContinuation())
      .find(Boolean);
    f.state.failPersist = false;
    const result = await f.send();
    expect(result).toMatchObject({ ok: true, result: { record: receipt } });
    expect([...f.metas.keys()]).toEqual([getSessionRoomId(sourceId)]);
  });
});
