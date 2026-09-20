import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
  unlink,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { HarnessImageImportRequestSchema } from '@molly/shared/embedded-harness';
import { importHarnessImages } from './harness-image-import';
import { resolveDesignWorkspace } from './workspace';
import { recoverHarnessImages } from './harness-image-recovery';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const sessionId = '00000000-0000-4000-8000-000000000001';
const artworkId = '00000000-0000-4000-8000-000000000002';
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-image-import-'));
  roots.push(root);
  const workspace = resolveDesignWorkspace({
    workspaceRoot: root,
    sessionId,
    artworkId,
    legacyWorkdir: path.join(root, 'input'),
  });
  await mkdir(workspace.artifactWorkdir, { recursive: true });
  const request = HarnessImageImportRequestSchema.parse({
    version: 1,
    runId: 'a'.repeat(64),
    runtimeEpoch: randomUUID(),
    productSessionId: sessionId,
    turnId: 'turn',
    connectionId: 'external',
    connectionRevision: 1,
    serverName: 'images',
    toolName: 'generate',
    toolCallId: 'call',
    requestDigest: 'b'.repeat(64),
    images: [{ mimeType: 'image/png', data: png }],
  });
  return {
    request,
    workspace,
    artworkId,
    operationDirectory: path.join(root, 'operations'),
    signal: new AbortController().signal,
  };
}

test('imports ordered host assets and keeps a byte-free operation intent without committing artwork', async () => {
  const input = await fixture();
  input.request.images.push(input.request.images[0]);
  const result = await importHarnessImages(input);
  const sha256 = createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex');
  expect(result.assets.map((asset) => asset.sha256)).toEqual([sha256, sha256]);
  await expect(readFile(result.assets[0].absolutePath)).resolves.toEqual(
    Buffer.from(png, 'base64')
  );
  expect(await readdir(input.workspace.artifactWorkdir)).toEqual(['media']);
  const [intentName] = await readdir(input.operationDirectory);
  const intentText = await readFile(path.join(input.operationDirectory, intentName), 'utf8');
  expect(intentText).not.toContain(png);
  expect(intentText).not.toContain(input.workspace.artifactWorkdir);
  expect(JSON.parse(intentText)).toMatchObject({
    artworkId,
    identity: { runId: input.request.runId },
    expectedAssets: [{ sha256 }, { sha256 }],
  });
  await expect(importHarnessImages(input)).resolves.toEqual(result);
  input.request.connectionRevision++;
  await expect(importHarnessImages(input)).rejects.toThrow('harness_image_import_conflict');
});

