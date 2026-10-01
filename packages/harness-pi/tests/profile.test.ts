import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireSessionWriter } from '../src/profile';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function history() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'molly-writer-')));
  roots.push(root);
  const file = join(root, 'history.jsonl');
  await writeFile(file, '{}\n');
  return file;
}

async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await once(child, 'exit');
  return child.pid!;
}

describe('native history writer lock', () => {
  it('records its owner and refuses a second writer while the owner lives', async () => {
    const file = await history();
    const release = await acquireSessionWriter(file);
    expect(await readFile(`${file}.acp-lock`, 'utf8')).toBe(`${process.pid}\n`);
    await expect(acquireSessionWriter(file)).rejects.toMatchObject({ code: 'EEXIST' });
    await release();
    await expect(readFile(`${file}.acp-lock`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['a killed worker', async () => `${await exitedPid()}\n`],
    ['an earlier lock without an owner', async () => ''],
  ])('takes over a lock left by %s', async (_name, content) => {
    const file = await history();
    await writeFile(`${file}.acp-lock`, await content());
    const release = await acquireSessionWriter(file);
    expect(await readFile(`${file}.acp-lock`, 'utf8')).toBe(`${process.pid}\n`);
    await release();
  });
});
