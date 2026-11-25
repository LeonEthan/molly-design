import { linkSync } from 'node:fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonObject, RemoteCursor } from '@loro-dev/streams-crdt';
import {
  DEFAULT_LORO_STREAMS_BASE_URL,
  LEGACY_LORO_STREAMS_BASE_URL,
  type WorkspaceId,
} from '@molly/shared';
import { SqliteRepoStore } from 'loro-repo/storage/sqlite';

import {
  AliasedRemoteCursorStore,
  createCliSqliteRepoStore,
  getLoroRepoSqliteDbPath,
  getLoroRepoStorageBaseDir,
} from './sqlite-repo-store';

const createdPaths = new Set<string>();
const openStores = new Set<SqliteRepoStore>();
const originalPlatform = process.env.MOLLY_PLATFORM;
const originalDataDir = process.env.MOLLY_DATA_DIR;

beforeEach(() => {
  process.env.MOLLY_PLATFORM = 'local';
  delete process.env.MOLLY_DATA_DIR;
});

const createCursor = (streamUrl: string): RemoteCursor<JsonObject> => ({
  streamUrl,
  nextOffset: '42',
  serverLowerBoundVersion: { version: '1' },
  updatedAtMs: 123,
});

const createTempSqliteCursorStore = async (): Promise<{
  tempDir: string;
  sqliteStore: SqliteRepoStore;
  cursorStore: AliasedRemoteCursorStore<JsonObject>;
}> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lody-sqlite-repo-store-'));
  createdPaths.add(tempDir);

  const sqliteStore = new SqliteRepoStore({ path: path.join(tempDir, 'repo.sqlite3') });
  openStores.add(sqliteStore);

  return {
    tempDir,
    sqliteStore,
    cursorStore: new AliasedRemoteCursorStore(sqliteStore.cursorStore),
  };
};

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const store of openStores) {
    store.close();
  }
  openStores.clear();

  await Promise.all(
    Array.from(createdPaths).map(async (targetPath) => {
      await fs.rm(targetPath, { recursive: true, force: true });
    })
  );
  createdPaths.clear();
  if (originalPlatform === undefined) delete process.env.MOLLY_PLATFORM;
  else process.env.MOLLY_PLATFORM = originalPlatform;
  if (originalDataDir === undefined) delete process.env.MOLLY_DATA_DIR;
  else process.env.MOLLY_DATA_DIR = originalDataDir;
});

