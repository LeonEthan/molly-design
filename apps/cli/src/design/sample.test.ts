import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openDesignSample } from './sample';

describe('P0 sample workspace', () => {
  it('publishes once, reopens after lost response, and never overwrites changed files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'molly-sample-test-'));
    try {
      const resources = path.join(root, 'resources');
      await mkdir(resources);
      const fixture = JSON.stringify({ doc: { schemaVersion: 4 }, assets: {} });
      await writeFile(path.join(resources, 'sample.json'), fixture);
      await writeFile(
        path.join(resources, 'build.json'),
        JSON.stringify({
          sampleSha256: createHash('sha256').update(fixture).digest('hex'),
        })
      );
      await Promise.all([openDesignSample(root, resources), openDesignSample(root, resources)]);
      expect(await openDesignSample(root, resources)).toEqual(JSON.parse(fixture));
      const current = path.join(root, 'chats/molly-p0/design.json');
      await writeFile(current, 'user content');
      await expect(openDesignSample(root, resources)).rejects.toThrow('Saved sample');
      expect(await readFile(current, 'utf8')).toBe('user content');
      await writeFile(path.join(resources, 'sample.json'), 'corrupt bundle');
      await expect(openDesignSample(root, resources)).rejects.toThrow('integrity');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
