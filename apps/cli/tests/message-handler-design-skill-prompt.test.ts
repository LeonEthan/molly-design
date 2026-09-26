/**
 * Design-turn prompt wiring (P2.1): a session whose meta carries a design
 * association gets the bundled skills materialized into its workdir and a
 * pointer line appended to the prompt; non-design sessions are unchanged.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IMAGE_CONNECTION_VERSION,
  machineFlockKeys,
  type ImageConnectionSettings,
  type MachineFlockKey,
  type SessionId,
  type SessionMeta,
  type WorkspaceId,
} from '@molly/shared';

import { MessageHandler } from '../src/lib/message-handler';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { SessionManager } from '../src/session/session-manager';
import type { Logger } from '../src/utils/logger';
import { createTestCloudPort } from './test-cloud-port';

const mocks = vi.hoisted(() => ({ sourceDir: '' }));

/**
 * Minimal in-memory flock (same shape as `image-connection.test.ts`): the
 * handler's own image-connection read goes through this, so the capability gate
 * is exercised against a real stored row rather than a stubbed predicate.
 */
class FakeFlock {
  readonly rows = new Map<string, { key: MachineFlockKey; value: unknown }>();

  scan(options?: { prefix?: readonly unknown[] }) {
    return [...this.rows.values()].filter((row) => {
      const prefix = options?.prefix;
      return !prefix || prefix.every((part, index) => row.key[index] === part);
    });
  }

  set(key: MachineFlockKey, value: unknown): void {
    this.rows.set(JSON.stringify(key), { key: [...key] as MachineFlockKey, value });
  }

  delete(key: MachineFlockKey): void {
    this.rows.delete(JSON.stringify(key));
  }

  commit(): void {}
}

const storedImageConnection = (
  overrides: Partial<ImageConnectionSettings> = {}
): ImageConnectionSettings => ({
  v: IMAGE_CONNECTION_VERSION,
  enabled: true,
  baseUrl: 'https://images.example.com/v1',
  apiKey: 'sk-test-placeholder-not-real',
  model: 'gpt-image-2',
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

vi.mock('@/design/skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/design/skills')>();
  return {
    ...actual,
    // The materializer's bundle-resolution seam is covered by its own tests;
    // here the staged bundle is replaced with a synthetic source dir.
    materializeDesignSkills: (opts: Parameters<typeof actual.materializeDesignSkills>[0]) =>
      actual.materializeDesignSkills({ ...opts, sourceDir: mocks.sourceDir }),
  };
});

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
  imageConnection?: ImageConnectionSettings
): MessageHandler => {
  const sessionManager = {
    setHarnessCredentials: () => undefined,
    getSession: vi.fn((id: string) => ({
      getHostWorkdir: () => path.join(process.env.MOLLY_DATA_DIR ?? '', 'chats', id),
      getWorkdir: () => undefined,
    })),
    on: vi.fn(),
    setRequestPermissionHandler: vi.fn(),
    cleanUp: vi.fn(async () => {}),
  } as unknown as SessionManager;
  const flock = new FakeFlock();
  if (imageConnection) flock.set(machineFlockKeys.imageConnection(), imageConnection);
  const workspaceDocument = {
    isTransportConnected: vi.fn(() => true),
    markMachineFlockDocDirty: vi.fn(),
    repo: {
      getDocMeta: vi.fn(async () => ({ meta: {} })),
      watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
      openFlockDoc: vi.fn(async () => ({ flock, syncOnce: vi.fn(async () => {}) })),
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
    cloudPort: createTestCloudPort(),
  });
};

const DESIGN_META = (sessionId: SessionId): Partial<SessionMeta> => ({
  id: sessionId,
  machineId: 'machine-1' as SessionMeta['machineId'],
  createdAt: new Date().toISOString(),
  design: { artworkId: sessionId, path: 'design.json' },
});

const imagegenMaterialized = (workdir: string): boolean =>
  fs.existsSync(path.join(workdir, '.claude', 'skills', 'imagegen', 'SKILL.md'));

type PromptBlockBuilder = {
  buildAcpPromptBlocks: (args: {
    workspaceId: WorkspaceId;
    sessionId: SessionId;
    inputBlocks: { type: 'text'; text: string }[];
  }) => Promise<{ type: string; text?: string }[]>;
};

