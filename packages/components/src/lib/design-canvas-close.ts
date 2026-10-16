import type { SessionId } from '@molly/shared';
import { getIpcServices } from '@/lib/electron-ipc-client';

type CanvasEntry = { consumers: Set<() => void>; closing: number; closed: boolean };

const entries = new Map<string, CanvasEntry>();

export type DesignCanvasLifecycle = {
  deleted(sessionId: SessionId): void;
  release(): void;
};

const noLifecycle: DesignCanvasLifecycle = { deleted() {}, release() {} };

function entryFor(sessionId: string): CanvasEntry {
  let entry = entries.get(sessionId);
  if (!entry) {
    entry = { consumers: new Set(), closing: 0, closed: false };
    entries.set(sessionId, entry);
  }
  return entry;
}

function pruneEntry(sessionId: string) {
  const entry = entries.get(sessionId);
  if (entry && entry.consumers.size === 0 && entry.closing === 0) entries.delete(sessionId);
}

export function isDesignCanvasRetired(sessionId: string): boolean {
  const entry = entries.get(sessionId);
  return !!entry && (entry.closing > 0 || entry.closed);
}

export function registerDesignCanvas(sessionId: string, onReopen: () => void): () => void {
  entryFor(sessionId).consumers.add(onReopen);
  return () => {
    const entry = entries.get(sessionId);
    if (!entry) return;
    entry.consumers.delete(onReopen);
    pruneEntry(sessionId);
  };
}

function createLifecycle(sessionIds: readonly SessionId[]): DesignCanvasLifecycle {
  const deletedIds = new Set<string>();
  let released = false;
  for (const sessionId of sessionIds) entryFor(sessionId).closing++;
  return {
    deleted(sessionId) {
      deletedIds.add(sessionId);
      const entry = entries.get(sessionId);
      if (entry) entry.closed = true;
    },
    release() {
      if (released) return;
      released = true;
      for (const sessionId of sessionIds) {
        const entry = entries.get(sessionId);
        if (!entry) continue;
        entry.closing--;
        const reopen = entry.closing === 0 && !entry.closed && !deletedIds.has(sessionId);
        const consumers = reopen ? [...entry.consumers] : [];
        pruneEntry(sessionId);
        for (const consumer of consumers) consumer();
      }
    },
  };
}

export async function closeSessionCanvases(
  sessionIds: Iterable<SessionId>
): Promise<DesignCanvasLifecycle> {
  const design = getIpcServices()?.design;
  if (!design) return noLifecycle;
  const ids = [...new Set(sessionIds)];
  for (const sessionId of ids) {
    if (!(await design.leave(sessionId))) throw new Error('Canvas close cancelled');
  }
  const lifecycle = createLifecycle(ids);
  try {
    for (const sessionId of ids) {
      if (!(await design.close(sessionId))) throw new Error('Canvas close cancelled');
    }
  } catch (error) {
    lifecycle.release();
    throw error;
  }
  return lifecycle;
}
