/**
 * The design store's write lock.
 *
 * `chats/<artworkId>/design.json` is written by two processes: the daemon
 * (post-turn collection, P2.3) and the Electron-owned CLI worker (the user's
 * save, forwarded over stdin). The store's own compare-and-swap decides who
 * wins — a writer whose baseline moved is refused instead of overwriting — but
 * the *compare* and the *swap* have to be one step. Without that, two writers
 * can both read revision R, both find their baseline intact, and both report
 * success while one of the two revisions silently disappears; content-addressed
 * revision ids cannot notice, because the loser's bytes are simply gone.
 *
 * So `designOperation`'s write path holds this lock across read-check-publish.
 * The lock is a file in the artwork's own directory, the only thing two
 * processes of this app share, and it is per artwork: two sessions never wait
 * for each other. Every other design-store write is content-addressed and
 * idempotent (a frozen turn manifest) and needs no
 * lock.
 *
 * Three rules keep it from becoming a new way to fail:
 *
 * - **Bounded.** Acquisition gives up after `DESIGN_LOCK_TIMEOUT_MS` and rejects
 *   with `DESIGN_BUSY` instead of waiting forever, so a caller can decide what
 *   its own failure means — collection preserves the draft and diagnostics
 *   rather than retrying a paid call (`agent-naive`; root `AGENTS.md`).
 * - **Recoverable.** A holder that dies without releasing would otherwise wedge
 *   the canvas for good, so a lock older than `DESIGN_LOCK_STALE_MS` is stolen:
 *   renaming the stale file aside is the atomic step, so of two stealers exactly
 *   one wins and the other's create decides.
 * - **Owned.** A holder writes a random token into the file and removes the lock
 *   only while that token is still there, so releasing can never delete a lock
 *   that has already been stolen and re-taken by someone else. The same token
 *   check runs once more immediately before the write the lock protects
 *   (`assertHeld`): a holder whose lock was taken while it worked refuses its own
 *   write instead of publishing on top of the new holder's.
 *
 * What this does not promise is that a live holder always keeps its lock. Age is
 * the only evidence available — a pid can be reused, and no health probe may
 * authorize taking someone's lock — so `DESIGN_LOCK_STALE_MS` is a ceiling for a
 * dead process, not a schedule for a live one, and a hold that passes it can be
 * stolen (a document near the store's size bound on a very slow disk). Two bounds
 * keep that narrow: a waiter arriving while the lock is younger than
 * `DESIGN_LOCK_STALE_MS - DESIGN_LOCK_TIMEOUT_MS` (35 s) always gives up first,
 * because its own budget expires before the file can age into the threshold; and a
 * holder that loses its lock after that still refuses its write at `assertHeld`.
 * One window stays open — the span between that check and the rename in
 * `publishBytesAtomic`, for a hold that already ran 45 s past any plausible
 * document — and what it costs is a lost update, never a torn read or a partial
 * file: bytes become visible whole.
 */

import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export const DESIGN_LOCK_FILENAME = '.design.lock';
/** How long a writer waits for the lock before reporting `DESIGN_BUSY`. */
export const DESIGN_LOCK_TIMEOUT_MS = 10_000;
/** How long a lock may sit unheld-but-present before a writer steals it. */
export const DESIGN_LOCK_STALE_MS = 45_000;
const DESIGN_LOCK_RETRY_MS = 25;

/**
 * The rejection message for "this writer may not publish: someone else holds or
 * took this artwork's lock".
 *
 * A constant because two callers match on it: the worker turns it into a failed
 * save, and the collection treats it as a lost race (the canvas may be moving
 * under it) rather than as a broken artifact.
 */
export const DESIGN_BUSY = 'DESIGN_BUSY';

export interface DesignLockTiming {
  /** Test seam: epoch milliseconds. Defaults to the wall clock. */
  now?: () => number;
  /** Test seam: the wait between attempts. Defaults to a real timer. */
  sleep?: (milliseconds: number) => Promise<void>;
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const errorCode = (error: unknown): string | undefined =>
  error instanceof Error && 'code' in error ? String(error.code) : undefined;

/** Create the lock file, or report that someone else holds it. */
async function tryCreateLock(file: string, token: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(file, 'wx', 0o600);
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return false;
    throw error;
  }
  try {
    // The pid is for a human reading the file; the token is what release
    // compares. Neither is used to decide whether a *process* is alive: a pid
    // can be reused, and no health probe may authorize taking someone's lock.
    await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return true;
}

/**
 * Take a lock that has been abandoned, if it has.
 *
 * Returns whether this call moved the stale file aside. A lock that is gone
 * (released between the directory listing and here) is not an error and not a
 * steal: it just means the next attempt may create one.
 */
async function stealStaleLock(file: string, now: () => number): Promise<boolean> {
  let stat;
  try {
    stat = await lstat(file);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
  if (now() - stat.mtimeMs < DESIGN_LOCK_STALE_MS) return false;
  const aside = `${file}.${randomUUID()}.stale`;
  try {
    await rename(file, aside);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
  // The stolen file is scratch: the holder this belonged to is gone.
  await unlink(aside).catch(() => undefined);
  return true;
}

/**
 * The token of whoever holds the lock right now, or `undefined` when there is no
 * readable lock file — absent, unreadable, or not the JSON this module writes.
 */
async function readLockToken(file: string): Promise<string | undefined> {
  let bytes: string;
  try {
    bytes = await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(bytes) as { token?: unknown };
    return typeof parsed.token === 'string' ? parsed.token : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Release the lock, and only while it is still ours.
 *
 * An unreadable or absent file means there is nothing of ours to remove; a
 * different token means it was stolen and re-taken, and removing it now would
 * hand the artwork to a third writer.
 */
async function releaseLock(file: string, token: string): Promise<void> {
  if ((await readLockToken(file)) !== token) return;
  await unlink(file).catch(() => undefined);
}

/**
 * Run `work` while holding this directory's design lock.
 *
 * The lock is taken and released around the caller's whole critical section, and
 * released on every path out of it — including a throw, which is how a refused
 * save (a conflict, an invalid document) leaves the lock free for the next
 * writer.
 *
 * `work` receives `assertHeld`, which it must call at the point of its effect —
 * immediately before publishing — whenever that effect is a decision made under
 * this lock. Calling it costs one read of a small file and turns "our lock was
 * stolen while we worked" into `DESIGN_BUSY` before anything is written.
 */
export async function withDesignLock<T>(
  directory: string,
  timing: DesignLockTiming,
  work: (assertHeld: () => Promise<void>) => Promise<T>
): Promise<T> {
  const now = timing.now ?? (() => Date.now());
  const sleep = timing.sleep ?? defaultSleep;
  const file = path.join(directory, DESIGN_LOCK_FILENAME);
  const token = randomUUID();
  const deadline = now() + DESIGN_LOCK_TIMEOUT_MS;

  for (;;) {
    if (await tryCreateLock(file, token)) break;
    await stealStaleLock(file, now);
    if (now() >= deadline) throw Error(DESIGN_BUSY);
    await sleep(DESIGN_LOCK_RETRY_MS);
  }

  const assertHeld = async (): Promise<void> => {
    if ((await readLockToken(file)) !== token) throw Error(DESIGN_BUSY);
  };

  try {
    return await work(assertHeld);
  } finally {
    await releaseLock(file, token);
  }
}
