import { useEffect, useSyncExternalStore } from 'react';
import { getIpcServices, onIpcEvent } from '@/lib/electron-ipc-client';

/**
 * Sidebar artwork thumbnails (designer UI phase 5). Electron owns the derived
 * cache and refreshes it when the person leaves the canvas or an Agent turn's
 * processing ends, then pushes `design.thumbnail`. This keeps one image per
 * artwork for the renderer's lifetime so virtualized rows remount without an
 * IPC round trip. A push for an artwork with no mounted row only marks it
 * stale: hidden sidebars unmount their rows, and the next mount re-reads.
 */
const thumbnails = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
const current = new Set<string>();

function request(artworkId: string) {
  const design = getIpcServices()?.design;
  if (!design) return;
  current.add(artworkId);
  void design.thumbnail(artworkId).then(
    (dataUrl) => {
      thumbnails.set(artworkId, dataUrl);
      for (const listener of listeners.get(artworkId) ?? []) listener();
    },
    () => current.delete(artworkId)
  );
}

function subscribe(artworkId: string, listener: () => void) {
  const set = listeners.get(artworkId) ?? new Set();
  set.add(listener);
  listeners.set(artworkId, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(artworkId);
  };
}

let refreshSubscription: (() => void) | undefined;
function followRefreshes() {
  refreshSubscription ??= onIpcEvent('design.thumbnail', ({ artworkId }) => {
    current.delete(artworkId);
    if (listeners.has(artworkId)) request(artworkId);
  });
}

/** The last saved revision of `artworkId` as an image URL, or undefined until one is ready. */
export function useDesignThumbnail(artworkId: string): string | undefined {
  const src = useSyncExternalStore(
    (listener) => subscribe(artworkId, listener),
    () => thumbnails.get(artworkId)
  );
  useEffect(() => {
    followRefreshes();
    if (!current.has(artworkId)) request(artworkId);
  }, [artworkId]);
  return src;
}
