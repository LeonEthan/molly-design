import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { ARTWORK_ENTRY, collectAuthoring, intakeAuthoring } from '@molly/design-authoring';
import { designOperation } from './store';
import { resolveDesignWorkspace } from './workspace';

const faults = vi.hoisted(() => ({ publish: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    rename: async (from: string, to: string) => {
      if (faults.publish && path.basename(to) === 'design-current') {
        faults.publish = false;
        throw Error('Synthetic publication failure after old directory rename');
      }
      return original.rename(from, to);
    },
  };
});
const roots: string[] = [];
afterEach(async () => {
  faults.publish = false;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function create() {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-save-projection-'));
  roots.push(root);
  const id = randomUUID();
  const payload = await designOperation(root, {
    operation: 'create',
    association: {
      sessionId: id,
      name: 'Synthetic',
      userId: 'local:test',
      machineId: 'test',
      createdAt: '2026-09-12T00:00:00Z',
    },
  });
  const directory = path.join(root, 'chats', id);
  return { root, id, payload, directory, projection: path.join(directory, 'design-current') };
}
it('create and human saves publish YAML artwork projection without an Agent and preserve drafts', async () => {
  const { root, id, payload, directory, projection } = await create();
  await writeFile(path.join(directory, ARTWORK_ENTRY), 'unfinished yaml draft');
  await writeFile(path.join(directory, 'design.pptd'), 'leftover pptd draft');
  const content = {
    doc: { ...payload.doc, background: { type: 'solid', color: '#123456' } },
    assets: payload.assets,
  };
  const saved = await designOperation(root, {
    operation: 'save',
    sessionId: id,
    baseRevisionId: payload.revisionId,
    content,
  });
  expect(
    JSON.parse(await readFile(path.join(projection, '.molly-current.json'), 'utf8')).revisionId
  ).toBe(saved.revisionId);
  expect(await readFile(path.join(projection, ARTWORK_ENTRY), 'utf8')).toContain('molly-canvas/1');
  expect(await readFile(path.join(projection, ARTWORK_ENTRY), 'utf8')).toContain('#123456');
  expect(await readFile(path.join(directory, ARTWORK_ENTRY), 'utf8')).toBe('unfinished yaml draft');
  expect(await readFile(path.join(directory, 'design.pptd'), 'utf8')).toBe('leftover pptd draft');
  expect(
    resolveDesignWorkspace({
      workspaceRoot: '/project',
      sessionId: randomUUID(),
      artworkId: id,
      legacyWorkdir: path.join(root, 'chats', randomUUID()),
    }).projectionWorkdir
  ).toBe(projection);
});
it('publication failure preserves canonical, blocks stale dispatch and is repaired by exact retry', async () => {
  const { root, id, payload, directory, projection } = await create();
  const content = {
    doc: { ...payload.doc, background: { type: 'solid', color: '#223344' } },
    assets: payload.assets,
  };
  const request = { operation: 'save', sessionId: id, baseRevisionId: payload.revisionId, content };
  faults.publish = true;
  await expect(designOperation(root, request)).rejects.toThrow('DESIGN_PROJECTION_FAILED');
  expect(
    JSON.parse(await readFile(path.join(directory, 'design.json'), 'utf8')).doc.background.color
  ).toBe('#223344');
  await expect(
    designOperation(root, { operation: 'read', sessionId: id }, { projection: 'verify' })
  ).rejects.toThrow('DESIGN_PROJECTION_NOT_READY');
  const recovered = await designOperation(root, request);
  expect(recovered.revisionId).not.toBe(payload.revisionId);
  expect(await readFile(path.join(projection, ARTWORK_ENTRY), 'utf8')).toContain('#223344');
});
it('reopen verifies actual files even with an intact marker, then repairs from canonical', async () => {
  const { root, id, payload, projection } = await create();
  await writeFile(path.join(projection, ARTWORK_ENTRY), 'replaced file');
  await expect(
    designOperation(root, { operation: 'read', sessionId: id }, { projection: 'verify' })
  ).rejects.toThrow('DESIGN_PROJECTION_NOT_READY');
  const reopened = await designOperation(root, { operation: 'read', sessionId: id });
  expect(reopened.revisionId).toBe(payload.revisionId);
  expect(await readFile(path.join(projection, ARTWORK_ENTRY), 'utf8')).toContain('#ffffff');
  await rm(path.join(projection, ARTWORK_ENTRY));
  expect((await designOperation(root, { operation: 'read', sessionId: id })).revisionId).toBe(
    payload.revisionId
  );
});

it('publishes lossless referenced assets from a self-contained human canvas save', async () => {
  const { root, id, payload, projection } = await create();
  const fixture = JSON.parse(
    await readFile(
      new URL('../../../../packages/design-bento/sample.json', import.meta.url),
      'utf8'
    )
  );
  const saved = await designOperation(root, {
    operation: 'save',
    sessionId: id,
    baseRevisionId: payload.revisionId,
    content: fixture,
  });
  const files = collectAuthoring(projection);
  const imported = intakeAuthoring(ARTWORK_ENTRY, files);
  if (imported.status !== 'ok') throw Error(JSON.stringify(imported));
  expect(imported.document).toEqual(saved.doc);
  const exportedAssets = new Map([...files].filter(([file]) => file.startsWith('media/')));
  expect(exportedAssets.size).toBeGreaterThan(0);
  for (const [hash, uri] of Object.entries(saved.assets)) {
    expect(
      [...exportedAssets].some(
        ([file, bytes]) =>
          file.includes(hash) &&
          Buffer.from(bytes).equals(Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'))
      )
    ).toBe(true);
  }
});

it('rebuilds an old two-file current projection without altering canonical, drafts or frozen receipts', async () => {
  const { root, id, payload, directory, projection } = await create();
  const canonicalBefore = await readFile(path.join(directory, 'design.json'));
  const files = [
    ['design.yaml', 'size: [800, 600]\npages: [pages/canvas.yaml]\n'],
    ['pages/canvas.yaml', 'elements: []\n'],
  ];
  for (const base of [projection, directory]) {
    await mkdir(path.join(base, 'pages'), { recursive: true });
    for (const [file, bytes] of files) await writeFile(path.join(base, file!), bytes!);
  }
  await writeFile(
    path.join(projection, '.molly-current.json'),
    JSON.stringify({
      revisionId: payload.revisionId,
      files: files.map(([file, bytes]) => [
        file,
        createHash('sha256').update(bytes!).digest('hex'),
      ]),
    })
  );
  const frozen = path.join(directory, 'design-input/frozen');
  await mkdir(frozen, { recursive: true });
  for (const file of ['manifest.json', 'receipt.json'])
    await writeFile(path.join(frozen, file), 'synthetic frozen evidence');
  await expect(
    designOperation(root, { operation: 'read', sessionId: id }, { projection: 'verify' })
  ).rejects.toThrow('DESIGN_PROJECTION_NOT_READY');
  const reopened = await designOperation(root, { operation: 'read', sessionId: id });
  expect(reopened.revisionId).toBe(payload.revisionId);
  expect(await readFile(path.join(directory, 'design.json'))).toEqual(canonicalBefore);
  expect([...collectAuthoring(projection).keys()]).toEqual(['design.yaml']);
  expect(intakeAuthoring('design.yaml', collectAuthoring(projection))).toMatchObject({
    status: 'ok',
    document: payload.doc,
  });
  for (const [file, bytes] of files)
    expect(await readFile(path.join(directory, file!), 'utf8')).toBe(bytes);
  for (const file of ['manifest.json', 'receipt.json'])
    expect(await readFile(path.join(frozen, file), 'utf8')).toBe('synthetic frozen evidence');
});
