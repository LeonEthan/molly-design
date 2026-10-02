import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getIpcServices, onIpcEvent } from '@/lib/electron-ipc-client';

/**
 * Sidebar artwork thumbnails (designer UI phase 5). Electron owns the derived
 * cache; this keeps one image per artwork for the renderer's lifetime so
 * virtualized rows can remount without another IPC round trip.
 */
const thumbnails = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
const requested = new Set<string>();

function publish(artworkId: string, dataUrl: string) {
  thumbnails.set(artworkId, dataUrl);
  for (const listener of listeners.get(artworkId) ?? []) listener();
}

function request(artworkId: string, refresh: boolean) {
  const design = getIpcServices()?.design;
  if (!design) return;
  void design.thumbnail(artworkId, refresh).then(
    (dataUrl) => publish(artworkId, dataUrl),
    () => requested.delete(artworkId)
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

let leaveSubscription: (() => void) | undefined;
function followCanvasLeaves() {
  leaveSubscription ??= onIpcEvent('design.thumbnail', ({ artworkId }) => {
    if (listeners.has(artworkId)) request(artworkId, false);
  });
}

/**
 * The last saved revision of `artworkId` as an image URL, or undefined until
 * one is ready. Re-checks the store when `isWorking` falls, i.e. after an
 * Agent turn; leaving the canvas refreshes through the `design.thumbnail` push.
 */
export function useDesignThumbnail(
  artworkId: string | undefined,
  isWorking: boolean
): string | undefined {
  const src = useSyncExternalStore(
    (listener) => (artworkId ? subscribe(artworkId, listener) : () => {}),
    () => (artworkId ? thumbnails.get(artworkId) : undefined)
  );
  useEffect(() => {
    if (!artworkId) return;
    followCanvasLeaves();
    if (requested.has(artworkId)) return;
    requested.add(artworkId);
    request(artworkId, false);
  }, [artworkId]);
  const wasWorking = useRef(isWorking);
  useEffect(() => {
    const finished = wasWorking.current && !isWorking;
    wasWorking.current = isWorking;
    if (finished && artworkId) request(artworkId, true);
  }, [artworkId, isWorking]);
  return src;
}
