import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, test } from 'vitest';
import type { SessionId } from '@molly/shared';
import { FilePreviewService } from '../lib/file-preview/file-preview-service';
import { designOperation, readDesignCandidate } from './store';

import { writeHistoricalCandidate } from './historical-candidate.fixture';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('reopened historical file yields exact original document and extractable asset bytes through ordinary preview', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-old-file-'));
  roots.push(root);
  const artworkId = randomUUID();
  const sessionId = randomUUID() as SessionId;
  const created = await designOperation(root, {
    operation: 'create',
    association: {
      sessionId: artworkId,
      name: 'Synthetic',
      userId: 'local:test',
      machineId: 'test',
      createdAt: '2026-09-11T00:00:00.000Z',
    },
  });
  const fixture = JSON.parse(
    await readFile(
      new URL('../../../../packages/design-bento/sample.json', import.meta.url),
      'utf8'
    )
  );
  const saved = await writeHistoricalCandidate(root, {
    artworkId,
    turnId: 'old-conflicted-turn',
    baselineRevisionId: created.revisionId,
    createdAt: '2026-09-11T00:00:00.000Z',
    content: { doc: fixture.doc, assets: fixture.assets },
  });
  const canonicalBefore = await readFile(path.join(root, 'chats', artworkId, 'design.json'));
  const first = await readDesignCandidate(root, artworkId, saved.candidateId);
  const original = await readFile(first.file);
  // A fresh reader after reopening uses only the persisted identity, never a UI cache.
  const reopened = await readDesignCandidate(root, artworkId, saved.candidateId);
  const files = new FilePreviewService({
    resolveWorkspace: async () => ({ ok: true, ownerSessionId: sessionId, workspaceRoot: root }),
    extraRoots: [],
  });
  const response = await files.previewFile({ v: 3, sessionId, path: reopened.file });
  if (response.status !== 'ok' || response.kind !== 'text')
    throw Error('Expected original text file');
  const bytes =
    response.content.encoding === 'utf8-plain'
      ? Buffer.from(response.content.text)
      : response.content.encoding === 'utf8-gzip-base64'
        ? gunzipSync(Buffer.from(response.content.data, 'base64'))
        : (() => {
            throw Error('Expected text encoding');
          })();
  expect(bytes).toEqual(original);
  const content = JSON.parse(bytes.toString('utf8')).content;
  expect(content.doc).toEqual(fixture.doc);
  expect(Object.keys(content.assets).length).toBeGreaterThan(0);
  // Ordinary file processing can recover the real image/font files without a new tool.
  for (const [hash, dataUri] of Object.entries(content.assets)) {
    if (typeof dataUri !== 'string') throw Error('Expected embedded asset');
    const asset = Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
    expect(createHash('sha256').update(asset).digest('hex')).toBe(hash);
    const extracted = path.join(root, hash);
    await writeFile(extracted, asset);
    expect(await readFile(extracted)).toEqual(asset);
  }
  expect(await readFile(first.file)).toEqual(original);
  expect(await readFile(path.join(root, 'chats', artworkId, 'design.json'))).toEqual(
    canonicalBefore
  );

  const tampered = JSON.parse(original.toString('utf8'));
  tampered.artworkId = randomUUID();
  await writeFile(first.file, JSON.stringify(tampered));
  await expect(readDesignCandidate(root, artworkId, saved.candidateId)).rejects.toThrow(
    'identity mismatch'
  );
});
