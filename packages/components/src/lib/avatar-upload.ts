import {
  AVATAR_ALLOWED_EXTENSIONS,
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_SIZE_BYTES,
} from '@molly/shared';
import { getFileExtension } from '@/lib/session-image-upload';

const allowedExtensionSet = new Set<string>(AVATAR_ALLOWED_EXTENSIONS);
const allowedMimeTypeSet = new Set<string>(AVATAR_ALLOWED_MIME_TYPES);

export const AVATAR_ACCEPT = [
  ...AVATAR_ALLOWED_MIME_TYPES,
  ...AVATAR_ALLOWED_EXTENSIONS.map((extension) => `.${extension}`),
].join(',');

export const validateAvatarFile = (file: File): string | null => {
  const extension = getFileExtension(file.name);
  if (extension && !allowedExtensionSet.has(extension)) {
    return `Unsupported file extension: ${file.name}`;
  }

  const mimeType = file.type.trim().toLowerCase();
  if (!allowedMimeTypeSet.has(mimeType)) {
    return `Unsupported image type: ${mimeType || 'unknown'}`;
  }

  if (file.size > AVATAR_MAX_SIZE_BYTES) {
    return `Image must be <= ${Math.floor(AVATAR_MAX_SIZE_BYTES / (1024 * 1024))}MB`;
  }

  if (file.size <= 0) {
    return 'Image is empty';
  }

  return null;
};
