import { mkdtemp, readFile, rm, symlink, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { DESIGN_LOCK_FILENAME } from './lock';
import {
  designOperation,
  pendingDesigns,
  acknowledgeDesign,
  readDesignCandidate,
  type DesignPayload,
} from './store';

import { writeHistoricalCandidate } from './historical-candidate.fixture';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * A real 1×1 PNG, keyed by its own digest: an asset a synthetic document below
 * never mentions, which is the shape the intake produces for a reference the
 * document cannot carry (`theme.tableStyles` fills live in the manifest).
 */
const UNUSED_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4IScHAAK2AQU0pnWqAAAAAElFTkSuQmCC',
  'base64'
);
const UNUSED_ASSET_KEY = createHash('sha256').update(UNUSED_PNG_BYTES).digest('hex');
const UNUSED_ASSET_URI = `data:image/png;base64,${UNUSED_PNG_BYTES.toString('base64')}`;
test('durable save, stale writer, retry, independent copy and malformed input preserve the current drawing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-design-'));
  roots.push(root);
  const association = {
    sessionId: randomUUID(),
    name: 'Synthetic',
    userId: 'local:test',
    machineId: 'test-machine',
    createdAt: '2026-09-09T00:00:00.000Z',
  };
  const created = await designOperation(root, {
    operation: 'create',
    association,
  });
  expect(created.doc.canvas).toEqual({ width: 800, height: 600 });
  expect((await pendingDesigns(root)).map((value) => value.association.sessionId)).toEqual([
    association.sessionId,
  ]);
  await acknowledgeDesign(root, association.sessionId);
  expect(await pendingDesigns(root)).toEqual([]);
  const content = {
    doc: { ...created.doc, background: { type: 'solid', color: '#ff0000' } },
    assets: {},
  };
  const request = {
    operation: 'save',
    sessionId: association.sessionId,
    baseRevisionId: created.revisionId,
    content,
  };
  const saved = await designOperation(root, request);
  expect(saved.revisionId).not.toBe(created.revisionId);
  expect(await designOperation(root, request)).toEqual(saved);
  await expect(
    designOperation(root, {
      ...request,
      content: {
        ...content,
        doc: { ...content.doc, background: { type: 'solid', color: '#00ff00' } },
      },
    })
  ).rejects.toThrow('DESIGN_CONFLICT');
  const copied = await designOperation(root, {
    operation: 'create',
    association: { ...association, sessionId: randomUUID(), name: 'Copy' },
    width: 800,
    height: 600,
    copy: content,
  });
  expect(copied.doc).toEqual(saved.doc);
  const invalid = {
    ...request,
    baseRevisionId: saved.revisionId,
    content: {
      ...content,
      doc: {
        ...content.doc,
        elements: [
          {
            id: 'bad',
            kind: 'text',
            bounds: [0, 0, 100, 100],
            zIndex: 0,
            content: 'not structured text',
          },
        ],
      },
    },
  };
  await expect(designOperation(root, invalid)).rejects.toThrow();
  expect(
    await designOperation(root, { operation: 'read', sessionId: association.sessionId })
  ).toEqual(saved);
  await expect(
    designOperation(root, { operation: 'read', sessionId: '../outside' })
  ).rejects.toThrow();
  const fixture = JSON.parse(
    await readFile(
      new URL('../../../../packages/design-bento/sample.json', import.meta.url),
      'utf8'
    )
  );
  const withAssets = await designOperation(root, {
    operation: 'create',
    association: { ...association, sessionId: randomUUID(), name: 'With assets' },
    width: 800,
    height: 600,
    copy: fixture,
  });
  const independent = await designOperation(root, {
    operation: 'create',
    association: { ...association, sessionId: randomUUID(), name: 'Independent assets' },
    width: 800,
    height: 600,
    copy: { doc: withAssets.doc, assets: withAssets.assets },
  });
  await rm(path.join(root, 'chats', withAssets.association.sessionId), { recursive: true });
  expect(
    (
      await designOperation(root, {
        operation: 'read',
        sessionId: independent.association.sessionId,
      })
    ).assets
  ).toEqual(withAssets.assets);
  const file = path.join(root, 'chats', copied.association.sessionId, 'design.json');
  await rm(file);
  await symlink(path.join(root, 'chats', association.sessionId, 'design.json'), file);
  await expect(
    designOperation(root, { operation: 'read', sessionId: copied.association.sessionId })
  ).rejects.toThrow();
  const bytes = await readFile(
    path.join(root, 'chats', association.sessionId, 'design.json'),
    'utf8'
  );
  expect(JSON.parse(bytes).doc).toEqual(saved.doc);
  await writeFile(path.join(root, 'chats', association.sessionId, 'design.json'), '{}');
  await expect(
    designOperation(root, { operation: 'create', association, width: 800, height: 600 })
  ).rejects.toThrow();
});

