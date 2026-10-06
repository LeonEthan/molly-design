import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

function code(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined;
}

export function processExited(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return code(error) === 'ESRCH';
  }
}

const OWNER_NAME = /^([1-9]\d*)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createOwnerName(): string {
  return `${process.pid}.${randomUUID()}`;
}

/** Only a PID/UUID owner name whose probe returns `ESRCH` proves its owner exited. */
export function ownerExited(name: string): boolean {
  const match = OWNER_NAME.exec(name);
  if (!match) return false;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && processExited(pid);
}

async function removeOwner(directory: string, owner: string): Promise<void> {
  try {
    await unlink(join(directory, owner));
  } catch (error) {
    if (code(error) !== 'ENOENT') throw error;
  }
  await removeEmptyDirectory(directory);
}

async function removeEmptyDirectory(directory: string): Promise<void> {
  try {
    await rmdir(directory);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(code(error) ?? '')) throw error;
  }
}

async function recoverExitedOwner(
  directory: string,
  publicationError: unknown
): Promise<'missing' | 'recovered' | 'held'> {
  let owners: string[];
  try {
    owners = await readdir(directory);
  } catch (error) {
    if (code(error) === 'ENOENT') return 'missing';
    throw publicationError;
  }
  if (owners.length === 0) {
    await removeEmptyDirectory(directory);
    return 'recovered';
  }
  const owner = owners[0]!;
  if (owners.length !== 1 || !ownerExited(owner)) return 'held';
  await removeOwner(directory, owner);
  return 'recovered';
}

export async function acquireProcessLock(
  directory: string,
  retries = 0
): Promise<() => Promise<void>> {
  const owner = createOwnerName();
  const staged = `${directory}.${owner}.tmp`;
  const busy = () => Object.assign(new Error('pi_acp_profile_locked'), { code: 'EEXIST' });
  let recoveries = 0;
  let missing = false;
  await mkdir(staged, { mode: 0o700 });
  try {
    await writeFile(join(staged, owner), '', { flag: 'wx', mode: 0o600 });
    for (;;) {
      try {
        await rename(staged, directory);
        break;
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(code(error) ?? '')) throw error;
        const recovery = await recoverExitedOwner(directory, error);
        if (recovery === 'missing') {
          if (missing) throw error;
          missing = true;
          continue;
        }
        missing = false;
        if (recovery === 'recovered') {
          if (++recoveries > 32) throw busy();
          continue;
        }
        if (retries-- <= 0) throw busy();
        await sleep(25);
        recoveries = 0;
      }
    }
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
  let release: Promise<void> | undefined;
  return () => (release ??= removeOwner(directory, owner));
}
