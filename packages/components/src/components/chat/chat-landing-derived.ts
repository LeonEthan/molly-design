import type { ChatLandingHintType } from './chat-landing-view';

export type SessionContextType = 'local' | 'chat';

type ChatLandingProjectRefLike = {
  kind?: string | null;
  localProjectId?: string | null;
};

export type ChatLandingProjectSession = {
  machineId: string;
  project?: ChatLandingProjectRefLike | null;
  lastMessageAt?: number | null;
};

export type ChatLandingProjectRecency = {
  byProject: ReadonlyMap<string, number>;
};

type ChatLandingLocalProjectSortItem = {
  key: string;
  project: {
    name: string;
    lastOpenedAtMs?: number | null;
    createdAtMs?: number | null;
  };
};

type ChatLandingMachineOnlineMeta = {
  id: string;
};

export interface ChatLandingMachineReachableArgs {
  machineId: string;
  localMachineId?: string | null;
  machines: ReadonlyMap<string, ChatLandingMachineOnlineMeta>;
  /** Presence-based machine liveness (see useMachineOnlineStatus). */
  isMachineOnline: (machineId: string) => boolean;
}

export interface ChatLandingHasOnlineMachineArgs {
  localMachineId?: string | null;
  machines: ReadonlyMap<string, ChatLandingMachineOnlineMeta>;
  isMachineOnline: (machineId: string) => boolean;
}

export interface ChatLandingSubmitDisabledArgs {
  submitting: boolean;
  hasBlockingImages: boolean;
  hasBlockingFiles: boolean;
  hasSendableContent: boolean;
  contextType: SessionContextType;
  workdirMode?: 'local' | 'worktree';
  hasSelectedLocalProject: boolean;
  isRuntimeInitializing: boolean;
  isLoadingLocalGitState: boolean;
  hasLocalGitStateError: boolean;
}

export type ChatLandingComposerStatus<TMessage = unknown> = {
  message: TMessage;
  tone: 'error' | 'warning' | 'info';
};

export interface ChatLandingVisibleComposerStatusArgs<TMessage = unknown> {
  contextType: SessionContextType;
  composerStatus: ChatLandingComposerStatus<TMessage> | null;
  localGitStateError: string | null;
  selectedMachineProjectStatus?: ChatLandingComposerStatus<TMessage> | null;
}

export interface ChatLandingInitialDataLoadingArgs {
  isRuntimeInitializing: boolean;
  isVisibleMachinesLoading: boolean;
  isDocMetaCacheReady: boolean;
  localMachineStateAttempted: boolean;
  hasSelectableMachine: boolean;
}

export interface ChatLandingSelectedMachineProjectStatusArgs {
  contextType: SessionContextType;
  selectedMachineId?: string | null;
  hasSelectedLocalProject: boolean;
  hasAnyVisibleLocalProject: boolean;
  selectedMachineHasVisibleLocalProject: boolean;
  isVisibleLocalProjectsLoading: boolean;
  isDocMetaCacheReady: boolean;
}

export type ChatLandingSelectedMachineProjectStatus =
  | 'no-projects-on-selected-machine'
  | 'no-local-projects'
  | null;

function getFiniteTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getSessionLocalProjectKey(session: ChatLandingProjectSession): string | null {
  if (session.project?.kind !== 'local') {
    return null;
  }
  const localProjectId = session.project.localProjectId?.trim();
  if (!session.machineId || !localProjectId) {
    return null;
  }
  return `${session.machineId}:${localProjectId}`;
}

function recordLatestTimestamp(map: Map<string, number>, key: string | null, value: unknown): void {
  if (!key) return;
  const timestamp = getFiniteTimestamp(value);
  if (timestamp === null) return;
  const previous = map.get(key);
  if (previous === undefined || timestamp > previous) {
    map.set(key, timestamp);
  }
}

function compareNullableTimestampDesc(left: number | undefined, right: number | undefined): number {
  const leftTimestamp = getFiniteTimestamp(left);
  const rightTimestamp = getFiniteTimestamp(right);
  if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }
  if (leftTimestamp !== null && rightTimestamp === null) return -1;
  if (leftTimestamp === null && rightTimestamp !== null) return 1;
  return 0;
}

export function getChatLandingProjectRecency(
  sessions: Iterable<ChatLandingProjectSession>
): ChatLandingProjectRecency {
  const byProject = new Map<string, number>();
  for (const session of sessions) {
    recordLatestTimestamp(byProject, getSessionLocalProjectKey(session), session.lastMessageAt);
  }
  return { byProject };
}

