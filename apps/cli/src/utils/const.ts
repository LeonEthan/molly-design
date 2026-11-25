import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { MachineId } from '@molly/shared';
import { getMollyDataDir, resolveIsolatedDataPath } from '@molly/shared/node/installation-profile';
import { z } from 'zod';

export let MOLLY_AUTH_URL = process.env.MOLLY_AUTH_URL ?? process.env.LODY_AUTH_URL;
export let MOLLY_AUTH_SITE_URL = process.env.MOLLY_AUTH_SITE_URL ?? process.env.LODY_AUTH_SITE_URL;
export let MOLLY_SERVER_URL = process.env.MOLLY_SERVER_URL ?? process.env.LODY_SERVER_URL;
export let SITE_APP_BASE_PATH = '';

export const loadEnv = () => {
  MOLLY_AUTH_URL = process.env['MOLLY_AUTH_URL'] ?? process.env.LODY_AUTH_URL;
  MOLLY_AUTH_SITE_URL = process.env['MOLLY_AUTH_SITE_URL'] ?? process.env.LODY_AUTH_SITE_URL;
  MOLLY_SERVER_URL = process.env['MOLLY_SERVER_URL'] ?? process.env.LODY_SERVER_URL;
  SITE_APP_BASE_PATH = process.env['SITE_APP_BASE_PATH'] ?? '';
};

const MACHINE_ID_FILE_NAME = 'machine-id';
const CREDENTIALS_FILE_NAME = 'credentials.json';

const CredentialMachineIdSchema = z
  .object({
    version: z.literal(3),
    token: z.string(),
    user: z
      .object({
        id: z.string(),
        email: z.string(),
        name: z.string().nullable().optional(),
      })
      .passthrough(),
    machine: z
      .object({
        machineName: z.string(),
        machineId: z.string().trim().min(1),
      })
      .passthrough(),
    createdAt: z.string().optional(),
  })
  .passthrough();

function getMachineIdFilePath(): string {
  return resolveIsolatedDataPath(getMollyDataDir(), MACHINE_ID_FILE_NAME);
}

function readCommittedIdentity(file: string): string | null {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    if (fs.existsSync(file + '.wx-pending') || fs.fstatSync(fd).nlink === 0) return null;
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function readPersistedMachineId(): MachineId | null {
  try {
    const machineIdPath = getMachineIdFilePath();
    const id = readCommittedIdentity(machineIdPath)?.trim();
    if (!id) return null;
    return id as MachineId;
  } catch {
    return null;
  }
}

function readCredentialMachineId(): MachineId | null {
  const credentialsPath = resolveIsolatedDataPath(getMollyDataDir(), CREDENTIALS_FILE_NAME);
  try {
    const parsed = CredentialMachineIdSchema.safeParse(
      JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'))
    );
    if (!parsed.success) return null;
    return parsed.data.machine.machineId as MachineId;
  } catch {
    return null;
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function writeAllSync(fd: number, value: string): void {
  const bytes = Buffer.from(value);
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!written) throw Error('identity_short_write');
    offset += written;
  }
  fs.fsyncSync(fd);
}

function durableCreate(file: string, value: string): void {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    writeAllSync(fd, value);
  } catch (error) {
    fs.closeSync(fd);
    fs.unlinkSync(file);
    throw error;
  }
  fs.closeSync(fd);
}

function acquireIdentityLock(file: string): number {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, String(process.pid));
      } catch (error) {
        fs.closeSync(fd);
        fs.unlinkSync(file);
        throw error;
      }
      return fd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const owner = readText(file);
    if (owner === null) continue;
    const pid = Number(owner);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) continue;
    let stale = !pid && Date.now() - stat.mtimeMs > 30000;
    if (Number.isSafeInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        stale = (error as NodeJS.ErrnoException).code === 'ESRCH';
      }
    }
    if (stale && readText(file) === owner) {
      const recovery = file + '.reap';
      const guard = acquireIdentityLock(recovery);
      try {
        const latest = fs.lstatSync(file, { throwIfNoEntry: false });
        if (latest?.ino === stat.ino && latest.ctimeMs === stat.ctimeMs && readText(file) === owner)
          fs.unlinkSync(file);
      } finally {
        fs.closeSync(guard);
        fs.unlinkSync(recovery);
      }
      continue;
    }
    if (Date.now() >= deadline) throw Error('identity_lock_busy');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

