import {
  linkSync,
  mkdirSync,
  realpathSync,
  renameSync,
  symlinkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { TurnDiffStore } from './client';

it('rechecks sidecars when a failed initialization starts a fresh worker', async () => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'diff-open-')));
  const root = path.join(parent, 'profile');
  mkdirSync(root);
  const dbPath = path.join(root, 'diff.db');
  const external = path.join(parent, 'external');
  const bytes = Buffer.from('external fixture');
  writeFileSync(external, bytes);
  const store = new TurnDiffStore({
    dbPath,
    isolatedDataRoot: root,
    now: () => 0,
    workerUrl: new URL('../tests/worker-entry.mjs', import.meta.url),
  });
  try {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      linkSync(external, dbPath + suffix);
      await expect(store.stats()).rejects.toThrow('invalid_isolated_sqlite_file');
      expect(readFileSync(external)).toEqual(bytes);
      unlinkSync(dbPath + suffix);
    }
    expect((await store.stats()).integrity).toBe('ok');
  } finally {
    await store.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

it.each(['redirected ancestor', 'replaced directory'])(
  'rejects a %s before lazy initialization',
  async (change) => {
    const parent = realpathSync(mkdtempSync(path.join(tmpdir(), 'diff-root-')));
    const ancestor = path.join(parent, 'admitted');
    const root = path.join(ancestor, 'profile');
    const external = path.join(parent, 'external');
    mkdirSync(root, { recursive: true });
    mkdirSync(path.join(external, 'profile'), { recursive: true });
    const decoy = path.join(external, 'profile', 'diff.db');
    const bytes = Buffer.from('external fixture');
    writeFileSync(decoy, bytes);
    const store = new TurnDiffStore({
      isolatedDataRoot: root,
      dbPath: path.join(root, 'diff.db'),
      now: () => 0,
      workerUrl: new URL('../tests/worker-entry.mjs', import.meta.url),
    });
    try {
      renameSync(ancestor, path.join(parent, 'original'));
      if (change === 'redirected ancestor') {
        symlinkSync(external, ancestor, 'junction');
        await expect(store.stats()).rejects.toThrow('isolated_data_path_symlink');
        expect(readFileSync(decoy)).toEqual(bytes);
      } else {
        renameSync(external, ancestor);
        await expect(store.stats()).rejects.toThrow('invalid_isolated_data_root');
        expect(readFileSync(path.join(root, 'diff.db'))).toEqual(bytes);
      }
    } finally {
      await store.close();
      rmSync(parent, { recursive: true, force: true });
    }
  }
);
