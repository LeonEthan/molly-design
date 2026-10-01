import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireSessionWriter } from '../src/profile';
import { persistConnection } from '../src/profile-credentials';

const hooks = vi.hoisted(() => ({
  read: undefined as ((path: string) => Promise<void>) | undefined,
  sleep: undefined as (() => Promise<void>) | undefined,
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

vi.mock('node:timers/promises', async (original) => {
  const timers = await original<typeof import('node:timers/promises')>();
  return {
    ...timers,
    setTimeout: async (...args: Parameters<typeof timers.setTimeout>) => {
      if (hooks.sleep) return hooks.sleep();
      return timers.setTimeout(...args);
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
  hooks.sleep = undefined;
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

  it('preserves both providers when updates contend with a paused models snapshot', async () => {
    const agentDir = await directory();
    const path = join(agentDir, 'models.json');
    const existing = {
      retained: 'metadata',
      providers: { existing: { baseUrl: 'https://old.invalid' } },
    };
    await writeFile(path, JSON.stringify(existing));
    const firstRead = signal();
    const secondRead = signal();
    const waiting = signal();
    const resumeFirst = signal();
    const resumeSecond = signal();
    const resumeWaiter = signal();
    let reads = 0;
    hooks.read = async (file) => {
      if (file !== path) return;
      reads++;
      if (reads === 1) {
        firstRead.resolve();
        await resumeFirst.promise;
      } else if (reads === 2) {
        secondRead.resolve();
        await resumeSecond.promise;
      }
    };
    hooks.sleep = async () => {
      waiting.resolve();
      await resumeWaiter.promise;
    };
    const runtime: Pick<ModelRuntime, 'login'> = {
      login: async () => ({ type: 'api_key', key: 'SYNTHETIC_SECRET' }),
    };
    const firstConfig = { baseUrl: 'https://first.invalid/v1' };
    const secondConfig = { baseUrl: 'https://compatible.invalid/v1' };
    const first = persistConnection(runtime, agentDir, 'first', firstConfig, 'SYNTHETIC_SECRET');
    await firstRead.promise;
    const second = persistConnection(
      runtime,
      agentDir,
      'molly-compatible',
      secondConfig,
      'SYNTHETIC_SECRET'
    );
    await Promise.race([secondRead.promise, waiting.promise]);
    resumeFirst.resolve();
    await first;
    resumeSecond.resolve();
    resumeWaiter.resolve();
    await second;
    hooks.read = undefined;
    const content = await readFile(path, 'utf8');
    expect(JSON.parse(content)).toEqual({
      ...existing,
      providers: { ...existing.providers, first: firstConfig, 'molly-compatible': secondConfig },
    });
    expect(content).not.toContain('SYNTHETIC_SECRET');
  });
});
