import { useEffect, type ReactNode } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MOLLY_PRESENCE_HEARTBEAT_MS, type MachineId, type WorkspaceId } from '@molly/shared';
import { runtimeAtom } from '@/atoms/runtime';
import { currentWorkspaceSlugAtom } from '@/atoms';
import { clearDocMetaCacheAtom, docMetaSubscriptionAtom } from '@/atoms/doc-meta';
import {
  clearMollyPresenceStatesAtom,
  setMollyPresenceNowMsAtom,
  setMollyPresenceStatesAtom,
  setMollyPresenceSyncStateAtom,
} from '@/atoms/presence';
import {
  localProbeAttemptedAtom,
  localProbeEffectAtom,
  localProbeResultAtom,
} from '@/atoms/local-probe';
import {
  mollyControlConnectionStateAtom,
  runtimeInitializingAtom,
  browserOnlineAtom,
} from '@/atoms/control-connection';
import { usePlatform } from '@molly/platform/react';
import { createWorkspaceRuntime } from './create-workspace-runtime';
import { useImplicitLocalWorkspace } from './local-platform-provider';

const isExpectedRuntimeShutdownError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message === 'Destroyed' || error.message === 'Runtime disposed');

const logRuntimeOperationError = (operation: string, error: unknown): void => {
  if (isExpectedRuntimeShutdownError(error)) {
    console.info(`RuntimeProvider: ${operation} skipped during shutdown`);
    return;
  }
  console.error(`RuntimeProvider: ${operation} failed`, error);
};

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const platform = usePlatform();
  const workspaceSlug = useAtomValue(currentWorkspaceSlugAtom);
  const implicitLocalWorkspace = useImplicitLocalWorkspace();
  const localProbeResult = useAtomValue(localProbeResultAtom);
  const localProbeAttempted = useAtomValue(localProbeAttemptedAtom);
  const runtime = useAtomValue(runtimeAtom);
  const setRuntime = useSetAtom(runtimeAtom);
  const setControlConnectionState = useSetAtom(mollyControlConnectionStateAtom);
  const setRuntimeInitializing = useSetAtom(runtimeInitializingAtom);
  const setBrowserOnline = useSetAtom(browserOnlineAtom);
  useAtomValue(docMetaSubscriptionAtom);
  useAtomValue(localProbeEffectAtom);
  const clearDocMetaCache = useSetAtom(clearDocMetaCacheAtom);
  const clearPresenceStates = useSetAtom(clearMollyPresenceStatesAtom);
  const setPresenceStates = useSetAtom(setMollyPresenceStatesAtom);
  const setPresenceNowMs = useSetAtom(setMollyPresenceNowMsAtom);
  const setPresenceSyncState = useSetAtom(setMollyPresenceSyncStateAtom);
  const effectiveWorkspaceId = workspaceSlug
    ? ((implicitLocalWorkspace?.id as WorkspaceId | undefined) ?? null)
    : null;

  useEffect(() => {
    if (!workspaceSlug || typeof window === 'undefined') return undefined;
    const id = window.setInterval(() => setPresenceNowMs(), MOLLY_PRESENCE_HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [setPresenceNowMs, workspaceSlug]);

  useEffect(() => {
    if (!workspaceSlug) {
      setRuntime(null);
      setControlConnectionState('idle');
      setRuntimeInitializing(false);
      clearDocMetaCache();
      clearPresenceStates();
      return undefined;
    }

    setRuntimeInitializing(true);
    if (!effectiveWorkspaceId) return undefined;
    if (platform.sync.mode !== 'local') {
      throw new Error('Molly workspace runtime requires the local platform');
    }

    let disposed = false;
    let workspaceRuntime: Awaited<ReturnType<typeof createWorkspaceRuntime>> | null = null;
    setControlConnectionState('idle');
    void (async () => {
      try {
        workspaceRuntime = await createWorkspaceRuntime({
          workspaceSlug,
          workspaceId: effectiveWorkspaceId,
          eagerSyncSurface: 'desktop',
          syncMode: 'local',
          onControlConnectionStateChange: (state) => {
            if (disposed) return;
            setControlConnectionState(state);
            if (state === 'online' || state === 'error' || state === 'offline') {
              setRuntimeInitializing(false);
            }
          },
          onPresenceSnapshot: (states) => {
            if (!disposed) setPresenceStates(states);
          },
          onPresenceSyncStateChange: (state) => {
            if (!disposed) setPresenceSyncState(state);
          },
        });
        if (disposed) {
          await workspaceRuntime.dispose().catch((error: unknown) => {
            logRuntimeOperationError('dispose after late initialization', error);
          });
          return;
        }
        setRuntime(workspaceRuntime);
        setRuntimeInitializing(false);
      } catch (error) {
        logRuntimeOperationError('runtime initialization', error);
        if (disposed) return;
        setRuntime(null);
        setControlConnectionState('error');
        setRuntimeInitializing(false);
      }
    })();

    return () => {
      disposed = true;
      setRuntime(null);
      setControlConnectionState('idle');
      setRuntimeInitializing(true);
      clearDocMetaCache();
      clearPresenceStates();
      if (workspaceRuntime) {
        void workspaceRuntime.dispose().catch((error: unknown) => {
          logRuntimeOperationError('cleanup dispose', error);
        });
      }
    };
  }, [
    clearDocMetaCache,
    clearPresenceStates,
    effectiveWorkspaceId,
    platform.sync.mode,
    setControlConnectionState,
    setPresenceStates,
    setPresenceSyncState,
    setRuntime,
    setRuntimeInitializing,
    workspaceSlug,
  ]);

  useEffect(() => {
    if (!runtime || !localProbeAttempted) return;
    runtime.setLocalMachineId((localProbeResult?.machineId ?? null) as MachineId | null);
  }, [localProbeAttempted, localProbeResult?.machineId, runtime]);

  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setBrowserOnline]);

  return children;
}