test('two writers that read the same revision cannot both land', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-design-'));
  roots.push(root);
  const association = {
    sessionId: randomUUID(),
    name: 'Synthetic',
    userId: 'local:test',
    machineId: 'test-machine',
    createdAt: '2026-09-09T00:00:00.000Z',
  };
  const created = await designOperation(root, { operation: 'create', association });
  const save = (color: string) =>
    designOperation(root, {
      operation: 'save',
      sessionId: association.sessionId,
      baseRevisionId: created.revisionId,
      content: { doc: { ...created.doc, background: { type: 'solid', color } }, assets: {} },
    });

  // The daemon's post-turn collection and the desktop's save are different
  // processes on the same artwork. Both read the same revision; exactly one may
  // write it, or the loser's revision disappears with a success reply.
  const settled = await Promise.allSettled([save('#111111'), save('#222222')]);
  const landed = settled.filter((result) => result.status === 'fulfilled');
  const refused = settled.filter((result) => result.status === 'rejected');
  expect(landed).toHaveLength(1);
  expect(refused).toHaveLength(1);
  expect((refused[0] as PromiseRejectedResult).reason.message).toBe('DESIGN_CONFLICT');

  const winner = (landed[0] as PromiseFulfilledResult<DesignPayload>).value;
  const live = await designOperation(root, { operation: 'read', sessionId: association.sessionId });
  expect(live).toEqual(winner);
});

test('a read is not blocked by a writer holding the lock', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-design-'));
  roots.push(root);
  const association = {
    sessionId: randomUUID(),
    name: 'Synthetic',
    userId: 'local:test',
    machineId: 'test-machine',
    createdAt: '2026-09-09T00:00:00.000Z',
  };
  const created = await designOperation(root, { operation: 'create', association });
  // Bytes become visible whole, so a reader needs no lock: it sees one complete
  // revision, and that revision is then a truthful baseline for its own save.
  await writeFile(
    path.join(root, 'chats', association.sessionId, DESIGN_LOCK_FILENAME),
    JSON.stringify({ pid: 1, token: 'someone-else' })
  );
  expect(
    await designOperation(root, { operation: 'read', sessionId: association.sessionId })
  ).toEqual(created);
});

test('a document is the canvas even when its table carries assets the document does not use', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-design-'));
  roots.push(root);
  const association = {
    sessionId: randomUUID(),
    name: 'Synthetic',
    userId: 'local:test',
    machineId: 'test-machine',
    createdAt: '2026-09-09T00:00:00.000Z',
  };
  const fixture = JSON.parse(
    await readFile(
      new URL('../../../../packages/design-bento/sample.json', import.meta.url),
      'utf8'
    )
  );
  const content = {
    doc: fixture.doc,
    // The unused key rides along exactly as the intake sends one: the document
    // is the same document, and the table it arrives with is not the table the
    // canvas stores.
    assets: { ...fixture.assets, [UNUSED_ASSET_KEY]: UNUSED_ASSET_URI },
  };
  const created = await designOperation(root, {
    operation: 'create',
    association,
    width: 800,
    height: 600,
    copy: content,
  });
  // Only what the document replays is stored, so the two tables really do differ.
  expect(Object.keys(created.assets)).not.toContain(UNUSED_ASSET_KEY);

  const { candidateId } = await writeHistoricalCandidate(root, {
    artworkId: association.sessionId,
    turnId: 'turn-1',
    baselineRevisionId: created.revisionId,
    createdAt: '2026-09-10T01:00:00.000Z',
    content,
  });
  const { candidate } = await readDesignCandidate(root, association.sessionId, candidateId);
  expect(candidate.content.assets[UNUSED_ASSET_KEY]).toBe(UNUSED_ASSET_URI);

  expect(
    await designOperation(root, {
      operation: 'save',
      sessionId: association.sessionId,
      baseRevisionId: created.revisionId,
      content: candidate.content,
    })
  ).toEqual(created);
});

test('reading a missing drawing never creates its session directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-missing-design-'));
  roots.push(root);
  const id = randomUUID();
  await expect(designOperation(root, { operation: 'read', sessionId: id })).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await expect(lstat(path.join(root, 'chats'))).rejects.toMatchObject({ code: 'ENOENT' });
});