describe('MessageHandler design skill prompt wiring', () => {
  let tmpDir: string;
  let dataDir: string;
  let previousDataDir: string | undefined;
  const sessionId = '11111111-2222-4333-8444-555555555555' as SessionId;
  const workspaceId = 'workspace-1' as WorkspaceId;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lody-design-prompt-'));
    dataDir = path.join(tmpDir, 'data');
    previousDataDir = process.env.MOLLY_DATA_DIR;
    process.env.MOLLY_DATA_DIR = dataDir;

    mocks.sourceDir = path.join(tmpDir, 'bundle');
    const skillSrc = path.join(mocks.sourceDir, 'graphic-design');
    fs.mkdirSync(path.join(skillSrc, 'references'), { recursive: true });
    fs.writeFileSync(path.join(skillSrc, 'SKILL.md'), '# synthetic skill\n');
    fs.writeFileSync(path.join(skillSrc, 'references', 'guide.md'), 'guide\n');
    const imageSrc = path.join(mocks.sourceDir, 'imagegen');
    fs.mkdirSync(imageSrc, { recursive: true });
    fs.writeFileSync(path.join(imageSrc, 'SKILL.md'), '# synthetic imagegen skill\n');
  });

  afterEach(() => {
    if (previousDataDir === undefined) delete process.env.MOLLY_DATA_DIR;
    else process.env.MOLLY_DATA_DIR = previousDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const buildText = async (handler: MessageHandler, text: string): Promise<string> => {
    const blocks = await (handler as MessageHandler & PromptBlockBuilder).buildAcpPromptBlocks({
      workspaceId,
      sessionId,
      inputBlocks: [{ type: 'text', text }],
    });
    const textBlock = blocks.find((block) => block.type === 'text');
    return textBlock?.text ?? '';
  };

  it('materializes skills into the session workdir and appends the pointer for design sessions', async () => {
    const handler = createHandler({
      id: sessionId,
      machineId: 'machine-1' as SessionMeta['machineId'],
      createdAt: new Date().toISOString(),
      design: { artworkId: sessionId, path: 'design.json' },
    });

    try {
      const workdir = path.join(dataDir, 'chats', sessionId);
      const text = await buildText(handler, 'make a poster');
      expect(text).toContain(
        `make a poster\n\nBefore design work, read the design skill: ${workdir}/.claude/skills/graphic-design/SKILL.md`
      );
      for (const base of ['.claude/skills', '.agents/skills']) {
        const dir = path.join(workdir, base, 'graphic-design');
        expect(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')).toBe('# synthetic skill\n');
        expect(fs.existsSync(path.join(dir, '.molly-managed-files.json'))).toBe(true);
      }
    } finally {
      await handler.cleanup();
    }
  });

  it('leaves non-design sessions byte-identical and writes nothing', async () => {
    const handler = createHandler({
      id: sessionId,
      machineId: 'machine-1' as SessionMeta['machineId'],
      createdAt: new Date().toISOString(),
    });

    try {
      const text = await buildText(handler, 'fix the flaky test');
      expect(text).toBe('fix the flaky test');
      const workdir = path.join(dataDir, 'chats', sessionId);
      expect(fs.existsSync(path.join(workdir, '.claude'))).toBe(false);
      expect(fs.existsSync(path.join(workdir, '.agents'))).toBe(false);
    } finally {
      await handler.cleanup();
    }
  });

  it('delivers the imagegen skill exactly when the machine has image capability', async () => {
    const ready = createHandler(DESIGN_META(sessionId), storedImageConnection());
    try {
      await ready.handleLocalMachineRpc({
        method: 'harness/host',
        machineId: 'machine-1',
        workspaceId: 'workspace-1',
        params: {
          version: 1,
          connections: [],
          reports: [],
          imageConnection: {
            id: '00000000-0000-4000-8000-000000000001',
            revision: 1,
            enabled: true,
            baseUrl: 'https://images.invalid/v1',
            model: 'synthetic-image',
            hasApiKey: true,
            legacyHistoryMayContainKey: false,
          },
        },
      });
      const workdir = path.join(dataDir, 'chats', sessionId);
      await buildText(ready, 'make a poster');
      expect(imagegenMaterialized(workdir)).toBe(true);
      // The pointer line still names the design skill: the imagegen skill is
      // discovered from its own directory, not advertised by the prompt.
      expect(fs.existsSync(path.join(workdir, '.claude', 'skills', 'graphic-design'))).toBe(true);
    } finally {
      await ready.cleanup();
    }
  });

  it('leaves imagegen out for a disabled or keyless connection', async () => {
    for (const connection of [
      storedImageConnection({ enabled: false }),
      storedImageConnection({ apiKey: '' }),
    ]) {
      const handler = createHandler(DESIGN_META(sessionId), connection);
      try {
        const workdir = path.join(dataDir, 'chats', sessionId);
        await buildText(handler, 'make a poster');
        expect(imagegenMaterialized(workdir)).toBe(false);
        expect(fs.existsSync(path.join(workdir, '.claude', 'skills', 'graphic-design'))).toBe(true);
      } finally {
        await handler.cleanup();
      }
    }
  });

  it('omits the pointer without blocking the turn when the bundle is missing', async () => {
    mocks.sourceDir = path.join(tmpDir, 'missing-bundle');
    const handler = createHandler({
      id: sessionId,
      machineId: 'machine-1' as SessionMeta['machineId'],
      createdAt: new Date().toISOString(),
      design: { artworkId: sessionId, path: 'design.json' },
    });

    try {
      const text = await buildText(handler, 'make a poster');
      expect(text).toBe('make a poster');
    } finally {
      await handler.cleanup();
    }
  });
});
