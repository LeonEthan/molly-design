import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireProcessLock, processExited } from '../src/process-lock';

const hooks = vi.hoisted(() => ({
  owners: undefined as ((path: string) => Promise<void>) | undefined,
  removeDirectory: undefined as ((path: string) => Promise<void>) | undefined,
  publish: undefined as ((path: string) => void) | undefined,
}));

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    readdir: async (...args: Parameters<typeof fs.readdir>) => {
      const result = await fs.readdir(...args);
      if (typeof args[0] === 'string') await hooks.owners?.(args[0]);
      return result;
    },
    rmdir: async (...args: Parameters<typeof fs.rmdir>) => {
      if (typeof args[0] === 'string') await hooks.removeDirectory?.(args[0]);
      return fs.rmdir(...args);
    },
    rename: async (...args: Parameters<typeof fs.rename>) => {
      if (typeof args[1] === 'string') hooks.publish?.(args[1]);
      return fs.rename(...args);
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
  hooks.owners = undefined;
  hooks.removeDirectory = undefined;
  hooks.publish = undefined;
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function lockPath() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'molly-process-lock-')));
  roots.push(root);
  return join(root, 'writer');
}

describe('process-owned directory lock', () => {
  it('rejects a live worker and recovers its lock after SIGKILL', async () => {
    const directory = await lockPath();
    const source = `
      const { acquireProcessLock } = await import(process.argv[1]);
      await acquireProcessLock(process.argv[2]);
      process.on('message', () => {});
      process.send('held');
    `;
    const child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        source,
        new URL('../src/process-lock.ts', import.meta.url).href,
        directory,
      ],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }
    );
    const exit = once(child, 'exit');
    try {
      await Promise.race([
        once(child, 'message'),
        exit.then(() => {
          throw new Error('synthetic_lock_worker_exited_before_acquisition');
        }),
      ]);
      const owners = await readdir(directory);
      expect(owners).toHaveLength(1);
      expect(owners[0]).toMatch(new RegExp(`^${child.pid}\\.`));
      await expect(acquireProcessLock(directory)).rejects.toMatchObject({ code: 'EEXIST' });
      child.kill('SIGKILL');
      await exit;
      const release = await acquireProcessLock(directory);
      expect(await readdir(directory)).toEqual([
        expect.stringMatching(new RegExp(`^${process.pid}\\.`)),
      ]);
      await release();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exit;
      }
    }
  });

  it('protects the winner from a reaper holding the previous owner snapshot', async () => {
    const directory = await lockPath();
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    await once(child, 'exit');
    await mkdir(directory);
    await writeFile(join(directory, `${child.pid}.${randomUUID()}`), '');
    const firstSnapshot = signal();
    const secondSnapshot = signal();
    const resumeFirst = signal();
    const resumeSecond = signal();
    let snapshots = 0;
    hooks.owners = async (path) => {
      if (path !== directory) return;
      snapshots++;
      if (snapshots === 1) {
        firstSnapshot.resolve();
        await resumeFirst.promise;
      } else if (snapshots === 2) {
        secondSnapshot.resolve();
        await resumeSecond.promise;
      }
    };
    const first = acquireProcessLock(directory);
    await firstSnapshot.promise;
    const second = acquireProcessLock(directory).then(
      (release) => ({ release, error: undefined }),
      (error: unknown) => ({ release: undefined, error })
    );
    await secondSnapshot.promise;
    resumeFirst.resolve();
    const release = await first;
    resumeSecond.resolve();
    const loser = await second;
    hooks.owners = undefined;
    try {
      expect(loser.error).toMatchObject({ code: 'EEXIST' });
      expect(await readdir(directory)).toEqual([
        expect.stringMatching(new RegExp(`^${process.pid}\\.`)),
      ]);
    } finally {
      await release();
      await loser.release?.();
    }
  });

  it('protects a successor from delayed empty-directory cleanup', async () => {
    const directory = await lockPath();
    const release = await acquireProcessLock(directory);
    const removing = signal();
    const resume = signal();
    let paused = false;
    hooks.removeDirectory = async (path) => {
      if (path !== directory || paused) return;
      paused = true;
      removing.resolve();
      await resume.promise;
    };
    const previous = release();
    await removing.promise;
    const successor = await acquireProcessLock(directory);
    resume.resolve();
    await previous;
    await release();
    await expect(acquireProcessLock(directory)).rejects.toMatchObject({ code: 'EEXIST' });
    await successor();
  });

  it('recovers an abandoned empty guard but preserves malformed ownership', async () => {
    const directory = await lockPath();
    await mkdir(directory);
    const release = await acquireProcessLock(directory);
    await release();
    await mkdir(directory);
    await writeFile(join(directory, 'unidentified-owner'), '');
    await expect(acquireProcessLock(directory)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readdir(directory)).toEqual(['unidentified-owner']);
  });

  it('treats only ESRCH as evidence of an exited owner', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('synthetic_probe_failure'), { code: 'EPERM' });
    });
    expect(processExited(process.pid)).toBe(false);
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('synthetic_probe_failure'), { code: 'EINVAL' });
    });
    expect(processExited(process.pid)).toBe(false);
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('synthetic_probe_failure'), { code: 'ESRCH' });
    });
    expect(processExited(process.pid)).toBe(true);
  });

  it('retries Windows publication contention when the destination disappears', async () => {
    const directory = await lockPath();
    let failed = false;
    hooks.publish = (path) => {
      if (path !== directory || failed) return;
      failed = true;
      throw Object.assign(new Error('synthetic_windows_destination_released'), { code: 'EPERM' });
    };
    const release = await acquireProcessLock(directory);
    expect(await readdir(directory)).toHaveLength(1);
    await release();
  });

  it('preserves a genuine publication permission failure', async () => {
    const directory = await lockPath();
    hooks.publish = () => {
      throw Object.assign(new Error('synthetic_permission_failure'), { code: 'EPERM' });
    };
    await expect(acquireProcessLock(directory)).rejects.toMatchObject({ code: 'EPERM' });
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
