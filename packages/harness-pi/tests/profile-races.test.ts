import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireSessionWriter } from '../src/profile';

const hooks = vi.hoisted(() => ({
  read: undefined as ((path: string) => Promise<void>) | undefined,
}));

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      const result = await fs.readFile(...args);
      if (typeof args[0] === 'string') await hooks.read?.(args[0]);
      return result;
    },
  };
});

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

const roots: string[] = [];
afterEach(async () => {
  hooks.read = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function directory() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'molly-profile-race-')));
  roots.push(root);
  return root;
}

describe('profile worker races', () => {
  it('admits only one replacement after both contenders encounter a dead history owner', async () => {
    const file = join(await directory(), 'history.jsonl');
    await writeFile(file, '{}\n');
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    await once(child, 'exit');
    await writeFile(`${file}.acp-lock`, `${child.pid}\n`);
    const firstRead = signal();
    const secondRead = signal();
    const resumeFirst = signal();
    const resumeSecond = signal();
    let reads = 0;
    hooks.read = async (path) => {
      if (path !== `${file}.acp-lock`) return;
      reads++;
      if (reads === 1) {
        firstRead.resolve();
        await resumeFirst.promise;
      } else if (reads === 2) {
        secondRead.resolve();
        await resumeSecond.promise;
      }
    };
    const outcome = (attempt: ReturnType<typeof acquireSessionWriter>) =>
      attempt.then(
        (release) => ({ release, error: undefined }),
        (error: unknown) => ({ release: undefined, error })
      );
    const first = outcome(acquireSessionWriter(file));
    await firstRead.promise;
    const second = outcome(acquireSessionWriter(file));
    await Promise.race([secondRead.promise, second]);
    resumeFirst.resolve();
    const winner = await first;
    resumeSecond.resolve();
    const loser = await second;
    hooks.read = undefined;
    try {
      expect(winner.error).toBeUndefined();
      expect(loser.error).toMatchObject({ code: 'EEXIST' });
      expect(await readFile(`${file}.acp-lock`, 'utf8')).toBe(`${process.pid}\n`);
    } finally {
      await winner.release?.().catch(() => {});
      await loser.release?.().catch(() => {});
    }
  });
});
