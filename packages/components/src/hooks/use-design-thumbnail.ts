import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
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
let revision = 0;

function request(artworkId: string) {
  const design = getIpcServices()?.design;
  if (!design) return;
  current.add(artworkId);
  void design.thumbnail(artworkId).then(
    (dataUrl) => {
      thumbnails.set(artworkId, dataUrl);
      revision += 1;
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

/**
 * The last saved revision of `artworkId` as an image URL, `''` once known to be blank
 * (no elements), or undefined until one is ready.
 */
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

/** Thumbnails for a set of artworks at once, keyed by id; see `useDesignThumbnail` for values. */
export function useDesignThumbnails(artworkIds: readonly string[]): ReadonlyMap<string, string> {
  const key = artworkIds.join(',');
  const subscribeAll = useCallback(
    (listener: () => void) => {
      const releases = key ? key.split(',').map((artworkId) => subscribe(artworkId, listener)) : [];
      return () => releases.forEach((release) => release());
    },
    [key]
  );
  const seen = useSyncExternalStore(subscribeAll, () => revision);
  useEffect(() => {
    followRefreshes();
    for (const artworkId of key ? key.split(',') : []) if (!current.has(artworkId)) request(artworkId);
  }, [key]);
  return useMemo(() => {
    void seen;
    return new Map(
      (key ? key.split(',') : []).flatMap((artworkId) => {
        const src = thumbnails.get(artworkId);
        return src === undefined ? [] : [[artworkId, src] as const];
      })
    );
  }, [key, seen]);
}
