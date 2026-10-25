import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { getIpcServices, getPublicBrowserBridge, onIpcEvent } from '@/lib/electron-ipc-client';
import { LRUCache } from '@/lib/lru-cache';

const MAX_REMEMBERED_KEYS = 100;
const BROWSER_SEGMENT_IDLE_MS = 500;
const manualTurns = new LRUCache<string, { at: number }>(MAX_REMEMBERED_KEYS);
const handledReceipts = new LRUCache<string, true>(MAX_REMEMBERED_KEYS);
const handledPreviews = new LRUCache<string, true>(MAX_REMEMBERED_KEYS);

export const clearSidebarFollowMemory = (): void => {
  manualTurns.clear();
  handledReceipts.clear();
  handledPreviews.clear();
};

export type SidebarFollowTab = 'browser' | 'design';

type SidebarFollowAgentOptions = {
  browserId: string | null;
  sessionId: string | null;
  historySessionId?: string | null;
  acceptedTurnId?: string | null;
  acceptedTurnTimestamp?: string | null;
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
  initialRevision: string | undefined;
  initialTurnId: string | undefined;
  initialRequest: number;
  initialPending: boolean;
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
  acceptedTurnId,
  acceptedTurnTimestamp,
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

  const lastManualInteractionRef = useRef<{ browserId: string; key: string; at: number } | null>(
    null
  );
  const noteManualSidebarInteraction = useCallback(() => {
    if (!browserId) return;
    const key = `${browserId}:${turnId ?? ''}`;
    const at = Date.now();
    lastManualInteractionRef.current = { browserId, key, at };
    manualTurns.set(key, { at });
  }, [browserId, turnId]);

  useEffect(() => {
    if (!browserId || !acceptedTurnId || !acceptedTurnTimestamp) return;
    const acceptedAt = Date.parse(acceptedTurnTimestamp);
    const latest = lastManualInteractionRef.current;
    if (!latest || latest.browserId !== browserId || latest.at < acceptedAt) return;
    const acceptedKey = `${browserId}:${acceptedTurnId}`;
    manualTurns.set(acceptedKey, { at: latest.at });
    if (latest.key !== acceptedKey) manualTurns.delete(latest.key);
    lastManualInteractionRef.current = { ...latest, key: acceptedKey };
  }, [browserId, acceptedTurnId, acceptedTurnTimestamp]);

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
      const previewKey = `${canvasHostId}:${result.sourceIdentity}`;
      if (handledPreviews.has(previewKey)) return;
      handledPreviews.set(previewKey, true);
      const latest = latestRef.current;
      if (!latest.runningTurnId) return;
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
    initialRevision: undefined,
    initialTurnId: undefined,
    initialRequest: 0,
    initialPending: false,
    activityRevision: undefined,
    activityTurnId: undefined,
    activityTurnIds: new Set(),
    activityRequest: 0,
    activityPending: false,
  });
  useLayoutEffect(() => {
    const nextSessionId = sessionId ?? '';
    if (receiptStateRef.current.sessionId === nextSessionId) return;
    receiptStateRef.current = {
      sessionId: nextSessionId,
      initialReceipt:
        historySessionId === sessionId && (historyReady || historySynced)
          ? committedReceipt
          : undefined,
      initialRevision: undefined,
      initialTurnId: undefined,
      initialRequest: 0,
      initialPending: false,
      activityRevision: undefined,
      activityTurnId: undefined,
      activityTurnIds: new Set(),
      activityRequest: 0,
      activityPending: false,
    };
  }, [sessionId, historySessionId, historyReady, historySynced, committedReceipt]);
  useLayoutEffect(() => {
    if (!runningTurnId) return;
    receiptStateRef.current.activityTurnIds.add(runningTurnId);
    if (turnId) receiptStateRef.current.activityTurnIds.add(turnId);
  }, [turnId, runningTurnId]);

  const attemptCommittedReceipt = useCallback(() => {
    const latest = latestRef.current;
    if (
      !latest.sessionId ||
      latest.historySessionId !== latest.sessionId ||
      (!latest.historyReady && !latest.historySynced)
    )
      return;
    const state = receiptStateRef.current;
    if (state.initialPending || state.activityPending) return;
    const receipt = latest.committedReceipt;
    if (!receipt) return;
    const key = `${latest.sessionId}:${receipt}`;
    if (state.initialReceipt === receipt) {
      handledReceipts.set(key, true);
      return;
    }
    if (state.initialReceipt === undefined && state.activityRevision === undefined) {
      if (state.initialRevision !== receiptRevision(receipt)) return;
      const initialTurnId = state.initialTurnId && userTurnId(state.initialTurnId);
      const running = latest.runningTurnId && userTurnId(latest.runningTurnId);
      if (
        running !== receiptTurn(receipt) &&
        (!initialTurnId || initialTurnId === receiptTurn(receipt))
      ) {
        state.initialReceipt = receipt;
        handledReceipts.set(key, true);
        return;
      }
    }
    if (state.activityRevision !== receiptRevision(receipt)) return;
    const completedTurnId =
      state.initialRevision !== state.activityRevision ? latest.turnId : null;
    const activityTurns = [
      ...state.activityTurnIds,
      state.activityTurnId,
      completedTurnId,
    ].map((activityTurn) => (activityTurn ? userTurnId(activityTurn) : ''));
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
    const state = receiptStateRef.current;
    const service = getIpcServices()?.design;
    if (service) {
      const request = ++state.initialRequest;
      state.initialPending = true;
      void service
        .state(artworkId)
        .then((canvasState) => {
          if (!active || state.initialRequest !== request) return;
          state.initialPending = false;
          state.initialRevision = canvasState.revisionId;
          state.initialTurnId = canvasState.turnId;
          attemptCommittedReceipt();
        })
        .catch(() => {
          if (!active || state.initialRequest !== request) return;
          state.initialPending = false;
          attemptCommittedReceipt();
        });
    }
    const stop = onIpcEvent('design.state', (event) => {
      if (event.artworkId && event.artworkId !== artworkId) return;
      const request = ++state.activityRequest;
      state.activityRevision = undefined;
      state.activityTurnId = undefined;
      state.activityPending = true;
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
