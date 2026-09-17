import { resolveDesignWorkspace } from '../src/design/workspace';
/**
 * The daemon's design preview Machine RPC (P2.4b): the transport behind
 * `molly_render_preview`.
 *
 * The render host is the running Molly desktop, which polls the daemon over the
 * same owner-only control socket the image methods use. So the direction is the
 * ordinary one — a machine with no desktop polling has no render capability at
 * all — and the daemon never calls out.
 *
 * The three methods are one queue: `design/render-host-status` reports whether a
 * host is there, `design/render-host` is the host's own loop (reports in, work
 * out), and `design/render-preview` is the agent-facing request. Every refusal
 * here is a result, not an exception: no desktop, no project, and a non-design
 * session all answer `ok: false` with something the agent can act on.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const CODING_SESSION_ID = '99999999-8888-7777-6666-555555555555' as SessionId;
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

const createHandler = (
  sessions: Record<string, Partial<SessionMeta> | undefined> = {},
  workspaceRoot?: string
): MessageHandler => {
  const sessionManager = {
    getSession: vi.fn((id: string) =>
      sessions[id]
        ? {
            getHostWorkdir: () => workspaceRoot ?? path.join(dataRoot, 'chats', id),
            getWorkdir: () => workspaceRoot ?? path.join(dataRoot, 'chats', id),
          }
        : null
    ),
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

const hostPoll = async (handler: MessageHandler, reports: unknown[] = []) => {
  const result = await send(handler, {
    method: 'design/render-host',
    params: { reports },
  });
  if (result.type !== 'design/render-host') throw new Error(`unexpected result: ${result.type}`);
  return result.requests;
};

const renderPreview = async (handler: MessageHandler, ownerSessionId: SessionId) => {
  const result = await send(handler, {
    method: 'design/render-preview',
    ownerSessionId,
    params: {},
  });
  if (result.type !== 'design/render-preview') throw new Error(`unexpected result: ${result.type}`);
  return result;
};

/** The PNG signature plus a first chunk: all the verification sniffs. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngFixture = (width: number, height: number): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([PNG_SIGNATURE, Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), ihdr]);
};

const PAGE = `format: molly-canvas/1
title: Render RPC test
size: [320, 200]
background:
  type: solid
  color: "#FFFFFF"
elements:
  - id: title
    kind: text
    bounds: [10, 10, 200, 40]
    text:
      paragraphs:
        - runs:
            - text: "Hello"
              fontSize: 24
`;

let dataRoot: string;
let previousDataRoot: string | undefined;

beforeEach(() => {
  previousDataRoot = process.env.MOLLY_DATA_DIR;
  dataRoot = mkdtempSync(path.join(tmpdir(), 'molly-design-render-rpc-'));
  // The render path resolves the session workdir from the daemon data root, so
  // point it at a throwaway one: no test may read or write the user's workspace.
  process.env.MOLLY_DATA_DIR = dataRoot;
});

afterEach(() => {
  if (previousDataRoot === undefined) delete process.env.MOLLY_DATA_DIR;
  else process.env.MOLLY_DATA_DIR = previousDataRoot;
  rmSync(dataRoot, { recursive: true, force: true });
});

const writeProject = (
  sessionId: SessionId,
  workdir = path.join(dataRoot, 'chats', sessionId)
): string => {
  mkdirSync(path.join(workdir, 'pages'), { recursive: true });
  writeFileSync(path.join(workdir, 'design.yaml'), PAGE);
  return workdir;
};

/**
 * Drain event-loop turns until the daemon's queue has work for the host.
 *
 * Each turn yields a real macrotask (`setImmediate`, not a delay): the render
 * path is awaiting filesystem operations, whose callbacks only run in the poll
 * phase, so a loop of already-resolved promises would spin forever without
 * letting them land.
 *
 * The budget is large because a `setImmediate` turn is far cheaper than a libuv
 * threadpool round-trip — a chain of a few `fs.promises` calls takes on the
 * order of 400 turns to drain — so this converges well inside it. The bound is a
 * failure guard, not a timeout: nothing here waits on the wall clock, and the
 * loop exits the moment the actual signal (queued work) appears.
 */