describe('SQLite Loro repo store', () => {
  it('saves, loads, and deletes remote cursors in SQLite', async () => {
    const { cursorStore, tempDir } = await createTempSqliteCursorStore();
    const cursor = createCursor(`${LEGACY_LORO_STREAMS_BASE_URL}/ds/lody/workspace:meta`);

    expect(await cursorStore.load(cursor.streamUrl)).toBeNull();

    await cursorStore.save(cursor);
    expect(await cursorStore.load(cursor.streamUrl)).toEqual(cursor);
    expect(await fs.stat(path.join(tempDir, 'repo.sqlite3'))).toBeTruthy();

    await cursorStore.delete(cursor.streamUrl);
    expect(await cursorStore.load(cursor.streamUrl)).toBeNull();
  });

  it('loads and deletes cursors saved under the legacy gateway URL', async () => {
    const { cursorStore } = await createTempSqliteCursorStore();
    const legacyUrl = `${LEGACY_LORO_STREAMS_BASE_URL}/ds/lody/workspace:meta`;
    const proxyUrl = `${DEFAULT_LORO_STREAMS_BASE_URL}/ds/lody/workspace:meta`;
    const legacyCursor = createCursor(legacyUrl);

    await cursorStore.save(legacyCursor);

    expect(await cursorStore.load(proxyUrl)).toEqual({ ...legacyCursor, streamUrl: proxyUrl });

    await cursorStore.delete(proxyUrl);
    expect(await cursorStore.load(legacyUrl)).toBeNull();
    expect(await cursorStore.load(proxyUrl)).toBeNull();
  });

  it('loads and deletes cursors saved under the previous proxy gateway URL', async () => {
    const { cursorStore } = await createTempSqliteCursorStore();
    const previousProxyUrl = 'https://previous.streams.invalid/ds/lody/workspace:meta';
    const currentUrl = `${DEFAULT_LORO_STREAMS_BASE_URL}/ds/lody/workspace:meta`;
    const previousProxyCursor = createCursor(previousProxyUrl);

    await cursorStore.save(previousProxyCursor);

    expect(await cursorStore.load(currentUrl)).toEqual({
      ...previousProxyCursor,
      streamUrl: currentUrl,
    });

    await cursorStore.delete(currentUrl);
    expect(await cursorStore.load(previousProxyUrl)).toBeNull();
    expect(await cursorStore.load(currentUrl)).toBeNull();
  });

  it('creates a workspace-scoped SQLite repo store under the Molly storage directory', async () => {
    const previousHome = process.env.HOME;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'lody-sqlite-repo-home-'));
    createdPaths.add(tempHome);
    process.env.HOME = tempHome;

    try {
      const workspaceId = 'workspace-1' as WorkspaceId;
      const cliStore = await createCliSqliteRepoStore(workspaceId);
      openStores.add(cliStore.sqliteStore);

      expect(cliStore.baseDir).toBe(path.join(tempHome, '.molly', 'loro-repo', 'workspace-1'));
      expect(cliStore.dbPath).toBe(path.join(cliStore.baseDir, 'repo.sqlite3'));
      expect(getLoroRepoStorageBaseDir(workspaceId)).toBe(cliStore.baseDir);
      expect(getLoroRepoSqliteDbPath(workspaceId)).toBe(cliStore.dbPath);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  });
});

it.each([
  { kind: 'symlink', suffix: 'directory' },
  ...['', '-wal', '-shm', '-journal'].flatMap((suffix) =>
    ['hardlink', 'symlink'].map((kind) => ({ kind, suffix }))
  ),
])(
  'rejects a $kind on SQLite path ($suffix) before touching external bytes',
  async ({ kind, suffix }) => {
    const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-isolation-'));
    createdPaths.add(fixture);
    const root = path.join(fixture, 'root');
    const dir = path.join(root, 'loro-repo', 'workspace-1');
    const outside = path.join(fixture, 'outside');
    await fs.mkdir(path.dirname(dir), { recursive: true });
    await fs.mkdir(outside);
    const target = path.join(outside, 'repo.sqlite3' + (suffix === 'directory' ? '' : suffix));
    const bytes = Buffer.from([0, 255, 42]);
    await fs.writeFile(target, bytes);
    if (suffix === 'directory') {
      await fs.symlink(outside, dir, 'dir');
    } else {
      await fs.mkdir(dir);
      const leaf = path.join(dir, 'repo.sqlite3' + suffix);
      if (kind === 'hardlink') linkSync(target, leaf);
      else await fs.symlink(target, leaf, 'file');
    }
    vi.stubEnv('MOLLY_DATA_DIR', root);
    vi.stubEnv('MOLLY_ISOLATED_DATA_ROOT_STRICT', '1');
    await expect(createCliSqliteRepoStore('workspace-1' as WorkspaceId)).rejects.toThrow(
      kind === 'hardlink' ? 'invalid_isolated_sqlite_file' : 'isolated_data_path_symlink'
    );
    expect(await fs.readFile(target)).toEqual(bytes);
    expect(await fs.readdir(outside)).toEqual([path.basename(target)]);
  }
);

it('rejects an escaping workspace before creating directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-isolation-'));
  createdPaths.add(root);
  vi.stubEnv('MOLLY_DATA_DIR', root);
  vi.stubEnv('MOLLY_ISOLATED_DATA_ROOT_STRICT', '1');
  await expect(createCliSqliteRepoStore('../../outside' as WorkspaceId)).rejects.toThrow(
    'isolated_data_path_escape'
  );
  expect(await fs.readdir(root)).toEqual([]);
});