export function publishIdentity(
  file: string,
  valid: (raw: string) => boolean,
  generate: () => string,
  preferred?: () => string | null
): string {
  const root = path.dirname(file);
  const sibling = (suffix: string) => resolveIsolatedDataPath(root, path.basename(file) + suffix);
  const pending = sibling('.wx-pending');
  const desired = preferred?.();
  const existing = readCommittedIdentity(file);
  if (
    existing !== null &&
    valid(existing) &&
    (!desired || desired === existing.trim()) &&
    !fs.existsSync(pending)
  )
    return existing;
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = sibling('.init.lock');
  const temp = sibling('.' + crypto.randomUUID() + '.tmp');
  const fd = acquireIdentityLock(lock);
  try {
    const raw = readText(file);
    const marker = readText(pending);
    let expected: unknown;
    if (marker !== null) {
      try {
        expected = JSON.parse(marker).expectedValue;
      } catch {
        expected = undefined;
      }
    }
    const priority = preferred?.();
    if (
      raw !== null &&
      valid(raw) &&
      (!priority || priority === raw.trim()) &&
      (marker === null || expected === raw)
    ) {
      if (marker !== null) {
        const targetFd = fs.openSync(file, 'r+');
        try {
          fs.fsyncSync(targetFd);
        } finally {
          fs.closeSync(targetFd);
        }
        fs.unlinkSync(pending);
      }
      return raw;
    }
    const value =
      priority ?? (typeof expected === 'string' && valid(expected) ? expected : generate());
    durableCreate(temp, value);
    if (raw !== null || marker !== null || priority) {
      fs.renameSync(temp, file);
      if (marker !== null) fs.unlinkSync(pending);
    } else {
      try {
        fs.linkSync(temp, file);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (['EXDEV', 'EPERM', 'ENOTSUP'].includes(code ?? '')) {
          durableCreate(pending, JSON.stringify({ expectedValue: value }));
          try {
            durableCreate(file, value);
          } catch (fallbackError) {
            if ((fallbackError as NodeJS.ErrnoException).code !== 'EEXIST') {
              if (!fs.lstatSync(file, { throwIfNoEntry: false })) fs.unlinkSync(pending);
              throw fallbackError;
            }
          }
          fs.unlinkSync(pending);
        } else if (code !== 'EEXIST') throw error;
      }
    }
    const published = readText(file);
    if (published === null || !valid(published)) throw Error('invalid_published_identity');
    return published;
  } finally {
    fs.rmSync(temp, { force: true });
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

export function getSystemMachineId(): MachineId | null {
  try {
    return publishIdentity(
      getMachineIdFilePath(),
      (raw) => !!raw.trim(),
      () => crypto.randomUUID(),
      readCredentialMachineId
    ).trim() as MachineId;
  } catch (error) {
    if (process.env.MOLLY_ISOLATED_DATA_ROOT_STRICT === '1') throw error;
    return readPersistedMachineId() ?? readCredentialMachineId();
  }
}

export async function getSystemMachineIdAsync(): Promise<MachineId | null> {
  return getSystemMachineId();
}

/**
 * Returns a stable machine ID. The persisted identity keeps pairing retries
 * bound to the same installation.
 */
export async function getOrCreateStableMachineIdAsync(): Promise<MachineId> {
  const machineId = await getSystemMachineIdAsync();
  if (machineId) return machineId;

  throw Error('machine_identity_unavailable');
}
