import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDesignContinuationReference,
  type DesignContinuationRecord,
  type SessionHistoryInput,
} from '@molly/shared';
import { getSessionFileBlobPath } from '@/lib/session-file-blob-store';
import {
  inspectDesignContinuationAttachments,
  readDesignContinuationAttachment,
} from './design-continuation-attachments';

const bytes = Buffer.from('Synthetic historical attachment');
const sha256 = createHash('sha256').update(bytes).digest('hex');

function fixture(storageSessionId?: string) {
  const file = {
    type: 'file' as const,
    fileId: 'file-1',
    fileName: '../../untrusted-name.txt',
    mimeType: 'text/plain',
    sizeBytes: bytes.length,
    sha256,
    transport: 'local' as const,
    machineId: 'machine-1',
    uploadedAt: 1,
    textPreview: true,
    ...(storageSessionId ? { storageSessionId } : {}),
  };
  const history: SessionHistoryInput[] = [
    {
      id: 'turn-1',
      role: 'user',
      status: 'handled',
      timestamp: '2026-09-20T00:00:00.000Z',
      fileDiff: [],
      items: [file],
    },
  ];
  const record: DesignContinuationRecord = {
    version: 1,
    workspaceId: 'workspace-1',
    source: {
      id: 'source-1',
      machineId: 'machine-1',
      userId: 'local:user',
      cliType: 'builtin',
      agentType: 'codex',
      design: { artworkId: 'artwork-1', path: 'design.json' },
    },
    target: {
      sessionId: '10000000-0000-4000-8000-000000000001',
      agentConfigId: 'molly-config',
      createdAt: '2026-09-20T00:00:00.000Z',
    },
    reference: buildDesignContinuationReference({
      source: { sessionId: 'source-1', machineId: 'machine-1', artworkId: 'artwork-1' },
      history,
    }),
  };
  return { file, history, record };
}

