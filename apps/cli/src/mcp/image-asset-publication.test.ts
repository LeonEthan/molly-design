import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { writeGeneratedImageAsset } from './image-generation';

const hooks = vi.hoisted(() => ({
  beforePublish: undefined as undefined | ((target: string) => Promise<void>),
  afterSync: undefined as undefined | (() => void),
}));

// Inject exact filesystem boundaries; ordering does not depend on timers or load.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    link: async (...args: Parameters<typeof actual.link>) => {
      if (typeof args[1] === 'string') await hooks.beforePublish?.(args[1]);
      return actual.link(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      if (typeof args[0] === 'string' && args[0].endsWith('.tmp')) {
        const sync = file.sync.bind(file);
        file.sync = async () => {
          await sync();
          hooks.afterSync?.();
        };
      }
      return file;
    },
  };
});

const directories: string[] = [];
async function workspace() {
  const directory = await mkdtemp(path.join(tmpdir(), 'molly-asset-publication-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  hooks.beforePublish = undefined;
  hooks.afterSync = undefined;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

test('a concurrent different file wins publication and is never overwritten', async () => {
  const workdir = await workspace();
  let published = '';
  hooks.beforePublish = async (target) => {
    published = target;
    await writeFile(target, 'concurrent user content', { flag: 'wx' });
  };
  await expect(writeGeneratedImageAsset(workdir, png)).rejects.toThrow('refusing to overwrite');
  await expect(readFile(published, 'utf8')).resolves.toBe('concurrent user content');
  await expect(readdir(path.join(workdir, 'media'))).resolves.toEqual([path.basename(published)]);
});

test('a concurrent identical file is reused without another publication', async () => {
  const workdir = await workspace();
  hooks.beforePublish = async (target) => {
    await writeFile(target, png, { flag: 'wx' });
  };
  const result = await writeGeneratedImageAsset(workdir, png);
  await expect(readFile(result.absolutePath)).resolves.toEqual(png);
  await expect(readdir(path.join(workdir, 'media'))).resolves.toEqual([
    path.basename(result.absolutePath),
  ]);
});

test('cancellation after fsync removes only the unpublished temporary file', async () => {
  const workdir = await workspace();
  const controller = new AbortController();
  hooks.afterSync = () => controller.abort(new Error('synthetic cancellation'));
  await expect(writeGeneratedImageAsset(workdir, png, controller.signal)).rejects.toThrow(
    'synthetic cancellation'
  );
  await expect(readdir(path.join(workdir, 'media'))).resolves.toEqual([]);
});
