import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { designHistoryOperation } from './history';
import { designOperation } from './store';
import { withDesignLock } from './lock';
import { ARTWORK_ENTRY, collectAuthoring, intakeAuthoring } from '@molly/design-authoring';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-history-'));
  roots.push(root);
  const sessionId = randomUUID();
  const initial = await designOperation(root, {
    operation: 'create',
    association: {
      sessionId,
      name: 'Synthetic history',
      userId: 'local:test',
      machineId: 'synthetic',
      createdAt: '2026-09-12T00:00:00.000Z',
    },
  });
  const save = async (color: string) => {
    const current = await designOperation(root, { operation: 'read', sessionId });
    return designOperation(root, {
      operation: 'save',
      sessionId,
      baseRevisionId: current.revisionId,
      content: { doc: { ...current.doc, background: { type: 'solid', color } }, assets: {} },
    });
  };
  return { root, sessionId, initial, save };
}

test('versions preserve history, restoring protects unversioned work, and later edits append', async () => {
  const { root, sessionId, initial, save } = await fixture();
  expect(await designHistoryOperation(root, { operation: 'history-list', sessionId })).toEqual([]);
  const first = await designHistoryOperation(root, {
    operation: 'history-create',
    sessionId,
    baseRevisionId: initial.revisionId,
  });
  if (Array.isArray(first) || !('commitId' in first)) throw Error('Expected version');
  const red = await save('#ff0000');
  const second = await designHistoryOperation(root, {
    operation: 'history-create',
    sessionId,
    baseRevisionId: red.revisionId,
  });
  if (Array.isArray(second) || !('commitId' in second)) throw Error('Expected version');
  const green = await save('#00ff00');
  const before = await readFile(path.join(root, 'chats', sessionId, 'design.json'));
  const historic = await designHistoryOperation(root, {
    operation: 'history-read',
    sessionId,
    commitId: first.commitId,
  });
  if (Array.isArray(historic) || !('doc' in historic)) throw Error('Expected document');
  expect(historic.doc).toEqual(initial.doc);
  expect(await readFile(path.join(root, 'chats', sessionId, 'design.json'))).toEqual(before);
  const restored = await designHistoryOperation(root, {
    operation: 'history-restore',
    sessionId,
    commitId: first.commitId,
    baseRevisionId: green.revisionId,
  });
  if (Array.isArray(restored) || !('doc' in restored)) throw Error('Expected document');
  expect(restored.doc).toEqual(initial.doc);
  expect(
    await designHistoryOperation(root, {
      operation: 'history-restore',
      sessionId,
      commitId: first.commitId,
      baseRevisionId: green.revisionId,
    })
  ).toEqual(restored);
  const list = await designHistoryOperation(root, { operation: 'history-list', sessionId });
  if (!Array.isArray(list)) throw Error('Expected versions');
  expect(list.map((v) => v.kind)).toEqual(['saved', 'saved', 'before-restore']);
  const protectedVersion = list[2];
  if (!protectedVersion) throw Error('Expected protective version');
  const protectedDoc = await designHistoryOperation(root, {
    operation: 'history-read',
    sessionId,
    commitId: protectedVersion.commitId,
  });
  if (Array.isArray(protectedDoc) || !('doc' in protectedDoc)) throw Error('Expected document');
  expect(protectedDoc.doc).toEqual(green.doc);
  const blue = await save('#0000ff');
  const fourth = await designHistoryOperation(root, {
    operation: 'history-create',
    sessionId,
    baseRevisionId: blue.revisionId,
  });
  expect(fourth).toMatchObject({ number: 4 });
  const oldRed = await designHistoryOperation(root, {
    operation: 'history-read',
    sessionId,
    commitId: second.commitId,
  });
  if (Array.isArray(oldRed) || !('doc' in oldRed)) throw Error('Expected document');
  expect(oldRed.doc).toEqual(red.doc);
});

