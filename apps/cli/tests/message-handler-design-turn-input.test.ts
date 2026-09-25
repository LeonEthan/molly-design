/**
 * Design turn-input materialization wiring (P2.2): a design session's user turn
 * freezes a manifest before dispatch, reference image bytes land content-named,
 * and a manifest failure blocks the turn instead of dispatching without an
 * integrity anchor. Non-design sessions stay byte-identical and write nothing.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionId, SessionMeta, SessionInputBlock, WorkspaceId } from '@molly/shared';

import { copyIntoSessionFileBlobStore } from '../src/lib/session-file-blob-store';
import { MessageHandler } from '../src/lib/message-handler';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { SessionManager } from '../src/session/session-manager';
import type { Logger } from '../src/utils/logger';
import { createTestCloudPort } from './test-cloud-port';

const mocks = vi.hoisted(() => ({
  sourceDir: '',
  materializeError: null as Error | null,
  // Image downloads are stubbed per turn; the real HTTP path has its own tests.
  imageBytes: Buffer.from([]) as Buffer,
  imageMimeType: 'image/png',
}));

vi.mock('@/design/skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/design/skills')>();
  return {
    ...actual,
    materializeDesignSkills: (opts: Parameters<typeof actual.materializeDesignSkills>[0]) => {
      if (mocks.materializeError) throw mocks.materializeError;
      return actual.materializeDesignSkills({ ...opts, sourceDir: mocks.sourceDir });
    },
  };
});

vi.mock('@/lib/session-image-download', () => ({
  downloadSessionImageForPrompt: vi.fn(async () => ({
    block: {
      type: 'image',
      mimeType: mocks.imageMimeType,
      data: mocks.imageBytes.toString('base64'),
    },
    bytes: mocks.imageBytes,
    mimeType: mocks.imageMimeType,
    sizeBytes: mocks.imageBytes.byteLength,
  })),
}));

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

const createHandler = (
  meta: Partial<SessionMeta> | undefined,
  workspaceRoot?: string
): MessageHandler => {
  const sessionManager = {
    getSession: vi.fn(() => ({
      getHostWorkdir: () =>
        workspaceRoot ??
        path.join(process.env.MOLLY_DATA_DIR ?? '', 'chats', meta?.id ?? 'unknown'),
      getWorkdir: () => undefined,
    })),
    on: vi.fn(),
    setRequestPermissionHandler: vi.fn(),
    cleanUp: vi.fn(async () => {}),
  } as unknown as SessionManager;
  const workspaceDocument = {
    isTransportConnected: vi.fn(() => true),
    markMachineFlockDocDirty: vi.fn(),
    repo: {
      getDocMeta: vi.fn(async () => ({ meta: {} })),
      watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
    },
    getOrCreateSessionDoc: vi.fn(async () => ({
      getMetaState: vi.fn(async () => meta),
    })),
    sendMachineHeartbeat: vi.fn(async () => {}),
  } as unknown as LoroDocumentManager;
  return new MessageHandler(sessionManager, workspaceDocument, createSilentLogger(), {
    token: 'token',
    workspaceId: 'workspace-1' as WorkspaceId,
    userId: 'user-1',
    machineId: 'machine-1',
    machineName: 'machine',
    cliVersion: '0.0.0',
    // Synthetic base URL only: the image download itself is mocked, but the
    // prompt builder resolves this before calling it.
    cloudPort: createTestCloudPort({
      attachmentUpload: { serverBaseUrl: 'https://attachments.invalid' },
    }),
  });
};

type PromptBlock = { type: string; text?: string; mimeType?: string; data?: string };
type PromptBlockBuilder = {
  buildAcpPromptBlocks: (args: {
    workspaceId: WorkspaceId;
    sessionId: SessionId;
    inputBlocks: SessionInputBlock[];
    userTurnId?: string;
  }) => Promise<PromptBlock[]>;
};

describe('MessageHandler design turn-input wiring', () => {
  let tmpDir: string;
  let dataDir: string;
  let previousDataDir: string | undefined;
  const sessionId = '377e2ee7-4bf2-4e60-8e92-5365c2975a51' as SessionId;
  const workspaceId = 'workspace-1' as WorkspaceId;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lody-design-turn-input-'));
    dataDir = path.join(tmpDir, 'data');
    previousDataDir = process.env.MOLLY_DATA_DIR;
    process.env.MOLLY_DATA_DIR = dataDir;
    mocks.materializeError = null;
    mocks.imageBytes = Buffer.from([1, 2, 3, 4]);
    mocks.imageMimeType = 'image/png';

    mocks.sourceDir = path.join(tmpDir, 'bundle');
    const skillSrc = path.join(mocks.sourceDir, 'graphic-design');
    fs.mkdirSync(path.join(skillSrc, 'references'), { recursive: true });
    fs.writeFileSync(path.join(skillSrc, 'SKILL.md'), '# synthetic skill\n');
    fs.writeFileSync(path.join(skillSrc, 'references', 'guide.md'), 'guide\n');

    // The design store owns chats/<id>/design.json; create the baseline through
    // it so the manifest pins a real revisionId.
    const { designOperation } = await import('../src/design/store');
    await designOperation(dataDir, {
      operation: 'create',
      association: {
        sessionId,
        name: 'Synthetic',
        userId: 'local:test',
        machineId: 'machine-1',
        createdAt: '2026-09-10T00:00:00.000Z',
      },
      width: 1024,
      height: 768,
    });
  });

  afterEach(() => {
    if (previousDataDir === undefined) delete process.env.MOLLY_DATA_DIR;
    else process.env.MOLLY_DATA_DIR = previousDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const build = async (
    handler: MessageHandler,
    inputBlocks: Parameters<PromptBlockBuilder['buildAcpPromptBlocks']>[0]['inputBlocks'],
    userTurnId?: string
  ) =>
    await (handler as MessageHandler & PromptBlockBuilder).buildAcpPromptBlocks({
      workspaceId,
      sessionId,
      inputBlocks,
      ...(userTurnId ? { userTurnId } : {}),
    });

  const designMeta = (): Partial<SessionMeta> => ({
    id: sessionId,
    machineId: 'machine-1' as SessionMeta['machineId'],
    createdAt: new Date().toISOString(),
    design: { artworkId: sessionId, path: 'design.json' },
  });

  it.each(['image/jpeg', 'image/png'])(
    'freezes local %s bytes and dispatches an ACP image block without image MCP',
    async (mimeType) => {
      const bytes =
        mimeType === 'image/png'
          ? fs.readFileSync(new URL('./fixtures/reference-shapes.png', import.meta.url))
          : Buffer.from([255, 216, 255, 224, 1, 2, 3, 255, 217]);
      const source = path.join(
        tmpDir,
        mimeType === 'image/png' ? 'reference.png' : 'reference.jpg'
      );
      fs.writeFileSync(source, bytes);
      const fileId = 'file-local-reference';
      await copyIntoSessionFileBlobStore({ workspaceId, sessionId, fileId, sourcePath: source });
      const handler = createHandler(designMeta());
      try {
        const blocks = await build(
          handler,
          [
            {
              type: 'file',
              fileId,
              fileName: path.basename(source),
              mimeType,
              sizeBytes: bytes.length,
              sha256: createHash('sha256').update(bytes).digest('hex'),
              textPreview: false,
              transport: 'local',
              machineId: 'machine-1',
              uploadedAt: 1,
            },
          ],
          'turn-local-reference'
        );
        expect(blocks).toContainEqual({
          type: 'image',
          mimeType,
          data: bytes.toString('base64'),
        });
        const turnDir = path.join(
          dataDir,
          'chats',
          sessionId,
          'design-input',
          'turn-local-reference'
        );
        const manifest = JSON.parse(fs.readFileSync(path.join(turnDir, 'manifest.json'), 'utf8'));
        expect(manifest.references).toHaveLength(1);
        expect(manifest.references[0].sha256).toBe(
          createHash('sha256').update(bytes).digest('hex')
        );
        expect(fs.readFileSync(path.join(turnDir, manifest.references[0].file))).toEqual(bytes);
      } finally {
        await handler.cleanup();
      }
    }
  );

  it('freezes the manifest and content-named reference copies for a user turn', async () => {
    const handler = createHandler(designMeta());
    const turnId = 'turn-user-1';
    try {
      const blocks = await build(
        handler,
        [
          { type: 'text', text: 'make a poster' },
          { type: 'image', imageId: 'image-1', mimeType: 'image/png', sizeBytes: 4 },
        ],
        turnId
      );

      const workdir = path.join(dataDir, 'chats', sessionId);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(workdir, 'design-input', turnId, 'manifest.json'), 'utf8')
      ) as Record<string, unknown>;
      const hash = createHash('sha256').update(mocks.imageBytes).digest('hex');

      // The manifest records the turn's own text; the app's skill pointer is
      // app-generated scaffolding (skill content is identified by hash instead)
      // and still reaches the agent through the text block.
      expect(manifest.prompt).toBe('make a poster');
      expect(blocks).toContainEqual({
        type: 'text',
        text: expect.stringContaining(
          `make a poster\n\nBefore design work, read the design skill: ${workdir}/.claude/skills/graphic-design/SKILL.md. It covers the artwork format and a recommended workflow; adapt it to the task.`
        ),
      });
      expect(manifest.canvas).toEqual({ width: 1024, height: 768 });
      expect(typeof manifest.baselineRevisionId).toBe('string');
      expect(manifest.baselineRevisionId).toMatch(/^[a-f0-9]{64}$/);
      expect(typeof manifest.skillSourceIdentity).toBe('string');
      expect(manifest.skillDrift).toEqual([]);
      expect(manifest.references).toEqual([
        { file: `references/${hash}.png`, sha256: hash, bytes: 4, mimeType: 'image/png' },
      ]);
      const landed = fs.readFileSync(
        path.join(workdir, 'design-input', turnId, 'references', `${hash}.png`)
      );
      expect(landed.equals(mocks.imageBytes)).toBe(true);

      // The reference still flows to the agent as a prompt image block.
      expect(blocks.some((block) => block.type === 'image')).toBe(true);
    } finally {
      await handler.cleanup();
    }
  });

  it('blocks the turn when the skill sync fails and cannot record its identity', async () => {
    mocks.materializeError = new Error('bundle missing');
    const handler = createHandler(designMeta());
    try {
      await expect(
        build(handler, [{ type: 'text', text: 'make a poster' }], 'turn-blocked')
      ).rejects.toThrow(/skill materialization failed/);
      expect(
        fs.existsSync(path.join(dataDir, 'chats', sessionId, 'design-input', 'turn-blocked'))
      ).toBe(false);
    } finally {
      await handler.cleanup();
    }
  });

  it('blocks the turn when the design baseline is unreadable', async () => {
    fs.rmSync(path.join(dataDir, 'chats', sessionId, 'design.json'));
    const handler = createHandler(designMeta());
    try {
      await expect(
        build(handler, [{ type: 'text', text: 'make a poster' }], 'turn-nobaseline')
      ).rejects.toThrow(/design baseline unreadable/);
      expect(
        fs.existsSync(path.join(dataDir, 'chats', sessionId, 'design-input', 'turn-nobaseline'))
      ).toBe(false);
    } finally {
      await handler.cleanup();
    }
  });

  it('keeps non-design sessions byte-identical with no manifest', async () => {
    const handler = createHandler({
      id: sessionId,
      machineId: 'machine-1' as SessionMeta['machineId'],
      createdAt: new Date().toISOString(),
    });
    try {
      const blocks = await build(handler, [{ type: 'text', text: 'fix the flaky test' }], 'turn-1');
      expect(blocks).toEqual([{ type: 'text', text: 'fix the flaky test' }]);
      expect(fs.existsSync(path.join(dataDir, 'chats', sessionId, 'design-input'))).toBe(false);
    } finally {
      await handler.cleanup();
    }
  });

  it.each(['local-project', 'non-git'])(
    'prepares the actual Session directory for %s',
    async (kind) => {
      const workspaceRoot = path.join(tmpDir, kind);
      fs.mkdirSync(workspaceRoot, { recursive: true });
      if (kind === 'local-project') fs.mkdirSync(path.join(workspaceRoot, '.git'));
      const handler = createHandler(designMeta(), workspaceRoot);
      try {
        const blocks = await build(
          handler,
          [{ type: 'text', text: 'create in this workspace' }],
          'project-turn'
        );
        const inputDir = path.join(dataDir, 'chats', sessionId, 'design-input', 'project-turn');
        const manifest = JSON.parse(fs.readFileSync(path.join(inputDir, 'manifest.json'), 'utf8'));
        const artifactWorkdir = path.join(
          workspaceRoot,
          '.molly',
          'artworks',
          sessionId,
          sessionId
        );
        expect(manifest.artifactWorkdir).toBe(artifactWorkdir);
        expect(manifest.artworkId).toBe(sessionId);
        expect(manifest.artifactAtSend).toEqual({ status: 'absent' });
        expect(fs.existsSync(path.join(artifactWorkdir, 'design.yaml'))).toBe(false);
        expect(
          fs.existsSync(path.join(workspaceRoot, '.claude/skills/graphic-design/SKILL.md'))
        ).toBe(true);
        const text = blocks.find((block) => block.type === 'text')?.text;
        expect(text).toContain(artifactWorkdir);
        expect(text).toContain(inputDir);
      } finally {
        await handler.cleanup();
      }
    }
  );

  it('omits the manifest for internal turns without a userTurnId but still guides the agent', async () => {
    const handler = createHandler(designMeta());
    try {
      const blocks = await build(handler, [{ type: 'text', text: 'internal' }]);
      const workdir = path.join(dataDir, 'chats', sessionId);
      expect(blocks).toEqual([
        {
          type: 'text',
          text: expect.stringContaining(
            `internal\n\nBefore design work, read the design skill: ${workdir}/.claude/skills/graphic-design/SKILL.md. It covers the artwork format and a recommended workflow; adapt it to the task.`
          ),
        },
      ]);
      expect(fs.existsSync(path.join(workdir, 'design-input'))).toBe(false);
    } finally {
      await handler.cleanup();
    }
  });
});
