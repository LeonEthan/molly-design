import { homedir } from 'node:os';
import { link, mkdir, open, realpath, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep, dirname, basename } from 'node:path';
import type { SessionManager } from '@earendil-works/pi-coding-agent';
import { createHash, randomUUID } from 'node:crypto';
import { resolveProductNativeSession, validateNativeSession } from './native-session';
import type { WorkerConfig } from './worker-config';
import { acquireProcessLock, processExited } from './process-lock';

export async function prepareProfile(agentDir: string): Promise<string> {
  if (!isAbsolute(agentDir)) throw new Error('pi_acp_profile_must_be_absolute');
  const resolved = await canonicalTarget(agentDir);
  const cliProfile = join(homedir(), '.pi', 'agent');
  const defaultDir = await canonicalTarget(cliProfile);
  const local = relative(defaultDir, resolved);
  const reverse = relative(resolved, defaultDir);
  if (
    !local ||
    (!local.startsWith(`..${sep}`) && local !== '..' && !isAbsolute(local)) ||
    (!reverse.startsWith(`..${sep}`) && reverse !== '..' && !isAbsolute(reverse))
  )
    throw new Error('pi_acp_cli_profile_refused');
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  return realpath(resolved);
}

async function canonicalTarget(target: string): Promise<string> {
  try {
    return await realpath(target);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    return join(await canonicalTarget(dirname(target)), basename(target));
  }
}

export async function sessionDirectory(agentDir: string): Promise<string> {
  const directory = join(agentDir, 'sessions');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const canonical = await realpath(directory);
  const local = relative(await realpath(agentDir), canonical);
  if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local))
    throw new Error('pi_acp_session_outside_profile');
  return canonical;
}

export async function persistNativeHeader(manager: SessionManager): Promise<SessionManager> {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  const file = manager.getSessionFile();
  const header = manager.getHeader();
  if (!file || !header) throw new Error('pi_acp_native_session_unavailable');
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(header)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return SessionManager.open(file, manager.getSessionDir(), manager.getCwd());
}

export async function acquireSessionWriter(file: string): Promise<() => Promise<void>> {
  const lock = `${file}.acp-lock`;
  const staged = `${lock}.${process.pid}.${randomUUID()}`;
  const releaseGuard = await acquireProcessLock(`${lock}.guard`);
  try {
    await writeFile(staged, `${process.pid}\n`, { mode: 0o600, flag: 'wx' });
    try {
      try {
        await link(staged, lock);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const record = await readFile(lock, 'utf8');
        const owner = Number(record.trim());
        if (!/^[1-9]\d*\n$/.test(record) || !Number.isSafeInteger(owner) || !processExited(owner))
          throw error;
        await unlink(lock);
        await link(staged, lock);
      }
    } finally {
      await unlink(staged);
    }
  } catch (error) {
    await releaseGuard();
    throw error;
  }
  let release: Promise<void> | undefined;
  return () => {
    release ??= (async () => {
      try {
        await unlink(lock);
      } finally {
        await releaseGuard();
      }
    })();
    return release;
  };
}

export async function openNativeSession(
  id: string,
  cwd: string,
  directory: string
): Promise<{ manager: SessionManager; releaseWriter: () => Promise<void> }> {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  const rows = await SessionManager.list(cwd, directory);
  const row = rows.find((entry) => entry.id === id);
  if (!row) throw new Error('pi_acp_native_session_not_found');
  const file = await realpath(row.path);
  const local = relative(directory, file);
  if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local))
    throw new Error('pi_acp_session_outside_profile');
  const releaseWriter = await acquireSessionWriter(file);
  try {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > 128 * 1024 * 1024)
      throw new Error('pi_acp_native_session_corrupt');
    const lines = (await readFile(file, 'utf8')).split('\n');
    if (lines.at(-1) === '') lines.pop();
    if (lines.length === 0) throw new Error('pi_acp_native_session_corrupt');
    const header = JSON.parse(lines[0]!);
    if (header.type !== 'session' || header.version !== 3 || header.id !== id || header.cwd !== cwd)
      throw new Error('pi_acp_native_session_corrupt');
    const ids = new Set<string>();
    const types = new Set([
      'message',
      'thinking_level_change',
      'model_change',
      'usage',
      'compaction',
      'branch_summary',
      'custom',
      'custom_message',
      'context_edit',
      'label',
      'session_info',
    ]);
    for (const line of lines.slice(1)) {
      const entry = JSON.parse(line);
      if (
        !types.has(entry.type) ||
        typeof entry.id !== 'string' ||
        !entry.id ||
        ids.has(entry.id) ||
        (entry.parentId !== null && !ids.has(entry.parentId))
      )
        throw new Error('pi_acp_native_session_corrupt');
      ids.add(entry.id);
    }
    return { manager: SessionManager.open(file, directory, cwd), releaseWriter };
  } catch (error) {
    await releaseWriter();
    throw error;
  }
}

/**
 * Product histories keep the partitioned layout under the private root: a connection folder
 * records the creation partition and a restore searches every partition for the exact UUID.
 */
export async function openProductSession(
  config: WorkerConfig,
  cwd: string,
  nativeId?: string
): Promise<{ manager: SessionManager; releaseWriter: () => Promise<void> }> {
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const directory = join(
    config.privateRoot,
    'sessions',
    digest(config.connection.id),
    digest(config.productSessionId)
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!nativeId && !config.nativeSessionFile) {
    const manager = await persistNativeHeader(SessionManager.create(cwd, directory));
    return { manager, releaseWriter: await acquireSessionWriter(manager.getSessionFile()!) };
  }
  const restored = nativeId
    ? await resolveProductNativeSession(config.privateRoot, config.productSessionId, nativeId, cwd)
    : { file: await validateNativeSession(config.nativeSessionFile!, directory, cwd), directory };
  const releaseWriter = await acquireSessionWriter(restored.file);
  try {
    // Validate again while holding the writer, then open through the public API.
    await validateNativeSession(restored.file, restored.directory, cwd, nativeId);
    return {
      manager: SessionManager.open(restored.file, restored.directory, cwd),
      releaseWriter,
    };
  } catch (error) {
    await releaseWriter();
    throw error;
  }
}
