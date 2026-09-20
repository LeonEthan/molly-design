import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  DesignContinuationRecordSchema,
  SessionFileBlockSchema,
  type DesignContinuationAttachment,
  type DesignContinuationRecord,
  type DesignContinuationAttachmentInspection,
  type SessionHistoryInput,
  type SessionFilePayload,
  type SessionId,
} from '@molly/shared';
import { getSessionFileBlobPath, getSessionFilesRoot } from '@/lib/session-file-blob-store';

type AttachmentAvailability =
  | { status: 'available' }
  | {
      status: 'unavailable';
      reason: Extract<DesignContinuationAttachmentInspection, { status: 'unavailable' }>['reason'];
    };

export function readDesignContinuationAttachment(
  record: DesignContinuationRecord,
  candidate: DesignContinuationAttachment,
  history: readonly SessionHistoryInput[]
): SessionFilePayload | undefined {
  const turns = history.filter((turn) => turn.id === candidate.sourceTurnId);
  const turn = turns[0];
  if (turns.length !== 1 || turn?.role !== 'user' || turn.status !== 'handled') return undefined;
  for (const item of turn.items ?? []) {
    if (item.type !== 'file') continue;
    const parsed = SessionFileBlockSchema.safeParse(item);
    if (!parsed.success) continue;
    const file = parsed.data;
    if (
      file.transport === 'local' &&
      file.machineId === record.source.machineId &&
      (file.storageSessionId ?? record.source.id) === candidate.storageSessionId &&
      file.fileId === candidate.fileId &&
      file.fileName === candidate.fileName &&
      file.mimeType === candidate.mimeType &&
      file.sizeBytes === candidate.sizeBytes &&
      file.sha256 === candidate.sha256
    ) {
      // Copy only the public attachment identity. A historical sourcePath is
      // neither a new file-read grant nor an Agent workspace destination.
      return {
        type: 'file',
        fileId: file.fileId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        transport: 'local',
        machineId: candidate.machineId,
        uploadedAt: file.uploadedAt,
        textPreview: file.textPreview,
        storageSessionId: candidate.storageSessionId as SessionId,
      };
    }
  }
  return undefined;
}

/** Read-only preflight, not a durable byte capability or a replacement for dispatch validation. */
export async function inspectDesignContinuationAttachments(args: {
  record: DesignContinuationRecord;
  readHistory: () => readonly SessionHistoryInput[];
  homeDir?: string;
}): Promise<DesignContinuationAttachmentInspection[]> {
  const parsed = DesignContinuationRecordSchema.safeParse(args.record);
  if (!parsed.success) throw new Error('invalid_design_continuation_record');
  const record = parsed.data;
  if (record.reference.attachmentCandidates.length === 0) return [];
  const before = args.readHistory();
  const results: DesignContinuationAttachmentInspection[] = [];
  for (const candidate of record.reference.attachmentCandidates) {
    const identity = { sourceTurnId: candidate.sourceTurnId, fileId: candidate.fileId };
    if (!readDesignContinuationAttachment(record, candidate, before)) {
      results.push({ ...identity, status: 'unavailable', reason: 'history_changed' });
      continue;
    }
    const result = await inspectBlob(record.workspaceId, candidate, args.homeDir);
    results.push({ ...identity, ...result });
  }
  // Two snapshots, not a full source-history read for every attachment.
  const after = args.readHistory();
  return results.map((result, index) => {
    const candidate = record.reference.attachmentCandidates[index];
    return candidate && readDesignContinuationAttachment(record, candidate, after)
      ? result
      : {
          sourceTurnId: result.sourceTurnId,
          fileId: result.fileId,
          status: 'unavailable',
          reason: 'history_changed',
        };
  });
}

async function inspectBlob(
  workspaceId: string,
  candidate: DesignContinuationAttachment,
  homeDir: string | undefined
): Promise<AttachmentAvailability> {
  const unavailable = (
    reason: 'missing' | 'unsafe_path' | 'integrity_mismatch' | 'unreadable'
  ) => ({ status: 'unavailable' as const, reason });
  try {
    // Use the existing local blob namespace, including a fork's original storage
    // Session. Neither fileName nor old sourcePath participates in path resolution.
    const blob = getSessionFileBlobPath({
      workspaceId,
      sessionId: candidate.storageSessionId,
      fileId: candidate.fileId,
      homeDir,
    });
    const root = getSessionFilesRoot(homeDir);
    const canonicalRoot = await realpath(root);
    const expectedParent = path.resolve(canonicalRoot, workspaceId, candidate.storageSessionId);
    if (
      !expectedParent.startsWith(canonicalRoot + path.sep) ||
      (await realpath(path.dirname(blob))) !== expectedParent
    )
      return unavailable('unsafe_path');
    // NONBLOCK prevents an unexpected FIFO from stalling before fstat rejects it.
    const handle = await open(
      blob,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return unavailable('unsafe_path');
      if (stat.size !== candidate.sizeBytes) return unavailable('integrity_mismatch');
      const hash = createHash('sha256');
      const buffer = Buffer.alloc(64 * 1024);
      let size = 0;
      for (;;) {
        // Even a concurrently growing file is bounded by the receipt size + 1.
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, candidate.sizeBytes - size + 1),
          null
        );
        if (!bytesRead) break;
        size += bytesRead;
        if (size > candidate.sizeBytes) return unavailable('integrity_mismatch');
        hash.update(buffer.subarray(0, bytesRead));
      }
      return size === candidate.sizeBytes && hash.digest('hex') === candidate.sha256
        ? { status: 'available' }
        : unavailable('integrity_mismatch');
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return unavailable('missing');
    if (code === 'ELOOP' || code === 'ENOTDIR') return unavailable('unsafe_path');
    return unavailable('unreadable');
  }
}
