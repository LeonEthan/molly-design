import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { getIpcServices, getPublicBrowserBridge, onIpcEvent } from '@/lib/electron-ipc-client';
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
  sessionId: string | null;
  historySessionId?: string | null;
  turnId: string | null;
  runningTurnId: string | null;
  canvasHostId: string | null;
  artworkId: string | null;
  committedReceipt?: string;
  historyReady?: boolean;
  historySynced?: boolean;
  suppressed: boolean;
  onReveal: (tab: SidebarFollowTab, exitZen: boolean) => void;
};

type SidebarReceiptState = {
  sessionId: string;
  initialReceipt: string | undefined;
  activityRevision: string | undefined;
  activityTurnId: string | undefined;
  activityTurnIds: Set<string>;
  activityRequest: number;
  activityPending: boolean;
};

const receiptRevision = (receipt: string) => receipt.slice(receipt.indexOf(':') + 1);
const userTurnId = (turnId: string) =>
  turnId.startsWith('assistant:') ? turnId.slice('assistant:'.length) : turnId;
const receiptTurn = (receipt: string) => userTurnId(receipt.slice(0, receipt.indexOf(':')));

export function useSidebarFollowAgent({
  browserId,
  sessionId,
  historySessionId,
  turnId,
  runningTurnId,
  canvasHostId,
  artworkId,
  committedReceipt,
  historyReady = false,
  historySynced = false,
  suppressed,
  onReveal,
}: SidebarFollowAgentOptions) {
  const latestRef = useRef({
    sessionId,
    historySessionId,
    turnId,
    runningTurnId,
    committedReceipt,
    historyReady,
    historySynced,
    suppressed,
    onReveal,
  });
  useLayoutEffect(() => {
    latestRef.current = {
      sessionId,
      historySessionId,
      turnId,
      runningTurnId,
      committedReceipt,
      historyReady,
      historySynced,
      suppressed,
      onReveal,
    };
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

  const receiptStateRef = useRef<SidebarReceiptState>({
    sessionId: sessionId ?? '',
    initialReceipt:
      historySessionId === sessionId && (historyReady || historySynced)
        ? committedReceipt
        : undefined,
    activityRevision: undefined,
    activityTurnId: undefined,
    activityTurnIds: new Set(),
    activityRequest: 0,
    activityPending: false,
  });
  useLayoutEffect(() => {
    const nextSessionId = sessionId ?? '';
    if (receiptStateRef.current.sessionId === nextSessionId) return;
    receiptStateRef.current.activityRequest += 1;
    receiptStateRef.current = {
      sessionId: nextSessionId,
      initialReceipt:
        historySessionId === sessionId && (historyReady || historySynced)
          ? committedReceipt
          : undefined,
      activityRevision: undefined,
      activityTurnId: undefined,
      activityTurnIds: new Set(),
      activityRequest: 0,
      activityPending: false,
    };
  }, [sessionId, historySessionId, historyReady, historySynced, committedReceipt]);

  const attemptCommittedReceipt = useCallback(() => {
    const latest = latestRef.current;
    if (
      !latest.sessionId ||
      latest.historySessionId !== latest.sessionId ||
      (!latest.historyReady && !latest.historySynced)
    )
      return;
    const state = receiptStateRef.current;
    if (state.activityPending) return;
    const receipt = latest.committedReceipt;
    if (!receipt) return;
    const key = `${latest.sessionId}:${receipt}`;
    if (state.initialReceipt === receipt) {
      handledReceipts.set(key, true);
      return;
    }
    if (state.activityRevision !== receiptRevision(receipt)) return;
    const activityTurns = [...state.activityTurnIds, state.activityTurnId, latest.turnId].map(
      (activityTurn) => (activityTurn ? userTurnId(activityTurn) : '')
    );
    if (!activityTurns.includes(receiptTurn(receipt))) {
      state.initialReceipt ??= receipt;
      handledReceipts.set(key, true);
      return;
    }
    state.activityRevision = undefined;
    if (handledReceipts.has(key)) return;
    handledReceipts.set(key, true);
    latest.onReveal('design', !latest.suppressed);
  }, []);

  useEffect(() => {
    attemptCommittedReceipt();
  }, [
    sessionId,
    historySessionId,
    committedReceipt,
    historyReady,
    historySynced,
    attemptCommittedReceipt,
  ]);

  useEffect(() => {
    if (!sessionId || !artworkId) return undefined;
    let active = true;
    const stop = onIpcEvent('design.state', (event) => {
      if (event.artworkId && event.artworkId !== artworkId) return;
      const state = receiptStateRef.current;
      const request = ++state.activityRequest;
      state.activityRevision = undefined;
      state.activityTurnId = undefined;
      state.activityPending = true;
      const service = getIpcServices()?.design;
      if (!service) {
        state.activityPending = false;
        attemptCommittedReceipt();
        return;
      }
      void service
        .state(artworkId)
        .then((canvasState) => {
          if (!active || state.activityRequest !== request) return;
          state.activityPending = false;
          state.activityRevision = canvasState.revisionId;
          state.activityTurnId = canvasState.turnId;
          if (canvasState.turnId) state.activityTurnIds.add(canvasState.turnId);
          attemptCommittedReceipt();
        })
        .catch(() => {
          if (!active || state.activityRequest !== request) return;
          state.activityPending = false;
          attemptCommittedReceipt();
        });
    });
    return () => {
      active = false;
      stop();
    };
  }, [sessionId, artworkId, attemptCommittedReceipt]);

  return { noteManualSidebarInteraction };
}
