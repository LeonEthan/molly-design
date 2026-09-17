/**
 * Design store lock tests (P2.7). The lock is what makes the store's
 * compare-and-swap one step, so these cover the properties a reader depends on:
 * one winner, a bounded wait, a steal that only fires on an abandoned file, and
 * a release that can never remove someone else's lock.
 */

import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { DESIGN_BUSY, DESIGN_LOCK_FILENAME, withDesignLock, type DesignLockTiming } from './lock';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-design-lock-'));
  roots.push(root);
  return root;
}

/** A lock file as another holder would have left it. */
async function holdLock(directory: string, token = 'someone-else'): Promise<string> {
  const file = path.join(directory, DESIGN_LOCK_FILENAME);
  await writeFile(file, JSON.stringify({ pid: 1, token }));
  return file;
}

/**
 * A clock that starts at the real wall clock (so the lock file's real mtime stays
 * comparable) and advances a full second per reading. Every iteration of the
 * acquisition loop reads it at least once, so the deadline is reached by
 * arithmetic, never by waiting.
 */
const advancingClock = (): { timing: DesignLockTiming } => {
  let at = Date.now();
  return {
    timing: {
      now: () => {
        at += 1_000;
        return at;
      },
      sleep: async () => undefined,
    },
  };
};

test('the lock is held for the whole critical section and released after it', async () => {
  const directory = await scratch();
  const file = path.join(directory, DESIGN_LOCK_FILENAME);
  const events: string[] = [];
  const result = await withDesignLock(directory, {}, async () => {
    events.push(`held:${(await readFile(file, 'utf8')).includes('token')}`);
    return 'done';
  });
  expect(result).toBe('done');
  expect(events).toEqual(['held:true']);
  expect(await readFile(file, 'utf8').catch(() => 'gone')).toBe('gone');
});

test('a critical section that throws still leaves the lock free', async () => {
  const directory = await scratch();
  await expect(
    withDesignLock(directory, {}, async () => {
      throw Error('the save was refused');
    })
  ).rejects.toThrow('the save was refused');
  // The next writer is not locked out by a failure that never released.
  expect(await withDesignLock(directory, {}, async () => 'second')).toBe('second');
});

test('a held lock is a bounded wait: DESIGN_BUSY, and the holder is left alone', async () => {
  const directory = await scratch();
  const file = await holdLock(directory);
  const before = await readFile(file, 'utf8');
  const { timing } = advancingClock();
  await expect(withDesignLock(directory, timing, async () => 'never')).rejects.toThrow(DESIGN_BUSY);
  // A live holder is never stolen from, however long a waiter waits.
  expect(await readFile(file, 'utf8')).toBe(before);
});

test('an abandoned lock is stolen, and the stealing writer proceeds', async () => {
  const directory = await scratch();
  const file = await holdLock(directory);
  const longAgo = new Date(Date.now() - 60_000);
  await utimes(file, longAgo, longAgo);

  expect(await withDesignLock(directory, {}, async () => 'stolen-and-taken')).toBe(
    'stolen-and-taken'
  );
  expect(await readFile(file, 'utf8').catch(() => 'gone')).toBe('gone');
});

test('a lock taken away mid-section refuses the write that was about to follow it', async () => {
  const directory = await scratch();
  const file = path.join(directory, DESIGN_LOCK_FILENAME);
  // The misfiring steal of the test above, but this time the holder is about to
  // publish: it must refuse, not land on top of the writer that took its place.
  await expect(
    withDesignLock(directory, {}, async (assertHeld) => {
      await assertHeld();
      await holdLock(directory, 'third-writer');
      await assertHeld();
      return 'written anyway';
    })
  ).rejects.toThrow(DESIGN_BUSY);
  // Refusing did not disturb the writer that holds it now.
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ pid: 1, token: 'third-writer' });
});

test('release cannot remove a lock that was stolen and re-taken meanwhile', async () => {
  const directory = await scratch();
  const file = path.join(directory, DESIGN_LOCK_FILENAME);
  const outcome = await withDesignLock(directory, {}, async () => {
    // The holder's lock is taken away mid-section (a steal that misfired) and
    // re-taken by a third writer. Releasing now would hand the directory to a
    // fourth.
    await holdLock(directory, 'third-writer');
    return 'done';
  });
  expect(outcome).toBe('done');
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ pid: 1, token: 'third-writer' });
});
