import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { exportAuthoring, collectAuthoring } from '@molly/design-authoring';
import type { DesignPayload } from './store';
import { ensureDesignDirectory } from './workspace';

const checksum = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const markerName = '.molly-current.json';
const temporaryPrefix = '.design-current-';

/** Current representation only: no draft, turn, runtime, or history ownership. */
async function publishCurrentProjection(
  canonicalDirectory: string,
  current: DesignPayload,
  assertHeld: () => Promise<void>,
  verifyOnly = false
): Promise<void> {
  const target = path.join(canonicalDirectory, 'design-current');
  const assets = new Map(
    Object.entries(current.assets).map(([hash, uri]) => [
      hash,
      Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'),
    ])
  );
  const files = exportAuthoring(
    current.doc as unknown as Parameters<typeof exportAuthoring>[0],
    assets
  );
  const marker = JSON.stringify({
    revisionId: current.revisionId,
    files: [...files].map(([file, bytes]) => [file, checksum(bytes)]),
  });
  await ensureDesignDirectory(canonicalDirectory, target);
  const ready = await (async () => {
    try {
      const handle = await open(
        path.join(target, markerName),
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      try {
        const stat = await handle.stat();
        if (
          !stat.isFile() ||
          stat.size !== Buffer.byteLength(marker) ||
          (await handle.readFile('utf8')) !== marker
        )
          return false;
      } finally {
        await handle.close();
      }
      const observed = collectAuthoring(target);
      if (observed.size !== files.size) return false;
      for (const [file, bytes] of files) {
        const actual = observed.get(file);
        if (!actual || checksum(actual) !== checksum(bytes)) return false;
      }
      return true;
    } catch {
      return false;
    }
  })();
  if (ready) return;
  if (verifyOnly)
    throw Error(
      'DESIGN_PROJECTION_NOT_READY: save or reopen the current canvas before dispatch; draft preserved'
    );
  const staging = await mkdtemp(path.join(canonicalDirectory, temporaryPrefix));
  const previous = `${staging}-previous`;
  try {
    for (const [file, bytes] of [...files, [markerName, Buffer.from(marker)] as const]) {
      const destination = path.join(staging, file);
      await mkdir(path.dirname(destination), { recursive: true });
      const handle = await open(destination, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    // All saved files are durable before publishing the directory. The canonical
    // rename and this publication are separate; readiness checks bridge crashes.
    if (process.platform !== 'win32') {
      for (const directory of new Set([
        staging,
        ...[...files.keys()].map((file) => path.dirname(path.join(staging, file))),
      ])) {
        const handle = await open(directory, constants.O_RDONLY);
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    }
    await assertHeld();
    await rename(target, previous).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await assertHeld();
    await rename(staging, target);
    if (process.platform !== 'win32') {
      const handle = await open(canonicalDirectory, constants.O_RDONLY);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    // A previous crash may leave publication staging behind, never history.
    for (const name of await readdir(canonicalDirectory)) {
      if (name.startsWith(temporaryPrefix)) {
        await assertHeld();
        const stale = path.join(canonicalDirectory, name);
        if (!(await lstat(stale)).isSymbolicLink())
          await rm(stale, { recursive: true, force: true });
      }
    }
  } catch (error) {
    throw Error(
      `DESIGN_PROJECTION_FAILED: canvas revision ${current.revisionId} is saved; current files are not ready. Retry save or reopen. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(previous, { recursive: true, force: true });
  }
}

export async function ensureCurrentProjection(
  canonicalDirectory: string,
  current: DesignPayload,
  assertHeld: () => Promise<void>,
  verifyOnly = false
): Promise<void> {
  try {
    await publishCurrentProjection(canonicalDirectory, current, assertHeld, verifyOnly);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('DESIGN_PROJECTION_')) throw error;
    throw Error(
      `DESIGN_PROJECTION_FAILED: canonical revision ${current.revisionId} is persisted but current files are not ready; retry save or reopen. ${message}`,
      { cause: error }
    );
  }
}
