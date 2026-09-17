import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, link, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';

/** P0 accepts only the shipped synthetic sample, not user-supplied documents. */
export async function openDesignSample(dataRoot: string, resources: string) {
  const fixture = await readFile(path.join(resources, 'sample.json'));
  const manifest = JSON.parse(await readFile(path.join(resources, 'build.json'), 'utf8'));
  const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  if (digest(fixture) !== manifest.sampleSha256) throw new Error('Design sample integrity failure');
  const directory = path.join(dataRoot, 'chats', 'molly-p0');
  await mkdir(directory, { recursive: true });
  const current = path.join(directory, 'design.json');
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(fixture);
      await file.sync();
    } finally {
      await file.close();
    }
    // Publish complete bytes once. Concurrent opens cannot replace an existing design.
    try {
      await link(temporary, current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
  const file = await open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== fixture.length) throw new Error('Saved sample is invalid');
    const saved = await file.readFile();
    if (digest(saved) !== manifest.sampleSha256)
      throw new Error('Saved sample differs; existing bytes were preserved');
    if (process.platform !== 'win32') {
      const parent = await open(directory, constants.O_RDONLY);
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    }
    return JSON.parse(saved.toString('utf8')) as unknown;
  } finally {
    await file.close();
  }
}