export function compareChatLandingLocalProjectByRecency(
  left: ChatLandingLocalProjectSortItem,
  right: ChatLandingLocalProjectSortItem,
  latestMessageAtByProject: ReadonlyMap<string, number>
): number {
  const timestampComparison = compareNullableTimestampDesc(
    latestMessageAtByProject.get(left.key),
    latestMessageAtByProject.get(right.key)
  );
  if (timestampComparison !== 0) return timestampComparison;
  const projectTimestampComparison = compareNullableTimestampDesc(
    left.project.lastOpenedAtMs ?? left.project.createdAtMs ?? undefined,
    right.project.lastOpenedAtMs ?? right.project.createdAtMs ?? undefined
  );
  if (projectTimestampComparison !== 0) return projectTimestampComparison;
  const nameComparison = left.project.name.localeCompare(right.project.name);
  if (nameComparison !== 0) return nameComparison;
  return left.key.localeCompare(right.key);
}

// Single source of truth for the two empty-local-project i18n keys so the
// selector empty-text and the composer warning can't drift apart. Each caller
// still decides its own scope; only the key pairing is shared.
export function getEmptyLocalProjectsMessageKey(scopedToSelectedMachine: boolean): string {
  return scopedToSelectedMachine
    ? 'chat.mobileHome.emptyLocalProjects'
    : 'chat.mobileHome.emptyLocalProjectsAllMachines';
}

export function getChatLandingHintType({
  hasNoMachine,
  hasNoAgentConfig,
  isInitialDataLoading,
}: {
  hasNoMachine: boolean;
  hasNoAgentConfig: boolean;
  isInitialDataLoading: boolean;
}): ChatLandingHintType {
  // Suppress the empty-state banners while the first load is still in flight.
  // Otherwise the UI would falsely tell the user they have no machine / no
  // agent during the brief window before machine metadata and agent configs
  // arrive on app launch.
  if (isInitialDataLoading) {
    return null;
  }
  if (hasNoMachine) {
    return 'no-machine';
  }
  if (hasNoAgentConfig) {
    return 'no-agent-config';
  }
  return null;
}

export function getChatLandingInitialDataLoading({
  isRuntimeInitializing,
  isVisibleMachinesLoading,
  isDocMetaCacheReady,
  localMachineStateAttempted,
  hasSelectableMachine,
}: ChatLandingInitialDataLoadingArgs): boolean {
  if (isRuntimeInitializing || !isDocMetaCacheReady || !localMachineStateAttempted) {
    return true;
  }

  return isVisibleMachinesLoading && !hasSelectableMachine;
}

export function getChatLandingSelectedMachineProjectStatus({
  contextType,
  selectedMachineId,
  hasSelectedLocalProject,
  hasAnyVisibleLocalProject,
  selectedMachineHasVisibleLocalProject,
  isVisibleLocalProjectsLoading,
  isDocMetaCacheReady,
}: ChatLandingSelectedMachineProjectStatusArgs): ChatLandingSelectedMachineProjectStatus {
  if (contextType !== 'local' || !selectedMachineId || hasSelectedLocalProject) {
    return null;
  }

  if (isVisibleLocalProjectsLoading || !isDocMetaCacheReady) {
    return null;
  }

  if (selectedMachineHasVisibleLocalProject) {
    return null;
  }

  return hasAnyVisibleLocalProject ? 'no-projects-on-selected-machine' : 'no-local-projects';
}

export function isChatLandingMachineReachable({
  machineId,
  localMachineId,
  machines,
  isMachineOnline,
}: ChatLandingMachineReachableArgs): boolean {
  if (machineId === localMachineId) return true;
  return machines.has(machineId) && isMachineOnline(machineId);
}

export function getChatLandingHasAnyOnlineMachine({
  localMachineId,
  machines,
  isMachineOnline,
}: ChatLandingHasOnlineMachineArgs): boolean {
  if (localMachineId) return true;

  for (const machine of machines.values()) {
    if (
      isChatLandingMachineReachable({
        machineId: machine.id,
        localMachineId,
        machines,
        isMachineOnline,
      })
    ) {
      return true;
    }
  }

  return false;
}

export function getChatLandingSubmitDisabled({
  submitting,
  hasBlockingImages,
  hasBlockingFiles,
  hasSendableContent,
  contextType,
  workdirMode = 'local',
  hasSelectedLocalProject,
  isRuntimeInitializing,
  isLoadingLocalGitState,
  hasLocalGitStateError,
}: ChatLandingSubmitDisabledArgs): boolean {
  if (submitting || hasBlockingImages || hasBlockingFiles || !hasSendableContent) {
    return true;
  }

  return (
    contextType === 'local' &&
    hasSelectedLocalProject &&
    (isRuntimeInitializing ||
      (workdirMode === 'worktree' && (isLoadingLocalGitState || hasLocalGitStateError)))
  );
}

