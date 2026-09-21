import { getMachineRoomId, type MachineMeta } from '@molly/shared';
import { LoroRepo, type RepoRoomSubscription, type RepoWatchHandle } from 'loro-repo';
import { IndexedDBStorageAdaptor } from 'loro-repo/storage/indexeddb';
import type { PlatformSyncMode } from '@molly/platform';
import {
  getPreviewCommentRoomId,
  getTaskRoomId,
  taskDocSchema,
  TASK_ORDER_MIN_KEY,
  getLoroMetaStreamId,
  getSessionRoomId,
  isSessionDocRoomId,
  isLoroRepoDocDeleted,
  SESSION_DOC_PREFIX,
  type SessionStatus,
  ClientToServerSchema,
  ServerToClientSchema,
  type ClientToServer,
  type SessionCreateResponse,
  type SessionCancelResponse,
  type SessionChatResponse,
  type SessionId,
  type MachineId,
  type MachineStatusResponse,
  type MachinePingResponse,
  type MachineRestartResponse,
  type MachineAcpCapabilitiesRefreshResponse,
  type MachineAcpAuthenticateResponse,
  type MachineAcpAuthenticationProgressMessage,
  type MachineAcpBinaryStatusResponse,
  type MachineAcpBinaryInstallResponse,
  type MachineAcpBinaryProgressMessage,
  previewVisualCommentDocSchema,
  base64ToBytes,
  parseMollyPresenceStates,
  MOLLY_PRESENCE_TTL_MS,
  type MollyPresenceStateMap,
  type SyncReason,
} from '@molly/shared';
import { LocalLoroTransportAdapter } from '@molly/shared/local-loro-transport';
import type { TaskId, WorkspaceId } from '@molly/shared';
import { createDirectWorkspaceWriter } from './workspace-writer-impl';
import { createConversationSession } from '@/lib/conversation-view';
import {
  WorkspaceTargetRouter,
  type WorkspaceTransportRoom,
  type WorkspaceTransportRoute,
} from './workspace-target-router';
import { Mirror } from 'loro-mirror';
import { LoroDoc, EphemeralStore } from 'loro-crdt';
import {
  WorkspaceRuntime,
  type PreviewVisualCommentDocStore,
  type SessionDocState,
  type SessionDocStore,
  type TaskDocStore,
} from '@/atoms/runtime';
import type { MollyControlConnectionState } from '@/atoms/control-connection';
import { createManagedStoreCache } from './store-ref-tracker';
import { waitForRoomToSync } from './room-sync';
import {
  createLocalReconnectLoop,
  type LocalReconnectLoop,
  type LocalReconnectTriggerReason,
} from './local-reconnect-loop';
import { resolveWorkspaceControlConnectionState } from './control-connection-state';
import { createRoomSyncTracker, type RoomSyncTracker } from './room-sync-tracker';
import type { RoomSyncState } from '@/lib/room-sync-state';
import { createRoomSyncRegistry } from './room-sync-registry';
import {
  createBackgroundSyncCoordinator,
  resolveEagerSyncPolicy,
  type BackgroundSyncCoordinator,
  type EagerSyncSurface,
  type SessionActivitySnapshot,
} from './background-sync-coordinator';
import { WorkspaceLocalMachineMonitorTransport } from './workspace-local-machine-monitor-transport';
import { TargetRoutedMachineMonitor } from './target-routed-machine-monitor';
import { scheduleAfterStartupNavigationCooldown } from './startup-network-idle';
import { listDocMetaEntries } from '@/lib/doc-meta-batch';
import {
  createEagerSyncHighWaterStore,
  type EagerSyncHighWaterCache,
} from '@/lib/eager-sync-high-water-cache';
import { createLocalLoroDataPlaneConnection } from './local-loro-data-plane-connection';
import { createWorkspaceMachineRpcFacade } from './workspace-machine-rpc-facade';
import { createCodeCollabFileIndexCache } from '@/lib/code-collab-file-index-cache';
import { getIpcServices, onIpcEvent, sendLocalSessionControl } from '@/lib/electron-ipc-client';

declare global {
  interface Window {
    repo?: LoroRepo;
  }
}

/**
 * Side-effect-only analytics intent emitted by the runtime. The runtime has no
 * PostHog client of its own (it is a non-React module), so it forwards
 * structured events to the React-side RuntimeProvider, which captures them via
 * the PostHog wrappers. Rejected: importing posthog-js here directly — the
 * runtime must stay framework-agnostic and unit-testable without a client.
 */
export type WorkspaceRuntimeAnalyticsEvent = {
  name: string;
  properties: Record<string, unknown>;
};

type RuntimeDeps = {
  /**
   * Used for caching the (slug, id) mapping in localStorage.
   */
  workspaceSlug: string;
  /** Required for the local IndexedDB workspace store. */
  workspaceId: WorkspaceId;
  token?: string | null;
  /** Every workspace room uses the Electron local data plane. */
  syncMode: PlatformSyncMode;
  onControlConnectionStateChange?: (state: MollyControlConnectionState) => void;
  onDocMetaPatch?: (roomId: string, patch: unknown) => void;
  onPresenceSnapshot?: (states: MollyPresenceStateMap) => void;
  /**
   * The local presence feed has produced a snapshot.
   */
  onPresenceSyncStateChange?: (state: RoomSyncState) => void;
  /**
   * Forward analytics intents (meta-sync outcome, connection-state changes,
   * durable-transport init failures) to the PostHog-aware caller. Optional so
   * the runtime works in tests and contexts without analytics wired.
   */
  onAnalyticsEvent?: (event: WorkspaceRuntimeAnalyticsEvent) => void;
  eagerSyncSurface?: EagerSyncSurface;
};

const isDestroyedError = (error: unknown): boolean => {
  return error instanceof Error && error.message === 'Destroyed';
};

const RECONNECTING_STATUS_DISPLAY_DELAY_MS = 1_000;
const META_FIRST_SYNC_TIMEOUT_MS = 120_000;
const LOCAL_MACHINE_ID_READY_TIMEOUT_MS = 2_000;
const MACHINE_RESTART_RPC_TIMEOUT_MS = 30_000;

function waitForPromiseOrAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);

  return new Promise<T | null>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      callback();
    };
    const handleAbort = () => finish(() => resolve(null));
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) {
      handleAbort();
      return;
    }
    void promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}
export {
  computeLocalReconnectDelayMs,
  waitForLocalReconnectDelayEffect,
} from './local-reconnect-loop';

const createTimeoutError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
};

const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'TimeoutError';

