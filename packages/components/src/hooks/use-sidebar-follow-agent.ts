import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import { getIpcServices, getPublicBrowserBridge, onIpcEvent } from '@/lib/electron-ipc-client';
import { LRUCache } from '@/lib/lru-cache';

const MAX_REMEMBERED_KEYS = 100;
const BROWSER_SEGMENT_IDLE_MS = 500;
const manualTurns = new LRUCache<string, true>(MAX_REMEMBERED_KEYS);
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
  historyBaselineSynced: boolean;
  hasObservedCanvas: boolean;
  observedRevision: string | undefined;
  observedTurnId: string | undefined;
  activityRevision: string | undefined;
  activityTurnId: string | undefined;
  activityTurnIds: Set<string>;
  activityCanvasTurnIds: Set<string>;
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
    acceptedTurnId,
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
      acceptedTurnId,
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
    historyBaselineSynced: historySessionId === sessionId && historySynced,
    hasObservedCanvas: false,
    observedRevision: undefined,
    observedTurnId: undefined,
    activityRevision: undefined,
    activityTurnId: undefined,
    activityTurnIds: new Set(),
    activityCanvasTurnIds: new Set(),
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
      historyBaselineSynced: historySessionId === sessionId && historySynced,
      hasObservedCanvas: false,
      observedRevision: undefined,
      observedTurnId: undefined,
      activityRevision: undefined,
      activityTurnId: undefined,
      activityTurnIds: new Set(),
      activityCanvasTurnIds: new Set(),
      activityRequest: 0,
      activityPending: false,
    };
  }, [sessionId, historySessionId, historyReady, historySynced, committedReceipt]);
  useLayoutEffect(() => {
    if (!runningTurnId) return;
    receiptStateRef.current.activityTurnIds.add(runningTurnId);
    if (turnId) receiptStateRef.current.activityTurnIds.add(turnId);
    if (acceptedTurnId) receiptStateRef.current.activityTurnIds.add(acceptedTurnId);
  }, [acceptedTurnId, turnId, runningTurnId]);

  const attemptCommittedReceipt = useCallback(() => {
    const latest = latestRef.current;
    if (
      !latest.sessionId ||
      latest.historySessionId !== latest.sessionId ||
      (!latest.historyReady && !latest.historySynced)
    )
      return;
    const state = receiptStateRef.current;
    const receipt = latest.committedReceipt;
    const candidateTurnIds = [
      ...state.activityTurnIds,
      latest.turnId,
      latest.acceptedTurnId,
      latest.runningTurnId,
    ];
    if (
      receipt &&
      state.initialReceipt === undefined &&
      candidateTurnIds.some(Boolean) &&
      !candidateTurnIds.some(
        (candidate) => candidate && userTurnId(candidate) === receiptTurn(receipt)
      )
    ) {
      state.initialReceipt = receipt;
      state.historyBaselineSynced = true;
      handledReceipts.set(`${latest.sessionId}:${receipt}`, true);
      return;
    }
    if (state.initialPending || state.activityPending) return;
    if (!receipt) {
      if (latest.historySynced && latest.historySessionId === latest.sessionId) {
        state.historyBaselineSynced = true;
      }
      return;
    }
    const key = `${latest.sessionId}:${receipt}`;
    if (state.initialReceipt === receipt) {
      if (latest.historySynced) state.historyBaselineSynced = true;
      handledReceipts.set(key, true);
      return;
    }
    if (
      state.historyBaselineSynced &&
      latest.historySynced &&
      state.initialRevision === receiptRevision(receipt)
    ) {
      if (handledReceipts.has(key)) return;
      handledReceipts.set(key, true);
      latest.onReveal('design', !latest.suppressed);
      return;
    }
    const initialTurnId = state.initialTurnId && userTurnId(state.initialTurnId);
    const receiptTurnId = receiptTurn(receipt);
    if (
      state.initialReceipt === undefined &&
      state.initialRevision === receiptRevision(receipt) &&
      initialTurnId &&
      initialTurnId !== receiptTurnId &&
      ![...state.activityTurnIds].some(
        (activityTurn) => userTurnId(activityTurn) === receiptTurnId
      )
    ) {
      state.initialReceipt = receipt;
      state.historyBaselineSynced = true;
      handledReceipts.set(key, true);
      return;
    }
    if (state.activityRevision !== receiptRevision(receipt)) return;
    if (state.initialReceipt === undefined && state.initialRevision === receiptRevision(receipt)) {
      const existing =
        !state.activityCanvasTurnIds.has(receiptTurnId) &&
        (!initialTurnId || initialTurnId === receiptTurnId);
      if (existing) {
        state.initialReceipt = receipt;
        if (latest.historySynced) state.historyBaselineSynced = true;
        handledReceipts.set(key, true);
        return;
      }
    }
    const completedTurnId =
      state.initialRevision !== state.activityRevision ? latest.turnId : null;
    const activityTurns = [
      ...state.activityTurnIds,
      state.activityTurnId,
      completedTurnId,
    ].map((activityTurn) => (activityTurn ? userTurnId(activityTurn) : ''));
    if (!activityTurns.includes(receiptTurn(receipt))) {
      state.initialReceipt ??= receipt;
      if (latest.historySynced) state.historyBaselineSynced = true;
      handledReceipts.set(key, true);
      return;
    }
    state.activityRevision = undefined;
    if (latest.historySynced) state.historyBaselineSynced = true;
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
    const recordActivityTurn = (activityTurn: string) => {
      state.activityTurnIds.add(activityTurn);
      state.activityCanvasTurnIds.add(userTurnId(activityTurn));
    };
    if (service) {
      const request = ++state.initialRequest;
      state.initialPending = true;
      void service
        .state(artworkId)
        .then((canvasState) => {
          if (!active || state.initialRequest !== request) return;
          state.initialPending = false;
          if (
            state.hasObservedCanvas &&
            state.observedTurnId &&
            (state.observedRevision !== canvasState.revisionId ||
              state.observedTurnId !== canvasState.turnId)
          ) {
            recordActivityTurn(state.observedTurnId);
          }
          state.initialRevision = canvasState.revisionId;
          state.initialTurnId = canvasState.turnId;
          state.hasObservedCanvas = true;
          state.observedRevision = canvasState.revisionId;
          state.observedTurnId = canvasState.turnId;
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
          const changed =
            state.hasObservedCanvas &&
            (state.observedRevision !== canvasState.revisionId ||
              state.observedTurnId !== canvasState.turnId);
          state.activityRevision = canvasState.revisionId;
          state.activityTurnId = canvasState.turnId;
          if (changed && canvasState.turnId) recordActivityTurn(canvasState.turnId);
          state.hasObservedCanvas = true;
          state.observedRevision = canvasState.revisionId;
          state.observedTurnId = canvasState.turnId;
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
