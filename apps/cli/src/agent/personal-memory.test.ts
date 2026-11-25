import { linkSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, it, vi } from 'vitest';
import { PersonalMemoryService } from './personal-memory';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

it('creates a missing memory directory and recalls preferences after reopening the store', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'molly-preferences-'));
  directories.push(directory);
  const dbPath = path.join(directory, 'memory', 'preferences.sqlite');
  const memory = await PersonalMemoryService.open(dbPath);
  const snapshot = await memory.read();
  await memory.capture(
    snapshot.revision,
    [{ text: 'Prefers concise explanations.' }],
    new AbortController().signal
  );
  const reopened = await PersonalMemoryService.open(dbPath);
  expect((await reopened.read()).entries.map((entry) => entry.text)).toEqual([
    'Prefers concise explanations.',
  ]);
});

it('does not restore a deleted preference from a pending extraction', async () => {
  const memory = await PersonalMemoryService.open(':memory:');
  const signal = new AbortController().signal;
  await memory.capture((await memory.read()).revision, [{ text: 'Prefers blue.' }], signal);
  const pending = await memory.read();
  const entry = pending.entries[0];
  if (!entry) throw new Error('missing preference');
  await memory.remove(entry.id, pending.revision);
  await expect(
    memory.capture(pending.revision, [{ id: entry.id, text: 'Prefers dark blue.' }], signal)
  ).rejects.toThrow('memory_stale');
  expect((await memory.read()).entries).toEqual([]);
});

it('rejects simultaneous changes based on the same snapshot', async () => {
  const memory = await PersonalMemoryService.open(':memory:');
  const snapshot = await memory.read();
  const results = await Promise.allSettled([
    memory.capture(snapshot.revision, [{ text: 'Prefers blue.' }], new AbortController().signal),
    memory.capture(snapshot.revision, [{ text: 'Prefers red.' }], new AbortController().signal),
  ]);
  expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
  expect((await memory.read()).entries.map((entry) => entry.text)).toEqual(['Prefers blue.']);
});

it('invalidates pending capture even after memory is disabled and re-enabled', async () => {
  const memory = await PersonalMemoryService.open(':memory:');
  const pending = await memory.read();
  await memory.setEnabled(false, pending.revision);
  const disabled = await memory.read();
  expect(disabled.enabled).toBe(false);
  await expect(
    memory.capture(disabled.revision, [{ text: 'Prefers blue.' }], new AbortController().signal)
  ).rejects.toThrow('memory_disabled');
  await memory.setEnabled(true, disabled.revision);
  await expect(
    memory.capture(pending.revision, [{ text: 'Prefers blue.' }], new AbortController().signal)
  ).rejects.toThrow('memory_stale');
  expect((await memory.read()).entries).toEqual([]);
});

it('allows editing while disabled without accepting an older empty snapshot', async () => {
  const memory = await PersonalMemoryService.open(':memory:');
  const initial = await memory.read();
  await memory.capture(initial.revision, [{ text: 'Prefers blue.' }], new AbortController().signal);
  const saved = await memory.read();
  const entry = saved.entries[0];
  if (!entry) throw new Error('missing preference');
  await memory.setEnabled(false, saved.revision);
  await memory.edit(entry.id, 'Prefers green.', (await memory.read()).revision);
  expect((await memory.read()).entries.map((item) => item.text)).toEqual(['Prefers green.']);
  await memory.remove(entry.id, (await memory.read()).revision);
  await memory.setEnabled(true, (await memory.read()).revision);
  await expect(
    memory.capture(initial.revision, [{ text: 'Prefers blue.' }], new AbortController().signal)
  ).rejects.toThrow('memory_stale');
});

it('rejects updates to unknown entries and cancelled saves without changing memory', async () => {
  const memory = await PersonalMemoryService.open(':memory:');
  const initial = await memory.read();
  await expect(
    memory.capture(
      initial.revision,
      [{ id: 'unknown', text: 'Prefers blue.' }],
      new AbortController().signal
    )
  ).rejects.toThrow('memory_missing');
  const controller = new AbortController();
  const saving = memory.capture(initial.revision, [{ text: 'Prefers blue.' }], controller.signal);
  controller.abort();
  await expect(saving).rejects.toThrow();
  expect(await memory.read()).toEqual(initial);
});