const withTimeout = async <TResult>(
  promise: Promise<TResult>,
  timeoutMs: number,
  message: string
): Promise<TResult> => {
  if (timeoutMs <= 0) {
    return await promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<TResult>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(createTimeoutError(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

// Generic registry for keyed control request/response round-trips: dedupes
// concurrent waiters on the same key, resolves null on timeout (the caller maps
// that to its own timeout message), and resolves the real response when handle()
// sees a match. Replaces the per-message-type copies of this machinery.
function createPendingResponseRegistry<T>(defaultTimeoutMs: number) {
  type Pending = {
    promise: Promise<T | null>;
    resolve: (value: T | null) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  };
  const pending = new Map<string, Pending>();

  const wait = (key: string, timeoutMs: number = defaultTimeoutMs): Promise<T | null> => {
    const existing = pending.get(key);
    if (existing) {
      return existing.promise;
    }
    let resolve: (value: T | null) => void = () => {};
    const promise = new Promise<T | null>((nextResolve) => {
      resolve = nextResolve;
    });
    const timeoutId = setTimeout(
      () => {
        pending.delete(key);
        resolve(null);
      },
      Math.max(0, timeoutMs)
    );
    pending.set(key, { promise, resolve, timeoutId });
    return promise;
  };

  const handle = (key: string, message: T): void => {
    const entry = pending.get(key);
    if (entry) {
      clearTimeout(entry.timeoutId);
      pending.delete(key);
      entry.resolve(message);
    }
  };

  const clearAll = (): void => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeoutId);
      entry.resolve(null);
    }
    pending.clear();
  };

  return { wait, handle, clearAll };
}

export async function createWorkspaceRuntime(deps: RuntimeDeps): Promise<WorkspaceRuntime> {
  if (deps.syncMode !== 'local') {
    throw new Error('Molly workspace runtime supports local sync only');
  }
  if (deps.token != null && deps.token !== '') {
    throw new Error('Product-cloud authentication is unavailable in Molly');
  }
  const createDeferred = <T>() => {
    let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
    let reject: ((reason?: unknown) => void) | undefined;
    const promise = new Promise<T>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    if (!resolve || !reject) {
      throw new Error('Failed to create deferred promise');
    }
    return { promise, resolve, reject };
  };

  // Use workspaceId for database names - ensures consistent data access even if slug changes.
  // Open SQLite connection for metadata storage (flock-sqlite mode for better performance)
  // Using OPFS (Origin Private File System) for persistent storage with custom database names
  // Routing is resolved lazily through the router constructed below.
  let resolveRoomTransportsImpl:
    | ((room: WorkspaceTransportRoom) => WorkspaceTransportRoute)
    | null = null;
  const repo = await LoroRepo.create({
    storageAdapter: new IndexedDBStorageAdaptor({
      dbName: 'molly-loro-repo-db-' + deps.workspaceId,
    }),
    metaDebounceCommitMs: 0,
    resolveRoomTransports: (room) =>
      resolveRoomTransportsImpl?.(room) ?? { transportIds: ['local'] },
  });
  const transportReady = createDeferred<void>();
  // Runtime dispose intentionally rejects this deferred; swallow that expected rejection.
  void transportReady.promise.catch(() => {});
  // Retained while shared local routing checks are folded into this runtime.
  const electronLocalDataPlane = true;
  let notifyTargetRouteChange = (): void => {};
  const targetRouter = new WorkspaceTargetRouter({
    onRouteChange: () => notifyTargetRouteChange(),
  });
  resolveRoomTransportsImpl = (room) => targetRouter.resolveTransportRoute(room);
  let localLoroTransport: LocalLoroTransportAdapter | null = null;
  let localMachineMonitorTransport: WorkspaceLocalMachineMonitorTransport | null = null;
  let localDataPlaneConnectionDispose: (() => void) | null = null;
  let localPresenceUnsubscribe: (() => void) | null = null;
  let transportAttached = false;
  let metaSub: RepoRoomSubscription | null = null;
  let detachMetaRoomStatusListener: (() => void) | null = null;
  let metaRoomJoinPromise: Promise<void> | null = null;
  // Meta room health tracker, registered in roomSyncRegistry like every other
  // durable room. Recreated fresh on each
  // ensureMetaRoomSynced cycle so stale first-sync/status state from a
  // previous transport attach can never leak into the next one.
  let metaTracker: RoomSyncTracker | null = null;
  let initialMetaSyncCompleted = false;
  let initialMetaSyncFailed = false;
  let metaFirstSyncRecovery: Promise<void> | null = null;
  const metaSyncState = (): RoomSyncState => metaTracker?.getSyncState() ?? 'idle';

  // workspaceId is required and provided at initialization
  const workspaceId: WorkspaceId = deps.workspaceId;

  // Analytics is side-effect-only: never let a capture path throw into the
  // runtime control flow. The caller wires `onAnalyticsEvent` to PostHog.
  const emitAnalytics = (name: string, properties: Record<string, unknown>): void => {
    if (!deps.onAnalyticsEvent) {
      return;
    }
    try {
      deps.onAnalyticsEvent({
        name,
        properties: { workspace_id: workspaceId, ...properties },
      });
    } catch (error) {
      console.warn('createWorkspaceRuntime: analytics emit failed', { name, error });
    }
  };

  const classifyMetaSyncReason = (error: unknown): SyncReason => {
    if (isTimeoutError(error)) {
      return 'timeout';
    }
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('token')) {
      return 'token_fetch_failed';
    }
    if (message.includes('cursor')) {
      return 'cursor_degraded';
    }
    if (message.includes('auth')) {
      return 'fatal_auth';
    }
    if (message.includes('reject')) {
      return 'rejected_by_server';
    }
    if (
      message.includes('transport') ||
      message.includes('network') ||
      message.includes('connect')
    ) {
      return 'transport_error';
    }
    return 'unknown';
  };

  const publishLocalPresence = (states: MollyPresenceStateMap): void => {
    deps.onPresenceSnapshot?.(states);
    deps.onPresenceSyncStateChange?.('synced');
  };
  const targetMachineMonitor = new TargetRoutedMachineMonitor();

  const watchHandles: RepoWatchHandle[] = [];
  // Grace period before disposing an idle session store (and leaving its room).
  // Long enough to survive session switching without reconnecting.
  const STORE_RELEASE_DELAY_MS = 600_000;
  // Short grace period before leaving an inactive session room. This avoids
  // reconnect churn during quick tab switches while keeping SSE fan-out bounded.
  const SESSION_ROOM_SYNC_RELEASE_DELAY_MS = 2_000;
  // Slow reconcile interval for the reconnect-loop backstop tick.
  const RECONNECT_BACKSTOP_INTERVAL_MS = 60_000;
  let disposePromise: Promise<void> | null = null;
  let reconnectingStatusTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectingStatusVisible = false;
  let localReconnectLoop: LocalReconnectLoop | null = null;
  let reconnectBackstopTimer: ReturnType<typeof setInterval> | null = null;
  let releaseIdleDocumentStoresBeforeReconnect: () => Promise<void> = async () => {};
  // Background eager-sync coordinator. Assigned once all of its port
  // dependencies (session store cache, env handlers) are in scope; started from
  // the meta-room first-sync callback after the startup navigation cooldown, so
  // it never blocks or competes with meta sync. Placeholder mirrors the
  // releaseIdleDocumentStoresBeforeReconnect pattern above.
  let backgroundSyncCoordinator: BackgroundSyncCoordinator | null = null;
  let backgroundSyncCoordinatorStartPromise: Promise<void> | null = null;
  let backgroundSyncHighWaterStore: EagerSyncHighWaterCache | null = null;
  let cancelDelayedBackgroundSyncStart: (() => void) | null = null;
  let startBackgroundSyncCoordinator: () => void = () => {};

  const clearReconnectingStatusTimer = () => {
    if (!reconnectingStatusTimer) {
      return;
    }
    clearTimeout(reconnectingStatusTimer);
    reconnectingStatusTimer = null;
  };

  const isBrowserOnline = (): boolean => {
    if (typeof navigator === 'undefined') {
      return true;
    }
    return navigator.onLine;
  };

  // Keyed registry of per-room sync trackers. Replaces the previous anonymous
  // Set<RoomSyncTracker>: serves hasReconnectableProblem() and additionally
  // exposes the joined / recently-synced room sets the background eager-sync
  // coordinator consumes. `onTrackerStateChange` is a lazy arrow so it can refer
  // to notifyConnectionStateInputsChanged (defined below) — it is only invoked
  // later, when a tracker's state actually changes.
  const roomSyncRegistry = createRoomSyncRegistry({
    clock: { now: () => Date.now() },
    onTrackerStateChange: () => notifyConnectionStateInputsChanged(),
  });

  const canRunLocalReconnect = (): boolean => transportAttached && !disposePromise;

  const isLocalHealthRoom = (roomId: string): boolean =>
    roomId === getLoroMetaStreamId(workspaceId) ||
    targetRouter.getPlaneForDocRoom(roomId) === 'local';

  // Every connection (meta room, durable session rooms, presence) reports
  // health into roomSyncRegistry, so "anything broken?" is a single scan.
  const hasReconnectableProblem = (): boolean =>
    canRunLocalReconnect() && roomSyncRegistry.anyNeedsReconnect(isLocalHealthRoom);

  const notifyConnectionStateInputsChanged = () => {
    localReconnectLoop?.update();
    emitControlConnectionState();
  };

  notifyTargetRouteChange = () => {
    void repo.refreshTransportRoutes().catch(() => undefined);
    targetMachineMonitor.refreshRoutes();
    notifyConnectionStateInputsChanged();
  };

  const createTrackedRoomSyncTracker = (roomId: string): RoomSyncTracker => {
    const tracker = createRoomSyncTracker(roomId);
    // The registry owns the state subscription (it forwards to
    // notifyConnectionStateInputsChanged via onTrackerStateChange) and the
    // joined / lastSyncedAt bookkeeping.
    const untrack = roomSyncRegistry.track(tracker);
    const disposeTracker = tracker.dispose;

    return {
      ...tracker,
      dispose: () => {
        untrack();
        disposeTracker();
      },
    };
  };

  // Readiness always follows the local room binding.
  const readinessBindingForDocRoom = (sub: RepoRoomSubscription, roomId: string) =>
    sub.subscription(targetRouter.getReadinessTransportForRoom({ kind: 'doc', id: roomId }));

  /**
   * Sync wait for a doc store. A binding whose transport is not attached
   * ('detached': signed out, offline, or a route migration that has not
   * finished re-attaching) has nothing to wait ON — loro-repo REJECTS there,
   * which would surface as a user-visible send/edit failure while the data is
   * simply pending. Treat it as a no-op, matching how every other consumer
   * reads 'detached' as idle.
   */
  const waitUntilRoomSynced = async (sub: RepoRoomSubscription, roomId: string): Promise<void> => {
    const binding = readinessBindingForDocRoom(sub, roomId);
    if (binding.status === 'detached') {
      return;
    }
    await binding.waitUntilSynced();
  };

  const resolveControlConnectionState = (): MollyControlConnectionState => {
    return resolveWorkspaceControlConnectionState({
      hasAuthToken: true,
      browserOnline: true,
      transportAttached,
      metaSyncState: metaSyncState(),
      initialMetaSyncCompleted,
      initialMetaSyncFailed,
    });
  };

  type PendingSessionCreateResponse = {
    promise: Promise<SessionCreateResponse | null>;
    resolve: (value: SessionCreateResponse | null) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  };

  type PendingSessionCancelResponse = {
    promise: Promise<SessionCancelResponse | null>;
    resolve: (value: SessionCancelResponse | null) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  };

  type PendingSessionChatResponse = {
    promise: Promise<SessionChatResponse | null>;
    resolve: (value: SessionChatResponse | null) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  };

  type PendingMachineStatusResponse = {
    promise: Promise<MachineStatusResponse | null>;
    resolve: (value: MachineStatusResponse | null) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  };

  type PendingMachinePingResponse = {
    promise: Promise<MachinePingResponse | null>;
    resolve: (value: MachinePingResponse | null) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  };

  const pendingSessionCreateResponses = new Map<SessionId, PendingSessionCreateResponse>();
  const sessionCreateResponseCache = new Map<SessionId, SessionCreateResponse>();

  const pendingSessionCancelResponses = new Map<SessionId, PendingSessionCancelResponse>();

  const pendingMachineStatusResponses = new Map<MachineId, PendingMachineStatusResponse>();
  const pendingMachinePingResponses = new Map<string, PendingMachinePingResponse>();
  const machineAcpBinaryStatusRegistry =
    createPendingResponseRegistry<MachineAcpBinaryStatusResponse>(30000);
  const machineAcpBinaryInstallRegistry =
    createPendingResponseRegistry<MachineAcpBinaryInstallResponse>(300000);
  const machineAcpAuthenticateRegistry =
    createPendingResponseRegistry<MachineAcpAuthenticateResponse>(300000);
  const machineRestartRegistry = createPendingResponseRegistry<MachineRestartResponse>(
    MACHINE_RESTART_RPC_TIMEOUT_MS
  );
  const machineAcpBinaryProgressListeners = new Map<
    string,
    Set<(message: MachineAcpBinaryProgressMessage) => void>
  >();
  const machineAcpBinaryProgressSnapshots = new Map<string, MachineAcpBinaryProgressMessage>();
  const machineAcpAuthenticationProgressListeners = new Map<
    string,
    Set<(message: MachineAcpAuthenticationProgressMessage) => void>
  >();
  const emitControlConnectionState = () => {
    if (disposePromise) {
      return;
    }

    const nextState = resolveControlConnectionState();

    if (!deps.onControlConnectionStateChange) {
      return;
    }

    if (nextState !== 'reconnecting') {
      clearReconnectingStatusTimer();
      reconnectingStatusVisible = false;
      deps.onControlConnectionStateChange(nextState);
      return;
    }

    if (reconnectingStatusVisible || reconnectingStatusTimer) {
      return;
    }

    reconnectingStatusTimer = setTimeout(() => {
      reconnectingStatusTimer = null;
      if (disposePromise || resolveControlConnectionState() !== 'reconnecting') {
        return;
      }
      reconnectingStatusVisible = true;
      deps.onControlConnectionStateChange?.('reconnecting');
    }, RECONNECTING_STATUS_DISPLAY_DELAY_MS);
  };

  // Chat responses use composite keys: `${sessionId}:${userTurnId}`
  const pendingSessionChatResponses = new Map<string, PendingSessionChatResponse>();

  const handleSessionCreateResponse = (message: SessionCreateResponse) => {
    const pending = pendingSessionCreateResponses.get(message.sessionId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pendingSessionCreateResponses.delete(message.sessionId);
      pending.resolve(message);
      return;
    }
    sessionCreateResponseCache.set(message.sessionId, message);
  };

  const handleSessionCancelResponse = (message: SessionCancelResponse) => {
    const pending = pendingSessionCancelResponses.get(message.sessionId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pendingSessionCancelResponses.delete(message.sessionId);
      pending.resolve(message);
    }
  };

  const handleSessionChatResponse = (message: SessionChatResponse) => {
    const key = `${message.sessionId}:${message.userTurnId}`;
    const pending = pendingSessionChatResponses.get(key);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pendingSessionChatResponses.delete(key);
      pending.resolve(message);
    }
  };

  const handleMachineStatusResponse = (message: MachineStatusResponse) => {
    const pending = pendingMachineStatusResponses.get(message.machineId as MachineId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pendingMachineStatusResponses.delete(message.machineId as MachineId);
      pending.resolve(message);
    }
  };

  const getMachinePingPendingKey = (machineId: MachineId, requestId: string): string =>
    `${machineId}:${requestId}`;

  const handleMachinePingResponse = (message: MachinePingResponse) => {
    const key = getMachinePingPendingKey(message.machineId as MachineId, message.requestId);
    const pending = pendingMachinePingResponses.get(key);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pendingMachinePingResponses.delete(key);
      pending.resolve(message);
    }
  };

  const getMachineLifecyclePendingKey = (machineId: MachineId, requestId: string): string =>
    `${machineId}:${requestId}`;

  const handleMachineRestartResponse = (message: MachineRestartResponse) =>
    machineRestartRegistry.handle(
      getMachineLifecyclePendingKey(message.machineId as MachineId, message.requestId),
      message
    );

  const getMachineAcpBinaryPendingKey = (machineId: MachineId, agentType: string): string =>
    `${machineId}:${agentType}`;

  const getMachineAcpAuthenticationPendingKey = (machineId: MachineId, requestId: string): string =>
    `${machineId}:${requestId}`;

  const handleMachineAcpAuthenticateResponse = (message: MachineAcpAuthenticateResponse) =>
    machineAcpAuthenticateRegistry.handle(
      getMachineAcpAuthenticationPendingKey(message.machineId as MachineId, message.requestId),
      message
    );

  const handleMachineAcpAuthenticationProgress = (
    message: MachineAcpAuthenticationProgressMessage
  ) => {
    const listeners = machineAcpAuthenticationProgressListeners.get(
      getMachineAcpAuthenticationPendingKey(message.machineId as MachineId, message.requestId)
    );
    if (!listeners) return;
    for (const listener of Array.from(listeners)) {
      listener(message);
    }
  };

  const subscribeMachineAcpAuthenticationProgress = (
    machineId: MachineId,
    requestId: string,
    listener: (message: MachineAcpAuthenticationProgressMessage) => void
  ): (() => void) => {
    const key = getMachineAcpAuthenticationPendingKey(machineId, requestId);
    const listeners = machineAcpAuthenticationProgressListeners.get(key) ?? new Set();
    listeners.add(listener);
    machineAcpAuthenticationProgressListeners.set(key, listeners);
    return () => {
      const current = machineAcpAuthenticationProgressListeners.get(key);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        machineAcpAuthenticationProgressListeners.delete(key);
      }
    };
  };

  const handleMachineAcpBinaryStatusResponse = (message: MachineAcpBinaryStatusResponse) => {
    handleMachineAcpBinaryProgress({
      type: 'machine/acp-binary-progress',
      machineId: message.machineId,
      agentType: message.agentType,
      status:
        !message.success || message.status === 'error'
          ? 'error'
          : message.status === 'not-applicable'
            ? 'installed'
            : message.status,
      command: message.command,
      platformArch: message.platformArch,
      version: message.version,
      current: message.current,
      required: message.required,
      error: message.error,
    });
    machineAcpBinaryStatusRegistry.handle(
      getMachineAcpBinaryPendingKey(message.machineId as MachineId, message.agentType),
      message
    );
  };

  const handleMachineAcpBinaryInstallResponse = (message: MachineAcpBinaryInstallResponse) => {
    handleMachineAcpBinaryProgress({
      type: 'machine/acp-binary-progress',
      machineId: message.machineId,
      agentType: message.agentType,
      status: message.success ? 'installed' : 'error',
      command: message.command,
      version: message.version,
      error: message.error,
    });
    machineAcpBinaryInstallRegistry.handle(
      getMachineAcpBinaryPendingKey(message.machineId as MachineId, message.agentType),
      message
    );
  };

  function handleMachineAcpBinaryProgress(message: MachineAcpBinaryProgressMessage): void {
    const key = getMachineAcpBinaryPendingKey(message.machineId as MachineId, message.agentType);
    machineAcpBinaryProgressSnapshots.set(key, message);
    const listeners = machineAcpBinaryProgressListeners.get(key);
    if (!listeners) return;
    for (const listener of Array.from(listeners)) {
      listener(message);
    }
  }

  const subscribeMachineAcpBinaryProgress = (
    machineId: MachineId,
    agentType: string,
    listener: (message: MachineAcpBinaryProgressMessage) => void
  ): (() => void) => {
    const key = getMachineAcpBinaryPendingKey(machineId, agentType);
    const listeners = machineAcpBinaryProgressListeners.get(key) ?? new Set();
    listeners.add(listener);
    machineAcpBinaryProgressListeners.set(key, listeners);
    return () => {
      const current = machineAcpBinaryProgressListeners.get(key);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        machineAcpBinaryProgressListeners.delete(key);
      }
    };
  };

  const getMachineAcpBinaryProgress = (
    machineId: MachineId,
    agentType: string
  ): MachineAcpBinaryProgressMessage | null =>
    machineAcpBinaryProgressSnapshots.get(getMachineAcpBinaryPendingKey(machineId, agentType)) ??
    null;

  const waitForSessionCreateResponse = (
    sessionId: SessionId,
    options: { timeoutMs?: number } = {}
  ): Promise<SessionCreateResponse | null> => {
    const cached = sessionCreateResponseCache.get(sessionId);
    if (cached) {
      sessionCreateResponseCache.delete(sessionId);
      return Promise.resolve(cached);
    }

    const existing = pendingSessionCreateResponses.get(sessionId);
    if (existing) {
      return existing.promise;
    }

    const timeoutMs = Math.max(0, options.timeoutMs ?? 10000);
    let resolve: (value: SessionCreateResponse | null) => void = () => {};
    const promise = new Promise<SessionCreateResponse | null>((nextResolve) => {
      resolve = nextResolve;
    });

    const timeoutId = setTimeout(() => {
      pendingSessionCreateResponses.delete(sessionId);
      resolve(null);
    }, timeoutMs);

    pendingSessionCreateResponses.set(sessionId, { promise, resolve, timeoutId });
    return promise;
  };

  const waitForSessionCancelResponse = (
    sessionId: SessionId,
    options: { timeoutMs?: number } = {}
  ): Promise<SessionCancelResponse | null> => {
    const existing = pendingSessionCancelResponses.get(sessionId);
    if (existing) {
      return existing.promise;
    }

    const timeoutMs = Math.max(0, options.timeoutMs ?? 10000);
    let resolve: (value: SessionCancelResponse | null) => void = () => {};
    const promise = new Promise<SessionCancelResponse | null>((nextResolve) => {
      resolve = nextResolve;
    });

    const timeoutId = setTimeout(() => {
      pendingSessionCancelResponses.delete(sessionId);
      resolve(null);
    }, timeoutMs);

    pendingSessionCancelResponses.set(sessionId, { promise, resolve, timeoutId });
    return promise;
  };

  /**
   * Wait for a session chat response.
   * @param sessionId - The session ID
   * @param userTurnId - The user message turn ID to correlate the response
   * @param options - Optional timeout configuration (default 3s)
   */
  const waitForSessionChatResponse = (
    sessionId: SessionId,
    userTurnId: string,
    options: { timeoutMs?: number } = {}
  ): Promise<SessionChatResponse | null> => {
    const key = `${sessionId}:${userTurnId}`;
    const existing = pendingSessionChatResponses.get(key);
    if (existing) {
      return existing.promise;
    }

    const timeoutMs = Math.max(0, options.timeoutMs ?? 3000);
    let resolve: (value: SessionChatResponse | null) => void = () => {};
    const promise = new Promise<SessionChatResponse | null>((nextResolve) => {
      resolve = nextResolve;
    });

    const timeoutId = setTimeout(() => {
      pendingSessionChatResponses.delete(key);
      resolve(null);
    }, timeoutMs);

    pendingSessionChatResponses.set(key, { promise, resolve, timeoutId });
    return promise;
  };

  /**
   * Wait for a machine status response.
   * @param machineId - The machine ID
   * @param options - Optional timeout configuration (default 30s)
   */
  const waitForMachineStatusResponse = (
    machineId: MachineId,
    options: { timeoutMs?: number } = {}
  ): Promise<MachineStatusResponse | null> => {
    const existing = pendingMachineStatusResponses.get(machineId);
    if (existing) {
      return existing.promise;
    }

    const timeoutMs = Math.max(0, options.timeoutMs ?? 30000);
    let resolve: (value: MachineStatusResponse | null) => void = () => {};
    const promise = new Promise<MachineStatusResponse | null>((nextResolve) => {
      resolve = nextResolve;
    });

    const timeoutId = setTimeout(() => {
      pendingMachineStatusResponses.delete(machineId);
      resolve(null);
    }, timeoutMs);

    pendingMachineStatusResponses.set(machineId, { promise, resolve, timeoutId });
    return promise;
  };

  const waitForMachinePingResponse = (
    machineId: MachineId,
    requestId: string,
    options: { timeoutMs?: number } = {}
  ): Promise<MachinePingResponse | null> => {
    const key = getMachinePingPendingKey(machineId, requestId);
    const existing = pendingMachinePingResponses.get(key);
    if (existing) {
      return existing.promise;
    }

    const timeoutMs = Math.max(0, options.timeoutMs ?? 30000);
    let resolve: (value: MachinePingResponse | null) => void = () => {};
    const promise = new Promise<MachinePingResponse | null>((nextResolve) => {
      resolve = nextResolve;
    });

    const timeoutId = setTimeout(() => {
      pendingMachinePingResponses.delete(key);
      resolve(null);
    }, timeoutMs);

    pendingMachinePingResponses.set(key, { promise, resolve, timeoutId });
    return promise;
  };

  const waitForMachineAcpBinaryStatusResponse = (
    machineId: MachineId,
    agentType: string,
    options: { timeoutMs?: number } = {}
  ): Promise<MachineAcpBinaryStatusResponse | null> =>
    machineAcpBinaryStatusRegistry.wait(
      getMachineAcpBinaryPendingKey(machineId, agentType),
      options.timeoutMs
    );

  const waitForMachineAcpAuthenticateResponse = (
    machineId: MachineId,
    requestId: string,
    options: { timeoutMs?: number } = {}
  ): Promise<MachineAcpAuthenticateResponse | null> =>
    machineAcpAuthenticateRegistry.wait(
      getMachineAcpAuthenticationPendingKey(machineId, requestId),
      options.timeoutMs
    );

  const waitForMachineAcpBinaryInstallResponse = (
    machineId: MachineId,
    agentType: string,
    options: { timeoutMs?: number } = {}
  ): Promise<MachineAcpBinaryInstallResponse | null> =>
    machineAcpBinaryInstallRegistry.wait(
      getMachineAcpBinaryPendingKey(machineId, agentType),
      options.timeoutMs
    );

  const waitForMachineRestartResponse = (
    machineId: MachineId,
    requestId: string,
    options: { timeoutMs?: number } = {}
  ): Promise<MachineRestartResponse | null> =>
    machineRestartRegistry.wait(
      getMachineLifecyclePendingKey(machineId, requestId),
      options.timeoutMs
    );

  const docMetaRouteHandle = repo.watch(
    (event) => {
      if (event.kind !== 'doc-metadata') {
        return;
      }
      targetRouter.observeDocMeta(event.docId, event.patch);
      deps.onDocMetaPatch?.(event.docId, event.patch);
    },
    { kinds: ['doc-metadata'] }
  );
  watchHandles.push(docMetaRouteHandle);

  const validateControlMessage = (message: ClientToServer): boolean => {
    const validated = ClientToServerSchema.safeParse(message);
    if (validated.success) {
      return true;
    }

    console.error('createWorkspaceRuntime: invalid control message', {
      type: message.type,
      error: validated.error.flatten(),
    });

    if (import.meta.env.DEV) {
      throw validated.error;
    }
    return false;
  };

  type ControlResponseMessage =
    | SessionCreateResponse
    | SessionCancelResponse
    | SessionChatResponse
    | MachineStatusResponse
    | MachinePingResponse
    | MachineRestartResponse
    | MachineAcpCapabilitiesRefreshResponse
    | MachineAcpAuthenticateResponse
    | MachineAcpAuthenticationProgressMessage
    | MachineAcpBinaryStatusResponse
    | MachineAcpBinaryInstallResponse
    | MachineAcpBinaryProgressMessage;

  const handleControlMessage = (message: ControlResponseMessage) => {
    if (message.type === 'session/create_response') {
      handleSessionCreateResponse(message);
      return;
    }
    if (message.type === 'session/cancel_response') {
      handleSessionCancelResponse(message);
      return;
    }
    if (message.type === 'session/chat_response') {
      handleSessionChatResponse(message);
      return;
    }
    if (message.type === 'machine/status_response') {
      handleMachineStatusResponse(message);
      return;
    }
    if (message.type === 'machine/ping_response') {
      handleMachinePingResponse(message);
      return;
    }
    if (message.type === 'machine/restart_response') {
      handleMachineRestartResponse(message);
      return;
    }
    if (message.type === 'machine/acp-authenticate_response') {
      handleMachineAcpAuthenticateResponse(message);
      return;
    }
    if (message.type === 'machine/acp-authentication-progress') {
      handleMachineAcpAuthenticationProgress(message);
      return;
    }
    if (message.type === 'machine/acp-binary-status_response') {
      handleMachineAcpBinaryStatusResponse(message);
      return;
    }
    if (message.type === 'machine/acp-binary-install_response') {
      handleMachineAcpBinaryInstallResponse(message);
      return;
    }
    if (message.type === 'machine/acp-binary-progress') {
      handleMachineAcpBinaryProgress(message);
      return;
    }
  };

  type ClientLocalSessionControlRequest = Extract<
    ClientToServer,
    {
      type:
        | 'session/create'
        | 'session/chat'
        | 'session/cancel'
        | 'machine/status'
        | 'machine/ping'
        | 'machine/restart'
        | 'machine/acp-capabilities-refresh'
        | 'machine/acp-authenticate'
        | 'machine/acp-binary-status'
        | 'machine/acp-binary-install';
    }
  >;

  type MachineControlRequest = Extract<
    ClientLocalSessionControlRequest,
    {
      type:
        | 'machine/status'
        | 'machine/ping'
        | 'machine/restart'
        | 'machine/acp-authenticate'
        | 'machine/acp-binary-status'
        | 'machine/acp-binary-install';
    }
  >;

  type LocalSessionControlDispatchResult =
    | { readonly handled: true }
    | { readonly handled: false; readonly error: string };

  type LocalSessionControlRequestResult =
    | { readonly ok: true; readonly responses: ControlResponseMessage[] }
    | { readonly ok: false; readonly error: string };

  const isMachineControlRequest = (message: ClientToServer): message is MachineControlRequest =>
    message.type === 'machine/status' ||
    message.type === 'machine/ping' ||
    message.type === 'machine/restart' ||
    message.type === 'machine/acp-authenticate' ||
    message.type === 'machine/acp-binary-status' ||
    message.type === 'machine/acp-binary-install';

  const isLocalSessionControlRequest = (
    message: ClientToServer
  ): message is ClientLocalSessionControlRequest =>
    message.type === 'session/create' ||
    message.type === 'session/chat' ||
    message.type === 'session/cancel' ||
    message.type === 'machine/status' ||
    message.type === 'machine/ping' ||
    message.type === 'machine/restart' ||
    message.type === 'machine/acp-capabilities-refresh' ||
    message.type === 'machine/acp-authenticate' ||
    message.type === 'machine/acp-binary-status' ||
    message.type === 'machine/acp-binary-install';

  const waitForMachineRouteIfNeeded = async (machineId: MachineId): Promise<void> => {
    if (!electronLocalDataPlane || targetRouter.getPlaneForMachine(machineId) !== null) {
      return;
    }
    try {
      await targetRouter.resolvePlaneForMachine(machineId, {
        timeoutMs: LOCAL_MACHINE_ID_READY_TIMEOUT_MS,
      });
    } catch {
      // The caller reports an unresolved local route.
    }
  };

  const {
    requestSessionCancel,
    requestSessionSteer,
    requestSessionTerminate,
    requestSessionFork,
    requestDesignContinuationPreparation,
    requestSessionEditAndResend,
    requestSessionDispatchTurn,
    requestSessionPrepare,
    requestSessionPrepareCancel,
    requestFilePreview,
    requestLocalCodeCollabFileIndex,
    requestCodeCollabOpenText,
    requestCodeCollabRefreshText,
    requestCodeCollabSaveText,
    requestCodeCollabOpenCurrentDiff,
    requestCodeCollabOpenAllChangesDiff,
    requestCodeCollabOpenTurnDiff,
    requestCodeCollabInitDirectory,
    requestCodeCollabLspDefinition,
    requestCodeCollabLspReferences,
    requestSessionPreviewEndpointAcquire,
    requestSessionPreviewEndpointRelease,
    requestLocalProjectGitState,
    requestLocalProjectControl,
  } = createWorkspaceMachineRpcFacade({
    getMachineProtocolCapabilities: async (machineId) => {
      const entry = await repo.getDocMeta(getMachineRoomId(machineId));
      return (entry?.meta as Partial<MachineMeta> | undefined)?.protocolCapabilities;
    },
    workspaceId,
    targetRouter,
  });

  const canUseLocalSessionControl = (message: ClientToServer): boolean => {
    if (typeof window === 'undefined') {
      return false;
    }
    if (!window.__MOLLY_ELECTRON__) {
      return false;
    }
    if (!getIpcServices()) {
      return false;
    }
    if (!isLocalSessionControlRequest(message)) {
      return false;
    }
    if (targetRouter.getPlaneForMachine(message.machineId) !== 'local') {
      return false;
    }
    if (
      (message.type === 'session/create' || message.type === 'session/chat') &&
      message.project?.kind !== 'local'
    ) {
      return false;
    }
    return true;
  };

  const requestLocalSessionControl = async (
    message: ClientLocalSessionControlRequest,
    options: { onProgress?: (progress: MachineAcpBinaryProgressMessage) => void } = {}
  ): Promise<LocalSessionControlRequestResult> => {
    if (typeof window === 'undefined') {
      return { ok: false, error: 'Local session control requires the Electron renderer' };
    }
    if (!getIpcServices()) {
      return { ok: false, error: 'Local session control bridge is not available' };
    }

    try {
      const streamedProgressCounts = new Map<string, number>();
      const result = await sendLocalSessionControl(message, (payload) => {
        const validated = ServerToClientSchema.safeParse(payload);
        if (!validated.success) {
          console.warn('createWorkspaceRuntime: invalid streamed local control response', {
            message: payload,
            error: validated.error,
          });
          return;
        }
        const controlMessage = validated.data;
        if (
          controlMessage.type !== 'machine/acp-binary-progress' &&
          controlMessage.type !== 'machine/acp-authentication-progress'
        ) {
          return;
        }
        const key = JSON.stringify(controlMessage);
        streamedProgressCounts.set(key, (streamedProgressCounts.get(key) ?? 0) + 1);
        handleControlMessage(controlMessage as ControlResponseMessage);
        if (controlMessage.type === 'machine/acp-binary-progress') {
          options.onProgress?.(controlMessage as MachineAcpBinaryProgressMessage);
        }
      });
      if (!result.ok) {
        console.warn('createWorkspaceRuntime: local session control rejected message', {
          type: message.type,
          error: result.error,
        });
        return {
          ok: false,
          error: `Local session control rejected ${message.type}: ${result.error}`,
        };
      }

      const responses: ControlResponseMessage[] = [];
      for (const payload of result.responses) {
        const validated = ServerToClientSchema.safeParse(payload);
        if (!validated.success) {
          console.warn('createWorkspaceRuntime: invalid local session control response', {
            message: payload,
            error: validated.error,
          });
          return {
            ok: false,
            error: `Local session control returned an invalid response for ${message.type}`,
          };
        }
        const controlMessage = validated.data;
        const streamedKey = JSON.stringify(controlMessage);
        const streamedCount = streamedProgressCounts.get(streamedKey) ?? 0;
        if (streamedCount > 0) {
          if (streamedCount === 1) {
            streamedProgressCounts.delete(streamedKey);
          } else {
            streamedProgressCounts.set(streamedKey, streamedCount - 1);
          }
          continue;
        }
        if (
          controlMessage.type === 'session/create_response' ||
          controlMessage.type === 'session/cancel_response' ||
          controlMessage.type === 'session/chat_response' ||
          controlMessage.type === 'machine/status_response' ||
          controlMessage.type === 'machine/ping_response' ||
          controlMessage.type === 'machine/restart_response' ||
          controlMessage.type === 'machine/acp-capabilities-refresh_response' ||
          controlMessage.type === 'machine/acp-authenticate_response' ||
          controlMessage.type === 'machine/acp-authentication-progress' ||
          controlMessage.type === 'machine/acp-binary-status_response' ||
          controlMessage.type === 'machine/acp-binary-install_response' ||
          controlMessage.type === 'machine/acp-binary-progress'
        ) {
          responses.push(controlMessage as ControlResponseMessage);
        }
      }
      return { ok: true, responses };
    } catch (error) {
      console.warn('createWorkspaceRuntime: local session control request failed', {
        error,
        type: message.type,
      });
      return {
        ok: false,
        error: `Local session control failed for ${message.type}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  };

  const sendControlViaLocalSessionControl = async (
    message: ClientLocalSessionControlRequest
  ): Promise<LocalSessionControlDispatchResult> => {
    const result = await requestLocalSessionControl(message);
    if (!result.ok) {
      return { handled: false, error: result.error };
    }
    for (const response of result.responses) {
      handleControlMessage(response);
    }
    return { handled: true };
  };

  const requestMachineAcpCapabilitiesRefresh = async (
    message: Extract<ClientToServer, { type: 'machine/acp-capabilities-refresh' }>,
    options: {
      signal?: AbortSignal;
      onProgress?: (progress: MachineAcpBinaryProgressMessage) => void;
    } = {}
  ): Promise<MachineAcpCapabilitiesRefreshResponse | null> => {
    const { signal } = options;
    if (signal?.aborted) return null;
    const routeReady = waitForMachineRouteIfNeeded(message.machineId);
    if (signal) {
      await waitForPromiseOrAbort(routeReady, signal);
    } else {
      await routeReady;
    }
    if (signal?.aborted) return null;

    if (targetRouter.getPlaneForMachine(message.machineId) === 'local') {
      if (!canUseLocalSessionControl(message)) {
        return {
          type: 'machine/acp-capabilities-refresh_response',
          machineId: message.machineId,
          configId: message.configId,
          cliType: 'builtin',
          agentType: 'unknown',
          success: false,
          error: `Local session control cannot route ${message.type} to machine ${message.machineId}`,
        };
      }
      const localRequest = requestLocalSessionControl(message, {
        onProgress: (progress) => {
          if (!signal?.aborted) options.onProgress?.(progress);
        },
      });
      const localResult = signal
        ? await waitForPromiseOrAbort(localRequest, signal)
        : await localRequest;
      if (!localResult || signal?.aborted) return null;
      if (!localResult.ok) {
        return {
          type: 'machine/acp-capabilities-refresh_response',
          machineId: message.machineId,
          configId: message.configId,
          cliType: 'builtin',
          agentType: 'unknown',
          success: false,
          error: localResult.error,
        };
      }
      for (const response of localResult.responses) {
        if (response.type === 'machine/acp-binary-progress') {
          handleMachineAcpBinaryProgress(response);
          options.onProgress?.(response);
        }
      }
      return (
        localResult.responses.find(
          (response): response is MachineAcpCapabilitiesRefreshResponse =>
            response.type === 'machine/acp-capabilities-refresh_response' &&
            response.machineId === message.machineId &&
            response.configId === message.configId
        ) ?? {
          type: 'machine/acp-capabilities-refresh_response',
          machineId: message.machineId,
          configId: message.configId,
          cliType: 'builtin',
          agentType: 'unknown',
          success: false,
          error: 'Local session control did not return an ACP capability refresh response',
        }
      );
    }

    return {
      type: 'machine/acp-capabilities-refresh_response',
      machineId: message.machineId,
      configId: message.configId,
      cliType: 'builtin',
      agentType: 'unknown',
      success: false,
      error: 'Remote Machine RPC is unavailable in Molly',
    };
  };

  const handleMachineControlTransportFailure = (
    message: MachineControlRequest,
    error: string
  ): void => {
    if (message.type === 'machine/status') {
      handleMachineStatusResponse({
        type: 'machine/status_response',
        machineId: message.machineId,
        success: false,
        error,
      });
      return;
    }
    if (message.type === 'machine/ping') {
      handleMachinePingResponse({
        type: 'machine/ping_response',
        machineId: message.machineId,
        requestId: message.requestId,
        success: false,
        error,
      });
      return;
    }
    if (message.type === 'machine/restart') {
      handleMachineRestartResponse({
        type: 'machine/restart_response',
        machineId: message.machineId,
        requestId: message.requestId,
        success: false,
        accepted: false,
        disposition: 'error',
        error,
      });
      return;
    }
    if (message.type === 'machine/acp-authenticate') {
      handleMachineAcpAuthenticateResponse({
        type: 'machine/acp-authenticate_response',
        machineId: message.machineId,
        requestId: message.requestId,
        agentType: 'unknown',
        success: false,
        disposition: 'error',
        error,
      });
      return;
    }
    if (message.type === 'machine/acp-binary-status') {
      handleMachineAcpBinaryStatusResponse({
        type: 'machine/acp-binary-status_response',
        machineId: message.machineId,
        agentType: message.agentType,
        success: false,
        status: 'error',
        error,
      });
      return;
    }
    handleMachineAcpBinaryInstallResponse({
      type: 'machine/acp-binary-install_response',
      machineId: message.machineId,
      agentType: message.agentType,
      success: false,
      error,
    });
  };

  const rejectLegacyControlMessage = (message: ClientToServer): void => {
    if (message.type === 'session/create') {
      handleSessionCreateResponse({
        type: 'session/create_response',
        sessionId: message.sessionId,
        success: false,
        error: 'legacy_control_removed',
      });
      return;
    }

    if (message.type === 'session/chat') {
      handleSessionChatResponse({
        type: 'session/chat_response',
        sessionId: message.sessionId,
        userTurnId: message.userTurnId,
        success: false,
        error: 'legacy_control_removed',
      });
      return;
    }

    if (message.type === 'session/cancel') {
      handleSessionCancelResponse({
        type: 'session/cancel_response',
        sessionId: message.sessionId,
        success: false,
        error: 'legacy_control_removed',
      });
    }
  };

  const sendControl = (message: ClientToServer) => {
    if (!validateControlMessage(message)) {
      return;
    }

    if (message.type === 'machine/acp-capabilities-refresh') {
      console.warn(
        'createWorkspaceRuntime: sendControl does not support capability refresh; use requestMachineAcpCapabilitiesRefresh so the response and cancellation stay scoped to the caller'
      );
      return;
    }

    if (isMachineControlRequest(message)) {
      void (async () => {
        await waitForMachineRouteIfNeeded(message.machineId);
        if (targetRouter.getPlaneForMachine(message.machineId) === 'local') {
          if (!canUseLocalSessionControl(message)) {
            handleMachineControlTransportFailure(
              message,
              `Local session control cannot route ${message.type} to machine ${message.machineId}`
            );
            return;
          }
          const result = await sendControlViaLocalSessionControl(message);
          if (result.handled) {
            return;
          }
          handleMachineControlTransportFailure(message, result.error);
          return;
        }

        handleMachineControlTransportFailure(
          message,
          `Remote Machine RPC is unavailable for ${message.type} in Molly`
        );
      })();
      return;
    }

    if (isLocalSessionControlRequest(message)) {
      void (async () => {
        await waitForMachineRouteIfNeeded(message.machineId);
        if (canUseLocalSessionControl(message)) {
          const result = await sendControlViaLocalSessionControl(message);
          if (result.handled) {
            return;
          }
        }
        rejectLegacyControlMessage(message);
      })();
      return;
    }

    rejectLegacyControlMessage(message);
  };

  const teardownTransport = async () => {
    detachMetaRoomStatusListener?.();
    detachMetaRoomStatusListener = null;
    metaTracker?.dispose();
    metaTracker = null;
    initialMetaSyncCompleted = false;
    initialMetaSyncFailed = false;
    metaFirstSyncRecovery = null;
    clearReconnectingStatusTimer();
    reconnectingStatusVisible = false;
    localReconnectLoop?.stop();

    // Unsubscribe from meta room
    if (metaSub) {
      try {
        metaSub.unsubscribe();
      } catch {
        // ignore
      }
      metaSub = null;
    }

    // Remove both planes' transports (loro-repo keeps room leases; their
    // bindings report 'detached' until a later attach).
    if (transportAttached) {
      await repo.removeTransport('local', { close: true }).catch(() => undefined);
      transportAttached = false;
    }
    localLoroTransport = null;
    localMachineMonitorTransport?.stop();
    localMachineMonitorTransport = null;
    if (localDataPlaneConnectionDispose) {
      localDataPlaneConnectionDispose();
      localDataPlaneConnectionDispose = null;
    }
    if (localPresenceUnsubscribe) {
      localPresenceUnsubscribe();
      localPresenceUnsubscribe = null;
    }

    emitControlConnectionState();
  };

  const attachLocalLoroDataPlaneTransport = async () => {
    if (transportAttached) {
      return;
    }

    const rawPeerId =
      globalThis.crypto?.randomUUID?.() ?? `renderer:${Date.now()}:${Math.random().toString(36)}`;
    const peerId = `renderer:${rawPeerId}`;

    const localConnection = createLocalLoroDataPlaneConnection();
    if (!localConnection) {
      // Fail fast: local-first mode without the data-plane bridge would be a
      // runtime with NO transport at all (the Streams path is not a fallback
      // here) and a direct-mode writer authoring into an unsyncable mirror — a
      // silent data black hole. Surface it as a runtime initialization error
      // instead (RuntimeProvider maps this to the error connection state).
      throw new Error(
        `local_loro_data_plane_bridge_unavailable: workspace ${workspaceId} is in ` +
          'Electron local-first mode but the preload loroDataPlane API is missing'
      );
    }
    localDataPlaneConnectionDispose = localConnection.dispose;

    localLoroTransport = new LocalLoroTransportAdapter({
      workspaceId,
      peerId,
      connection: localConnection.connection,
    });
    localMachineMonitorTransport = new WorkspaceLocalMachineMonitorTransport({
      workspaceId,
      peerId,
      connection: localConnection.connection,
    });
    targetMachineMonitor.setLocalTransport(localMachineMonitorTransport);
    // Routing comes from resolveRoomTransports wired to the local router.
    await repo.addTransport('local', localLoroTransport);

    // The local CLI presence snapshot is authoritative for this workspace.
    if (getIpcServices() && deps.onPresenceSnapshot) {
      const presenceStore = new EphemeralStore(MOLLY_PRESENCE_TTL_MS);
      localPresenceUnsubscribe = onIpcEvent('loro.event', (message) => {
        if (message.type !== 'presence') return;
        if (message.workspaceId !== workspaceId) return;
        presenceStore.apply(base64ToBytes(message.dataBase64));
        publishLocalPresence(
          parseMollyPresenceStates(presenceStore.getAllStates() as Record<string, unknown>)
        );
      });
    }

    transportAttached = true;
    transportReady.resolve();
    console.info('createWorkspaceRuntime: local Loro data-plane transport attached', {
      workspaceId,
    });
    emitControlConnectionState();
  };

  const joinAndWatchMetaRoom = async (syncPhase: 'initial' | 'recovery') => {
    if (metaSub) {
      return;
    }
    initialMetaSyncCompleted = false;
    initialMetaSyncFailed = false;
    metaFirstSyncRecovery = null;
    // Fresh tracker per join cycle: stale status/first-sync state from a
    // previous transport attach must never leak into this one. Registered in
    // roomSyncRegistry so meta health feeds the reconnect loop like any room.
    metaTracker?.dispose();
    const currentMetaTracker = createTrackedRoomSyncTracker(getLoroMetaStreamId(workspaceId));
    metaTracker = currentMetaTracker;
    emitControlConnectionState();
    console.debug('Joining repo meta room', { workspaceId });
    const joinStartedAt = Date.now();
    try {
      metaSub = await repo.joinMetaRoom();
    } catch (error) {
      initialMetaSyncCompleted = false;
      initialMetaSyncFailed = true;
      currentMetaTracker.markFirstSyncFailed();
      emitAnalytics('workspace/meta_sync_failed', {
        reason_code: classifyMetaSyncReason(error),
        error_name: error instanceof Error ? error.name : 'unknown',
        meta_room_status: 'error',
        duration_ms: Date.now() - joinStartedAt,
        phase: syncPhase,
      });
      console.error('Failed to join repo meta room', {
        workspaceId,
        elapsedMs: Date.now() - joinStartedAt,
        status: 'error',
        error,
      });
      notifyConnectionStateInputsChanged();
      return;
    }
    // Meta readiness follows the local transport; the aggregate join handle
    // still identifies this join cycle for status callbacks.
    const currentMetaAggregate = metaSub;
    const currentMetaSub = metaSub.subscription('local');
    currentMetaTracker.attach(currentMetaSub);
    console.debug('Repo meta room join returned', { workspaceId, status: currentMetaSub.status });
    detachMetaRoomStatusListener?.();
    const watchMetaFirstSync = (
      failureMessage: string,
      timeoutMessage: string,
      watchPhase: 'initial' | 'recovery'
    ): Promise<void> => {
      const startedAt = Date.now();
      const firstSyncPromise = currentMetaSub.firstSyncedWithRemote;
      // Each watch invocation reports exactly one terminal meta-sync outcome.
      // The success/failure handlers and the timeout race can otherwise both
      // fire (e.g. slow reject after a timeout), so guard double-emit here.
      let metaSyncOutcomeReported = false;
      console.info('createWorkspaceRuntime: waiting for repo meta room first remote sync', {
        workspaceId,
        status: currentMetaSub.status,
        timeoutMs: META_FIRST_SYNC_TIMEOUT_MS,
      });
      void firstSyncPromise
        .then(() => {
          if (disposePromise || metaSub !== currentMetaAggregate) {
            return;
          }
          initialMetaSyncCompleted = true;
          initialMetaSyncFailed = false;
          currentMetaTracker.markFirstSynced();
          // Claim the single-outcome slot on success so a later transient
          // failure can't emit a false meta_sync_failed/timed_out. The success
          // event itself was removed as low-value (high volume, no churn signal).
          metaSyncOutcomeReported = true;
          console.info('createWorkspaceRuntime: repo meta room first remote sync completed', {
            workspaceId,
            elapsedMs: Date.now() - startedAt,
            status: currentMetaSub.status,
          });
          notifyConnectionStateInputsChanged();
          // Start background eager-sync only after the meta room has synced, so
          // session prefetches never compete with the meta room's first join
          // (liveness invariant). Idempotent across recovery re-syncs.
          startBackgroundSyncCoordinator();
        })
        .catch((error: unknown) => {
          if (disposePromise || metaSub !== currentMetaAggregate || initialMetaSyncCompleted) {
            return;
          }
          initialMetaSyncCompleted = false;
          initialMetaSyncFailed = true;
          currentMetaTracker.markFirstSyncFailed();
          if (!metaSyncOutcomeReported) {
            metaSyncOutcomeReported = true;
            emitAnalytics('workspace/meta_sync_failed', {
              reason_code: classifyMetaSyncReason(error),
              error_name: error instanceof Error ? error.name : 'unknown',
              meta_room_status: currentMetaSub.status,
              duration_ms: Date.now() - startedAt,
              phase: watchPhase,
            });
          }
          console.error(failureMessage, {
            workspaceId,
            elapsedMs: Date.now() - startedAt,
            status: currentMetaSub.status,
            error,
          });
          notifyConnectionStateInputsChanged();
        });

      // Liveness invariant: the first local transport sync must complete or
      // enter a reconnectable state within a bounded time.
      return withTimeout(
        firstSyncPromise,
        META_FIRST_SYNC_TIMEOUT_MS,
        `${timeoutMessage} after ${META_FIRST_SYNC_TIMEOUT_MS}ms`
      ).catch((error: unknown) => {
        if (
          !isTimeoutError(error) ||
          disposePromise ||
          metaSub !== currentMetaAggregate ||
          initialMetaSyncCompleted
        ) {
          return;
        }
        initialMetaSyncCompleted = false;
        initialMetaSyncFailed = true;
        currentMetaTracker.markFirstSyncFailed();
        if (!metaSyncOutcomeReported) {
          metaSyncOutcomeReported = true;
          emitAnalytics('workspace/meta_sync_timed_out', {
            timeout_ms: META_FIRST_SYNC_TIMEOUT_MS,
            meta_room_status: currentMetaSub.status,
            duration_ms: Date.now() - startedAt,
            phase: watchPhase,
          });
        }
        console.warn(timeoutMessage, {
          workspaceId,
          timeoutMs: META_FIRST_SYNC_TIMEOUT_MS,
          elapsedMs: Date.now() - startedAt,
          status: currentMetaSub.status,
          error,
        });
        notifyConnectionStateInputsChanged();
      });
    };
    const retryMetaFirstSyncAfterReconnect = () => {
      if (initialMetaSyncCompleted || metaFirstSyncRecovery) {
        return;
      }

      initialMetaSyncFailed = false;
      const recovery = watchMetaFirstSync(
        'Failed to recover repo meta room sync',
        'Timed out waiting for repo meta room sync recovery',
        'recovery'
      ).finally(() => {
        if (metaFirstSyncRecovery === recovery) {
          metaFirstSyncRecovery = null;
        }
      });
      metaFirstSyncRecovery = recovery;
    };
    // Meta-specific first-sync recovery policy (timeout + analytics + cursor
    // invalidation). Plain health mirroring lives in currentMetaTracker.
    detachMetaRoomStatusListener = currentMetaSub.onStatusChange((status) => {
      if (disposePromise || metaSub !== currentMetaAggregate) {
        return;
      }
      console.info('createWorkspaceRuntime: repo meta room status changed', {
        workspaceId,
        status,
        initialMetaSyncCompleted,
        initialMetaSyncFailed,
      });
      if (status === 'joined') {
        if (initialMetaSyncCompleted) {
          initialMetaSyncFailed = false;
        } else if (initialMetaSyncFailed) {
          retryMetaFirstSyncAfterReconnect();
        }
      }
      notifyConnectionStateInputsChanged();
    });
    void watchMetaFirstSync(
      'Failed to sync repo meta room',
      'Timed out waiting for repo meta room initial sync',
      syncPhase
    );
  };

  const ensureMetaRoomSynced = async (syncPhase: 'initial' | 'recovery' = 'initial') => {
    if (metaSub) {
      return;
    }
    if (metaRoomJoinPromise) {
      await metaRoomJoinPromise;
      return;
    }

    const pendingJoin = joinAndWatchMetaRoom(syncPhase);
    metaRoomJoinPromise = pendingJoin;
    try {
      await pendingJoin;
    } finally {
      if (metaRoomJoinPromise === pendingJoin) {
        metaRoomJoinPromise = null;
      }
    }
  };

  const setAuthToken = async (token: string | null): Promise<void> => {
    if (token) throw new Error('Product-cloud authentication is unavailable in Molly');
  };

  const setLocalMachineId = (machineId: MachineId | null) => {
    targetRouter.setLocalMachineId(machineId);
  };

  localReconnectLoop = createLocalReconnectLoop({
    canRun: canRunLocalReconnect,
    hasProblem: hasReconnectableProblem,
    reconnect: async ({ force, triggerReason }) => {
      const startedAt = Date.now();
      // Reconcile is diff-driven: healthy connections are never torn down.
      // Durable rooms go through repo.reconnect(), which internally revives
      // only dead room sessions, so it also runs on force triggers where a
      // room may be dead without the registry knowing (adapter-level status
      // can stay "connected" while individual room sessions are gone).
      // Presence restart is a real teardown. Do it for known terminal states,
      // and for browser wake/online edges when the ephemeral stream looks stale
      // or stuck in a non-synced state.
      const durableProblemRooms = roomSyncRegistry.listNeedsReconnect(isLocalHealthRoom);
      const durableProblem = durableProblemRooms.length > 0;
      const reason =
        initialMetaSyncFailed && !initialMetaSyncCompleted
          ? 'initial-meta-sync-failed'
          : 'room-reconnect-signal';
      console.info('createWorkspaceRuntime: reconnect attempt started', {
        workspaceId,
        reason,
        triggerReason,
        force,
        durableProblem,
        // Name the broken rooms (bounded) so a reconnect storm is attributable
        // to a specific room instead of a bare boolean.
        durableProblemRooms: durableProblemRooms.slice(0, 8),
        durableProblemRoomCount: durableProblemRooms.length,
        metaSyncState: metaSyncState(),
        initialMetaSyncCompleted,
        initialMetaSyncFailed,
      });
      if (force || durableProblem) {
        try {
          await releaseIdleDocumentStoresBeforeReconnect();
        } catch (error) {
          console.warn('createWorkspaceRuntime: failed to release idle stores before reconnect', {
            workspaceId,
            error,
          });
        }
        {
          await repo.reconnect({ transportIds: ['local'], resetBackoff: true });
          // A failed repo-level meta attach leaves no subscription for
          // repo.reconnect() to revive. Rejoin it through the same recovery
          // episode instead of letting auth refresh start a new initial sync.
          if (!metaSub && !disposePromise) {
            await ensureMetaRoomSynced('recovery');
          }
        }
      }
      console.info('createWorkspaceRuntime: reconnect attempt completed', {
        workspaceId,
        reason,
        triggerReason,
        force,
        elapsedMs: Date.now() - startedAt,
        metaSyncState: metaSyncState(),
        initialMetaSyncCompleted,
        initialMetaSyncFailed,
      });
    },
    onStateChange: emitControlConnectionState,
    onError: (error) => {
      console.warn('createWorkspaceRuntime: reconnect attempt failed', {
        workspaceId,
        metaSyncState: metaSyncState(),
        initialMetaSyncCompleted,
        initialMetaSyncFailed,
        error,
      });
    },
  });

  if (electronLocalDataPlane) {
    await attachLocalLoroDataPlaneTransport();
    await ensureMetaRoomSynced();
  }

  const ensureDocStream = async (roomId: string): Promise<void> => {
    await targetRouter.prepareDocTarget(roomId);
  };

  /**
   * Create a session store that can read local data immediately (offline-first).
   * Remote sync is deferred until transport is ready (workspaceId is set).
   */
  const createSessionStore = async (sessionId: SessionId): Promise<SessionDocStore> => {
    const roomId = getSessionRoomId(sessionId);

    // Open persisted doc immediately - this reads from local IndexedDB
    // and does NOT require transport/workspaceId
    const persistedDoc = await repo.openPersistedDoc(roomId);

    const {
      mirror,
      history,
      sessionData,
      dispose: disposeConversation,
    } = createConversationSession(persistedDoc.doc as LoroDoc, {
      sessionId,
    });

    const syncTracker = createTrackedRoomSyncTracker(roomId);
    // Track subscription for cleanup
    let roomSub: Awaited<ReturnType<typeof persistedDoc.joinRoom>> | null = null;
    let disposed = false;
    let syncLeaseCount = 0;
    let syncReleaseTimer: ReturnType<typeof setTimeout> | null = null;
    let syncJoinPromise: Promise<void> | null = null;
    let resolveFirstSynced: (() => void) | null = null;
    const firstSynced = new Promise<void>((resolve) => {
      resolveFirstSynced = resolve;
    });

    const clearSyncReleaseTimer = () => {
      if (syncReleaseTimer !== null) {
        clearTimeout(syncReleaseTimer);
        syncReleaseTimer = null;
      }
    };

    const stopSyncNow = () => {
      clearSyncReleaseTimer();
      if (roomSub) {
        const sub = roomSub;
        roomSub = null;
        sub.unsubscribe();
        // unsubscribe() does not emit a status change, so the tracker would keep
        // reporting its last 'synced' state. Reset it to idle so the room-sync
        // registry no longer treats this warmed room as joined (which would
        // suppress eager sync and block warm-doc LRU eviction).
        syncTracker.markStopped();
      }
    };

    const startSync = () => {
      clearSyncReleaseTimer();
      if (disposed || roomSub || syncJoinPromise) {
        return;
      }

      // Join only while a UI surface has an active sync lease. The persisted
      // doc and Mirror stay in memory for fast tab switches; the SSE connection
      // is the part we debounce and release.
      syncJoinPromise = transportReady.promise.then(async () => {
        if (disposed || syncLeaseCount <= 0) {
          return;
        }
        try {
          // Best-effort ownership resolution: an unknown room mounts pure cloud
          // and gains its local member when meta resolves (refreshRoutes).
          await targetRouter.prepareSessionTarget(sessionId).catch(() => undefined);
          const joined = await waitForRoomToSync(() => persistedDoc.joinRoom(), {
            roomId,
            // Give the caller one task to populate the new doc before bootstrapping
            // the remote room. This avoids racing brand-new session creation.
            initialDelayMs: 0,
            isCancelled: () => disposed || syncLeaseCount <= 0,
            firstSynced: (sub) => readinessBindingForDocRoom(sub, roomId).firstSyncedWithRemote,
            onSubscription: (joinedSub) => {
              roomSub = joinedSub;
              syncTracker.attach(readinessBindingForDocRoom(joinedSub, roomId));
            },
          });
          if (!joined) {
            return;
          }
          if (disposed || syncLeaseCount <= 0) {
            joined.unsubscribe();
            if (roomSub === joined) {
              roomSub = null;
            }
            return;
          }
          roomSub = joined;
          syncTracker.markFirstSynced();
          resolveFirstSynced?.();
          resolveFirstSynced = null;
        } catch (error) {
          syncTracker.markFirstSyncFailed();
          throw error;
        }
      });
      void syncJoinPromise
        .catch(() => {})
        .finally(() => {
          syncJoinPromise = null;
        });
    };

    const acquireSync = () => {
      if (disposed) {
        return () => {};
      }
      syncLeaseCount += 1;
      startSync();
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        syncLeaseCount = Math.max(0, syncLeaseCount - 1);
        if (syncLeaseCount > 0 || disposed) {
          return;
        }
        clearSyncReleaseTimer();
        syncReleaseTimer = setTimeout(stopSyncNow, SESSION_ROOM_SYNC_RELEASE_DELAY_MS);
      };
    };

    void firstSynced.catch(() => {});

    return {
      sessionId,
      roomId,
      doc: persistedDoc.doc as LoroDoc,
      firstSynced,
      acquireSync,
      getSyncState: () =>
        syncLeaseCount > 0 || roomSub || syncJoinPromise ? syncTracker.getSyncState() : 'idle',
      subscribeSyncState: (listener) =>
        syncTracker.subscribeSyncState((state) => {
          listener(syncLeaseCount > 0 || roomSub || syncJoinPromise ? state : 'idle');
        }),
      getState: () => mirror.getState() as SessionDocState,
      history,
      sessionData,
      setState: (updater) => {
        mirror.setState(updater as never);
      },
      subscribe: (listener) => mirror.subscribe(listener as never),
      dispose: () => {
        disposed = true;
        stopSyncNow();
        syncTracker.dispose();
        disposeConversation();
      },
      waitUntilSynced: async (signal?: AbortSignal) => {
        await transportReady.promise;
        if (signal?.aborted) {
          return;
        }
        const releaseSync = acquireSync();
        try {
          // Resolves when the caller aborts so we can stop awaiting the room join
          // and release our sync lease promptly. Without this, an aborted prefetch
          // would keep the lease (and the SSE join) alive until the room naturally
          // settled, defeating the offline/hidden/timeout pause.
          const aborted = signal
            ? new Promise<void>((resolve) => {
                signal.addEventListener('abort', () => resolve(), { once: true });
              })
            : null;
          if (syncJoinPromise) {
            const join = syncJoinPromise.catch(() => {});
            await (aborted ? Promise.race([join, aborted]) : join);
          }
          if (signal?.aborted) {
            return;
          }
          const synced = roomSub ? waitUntilRoomSynced(roomSub, roomId) : undefined;
          if (synced) {
            await (aborted ? Promise.race([synced, aborted]) : synced);
          }
        } finally {
          releaseSync();
        }
      },
    };
  };

  const sessionStoreCache = createManagedStoreCache<SessionId, SessionDocStore>({
    create: createSessionStore,
    releaseDelayMs: STORE_RELEASE_DELAY_MS,
    // The cache is the doc's sole application-layer owner: hard release = stop
    // sync + Mirror.dispose (store.dispose) + repo.unloadDoc, serialized per key
    // by the cache so a concurrent acquire waits for the unload, then recreates.
    unload: (sessionId) => repo.unloadDoc(getSessionRoomId(sessionId)),
  });

  const createPreviewVisualCommentStore = async (
    sessionId: SessionId
  ): Promise<PreviewVisualCommentDocStore> => {
    const roomId = getPreviewCommentRoomId(sessionId);
    const persistedDoc = await repo.openPersistedDoc(roomId);

    const mirror = new Mirror({
      doc: persistedDoc.doc as LoroDoc,
      schema: previewVisualCommentDocSchema,
      // Tolerate root keys written by peers running a newer schema version.
      ignoreUnknownProperties: true,
      initialState: { meta: { sessionId }, turns: {} },
      debug: false,
    });

    const syncTracker = createTrackedRoomSyncTracker(roomId);
    let roomSub: Awaited<ReturnType<typeof persistedDoc.joinRoom>> | null = null;
    let disposed = false;

    const firstSynced = transportReady.promise.then(async () => {
      try {
        await targetRouter.prepareSessionTarget(sessionId).catch(() => undefined);
        const joined = await waitForRoomToSync(() => persistedDoc.joinRoom(), {
          roomId,
          initialDelayMs: 0,
          isCancelled: () => disposed,
          firstSynced: (sub) => readinessBindingForDocRoom(sub, roomId).firstSyncedWithRemote,
          onSubscription: (joinedSub) => {
            roomSub = joinedSub;
            syncTracker.attach(readinessBindingForDocRoom(joinedSub, roomId));
          },
        });
        if (!joined) {
          return;
        }
        if (disposed) {
          joined.unsubscribe();
          return;
        }
        roomSub = joined;
        syncTracker.markFirstSynced();
      } catch (error) {
        syncTracker.markFirstSyncFailed();
        throw error;
      }
    });
    void firstSynced.catch(() => {});

    return {
      sessionId,
      roomId,
      doc: persistedDoc.doc as LoroDoc,
      firstSynced,
      getSyncState: syncTracker.getSyncState,
      subscribeSyncState: syncTracker.subscribeSyncState,
      getState: () => mirror.getState(),
      setState: (updater) => {
        mirror.setState(updater as never);
      },
      subscribe: (listener) => mirror.subscribe(listener),
      dispose: () => {
        disposed = true;
        syncTracker.dispose();
        mirror.dispose();
        roomSub?.unsubscribe();
      },
      waitUntilSynced: async () => {
        await transportReady.promise;
        await firstSynced.catch(() => {});
        if (roomSub) {
          await waitUntilRoomSynced(roomSub, roomId);
        }
      },
    };
  };

  const previewVisualCommentStoreCache = createManagedStoreCache<
    SessionId,
    PreviewVisualCommentDocStore
  >({
    create: createPreviewVisualCommentStore,
    releaseDelayMs: STORE_RELEASE_DELAY_MS,
    // Same ownership contract as sessionStoreCache: the cache alone unloads the
    // doc from the repo on hard release, serialized per key.
    unload: (sessionId) => repo.unloadDoc(getPreviewCommentRoomId(sessionId)),
  });

  const createTaskStore = async (taskId: TaskId): Promise<TaskDocStore> => {
    const roomId = getTaskRoomId(taskId);
    const persistedDoc = await repo.openPersistedDoc(roomId);

    const mirror = new Mirror({
      doc: persistedDoc.doc as LoroDoc,
      schema: taskDocSchema,
      // Tolerate root keys written by peers running a newer schema version.
      ignoreUnknownProperties: true,
      initialState: {
        meta: {
          taskId,
          title: '',
          status: 'backlog',
          ownerId: '',
          order: TASK_ORDER_MIN_KEY,
          priority: undefined,
          labels: undefined,
          agent: undefined,
          projects: undefined,
          lastRunConfig: undefined,
          createdAt: 0,
          updatedAt: 0,
          createdBy: undefined,
        },
        body: '',
        links: [],
        timeline: [],
      },
      debug: false,
    });

    const syncTracker = createTrackedRoomSyncTracker(roomId);
    let roomSub: Awaited<ReturnType<typeof persistedDoc.joinRoom>> | null = null;
    let disposed = false;

    const firstSynced = transportReady.promise.then(async () => {
      try {
        // Tasks are workspace-scoped, so unlike session rooms there is no owning
        // machine to resolve first: the room routes to the cloud plane (and the
        // readiness binding below is therefore always the cloud one).
        const joined = await waitForRoomToSync(() => persistedDoc.joinRoom(), {
          roomId,
          initialDelayMs: 0,
          isCancelled: () => disposed,
          firstSynced: (sub) => readinessBindingForDocRoom(sub, roomId).firstSyncedWithRemote,
          onSubscription: (joinedSub) => {
            roomSub = joinedSub;
            syncTracker.attach(readinessBindingForDocRoom(joinedSub, roomId));
          },
        });
        if (!joined) {
          return;
        }
        if (disposed) {
          joined.unsubscribe();
          return;
        }
        roomSub = joined;
        syncTracker.markFirstSynced();
      } catch (error) {
        syncTracker.markFirstSyncFailed();
        throw error;
      }
    });
    void firstSynced.catch(() => {});

    return {
      taskId,
      roomId,
      doc: persistedDoc.doc as LoroDoc,
      firstSynced,
      getSyncState: syncTracker.getSyncState,
      subscribeSyncState: syncTracker.subscribeSyncState,
      getState: () => mirror.getState(),
      setState: (updater) => {
        mirror.setState(updater as never);
      },
      subscribe: (listener) => mirror.subscribe(listener),
      dispose: () => {
        disposed = true;
        syncTracker.dispose();
        mirror.dispose();
        roomSub?.unsubscribe();
      },
      waitUntilSynced: async () => {
        await transportReady.promise;
        await firstSynced.catch(() => {});
        if (roomSub) {
          await waitUntilRoomSynced(roomSub, roomId);
        }
      },
    };
  };

  const taskStoreCache = createManagedStoreCache<TaskId, TaskDocStore>({
    create: createTaskStore,
    releaseDelayMs: STORE_RELEASE_DELAY_MS,
    unload: (taskId) => repo.unloadDoc(getTaskRoomId(taskId)),
  });

  // Dual-author: every client direct-authors its own durable writes and uploads
  // them over its own cloud connection; local targets additionally converge with
  // the CLI over the local plane (specs/local-first-two-plane.md 作者规则).
  const workspaceWriter = createDirectWorkspaceWriter({
    repo,
    acquireSessionStore: sessionStoreCache.acquire,
    releaseSessionStoreRef: sessionStoreCache.releaseRef,
    acquirePreviewVisualCommentStore: previewVisualCommentStoreCache.acquire,
    releasePreviewVisualCommentStoreRef: previewVisualCommentStoreCache.releaseRef,
  });

  releaseIdleDocumentStoresBeforeReconnect = async () => {
    // Keep the warm-cache delay during normal navigation, but trim idle joined
    // rooms before reconnect. Rejected: letting repo.reconnect() revive every
    // recently viewed room, which creates a remote sync burst on mobile wake.
    await Promise.all([
      sessionStoreCache.releaseIdle(),
      previewVisualCommentStoreCache.releaseIdle(),
      taskStoreCache.releaseIdle(),
    ]);
  };

  // --- Background eager-sync coordinator ports -----------------------------
  // These adapters wire the pure BackgroundSyncCoordinator to runtime internals:
  // session metadata (activity), the session store cache (one-shot prefetch),
  // and browser online/visibility (env). The coordinator itself imports none of
  // these — see background-sync-coordinator.ts.
  const sessionIdFromRoomId = (roomId: string): SessionId =>
    roomId.slice(SESSION_DOC_PREFIX.length) as SessionId;

  const toSessionActivitySnapshot = (
    sessionId: SessionId,
    meta: Record<string, unknown>
  ): SessionActivitySnapshot => {
    const status =
      meta.status &&
      typeof meta.status === 'object' &&
      typeof (meta.status as { type?: unknown }).type === 'string'
        ? (meta.status as SessionStatus)
        : undefined;
    return {
      sessionId,
      lastMessageAt: typeof meta.lastMessageAt === 'number' ? meta.lastMessageAt : undefined,
      lastReadAt: typeof meta.lastReadAt === 'number' ? meta.lastReadAt : undefined,
      status,
      isArchived: meta.isArchived === true,
      isPinned: meta.isPinned === true,
      parentSessionId:
        typeof meta.parentSessionId === 'string' ? (meta.parentSessionId as SessionId) : undefined,
    };
  };

  const sessionIdSetsEqual = (
    left: ReadonlySet<SessionId> | null,
    right: ReadonlySet<SessionId> | null
  ): boolean => {
    if (left === right) {
      return true;
    }
    if (!left || !right) {
      return false;
    }
    if (left.size !== right.size) {
      return false;
    }
    for (const id of left) {
      if (!right.has(id)) {
        return false;
      }
    }
    return true;
  };

  const backgroundSyncSnapshots = new Map<SessionId, SessionActivitySnapshot>();
  let backgroundSyncActivityListener: ((snap: SessionActivitySnapshot) => void) | null = null;
  const backgroundSyncEnvListeners = new Set<() => void>();
  const backgroundSyncVisibilityListeners = new Set<() => void>();
  const eagerSyncVisibleSessionIdsBySource = new Map<string, Set<SessionId>>();
  let eagerSyncVisibleSessionIds: Set<SessionId> | null = null;
  const notifyBackgroundSyncEnvChange = () => {
    for (const listener of Array.from(backgroundSyncEnvListeners)) {
      listener();
    }
  };
  const notifyBackgroundSyncVisibilityChange = () => {
    for (const listener of Array.from(backgroundSyncVisibilityListeners)) {
      listener();
    }
  };
  const setEagerSyncVisibleSessionIds = (
    sourceId: string,
    sessionIds: readonly SessionId[] | null
  ) => {
    const normalizedSourceId = sourceId.trim();
    if (!normalizedSourceId) {
      return;
    }
    const previous = eagerSyncVisibleSessionIds;
    if (sessionIds) {
      eagerSyncVisibleSessionIdsBySource.set(normalizedSourceId, new Set(sessionIds));
    } else {
      eagerSyncVisibleSessionIdsBySource.delete(normalizedSourceId);
    }
    if (eagerSyncVisibleSessionIdsBySource.size === 0) {
      eagerSyncVisibleSessionIds = null;
    } else {
      const merged = new Set<SessionId>();
      for (const ids of eagerSyncVisibleSessionIdsBySource.values()) {
        for (const id of ids) {
          merged.add(id);
        }
      }
      eagerSyncVisibleSessionIds = merged;
    }
    if (!sessionIdSetsEqual(previous, eagerSyncVisibleSessionIds)) {
      notifyBackgroundSyncVisibilityChange();
    }
  };
  const isEagerSyncSessionVisible = (sessionId: SessionId): boolean =>
    eagerSyncVisibleSessionIds?.has(sessionId) ?? false;

  const seedBackgroundSyncSnapshots = async (): Promise<void> => {
    const entries = await listDocMetaEntries(repo);
    for (const entry of entries) {
      if (!isSessionDocRoomId(entry.docId) || isLoroRepoDocDeleted(entry)) {
        continue;
      }
      const sessionId = sessionIdFromRoomId(entry.docId);
      backgroundSyncSnapshots.set(
        sessionId,
        toSessionActivitySnapshot(sessionId, entry.meta as Record<string, unknown>)
      );
    }
  };

  const beginBackgroundSyncCoordinator = () => {
    if (backgroundSyncCoordinator || backgroundSyncCoordinatorStartPromise || disposePromise) {
      return;
    }

    const watchHandle = repo.watch(
      (event) => {
        if (event.kind !== 'doc-metadata' || !isSessionDocRoomId(event.docId)) {
          return;
        }
        const sessionId = sessionIdFromRoomId(event.docId);
        void repo.getDocMeta(event.docId).then((entry) => {
          if (!entry || isLoroRepoDocDeleted(entry)) {
            backgroundSyncSnapshots.delete(sessionId);
            return;
          }
          const snapshot = toSessionActivitySnapshot(
            sessionId,
            entry.meta as Record<string, unknown>
          );
          backgroundSyncSnapshots.set(sessionId, snapshot);
          backgroundSyncActivityListener?.(snapshot);
        });
      },
      { kinds: ['doc-metadata'] }
    );
    watchHandles.push(watchHandle);

    backgroundSyncCoordinatorStartPromise = (async () => {
      const highWaterStore = await createEagerSyncHighWaterStore(workspaceId);
      if (disposePromise) {
        highWaterStore.close();
        return;
      }
      backgroundSyncHighWaterStore = highWaterStore;

      backgroundSyncCoordinator = createBackgroundSyncCoordinator({
        activitySource: {
          list: () => Array.from(backgroundSyncSnapshots.values()),
          subscribe: (onChange) => {
            backgroundSyncActivityListener = onChange;
            return () => {
              if (backgroundSyncActivityListener === onChange) {
                backgroundSyncActivityListener = null;
              }
            };
          },
        },
        registry: roomSyncRegistry,
        prefetcher: {
          prefetch: async (sessionId, signal) => {
            if (signal.aborted) {
              return 'skipped';
            }
            let store: SessionDocStore;
            try {
              store = await sessionStoreCache.acquire(sessionId);
            } catch {
              return 'failed';
            }
            // Hold our own sync lease across the wait so the store reports the live
            // tracker state (not 'idle') when we inspect the outcome below.
            const releaseSync = store.acquireSync();
            try {
              const synced = store
                // Pass the abort signal so offline/hidden/timeout cancellation
                // actually releases the inner sync lease and lets the room join/SSE
                // tear down, instead of leaving it alive until it settles on its own.
                .waitUntilSynced(signal)
                // waitUntilSynced() resolves even when the room join failed (no
                // subscription → it awaits `undefined`). Only treat it as a real
                // catch-up if the room actually reached 'synced'; otherwise it is a
                // failure and must NOT advance the coordinator's synced high-water
                // mark (which would suppress retries).
                .then((): 'synced' | 'failed' =>
                  store.getSyncState() === 'synced' ? 'synced' : 'failed'
                )
                .catch((): 'failed' => 'failed');
              const aborted = new Promise<'skipped'>((resolve) => {
                if (signal.aborted) {
                  resolve('skipped');
                  return;
                }
                signal.addEventListener('abort', () => resolve('skipped'), { once: true });
              });
              return await Promise.race([synced, aborted]);
            } finally {
              releaseSync();
              sessionStoreCache.releaseRef(sessionId);
            }
          },
          evict: (sessionId) => {
            void sessionStoreCache.releaseIfIdle(sessionId);
          },
        },
        env: {
          isOnline: () => isBrowserOnline(),
          isAppVisible: () =>
            typeof document === 'undefined' || document.visibilityState === 'visible',
          subscribe: (onChange) => {
            backgroundSyncEnvListeners.add(onChange);
            return () => {
              backgroundSyncEnvListeners.delete(onChange);
            };
          },
        },
        visibility: {
          isVisible: isEagerSyncSessionVisible,
          subscribe: (onChange) => {
            backgroundSyncVisibilityListeners.add(onChange);
            return () => {
              backgroundSyncVisibilityListeners.delete(onChange);
            };
          },
        },
        clock: { now: () => Date.now() },
        scheduler: {
          setTimeout: (handler, ms) => setTimeout(handler, ms),
          clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
        },
        policy: resolveEagerSyncPolicy(deps.eagerSyncSurface ?? 'web'),
        highWaterStore,
      });

      const coordinator = backgroundSyncCoordinator;
      await seedBackgroundSyncSnapshots().catch(() => {});
      if (disposePromise || backgroundSyncCoordinator !== coordinator) {
        highWaterStore.close();
        if (backgroundSyncHighWaterStore === highWaterStore) {
          backgroundSyncHighWaterStore = null;
        }
        return;
      }
      coordinator.start();
    })()
      .catch((error) => {
        console.warn('createWorkspaceRuntime: failed to start background eager-sync', {
          workspaceId,
          error,
        });
        backgroundSyncCoordinator?.stop();
        backgroundSyncCoordinator = null;
        backgroundSyncHighWaterStore?.close();
        backgroundSyncHighWaterStore = null;
      })
      .finally(() => {
        backgroundSyncCoordinatorStartPromise = null;
      });
  };

  startBackgroundSyncCoordinator = () => {
    if (
      backgroundSyncCoordinator ||
      backgroundSyncCoordinatorStartPromise ||
      cancelDelayedBackgroundSyncStart ||
      disposePromise
    ) {
      return;
    }

    cancelDelayedBackgroundSyncStart = scheduleAfterStartupNavigationCooldown(() => {
      cancelDelayedBackgroundSyncStart = null;
      if (disposePromise) {
        return;
      }
      console.info(
        'createWorkspaceRuntime: startup navigation cooldown elapsed; starting background eager-sync',
        {
          workspaceId,
        }
      );
      beginBackgroundSyncCoordinator();
    });
  };

  const dispose = async () => {
    if (disposePromise) {
      return disposePromise;
    }

    disposePromise = (async () => {
      cancelDelayedBackgroundSyncStart?.();
      cancelDelayedBackgroundSyncStart = null;
      backgroundSyncCoordinator?.stop();
      backgroundSyncCoordinator = null;
      backgroundSyncHighWaterStore?.close();
      backgroundSyncHighWaterStore = null;
      localReconnectLoop?.stop();
      if (reconnectBackstopTimer) {
        clearInterval(reconnectBackstopTimer);
        reconnectBackstopTimer = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      transportReady.reject(new Error('Runtime disposed'));

      for (const pending of pendingSessionCreateResponses.values()) {
        clearTimeout(pending.timeoutId);
        pending.resolve(null);
      }
      pendingSessionCreateResponses.clear();
      sessionCreateResponseCache.clear();

      for (const pending of pendingSessionCancelResponses.values()) {
        clearTimeout(pending.timeoutId);
        pending.resolve(null);
      }
      pendingSessionCancelResponses.clear();

      for (const pending of pendingSessionChatResponses.values()) {
        clearTimeout(pending.timeoutId);
        pending.resolve(null);
      }
      pendingSessionChatResponses.clear();

      for (const pending of pendingMachineStatusResponses.values()) {
        clearTimeout(pending.timeoutId);
        pending.resolve(null);
      }
      pendingMachineStatusResponses.clear();

      for (const pending of pendingMachinePingResponses.values()) {
        clearTimeout(pending.timeoutId);
        pending.resolve(null);
      }
      pendingMachinePingResponses.clear();

      machineAcpBinaryStatusRegistry.clearAll();
      machineAcpBinaryInstallRegistry.clearAll();
      machineAcpAuthenticateRegistry.clearAll();
      machineAcpBinaryProgressListeners.clear();
      machineAcpBinaryProgressSnapshots.clear();
      machineAcpAuthenticationProgressListeners.clear();

      for (const handle of watchHandles) {
        try {
          handle.unsubscribe();
        } catch {
          // ignore
        }
      }
      watchHandles.length = 0;

      await sessionStoreCache.disposeAll();
      await previewVisualCommentStoreCache.disposeAll();
      await taskStoreCache.disposeAll();
      let codeCollabFileIndexCacheDisposeError: unknown = null;
      try {
        await codeCollabFileIndexCache.dispose();
      } catch (error) {
        codeCollabFileIndexCacheDisposeError = error;
      }

      let teardownTransportError: unknown = null;
      try {
        await teardownTransport();
      } catch (error) {
        if (!isDestroyedError(error)) {
          teardownTransportError = error;
        }
      }

      let destroyError: unknown = null;
      try {
        await repo.destroy();
      } catch (error) {
        if (!isDestroyedError(error)) {
          destroyError = error;
        }
      }

      if (destroyError) {
        throw destroyError;
      }
      if (teardownTransportError) {
        throw teardownTransportError;
      }
      if (codeCollabFileIndexCacheDisposeError) {
        throw codeCollabFileIndexCacheDisposeError;
      }
    })();

    return disposePromise;
  };

  // When the page becomes visible again (e.g. after mobile sleep/wake, tab switch),
  // trigger transport reconnect to recover rooms that may have entered "disconnected"
  // state due to retry exhaustion while JS was suspended.
  // The adapter-level status may still be "connected" even when individual room sessions
  // are disconnected, so we call reconnect() unconditionally. loro-repo handles rooms
  // that were previously live as well as rooms whose initial Streams join did not complete.
  const triggerReconnect = (reason: LocalReconnectTriggerReason) => {
    if (transportAttached && !disposePromise) {
      console.info('createWorkspaceRuntime: external reconnect trigger', {
        workspaceId,
        reason,
        metaSyncState: metaSyncState(),
        initialMetaSyncCompleted,
        initialMetaSyncFailed,
      });
      if (!electronLocalDataPlane || reason === 'visibility-wake') {
        localReconnectLoop?.trigger(reason);
      }
    }
  };
  const handleVisibilityChange = () => {
    notifyBackgroundSyncEnvChange();
    if (document.visibilityState === 'visible') {
      triggerReconnect('visibility-wake');
    }
  };
  // When the browser regains network connectivity, trigger reconnect immediately
  // so disconnected rooms recover without waiting for a visibility change.
  const handleOnline = () => {
    notifyBackgroundSyncEnvChange();
    triggerReconnect('network-online');
  };
  const handleOffline = () => {
    console.info('createWorkspaceRuntime: browser offline; stopping reconnect loop', {
      workspaceId,
      metaSyncState: metaSyncState(),
      initialMetaSyncCompleted,
      initialMetaSyncFailed,
    });
    notifyBackgroundSyncEnvChange();
    // Browser network state does not own the Electron local data plane.
    emitControlConnectionState();
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  // Level-triggered backstop: even if every event edge above is missed (a
  // status change that landed while the tab was frozen, a lost timer), the
  // reconnect loop re-evaluates registry health on a slow interval. update()
  // is a cheap no-op when nothing needs reconnecting and does NOT reset the
  // retry backoff.
  reconnectBackstopTimer = setInterval(() => {
    localReconnectLoop?.update();
  }, RECONNECT_BACKSTOP_INTERVAL_MS);

  window.repo = repo;
  const codeCollabFileIndexCache = createCodeCollabFileIndexCache(repo);
  return {
    workspaceSlug: deps.workspaceSlug,
    workspaceId,
    repo,
    codeCollabFileIndexCache,
    writer: workspaceWriter,
    prepareSessionTarget: (sessionId, machineId) =>
      targetRouter.prepareSessionTarget(sessionId, machineId),
    resolveMachineTargetPlane: (machineId, options) =>
      targetRouter.resolvePlaneForMachine(machineId, {
        timeoutMs: options?.timeoutMs ?? LOCAL_MACHINE_ID_READY_TIMEOUT_MS,
      }),
    setLocalMachineId,
    setEagerSyncVisibleSessionIds,
    setAuthToken,
    subscribeMachineMonitor: (machineId, listener) =>
      targetMachineMonitor.subscribeMachine(machineId, listener),
    forceMachineMonitorSample: (machineId) => targetMachineMonitor.forceSample(machineId),
    ensureDocStream,
    // Every store access must be ref-counted so eviction cannot dispose+unload
    // a doc mid-use. releaseRef only starts the warm-release timer, so this
    // wrapper is cheap for short-lived reads.
    withSessionStore: async <T>(
      sessionId: SessionId,
      fn: (store: SessionDocStore) => Promise<T> | T
    ): Promise<T> => {
      const store = await sessionStoreCache.acquire(sessionId);
      try {
        return await fn(store);
      } finally {
        sessionStoreCache.releaseRef(sessionId);
      }
    },
    releaseSessionStore: sessionStoreCache.release,
    acquireSessionStore: sessionStoreCache.acquire,
    releaseSessionStoreRef: sessionStoreCache.releaseRef,
    withPreviewVisualCommentStore: async <T>(
      sessionId: SessionId,
      fn: (store: PreviewVisualCommentDocStore) => Promise<T> | T
    ): Promise<T> => {
      const store = await previewVisualCommentStoreCache.acquire(sessionId);
      try {
        return await fn(store);
      } finally {
        previewVisualCommentStoreCache.releaseRef(sessionId);
      }
    },
    releasePreviewVisualCommentStore: previewVisualCommentStoreCache.release,
    acquirePreviewVisualCommentStore: previewVisualCommentStoreCache.acquire,
    releasePreviewVisualCommentStoreRef: previewVisualCommentStoreCache.releaseRef,
    withTaskStore: async <T>(
      taskId: TaskId,
      fn: (store: TaskDocStore) => Promise<T> | T
    ): Promise<T> => {
      const store = await taskStoreCache.acquire(taskId);
      try {
        return await fn(store);
      } finally {
        taskStoreCache.releaseRef(taskId);
      }
    },
    releaseTaskStore: taskStoreCache.release,
    acquireTaskStore: taskStoreCache.acquire,
    releaseTaskStoreRef: taskStoreCache.releaseRef,
    sendControl,
    waitForSessionCreateResponse,
    waitForSessionCancelResponse,
    waitForSessionChatResponse,
    waitForMachineStatusResponse,
    waitForMachinePingResponse,
    waitForMachineRestartResponse,
    requestMachineAcpCapabilitiesRefresh,
    waitForMachineAcpAuthenticateResponse,
    subscribeMachineAcpAuthenticationProgress,
    waitForMachineAcpBinaryStatusResponse,
    waitForMachineAcpBinaryInstallResponse,
    subscribeMachineAcpBinaryProgress,
    getMachineAcpBinaryProgress,
    requestSessionCancel,
    requestSessionSteer,
    requestSessionTerminate,
    requestSessionFork,
    requestDesignContinuationPreparation,
    requestSessionEditAndResend,
    requestSessionDispatchTurn,
    requestSessionPrepare,
    requestSessionPrepareCancel,
    requestFilePreview,
    requestLocalCodeCollabFileIndex,
    requestCodeCollabOpenText,
    requestCodeCollabRefreshText,
    requestCodeCollabSaveText,
    requestCodeCollabOpenCurrentDiff,
    requestCodeCollabOpenAllChangesDiff,
    requestCodeCollabOpenTurnDiff,
    requestCodeCollabInitDirectory,
    requestCodeCollabLspDefinition,
    requestCodeCollabLspReferences,
    requestSessionPreviewEndpointAcquire,
    requestSessionPreviewEndpointRelease,
    requestLocalProjectGitState,
    requestLocalProjectControl,
    dispose,
  };
}
