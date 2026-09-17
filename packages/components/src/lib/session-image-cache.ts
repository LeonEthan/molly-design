import {
  getSessionImageDownloadApiPath,
  getSessionImageThumbnailApiPath,
  SESSION_IMAGE_RESIZE_DEFAULT_WIDTH,
  type SessionId,
  type SessionImageResizeFit,
  type WorkspaceId,
} from '@molly/shared';

export type SessionImageLoadVariant = 'original' | 'thumbnail';

type LegacyHostedImageArgs = {
  workspaceId: WorkspaceId;
  sessionId: SessionId;
  imageId: string;
  /** Retained in the compatibility signature; cache reads never use it. */
  token?: string;
  variant?: SessionImageLoadVariant;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  thumbnailFit?: SessionImageResizeFit;
  thumbnailQuality?: number;
};

type CacheEntry = { blob: Blob; blobUrl: string; dataUrl?: string };

const PERSISTENT_CACHE_NAME = 'lody-session-image-v1';
const LEGACY_CACHE_LOOKUP_ORIGIN = 'https://legacy-cache.invalid';
const memoryCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CacheEntry>>();

const requestPath = (requestUrl: string): string => {
  const url = new URL(requestUrl);
  return `${url.pathname}${url.search}`;
};

const readLegacyCachedBlob = async (requestUrl: string): Promise<Blob | null> => {
  if (typeof window === 'undefined' || typeof window.caches === 'undefined') return null;
  try {
    const cache = await window.caches.open(PERSISTENT_CACHE_NAME);
    const direct = await cache.match(requestUrl);
    if (direct) return await direct.blob();

    // Older builds may have used a different product-cloud origin. Cache keys
    // remain owned by this Molly profile, so match the stable API path without
    // issuing a request to either origin.
    const expectedPath = requestPath(requestUrl);
    for (const request of await cache.keys()) {
      if (requestPath(request.url) !== expectedPath) continue;
      const response = await cache.match(request);
      if (response) return await response.blob();
    }
  } catch {
    // A missing or unreadable browser cache is an ordinary unavailable legacy asset.
  }
  return null;
};

const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Failed to encode cached image'));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to encode cached image'));
    reader.readAsDataURL(blob);
  });

const getEntry = async (args: LegacyHostedImageArgs): Promise<CacheEntry> => {
  const originalUrl = new URL(
    getSessionImageDownloadApiPath(args.workspaceId, args.sessionId, args.imageId),
    LEGACY_CACHE_LOOKUP_ORIGIN
  ).toString();
  const requestUrl =
    args.variant === 'thumbnail'
      ? new URL(
          getSessionImageThumbnailApiPath(args.workspaceId, args.sessionId, args.imageId, {
            width: args.thumbnailWidth ?? SESSION_IMAGE_RESIZE_DEFAULT_WIDTH,
            height: args.thumbnailHeight,
            fit: args.thumbnailFit,
            quality: args.thumbnailQuality,
          }),
          LEGACY_CACHE_LOOKUP_ORIGIN
        ).toString()
      : originalUrl;
  const key = requestPath(requestUrl);
  const cached = memoryCache.get(key);
  if (cached) return cached;
  const pending = inFlight.get(key);
  if (pending) return await pending;

  const load = (async () => {
    const blob =
      (await readLegacyCachedBlob(requestUrl)) ??
      (args.variant === 'thumbnail' ? await readLegacyCachedBlob(originalUrl) : null);
    if (!blob) throw new Error('Hosted image was not preserved in the local Molly cache');
    const entry = { blob, blobUrl: URL.createObjectURL(blob) };
    memoryCache.set(key, entry);
    return entry;
  })();
  inFlight.set(key, load);
  try {
    return await load;
  } finally {
    inFlight.delete(key);
  }
};

/** Read an old hosted image only from Molly's browser cache. */
export const getSessionImageBlobUrl = async (args: LegacyHostedImageArgs): Promise<string> =>
  (await getEntry(args)).blobUrl;

export const getSessionImageDataUrl = async (args: LegacyHostedImageArgs): Promise<string> => {
  const entry = await getEntry(args);
  if (entry.dataUrl) return entry.dataUrl;
  entry.dataUrl = await toDataUrl(entry.blob);
  return entry.dataUrl;
};