const takeWork = async (handler: MessageHandler, turns = 20_000) => {
  for (let turn = 0; turn < turns; turn++) {
    const handed = await hostPoll(handler);
    if (handed.length > 0) return handed;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('the preview never reached the render host queue');
};

/**
 * The work the daemon queued for the desktop, or the render's own early answer.
 *
 * Racing the two keeps a bug in the render path legible: if the preview refuses
 * or settles before it is ever handed out, the failure names the answer instead
 * of a loop that ran out of turns.
 */
const firstHandedOut = async (handler: MessageHandler, pending: Promise<unknown>) => {
  const work = await Promise.race([
    takeWork(handler).then(([first]) => first),
    pending.then((early) => {
      throw new Error(`the preview settled before it was handed out: ${JSON.stringify(early)}`);
    }),
  ]);
  if (!work) throw new Error('no work was handed out');
  return work;
};

describe('design/render-host-status', () => {
  it('answers "no desktop" before any host has polled', async () => {
    const handler = createHandler();
    expect(await send(handler, { method: 'design/render-host-status', params: {} })).toEqual({
      type: 'design/render-host-status',
      connected: false,
    });
  });

  it('answers "connected" once a host has polled', async () => {
    const handler = createHandler();
    await hostPoll(handler);
    expect(await send(handler, { method: 'design/render-host-status', params: {} })).toEqual({
      type: 'design/render-host-status',
      connected: true,
    });
  });
});

describe('design/render-preview', () => {
  it('refuses a session that is not a design session', async () => {
    const handler = createHandler({
      [CODING_SESSION_ID]: sessionMeta(CODING_SESSION_ID, false),
    });
    const result = await renderPreview(handler, CODING_SESSION_ID);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('not a design session');
  });

  it('refuses a session the daemon cannot read at all', async () => {
    const handler = createHandler();
    const result = await renderPreview(handler, DESIGN_SESSION_ID);
    expect(result.ok).toBe(false);
  });

  it('refuses a request that names no session at all', async () => {
    // `ownerSessionId` is optional on the wire, so a missing one reaches the
    // daemon rather than being rejected in transport: it must still answer.
    const handler = createHandler();
    await hostPoll(handler);
    const result = await send(handler, { method: 'design/render-preview', params: {} });
    expect(result).toMatchObject({ type: 'design/render-preview', ok: false });
  });

  it('refuses at once when no desktop is polling, rather than queueing forever', async () => {
    const handler = createHandler({
      [DESIGN_SESSION_ID]: sessionMeta(DESIGN_SESSION_ID, true),
    });
    writeProject(DESIGN_SESSION_ID);
    const result = await renderPreview(handler, DESIGN_SESSION_ID);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('not running');
  });

  it('refuses honestly when the agent has not written a project yet', async () => {
    const handler = createHandler({
      [DESIGN_SESSION_ID]: sessionMeta(DESIGN_SESSION_ID, true),
    });
    await hostPoll(handler);
    const result = await renderPreview(handler, DESIGN_SESSION_ID);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('Write the project first');
  });

  it('renders when a design session, a project, and a desktop are all present', async () => {
    const handler = createHandler({
      [DESIGN_SESSION_ID]: sessionMeta(DESIGN_SESSION_ID, true),
    });
    writeProject(DESIGN_SESSION_ID);
    await hostPoll(handler);

    const pending = renderPreview(handler, DESIGN_SESSION_ID);
    const work = await firstHandedOut(handler, pending);
    expect(work.width).toBe(320);
    expect(work.height).toBe(200);

    // Play the desktop: write the rendering it was asked for, then report it.
    const stat = pngFixture(work.width, work.height);
    writeFileSync(work.outputPath, stat);
    await hostPoll(handler, [{ requestId: work.requestId, ok: true }]);

    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toBe(work.outputPath);
    expect(result.width).toBe(320);
    expect(result.height).toBe(200);
    expect(result.bytes).toBe(stat.byteLength);
    // The payload the desktop was handed is the project itself, addressed the
    // same way the store would address it, and named for the artwork.
    expect(path.isAbsolute(result.path)).toBe(true);
  });

  it.each(['local-project', 'ordinary-directory'])(
    'renders the actual Session draft in %s',
    async (kind) => {
      const workspaceRoot = path.join(dataRoot, kind);
      mkdirSync(workspaceRoot, { recursive: true });
      if (kind === 'local-project') mkdirSync(path.join(workspaceRoot, '.git'));
      const workspace = resolveDesignWorkspace({
        workspaceRoot,
        sessionId: DESIGN_SESSION_ID,
        artworkId: DESIGN_SESSION_ID,
        legacyWorkdir: path.join(dataRoot, 'chats', DESIGN_SESSION_ID),
      });
      const handler = createHandler(
        { [DESIGN_SESSION_ID]: sessionMeta(DESIGN_SESSION_ID, true) },
        workspaceRoot
      );
      writeProject(DESIGN_SESSION_ID, workspace.artifactWorkdir);
      await hostPoll(handler);
      const pending = renderPreview(handler, DESIGN_SESSION_ID);
      const work = await firstHandedOut(handler, pending);
      expect(path.dirname(work.outputPath)).toBe(
        path.join(workspace.artifactWorkdir, 'design-preview')
      );
      writeFileSync(work.outputPath, pngFixture(work.width, work.height));
      await hostPoll(handler, [{ requestId: work.requestId, ok: true }]);
      expect(await pending).toMatchObject({ ok: true, path: work.outputPath });
    }
  );

  it('turns the desktop’s own failure into the agent’s refusal', async () => {
    const handler = createHandler({
      [DESIGN_SESSION_ID]: sessionMeta(DESIGN_SESSION_ID, true),
    });
    writeProject(DESIGN_SESSION_ID);
    await hostPoll(handler);

    const pending = renderPreview(handler, DESIGN_SESSION_ID);
    const work = await firstHandedOut(handler, pending);
    await hostPoll(handler, [{ requestId: work.requestId, ok: false, error: 'font failed' }]);

    const result = await pending;
    expect(result).toEqual({ type: 'design/render-preview', ok: false, error: 'font failed' });
  });
});

describe('design/render-host', () => {
  it('accepts an empty poll and hands out only what is queued', async () => {
    const handler = createHandler();
    expect(await hostPoll(handler)).toEqual([]);
    expect(await hostPoll(handler, [{ requestId: 'never-issued', ok: true }])).toEqual([]);
  });
});