it('keeps the recalled preference set bounded without dropping existing memories', async () => {
  const memory = await PersonalMemoryService.open(':memory:');
  for (let batch = 0; batch < 4; batch++) {
    await memory.capture(
      (await memory.read()).revision,
      Array.from({ length: 8 }, (_, item) => ({ text: `Preference ${batch * 8 + item}` })),
      new AbortController().signal
    );
  }
  const full = await memory.read();
  await expect(
    memory.capture(full.revision, [{ text: 'One more preference' }], new AbortController().signal)
  ).rejects.toThrow('memory_full');
  expect(await memory.read()).toEqual(full);
});

it('migrates legacy mem0 vectors SQLite rows once with zero data loss and preserves disabled state', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'molly-legacy-mem0-'));
  directories.push(directory);
  const dbPath = path.join(directory, 'preferences.sqlite');

  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE vectors (
      id TEXT PRIMARY KEY,
      vector BLOB NOT NULL,
      payload TEXT NOT NULL
    );
  `);
  const insert = legacy.prepare(`INSERT INTO vectors (id, vector, payload) VALUES (?, ?, ?)`);
  for (let i = 0; i < 32; i++) {
    const id = `legacy-${String(i).padStart(2, '0')}`;
    insert.run(
      id,
      Buffer.from([0, 0, 128, 63]),
      JSON.stringify({ id, text: `Legacy pref ${i}`, kind: 'preference' })
    );
  }
  insert.run(
    'settings',
    Buffer.from([0, 0, 128, 63]),
    JSON.stringify({ kind: 'settings', enabled: false, revision: 'old-rev' })
  );
  legacy.close();

  const memory = await PersonalMemoryService.open(dbPath);
  const snap = await memory.read();
  expect(snap.enabled).toBe(false);
  expect(snap.entries).toHaveLength(32);
  expect(snap.entries[0]?.text).toBe('Legacy pref 0');

  await memory.remove('legacy-00', snap.revision);
  const reopened = await PersonalMemoryService.open(dbPath);
  expect((await reopened.read()).entries).toHaveLength(31);
});

it.each([
  { kind: 'symlink', suffix: 'directory' },
  ...['', '-wal', '-shm', '-journal'].flatMap((suffix) =>
    ['hardlink', 'symlink'].map((kind) => ({ kind, suffix }))
  ),
])(
  'rejects a $kind on SQLite path ($suffix) before touching external bytes',
  async ({ kind, suffix }) => {
    const fixture = await fs.mkdtemp(path.join(tmpdir(), 'sqlite-isolation-'));
    directories.push(fixture);
    const root = path.join(fixture, 'root');
    const dir = path.join(root, 'memory');
    const outside = path.join(fixture, 'outside');
    await fs.mkdir(path.dirname(dir), { recursive: true });
    await fs.mkdir(outside);
    const target = path.join(
      outside,
      'preferences.sqlite' + (suffix === 'directory' ? '' : suffix)
    );
    const bytes = Buffer.from([0, 255, 42]);
    await fs.writeFile(target, bytes);
    if (suffix === 'directory') {
      await fs.symlink(outside, dir, 'dir');
    } else {
      await fs.mkdir(dir);
      const leaf = path.join(dir, 'preferences.sqlite' + suffix);
      if (kind === 'hardlink') linkSync(target, leaf);
      else await fs.symlink(target, leaf, 'file');
    }
    vi.stubEnv('MOLLY_DATA_DIR', root);
    vi.stubEnv('MOLLY_ISOLATED_DATA_ROOT_STRICT', '1');
    await expect(
      PersonalMemoryService.open(path.join(dir, 'preferences.sqlite'), { coreEndpoint: null })
    ).rejects.toThrow(
      kind === 'hardlink' ? 'invalid_isolated_sqlite_file' : 'isolated_data_path_symlink'
    );
    expect(await fs.readFile(target)).toEqual(bytes);
    expect(await fs.readdir(outside)).toEqual([path.basename(target)]);
  }
);

it('rejects an explicit database outside the strict data root before creating directories', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'sqlite-isolation-'));
  directories.push(fixture);
  vi.stubEnv('MOLLY_DATA_DIR', path.join(fixture, 'root'));
  vi.stubEnv('MOLLY_ISOLATED_DATA_ROOT_STRICT', '1');
  await expect(
    PersonalMemoryService.open(path.join(fixture, 'outside', 'preferences.sqlite'), {
      coreEndpoint: null,
    })
  ).rejects.toThrow('isolated_data_path_escape');
  expect(await fs.readdir(fixture)).toEqual([]);
});
