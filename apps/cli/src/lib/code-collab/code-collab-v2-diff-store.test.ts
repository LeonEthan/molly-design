import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SessionId, WorkspaceId } from '@molly/shared';
import { SqliteTurnDiffStore } from '@molly/turn-diff-store/sqlite';
import { CodeCollabV2DiffStore } from './code-collab-v2-diff-store';

const SESSION_ID = 'session-v2' as SessionId;
const WORKSPACE_ID = 'workspace-v2' as WorkspaceId;
const DAY_MS = 24 * 60 * 60 * 1000;

async function withLegacyStore<T>(fn: (store: CodeCollabV2DiffStore) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-legacy-turn-diff-'));
  const dbPath = path.join(root, 'diff-store.sqlite3');
  const legacy = new SqliteTurnDiffStore({ dbPath, retentionDays: 1 });
  legacy.recordTurn({
    ownerId: SESSION_ID,
    turnId: 'turn-1',
    capturedAtMs: 1000,
    recordedAtMs: 1000,
    events: [{ path: 'src/app.ts', oldText: 'one\n', newText: 'one\ntwo\n', add: 1, del: 0,
      newIsCurrent: false, headProof: null }],
  });
  legacy.recordTurn({
    ownerId: SESSION_ID,
    turnId: 'turn-2',
    capturedAtMs: 2000,
    recordedAtMs: 2000,
    events: [{ path: 'src/app.ts', oldText: 'one\ntwo\n', newText: 'three\n', add: 1, del: 2,
      newIsCurrent: false, headProof: null }],
  });
  legacy.close();
  const store = new CodeCollabV2DiffStore(WORKSPACE_ID, { dbPath, retentionDays: 1, now: () => 3000 });
  try {
    return await fn(store);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
}

describe('legacy CodeCollabV2DiffStore reads', () => {
  it('reads exact historical turn snapshots and their stored summaries after reopening', async () => {
    await withLegacyStore(async (store) => {
      expect(await store.listTurnFileDiffs({ ownerSessionId: SESSION_ID, turnId: 'turn-1' }))
        .toEqual([{ filePath: 'src/app.ts', add: 1, del: 0 }]);
      expect(await store.listChangedPaths({ ownerSessionId: SESSION_ID })).toEqual(['src/app.ts']);
      expect(await store.getEarliestOldSnapshot({ ownerSessionId: SESSION_ID, path: 'src/app.ts' }))
        .toEqual({ status: 'ready', text: 'one\n' });
      expect(await store.getTurnDiffSnapshot({ ownerSessionId: SESSION_ID, turnId: 'turn-1', path: 'src/app.ts' }))
        .toEqual({ status: 'ready', oldText: 'one\n', newText: 'one\ntwo\n' });
      expect(await store.getTurnDiffSnapshot({ ownerSessionId: SESSION_ID, turnId: 'turn-2', path: 'src/app.ts' }))
        .toEqual({ status: 'ready', oldText: 'one\ntwo\n', newText: 'three\n' });
      expect(await store.stats()).toMatchObject({ turns: 2, files: 2, integrity: 'ok' });
    });
  });

  it('keeps unavailable and oversized historical snapshots explicit', async () => {
    await withLegacyStore(async (store) => {
      const query = { ownerSessionId: SESSION_ID, turnId: 'turn-1', path: 'src/app.ts' };
      expect(await store.getTurnDiffSnapshot({ ...query, turnId: 'missing' })).toEqual({ status: 'unavailable' });
      expect(await store.getTurnDiffSnapshot({ ...query, maxRawBytes: 1 })).toMatchObject({ status: 'too_large' });
      expect(await store.getTurnDiffSnapshot({ ...query, ownerSessionId: 'other' as SessionId })).toEqual({ status: 'unavailable' });
    });
  });

  it('preserves the existing historical retention policy', async () => {
    await withLegacyStore(async (store) => {
      const nowMs = 2000 + DAY_MS + 1;
      await store.gc(nowMs);
      expect(await store.listChangedPaths({ ownerSessionId: SESSION_ID, nowMs })).toEqual([]);
      expect(await store.getTurnDiffSnapshot({ ownerSessionId: SESSION_ID, turnId: 'turn-1', path: 'src/app.ts', nowMs }))
        .toEqual({ status: 'unavailable' });
    });
  });
});
