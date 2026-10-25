import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { getPublicBrowserBridge, onIpcEvent } from '@/lib/electron-ipc-client';
import { LRUCache } from '@/lib/lru-cache';

const MAX_REMEMBERED_KEYS = 100;
const BROWSER_SEGMENT_IDLE_MS = 500;
const manualTurns = new LRUCache<string, true>(MAX_REMEMBERED_KEYS);
const handledPreviews = new LRUCache<string, true>(MAX_REMEMBERED_KEYS);

export const clearSidebarFollowMemory = (): void => {
  manualTurns.clear();
  handledPreviews.clear();
};

export type SidebarFollowTab = 'browser' | 'design';

type SidebarCommittedReceipt = { id: string; timestamp?: string };

type SidebarFollowAgentOptions = {
  browserId: string | null;
  sessionId: string | null;
  historySessionId?: string | null;
  turnId: string | null;
  runningTurnId: string | null;
  canvasHostId: string | null;
  committedReceipts?: readonly SidebarCommittedReceipt[];
  suppressed: boolean;
  onReveal: (tab: SidebarFollowTab, exitZen: boolean) => void;
  now?: () => number;
};

type SidebarView = {
  sessionId: string;
  startedAt: number;
  handledReceiptIds: Set<string>;
};

const EMPTY_RECEIPTS: readonly SidebarCommittedReceipt[] = [];

const createSidebarView = (sessionId: string | null, now: () => number): SidebarView => ({
  sessionId: sessionId ?? '',
  startedAt: now(),
  handledReceiptIds: new Set(),
});

export function useSidebarFollowAgent({
  browserId,
  sessionId,
  historySessionId,
  turnId,
  runningTurnId,
  canvasHostId,
  committedReceipts = EMPTY_RECEIPTS,
  suppressed,
  onReveal,
  now = Date.now,
}: SidebarFollowAgentOptions) {
  const latestRef = useRef({ runningTurnId, turnId, suppressed, onReveal });
  useLayoutEffect(() => {
    latestRef.current = { runningTurnId, turnId, suppressed, onReveal };
  });
  const viewRef = useRef<SidebarView | null>(null);
  if (viewRef.current === null) viewRef.current = createSidebarView(sessionId, now);
  useLayoutEffect(() => {
    const nextSessionId = sessionId ?? '';
    if (viewRef.current?.sessionId === nextSessionId) return;
    viewRef.current = createSidebarView(sessionId, now);
  }, [sessionId, now]);

  const noteManualSidebarInteraction = useCallback(() => {
    if (!browserId) return;
    manualTurns.set(`${browserId}:${runningTurnId ?? turnId ?? ''}`, true);
  }, [browserId, runningTurnId, turnId]);

  useEffect(() => {
    if (!browserId && !canvasHostId) return undefined;
    const bridge = getPublicBrowserBridge();
    let key = '';
    let browsing = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const clearIdleTimer = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = undefined;
    };
    const endBrowsingSegment = () => {
      clearIdleTimer();
      browsing = false;
    };
    const stopBrowser =
      browserId && bridge
        ? bridge.onState((state) => {
            if (state.browserId !== browserId) return;
            const latest = latestRef.current;
            const nextKey = `${browserId}:${latest.runningTurnId ?? latest.turnId ?? ''}`;
            if (key !== nextKey) {
              endBrowsingSegment();
              key = nextKey;
            }
            if (state.agentControl === 'agent') {
              clearIdleTimer();
              if (browsing) return;
              browsing = true;
              if (!latest.suppressed && !manualTurns.has(key)) latest.onReveal('browser', true);
              return;
            }
            if (state.agentControl === 'human-takeover') {
              endBrowsingSegment();
              return;
            }
            if (state.agentControl === 'human' && browsing) {
              clearIdleTimer();
              idleTimer = setTimeout(() => {
                browsing = false;
                idleTimer = undefined;
              }, BROWSER_SEGMENT_IDLE_MS);
            }
          })
        : () => {};
    const stopPreview = onIpcEvent('design.preview', (result) => {
      if (result.hostId !== canvasHostId || result.status !== 'ready' || !result.sourceIdentity)
        return;
      const previewKey = `${canvasHostId}:${result.sourceIdentity}`;
      if (handledPreviews.has(previewKey)) return;
      handledPreviews.set(previewKey, true);
      const latest = latestRef.current;
      if (!latest.runningTurnId) return;
      endBrowsingSegment();
      const manualKey = `${browserId ?? ''}:${latest.runningTurnId ?? latest.turnId ?? ''}`;
      if (!latest.suppressed && !manualTurns.has(manualKey)) latest.onReveal('design', true);
    });
    return () => {
      clearIdleTimer();
      stopBrowser();
      stopPreview();
    };
  }, [browserId, canvasHostId]);

  useEffect(() => {
    if (!sessionId || historySessionId !== sessionId) return;
    const view = viewRef.current;
    if (!view || view.sessionId !== sessionId) return;
    for (const receipt of committedReceipts) {
      if (!receipt.timestamp) continue;
      const timestamp = Date.parse(receipt.timestamp);
      if (!Number.isFinite(timestamp) || timestamp < view.startedAt) continue;
      const key = `${receipt.id}:${timestamp}`;
      if (view.handledReceiptIds.has(key)) continue;
      view.handledReceiptIds.add(key);
      onReveal('design', !suppressed);
    }
  }, [sessionId, historySessionId, committedReceipts, suppressed, onReveal]);

  return { noteManualSidebarInteraction };
}