test('Git retains exact embedded image and font bytes after current assets change', async () => {
  const { root, sessionId, initial } = await fixture();
  const content = JSON.parse(
    await readFile(
      new URL('../../../../packages/design-bento/sample.json', import.meta.url),
      'utf8'
    )
  );
  const artwork = await designOperation(root, {
    operation: 'save',
    sessionId,
    baseRevisionId: initial.revisionId,
    content,
  });
  const version = await designHistoryOperation(root, {
    operation: 'history-create',
    sessionId,
    baseRevisionId: artwork.revisionId,
  });
  if (Array.isArray(version) || !('commitId' in version)) throw Error('Expected version');
  // Replace the current payload completely, removing its original assets.
  const blank = await designOperation(root, {
    operation: 'save',
    sessionId,
    baseRevisionId: (await designOperation(root, { operation: 'read', sessionId })).revisionId,
    content: { doc: initial.doc, assets: {} },
  });
  const historical = await designHistoryOperation(root, {
    operation: 'history-read',
    sessionId,
    commitId: version.commitId,
  });
  expect(historical).toMatchObject({ doc: artwork.doc, assets: artwork.assets });
  expect(
    Object.values(artwork.assets)
      .map((value) => value.split(';')[0])
      .sort()
  ).toEqual(['data:font/woff2', 'data:image/png']);
  const restored = await designHistoryOperation(root, {
    operation: 'history-restore',
    sessionId,
    commitId: version.commitId,
    baseRevisionId: blank.revisionId,
  });
  expect(restored).toMatchObject({ doc: artwork.doc, assets: artwork.assets });
  if (Array.isArray(restored) || !('revisionId' in restored)) throw Error('Expected document');
  const projection = path.join(root, 'chats', sessionId, 'design-current');
  expect(
    JSON.parse(await readFile(path.join(projection, '.molly-current.json'), 'utf8')).revisionId
  ).toBe(restored.revisionId);
  const imported = intakeAuthoring(ARTWORK_ENTRY, collectAuthoring(projection));
  if (imported.status !== 'ok') throw Error('Expected valid restored YAML artwork');
  expect(imported.document).toEqual(artwork.doc);
});

test('failed protective Git publication leaves unversioned current work intact', async () => {
  const { root, sessionId, initial, save } = await fixture();
  const version = await designHistoryOperation(root, {
    operation: 'history-create',
    sessionId,
    baseRevisionId: initial.revisionId,
  });
  if (Array.isArray(version) || !('commitId' in version)) throw Error('Expected version');
  const red = await save('#ff0000');
  await writeFile(
    path.join(root, 'chats', sessionId, 'history.git', 'refs', 'heads', 'main.lock'),
    'synthetic held Git ref'
  );
  await expect(
    designHistoryOperation(root, {
      operation: 'history-restore',
      sessionId,
      commitId: version.commitId,
      baseRevisionId: red.revisionId,
    })
  ).rejects.toThrow();
  expect(await designOperation(root, { operation: 'read', sessionId })).toEqual(red);
  expect(await designHistoryOperation(root, { operation: 'history-list', sessionId })).toEqual([
    version,
  ]);
});

test('stale restore and another artwork version cannot overwrite current work', async () => {
  const a = await fixture();
  const b = await fixture();
  const version = await designHistoryOperation(a.root, {
    operation: 'history-create',
    sessionId: a.sessionId,
    baseRevisionId: a.initial.revisionId,
  });
  if (Array.isArray(version) || !('commitId' in version)) throw Error('Expected version');
  const red = await a.save('#ff0000');
  await expect(
    designHistoryOperation(a.root, {
      operation: 'history-restore',
      sessionId: a.sessionId,
      commitId: version.commitId,
      baseRevisionId: a.initial.revisionId,
    })
  ).rejects.toThrow('DESIGN_CONFLICT');
  expect(await designOperation(a.root, { operation: 'read', sessionId: a.sessionId })).toEqual(red);
  await expect(
    designHistoryOperation(b.root, {
      operation: 'history-read',
      sessionId: b.sessionId,
      commitId: version.commitId,
    })
  ).rejects.toThrow('Design version not found');
});

test('history cannot be redirected into an unrelated repository', async () => {
  const { root, sessionId, initial } = await fixture();
  const unrelated = await mkdtemp(path.join(tmpdir(), 'molly-unrelated-'));
  roots.push(unrelated);
  await symlink(unrelated, path.join(root, 'chats', sessionId, 'history.git'), 'dir');
  await expect(
    designHistoryOperation(root, {
      operation: 'history-create',
      sessionId,
      baseRevisionId: initial.revisionId,
    })
  ).rejects.toThrow('redirected');
});

