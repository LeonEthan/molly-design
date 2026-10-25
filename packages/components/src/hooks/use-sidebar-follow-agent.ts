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
  initialResolved: boolean;
  syncedHistory: { receipt: string | null } | undefined;
  candidateReceipts: Set<string>;
  hasObservedCanvas: boolean;
  observedRevision: string | undefined;
  observedTurnId: string | undefined;
  activityRevision: string | undefined;
  activityTurnId: string | undefined;
  activityTurnIds: Set<string>;
  activityCanvasTurnIds: Set<string>;
  activityRequest: number;
};

const createReceiptState = (
  sessionId: string | null,
  historySessionId: string | null | undefined,
  historyReady: boolean,
  historySynced: boolean,
  committedReceipt?: string
): SidebarReceiptState => ({
  sessionId: sessionId ?? '',
  initialReceipt:
    historySessionId === sessionId && (historyReady || historySynced)
      ? committedReceipt
      : undefined,
  initialRevision: undefined,
  initialTurnId: undefined,
  initialRequest: 0,
  initialResolved: false,
  syncedHistory:
    historySessionId === sessionId && historySynced
      ? { receipt: committedReceipt ?? null }
      : undefined,
  candidateReceipts: new Set(),
  hasObservedCanvas: false,
  observedRevision: undefined,
  observedTurnId: undefined,
  activityRevision: undefined,
  activityTurnId: undefined,
  activityTurnIds: new Set(),
  activityCanvasTurnIds: new Set(),
  activityRequest: 0,
});

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

  const receiptStateRef = useRef<SidebarReceiptState>(
    createReceiptState(sessionId, historySessionId, historyReady, historySynced, committedReceipt)
  );
  useLayoutEffect(() => {
    const nextSessionId = sessionId ?? '';
    if (receiptStateRef.current.sessionId === nextSessionId) return;
    receiptStateRef.current = createReceiptState(
      sessionId,
      historySessionId,
      historyReady,
      historySynced,
      committedReceipt
    );
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
    if (latest.historySynced && state.syncedHistory === undefined) {
      state.syncedHistory = { receipt: latest.committedReceipt ?? null };
    }
    const currentReceipt = latest.committedReceipt;
    if (currentReceipt && currentReceipt !== state.initialReceipt) {
      state.candidateReceipts.add(currentReceipt);
    }
    const baseline = (receipt: string) => {
      state.initialReceipt ??= receipt;
      handledReceipts.set(`${latest.sessionId}:${receipt}`, true);
      state.candidateReceipts.delete(receipt);
    };
    const reveal = (receipt: string) => {
      state.activityRevision = undefined;
      handledReceipts.set(`${latest.sessionId}:${receipt}`, true);
      state.candidateReceipts.delete(receipt);
      latest.onReveal('design', !latest.suppressed);
    };
    for (const receipt of state.candidateReceipts) {
      const key = `${latest.sessionId}:${receipt}`;
      if (handledReceipts.has(key)) {
        state.candidateReceipts.delete(receipt);
        continue;
      }
      if (receipt === state.initialReceipt) {
        baseline(receipt);
        continue;
      }
      const revision = receiptRevision(receipt);
      const turn = receiptTurn(receipt);
      const candidateTurnIds = [
        ...state.activityTurnIds,
        latest.turnId,
        latest.acceptedTurnId,
        latest.runningTurnId,
      ];
      if (
        candidateTurnIds.some(Boolean) &&
        !candidateTurnIds.some((candidate) => candidate && userTurnId(candidate) === turn)
      ) {
        baseline(receipt);
        continue;
      }
      const newFromHistory =
        latest.historySynced &&
        ((state.syncedHistory !== undefined && state.syncedHistory.receipt !== receipt) ||
          (state.initialReceipt !== undefined && state.initialReceipt !== receipt));
      if (
        newFromHistory &&
        (state.initialRevision === revision || state.activityRevision === revision)
      ) {
        reveal(receipt);
        continue;
      }
      const initialTurnId = state.initialTurnId && userTurnId(state.initialTurnId);
      const revisionChanged = state.initialResolved && state.initialRevision !== revision;
      const revisionMatches =
        (state.initialResolved && state.initialRevision === revision) ||
        state.activityRevision === revision;
      if (
        state.initialReceipt === undefined &&
        !revisionChanged &&
        revisionMatches &&
        !state.activityCanvasTurnIds.has(turn) &&
        (!initialTurnId || initialTurnId === turn)
      ) {
        if (state.syncedHistory?.receipt === receipt) baseline(receipt);
        continue;
      }
      if (state.activityRevision !== revision) continue;
      const completedTurnId =
        state.initialRevision !== state.activityRevision ? latest.turnId : null;
      const activityTurns = [
        ...state.activityTurnIds,
        state.activityTurnId,
        completedTurnId,
      ].map((activityTurn) => (activityTurn ? userTurnId(activityTurn) : ''));
      if (activityTurns.includes(turn)) reveal(receipt);
      else baseline(receipt);
    }
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
      void service
        .state(artworkId)
        .then((canvasState) => {
          if (!active || state.initialRequest !== request) return;
          if (
            state.hasObservedCanvas &&
            state.observedTurnId &&
            (state.observedRevision !== canvasState.revisionId ||
              state.observedTurnId !== canvasState.turnId)
          ) {
            recordActivityTurn(state.observedTurnId);
          }
          state.initialResolved = true;
          state.initialRevision = canvasState.revisionId;
          state.initialTurnId = canvasState.turnId;
          state.hasObservedCanvas = true;
          state.observedRevision = canvasState.revisionId;
          state.observedTurnId = canvasState.turnId;
          attemptCommittedReceipt();
        })
        .catch(() => {
          if (!active || state.initialRequest !== request) return;
          attemptCommittedReceipt();
        });
    }
    const stop = onIpcEvent('design.state', (event) => {
      if (event.artworkId && event.artworkId !== artworkId) return;
      const request = ++state.activityRequest;
      state.activityRevision = undefined;
      state.activityTurnId = undefined;
      if (!service) {
        attemptCommittedReceipt();
        return;
      }
      void service
        .state(artworkId)
        .then((canvasState) => {
          if (!active || state.activityRequest !== request) return;
          const changed =
            state.initialResolved &&
            state.hasObservedCanvas &&
            (state.observedRevision !== canvasState.revisionId ||
              state.observedTurnId !== canvasState.turnId) &&
            (state.initialRevision !== canvasState.revisionId ||
              state.initialTurnId !== canvasState.turnId);
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
