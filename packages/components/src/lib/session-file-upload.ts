import {
  SESSION_FILE_MAX_SIZE_BYTES,
} from '@molly/shared';

/** File attachments accept every type; only empty and oversized files are rejected. */
export type SessionFileValidationError = 'empty' | 'too-large';
export const SESSION_FILE_MAX_SIZE_MB = Math.floor(SESSION_FILE_MAX_SIZE_BYTES / (1024 * 1024));

export const validateSessionFile = (file: File): SessionFileValidationError | null => {
  if (file.size <= 0) return 'empty';
  if (file.size > SESSION_FILE_MAX_SIZE_BYTES) return 'too-large';
  return null;
};

export type SessionFileTransferPhase = 'preparing' | 'uploading' | 'verifying';
export const isSessionFileTransferPhase = (status: string): status is SessionFileTransferPhase =>
  status === 'preparing' || status === 'uploading' || status === 'verifying';
