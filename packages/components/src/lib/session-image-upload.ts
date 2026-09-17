import {
  SESSION_IMAGE_ALLOWED_EXTENSIONS,
  SESSION_IMAGE_ALLOWED_MIME_TYPES,
  SESSION_IMAGE_MAX_SIZE_BYTES,
  type SessionId,
  type WorkspaceId,
} from '@molly/shared';
import { sendSessionFileToLocalRuntime } from './electron-session-file-sender';
import type { SessionFilePayload } from '@molly/shared';

const allowedExtensionSet = new Set<string>(SESSION_IMAGE_ALLOWED_EXTENSIONS);
const allowedMimeTypeSet = new Set<string>(SESSION_IMAGE_ALLOWED_MIME_TYPES);

export const SESSION_IMAGE_ACCEPT = [
  ...SESSION_IMAGE_ALLOWED_MIME_TYPES,
  ...SESSION_IMAGE_ALLOWED_EXTENSIONS.map((extension) => `.${extension}`),
].join(',');

export const getFileExtension = (fileName: string): string => {
  const trimmed = fileName.trim().toLowerCase();
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === trimmed.length - 1) {
    return '';
  }
  return trimmed.slice(dotIndex + 1);
};

export const validateSessionImageFile = (file: File): string | null => {
  const extension = getFileExtension(file.name);
  if (extension && !allowedExtensionSet.has(extension)) {
    return `Unsupported file extension: ${file.name}`;
  }

  const mimeType = file.type.trim().toLowerCase();
  if (!allowedMimeTypeSet.has(mimeType)) {
    return `Unsupported image type: ${mimeType || 'unknown'}`;
  }

  if (file.size > SESSION_IMAGE_MAX_SIZE_BYTES) {
    return `Image must be <= ${Math.floor(SESSION_IMAGE_MAX_SIZE_BYTES / (1024 * 1024))}MB`;
  }

  if (file.size <= 0) {
    return 'Image is empty';
  }

  return null;
};

/** Local image inputs use the existing file blob transport and retain image drafts. */
export async function uploadSessionReferenceImage(args: {
  workspaceId: WorkspaceId;
  sessionId: SessionId;
  localMachineId?: string;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<SessionFilePayload> {
  if (!args.localMachineId) throw new Error('Local attachment transport unavailable');
  const outcome = await sendSessionFileToLocalRuntime({
    ...args,
    machineId: args.localMachineId,
  });
  if (!outcome?.ok || !outcome.files[0]) {
    throw new Error(outcome && !outcome.ok ? outcome.error : 'Local attachment unavailable');
  }
  return { ...outcome.files[0], storageSessionId: args.sessionId };
}
