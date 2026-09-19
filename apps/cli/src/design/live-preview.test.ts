import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { buildLivePreviewPayload } from './live-preview';
import { readDesignArtifactDigest } from './artifact';
import { buildPreviewPayload } from './render-preview';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
test('live display rejects previous-turn bytes and accepts valid current edits without saving', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-live-'));
  roots.push(root);
  const live = { sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sourceTurnId: 'turn-2' };
  const workdir = path.join(root, 'chats', live.sessionId);
  const turn = path.join(workdir, 'design-input', live.sourceTurnId);
  await mkdir(turn, { recursive: true });
  const page = 'format: molly-canvas/1\ntitle: Synthetic\nsize: [320, 200]\nelements: []\n';
  await writeFile(path.join(workdir, 'design.yaml'), page);
  expect((await buildLivePreviewPayload(root, workdir, live)).status).toBe('refused');
  await writeFile(
    path.join(turn, 'manifest.json'),
    JSON.stringify({
      version: 1,
      turnId: live.sourceTurnId,
      baselineRevisionId: 'a'.repeat(64),
      artifactAtSend: await readDesignArtifactDigest(workdir),
      previewSourceAtSend: (await buildPreviewPayload(workdir, {})).sourceIdentity,
    })
  );
  expect((await buildLivePreviewPayload(root, workdir, live)).status).toBe('refused');
  await mkdir(path.join(workdir, 'media'));
  // Preparing an unused asset must not display a draft inherited from an older turn.
  await writeFile(
    path.join(workdir, 'media', 'unused.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"/>'
  );
  expect((await buildLivePreviewPayload(root, workdir, live)).status).toBe('refused');
  await writeFile(path.join(workdir, 'design.yaml'), page.replace('Synthetic', 'New title'));
  const valid = await buildLivePreviewPayload(root, workdir, live);
  expect(valid.status).toBe('ok');
  await writeFile(path.join(workdir, 'design.yaml'), 'elements: [');
  expect((await buildLivePreviewPayload(root, workdir, live)).status).toBe('refused');
});
