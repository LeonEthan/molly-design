import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireWorkerTemporaryDirectory } from '../src/worker-temp';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'molly-worker-temp-')));
  roots.push(root);
  return join(root, 'tmp');
}

async function exitedPid() {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(child, 'exit');
  return child.pid!;
}

describe('worker temporary directory', () => {
  it('owns a private directory and removes it on release', async () => {
    const root = await temporaryRoot();
    const temporary = await acquireWorkerTemporaryDirectory(root);
    expect(await readdir(root)).toEqual([expect.stringMatching(new RegExp(`^${process.pid}\\.`))]);
    expect((await stat(temporary.path)).mode & 0o777).toBe(0o700);
    await writeFile(join(temporary.path, 'pi-image.png'), 'synthetic');
    await temporary.release();
    await temporary.release();
    expect(await readdir(root)).toEqual([]);
  });

  it('sweeps exited owners and keeps live owners and unidentified entries', async () => {
    const root = await temporaryRoot();
    const exited = join(root, `${await exitedPid()}.${randomUUID()}`);
    const live = join(root, `${process.pid}.${randomUUID()}`);
    for (const directory of [exited, live]) {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'pi-output.txt'), 'synthetic');
    }
    await writeFile(join(root, 'pi-output-legacy.txt'), 'synthetic');
    const temporary = await acquireWorkerTemporaryDirectory(root);
    expect((await readdir(root)).sort()).toEqual(
      [live, temporary.path, join(root, 'pi-output-legacy.txt')]
        .map((path) => path.slice(root.length + 1))
        .sort()
    );
    await temporary.release();
  });
});
