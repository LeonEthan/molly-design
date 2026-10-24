import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { getPublicBrowserBridge, onIpcEvent } from '@/lib/electron-ipc-client';
import { LRUCache } from '@/lib/lru-cache';

const MAX_REMEMBERED_KEYS = 100;
const BROWSER_SEGMENT_IDLE_MS = 500;
const manualTurns = new LRUCache<string, true>(MAX_REMEMBERED_KEYS);
const handledReceipts = new LRUCache<string, true>(MAX_REMEMBERED_KEYS);

export const clearSidebarFollowMemory = (): void => {
  manualTurns.clear();
  handledReceipts.clear();
};

export type SidebarFollowTab = 'browser' | 'design';

type SidebarFollowAgentOptions = {
  browserId: string | null;
  turnId: string | null;
  runningTurnId: string | null;
  canvasHostId: string | null;
  committedReceipt?: string;
  historySynced?: boolean;
  suppressed: boolean;
  onReveal: (tab: SidebarFollowTab, exitZen: boolean) => void;
};

export function useSidebarFollowAgent({
  browserId,
  turnId,
  runningTurnId,
  canvasHostId,
  committedReceipt,
  historySynced = false,
  suppressed,
  onReveal,
}: SidebarFollowAgentOptions) {
  const latestRef = useRef({ turnId, runningTurnId, suppressed, onReveal });
  useLayoutEffect(() => {
    latestRef.current = { turnId, runningTurnId, suppressed, onReveal };
  });

  const noteManualSidebarInteraction = useCallback(() => {
    if (browserId) manualTurns.set(`${browserId}:${turnId ?? ''}`, true);
  }, [browserId, turnId]);

  useEffect(() => {
    if (!browserId && !canvasHostId) return undefined;
    const bridge = getPublicBrowserBridge();
    let key = '';
    let browsing = false;
    let previewTurnId = '';
    let lastSourceIdentity = '';
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
            const nextKey = `${browserId}:${latest.turnId ?? ''}`;
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
      const latest = latestRef.current;
      if (previewTurnId !== (latest.runningTurnId ?? '')) {
        previewTurnId = latest.runningTurnId ?? '';
        lastSourceIdentity = '';
      }
      if (!previewTurnId || lastSourceIdentity === result.sourceIdentity) return;
      lastSourceIdentity = result.sourceIdentity;
      endBrowsingSegment();
      const manualKey = `${browserId ?? ''}:${latest.turnId ?? ''}`;
      if (!latest.suppressed && !manualTurns.has(manualKey)) latest.onReveal('design', true);
    });
    return () => {
      clearIdleTimer();
      stopBrowser();
      stopPreview();
    };
  }, [browserId, canvasHostId]);

  const receiptStateRef = useRef<{
    sessionId: string;
    initialized: boolean;
    receipt?: string;
  }>({ sessionId: '', initialized: false });
  useEffect(() => {
    const sessionId = browserId ?? '';
    let state = receiptStateRef.current;
    if (state.sessionId !== sessionId) {
      state = { sessionId, initialized: false };
      receiptStateRef.current = state;
    }
    if (!sessionId) return;
    if (!state.initialized) {
      if (!committedReceipt && !historySynced) return;
      state.initialized = true;
      state.receipt = committedReceipt;
      if (committedReceipt) handledReceipts.set(`${sessionId}:${committedReceipt}`, true);
      return;
    }
    if (state.receipt === committedReceipt) return;
    state.receipt = committedReceipt;
    if (!committedReceipt) return;
    const key = `${sessionId}:${committedReceipt}`;
    if (handledReceipts.has(key)) return;
    handledReceipts.set(key, true);
    const latest = latestRef.current;
    latest.onReveal('design', !latest.suppressed);
  }, [browserId, committedReceipt, historySynced]);

  return { noteManualSidebarInteraction };
}
