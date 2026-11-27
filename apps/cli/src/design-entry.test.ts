import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('worker returns compact recovery replies and preserves the persisted revision on projection errors', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-design-worker-'));
  const sessionId = randomUUID();
  const directory = path.join(root, 'chats', sessionId);
  const projection = path.join(directory, 'design-current');
  const request = (frames: unknown[]) => {
    const reply = spawnSync(process.execPath, ['--import', 'tsx', 'src/design-entry.ts'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...process.env, MOLLY_DATA_DIR: root, MOLLY_ISOLATED_DATA_ROOT_STRICT: '1' },
      input: frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n',
      encoding: 'utf8',
    });
    expect(reply.status, reply.stderr).toBe(0);
    return reply.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  };
  try {
    const pending = { operation: 'pending-associations', readOnly: true };
    expect(request([pending])).toEqual([{ ok: true, value: { items: [], nextCursor: null } }]);
    expect(await readdir(root)).toEqual([]);
    await mkdir(directory, { recursive: true });
    await symlink(root, projection, 'dir');
    const association = {
      sessionId,
      name: 'test',
      userId: 'user',
      machineId: 'machine',
      createdAt: '2026-09-09T00:00:00.000Z',
    };
    const [create, page, ack] = request([
      { operation: 'create', association },
      pending,
      { operation: 'acknowledge', sessionId, verifyProjection: true },
    ]);
    const revisionId = createHash('sha256')
      .update(await readFile(path.join(directory, 'design.json')))
      .digest('hex');
    expect(create).toMatchObject({ ok: false, code: 'DESIGN_PROJECTION_PENDING', revisionId });
    expect(page).toEqual({
      ok: true,
      value: {
        items: [{ sessionId, association, revisionId, projectionStale: true }],
        nextCursor: null,
      },
    });
    expect(ack).toMatchObject({ ok: false });
    await rm(projection);
    expect(
      request([
        { operation: 'repair-projection', sessionId },
        { operation: 'history-list', sessionId, readOnly: true },
        { operation: 'acknowledge', sessionId, verifyProjection: true },
        pending,
      ])
    ).toEqual([
      { ok: true, value: { sessionId, revisionId } },
      { ok: true, value: [] },
      { ok: true, value: null },
      { ok: true, value: { items: [], nextCursor: null } },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