describe('design continuation attachment preflight', () => {
  it('projects the exact original storage identity without copying old source paths', () => {
    const f = fixture('original-fork-storage');
    Object.assign(f.file, { sourcePath: 'old/reference.txt' });
    const candidate = f.record.reference.attachmentCandidates[0];
    if (!candidate) throw Error('missing candidate');
    const projected = readDesignContinuationAttachment(f.record, candidate, f.history);
    expect(projected).toEqual({ ...f.file, sourcePath: undefined });
    expect(projected).not.toHaveProperty('sourcePath');
    expect(projected?.storageSessionId).toBe('original-fork-storage');
  });
  let homeDir: string;
  beforeEach(async () => {
    homeDir = await mkdtemp(path.join(tmpdir(), 'molly-continuation-attachment-'));
    vi.stubEnv('MOLLY_DATA_DIR', path.join(homeDir, '.molly'));
    vi.stubEnv('MOLLY_PLATFORM', 'local');
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(homeDir, { recursive: true, force: true });
  });
  const blobPath = (sessionId = 'source-1') =>
    getSessionFileBlobPath({ workspaceId: 'workspace-1', sessionId, fileId: 'file-1', homeDir });
  const stage = async (sessionId = 'source-1', content = bytes) => {
    const blob = blobPath(sessionId);
    await mkdir(path.dirname(blob), { recursive: true });
    await writeFile(blob, content);
    return blob;
  };
  const inspect = (f: ReturnType<typeof fixture>) =>
    inspectDesignContinuationAttachments({
      record: f.record,
      readHistory: () => f.history,
      homeDir,
    });

  it.each([undefined, 'original-fork-storage'])(
    'checks bytes in the exact namespace: %s',
    async (storage) => {
      const f = fixture(storage);
      const before = structuredClone(f);
      const blob = await stage(storage);
      expect(await inspect(f)).toEqual([
        { sourceTurnId: 'turn-1', fileId: 'file-1', status: 'available' },
      ]);
      expect(f).toEqual(before);
      expect(await readFile(blob)).toEqual(bytes);
    }
  );

  it.each(['missing', 'wrong-size', 'wrong-hash'] as const)(
    'reports unavailable bytes: %s',
    async (kind) => {
      const f = fixture();
      if (kind === 'wrong-size') await stage('source-1', Buffer.from('short'));
      if (kind === 'wrong-hash') await stage('source-1', Buffer.alloc(bytes.length, 120));
      expect(await inspect(f)).toEqual([
        {
          sourceTurnId: 'turn-1',
          fileId: 'file-1',
          status: 'unavailable',
          reason: kind === 'missing' ? 'missing' : 'integrity_mismatch',
        },
      ]);
    }
  );

  it.each([
    'removed',
    'machine',
    'storage',
    'hash',
    'name',
    'mime',
    'size',
    'assistant',
    'pending',
    'duplicate-turn',
  ] as const)('rejects changed history before trusting retained bytes: %s', async (kind) => {
    const f = fixture();
    await stage();
    if (kind === 'removed') f.history.length = 0;
    if (kind === 'machine') f.file.machineId = 'other-machine';
    if (kind === 'storage') f.file.storageSessionId = 'other-storage';
    if (kind === 'hash') f.file.sha256 = 'a'.repeat(64);
    if (kind === 'name') f.file.fileName = 'different.txt';
    if (kind === 'mime') f.file.mimeType = 'image/png';
    if (kind === 'size') f.file.sizeBytes += 1;
    const first = f.history[0];
    if (first && kind === 'assistant')
      f.history = [{ ...first, role: 'assistant', finished: true } as SessionHistoryInput];
    if (first && kind === 'pending')
      f.history = [{ ...first, status: 'pending' } as SessionHistoryInput];
    if (first && kind === 'duplicate-turn') f.history.push(structuredClone(first));
    expect(await inspect(f)).toEqual([
      {
        sourceTurnId: 'turn-1',
        fileId: 'file-1',
        status: 'unavailable',
        reason: 'history_changed',
      },
    ]);
  });

  it('rechecks history after asynchronous filesystem work', async () => {
    const f = fixture();
    await stage();
    let history = f.history;
    const results = await inspectDesignContinuationAttachments({
      record: f.record,
      homeDir,
      readHistory: () => {
        const snapshot = history;
        history = [];
        return snapshot;
      },
    });
    expect(results[0]).toMatchObject({ status: 'unavailable', reason: 'history_changed' });
  });

  it.each(['file-link', 'parent-link', 'directory'] as const)(
    'rejects an unsafe local entry: %s',
    async (kind) => {
      const f = fixture();
      const blob = blobPath();
      const external = path.join(homeDir, 'outside-store');
      await mkdir(external);
      await writeFile(path.join(external, 'file-1'), bytes);
      if (kind === 'parent-link') {
        await mkdir(path.dirname(path.dirname(blob)), { recursive: true });
        await symlink(external, path.dirname(blob));
      } else {
        await mkdir(path.dirname(blob), { recursive: true });
        if (kind === 'file-link') await symlink(path.join(external, 'file-1'), blob);
        else await mkdir(blob);
      }
      expect(await inspect(f)).toEqual([
        {
          sourceTurnId: 'turn-1',
          fileId: 'file-1',
          status: 'unavailable',
          reason: 'unsafe_path',
        },
      ]);
      expect(await readFile(path.join(external, 'file-1'))).toEqual(bytes);
    }
  );

  it('does not recover a missing fork blob from the source or target namespace', async () => {
    const f = fixture('missing-original');
    await stage();
    await stage(f.record.target.sessionId);
    expect((await inspect(f))[0]).toMatchObject({ status: 'unavailable', reason: 'missing' });
  });

  it('rejects a corrupt receipt without using its history reader', async () => {
    const f = fixture();
    const invalid = { ...f.record, version: 2 } as unknown as DesignContinuationRecord;
    await expect(
      inspectDesignContinuationAttachments({
        record: invalid,
        homeDir,
        readHistory: () => {
          throw new Error('must not read history');
        },
      })
    ).rejects.toThrow('invalid_design_continuation_record');
  });
});