test('selected bases persist, branching keeps later versions and unchanged saves are idempotent', async () => {
  const { root, sessionId, initial, save } = await fixture();
  const read = () => designOperation(root, { operation: 'read', sessionId });
  const checkpoint = async () => {
    const current = await read();
    const request = { operation: 'history-create', sessionId, baseRevisionId: current.revisionId };
    const version = await designHistoryOperation(root, request);
    if (Array.isArray(version) || !('commitId' in version)) throw Error('Expected version');
    expect(await designHistoryOperation(root, request)).toEqual(version);
    expect((await read()).editing?.baseVersionId).toBe(version.commitId);
    return version;
  };
  const first = await checkpoint();
  await save('#ff0000');
  const second = await checkpoint();
  const beforeSwitch = await read();
  const select = {
    operation: 'history-restore',
    sessionId,
    commitId: first.commitId,
    baseRevisionId: beforeSwitch.revisionId,
  };
  await designHistoryOperation(root, select);
  expect((await read()).doc).toEqual(initial.doc);
  expect((await read()).editing?.baseVersionId).toBe(first.commitId);
  expect(await checkpoint()).toEqual(first);
  await save('#0000ff');
  const third = await checkpoint();
  expect(third.baseVersionId).toBe(first.commitId);
  expect(second.baseVersionId).toBe(first.commitId);
  const versions = await designHistoryOperation(root, { operation: 'history-list', sessionId });
  expect(versions).toEqual([first, second, third]);
  await expect(designHistoryOperation(root, select)).rejects.toThrow('DESIGN_CONFLICT');
  expect((await read()).editing?.baseVersionId).toBe(third.commitId);
});

test('a queued version save rejects a snapshot superseded by another instance restoring history', async () => {
  const { root, sessionId, initial, save } = await fixture();
  const version = await designHistoryOperation(root, {
    operation: 'history-create',
    sessionId,
    baseRevisionId: initial.revisionId,
  });
  if (Array.isArray(version) || !('commitId' in version)) throw Error('Expected version');
  const red = await save('#ff0000');
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const holder = withDesignLock(
    path.join(root, 'chats', sessionId, 'history.git'),
    {},
    async () => {
      held.resolve();
      await release.promise;
    }
  );
  await held.promise;
  const queued = designHistoryOperation(
    root,
    {
      operation: 'history-create',
      sessionId,
      baseRevisionId: red.revisionId,
    },
    {
      lock: {
        now: () => 0,
        sleep: () => {
          waiting.resolve();
          return resume.promise;
        },
      },
    }
  );
  const verdict = queued.then(
    () => 'unexpected success',
    (error: unknown) => (error instanceof Error ? error.message : 'unknown error')
  );
  try {
    await waiting.promise;
    release.resolve();
    await holder;
    await designHistoryOperation(root, {
      operation: 'history-restore',
      sessionId,
      commitId: version.commitId,
      baseRevisionId: red.revisionId,
    });
  } finally {
    release.resolve();
    resume.resolve();
    await holder;
  }
  expect(await verdict).toBe('DESIGN_CONFLICT');
  expect((await designOperation(root, { operation: 'read', sessionId })).doc).toEqual(initial.doc);
  const versions = await designHistoryOperation(root, { operation: 'history-list', sessionId });
  if (!Array.isArray(versions)) throw Error('Expected versions');
  expect(versions.map((v) => v.kind)).toEqual(['saved', 'before-restore']);
  const protectedVersion = versions[1];
  if (!protectedVersion) throw Error('Expected protected current work');
  const retained = await designHistoryOperation(root, {
    operation: 'history-read',
    sessionId,
    commitId: protectedVersion.commitId,
  });
  expect(retained).toMatchObject({ doc: red.doc });
});

test('retry after Git publication without base binding reuses the saved version', async () => {
  const { root, sessionId, initial, save } = await fixture();
  const file = path.join(root, 'chats', sessionId, 'design.json');
  const initialBytes = await readFile(file);
  const request = { operation: 'history-create', sessionId, baseRevisionId: initial.revisionId };
  const first = await designHistoryOperation(root, request);
  // Recreate the durable boundary: Git published, canonical binding not yet written.
  await writeFile(file, initialBytes);
  expect(await designHistoryOperation(root, request)).toEqual(first);
  expect(await designHistoryOperation(root, { operation: 'history-list', sessionId })).toEqual([
    first,
  ]);
  await save('#ff0000');
  await expect(designHistoryOperation(root, request)).rejects.toThrow('DESIGN_CONFLICT');
});