export function getChatLandingVisibleComposerStatus<TMessage>({
  contextType,
  composerStatus,
  selectedMachineProjectStatus,
}: ChatLandingVisibleComposerStatusArgs<TMessage>): ChatLandingComposerStatus<
  TMessage | string
> | null {
  if (composerStatus) {
    return composerStatus;
  }
  if (contextType !== 'local') {
    return null;
  }
  // Raw local Git / RPC transport failures have a scoped retry control and
  // must not take over the landing composer as status copy.
  return selectedMachineProjectStatus ?? null;
}

export type ChatLandingPreSelectionIntent = {
  context: SessionContextType | undefined;
  machine: string | undefined;
  project: string | undefined;
};

/** Identity of one URL-named selection (pre-selection intent or mirrored state). */
export function buildChatLandingPreSelectionKey({
  context,
  machine,
  project,
}: ChatLandingPreSelectionIntent): string {
  return `${context}|${machine}|${project}`;
}

/** Search-parameter contract of the `/$workspaceName/chat` route. */
export type ChatLandingSearch = {
  context?: SessionContextType;
  machine?: string;
  project?: string;
};

export function parseChatLandingSearch(search: Record<string, unknown>): ChatLandingSearch {
  return {
    context: search.context === 'local' || search.context === 'chat' ? search.context : undefined,
    machine: typeof search.machine === 'string' ? search.machine : undefined,
    project: typeof search.project === 'string' ? search.project : undefined,
  };
}

/**
 * `machineId:localProjectId` named by the current URL, or null. Shared by the
 * sidebar's row highlight and by the selection-URL mirror's participation
 * checks over the same URL contract.
 */
export function getSelectedLocalProjectKey(
  pathname: string,
  workspaceSlug: string | null,
  search?: Record<string, unknown>
): string | null {
  const workspacePrefix = workspaceSlug ? `/${workspaceSlug}` : '';
  const normalizedPath =
    workspaceSlug && pathname.startsWith(workspacePrefix)
      ? pathname.slice(workspacePrefix.length) || '/'
      : pathname;

  const segments = normalizedPath.split('/').filter(Boolean);

  // New route: /chat?context=local&machine=X&project=Y
  if (
    segments[0] === 'chat' &&
    search?.context === 'local' &&
    typeof search?.machine === 'string' &&
    typeof search?.project === 'string'
  ) {
    return `${search.machine}:${search.project}`;
  }

  // Legacy route: /local/$machineId/$localProjectId
  if (segments[0] !== 'local') return null;
  const machineId = segments[1];
  const localProjectId = segments[2];
  if (!machineId || !localProjectId) return null;
  return `${machineId}:${localProjectId}`;
}

export type ChatLandingEffectiveSelection = {
  contextType: SessionContextType;
  machineId: string | null;
  localProjectId: string | null;
};

/**
 * The chat-route search params that truthfully name the composer's current
 * selection. An incomplete selection (a context with nothing chosen yet) maps
 * to an empty search: the URL then names nothing rather than something stale.
 */
export function getChatLandingSelectionSearch({
  contextType,
  machineId,
  localProjectId,
}: ChatLandingEffectiveSelection): ChatLandingSearch {
  if (contextType === 'chat') {
    return { context: 'chat' };
  }
  if (contextType === 'local' && machineId && localProjectId) {
    return { context: 'local', machine: machineId, project: localProjectId };
  }
  return {};
}

export type ChatLandingSelectionSyncDecision = 'skip' | 'arm' | 'sync';

/**
 * Whether the landing should mirror its effective selection back into the URL.
 *
 * Once the URL names a selection it must keep telling the truth: steering or
 * clearing the composer selection would otherwise leave a stale project in the
 * URL, making that project's sidebar row an identical-URL no-op. A URL that
 * names nothing stays untouched, so restored defaults and auto-selection never
 * rewrite a plain landing address.
 *
 * `arm` covers the commit in which a URL intent was just applied: the observed
 * selection still predates the application, so mirroring would race the intent
 * and write the stale selection back over it. The caller arms the mirror and
 * compares again once the applied selection has rendered.
 */
export function getChatLandingSelectionSyncDecision({
  urlNamesSelection,
  intentApplied,
  armed,
  urlKey,
  selectionKey,
}: {
  urlNamesSelection: boolean;
  intentApplied: boolean;
  armed: boolean;
  urlKey: string;
  selectionKey: string;
}): ChatLandingSelectionSyncDecision {
  if (!urlNamesSelection || !intentApplied) return 'skip';
  if (!armed) return 'arm';
  return selectionKey === urlKey ? 'skip' : 'sync';
}
