import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createOwnerName, ownerExited } from './process-lock';

export interface WorkerTemporaryDirectory {
  path: string;
  release(): Promise<void>;
}

/**
 * Pi writes output files (full truncated tool output, binary MCP resources, codemode
 * images; Pi 1.0.3) to TMPDIR and never removes them. Each worker owns one directory
 * under `root`; a worker stopped with SIGKILL leaves its directory for the next sweep.
 */
export async function acquireWorkerTemporaryDirectory(
  root: string
): Promise<WorkerTemporaryDirectory> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(root)) {
    if (ownerExited(entry)) await rm(join(root, entry), { recursive: true, force: true });
  }
  const path = join(root, createOwnerName());
  await mkdir(path, { mode: 0o700 });
  let release: Promise<void> | undefined;
  return { path, release: () => (release ??= rm(path, { recursive: true, force: true })) };
}
