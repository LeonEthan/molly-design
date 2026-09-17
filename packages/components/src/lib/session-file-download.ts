import {
  SESSION_FILE_PREVIEW_FETCH_BYTES,
  type MachineId,
  type SessionFilePayload,
  type SessionId,
  type WorkspaceId,
} from '@molly/shared';
import { getIpcServices } from '@/lib/electron-ipc-client';
import type { LocalFilePreviewResource } from '@molly/shared/local-file-preview';

type FileFetchArgs = {
  workspaceId: WorkspaceId;
  sessionId: SessionId;
  fileId: string;
  token: string;
};

/**
 * Save/export a file's bytes for the user.
 *
 * Electron: bearer fetch → blob → synthetic `<a download>`. The
 *   server sets `Content-Disposition: attachment` + `nosniff`, so this never
 *   navigates the browser to user-controlled bytes.
 */
const saveSessionFileBlob = (blob: Blob, fileName: string, fileId: string): void => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName || fileId;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoke on the next tick so the click has a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
};

type LocalFileArgs = {
  machineId: MachineId;
  workspaceId: WorkspaceId;
  sessionId: SessionId;
  file: SessionFilePayload;
};

const resolveLocalSessionFile = async (args: LocalFileArgs): Promise<LocalFilePreviewResource> => {
  const ipc = getIpcServices();
  if (!ipc || (args.file.transport === 'local' && args.file.machineId !== args.machineId)) {
    throw new Error('Local attachment is unavailable on this machine');
  }
  const result = await ipc.machineRpc.previewFile({
    machineId: args.machineId,
    workspaceId: args.workspaceId,
    method: 'file/resolve-local',
    params: {
      v: 3,
      sessionId: args.sessionId,
      attachment: { fileId: args.file.fileId, sha256: args.file.sha256 },
    },
  });
  if (result.status !== 'resource') {
    throw new Error(result.status === 'error' ? result.message : 'Local attachment is unavailable');
  }
  return result;
};

export const downloadLocalSessionFile = async (args: LocalFileArgs): Promise<void> => {
  const resource = await resolveLocalSessionFile(args);
  if (resource.kind === 'text') {
    const parts: BlobPart[] = [];
    for (let start = 0; start < resource.sizeBytes; start += 64 * 1024) {
      const end = Math.min(resource.sizeBytes - 1, start + 64 * 1024 - 1);
      const response = await fetch(resource.url, {
        headers: { Range: `bytes=${start}-${end}` },
      });
      if (!response.ok) throw new Error(`Failed to download local file (${response.status})`);
      parts.push(await response.arrayBuffer());
    }
    saveSessionFileBlob(new Blob(parts), args.file.fileName, args.file.fileId);
    return;
  }
  const response = await fetch(resource.url);
  if (!response.ok) throw new Error(`Failed to download local file (${response.status})`);
  saveSessionFileBlob(await response.blob(), args.file.fileName, args.file.fileId);
};

export const downloadSessionFile = async (
  args: FileFetchArgs & { fileName: string; mimeType?: string }
): Promise<void> => {
  void args;
  throw new Error('Hosted attachment bytes are unavailable in local Molly');
};

export type SessionFilePreviewResult = {
  /** Raw source text of the fetched prefix (always the unmodified bytes). */
  text: string;
  /** True when only a bounded prefix was fetched and more bytes remain. */
  truncated: boolean;
  /** Bytes actually fetched for the preview. */
  fetchedBytes: number;
};

export const fetchLocalSessionFilePreview = async (
  args: LocalFileArgs
): Promise<SessionFilePreviewResult> => {
  const resource = await resolveLocalSessionFile(args);
  if (resource.kind !== 'text') throw new Error('This attachment has no text preview');
  const maxBytes = SESSION_FILE_PREVIEW_FETCH_BYTES;
  const parts: Uint8Array[] = [];
  let fetchedBytes = 0;
  for (let start = 0; start < Math.min(resource.sizeBytes, maxBytes); start += 64 * 1024) {
    const end = Math.min(resource.sizeBytes, maxBytes, start + 64 * 1024) - 1;
    const response = await fetch(resource.url, {
      headers: { Range: `bytes=${start}-${end}` },
    });
    if (!response.ok) throw new Error(`Local preview unavailable (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    parts.push(bytes);
    fetchedBytes += bytes.byteLength;
  }
  const bytes = new Uint8Array(fetchedBytes);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return {
    text: new TextDecoder('utf-8').decode(bytes),
    fetchedBytes,
    truncated: args.file.sizeBytes > fetchedBytes,
  };
};

/** Old hosted attachment metadata remains readable, but bytes have no local source. */
export const fetchSessionFilePreview = async (
  _args: FileFetchArgs & { sizeBytes: number; signal?: AbortSignal }
): Promise<SessionFilePreviewResult> => {
  throw new Error('Hosted attachment bytes are unavailable in local Molly');
};
