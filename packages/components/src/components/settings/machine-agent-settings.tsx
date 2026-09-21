import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModelConnectionSetting } from './model-connection-setting';
import { AgentEngineCatalog } from './agent-engine-catalog';
import { BundledCapabilitiesSetting } from './bundled-capabilities-setting';
import { useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from '@tanstack/react-router';
import {
  type AcpSessionMonitorSnapshot,
  type AgentConfigMeta,
  type MachineId,
  type MachineViewMeta,
  type ProviderSetupTask,
  type SessionId,
  type WorkspaceId,
} from '@molly/shared';
import { Loader2 } from 'lucide-react';
import { activeWorkspaceRuntimeAtom, authTokenAtom, type WorkspaceRuntime } from '@/atoms/runtime';
import { developerModeEnabledAtom } from '@/atoms/settings';
import { settingsDialogOpenAtom } from '@/atoms/settings';
import { sessionMetaCacheAtom } from '@/atoms/doc-meta';
import { currentWorkspaceIdAtom, currentWorkspaceSlugAtom } from '@/atoms/workspace-context';
import { localMachineIdAtom } from '@/atoms/local-probe';
import { getAllAgentConfigAtom, getAllProviderSetupsAtom } from '@/atoms/agents';
import { machineSettingsFilterAtom } from '@/atoms/settings-machine-tab';
import { useVisibleMachineMetas } from '@/hooks/use-visible-machine-metas';
import { useVisibleLocalProjectsFromMachineIndex } from '@/hooks/use-visible-local-projects';
import { useMachineActions } from '@/hooks/use-machine-actions';
import { useMachineFlockAgentConfigsForMachineIds } from '@/hooks/use-machine-flock-agent-configs';
import { useIsMobile } from '@/hooks/use-mobile';
import { canDeleteOfflineMachine, canManageAllMachines } from '@/lib/machine-deletion';
import { mintMachineLifecycleRequestToken } from '@/lib/machine-lifecycle-api';
import { useOrganization } from '@/hooks/useOrganization';
import { useStableSession } from '@/hooks/useStableSession';
import { useOnlineMachineIds } from '@/hooks/use-machine-online-status';
import { formatSessionTabSearch } from '@/lib/session-tab-url';
import { useMachineMonitor } from '@/hooks/use-machine-monitor';
import { useMachineLifecycleCapability } from '@/hooks/use-machine-lifecycle-capability';
import { useOpenSettings } from '@/hooks/use-open-settings';
import { Button } from '@/ui/button';
import {
  MachineListFilterButton,
  buildMachineTabItems,
  type MachineTabItem,
  type MachineTabOwner,
} from './machine-tab-list';
import { MachineDetailPane } from './machine-detail-pane';
import {
  buildWorkspaceMachineSelectionPool,
  resolveDesktopMachineSelection,
} from './machine-selection';
import {
  MachineConnectedResources,
  type MachineConnectedProject,
} from './my-machine-connected-resources';
import {
  WorkspaceMachineCollapsedRow,
  WorkspaceMachineExpandedSection,
  type WorkspaceMachineAccordionMeta,
} from './workspace-machine-accordion';

export type MachineAgentSettingsProps = {
  selectedMachineId: MachineId | null;
  onSelectedMachineChange: (next: MachineId | null) => void;
  mode?: 'agents' | 'machines';
};

const createMachineRequestId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const waitForMonitorSessionRemoval = async (args: {
  runtime: WorkspaceRuntime;
  machineId: MachineId;
  sessionId: SessionId;
  timeoutMs: number;
  timeoutMessage: string;
}): Promise<void> =>
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      unsubscribe?.();
      if (error) reject(error);
      else resolve();
    };

    timeout = setTimeout(() => finish(new Error(args.timeoutMessage)), args.timeoutMs);
    const nextUnsubscribe = args.runtime.subscribeMachineMonitor(args.machineId, (snapshot) => {
      if (snapshot && !snapshot.sessions.some((session) => session.sessionId === args.sessionId)) {
        finish();
      }
    });
    unsubscribe = nextUnsubscribe;
    if (settled) nextUnsubscribe();
    else args.runtime.forceMachineMonitorSample(args.machineId);
  });