test.each(['mime', 'encoding', 'damaged-pixels', 'cancelled'] as const)(
  'preflights the entire batch before any publication (%s)',
  async (mode) => {
    const input = await fixture();
    if (mode === 'mime') input.request.images.push({ mimeType: 'image/jpeg', data: png });
    if (mode === 'damaged-pixels')
      input.request.images.push({
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      });
    if (mode === 'encoding')
      input.request.images.push({ mimeType: 'image/png', data: png.slice(0, -1) });
    if (mode === 'cancelled') input.signal = AbortSignal.abort(new Error('cancelled'));
    await expect(importHarnessImages(input)).rejects.toThrow();
    expect(await readdir(input.workspace.artifactWorkdir)).toEqual([]);
    await expect(readdir(input.operationDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  }
);

test('refuses a redirected media directory and preserves its outside files', async () => {
  const input = await fixture();
  const outside = path.join(input.workspace.workspaceRoot, 'outside');
  await mkdir(outside);
  await symlink(outside, path.join(input.workspace.artifactWorkdir, 'media'));
  await expect(importHarnessImages(input)).rejects.toThrow();
  expect(await readdir(outside)).toEqual([]);
});

test.each([
  'available',
  'missing',
  'changed',
  'symlink',
  'foreign-session',
  'foreign-artwork',
  'cancelled',
] as const)(
  'recovers only verified owned bytes without publishing or settling anything (%s)',
  async (mode) => {
    const input = await fixture();
    const imported = await importHarnessImages(input);
    const [intentName] = await readdir(input.operationDirectory);
    const intentPath = path.join(input.operationDirectory, intentName);
    const originalIntent = await readFile(intentPath);
    const asset = imported.assets[0];
    const operationId = intentName.slice(0, 64);
    if (mode === 'missing') await unlink(asset.absolutePath);
    if (mode === 'changed') {
      const bytes = Buffer.from(png, 'base64');
      bytes[bytes.length - 1] ^= 1;
      await writeFile(asset.absolutePath, bytes);
    }
    if (mode === 'symlink') {
      const outside = path.join(input.workspace.workspaceRoot, 'foreign.png');
      await writeFile(outside, Buffer.from(png, 'base64'));
      await unlink(asset.absolutePath);
      await symlink(outside, asset.absolutePath);
    }
    const resolutions: string[] = [];
    const recovery = {
      sessionId: mode === 'foreign-session' ? randomUUID() : sessionId,
      artworkId: mode === 'foreign-artwork' ? randomUUID() : artworkId,
      operationDirectory: input.operationDirectory,
      signal: mode === 'cancelled' ? AbortSignal.abort(new Error('cancelled')) : input.signal,
      resolveWorkspace: async (turn: string) => {
        resolutions.push(turn);
        return input.workspace;
      },
    };
    if (mode.startsWith('foreign')) {
      await expect(recoverHarnessImages({ ...recovery, query: {} })).resolves.toEqual({
        kind: 'listed',
        operations: [],
      });
      await expect(recoverHarnessImages({ ...recovery, query: { operationId } })).rejects.toThrow(
        'harness_image_recovery_not_owned'
      );
      expect(resolutions).toEqual([]);
    } else if (mode === 'cancelled') {
      await expect(recoverHarnessImages({ ...recovery, query: { operationId } })).rejects.toThrow(
        'cancelled'
      );
      expect(resolutions).toEqual([]);
    } else {
      await expect(recoverHarnessImages({ ...recovery, query: {} })).resolves.toEqual({
        kind: 'listed',
        operations: [
          {
            operationId,
            sourceTurnId: 'turn',
            connectionId: 'external',
            connectionRevision: 1,
            toolName: 'generate',
            expectedAssets: 1,
          },
        ],
      });
      expect(resolutions).toEqual([]);
      await expect(recoverHarnessImages({ ...recovery, query: { operationId } })).resolves.toEqual({
        kind: 'verified',
        operationId,
        sourceTurnId: 'turn',
        assets:
          mode === 'available'
            ? [{ ...asset, absolutePath: await realpath(asset.absolutePath) }]
            : [],
        unavailable:
          mode === 'available'
            ? []
            : [{ path: asset.path, reason: mode === 'symlink' ? 'unsafe' : mode }],
      });
      expect(resolutions).toEqual(['turn']);
    }
    expect(await readdir(input.operationDirectory)).toEqual([intentName]);
    expect(await readFile(intentPath)).toEqual(originalIntent);
    expect(await readdir(input.workspace.artifactWorkdir)).toEqual(['media']);
  }
);

test('pages import intents, skips malformed records, and never verifies files during listing', async () => {
  const input = await fixture();
  const imported = await importHarnessImages(input);
  for (let i = 1; i < 23; i++)
    await importHarnessImages({ ...input, request: { ...input.request, toolCallId: `call-${i}` } });
  await writeFile(
    path.join(input.operationDirectory, `${'0'.repeat(64)}.images.json`),
    'malformed'
  );
  await unlink(imported.assets[0].absolutePath);
  const recovery = {
    sessionId,
    artworkId,
    operationDirectory: input.operationDirectory,
    signal: input.signal,
    resolveWorkspace: async () => {
      throw new Error('listing must not resolve file paths');
    },
  };
  const first = await recoverHarnessImages({ ...recovery, query: {} });
  expect(first.kind).toBe('listed');
  if (first.kind !== 'listed') throw new Error('expected list');
  expect(first.operations).toHaveLength(20);
  expect(first.nextCursor).toBeDefined();
  const second = await recoverHarnessImages({ ...recovery, query: { cursor: first.nextCursor } });
  if (second.kind !== 'listed') throw new Error('expected list');
  expect(second.operations).toHaveLength(3);
  expect(second.nextCursor).toBeUndefined();
  expect(
    new Set([...first.operations, ...second.operations].map((entry) => entry.operationId)).size
  ).toBe(23);
});

test('rejects a forged intent identity or redirected receipt without creating directories', async () => {
  const input = await fixture();
  const recovery = {
    sessionId,
    artworkId,
    query: {},
    operationDirectory: input.operationDirectory,
    signal: input.signal,
    resolveWorkspace: async () => input.workspace,
  };
  await expect(recoverHarnessImages(recovery)).resolves.toEqual({ kind: 'listed', operations: [] });
  await expect(readdir(input.operationDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  await importHarnessImages(input);
  const [name] = await readdir(input.operationDirectory);
  const file = path.join(input.operationDirectory, name);
  const intent = JSON.parse(await readFile(file, 'utf8'));
  intent.identity.toolCallId = 'forged';
  await writeFile(file, JSON.stringify(intent));
  await expect(
    recoverHarnessImages({ ...recovery, query: { operationId: name.slice(0, 64) } })
  ).rejects.toThrow();
  await expect(recoverHarnessImages(recovery)).resolves.toEqual({ kind: 'listed', operations: [] });
});