async function pingMachineWithRuntime(args: {
  runtime: WorkspaceRuntime;
  workspaceId: WorkspaceId;
  machineId: MachineId;
  timeoutMessage: string;
  failedMessage: string;
}): Promise<number> {
  const requestId = createMachineRequestId();
  const startedAt = performance.now();
  const responsePromise = args.runtime.waitForMachinePingResponse(args.machineId, requestId, {
    timeoutMs: 30000,
  });
  args.runtime.sendControl({
    type: 'machine/ping',
    machineId: args.machineId,
    workspaceId: args.workspaceId,
    requestId,
  });
  const response = await responsePromise;
  if (!response) {
    throw new Error(args.timeoutMessage);
  }
  if (!response.success || response.message !== 'pong') {
    const errorMessage =
      typeof response.error === 'string' && response.error.length > 0
        ? response.error
        : args.failedMessage;
    throw new Error(errorMessage);
  }
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function MachineAgentSettings(props: MachineAgentSettingsProps) {
  if ((props.mode ?? 'agents') === 'machines') return <MachineSettingsView {...props} />;
  return <EmbeddedAgentSettings />;
}

function EmbeddedAgentSettings() {
  const machineId = useAtomValue(localMachineIdAtom);
  const machineIds = useMemo(() => (machineId ? [machineId] : []), [machineId]);
  useMachineFlockAgentConfigsForMachineIds(machineIds, { syncRemote: false });
  const configs = useAtomValue(getAllAgentConfigAtom);
  const setups = useAtomValue(getAllProviderSetupsAtom);
  return (
    <div className="space-y-4">
      <ModelConnectionSetting />
      <BundledCapabilitiesSetting />
      <AgentEngineCatalog
        configs={configs.filter((config) => config.machineId === machineId)}
        setups={setups.filter((setup) => setup.machineId === machineId)}
      />
    </div>
  );
}

function MachineSettingsView({
  selectedMachineId,
  onSelectedMachineChange,
}: Omit<MachineAgentSettingsProps, 'mode'>) {
  const { t } = useTranslation();
  const { openSettings } = useOpenSettings();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const authToken = useAtomValue(authTokenAtom);
  const developerModeEnabled = useAtomValue(developerModeEnabledAtom);
  const setSettingsDialogOpen = useSetAtom(settingsDialogOpenAtom);
  const sessionMetaCache = useAtomValue(sessionMetaCacheAtom);
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const workspaceSlug = useAtomValue(currentWorkspaceSlugAtom);
  // Remote daemon restart is brokered through the cloud control plane
  // (lifecycle token mint); machine sharing needs workspace members. Both are
  // cloud-only surfaces hidden on the local platform.
  const remoteMachinesAvailable = false;
  const { data: session } = useStableSession();
  const { activeOrganization } = useOrganization();
  const members = useMemo(() => activeOrganization?.members ?? [], [activeOrganization?.members]);
  const currentUserId = session?.user?.id ?? null;

  const { machines, accessByMachineId, isLoading } = useVisibleMachineMetas();
  const { projects: visibleLocalProjects, isLoading: visibleLocalProjectsLoading } =
    useVisibleLocalProjectsFromMachineIndex(
      { machines, accessByMachineId, isLoading },
      { enabled: true }
    );
  const visibleMachineIdsForAgentConfigs = useMemo(() => [...machines.keys()], [machines]);
  useMachineFlockAgentConfigsForMachineIds(visibleMachineIdsForAgentConfigs);
  const localMachineId = useAtomValue(localMachineIdAtom);
  const onlineMachineIds = useOnlineMachineIds();

  const allConfigs = useAtomValue(getAllAgentConfigAtom);
  const allSetups = useAtomValue(getAllProviderSetupsAtom);

  const [filter, setFilter] = [
    useAtomValue(machineSettingsFilterAtom),
    useSetAtom(machineSettingsFilterAtom),
  ];
  const effectiveFilter = filter;
  const [desktopExpandedMachineId, setDesktopExpandedMachineId] = useState<MachineId | null>(
    selectedMachineId
  );
  const selectionFramesRef = useRef<{ first: number; second: number | null } | null>(null);
  const usesDesktopMachineAccordion = !isMobile && remoteMachinesAvailable;
  const visibleSelectedMachineId = usesDesktopMachineAccordion
    ? desktopExpandedMachineId
    : selectedMachineId;

  useEffect(() => {
    const frames = selectionFramesRef.current;
    if (frames && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frames.first);
      if (frames.second !== null) cancelAnimationFrame(frames.second);
      selectionFramesRef.current = null;
    }
    if (usesDesktopMachineAccordion) setDesktopExpandedMachineId(selectedMachineId);
  }, [selectedMachineId, usesDesktopMachineAccordion]);

  useEffect(
    () => () => {
      const frames = selectionFramesRef.current;
      if (!frames || typeof cancelAnimationFrame !== 'function') return;
      cancelAnimationFrame(frames.first);
      if (frames.second !== null) cancelAnimationFrame(frames.second);
    },
    []
  );

  const selectDesktopMachine = useCallback(
    (nextMachineId: MachineId | null) => {
      setDesktopExpandedMachineId(nextMachineId);

      if (typeof requestAnimationFrame !== 'function') {
        onSelectedMachineChange(nextMachineId);
        return;
      }

      const previousFrames = selectionFramesRef.current;
      if (previousFrames) {
        cancelAnimationFrame(previousFrames.first);
        if (previousFrames.second !== null) cancelAnimationFrame(previousFrames.second);
      }

      const frames = { first: 0, second: null as number | null };
      // Keep URL/global selection in sync, but only after the optimistic row has
      // had a chance to paint. The detail body follows the same two-frame gate.
      frames.first = requestAnimationFrame(() => {
        frames.second = requestAnimationFrame(() => {
          selectionFramesRef.current = null;
          onSelectedMachineChange(nextMachineId);
        });
      });
      selectionFramesRef.current = frames;
    },
    [onSelectedMachineChange]
  );

  const canManageOthers = useMemo(
    () => canManageAllMachines(currentUserId, members),
    [currentUserId, members]
  );

  const machineOwnerMap = useMemo(() => {
    const map = new Map<string, MachineTabOwner>();
    for (const member of members) {
      map.set(member.userId, {
        id: member.userId,
        name: member.user?.name || member.user?.email || member.userId,
        image: member.user?.image,
        email: member.user?.email,
      });
    }
    return map;
  }, [members]);

  const { connectedProjectsByMachineId, directoryCountByMachineId } = useMemo(() => {
    const projectsByMachineId = new Map<MachineId, MachineConnectedProject[]>();
    const counts = new Map<MachineId, number>();
    for (const [key, entry] of visibleLocalProjects) {
      const projects = projectsByMachineId.get(entry.machineId) ?? [];
      projects.push({
        key,
        name: entry.project.name,
        rootPath: entry.project.rootPath,
      });
      projectsByMachineId.set(entry.machineId, projects);
      counts.set(entry.machineId, projects.length);
    }
    for (const projects of projectsByMachineId.values()) {
      projects.sort((left, right) => left.name.localeCompare(right.name));
    }
    return {
      connectedProjectsByMachineId: projectsByMachineId,
      directoryCountByMachineId: counts,
    };
  }, [visibleLocalProjects]);

  const agentCountByMachineId = useMemo(() => {
    const counts = new Map<MachineId, number>();
    for (const config of allConfigs) {
      counts.set(config.machineId, (counts.get(config.machineId) ?? 0) + 1);
    }
    return counts;
  }, [allConfigs]);

  const isOwnMachine = useCallback(
    (machine: MachineViewMeta) => {
      if (localMachineId && machine.id === localMachineId) return true;
      const access = accessByMachineId.get(machine.id);
      if (currentUserId && access?.ownerUserId === currentUserId) return true;
      return false;
    },
    [accessByMachineId, currentUserId, localMachineId]
  );

  const { items: tabItems } = useMemo(() => {
    return buildMachineTabItems({
      machines,
      accessByMachineId,
      onlineMachineIds,
      isOwnMachine,
      filter: effectiveFilter,
    });
  }, [machines, accessByMachineId, onlineMachineIds, isOwnMachine, effectiveFilter]);

  const allItems = useMemo(() => {
    return buildMachineTabItems({
      machines,
      accessByMachineId,
      onlineMachineIds,
      isOwnMachine,
      filter: { onlineOnly: false, mineOnly: false },
    }).items;
  }, [machines, accessByMachineId, onlineMachineIds, isOwnMachine]);
  const localMachineItems = useMemo(
    () => (localMachineId ? allItems.filter((item) => item.machine.id === localMachineId) : []),
    [allItems, localMachineId]
  );
  const filteredSharedItems = useMemo(
    () => tabItems.filter((item) => item.sharedWithTeam),
    [tabItems]
  );
  const totalSharedBeforeFilter = useMemo(
    () => allItems.filter((item) => item.sharedWithTeam).length,
    [allItems]
  );
  const ownPrivateItems = useMemo(
    () => allItems.filter((item) => item.isOwn && !item.sharedWithTeam),
    [allItems]
  );
  const getAccordionMeta = useCallback(
    (item: MachineTabItem): WorkspaceMachineAccordionMeta => {
      const ownerUserId =
        accessByMachineId.get(item.machine.id)?.ownerUserId ?? item.machine.ownerUserId ?? null;
      return {
        machine: item.machine,
        isOnline: item.isOnline,
        isLocal: item.machine.id === localMachineId,
        isPrivate: !item.sharedWithTeam,
        owner: ownerUserId ? (machineOwnerMap.get(ownerUserId) ?? null) : null,
        directoryCount: directoryCountByMachineId.get(item.machine.id) ?? 0,
        agentCount: agentCountByMachineId.get(item.machine.id) ?? 0,
      };
    },
    [
      accessByMachineId,
      agentCountByMachineId,
      directoryCountByMachineId,
      localMachineId,
      machineOwnerMap,
    ]
  );
  const openAgentsForMachine = useCallback(
    (machineId: MachineId) => {
      if (isMobile && workspaceSlug) {
        void navigate({
          to: '/$workspaceName/settings/agents',
          params: { workspaceName: workspaceSlug },
          search: { machine: machineId },
        });
        return;
      }
      onSelectedMachineChange(machineId);
      openSettings('agents');
    },
    [isMobile, navigate, onSelectedMachineChange, openSettings, workspaceSlug]
  );

  // Remote-capable Machines stays inside the filtered visible pool. A local-only
  // platform has no machine selection surface, so it binds directly to the
  // local machine and cannot be blanked by a stale list filter.
  const workspaceMachineSelectionPool = useMemo(
    () =>
      buildWorkspaceMachineSelectionPool({
        filteredItems: filteredSharedItems,
        allItems,
        selectedMachineId: visibleSelectedMachineId,
      }),
    [allItems, filteredSharedItems, visibleSelectedMachineId]
  );
  const selectionPool = remoteMachinesAvailable ? workspaceMachineSelectionPool : localMachineItems;
  const { resolved: resolvedDesktopMachine, nextSelectedMachineId } = useMemo(
    () =>
      resolveDesktopMachineSelection({
        pool: selectionPool,
        selectedMachineId: visibleSelectedMachineId,
        localMachineId,
      }),
    [selectionPool, visibleSelectedMachineId, localMachineId]
  );

  useEffect(() => {
    if (isMobile) return;
    if (machines.size === 0) return;
    if (remoteMachinesAvailable && visibleSelectedMachineId === null) return;
    if (nextSelectedMachineId !== visibleSelectedMachineId) {
      if (usesDesktopMachineAccordion) {
        selectDesktopMachine(nextSelectedMachineId);
      } else {
        onSelectedMachineChange(nextSelectedMachineId);
      }
    }
  }, [
    isMobile,
    machines,
    nextSelectedMachineId,
    onSelectedMachineChange,
    remoteMachinesAvailable,
    selectDesktopMachine,
    usesDesktopMachineAccordion,
    visibleSelectedMachineId,
  ]);

  const resolvedSelectedMachine: MachineViewMeta | undefined = isMobile
    ? !remoteMachinesAvailable
      ? localMachineId
        ? machines.get(localMachineId)
        : undefined
      : selectedMachineId
        ? machines.get(selectedMachineId)
        : undefined
    : remoteMachinesAvailable && visibleSelectedMachineId === null
      ? undefined
      : resolvedDesktopMachine;
  const configsForMachine = useMemo(() => {
    if (!resolvedSelectedMachine) return [] as AgentConfigMeta[];
    return allConfigs
      .filter((c) => c.machineId === resolvedSelectedMachine.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allConfigs, resolvedSelectedMachine]);
  const setupsForMachine = useMemo(() => {
    if (!resolvedSelectedMachine) return [] as ProviderSetupTask[];
    return allSetups
      .filter((setup) => setup.machineId === resolvedSelectedMachine.id)
      .sort((left, right) => left.createdAt - right.createdAt);
  }, [allSetups, resolvedSelectedMachine]);

  const actions = useMachineActions({
    currentUserId,
    localMachineId,
    canManageAllMachines: canManageOthers,
  });

  const isLocal = !!resolvedSelectedMachine && resolvedSelectedMachine.id === localMachineId;
  const isOwn = resolvedSelectedMachine ? isOwnMachine(resolvedSelectedMachine) : false;
  const selectedIsOnline =
    !!resolvedSelectedMachine && onlineMachineIds.has(resolvedSelectedMachine.id);
  const ownerName = resolvedSelectedMachine
    ? (machineOwnerMap.get(
        accessByMachineId.get(resolvedSelectedMachine.id)?.ownerUserId ??
          resolvedSelectedMachine.ownerUserId ??
          ''
      )?.name ?? null)
    : null;
  const selectedCanDelete =
    !!resolvedSelectedMachine &&
    canDeleteOfflineMachine({
      machine: resolvedSelectedMachine,
      isOnline: selectedIsOnline,
      currentUserId,
      localMachineId,
      canManageAllMachines: canManageOthers,
    });
  const selectedOwnerUserId =
    resolvedSelectedMachine && accessByMachineId.get(resolvedSelectedMachine.id)?.ownerUserId
      ? accessByMachineId.get(resolvedSelectedMachine.id)?.ownerUserId
      : resolvedSelectedMachine?.ownerUserId;
  const selectedCanManageLifecycle =
    remoteMachinesAvailable &&
    !!resolvedSelectedMachine &&
    !!currentUserId &&
    selectedOwnerUserId === currentUserId;
  // Probed for the single selected machine (both mobile detail + desktop pills).
  const selectedLifecycleCapability = useMachineLifecycleCapability({
    machineId: resolvedSelectedMachine?.id ?? null,
    enabled: selectedCanManageLifecycle && selectedIsOnline,
  });
  const selectedCanRemoteRestart =
    selectedCanManageLifecycle &&
    selectedIsOnline &&
    selectedLifecycleCapability?.canRemoteRestart === true;
  const machineMonitor = useMachineMonitor({
    machineId: resolvedSelectedMachine?.id ?? null,
    enabled: true,
    online: selectedIsOnline,
  });
  const monitorSessionMetas = useMemo(() => Object.values(sessionMetaCache), [sessionMetaCache]);
  const openMonitorSession = useCallback(
    (monitoredSession: AcpSessionMonitorSnapshot) => {
      const meta = monitorSessionMetas.find((entry) => entry.id === monitoredSession.sessionId);
      const parentSessionId =
        meta?.parentSessionId ?? monitoredSession.parentSessionId ?? monitoredSession.sessionId;
      const activeWorkspaceSlug = activeOrganization?.slug;
      if (!activeWorkspaceSlug) return;
      setSettingsDialogOpen(false);
      void navigate({
        to: '/$workspaceName/sessions/$sessionId',
        params: { workspaceName: activeWorkspaceSlug, sessionId: parentSessionId },
        search: {
          tab: formatSessionTabSearch(monitoredSession.sessionId, parentSessionId),
        },
      });
    },
    [activeOrganization?.slug, monitorSessionMetas, navigate, setSettingsDialogOpen]
  );
  const terminateMonitorSession = useCallback(
    async (machine: MachineViewMeta, monitoredSession: AcpSessionMonitorSnapshot) => {
      if (!runtime) {
        throw new Error(
          t('settings.devices.sessions.terminateUnavailable', 'Machine is unavailable')
        );
      }
      const response = await runtime.requestSessionTerminate(
        machine.id,
        monitoredSession.sessionId,
        { timeoutMs: 30_000 }
      );
      if (!response?.success) {
        throw new Error(
          response?.error ??
            t('settings.devices.sessions.terminateFailed', 'Failed to terminate ACP process')
        );
      }
      await waitForMonitorSessionRemoval({
        runtime,
        machineId: machine.id,
        sessionId: monitoredSession.sessionId,
        timeoutMs: 15_000,
        timeoutMessage: t(
          'settings.devices.sessions.terminateStillPresent',
          'The ACP process is still present in device monitoring'
        ),
      });
    },
    [runtime, t]
  );


  const pingMachine = useCallback(
    (machineId: MachineId): Promise<number> => {
      if (!runtime || !workspaceId) {
        return Promise.reject(
          new Error(t('chat.validation.missingContext', 'Missing workspace context'))
        );
      }

      return pingMachineWithRuntime({
        runtime,
        workspaceId,
        machineId,
        timeoutMessage: t('settings.agent.machinePing.timeout', 'Ping timed out'),
        failedMessage: t('settings.agent.machinePing.failed', 'Ping failed'),
      });
    },
    [runtime, t, workspaceId]
  );

  const restartMachine = useCallback(
    async (machineId: MachineId) => {
      if (!runtime || !workspaceId || !authToken) {
        throw new Error(t('chat.validation.missingContext', 'Missing workspace context'));
      }

      const requestId = createMachineRequestId();
      const minted = await mintMachineLifecycleRequestToken({
        workspaceId,
        machineId,
        action: 'restart',
        requestId,
        sessionToken: authToken,
      });
      if (!minted.ok) {
        throw new Error(minted.error);
      }

      const responsePromise = runtime.waitForMachineRestartResponse(machineId, requestId, {
        timeoutMs: 30000,
      });
      runtime.sendControl({
        type: 'machine/restart',
        machineId,
        workspaceId,
        requesterUserId: minted.requesterUserId,
        requestToken: minted.requestToken,
        requestId,
      });
      const response = await responsePromise;
      if (!response) {
        throw new Error(
          t('settings.agent.machineLifecycle.restartTimeout', 'Restart request timed out')
        );
      }
      if (!response.success || !response.accepted) {
        throw new Error(
          response.error ||
            t('settings.agent.machineLifecycle.restartFailed', 'Restart request failed')
        );
      }
    },
    [authToken, runtime, t, workspaceId]
  );

  const hasMachines = machines.size > 0;

  if (isLoading && !hasMachines) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('workspace.machines.loadingVisibility', 'Loading machines')}
      </div>
    );
  }

  if (!hasMachines) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        {t('workspace.machines.empty', 'No machines connected')}
      </div>
    );
  }

  const title = t('settings.tabs.machines', 'Machines');
  const subtitle = t(
    'settings.categories.machines.description',
    'View workspace machines and manage the machines you own.'
  );

  const header = (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {remoteMachinesAvailable ? (
          <MachineListFilterButton filter={effectiveFilter} onFilterChange={setFilter} />
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );

  const sharedAccordionItems = workspaceMachineSelectionPool.filter((item) => item.sharedWithTeam);

  const renderDesktopMachineSection = (item: MachineTabItem) => {
    const meta = getAccordionMeta(item);
    const expanded = item.machine.id === resolvedSelectedMachine?.id;
    if (!expanded) {
      return (
        <WorkspaceMachineCollapsedRow
          key={item.machine.id}
          meta={meta}
          onExpand={() => selectDesktopMachine(item.machine.id)}
        />
      );
    }

    return (
      <WorkspaceMachineExpandedSection
        key={item.machine.id}
        meta={meta}
        onCollapse={() => selectDesktopMachine(null)}
      >
        <MachineDetailPane
          key={item.machine.id}
          mode="devices"
          readOnly={!isOwn}
          machine={item.machine}
          configs={configsForMachine}
          setups={setupsForMachine}
          isOwn={isOwn}
          isLocal={isLocal}
          ownerName={ownerName}
          canDelete={isOwn && selectedCanDelete}
          onRename={actions.renameMachine}
          onDelete={actions.deleteMachine}
          onPing={isOwn && developerModeEnabled ? pingMachine : undefined}
          onRestartDaemon={isOwn && selectedCanRemoteRestart ? restartMachine : undefined}
          monitorSnapshot={machineMonitor.snapshot}
          monitorState={machineMonitor.state}
          monitorSessionMetas={monitorSessionMetas}
          onOpenMonitorSession={openMonitorSession}
          onTerminateMonitorSession={
            isOwn
              ? (monitoredSession) => terminateMonitorSession(item.machine, monitoredSession)
              : undefined
          }
          footer={
            <MachineConnectedResources
              machineId={item.machine.id}
              configs={configsForMachine}
              preloadedProjects={connectedProjectsByMachineId.get(item.machine.id) ?? []}
              projectsLoading={visibleLocalProjectsLoading}
              readOnly={!isOwn}
              onManageAgents={() => openAgentsForMachine(item.machine.id)}
            />
          }
          accordion={{
            meta,
            onCollapse: () => selectDesktopMachine(null),
            headerRenderedExternally: true,
          }}
        />
      </WorkspaceMachineExpandedSection>
    );
  };

  if (!remoteMachinesAvailable) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-4">
        {header}
        {resolvedSelectedMachine ? (
          <MachineDetailPane
            key={resolvedSelectedMachine.id}
            mode="devices"
            machine={resolvedSelectedMachine}
            configs={configsForMachine}
            setups={setupsForMachine}
            isOwn={isOwn}
            isLocal={isLocal}
            ownerName={ownerName}
            canDelete={isOwn && selectedCanDelete}
            onRename={actions.renameMachine}
            onDelete={actions.deleteMachine}
            onPing={isOwn && developerModeEnabled ? pingMachine : undefined}
              onRestartDaemon={isOwn && selectedCanRemoteRestart ? restartMachine : undefined}
              monitorSnapshot={machineMonitor.snapshot}
            monitorState={machineMonitor.state}
            monitorSessionMetas={monitorSessionMetas}
            onOpenMonitorSession={openMonitorSession}
            onTerminateMonitorSession={(monitoredSession) =>
              terminateMonitorSession(resolvedSelectedMachine, monitoredSession)
            }
            footer={
              <MachineConnectedResources
                machineId={resolvedSelectedMachine.id}
                configs={configsForMachine}
                preloadedProjects={
                  connectedProjectsByMachineId.get(resolvedSelectedMachine.id) ?? []
                }
                projectsLoading={visibleLocalProjectsLoading}
                onManageAgents={() => openAgentsForMachine(resolvedSelectedMachine.id)}
              />
            }
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {header}

      <div className="space-y-3">
        {sharedAccordionItems.length > 0 ? (
          sharedAccordionItems.map(renderDesktopMachineSection)
        ) : (
          <div className="rounded-xl border border-border/50 bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground">
            {totalSharedBeforeFilter === 0
              ? t('workspace.machines.empty', 'No machines connected')
              : t('settings.agent.machineTabs.filter.noMatch', 'No machines match these filters.')}
            {totalSharedBeforeFilter > 0 ? (
              <div className="mt-2">
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0 text-xs"
                  onClick={() => setFilter({ onlineOnly: false, mineOnly: false })}
                >
                  {t('settings.agent.machineTabs.filter.reset', 'Clear filter')}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {ownPrivateItems.length > 0 ? (
        <section className="space-y-3 pt-3">
          <div className="px-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t('settings.machines.yourPrivateMachines', 'Your private machines')}
              </h3>
              <span className="text-xs tabular-nums text-muted-foreground">
                {ownPrivateItems.length}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t(
                'settings.machines.privateMachinesHint',
                'These machines are not available to other workspace members. Select one here to manage sharing.'
              )}
            </p>
          </div>
          <div className="space-y-3">{ownPrivateItems.map(renderDesktopMachineSection)}</div>
        </section>
      ) : null}
    </div>
  );
}
