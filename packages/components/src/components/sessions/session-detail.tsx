import { mollyStorage } from '@/lib/product-storage';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { DESIGN_CANVAS_TOOLBAR_MIN_WIDTH, DesignCanvas } from './design-canvas';
import { Loader2, PanelLeft, PanelRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { useRouter } from '@tanstack/react-router';
import { useComposerNavigationFocus } from '../chat/submission/use-composer-navigation-focus';
import {
  buildPendingUserHistoryEntry,
  getAcpCapabilityCacheKey,
  getServerNow,
  getSessionRoomId,
  getAcpCapabilityCacheEntryAuthority,
  resolveProjectGitHubRepo,
  SessionForkOperationSchema,
  type CommentReferencePayload,
  type LocalProjectHistoryProvider,
  type LocalProjectId,
  type LocalProjectMeta,
  type SessionId,
  type SessionMeta,
  type ConversationMessage,
  type VisualAnnotationReferencePayload,
  type WorkspaceId,
} from '@molly/shared';
import {
  SessionChatInterface,
  type SessionChatInterfaceHandle,
} from '@/components/sessions/session-chat-interface';

import { type SessionForkDestination } from '@/components/sessions/session-fork-destination-menu';
import {
  clearSessionChatInputDrafts,
  setSessionChatInputTextDraft,
} from '@/components/sessions/session-chat-input-area';
import {
  RenameSessionDialog,
  type RenameSessionDialogTarget,
} from '@/components/sessions/rename-session-dialog';
import { ChatShareImageDialog } from '@/components/sessions/chat-share-image-dialog';
import {
  DraftSessionChatInterface,
  type DraftSessionChatInterfaceHandle,
  type DraftSessionSendPayload,
} from '@/components/sessions/draft-session-chat-interface';
import { SessionMentionDropLayer } from '@/components/sessions/session-mention-drop-layer';
import { useMachineOnlineStatus } from '@/hooks/use-machine-online-status';
import { useStableCallback } from '@/hooks/use-stable-callback';
import { useAtomValue, useSetAtom } from 'jotai';
import { selectAtom } from 'jotai/utils';
import { isMacOSElectronRenderer, useElectronFullscreen } from '@/lib/electron';
import { useWindowsCaptionPadClass } from '@/ui/window-drag-region';
import {
  getZenAwarePanelToggleState,
  navigationSidebarHiddenAtom,
  showNavigationSidebarAtom,
  zenLayoutModeAtom,
} from '@/atoms/layout-state';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useTabStatus, type TabStatus } from '@/hooks/use-tab-status';
import {
  currentWorkspaceIdAtom,
  currentWorkspaceSlugAtom,
  activeWorkspaceRuntimeAtom,
  runtimeInitializingAtom,
} from '@/atoms';
import { mollyControlConnectionStateAtom } from '@/atoms/control-connection';
import { localHomeDirAtom, localMachineIdAtom } from '@/atoms/local-probe';
import {
  sessionMetaAtomFamily,
  childSessionsAtomFamily,
  archivedChildSessionsAtomFamily,
  sideSessionsAtomFamily,
  docMetaCacheReadyAtom,
} from '@/atoms/doc-meta';
import { sessionLiveStatusAtomFamily } from '@/atoms/presence';
import { SessionTabBar, type ViewerTabItem } from './session-tab-bar';
import {
  getSideChatLauncherState,
  getSidePanelTabSelection,
  getSidePanelTabCloseFallback,
  getSidePanelTabStateAfterClose,
  getSideSessionPanelTabId,
  isViewerTabId,
  parseSideSessionPanelTabId,
  SessionSidePanelEmptyState,
  SessionSidePanelTabBar,
  type SessionSidePanelOption,
  type SessionSidePanelTabItem,
} from './session-side-panel-tab-bar';
import { getSessionTabCloseTarget, type SessionTabFocusRegion } from './session-tab-close-target';
import { toast } from 'sonner';

import { SessionConversationDiffPanel } from './session-conversation-diff-panel';
import { SessionFileContentView, type SessionFileSaveViewState } from './session-file-content-view';
import { SessionBrowserPanel } from './session-browser-panel';
import { deletePrCacheEntriesForSession } from '@/lib/github-pr-cache';
import { FileTreeView } from './components/file-tree-view';
import { useSessionFileActions } from '@/hooks/use-session-file-actions';
import { SessionFileActionsMenu } from './session-file-actions-menu';
import { getCommandKeybindings, useCommand } from '@/lib/commands';
import { useDesktopTabCloser } from '@/lib/desktop-tab-or-window-close';
import { cn, getBasename } from '@/lib';

import {
  resolveSessionFileOpenTarget,
  type SessionFileOpenPathKind,
} from '@/lib/session-file-open-target';
import { SessionNotFound } from './session-not-found';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { useSessionActions } from '@/hooks/use-session-actions';
import { useResolvedMachineMeta } from '@/hooks/use-resolved-machine-meta';
import { areStringArraysEqual } from './session-diff-summary';
import {
  areDiffCommentFocusTargetsEqual,
  getDiffCommentFocusTargetFromReference,
  type DiffCommentFocusTarget,
} from './session-conversation-diff-types';
import { useSessionDiffSummary } from './use-session-diff-summary';
import { userAtom } from '@/atoms';
import {
  appendTabOrderId,
  createDraftSessionTab,
  filterPendingPromotedChildSessions,
  getDraftTabLabel,
  isDraftSessionTabId,
  mergeTabOrderGroup,
  readPersistedDraftTabs,
  readStoredLastActiveTabState,
  readStoredTabOrder,
  removeTabOrderId,
  replaceTabOrderId,
  writePersistedDraftTabs,
  writeStoredLastActiveTabState,
  writeStoredTabOrder,
  type DraftSessionTab,
  type PersistedSidePanelTab,
} from '@/lib/session-draft-tabs';
import {
  getPullRequestNumber,
  getPullRequestRepoFullName,
  getSessionGitHubState,
} from '@/lib/session-github-state';
import {
  resolveMachineDotlodyPath,
  resolveSessionWorkspacePath,
} from '@/lib/session-workspace-path';
import {
  formatExplicitSessionTabSearch,
  formatSessionTabSearch,
  parseSessionTabSearch,
  resolveActiveSessionTab,
} from '@/lib/session-tab-url';
import {
  getSessionNavigationLocation,
  type SessionNavigationTarget,
} from '@/lib/session-navigation';
import {
  getSessionDetailInitialTabState,
  revealDesignCanvas,
} from '@/lib/session-detail-initial-state';
import { recordSessionRenderTrace, shortTraceId } from '@/lib/session-render-trace';
/* Relative, not `@/providers/*`: the Electron web tsconfig maps only an
   allowlist of `@/` subpaths and has no `@/providers/*` entry, so the alias
   spelling type-checks here but breaks `@molly/electron`. */
import { useWorkspaceRouteTargetSlug } from '../../providers/workspace-route-target';
import {
  resolveSessionFileProviderOpenPath,
  type SessionFileProviderOpenPathResolution,
} from '@/lib/session-file-provider-symlink';
import {
  getProviderFileViewerTabId as getFileViewerTabId,
  refreshPinnedProviderFileViewerTab,
} from '@/lib/session-file-provider-open-result';
import { canOpenHistoricalSessionDiffs } from '@/lib/session-file-provider';
import { useSessionDoc, useSessionDocSyncState } from '@/hooks/use-session-doc';
import { useConversationTail } from '@/hooks/use-conversation-view';
import { useDelayedFlag } from '@/hooks/use-delayed-flag';
import { isSyncingRoomSyncState } from '@/lib/room-sync-state';
import {
  CODE_COLLAB_CHECKING_MESSAGE,
  useCodeCollabSessionFileProvider,
} from '@/hooks/use-code-collab-session-file-provider';
import { useCodeCollabRequestedRole } from '@/hooks/use-code-collab-requested-role';
import { resolveEffectiveCodeCollabWorkspaceId } from '@/lib/code-collab-workspace-id';
import { LoadingPlaceholder } from '@/components/loading-placeholder';
import { DesktopSessionDetailLayout } from './desktop-session-detail-layout';
import { DESIGN_PANEL_LAYOUT_ID, getDesignPanelDefaultSizes } from './design-panel-sizes';
import {
  resolveSessionDetailPresenceState,
  resolveSessionDetailVisibilityState,
} from '@/lib/session-detail-presence';
import {
  canUseProjectHistoryProjectControl,
  importProjectHistoryForLocalProject,
} from '@/lib/project-history-control-client';
import {
  getExternalHistoryProviderLabel,
  getExternalHistoryRefreshKey,
  shouldRefreshExternalHistoryOnOpen,
} from '@/lib/external-history-refresh';
import { useLocalResourceVisibility } from '@/hooks/use-local-resource-visibility';
import {
  EMPTY_COMMENT_REFERENCE_KEYS,
  getCommentReferenceKey,
} from '@/components/chat/comment-reference-state';
import {
  EMPTY_VISUAL_ANNOTATION_REFERENCE_KEYS,
  getVisualAnnotationReferenceKey,
} from '@/components/chat/visual-annotation-reference-state';
import { persistAgentSessionDefaults } from '@/lib/local-storage-cache';

type SidebarTab = PersistedSidePanelTab;

type ViewerTab =
  | {
      id: string;
      type: 'file';
      filePath: string;
      fileId?: string;
      label: string;
      startLine?: number;
      endLine?: number;
      focusRequestSeq?: number;
      /** One-shot request to enter the executable HTML preview after opening. */
      htmlPreviewRequestSeq?: number;
    }
  | {
      id: string;
      type: 'diff';
      turnId: string;
      filePaths: string[];
      focusFilePath: string | null;
      focusComment?: DiffCommentFocusTarget | null;
      focusRequestSeq: number;
      mode?: 'conversation' | 'base';
      label: string;
    };

type SessionDetailOpenFileOptions = {
  /** Defaults to `markdown-href`; see `lib/session-file-open-target.ts`. */
  readonly pathKind?: SessionFileOpenPathKind;
  /** Explicit 1-based anchor, for callers that have one without encoding it in the path. */
  readonly startLine?: number;
  readonly endLine?: number;
  /** Enter rendered HTML after the file snapshot becomes available. */
  readonly previewHtml?: boolean;
};

type ExternalHistoryRefreshViewState = {
  key: string;
  provider: LocalProjectHistoryProvider;
};

type PendingForkState = Record<
  string,
  {
    turnId: string;
    targetSessionId: SessionId;
    phase: 'requesting' | 'awaiting-history';
    placement: 'tab' | 'side-panel' | 'worktree';
  }
>;

const getPendingWorktreeForkStorageKey = (sessionId: SessionId) =>
  `molly:session:${sessionId}:pending-worktree-forks`;

function readPendingWorktreeForks(sessionId: SessionId): PendingForkState {
  if (typeof window === 'undefined') return {};
  try {
    const value = JSON.parse(
      mollyStorage.getItem(getPendingWorktreeForkStorageKey(sessionId)) ?? '{}'
    );
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, PendingForkState[string]] => {
        const pending = entry[1] as Partial<PendingForkState[string]> | null;
        return (
          !!pending &&
          pending.placement === 'worktree' &&
          pending.phase === 'awaiting-history' &&
          typeof pending.turnId === 'string' &&
          typeof pending.targetSessionId === 'string'
        );
      })
    );
  } catch {
    return {};
  }
}

function writePendingWorktreeForks(sessionId: SessionId, pendingForks: PendingForkState): void {
  if (typeof window === 'undefined') return;
  const durablePending = Object.fromEntries(
    Object.entries(pendingForks).filter(
      ([, pending]) => pending.placement === 'worktree' && pending.phase === 'awaiting-history'
    )
  );
  const key = getPendingWorktreeForkStorageKey(sessionId);
  if (Object.keys(durablePending).length === 0) {
    mollyStorage.removeItem(key);
    return;
  }
  mollyStorage.setItem(key, JSON.stringify(durablePending));
}

type ViewerTabSaveState = SessionFileSaveViewState & {
  readonly saveRequestSeq: number;
  readonly copyMarkdownRequestSeq: number;
};

const EMPTY_VIEWER_TAB_SAVE_STATE: ViewerTabSaveState = {
  dirty: false,
  canSave: false,
  saving: false,
  conflict: false,
  error: false,
  saveRequestSeq: 0,
  copyMarkdownRequestSeq: 0,
};

const EMPTY_LOCAL_PROJECTS: Record<LocalProjectId, LocalProjectMeta> = {};

const selectSessionDetailMeta = (meta: SessionMeta | undefined): SessionMeta | undefined => meta;

/**
 * Serialized meta, memoized on the object.
 *
 * This equality gate runs on every session-meta emission, and the retained
 * previous value was re-serialized each time even though only the incoming
 * one is new.
 */
const sessionDetailMetaFingerprints = new WeakMap<SessionMeta, string>();
const sessionDetailMetaFingerprint = (meta: SessionMeta): string => {
  const cached = sessionDetailMetaFingerprints.get(meta);
  if (cached !== undefined) return cached;
  const computed = JSON.stringify(meta);
  sessionDetailMetaFingerprints.set(meta, computed);
  return computed;
};

const sessionDetailMetaEqual = (
  left: SessionMeta | undefined,
  right: SessionMeta | undefined
): boolean =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    sessionDetailMetaFingerprint(left) === sessionDetailMetaFingerprint(right));

function PendingWorktreeForkObserver({
  targetSessionId,
  onCompleted,
  onFailed,
}: {
  targetSessionId: SessionId;
  onCompleted: () => void;
  onFailed: (message: string) => void;
}) {
  const { doc, history, ready } = useSessionDoc(targetSessionId, { syncEnabled: true });
  // The fork service appends the origin notice as the LAST entry of the cloned
  // history, so the always-hydrated tail is where it shows up.
  const { turns: tail } = useConversationTail(history);
  const terminalRef = useRef(false);
  useEffect(() => {
    if (!ready || terminalRef.current) return;
    const operation = SessionForkOperationSchema.safeParse(doc.forkOperation);
    if (operation.success && operation.data.state === 'failed') {
      terminalRef.current = true;
      onFailed(operation.data.error?.message ?? 'Unable to create the fork worktree');
      return;
    }
    const completed = tail.some((entry) =>
      (entry.items ?? []).some(
        (item) => item.type === 'system_notice' && item.name === 'session_fork_origin'
      )
    );
    if (!operation.success && completed) {
      terminalRef.current = true;
      onCompleted();
    }
  }, [doc.forkOperation, tail, onCompleted, onFailed, ready]);
  return null;
}

const areViewerTabsEquivalent = (prev: ViewerTab, next: ViewerTab): boolean => {
  if (prev.id !== next.id || prev.type !== next.type || prev.label !== next.label) {
    return false;
  }

  if (prev.type === 'file' && next.type === 'file') {
    return (
      prev.fileId === next.fileId &&
      prev.filePath === next.filePath &&
      prev.startLine === next.startLine &&
      prev.endLine === next.endLine &&
      prev.focusRequestSeq === next.focusRequestSeq &&
      prev.htmlPreviewRequestSeq === next.htmlPreviewRequestSeq
    );
  }

  if (prev.type === 'diff' && next.type === 'diff') {
    return (
      prev.turnId === next.turnId &&
      prev.mode === next.mode &&
      prev.focusFilePath === next.focusFilePath &&
      areDiffCommentFocusTargetsEqual(prev.focusComment, next.focusComment) &&
      prev.focusRequestSeq === next.focusRequestSeq &&
      areStringArraysEqual(prev.filePaths, next.filePaths)
    );
  }

  return false;
};

/**
 * Session detail page component.
 * Displays the chat interface for a single session.
 */
const SessionDetail = ({
  sessionId,
  urlTab,
  urlBrowser,
}: {
  sessionId: SessionId;
  urlTab?: string;
  urlPrNumber?: number;
  urlBrowser?: boolean;
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const claimNavigationFocus = useComposerNavigationFocus(sessionId);

  const isZenLayoutMode = useAtomValue(zenLayoutModeAtom);
  const setZenLayoutMode = useSetAtom(zenLayoutModeAtom);
  const isElectronFullscreen = useElectronFullscreen();
  const windowsCaptionPadClass = useWindowsCaptionPadClass();
  // Publish ephemeral "viewing this session" presence (drives the owning
  // machine's PR poller priority); actively cleared on switch/hide/unmount.
  const chatRefsMap = useRef<
    Map<string, SessionChatInterfaceHandle | DraftSessionChatInterfaceHandle | null>
  >(new Map());
  const commentReferenceChangeHandlersRef = useRef<
    Map<string, (references: CommentReferencePayload[]) => void>
  >(new Map());
  const visualAnnotationReferenceChangeHandlersRef = useRef<
    Map<string, (references: VisualAnnotationReferencePayload[]) => void>
  >(new Map());
  const sendingDraftIdsRef = useRef<Set<DraftSessionTab['id']>>(new Set());
  const desktopTabFocusRegionRef = useRef<SessionTabFocusRegion>('conversation');
  const initialTabState = getSessionDetailInitialTabState(sessionId, urlTab, {
    oneActiveSurface: false,
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => initialTabState.sidePanel.open);
  const isSidebarVisible = isSidebarOpen && !isZenLayoutMode;
  const revealRightSidebar = useCallback(() => {
    setZenLayoutMode(false);
    setIsSidebarOpen(true);
  }, [setZenLayoutMode]);
  /* Bumped whenever `isSidebarOpen` changes because side-panel state was
     RESTORED (session switch, `?pr=` deep link) rather than toggled by the
     user, so the desktop layout snaps the panel to its target width instead of
     animating a transition nobody asked for. See
     DesktopSessionDetailLayout.sidebarRestoreSeq. */
  const [sidebarRestoreSeq, setSidebarRestoreSeq] = useState(0);
  const [designToolbarHost, setDesignToolbarHost] = useState<HTMLDivElement | null>(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab | null>(
    () => initialTabState.sidePanel.tab
  );
  const [activeSideSessionId, setActiveSideSessionId] = useState<SessionId | null>(
    () => initialTabState.sidePanel.sideSessionId
  );
  const [openedSidebarTabs, setOpenedSidebarTabs] = useState<SidebarTab[]>(
    () => initialTabState.sidePanel.tabs
  );
  const [browserCandidateNavigationRequest, setBrowserCandidateNavigationRequest] = useState<{
    sessionId: SessionId;
    id: number;
  } | null>(null);
  const browserCandidateNavigationSequenceRef = useRef(0);
  const [viewerTabs, setViewerTabs] = useState<ViewerTab[]>(() => initialTabState.viewerTabs);
  const [activeViewerTabId, setActiveViewerTabId] = useState<string | null>(
    () => initialTabState.activeViewerTabId
  );
  const selectSidePanelTab = useCallback((tabId: string | null) => {
    if (tabId !== null) {
      desktopTabFocusRegionRef.current = 'side-panel';
    }
    const selection = getSidePanelTabSelection(tabId);
    setActiveSidebarTab(selection.activeSidebarTabId as SidebarTab | null);
    setActiveSideSessionId(selection.activeSideSessionId as SessionId | null);
    setActiveViewerTabId(selection.activeViewerTabId);
  }, []);
  const activateSidebarTab = useCallback(
    (tabId: SidebarTab) => {
      setOpenedSidebarTabs((current) => (current.includes(tabId) ? current : [...current, tabId]));
      selectSidePanelTab(tabId);
    },
    [selectSidePanelTab]
  );
  const [viewerTabSaveStates, setViewerTabSaveStates] = useState<
    Record<string, ViewerTabSaveState>
  >({});
  const [isFileQuickOpenOpen, setIsFileQuickOpenOpen] = useState(false);
  const [fileProviderRequestedByInteraction, setFileProviderRequestedByInteraction] =
    useState(false);
  const [localStateSessionId, setLocalStateSessionId] = useState(sessionId);
  const [canvasEntrySessionId, setCanvasEntrySessionId] = useState<SessionId | null>(null);
  const [commentReferenceKeysBySession, setCommentReferenceKeysBySession] = useState<
    Record<string, string[]>
  >({});
  const [visualAnnotationReferenceKeysBySession, setVisualAnnotationReferenceKeysBySession] =
    useState<Record<string, string[]>>({});
  const focusRequestSeqRef = useRef(0);
  const attemptedExternalHistoryRefreshKeysRef = useRef<Set<string>>(new Set());
  const [externalHistoryRefreshBySessionId, setExternalHistoryRefreshBySessionId] = useState<
    Record<string, ExternalHistoryRefreshViewState>
  >({});
  /* The render-phase route target wins over the atom. During a
     cross-workspace client navigation, `currentWorkspaceSlugAtom` still holds
     the PREVIOUS workspace's non-null slug until the ancestor `$workspaceName`
     route's own effect publishes the new one — a `?tab`/`?pr` write issued in
     that window with the atom slug navigates back into the old workspace.
     Every consumer here builds a URL for the CURRENT route, so all of them
     use the effective slug (same rule as `LoroAppSidebar`); the atom is only
     the fallback for hosts mounted without `WorkspaceRouteTargetProvider`. */
  const routeTargetWorkspaceSlug = useWorkspaceRouteTargetSlug();
  const atomWorkspaceSlug = useAtomValue(currentWorkspaceSlugAtom);
  const workspaceSlug = routeTargetWorkspaceSlug ?? atomWorkspaceSlug;
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom) as WorkspaceId | null;
  const isLeftSidebarHidden = useAtomValue(navigationSidebarHiddenAtom);
  const showNavigationSidebar = useSetAtom(showNavigationSidebarAtom);
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const runtimeInitializing = useAtomValue(runtimeInitializingAtom);
  const localMachineId = useAtomValue(localMachineIdAtom);
  const localHomeDir = useAtomValue(localHomeDirAtom);
  const user = useAtomValue(userAtom);
  const {
    accessByMachineId: sharingMachineAccessById,
    accessByProjectKey: sharingProjectAccessByKey,
    machineVisibilityLoading,
    localProjectVisibilityLoading,
  } = useLocalResourceVisibility();
  const controlConnectionState = useAtomValue(mollyControlConnectionStateAtom);
  // The local-token route can render before Convex workspace access fills
  // currentWorkspaceIdAtom. The workspace runtime already resolved the same id
  // from the cached slug, so Code Collab should not stay in bootstrap checking.
  const effectiveCodeCollabWorkspaceId = resolveEffectiveCodeCollabWorkspaceId({
    currentWorkspaceId,
    runtimeWorkspaceId: runtime?.workspaceId,
  });
  const sessionRoomId = getSessionRoomId(sessionId);
  const sessionMetaAtom = useMemo(
    () =>
      selectAtom(
        sessionMetaAtomFamily(sessionRoomId),
        selectSessionDetailMeta,
        sessionDetailMetaEqual
      ),
    [sessionRoomId]
  );
  const session = useAtomValue(sessionMetaAtom);
  const docMetaCacheReady = useAtomValue(docMetaCacheReadyAtom);
  const activeSession = session ?? null;
  const activeSessionLiveStatus = useAtomValue(
    sessionLiveStatusAtomFamily((activeSession?.id ?? '__no_session__') as SessionId)
  );
  const codeCollabRequestedRole = useCodeCollabRequestedRole();
  const hasFileProviderViewerTabs = useMemo(
    () => viewerTabs.some((tab) => tab.type === 'file' || tab.type === 'diff'),
    [viewerTabs]
  );
  const isFileProviderSidebarActive =
    isSidebarVisible && (activeSidebarTab === 'files' || activeSidebarTab === 'changes');
  const isSessionStateCurrent = localStateSessionId === sessionId;
  const activeSessionFileProviderRequested = Boolean(
    activeSession &&
    isSessionStateCurrent &&
    (isFileQuickOpenOpen ||
      hasFileProviderViewerTabs ||
      isFileProviderSidebarActive ||
      fileProviderRequestedByInteraction)
  );
  const activeSessionFileProviderEnabled = Boolean(
    activeSessionFileProviderRequested && effectiveCodeCollabWorkspaceId
  );
  const activeSessionCodeCollabFiles = useCodeCollabSessionFileProvider({
    workspaceId: effectiveCodeCollabWorkspaceId,
    sessionId: activeSession?.id ?? sessionId,
    enabled: activeSessionFileProviderEnabled,
    requestedRole: codeCollabRequestedRole,
    machineId: activeSession?.machineId,
    requestedByUserId: user?.id ?? activeSession?.userId,
    githubRepoFullName:
      (resolveProjectGitHubRepo(activeSession?.project) ?? activeSession?.repoFullName)?.trim() ??
      null,
    debugLabel: 'session-detail:file-provider',
  });
  const activeSessionFileProvider = activeSessionCodeCollabFiles.provider;
  const canOpenHistoricalDiffs = canOpenHistoricalSessionDiffs(activeSessionFileProvider);
  const activeSessionFileProviderBootstrapPending = Boolean(
    activeSessionFileProviderRequested && activeSession && !effectiveCodeCollabWorkspaceId
  );
  const activeSessionFileProviderPending =
    activeSessionFileProviderRequested &&
    !activeSessionFileProvider &&
    (activeSessionFileProviderBootstrapPending ||
      activeSessionCodeCollabFiles.status === 'checking' ||
      activeSessionCodeCollabFiles.status === 'loading');
  const activeSessionFileProviderMessage = activeSessionFileProviderBootstrapPending
    ? CODE_COLLAB_CHECKING_MESSAGE
    : activeSessionCodeCollabFiles.message;
  const parsedUrlTab = useMemo(() => parseSessionTabSearch(urlTab), [urlTab]);

  // Multi-tab: load child sessions
  const childSessionsAtom = useMemo(() => childSessionsAtomFamily(sessionId), [sessionId]);
  const childSessions = useAtomValue(childSessionsAtom);
  const sideSessionsAtom = useMemo(() => sideSessionsAtomFamily(sessionId), [sessionId]);
  const sideSessions = useAtomValue(sideSessionsAtom);
  const archivedChildSessionsAtom = useMemo(
    () => archivedChildSessionsAtomFamily(sessionId),
    [sessionId]
  );
  const archivedChildSessions = useAtomValue(archivedChildSessionsAtom);
  const [draftTabs, setDraftTabsState] = useState<DraftSessionTab[]>(() =>
    readPersistedDraftTabs(sessionId)
  );
  const [pendingDraftChildSessionIds, setPendingDraftChildSessionIds] = useState<
    Partial<Record<DraftSessionTab['id'], SessionId>>
  >({});
  const [pendingForks, setPendingForks] = useState<PendingForkState>(() =>
    readPendingWorktreeForks(sessionId)
  );
  const [dirtyForkConfirmation, setDirtyForkConfirmation] = useState<{
    source: SessionMeta;
    turnId: string;
    targetSessionId: SessionId;
  } | null>(null);
  const [closingSideSessionIds, setClosingSideSessionIds] = useState<Set<SessionId>>(
    () => new Set()
  );
  // Every side chat is a durable tab, so mounting them all would open one Loro
  // session doc per side chat on every session-detail mount — even for a user
  // who never expands the panel. A side chat mounts when it is first selected
  // and stays mounted afterwards, so switching panels never tears down its state.
  const [mountedSideSessionIds, setMountedSideSessionIds] = useState<Set<SessionId>>(
    () => new Set()
  );
  const [tabOrder, setTabOrderState] = useState<string[]>(() => readStoredTabOrder(sessionId));

  if (localStateSessionId !== sessionId) {
    const nextInitialTabState = getSessionDetailInitialTabState(sessionId, urlTab, {
      oneActiveSurface: false,
    });
    sendingDraftIdsRef.current.clear();
    desktopTabFocusRegionRef.current = 'conversation';
    setLocalStateSessionId(sessionId);
    setCanvasEntrySessionId(null);
    setSidebarRestoreSeq((seq) => seq + 1);
    setIsSidebarOpen(nextInitialTabState.sidePanel.open);
    setActiveSidebarTab(nextInitialTabState.sidePanel.tab);
    setActiveSideSessionId(nextInitialTabState.sidePanel.sideSessionId);
    setOpenedSidebarTabs(nextInitialTabState.sidePanel.tabs);
    setDraftTabsState(readPersistedDraftTabs(sessionId));
    setPendingDraftChildSessionIds({});
    setPendingForks(readPendingWorktreeForks(sessionId));
    setDirtyForkConfirmation(null);
    setClosingSideSessionIds(new Set());
    setMountedSideSessionIds(new Set());
    setTabOrderState(readStoredTabOrder(sessionId));
    setViewerTabs(nextInitialTabState.viewerTabs);
    setActiveViewerTabId(nextInitialTabState.activeViewerTabId);
    setViewerTabSaveStates({});
    setFileProviderRequestedByInteraction(false);
  }

  if (
    localStateSessionId === sessionId &&
    canvasEntrySessionId !== sessionId &&
    activeSession?.id === sessionId &&
    activeSession.design
  ) {
    const sidePanel = revealDesignCanvas({
      open: isSidebarOpen,
      tab: activeSidebarTab,
      tabs: openedSidebarTabs,
      sideSessionId: activeSideSessionId,
    });
    setCanvasEntrySessionId(sessionId);
    if (!isSidebarOpen) setSidebarRestoreSeq((seq) => seq + 1);
    setIsSidebarOpen(sidePanel.open);
    setActiveSidebarTab(sidePanel.tab);
    setOpenedSidebarTabs(sidePanel.tabs);
    setActiveSideSessionId(sidePanel.sideSessionId);
    setActiveViewerTabId(null);
  }

  const setDraftTabs = useCallback(
    (
      updater: DraftSessionTab[] | ((prev: DraftSessionTab[]) => DraftSessionTab[])
    ): DraftSessionTab[] => {
      let nextDraftTabs: DraftSessionTab[] = [];
      setDraftTabsState((prev) => {
        nextDraftTabs = typeof updater === 'function' ? updater(prev) : updater;
        return nextDraftTabs;
      });
      return nextDraftTabs;
    },
    []
  );

  // Child meta can appear before startSession() or fork RPC resolves. Hide a
  // requesting target until its RPC succeeds. Once acknowledged, mount the
  // child tab in the background and keep its source button loading until the
  // child conversation surface has durable history ready to paint.
  const requestingForkTargetIds = useMemo(
    () =>
      new Set(
        Object.values(pendingForks)
          .filter((pending) => pending.phase === 'requesting')
          .map((pending) => pending.targetSessionId)
      ),
    [pendingForks]
  );
  const visibleChildSessions = useMemo(
    () =>
      filterPendingPromotedChildSessions(
        childSessions,
        draftTabs,
        pendingDraftChildSessionIds
      ).filter((child) => !requestingForkTargetIds.has(child.id)),
    [childSessions, draftTabs, pendingDraftChildSessionIds, requestingForkTargetIds]
  );
  const visibleSideSessions = useMemo(
    () => sideSessions.filter((sideSession) => !requestingForkTargetIds.has(sideSession.id)),
    [requestingForkTargetIds, sideSessions]
  );

  const sessionGroupIds = useMemo(
    () => [
      ...visibleChildSessions.map((childSession) => childSession.id),
      ...draftTabs.map((draft) => draft.id),
    ],
    [visibleChildSessions, draftTabs]
  );
  const sessionTabOrder = useMemo(
    () => tabOrder.filter((tabId) => !isViewerTabId(tabId)),
    [tabOrder]
  );
  useEffect(() => {
    setViewerTabSaveStates((prev) => {
      const liveIds = new Set(viewerTabs.map((tab) => tab.id));
      const next: Record<string, ViewerTabSaveState> = {};
      let changed = false;
      for (const [tabId, state] of Object.entries(prev)) {
        if (liveIds.has(tabId)) {
          next[tabId] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [viewerTabs]);
  const orderedSessionTabIds = useMemo(() => {
    const orderedIds: string[] = [sessionId];
    const knownTabIds = new Set<string>([
      ...visibleChildSessions.map((childSession) => childSession.id),
      ...draftTabs.map((draft) => draft.id),
    ]);
    const seen = new Set<string>(orderedIds);

    for (const tabId of sessionTabOrder) {
      if (!knownTabIds.has(tabId) || seen.has(tabId)) {
        continue;
      }
      orderedIds.push(tabId);
      seen.add(tabId);
    }

    for (const childSession of visibleChildSessions) {
      if (!seen.has(childSession.id)) {
        orderedIds.push(childSession.id);
        seen.add(childSession.id);
      }
    }
    for (const draft of draftTabs) {
      if (!seen.has(draft.id)) {
        orderedIds.push(draft.id);
      }
    }

    return orderedIds;
  }, [draftTabs, sessionId, sessionTabOrder, visibleChildSessions]);

  const handleSessionTabReorder = useCallback(
    (orderedTabIds: string[]) => {
      setTabOrderState((prev) => mergeTabOrderGroup(prev, orderedTabIds, sessionGroupIds));
    },
    [sessionGroupIds]
  );

  useEffect(() => {
    writeStoredTabOrder(sessionId, tabOrder);
  }, [sessionId, tabOrder]);

  useEffect(() => {
    writePendingWorktreeForks(sessionId, pendingForks);
  }, [pendingForks, sessionId]);

  useEffect(() => {
    writePersistedDraftTabs(sessionId, draftTabs);
  }, [draftTabs, sessionId]);

  // The `?tab` search value is the single source of truth for the active
  // conversation tab; tab activation navigates instead of setting state, so
  // there is no second store to reconcile and no URL/state feedback loop
  // (#193). `resolveActiveSessionTab` owns the derivation rule: the URL is
  // taken at its word, so a named child whose meta has not reached the local
  // replica yet stays active (a pending surface renders below) instead of
  // bouncing the user back to the parent conversation.
  const activeTabSessionId = useMemo(
    () =>
      resolveActiveSessionTab(parsedUrlTab, {
        parentSessionId: sessionId,
        // Side chats never own a top tab, so a URL addressing one (an
        // opened-by link to a side-chat session) renders the parent.
        childSessionIdsResolvedToParent: [
          ...archivedChildSessions.map((s) => s.id),
          ...sideSessions.map((s) => s.id),
        ],
        draftTabIds: draftTabs.map((draft) => draft.id),
        promotedChildSessionIdsByDraftId: pendingDraftChildSessionIds,
      }),
    [
      parsedUrlTab,
      archivedChildSessions,
      draftTabs,
      pendingDraftChildSessionIds,
      sessionId,
      sideSessions,
    ]
  );
  // A URL-named child the meta replica has not delivered yet: keep it active
  // and render a pending surface instead of silently showing the parent.
  const activeTabIsPendingChild =
    activeTabSessionId !== sessionId &&
    !isDraftSessionTabId(activeTabSessionId) &&
    !visibleChildSessions.some((s) => s.id === activeTabSessionId);
  // The ordinary pending window (a just-promoted draft) lasts one replica
  // tick; the delayed flag keeps that from flashing a spinner.
  const showPendingChildTabState = useDelayedFlag(activeTabIsPendingChild, 300);
  const activeSessionTabId = useMemo<SessionId | null>(() => {
    if (activeTabSessionId === sessionId) return sessionId;
    return visibleChildSessions.find((s) => s.id === activeTabSessionId)?.id ?? null;
  }, [activeTabSessionId, sessionId, visibleChildSessions]);
  // The session meta for the currently active tab (may be parent or a child)
  const activeTabSession = useMemo(() => {
    if (activeTabSessionId === sessionId) return activeSession;
    return visibleChildSessions.find((s) => s.id === activeTabSessionId) ?? activeSession;
  }, [activeTabSessionId, sessionId, activeSession, visibleChildSessions]);
  const activeTabSessionMachineOnlineStatus = useMachineOnlineStatus(activeTabSession?.machineId);
  const activeDraftTab = useMemo(
    () => draftTabs.find((draft) => draft.id === activeTabSessionId) ?? null,
    [activeTabSessionId, draftTabs]
  );
  // A draft tab is not a session: mentioning the parent there is valid. Do not
  // fall back to `activeTabSession.id` — that resolves drafts to the parent.
  const sessionMentionExcludeId = activeDraftTab ? null : activeTabSessionId;
  const activeCommentReferenceKeys =
    commentReferenceKeysBySession[activeTabSessionId] ?? EMPTY_COMMENT_REFERENCE_KEYS;

  // Active session doc sync state for the visible top headers. The header
  // spinner only covers active catch-up (degraded states surface in the
  // composer status strip), with a short delay against session-switch flicker.
  const { syncState: activeSessionDocSyncState } = useSessionDocSyncState(
    activeSessionTabId ?? sessionId,
    {
      enabled: activeSessionTabId !== null,
    }
  );
  const activeSessionDocIsSyncing = useDelayedFlag(
    activeSessionTabId !== null && isSyncingRoomSyncState(activeSessionDocSyncState),
    400
  );
  // Resolve local project metadata for header display
  const activeSessionMachineId = activeSession?.machineId ?? null;
  const { machine: sessionMachine, machineFlockRows } =
    useResolvedMachineMeta(activeSessionMachineId);
  const canForkSession = useCallback(
    (target: SessionMeta): boolean => {
      if (target.isArchived || !target.agentConfigId) return false;
      const capability =
        sessionMachine?.acpCapabilities?.[getAcpCapabilityCacheKey(target.agentConfigId)];
      return (
        getAcpCapabilityCacheEntryAuthority(capability, undefined) === 'authoritative' &&
        capability?.sessionFork === true
      );
    },
    [sessionMachine?.acpCapabilities]
  );
  const handleForkAssistant = useCallback(
    async (
      source: SessionMeta,
      turnId: string,
      placement: 'tab' | 'side-panel' | 'worktree' = 'tab',
      options: { targetSessionId?: SessionId; acknowledgeDirtySource?: true } = {}
    ) => {
      if (
        !runtime ||
        !user?.id ||
        !canForkSession(source) ||
        (pendingForks[source.id] && !options.targetSessionId)
      )
        return;
      const targetSessionId = options.targetSessionId ?? (crypto.randomUUID() as SessionId);
      setPendingForks((current) => ({
        ...current,
        [source.id]: { turnId, targetSessionId, phase: 'requesting', placement },
      }));
      const request = {
        sourceSessionId: source.id,
        sourceTurnId: turnId,
        targetSessionId,
        requestedByUserId: user.id,
        ...(placement === 'worktree'
          ? {
              targetContext: {
                kind: 'new-worktree' as const,
                ...(options.acknowledgeDirtySource
                  ? { acknowledgeDirtySource: true as const }
                  : {}),
              },
            }
          : {}),
        ...(placement === 'side-panel' ? { targetPlacement: 'side-panel' as const } : {}),
      };
      const requestOptions = { timeoutMs: placement === 'worktree' ? 15_000 : 120_000 };
      let response = await runtime.requestSessionFork(source.machineId, request, requestOptions);
      if (
        placement === 'worktree' &&
        !response?.success &&
        response?.error?.code === 'INTERNAL_ERROR'
      ) {
        response = await runtime.requestSessionFork(source.machineId, request, requestOptions);
      }
      if (response?.disposition === 'confirmation-required') {
        setDirtyForkConfirmation({ source, turnId, targetSessionId });
        return;
      }
      if (!response?.success) {
        setPendingForks((current) => {
          const next = { ...current };
          delete next[source.id];
          return next;
        });
        toast.error(response?.error?.message ?? t('sessions.forkFailed', 'Unable to fork session'));
        return;
      }
      setPendingForks((current) => {
        const pending = current[source.id];
        if (!pending || pending.targetSessionId !== targetSessionId) return current;
        return {
          ...current,
          [source.id]: { ...pending, phase: 'awaiting-history' },
        };
      });
      if (placement === 'tab') {
        setTabOrderState((current) => appendTabOrderId(current, sessionGroupIds, targetSessionId));
      }
      if (response.partial && response.warnings.length > 0) {
        toast.warning(
          t('sessions.forkPartial', 'Session forked with some historical content unavailable')
        );
      }
    },
    [canForkSession, pendingForks, runtime, sessionGroupIds, t, user?.id]
  );
  const pendingForkSourceByTargetSessionId = useMemo(() => {
    const sourceByTarget = new Map<SessionId, string>();
    for (const [sourceSessionId, pending] of Object.entries(pendingForks)) {
      if (pending.phase === 'awaiting-history') {
        sourceByTarget.set(pending.targetSessionId, sourceSessionId);
      }
    }
    return sourceByTarget;
  }, [pendingForks]);
  const handleForkDestination = useCallback(
    (source: SessionMeta, turnId: string, destination: SessionForkDestination = 'shared') => {
      void handleForkAssistant(source, turnId, destination === 'new-worktree' ? 'worktree' : 'tab');
    },
    [handleForkAssistant]
  );
  // Claims the pending fork so exactly one of the two completion paths below
  // acts on it. Stable identity keeps the completion props from churning on
  // every fork state transition.
  const takePendingFork = useStableCallback(
    (sourceSessionId: string, targetSessionId: SessionId) => {
      const pending = pendingForks[sourceSessionId];
      if (
        !pending ||
        pending.phase !== 'awaiting-history' ||
        pending.targetSessionId !== targetSessionId
      ) {
        return null;
      }
      setPendingForks((current) => {
        if (current[sourceSessionId] !== pending) return current;
        const next = { ...current };
        delete next[sourceSessionId];
        return next;
      });
      return pending;
    }
  );

  const isActiveSessionLocalMachine = !!localMachineId && activeSessionMachineId === localMachineId;
  const machineDotlodyPath = useMemo(
    () =>
      resolveMachineDotlodyPath(
        machineFlockRows,
        isActiveSessionLocalMachine ? localHomeDir : null
      ),
    [isActiveSessionLocalMachine, localHomeDir, machineFlockRows]
  );
  // `useResolvedMachineMeta` already merged the Machine Flock local-project rows
  // (honouring deletions) into `sessionMachine`; do not re-scan the raw rows.
  const sessionMachineLocalProjects = sessionMachine?.localProjects ?? EMPTY_LOCAL_PROJECTS;
  const sessionMachineSupportsLocalProjectHistoryRpc =
    sessionMachine?.supportsLocalProjectHistoryRpc === true;
  const resolvedLocalProjectMeta = useMemo(() => {
    const proj = activeSession?.project as { kind?: string; localProjectId?: string } | undefined;
    if (proj?.kind !== 'local' || !proj.localProjectId) return null;
    return sessionMachineLocalProjects[proj.localProjectId as LocalProjectId] ?? null;
  }, [activeSession?.project, sessionMachineLocalProjects]);

  // The session displayed in the active tab
  const {
    ready: sessionDiffReady,
    summary: { diffFilePathsByTurn, diffEntriesByTurn, fileDiffsByTurn },
  } = useSessionDiffSummary(activeSessionTabId ?? sessionId, {
    enabled: activeSessionTabId !== null && !activeSession?.design,
  });
  const messageFileDiffEntriesByTurn = useMemo(
    () => (Object.keys(diffEntriesByTurn).length > 0 ? diffEntriesByTurn : undefined),
    [diffEntriesByTurn]
  );

  const activeBrowserSession = activeDraftTab ? null : activeTabSession;
  const workspaceOwnerSession = activeTabSession?.parentSessionId
    ? activeSession
    : activeTabSession;

  // Set document title based on session title
  useDocumentTitle(activeSession?.title);

  useEffect(() => {
    attemptedExternalHistoryRefreshKeysRef.current.clear();
  }, [sessionId]);

  useEffect(() => {
    if (!activeSession || !currentWorkspaceId || !user?.id) return;
    const externalHistory = activeSession.externalHistory;
    if (!shouldRefreshExternalHistoryOnOpen(externalHistory)) {
      return;
    }
    const project = activeSession.project;
    if (project?.kind !== 'local') return;
    if (
      !canUseProjectHistoryProjectControl({
        runtime,
        localMachineId,
        machineId: activeSession.machineId,
        supportsLocalProjectHistoryRpc: sessionMachineSupportsLocalProjectHistoryRpc,
      })
    ) {
      return;
    }

    const refreshKey = getExternalHistoryRefreshKey(activeSession.id, externalHistory);
    if (externalHistoryRefreshBySessionId[activeSession.id]?.key === refreshKey) return;
    if (attemptedExternalHistoryRefreshKeysRef.current.has(refreshKey)) return;
    attemptedExternalHistoryRefreshKeysRef.current.add(refreshKey);
    setExternalHistoryRefreshBySessionId((current) => ({
      ...current,
      [activeSession.id]: {
        key: refreshKey,
        provider: externalHistory.provider,
      },
    }));

    void importProjectHistoryForLocalProject({
      provider: externalHistory.provider,
      runtime,
      localMachineId,
      machineId: activeSession.machineId,
      workspaceId: currentWorkspaceId,
      localProjectId: project.localProjectId,
      acpSessionIds: [externalHistory.sourceAcpSessionId],
      requestedByUserId: user.id,
    })
      .then((result) => {
        void result;
      })
      .catch((error: unknown) => {
        toast.error(
          t('sessions.historyLoadFailed', {
            defaultValue: 'Failed to load {{provider}} conversation',
            provider: getExternalHistoryProviderLabel(externalHistory.provider),
          }),
          {
            description: error instanceof Error ? error.message : String(error),
          }
        );
      })
      .finally(() => {
        setExternalHistoryRefreshBySessionId((current) => {
          if (current[activeSession.id]?.key !== refreshKey) {
            return current;
          }
          const next = { ...current };
          delete next[activeSession.id];
          return next;
        });
      });
  }, [
    activeSession,
    currentWorkspaceId,
    externalHistoryRefreshBySessionId,
    localMachineId,
    runtime,
    sessionMachineSupportsLocalProjectHistoryRpc,
    t,
    user?.id,
  ]);

  // Reflect the active session's status in the favicon (web) or dock badge (electron).
  // Priority: waiting > working > unread > idle.
  const tabStatus = useMemo<TabStatus>(() => {
    if (!activeSession) return null;
    const lastMessageAt =
      typeof activeSession.lastMessageAt === 'number' ? activeSession.lastMessageAt : null;
    const lastReadAt =
      typeof activeSession.lastReadAt === 'number' ? activeSession.lastReadAt : null;
    const hasUnread = lastMessageAt !== null && (lastReadAt === null || lastMessageAt > lastReadAt);
    const isWaiting = activeSessionLiveStatus?.type === 'requestPermission';
    // CLI-reported presence is the fact source for "working"; persistent goal
    // state and meta dispatch pointers do not imply a prompt is running.
    const isWorking = activeSessionLiveStatus != null;
    if (isWaiting) return 'waiting';
    if (isWorking) return 'working';
    if (hasUnread) return 'unread';
    return 'idle';
  }, [activeSession, activeSessionLiveStatus]);
  useTabStatus(tabStatus);
  const { latestPr, repoFullName } = useMemo(
    () => getSessionGitHubState(activeTabSession, workspaceOwnerSession),
    [activeTabSession, workspaceOwnerSession]
  );
  const latestPrNumber = getPullRequestNumber(latestPr);

  const writeSessionUrlTab = useCallback(
    (nextTab: string | undefined, { push = false }: { push?: boolean } = {}) => {
      if (!workspaceSlug) {
        return;
      }
      /* A `?tab` write is scoped to this session's route. An asynchronous
         caller resolving after the user already left (a draft send completing
         mid-switch, a queued replace) must be dropped, not allowed to yank the
         router back to the session it captured. */
      if (!router.state.location.pathname.includes(`/sessions/${sessionId}`)) {
        recordSessionRenderTrace(`nav-dropped s=${shortTraceId(sessionId)} tab=${nextTab ?? '∅'}`);
        return;
      }
      recordSessionRenderTrace(
        `nav s=${shortTraceId(sessionId)} tab=${nextTab ?? '∅'} ${push ? 'push' : 'replace'}`
      );

      void router.navigate({
        to: '/$workspaceName/sessions/$sessionId',
        params: { workspaceName: workspaceSlug, sessionId },
        search: (prev) => {
          if (prev.tab === nextTab) {
            return prev;
          }

          if (nextTab === undefined) {
            if (prev.tab === undefined) {
              return prev;
            }

            const next = { ...prev };
            delete next.tab;
            return next;
          }

          return { ...prev, tab: nextTab };
        },
        replace: !push,
      });
    },
    [router, sessionId, workspaceSlug]
  );

  /* Activating a tab IS a navigation: the handlers below write the `?tab`
     search value and the active tab derives back out of it. Every in-session
     activation encodes explicitly — the parent as `session:<parentId>`, drafts
     as their full `draft:<id>` id — because the absent value is reserved for
     external entries, which the route restores from the last-active store.
     User-driven switches PUSH so tabs participate in history back; structural
     rewrites (draft promotion, closing a dead tab) replace. */
  const navigateToSessionTab = useCallback(
    (tabId: string, options?: { push?: boolean }) => {
      writeSessionUrlTab(formatExplicitSessionTabSearch(tabId), options);
    },
    [writeSessionUrlTab]
  );

  const replaceSessionUrlPr = useCallback(
    (nextPrNumber: number | undefined, { push = false }: { push?: boolean } = {}) => {
      if (!workspaceSlug) {
        return;
      }

      void router.navigate({
        to: '/$workspaceName/sessions/$sessionId',
        params: { workspaceName: workspaceSlug, sessionId },
        search: (prev) => {
          if (prev.pr === nextPrNumber) {
            return prev;
          }
          if (nextPrNumber === undefined) {
            if (prev.pr === undefined) {
              return prev;
            }
            const next = { ...prev };
            delete next.pr;
            return next;
          }
          return { ...prev, pr: nextPrNumber };
        },
        replace: !push,
      });
    },
    [router, sessionId, workspaceSlug]
  );

  const replaceSessionUrlBrowser = useCallback(
    (nextBrowser: boolean, { push = false }: { push?: boolean } = {}) => {
      if (!workspaceSlug) {
        return;
      }

      void router.navigate({
        to: '/$workspaceName/sessions/$sessionId',
        params: { workspaceName: workspaceSlug, sessionId },
        search: (prev) => {
          const currentBrowser = prev.browser === true;
          if (currentBrowser === nextBrowser) {
            return prev;
          }
          if (!nextBrowser) {
            if (prev.browser === undefined) {
              return prev;
            }
            const next = { ...prev };
            delete next.browser;
            return next;
          }
          return { ...prev, browser: true };
        },
        replace: !push,
      });
    },
    [router, sessionId, workspaceSlug]
  );
  // Multi-tab: create a new child session
  const {
    startSession,
    requestSessionDispatch,
    touchSessionActivity,
    updateSessionTitle,
    archiveSession,
    restoreSession,
    deleteSessions,
    deleteArchivedSession,
    setSessionPinned,
  } = useSessionActions();
  const setChatTabRef = useCallback(
    (tabId: string, ref: SessionChatInterfaceHandle | DraftSessionChatInterfaceHandle | null) => {
      chatRefsMap.current.set(tabId, ref);
    },
    []
  );

  const handleInsertDroppedSessionMention = useCallback(
    (droppedSessionId: string) => {
      chatRefsMap.current.get(activeTabSessionId)?.insertSessionMention(droppedSessionId);
    },
    [activeTabSessionId]
  );

  const handleSessionCommentReferencesChange = useCallback(
    (targetSessionId: string, references: CommentReferencePayload[]) => {
      const keys = references.map(getCommentReferenceKey);
      setCommentReferenceKeysBySession((prev) => {
        const previousKeys = prev[targetSessionId] ?? [];
        if (areStringArraysEqual(previousKeys, keys)) {
          return prev;
        }
        if (keys.length === 0) {
          const { [targetSessionId]: _removed, ...rest } = prev;
          return rest;
        }
        return { ...prev, [targetSessionId]: keys };
      });
    },
    []
  );

  const getCommentReferencesChangeHandler = useCallback(
    (targetSessionId: string) => {
      const cached = commentReferenceChangeHandlersRef.current.get(targetSessionId);
      if (cached) {
        return cached;
      }
      const handler = (references: CommentReferencePayload[]) => {
        handleSessionCommentReferencesChange(targetSessionId, references);
      };
      commentReferenceChangeHandlersRef.current.set(targetSessionId, handler);
      return handler;
    },
    [handleSessionCommentReferencesChange]
  );

  const handleSessionVisualAnnotationReferencesChange = useCallback(
    (targetSessionId: string, references: VisualAnnotationReferencePayload[]) => {
      const keys = references.map(getVisualAnnotationReferenceKey);
      setVisualAnnotationReferenceKeysBySession((prev) => {
        const previousKeys = prev[targetSessionId] ?? [];
        if (areStringArraysEqual(previousKeys, keys)) {
          return prev;
        }
        if (keys.length === 0) {
          const { [targetSessionId]: _removed, ...rest } = prev;
          return rest;
        }
        return { ...prev, [targetSessionId]: keys };
      });
    },
    []
  );

  const getVisualAnnotationReferencesChangeHandler = useCallback(
    (targetSessionId: string) => {
      const cached = visualAnnotationReferenceChangeHandlersRef.current.get(targetSessionId);
      if (cached) {
        return cached;
      }
      const handler = (references: VisualAnnotationReferencePayload[]) => {
        handleSessionVisualAnnotationReferencesChange(targetSessionId, references);
      };
      visualAnnotationReferenceChangeHandlersRef.current.set(targetSessionId, handler);
      return handler;
    },
    [handleSessionVisualAnnotationReferencesChange]
  );

  const markSubmittedVisualAnnotationReferences = useCallback(
    async (targetSessionId: SessionId, references: VisualAnnotationReferencePayload[]) => {
      if (references.length === 0 || !runtime) {
        return;
      }

      try {
        await runtime.writer.mutatePreviewVisualComments(targetSessionId, {
          kind: 'mark-submitted',
          commentIds: references.map((reference) => reference.commentId),
          submittedAt: getServerNow(),
        });
      } catch (error) {
        console.error('Failed to mark preview visual comments submitted', {
          sessionId: targetSessionId,
          error,
        });
        toast.error(
          t(
            'sessions.preview.annotation.submitStateFailed',
            'Failed to update preview comment status'
          )
        );
      }
    },
    [runtime, t]
  );

  const getVisualAnnotationReferencesSubmittedHandler = useCallback(
    (targetSessionId: SessionId) => {
      return (references: VisualAnnotationReferencePayload[]) => {
        void markSubmittedVisualAnnotationReferences(targetSessionId, references);
      };
    },
    [markSubmittedVisualAnnotationReferences]
  );

  const handleAddCommentReferenceToActiveChatInput = useCallback(
    (reference: CommentReferencePayload) => {
      const chatRef = chatRefsMap.current.get(activeTabSessionId);
      return chatRef && 'addCommentReference' in chatRef
        ? chatRef.addCommentReference(reference)
        : false;
    },
    [activeTabSessionId]
  );

  const handleTogglePreviewAnnotationInChat = useCallback(
    (targetSessionId: SessionId, reference: VisualAnnotationReferencePayload) => {
      const chatRef = chatRefsMap.current.get(targetSessionId);
      if (chatRef && 'toggleVisualAnnotationReference' in chatRef) {
        return chatRef.toggleVisualAnnotationReference(reference);
      }
      toast.error(t('sessions.preview.annotation.chatUnavailable', 'Open the session chat first'));
      return false;
    },
    [t]
  );

  const handleAddPreviewAnnotationToChat = useCallback(
    (targetSessionId: SessionId, reference: VisualAnnotationReferencePayload) => {
      const chatRef = chatRefsMap.current.get(targetSessionId);
      if (chatRef && 'addVisualAnnotationReference' in chatRef) {
        return chatRef.addVisualAnnotationReference(reference);
      }
      toast.error(t('sessions.preview.annotation.chatUnavailable', 'Open the session chat first'));
      return false;
    },
    [t]
  );

  const handleNewTab = useCallback(() => {
    if (!activeSession) return;
    const draft = createDraftSessionTab({
      agentConfigId: activeSession.agentConfigId,
      cliType: activeSession.cliType,
      agentType: activeSession.agentType,
      modeId: null,
      modelId: null,
    });
    setDraftTabs((prev) => [...prev, draft]);
    setTabOrderState((prev) => appendTabOrderId(prev, sessionGroupIds, draft.id));

    navigateToSessionTab(draft.id, { push: true });
  }, [activeSession, navigateToSessionTab, sessionGroupIds, setDraftTabs]);

  const handleDraftChange = useCallback(
    (draftId: DraftSessionTab['id'], patch: Partial<DraftSessionTab>) => {
      setDraftTabs((prev) =>
        prev.map((draft) => (draft.id === draftId ? { ...draft, ...patch } : draft))
      );
    },
    [setDraftTabs]
  );

  const closeDraftTab = useCallback(
    (draftId: DraftSessionTab['id']) => {
      setDraftTabs((prev) => prev.filter((draft) => draft.id !== draftId));
      setTabOrderState((prev) => removeTabOrderId(prev, draftId));
      if (activeTabSessionId === draftId) {
        // Explicit parent, replacing the dead draft URL in place.
        navigateToSessionTab(sessionId);
      }
    },
    [activeTabSessionId, navigateToSessionTab, sessionId, setDraftTabs]
  );

  const handleSendDraft = useCallback(
    async (payload: DraftSessionSendPayload): Promise<boolean> => {
      if (!activeSession || !user) {
        toast.error(t('sessions.sendError'));
        return false;
      }
      if (sendingDraftIdsRef.current.has(payload.draftId)) {
        return false;
      }

      sendingDraftIdsRef.current.add(payload.draftId);
      const prompt = payload.inputConfig.prompt ?? '';
      const childSessionId = payload.sessionId;
      try {
        const draftTitle = getDraftTabLabel({ prompt }, '').trim();
        const pendingHistoryEntry = buildPendingUserHistoryEntry({
          userId: user.id,
          inputBlocks: payload.inputBlocks,
          timestamp: new Date().toISOString(),
          inputConfig: payload.inputConfig,
        });
        if (!pendingHistoryEntry) {
          toast.error(t('sessions.sendError'));
          return false;
        }
        setPendingDraftChildSessionIds((prev) => ({
          ...prev,
          [payload.draftId]: childSessionId,
        }));

        // Meta and the first user turn are one accept unit: the draft is only
        // promoted after both are durable locally, so a half-created child (a
        // tab whose message never entered the session doc) cannot exist. The
        // dispatch RPC below only accelerates; the durable pointer written by
        // requestSessionDispatch remains recovery truth.
        const { historyEntry } = await startSession(
          {
            sessionId: childSessionId,
            machineId: activeSession.machineId,
            userId: user.id,
            cliType: payload.cliType,
            agentType: payload.agentType,
            agentConfigId: payload.agentConfigId,
            customAcp: payload.customAcp,
            runtimeOverrides: payload.runtimeOverrides,
            project: activeSession.project,
            repoFullName: activeSession.repoFullName,
            baseBranch: activeSession.baseBranch,
            parentSessionId: activeSession.id,
            title: draftTitle || undefined,
            titleSource: draftTitle ? 'draft' : undefined,
          },
          pendingHistoryEntry
        );
        // Marks the first message read for the sender and bubbles activity to
        // the parent session, matching the ordinary send path. The child's own
        // lastMessageAt is already durable inside the startSession accept unit.
        touchSessionActivity(childSessionId).catch((err: unknown) => {
          console.warn('Failed to update child session activity after start', err);
        });
        persistAgentSessionDefaults(payload.agentConfigId, {
          modeId: payload.inputConfig.modeId,
          modelId: payload.inputConfig.modelId,
          configOptionValues: payload.inputConfig.configOptionValues,
        });

        // Draft tabs reuse the future child session id. Clear input caches before promotion;
        // waiting for the old draft input to clear lets the newly mounted child input hydrate
        // from stale text/image drafts. Preserved text is handed over through the
        // same cache the promoted composer hydrates from on mount.
        clearSessionChatInputDrafts(childSessionId);
        if (payload.preservedInputText?.trim()) {
          setSessionChatInputTextDraft(childSessionId, payload.preservedInputText);
        }
        setDraftTabs((prev) => prev.filter((draft) => draft.id !== payload.draftId));
        setTabOrderState((prev) =>
          replaceTabOrderId(
            appendTabOrderId(prev, sessionGroupIds, payload.draftId),
            payload.draftId,
            childSessionId
          )
        );

        /* One replace navigation swaps `draft:<id>` for `session:<child>`.
           The `pendingDraftChildSessionIds` entry deliberately SURVIVES the
           promotion as a resolution alias: React commits the draft removal
           before the router commits the new `?tab`, and in that window (and
           until the child meta reaches the local replica) the URL must keep
           resolving to the new conversation, never bounce back to the parent.
           The map resets with the session-switch state reset. */
        navigateToSessionTab(childSessionId);
        void requestSessionDispatch(childSessionId, historyEntry.id, {
          inputConfig: payload.inputConfig,
          machineId: activeSession.machineId,
        }).catch((dispatchError: unknown) => {
          // The turn is already durable; the watcher retries once the machine
          // syncs. Surface the failure instead of looking stuck silently.
          console.error('Failed to request child session dispatch', dispatchError);
          toast.error(t('sessions.sendError'));
        });
        return true;
      } catch (error) {
        console.error('Failed to create child tab session', error);
        try {
          await deleteSessions([childSessionId]);
        } catch (cleanupError) {
          console.warn('Failed to clean up child tab session after create failure', cleanupError);
        } finally {
          setPendingDraftChildSessionIds((prev) => {
            const { [payload.draftId]: _removed, ...rest } = prev;
            return rest;
          });
        }
        toast.error(t('sessions.sendError'));
        return false;
      } finally {
        sendingDraftIdsRef.current.delete(payload.draftId);
      }
    },
    [
      activeSession,
      deleteSessions,
      navigateToSessionTab,
      requestSessionDispatch,
      sessionGroupIds,
      setDraftTabs,
      startSession,
      t,
      touchSessionActivity,
      user,
    ]
  );

  const handleTabRename = useCallback(
    async (tabSessionId: SessionId, title: string) => {
      await updateSessionTitle(tabSessionId, title);
    },
    [updateSessionTitle]
  );

  const handleTabClose = useCallback(
    async (tabId: string) => {
      if (isDraftSessionTabId(tabId)) {
        closeDraftTab(tabId);
        return;
      }
      const tabSessionId = tabId as SessionId;
      // If the tab has never had a message, just delete it instead of archiving
      const tabMeta = childSessions.find((s) => s.id === tabSessionId);
      try {
        if (tabMeta && !tabMeta.lastMessageAt) {
          await deleteSessions([tabSessionId]);
        } else {
          await archiveSession(tabSessionId);
        }
        // Switch to the parent tab only once the close is durable; a failed
        // close keeps the tab selected instead of yanking the user off it.
        // Explicit parent, replacing the closed tab's URL in place.
        if (tabSessionId === activeTabSessionId) {
          navigateToSessionTab(sessionId);
        }
      } catch (error) {
        // A silent failure reads as "the close button does nothing" — surface
        // it and leave the tab where it was.
        console.error('Failed to close session tab', { tabSessionId, error });
        toast.error(t('sessions.tabCloseFailed', 'Could not close this tab'));
      }
    },
    [
      activeTabSessionId,
      archiveSession,
      childSessions,
      closeDraftTab,
      deleteSessions,
      navigateToSessionTab,
      sessionId,
      t,
    ]
  );

  const handleTabRestore = useCallback(
    async (tabSessionId: SessionId) => {
      await restoreSession(tabSessionId);
    },
    [restoreSession]
  );

  // Navigate back to session list.
  const handleBackToList = useCallback(() => {
    if (!workspaceSlug) {
      return;
    }
    void router.navigate({
      to: '/$workspaceName/chat',
      params: { workspaceName: workspaceSlug },
    });
  }, [workspaceSlug, router]);

  const redirectToParentSessionUrl = useCallback(
    (parentSessionId: SessionId, childSessionId: SessionId) => {
      if (!workspaceSlug) {
        return;
      }

      void router.navigate({
        to: '/$workspaceName/sessions/$sessionId',
        params: { workspaceName: workspaceSlug, sessionId: parentSessionId },
        search: (prev) => ({
          ...prev,
          tab: formatSessionTabSearch(childSessionId, parentSessionId),
        }),
        replace: true,
      });
    },
    [router, workspaceSlug]
  );

  // Archive the parent session from the header menu (desktop)
  const handleArchiveCurrentSession = useCallback(async () => {
    if (!activeSession) return;
    await archiveSession(activeSession.id);
    handleBackToList();
  }, [activeSession, archiveSession, handleBackToList]);

  const handleArchiveActiveTab = useCallback(async () => {
    if (!activeSession) return;
    if (activeDraftTab) {
      closeDraftTab(activeDraftTab.id);
      return;
    }
    if (activeTabSessionId && activeTabSessionId !== sessionId) {
      // Archiving a child tab — delegate to tab close logic
      await handleTabClose(activeTabSessionId);
    } else {
      // Archiving the parent
      await archiveSession(activeSession.id);
      handleBackToList();
    }
  }, [
    activeDraftTab,
    activeSession,
    activeTabSessionId,
    archiveSession,
    closeDraftTab,
    handleBackToList,
    handleTabClose,
    sessionId,
  ]);

  // Restore the current archived session from the header menu
  const handleRestoreCurrentSession = useCallback(async () => {
    if (!activeSession) return;
    await restoreSession(activeSession.id);
  }, [activeSession, restoreSession]);

  // Confirmation state for permanently deleting the current archived session
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Confirmation state for archiving the current chat via the keyboard shortcut. The
  // shortcut is easy to fire by accident, so it asks before archiving (Enter confirms,
  // Esc cancels). Menu/button archive actions stay immediate.
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const archiveConfirmButtonRef = useRef<HTMLButtonElement>(null);

  const [renameDialogTarget, setRenameDialogTarget] = useState<RenameSessionDialogTarget | null>(
    null
  );

  // Share-as-image preview target: the selected tab's session plus the plain-text
  // conversation snapshot pulled from its chat surface when the menu item fires.
  const [shareImageTarget, setShareImageTarget] = useState<{
    session: SessionMeta;
    messages: ConversationMessage[];
    agentName?: string;
  } | null>(null);

  const handleRequestDeleteCurrentSession = useCallback(() => {
    if (!activeSession) return;
    setDeleteConfirmOpen(true);
  }, [activeSession]);

  const handleConfirmDeleteCurrentSession = useCallback(async () => {
    if (!activeSession) return;
    const sessionToDelete = activeSession.id;
    const pullRequestsToClear = activeSession.pullRequests ?? [];
    const wsId = currentWorkspaceId;
    setDeleteConfirmOpen(false);
    try {
      await deleteArchivedSession(sessionToDelete);
    } catch (error) {
      console.error('Failed to permanently delete session', error);
      toast.error(t('archive.deleteFailed'));
      return;
    }
    if (wsId) {
      await deletePrCacheEntriesForSession({
        workspaceId: wsId,
        prs: pullRequestsToClear.map((pr) => ({
          repository: getPullRequestRepoFullName(pr) ?? undefined,
          number: getPullRequestNumber(pr),
        })),
        defaultRepoFullName: repoFullName ?? undefined,
      });
    }
    handleBackToList();
  }, [activeSession, currentWorkspaceId, deleteArchivedSession, handleBackToList, repoFullName, t]);

  const handleCopyText = useCallback(
    (text: string, successMessage?: string) => {
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          if (successMessage) toast.success(successMessage);
        })
        .catch(() => toast.error(t('sessions.shareFailed', 'Unable to share link')));
    },
    [t]
  );
  const activeSessionWorkspacePath = useMemo(() => {
    if (!activeSession) return null;
    return resolveSessionWorkspacePath({
      sessionId: activeSession.id,
      ownerSessionId: activeSession.parentSessionId,
      isWorktree: activeSession.isWorktree,
      dotlodyPath: machineDotlodyPath,
      localProjectRootPath: resolvedLocalProjectMeta?.rootPath,
      repoFullName: resolveProjectGitHubRepo(activeSession.project) ?? activeSession.repoFullName,
      legacyWorkspacePath: sessionMachine?.workspacePaths?.[activeSession.id],
    });
  }, [activeSession, machineDotlodyPath, resolvedLocalProjectMeta?.rootPath, sessionMachine]);

  const handleCopyConversationHistory = useCallback(() => {
    if (activeDraftTab) {
      return;
    }
    const activeChatRef = chatRefsMap.current.get(activeTabSessionId);
    if (!activeChatRef || !('copyConversationHistory' in activeChatRef)) {
      toast.error(
        t(
          'sessions.copyConversationHistoryUnavailable',
          'Conversation history is unavailable for this tab'
        )
      );
      return;
    }
    void activeChatRef.copyConversationHistory();
  }, [activeDraftTab, activeTabSessionId, t]);

  const handleShareAsImage = useCallback(async () => {
    if (activeDraftTab) {
      return;
    }
    const activeChatRef = chatRefsMap.current.get(activeTabSessionId);
    const shareData =
      activeChatRef && 'getShareImageData' in activeChatRef
        ? await activeChatRef.getShareImageData()
        : null;
    if (
      !activeTabSession ||
      !shareData ||
      shareData.messages.length === 0 ||
      !activeChatRef ||
      !('startShareImageSelection' in activeChatRef)
    ) {
      toast.error(t('sessions.shareImage.empty', 'No conversation to share'));
      return;
    }
    activeChatRef.startShareImageSelection(shareData.messages, (messages) => {
      setShareImageTarget({
        session: activeTabSession,
        messages,
        agentName: shareData.agentName,
      });
    });
  }, [activeDraftTab, activeTabSession, activeTabSessionId, t]);

  const handleOpenSearch = useCallback(() => {
    if (activeDraftTab) {
      return;
    }
    const activeChatRef = chatRefsMap.current.get(activeTabSessionId);
    if (activeChatRef && 'openSearch' in activeChatRef) {
      activeChatRef.openSearch();
    }
  }, [activeDraftTab, activeTabSessionId]);

  // Single fork entry point for every launcher: the header/footer action forks
  // into a top tab, the side-panel launcher forks into a right-hand panel.
  const forkActiveConversation = useCallback(
    (placement: 'tab' | 'side-panel' | 'worktree' = 'tab') => {
      const sourceSession = activeDraftTab ? null : activeTabSession;
      if (!sourceSession || !canForkSession(sourceSession) || pendingForks[sourceSession.id]) {
        return;
      }
      const activeChatRef = chatRefsMap.current.get(activeTabSessionId);
      const turnId =
        activeChatRef && 'getLastAssistantTurnId' in activeChatRef
          ? activeChatRef.getLastAssistantTurnId()
          : null;
      if (!turnId) {
        toast.error(t('sessions.forkNoAssistant', 'No assistant response is available to fork'));
        return;
      }
      void handleForkAssistant(sourceSession, turnId, placement);
    },
    [
      activeDraftTab,
      activeTabSession,
      activeTabSessionId,
      canForkSession,
      handleForkAssistant,
      pendingForks,
      t,
    ]
  );
  const handleForkCurrentSession = useCallback(
    (destination?: SessionForkDestination) => {
      forkActiveConversation(destination === 'new-worktree' ? 'worktree' : 'tab');
    },
    [forkActiveConversation]
  );
  const isCreatingSideSession = useMemo(
    () => Object.values(pendingForks).some((pending) => pending.placement === 'side-panel'),
    [pendingForks]
  );
  const handleCreateSideSession = useCallback(
    () => forkActiveConversation('side-panel'),
    [forkActiveConversation]
  );

  useEffect(() => {
    if (activeSidebarTab === 'pr') {
      setActiveSidebarTab(null);
    }
  }, [activeSidebarTab, latestPr, repoFullName]);

  useEffect(() => {
    if (activeSidebarTab === 'browser' && !activeBrowserSession) {
      setActiveSidebarTab(null);
    }
  }, [activeBrowserSession, activeSidebarTab]);

  // drawer. On desktop the browser lives in the resizable sidebar (no URL
  // state), so strip the flag to keep the URL consistent and avoid a stale

  // drawer is open.
  useEffect(() => {
    if (urlBrowser) {
      replaceSessionUrlBrowser(false);
    }
  }, [replaceSessionUrlBrowser, urlBrowser]);

  /* A child session's root URL redirects to its parent. Corrupted meta can
     hold a parentSessionId CYCLE (X↔P): following it unguarded redirects
     forever, remounting every chat surface per hop until React's nested
     update limit crashes the renderer (#185). A reverse hop of the redirect
     just taken is always such a cycle — a parent that is itself a child is
     invalid nesting — so it stays put (the parent-guard early return above
     renders null) instead of looping. */
  const lastParentRedirectRef = useRef<{ from: SessionId; to: SessionId } | null>(null);
  useEffect(() => {
    const parentSessionId = activeSession?.parentSessionId;
    if (!parentSessionId || parentSessionId === sessionId) {
      return;
    }
    const last = lastParentRedirectRef.current;
    if (last && last.from === parentSessionId && last.to === sessionId) {
      recordSessionRenderTrace(
        `parent-cycle s=${shortTraceId(sessionId)} parent=${shortTraceId(parentSessionId)}`
      );
      console.error('Session parentSessionId cycle detected; not following it', {
        sessionId,
        parentSessionId,
      });
      return;
    }
    lastParentRedirectRef.current = { from: sessionId, to: parentSessionId };
    recordSessionRenderTrace(
      `parent-redirect s=${shortTraceId(sessionId)} parent=${shortTraceId(parentSessionId)}`
    );
    redirectToParentSessionUrl(parentSessionId, sessionId);
  }, [activeSession?.parentSessionId, redirectToParentSessionUrl, sessionId]);

  /* Entry-scoped last-active-tab restoration lives in the session ROUTE's
     `beforeLoad` (one replace redirect before anything renders), not here:
     the route has this navigation's own params, so the workspace-slug
     staleness dance and the one-shot claim ref are gone with it. */

  const resolveDiffFilePaths = useCallback(
    (turnId: string): string[] => diffFilePathsByTurn[turnId] ?? [],
    [diffFilePathsByTurn]
  );
  const resolveTurnFileDiffs = useCallback(
    (turnId: string) => fileDiffsByTurn[turnId] ?? [],
    [fileDiffsByTurn]
  );

  const upsertViewerTab = useCallback(
    (tab: ViewerTab) => {
      setViewerTabs((prev) => {
        const idx = prev.findIndex((item) => item.id === tab.id);
        if (idx === -1) {
          return [...prev, tab];
        }
        const existing = prev[idx];
        if (!existing) {
          return prev;
        }
        if (areViewerTabsEquivalent(existing, tab)) {
          return prev;
        }
        const next = [...prev];
        next[idx] = tab;
        return next;
      });
      selectSidePanelTab(tab.id);
      revealRightSidebar();
    },
    [revealRightSidebar, selectSidePanelTab]
  );

  const nextFocusRequestSeq = useCallback(() => {
    focusRequestSeqRef.current += 1;
    return focusRequestSeqRef.current;
  }, []);

  const handleOpenFileDiff = useCallback(
    (turnId: string, filePath: string) => {
      setFileProviderRequestedByInteraction(true);
      const turnFilePaths = resolveDiffFilePaths(turnId);
      const filePaths = turnFilePaths.length > 0 ? turnFilePaths : [filePath];

      upsertViewerTab({
        id: `diff:${turnId}`,
        type: 'diff',
        turnId,
        filePaths,
        focusFilePath: filePath,
        focusComment: null,
        focusRequestSeq: nextFocusRequestSeq(),
        mode: 'conversation',
        label: t('sessions.diffTab'),
      });
    },
    [nextFocusRequestSeq, resolveDiffFilePaths, t, upsertViewerTab]
  );

  const handleNavigateToComment = useCallback(
    (reference: CommentReferencePayload) => {
      setFileProviderRequestedByInteraction(true);
      const mode = reference.mode ?? (reference.turnId ? 'conversation' : 'base');
      const turnId = mode === 'base' ? 'all-changes' : (reference.turnId ?? null);
      if (!turnId) return;
      const filePaths = mode === 'base' ? [reference.path] : resolveDiffFilePaths(turnId);
      const resolvedFilePaths =
        mode === 'conversation' && filePaths.length === 0 ? [reference.path] : filePaths;
      upsertViewerTab({
        id: mode === 'base' ? 'diff:all-changes' : `diff:${turnId}`,
        type: 'diff',
        turnId,
        filePaths: resolvedFilePaths,
        focusFilePath: reference.path,
        focusComment: getDiffCommentFocusTargetFromReference(reference),
        focusRequestSeq: nextFocusRequestSeq(),
        mode,
        label: mode === 'base' ? t('sessions.diffTabAllChanges') : t('sessions.diffTab'),
      });
    },
    [nextFocusRequestSeq, resolveDiffFilePaths, t, upsertViewerTab]
  );

  useEffect(() => {
    const nextViewerTabs = viewerTabs.map((tab) => {
      if (tab.type !== 'diff') {
        return tab;
      }

      if (tab.mode === 'base' || tab.turnId === 'all-changes') return tab;

      const nextFilePaths = diffFilePathsByTurn[tab.turnId] ?? [];
      if (nextFilePaths.length === 0) {
        return tab;
      }
      if (areStringArraysEqual(tab.filePaths, nextFilePaths)) {
        return tab;
      }

      return {
        ...tab,
        filePaths: nextFilePaths,
      };
    });

    const hasViewerTabUpdates = nextViewerTabs.some((tab, index) => tab !== viewerTabs[index]);
    if (hasViewerTabUpdates) {
      setViewerTabs(nextViewerTabs);
    }
  }, [diffFilePathsByTurn, viewerTabs]);

  const handleOpenBrowser = useCallback(
    (tabSessionId?: SessionId, navigateCandidate = false) => {
      const browserSessionId = tabSessionId ?? activeBrowserSession?.id;
      if (tabSessionId) {
        navigateToSessionTab(tabSessionId, { push: true });
      }
      if (browserSessionId && navigateCandidate) {
        setBrowserCandidateNavigationRequest({
          sessionId: browserSessionId,
          id: ++browserCandidateNavigationSequenceRef.current,
        });
      }

      revealRightSidebar();
      activateSidebarTab('browser');
    },
    [activeBrowserSession?.id, activateSidebarTab, navigateToSessionTab, revealRightSidebar]
  );

  const handleBrowserCandidateNavigationRequestHandled = useCallback((requestId: number) => {
    setBrowserCandidateNavigationRequest((current) => (current?.id === requestId ? null : current));
  }, []);

  const handleOpenFile = useStableCallback(
    (filePath: string, options: SessionDetailOpenFileOptions = {}) => {
      setFileProviderRequestedByInteraction(true);
      void (async () => {
        // Where the path came from decides whether it may be rewritten at all;
        // `resolveSessionFileOpenTarget` owns that rule and documents why.
        const target = resolveSessionFileOpenTarget({
          rawPath: filePath,
          pathKind: options.pathKind ?? 'markdown-href',
          workspacePath: activeSessionWorkspacePath,
          ...(options.startLine === undefined ? {} : { startLine: options.startLine }),
          ...(options.endLine === undefined ? {} : { endLine: options.endLine }),
        });
        const resolution = await resolveSessionFileProviderOpenPath(
          activeSessionFileProvider,
          target.filePath
        ).catch(
          (): SessionFileProviderOpenPathResolution => ({
            path: target.filePath,
            redirected: false,
          })
        );
        const resolvedFilePath = resolution.path;

        const requestSeq = nextFocusRequestSeq();
        upsertViewerTab({
          id: getFileViewerTabId(resolvedFilePath, resolution.fileId),
          type: 'file',
          filePath: resolvedFilePath,
          ...(resolution.fileId === undefined ? {} : { fileId: resolution.fileId }),
          label: getBasename(resolvedFilePath),
          startLine: target.startLine,
          endLine: target.endLine,
          focusRequestSeq: requestSeq,
          ...(options.previewHtml ? { htmlPreviewRequestSeq: requestSeq } : {}),
        });
      })();
    }
  );

  const handleOpenHtmlFile = useStableCallback((filePath: string) => {
    handleOpenFile(filePath, {
      pathKind: 'canonical',
      previewHtml: true,
    });
  });

  /**
   * Every entry point whose path came from the file index. Kept stable so the
   * file tree's memoized rows do not re-render on each parent commit.
   */
  const handleOpenIndexedFile = useStableCallback((filePath: string) => {
    handleOpenFile(filePath, { pathKind: 'canonical' });
  });

  const handleOpenFileFromDiff = useStableCallback((filePath: string) => {
    handleOpenFile(filePath, { pathKind: 'canonical' });
  });

  const handleOpenFileDiffForChat = useStableCallback((turnId: string, filePath: string) => {
    setFileProviderRequestedByInteraction(true);
    handleOpenFileDiff(turnId, filePath);
  });

  useEffect(() => {
    if (!activeSessionFileProvider || viewerTabs.length === 0) {
      return undefined;
    }

    let cancelled = false;
    void (async () => {
      const resolutions = await Promise.all(
        viewerTabs.map(async (tab) => {
          if (tab.type !== 'file') {
            return { tab, next: tab };
          }

          if (tab.fileId) {
            const entry = await activeSessionFileProvider.getFile(tab.fileId).catch(() => null);
            return { tab, next: refreshPinnedProviderFileViewerTab(tab, entry) };
          }

          const resolution = await resolveSessionFileProviderOpenPath(
            activeSessionFileProvider,
            tab.filePath
          ).catch(
            (): SessionFileProviderOpenPathResolution => ({
              path: tab.filePath,
              redirected: false,
            })
          );
          if (!resolution.redirected || resolution.path === tab.filePath) {
            return { tab, next: tab };
          }
          const next: ViewerTab = {
            ...tab,
            id: getFileViewerTabId(resolution.path, resolution.fileId ?? tab.fileId),
            filePath: resolution.path,
            ...(resolution.fileId === undefined ? {} : { fileId: resolution.fileId }),
            label: getBasename(resolution.path),
          };
          return { tab, next };
        })
      );

      if (cancelled) {
        return;
      }

      const changed = resolutions.some(({ tab, next }) => tab !== next);
      if (!changed) {
        return;
      }

      const nextIdByPreviousId = new Map(
        resolutions
          .filter(({ tab, next }) => tab.id !== next.id)
          .map(({ tab, next }) => [tab.id, next.id])
      );

      const nextTabByPreviousId = new Map(
        resolutions.map(({ tab, next }) => [tab.id, next] as const)
      );
      setViewerTabs((current) => {
        let didUpdate = false;
        const nextTabs = current.map((tab) => {
          const next = nextTabByPreviousId.get(tab.id);
          if (!next || areViewerTabsEquivalent(tab, next)) {
            return tab;
          }
          didUpdate = true;
          return next;
        });
        return didUpdate ? nextTabs : current;
      });
      setActiveViewerTabId((current) =>
        current == null ? current : (nextIdByPreviousId.get(current) ?? current)
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSessionFileProvider, viewerTabs]);

  const handleFileQuickOpenChange = useCallback((open: boolean) => {
    if (open) {
      setFileProviderRequestedByInteraction(true);
    }
    setIsFileQuickOpenOpen(open);
  }, []);

  useEffect(() => {
    if (!activeSession) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'p') {
        return;
      }
      event.preventDefault();
      handleFileQuickOpenChange(true);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSession, handleFileQuickOpenChange]);

  const handleSessionTabSelect = useCallback(
    (tabId: string) => {
      desktopTabFocusRegionRef.current = 'conversation';
      // A user-driven switch PUSHES so tabs participate in history back.
      navigateToSessionTab(tabId, { push: true });
    },
    [navigateToSessionTab]
  );

  const handleForkedConversationPrepared = useCallback(
    (sourceSessionId: string, targetSessionId: SessionId) => {
      const taken = takePendingFork(sourceSessionId, targetSessionId);
      if (!taken) return;
      if (taken.placement === 'side-panel') {
        selectSidePanelTab(getSideSessionPanelTabId(targetSessionId));
        revealRightSidebar();
        return;
      }
      if (taken.placement === 'worktree') {
        if (!workspaceSlug) return;
        void router.navigate({
          to: '/$workspaceName/sessions/$sessionId',
          params: { workspaceName: workspaceSlug, sessionId: targetSessionId },
          search: { tab: undefined },
        });
        return;
      }
      handleSessionTabSelect(targetSessionId);
    },
    [
      handleSessionTabSelect,
      revealRightSidebar,
      router,
      selectSidePanelTab,
      takePendingFork,
      workspaceSlug,
    ]
  );
  const handleForkedConversationPrepareError = useCallback(
    (sourceSessionId: string, targetSessionId: SessionId) => {
      if (!takePendingFork(sourceSessionId, targetSessionId)) return;
      toast.error(
        t('sessions.forkOpenFailed', 'Session forked, but its conversation could not be loaded')
      );
    },
    [t, takePendingFork]
  );
  const handleNavigateSession = useCallback(
    (target: SessionNavigationTarget) => {
      const location = getSessionNavigationLocation(target);
      if (location.sessionId === sessionId) {
        handleSessionTabSelect(target.tabSessionId ?? target.sessionId);
        return;
      }

      if (!workspaceSlug) return;
      void router.navigate({
        to: '/$workspaceName/sessions/$sessionId',
        params: { workspaceName: workspaceSlug, sessionId: location.sessionId },
        search: { tab: location.tab },
      });
    },
    [handleSessionTabSelect, router, sessionId, workspaceSlug]
  );

  // When a viewer tab is selected, activate the viewer surface for the current session.
  const handleViewerTabSelect = useCallback(
    (tabId: string) => {
      selectSidePanelTab(tabId);
      revealRightSidebar();
    },
    [revealRightSidebar, selectSidePanelTab]
  );

  const handleSidebarTabSelect = useCallback(
    (tabId: SidebarTab) => {
      desktopTabFocusRegionRef.current = 'side-panel';
      activateSidebarTab(tabId);
      if (tabId === 'pr' && latestPrNumber != null) {
        replaceSessionUrlPr(latestPrNumber, { push: true });
      }
    },
    [activateSidebarTab, latestPrNumber, replaceSessionUrlPr]
  );

  // Fixed panels are persistable side-panel tabs; Side Chat is an action that
  // creates a new durable session instead, so the two lists stay separate and
  // only merge for display.
  const sidePanelFixedOptions = useMemo<(SessionSidePanelOption & { id: SidebarTab })[]>(() => {
    const options: (SessionSidePanelOption & { id: SidebarTab })[] = [
      {
        id: 'files',
        label: t('sessions.detailTabs.files', 'Files'),
        kind: 'files',
      },
    ];
    if (activeBrowserSession) {
      options.push({
        id: 'browser',
        label: t('sessions.detailTabs.browser', 'Browser'),
        kind: 'browser',
      });
    }
    if (activeSession?.design)
      options.unshift({ id: 'design', label: t('design.canvas', 'Design canvas'), kind: 'design' });
    return options;
  }, [activeSession?.design, activeBrowserSession, t]);
  const sideChatOption = useMemo<SessionSidePanelOption | null>(() => {
    const launcherState = getSideChatLauncherState({
      providerSupportsFork: Boolean(
        !activeDraftTab && activeTabSession && canForkSession(activeTabSession)
      ),
      machineOffline: activeTabSessionMachineOnlineStatus === 'offline',
    });
    if (launcherState === 'hidden') return null;
    return {
      id: 'side-session',
      label: t('sessions.detailTabs.sideSession', 'Side Chat'),
      kind: 'session',
      pending: isCreatingSideSession,
      disabled: launcherState === 'disabled' || isCreatingSideSession,
    };
  }, [
    activeDraftTab,
    activeTabSession,
    activeTabSessionMachineOnlineStatus,
    canForkSession,
    isCreatingSideSession,
    t,
  ]);
  const sidePanelOptions = useMemo<SessionSidePanelOption[]>(
    () => (sideChatOption ? [sideChatOption, ...sidePanelFixedOptions] : sidePanelFixedOptions),
    [sideChatOption, sidePanelFixedOptions]
  );

  const handleSidePanelOptionOpen = useCallback(
    (panelId: SessionSidePanelOption['id']) => {
      if (panelId === 'side-session') {
        handleCreateSideSession();
        return;
      }
      handleSidebarTabSelect(panelId);
    },
    [handleCreateSideSession, handleSidebarTabSelect]
  );

  const visibleOpenedSidebarTabs = useMemo(() => {
    const availableTabIds = new Set(sidePanelFixedOptions.map((option) => option.id));
    return openedSidebarTabs.filter((tabId) => availableTabIds.has(tabId));
  }, [openedSidebarTabs, sidePanelFixedOptions]);

  const viewerTabItems: ViewerTabItem[] = useMemo(
    () =>
      viewerTabs.map((tab) => ({
        id: tab.id,
        type: tab.type,
        label: tab.label,
        filePath: tab.type === 'file' ? tab.filePath : undefined,
        dirty: tab.type === 'file' ? viewerTabSaveStates[tab.id]?.dirty === true : false,
        saving: tab.type === 'file' ? viewerTabSaveStates[tab.id]?.saving === true : false,
        conflict:
          tab.type === 'file'
            ? viewerTabSaveStates[tab.id]?.conflict === true ||
              viewerTabSaveStates[tab.id]?.error === true
            : false,
      })),
    [viewerTabSaveStates, viewerTabs]
  );

  // The rendered side-panel tab strip, in strip order: fixed panels, then side
  // chats, then viewers. This is the ONLY statement of that order — every close
  // handler picks its fallback neighbour from `sidePanelTabIds`, so a new tab
  // kind cannot silently fall out of the "select the previous sibling" rule.
  const sidePanelTabs = useMemo<SessionSidePanelTabItem[]>(() => {
    const optionById = new Map(sidePanelFixedOptions.map((option) => [option.id, option]));
    const fixedTabs = visibleOpenedSidebarTabs.flatMap((tabId) => {
      const option = optionById.get(tabId);
      return option ? [{ ...option, closeable: true }] : [];
    });
    return [
      ...fixedTabs,
      ...visibleSideSessions.map(
        (sideSession): SessionSidePanelTabItem => ({
          id: getSideSessionPanelTabId(sideSession.id),
          label: sideSession.title?.trim() || t('sessions.detailTabs.sideSession', 'Side Chat'),
          kind: 'session',
          closeable: true,
          pending: closingSideSessionIds.has(sideSession.id),
        })
      ),
      ...viewerTabItems.map(
        (tab): SessionSidePanelTabItem => ({
          ...tab,
          kind: tab.type,
          closeable: true,
        })
      ),
    ];
  }, [
    closingSideSessionIds,
    sidePanelFixedOptions,
    t,
    viewerTabItems,
    visibleOpenedSidebarTabs,
    visibleSideSessions,
  ]);
  const sidePanelTabIds = useMemo(() => sidePanelTabs.map((tab) => tab.id), [sidePanelTabs]);

  const handleCloseSidebarTab = useCallback(
    (tabId: SidebarTab) => {
      const { fallbackTabId, sidebarOpen } = getSidePanelTabStateAfterClose(sidePanelTabIds, tabId);
      const fallbackSidebarTabId = getSidePanelTabCloseFallback(
        visibleOpenedSidebarTabs,
        tabId
      ) as SidebarTab | null;
      setOpenedSidebarTabs((current) => current.filter((candidate) => candidate !== tabId));
      if (!sidebarOpen) {
        setIsSidebarOpen(false);
      }
      if (activeSidebarTab === tabId) {
        if (activeViewerTabId === null) {
          selectSidePanelTab(fallbackTabId);
        } else {
          setActiveSidebarTab(fallbackSidebarTabId);
        }
      }
      if (tabId === 'pr') {
        replaceSessionUrlPr(undefined);
      }
      if (tabId === 'browser') {
        setBrowserCandidateNavigationRequest(null);
      }
    },
    [
      activeSidebarTab,
      activeViewerTabId,
      replaceSessionUrlPr,
      selectSidePanelTab,
      sidePanelTabIds,
      visibleOpenedSidebarTabs,
    ]
  );

  const handleViewerTabSaveStateChange = useCallback(
    (tabId: string, state: SessionFileSaveViewState) => {
      setViewerTabSaveStates((prev) => {
        const previous = prev[tabId] ?? EMPTY_VIEWER_TAB_SAVE_STATE;
        const next: ViewerTabSaveState = {
          ...previous,
          dirty: state.dirty,
          canSave: state.canSave,
          saving: state.saving,
          conflict: state.conflict,
          error: state.error,
        };
        if (
          previous.dirty === next.dirty &&
          previous.canSave === next.canSave &&
          previous.saving === next.saving &&
          previous.conflict === next.conflict &&
          previous.error === next.error
        ) {
          return prev;
        }
        return { ...prev, [tabId]: next };
      });
    },
    []
  );

  const handleToggleSidebar = useCallback(() => {
    const next = getZenAwarePanelToggleState({
      zenMode: isZenLayoutMode,
      panelOpen: isSidebarOpen,
    });
    setZenLayoutMode(next.zenMode);
    setIsSidebarOpen(next.panelOpen);
  }, [isSidebarOpen, isZenLayoutMode, setZenLayoutMode]);

  const handleCloseViewerTab = useCallback(
    (tabId: string) => {
      const saveState = viewerTabSaveStates[tabId];
      if (saveState?.dirty && typeof window !== 'undefined') {
        const tabLabel = viewerTabs.find((tab) => tab.id === tabId)?.label ?? tabId;
        const shouldClose = window.confirm(
          t(
            'sessions.fileViewer.closeDirtyConfirm',
            'Close {{fileName}} without saving your changes?',
            { fileName: tabLabel }
          )
        );
        if (!shouldClose) {
          return;
        }
      }
      const existingIndex = viewerTabs.findIndex((tab) => tab.id === tabId);
      if (existingIndex >= 0) {
        const { sidebarOpen } = getSidePanelTabStateAfterClose(sidePanelTabIds, tabId);
        if (!sidebarOpen) {
          setIsSidebarOpen(false);
        }
      }
      setViewerTabSaveStates((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, tabId)) return prev;
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
      setTabOrderState((prev) => removeTabOrderId(prev, tabId));
      setViewerTabs((prev) => {
        const idx = prev.findIndex((tab) => tab.id === tabId);
        if (idx === -1) {
          return prev;
        }
        const next = prev.filter((tab) => tab.id !== tabId);
        if (activeViewerTabId === tabId) {
          selectSidePanelTab(getSidePanelTabCloseFallback(sidePanelTabIds, tabId));
        }
        return next;
      });
    },
    [activeViewerTabId, selectSidePanelTab, sidePanelTabIds, t, viewerTabSaveStates, viewerTabs]
  );

  // Fixed side-panel tabs remain selectable even while viewer tabs stay mounted.
  const effectiveActiveViewerTabId = useMemo(() => {
    if (activeViewerTabId && viewerTabs.some((tab) => tab.id === activeViewerTabId)) {
      return activeViewerTabId;
    }
    return null;
  }, [activeViewerTabId, viewerTabs]);
  const activeViewerTab = useMemo(() => {
    if (!effectiveActiveViewerTabId) {
      return null;
    }
    return viewerTabs.find((tab) => tab.id === effectiveActiveViewerTabId) ?? null;
  }, [effectiveActiveViewerTabId, viewerTabs]);
  const activeViewerTabSaveState = effectiveActiveViewerTabId
    ? viewerTabSaveStates[effectiveActiveViewerTabId]
    : undefined;
  // One resolver for what this client can do with the session's files, shared
  // by the Files tree's right-click menu and the side panel's ⋯ menu so the two
  // can never offer different sets. It decides local-host vs remote itself.
  const activeSessionFileActions = useSessionFileActions({
    session: activeSession,
    fileProvider: activeSessionFileProvider,
  });
  const activeViewerFilePath = activeViewerTab?.type === 'file' ? activeViewerTab.filePath : null;
  const handleSaveCurrentFile = useCallback(() => {
    if (!effectiveActiveViewerTabId || activeViewerTab?.type !== 'file') {
      return;
    }
    setViewerTabSaveStates((prev) => {
      const previous = prev[effectiveActiveViewerTabId] ?? EMPTY_VIEWER_TAB_SAVE_STATE;
      return {
        ...prev,
        [effectiveActiveViewerTabId]: {
          ...previous,
          saveRequestSeq: previous.saveRequestSeq + 1,
        },
      };
    });
  }, [activeViewerTab?.type, effectiveActiveViewerTabId]);

  const currentBranch = useMemo(() => {
    const targetSession = activeDraftTab ? null : activeTabSession;
    return targetSession?.branchName?.trim() || '';
  }, [activeDraftTab, activeTabSession]);

  const handleCopyCurrentBranch = useCallback(() => {
    if (!currentBranch) {
      toast.error(t('sessions.currentBranchUnavailable', 'No current branch to copy'));
      return;
    }
    handleCopyText(
      currentBranch,
      t('sessions.currentBranchCopied', 'Current branch name copied to clipboard')
    );
  }, [currentBranch, handleCopyText, t]);

  const handleFocusActiveInput = useCallback(() => {
    requestAnimationFrame(() => {
      chatRefsMap.current.get(activeTabSessionId)?.focusInput();
    });
  }, [activeTabSessionId]);

  const handleRenameCurrentSession = useCallback(() => {
    const targetSession = activeDraftTab ? null : activeTabSession;
    if (!targetSession || targetSession.isArchived) {
      return;
    }
    setRenameDialogTarget({
      sessionId: targetSession.id,
      initialTitle: targetSession.title ?? '',
    });
  }, [activeDraftTab, activeTabSession]);

  const handleToggleCurrentSessionPinned = useCallback(() => {
    const targetSession = activeDraftTab ? null : activeTabSession;
    if (!targetSession || targetSession.isArchived) {
      return;
    }
    void setSessionPinned(targetSession.id, !targetSession.isPinned).catch((error: unknown) => {
      console.error('Failed to update session pin state', error);
      toast.error(t('sessions.pin.updateFailed', 'Failed to update pinned state'));
    });
  }, [activeDraftTab, activeTabSession, setSessionPinned, t]);

  const handleSwitchSessionTab = useCallback(
    (direction: 1 | -1) => {
      if (orderedSessionTabIds.length <= 1) {
        return;
      }
      const currentIndex = orderedSessionTabIds.indexOf(activeTabSessionId);
      const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex =
        (safeCurrentIndex + direction + orderedSessionTabIds.length) % orderedSessionTabIds.length;
      const nextTabId = orderedSessionTabIds[nextIndex];
      if (!nextTabId || nextTabId === activeTabSessionId) {
        return;
      }
      void handleSessionTabSelect(nextTabId);
    },
    [activeTabSessionId, handleSessionTabSelect, orderedSessionTabIds]
  );

  useCommand({
    id: 'session.archiveCurrent',
    title: t('commands.session.archiveCurrent', 'Archive Current Chat'),
    category: 'Session',
    keybindings: getCommandKeybindings('session.archiveCurrent'),
    when: () => Boolean(activeSession) && activeSession?.isArchived !== true,
    run: () => {
      setArchiveConfirmOpen(true);
    },
  });

  useCommand({
    id: 'session.toggleCurrentPinned',
    title: t('commands.session.toggleCurrentPinned', 'Toggle Current Chat Pinned'),
    category: 'Session',
    keybindings: getCommandKeybindings('session.toggleCurrentPinned'),
    /* While the URL-named child is still pending, `activeTabSession` falls
       back to the parent for display; mutating commands must not take that
       fallback as their target while the UI says a child is active. */
    when: () =>
      Boolean(activeTabSession) &&
      !activeDraftTab &&
      !activeTabIsPendingChild &&
      activeTabSession?.isArchived !== true,
    run: handleToggleCurrentSessionPinned,
  });

  useCommand({
    id: 'session.searchCurrent',
    title: t('commands.session.searchCurrent', 'Find in Current Chat'),
    category: 'Session',
    keybindings: getCommandKeybindings('session.searchCurrent'),
    when: () => Boolean(activeTabSession) && !activeDraftTab,
    run: handleOpenSearch,
  });

  useCommand({
    id: 'session.focusInput',
    title: t('commands.session.focusInput', 'Focus Current Input'),
    category: 'Editor',
    keybindings: getCommandKeybindings('session.focusInput'),
    when: () => Boolean(chatRefsMap.current.get(activeTabSessionId)),
    run: handleFocusActiveInput,
  });

  useCommand({
    id: 'session.saveCurrentFile',
    title: t('commands.session.saveCurrentFile', 'Save Current File'),
    category: 'Editor',
    keybindings: getCommandKeybindings('session.saveCurrentFile'),
    when: () => activeViewerTab?.type === 'file' && activeViewerTabSaveState?.canSave === true,
    run: handleSaveCurrentFile,
  });

  useCommand({
    id: 'session.toggleExplorerSidebar',
    title: t('commands.session.toggleExplorerSidebar', 'Toggle Files and Changes Sidebar'),
    category: 'View',
    keybindings: getCommandKeybindings('session.toggleExplorerSidebar'),
    when: () => Boolean(activeSession),
    run: handleToggleSidebar,
  });

  useCommand({
    id: 'session.newTab',
    title: t('commands.session.newTab', 'New Tab'),
    category: 'Session',
    keybindings: getCommandKeybindings('session.newTab'),
    when: () => Boolean(activeSession),
    run: handleNewTab,
  });

  useCommand({
    id: 'session.copyCurrentBranch',
    title: t('commands.session.copyCurrentBranch', 'Copy Current Branch'),
    category: 'Session',
    keybindings: getCommandKeybindings('session.copyCurrentBranch'),
    when: () => currentBranch.length > 0,
    run: handleCopyCurrentBranch,
  });

  useCommand({
    id: 'session.renameCurrent',
    title: t('commands.session.renameCurrent', 'Rename Current Chat'),
    category: 'Session',
    keybindings: getCommandKeybindings('session.renameCurrent'),
    /* Same pending-child rule as toggleCurrentPinned above. */
    when: () =>
      Boolean(activeTabSession) &&
      !activeDraftTab &&
      !activeTabIsPendingChild &&
      activeTabSession?.isArchived !== true,
    run: handleRenameCurrentSession,
  });

  useCommand({
    id: 'session.nextTab',
    title: t('commands.session.nextTab', 'Switch to Next Tab'),
    category: 'Navigation',
    keybindings: getCommandKeybindings('session.nextTab'),
    when: () => orderedSessionTabIds.length > 1,
    run: () => handleSwitchSessionTab(1),
  });

  useCommand({
    id: 'session.previousTab',
    title: t('commands.session.previousTab', 'Switch to Previous Tab'),
    category: 'Navigation',
    keybindings: getCommandKeybindings('session.previousTab'),
    when: () => orderedSessionTabIds.length > 1,
    run: () => handleSwitchSessionTab(-1),
  });

  useEffect(() => {
    /* Only a RESOLVED tab is worth remembering as last-active: persisting a
       still-syncing child would make the next entry restore a tab that may
       never resolve. Panel and viewer changes made while it loads are still
       the user's, so the write happens regardless — the conversation slot
       just keeps its previously stored value until the child resolves. */
    const persistedSessionTabId = activeTabIsPendingChild
      ? (readStoredLastActiveTabState(sessionId)?.sessionTabId ?? sessionId)
      : activeTabSessionId;
    writeStoredLastActiveTabState(sessionId, {
      sessionTabId: persistedSessionTabId,
      viewerTab: activeViewerTab,
      sidePanel: {
        open: isSidebarOpen,
        tab: activeSidebarTab,
        tabs: openedSidebarTabs,
        sideSessionId: activeSideSessionId,
      },
    });
  }, [
    activeSidebarTab,
    activeSideSessionId,
    activeTabIsPendingChild,
    activeTabSessionId,
    activeViewerTab,
    isSidebarOpen,
    openedSidebarTabs,
    sessionId,
  ]);

  // Side Chat always stays available: it launches another session rather than
  // toggling an already-open panel.
  const availableSidePanelOptions = useMemo(() => {
    const opened = new Set(openedSidebarTabs);
    const unopened = sidePanelFixedOptions.filter((option) => !opened.has(option.id));
    return sideChatOption ? [sideChatOption, ...unopened] : unopened;
  }, [openedSidebarTabs, sideChatOption, sidePanelFixedOptions]);

  const effectiveActiveSideSessionId = useMemo(
    () =>
      activeSideSessionId &&
      visibleSideSessions.some((sideSession) => sideSession.id === activeSideSessionId)
        ? activeSideSessionId
        : null,
    [activeSideSessionId, visibleSideSessions]
  );
  useEffect(() => {
    if (!effectiveActiveSideSessionId || mountedSideSessionIds.has(effectiveActiveSideSessionId)) {
      return;
    }
    setMountedSideSessionIds((current) => new Set(current).add(effectiveActiveSideSessionId));
  }, [effectiveActiveSideSessionId, mountedSideSessionIds]);
  useEffect(() => {
    if (
      !docMetaCacheReady ||
      !activeSideSessionId ||
      effectiveActiveSideSessionId ||
      Object.values(pendingForks).some((pending) => pending.targetSessionId === activeSideSessionId)
    ) {
      return;
    }
    setActiveSideSessionId(null);
  }, [activeSideSessionId, docMetaCacheReady, effectiveActiveSideSessionId, pendingForks]);
  const handleCloseSideSession = useCallback(
    async (sideSessionId: SessionId) => {
      if (!runtime || closingSideSessionIds.has(sideSessionId)) {
        return;
      }
      const sideSession = visibleSideSessions.find((candidate) => candidate.id === sideSessionId);
      if (!sideSession) {
        return;
      }
      setClosingSideSessionIds((current) => new Set(current).add(sideSessionId));
      try {
        const termination = await runtime.requestSessionTerminate(
          sideSession.machineId,
          sideSessionId,
          { timeoutMs: 30_000 }
        );
        if (!termination?.success) {
          throw new Error(termination?.error ?? 'Side session termination failed');
        }
        await deleteSessions([sideSessionId]);
        const { fallbackTabId, sidebarOpen } = getSidePanelTabStateAfterClose(
          sidePanelTabIds,
          getSideSessionPanelTabId(sideSessionId)
        );
        if (!sidebarOpen) {
          setIsSidebarOpen(false);
        }
        if (activeSideSessionId === sideSessionId) {
          selectSidePanelTab(fallbackTabId);
        }
      } catch (error) {
        console.error('Failed to close side session', { sideSessionId, error });
        toast.error(t('sessions.sideSession.closeFailed', 'Unable to close side chat'));
      } finally {
        setClosingSideSessionIds((current) => {
          const next = new Set(current);
          next.delete(sideSessionId);
          return next;
        });
      }
    },
    [
      activeSideSessionId,
      closingSideSessionIds,
      deleteSessions,
      runtime,
      selectSidePanelTab,
      sidePanelTabIds,
      t,
      visibleSideSessions,
    ]
  );

  const handleSidePanelTabSelect = useCallback(
    (tabId: string) => {
      desktopTabFocusRegionRef.current = 'side-panel';
      if (isViewerTabId(tabId)) {
        handleViewerTabSelect(tabId);
        return;
      }
      if (parseSideSessionPanelTabId(tabId)) {
        selectSidePanelTab(tabId);
        return;
      }
      handleSidebarTabSelect(tabId as SidebarTab);
    },
    [handleSidebarTabSelect, handleViewerTabSelect, selectSidePanelTab]
  );

  /* The ordinary current-artwork action reveals this session's design
     side-panel tab through the same path the panel's own strip uses. */
  const handleRevealDesignPanel = useCallback(() => {
    handleSidebarTabSelect('design');
    revealRightSidebar();
  }, [handleSidebarTabSelect, revealRightSidebar]);

  const handleSidePanelTabClose = useCallback(
    (tabId: string) => {
      const sideSessionId = parseSideSessionPanelTabId(tabId) as SessionId | null;
      if (sideSessionId) {
        void handleCloseSideSession(sideSessionId);
        return;
      }
      if (isViewerTabId(tabId)) {
        handleCloseViewerTab(tabId);
        return;
      }
      if (tabId === 'design') {
        void getIpcServices()
          ?.design.close(sessionId)
          .then((closed) => {
            if (closed) handleCloseSidebarTab('design');
          })
          .catch((error) => toast.error(String(error)));
        return;
      }
      handleCloseSidebarTab(tabId as SidebarTab);
    },
    [sessionId, handleCloseSideSession, handleCloseSidebarTab, handleCloseViewerTab]
  );

  const activeSidePanelTabId =
    effectiveActiveViewerTabId ??
    (effectiveActiveSideSessionId
      ? getSideSessionPanelTabId(effectiveActiveSideSessionId)
      : activeSidebarTab);
  const designCanvasVisible = isSidebarVisible && activeSidePanelTabId === 'design';
  const designOwnsSidePanel =
    Boolean(activeSession?.design) &&
    sidePanelTabs.length === 1 &&
    sidePanelTabs[0]?.kind === 'design' &&
    activeSidePanelTabId === sidePanelTabs[0].id;
  const resolveFocusedTabCloseTarget = useCallback(
    () =>
      getSessionTabCloseTarget({
        focusRegion: desktopTabFocusRegionRef.current,
        sidePanelOpen: isSidebarVisible,
        activeSidePanelTabId,
        activeConversationTabId: activeTabSessionId,
        parentConversationTabId: sessionId,
        conversationTabCount: orderedSessionTabIds.length,
      }),
    [
      activeSidePanelTabId,
      activeTabSessionId,
      isSidebarVisible,
      orderedSessionTabIds.length,
      sessionId,
    ]
  );

  useDesktopTabCloser(() => {
    const target = resolveFocusedTabCloseTarget();
    if (!target) return 'handled';
    if (target.kind === 'landing') {
      handleBackToList();
      return 'handled';
    }
    if (target.kind === 'side-panel') {
      handleSidePanelTabClose(target.tabId);
      return 'handled';
    }
    void handleTabClose(target.tabId);
    return 'handled';
  }, Boolean(activeSession));

  useEffect(() => {
    if (
      activeSidebarTab !== null ||
      effectiveActiveSideSessionId !== null ||
      effectiveActiveViewerTabId !== null ||
      sidePanelTabs.length === 0
    ) {
      return;
    }
    selectSidePanelTab(sidePanelTabs.at(-1)?.id ?? null);
  }, [
    activeSidebarTab,
    effectiveActiveSideSessionId,
    effectiveActiveViewerTabId,
    selectSidePanelTab,
    sidePanelTabs,
  ]);

  const visibleMachineIds = useMemo(
    () => new Set(sharingMachineAccessById.keys()),
    [sharingMachineAccessById]
  );
  const visibleLocalProjectKeys = useMemo(
    () => new Set(sharingProjectAccessByKey.keys()),
    [sharingProjectAccessByKey]
  );

  const sessionPresenceState = useMemo(() => {
    const base = resolveSessionDetailPresenceState({
      hasActiveSession: activeSession !== null,
      docMetaCacheReady,
      runtimeInitializing,
      runtimeWorkspaceId: runtime?.workspaceId ?? null,
      currentWorkspaceId,
      controlConnectionState,
    });
    return resolveSessionDetailVisibilityState({
      baseState: base,
      session: activeSession,
      visibleMachineIds,
      visibleLocalProjectKeys,
      machineVisibilityLoading,
      localProjectVisibilityLoading,
      currentUserId: user?.id ?? null,
    });
  }, [
    activeSession,
    controlConnectionState,
    currentWorkspaceId,
    docMetaCacheReady,
    localProjectVisibilityLoading,
    machineVisibilityLoading,
    runtime?.workspaceId,
    runtimeInitializing,
    user?.id,
    visibleLocalProjectKeys,
    visibleMachineIds,
  ]);

  /* One compact line per SessionDetail render into the crash-report ring
     buffer (`session-render-trace.ts`): a React #185 report shows only where
     the nested-update limit tripped; this shows what oscillated. Consecutive
     identical lines collapse, so steady-state renders cost one repeat bump. */
  recordSessionRenderTrace(
    `detail s=${shortTraceId(sessionId)} tab=${urlTab ?? '∅'} active=${shortTraceId(
      activeTabSessionId
    )}${activeTabIsPendingChild ? '(pending)' : ''} children=[${visibleChildSessions
      .map((s) => shortTraceId(s.id))
      .join(',')}] side=${sideSessions.length} archived=${archivedChildSessions.length} drafts=${
      draftTabs.length
    } meta=${activeSession ? 'y' : 'n'} presence=${sessionPresenceState} ready=${
      docMetaCacheReady ? 'y' : 'n'
    }`
  );

  if (sessionPresenceState === 'loading') {
    return (
      <LoadingPlaceholder
        title={t('sessions.route.loadingTitle', 'Loading session')}
        description={t('sessions.route.loadingDescription', 'Preparing conversation history.')}
      />
    );
  }

  if (sessionPresenceState === 'not-found') {
    return <SessionNotFound onBack={handleBackToList} />;
  }

  if (!activeSession) {
    return (
      <LoadingPlaceholder
        title={t('sessions.route.loadingTitle', 'Loading session')}
        description={t('sessions.route.loadingDescription', 'Preparing conversation history.')}
      />
    );
  }

  if (activeSession.parentSessionId && activeSession.parentSessionId !== sessionId) {
    return null;
  }

  /* The URL names a child tab whose meta has not reached this replica yet
     (a just-promoted draft, or a tab still syncing from another device).
     The tab STAYS active — bouncing to the parent is exactly the bug this
     replaces — and this surface holds the space until its meta arrives. */
  const pendingChildTabSurface = activeTabIsPendingChild ? (
    <div className="absolute inset-0 flex h-full flex-col items-center justify-center gap-3">
      {showPendingChildTabState ? (
        <>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t('sessions.tabWaitingForSync', 'Waiting for this conversation to sync…')}
          </p>
          <Button variant="ghost" size="sm" onClick={() => handleSessionTabSelect(sessionId)}>
            {t('sessions.tabBackToMain', 'Back to main conversation')}
          </Button>
        </>
      ) : null}
    </div>
  ) : null;

  const deleteConfirmDialog = (
    <Dialog open={deleteConfirmOpen} onOpenChange={(open) => setDeleteConfirmOpen(open)}>
      <DialogContent className={cn('max-w-sm')}>
        <DialogHeader>
          <DialogTitle>{t('archive.deleteConfirm.title', 'Delete permanently?')}</DialogTitle>
          <DialogDescription>
            {activeSession?.repoFullName
              ? t(
                  'archive.deleteConfirm.description.codeSession',
                  "This will delete the session and remove the session branch's worktree directory on your machine."
                )
              : t(
                  'archive.deleteConfirm.description.chatSession',
                  'This will permanently delete the chat session.'
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              void handleConfirmDeleteCurrentSession();
            }}
          >
            {t('archive.delete', 'Delete permanently')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const archiveConfirmDialog = (
    <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
      <DialogContent
        className={cn('max-w-sm')}
        // Focus the confirm button on open so Enter archives; Esc still cancels (Radix
        // default close-on-escape). Rejected onKeyDown-on-content: it double-fires when a
        // button already has focus.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          archiveConfirmButtonRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('sessions.archiveConfirm.title', 'Archive chat?')}</DialogTitle>
          <DialogDescription>
            {t(
              'sessions.archiveConfirm.description',
              'This chat will move to the archive. You can restore it later.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setArchiveConfirmOpen(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            ref={archiveConfirmButtonRef}
            onClick={() => {
              setArchiveConfirmOpen(false);
              void handleArchiveActiveTab();
            }}
          >
            {t('sessions.archiveConfirm.confirm', 'Archive')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const worktreeForkObservers = Object.entries(pendingForks)
    .filter(
      ([, pending]) => pending.placement === 'worktree' && pending.phase === 'awaiting-history'
    )
    .map(([sourceSessionId, pending]) => (
      <PendingWorktreeForkObserver
        key={pending.targetSessionId}
        targetSessionId={pending.targetSessionId}
        onCompleted={() =>
          handleForkedConversationPrepared(sourceSessionId, pending.targetSessionId)
        }
        onFailed={(message) => {
          if (!takePendingFork(sourceSessionId, pending.targetSessionId)) return;
          toast.error(message);
        }}
      />
    ));

  const cancelDirtyFork = () => {
    const confirmation = dirtyForkConfirmation;
    setDirtyForkConfirmation(null);
    if (!confirmation) return;
    setPendingForks((current) => {
      const next = { ...current };
      delete next[confirmation.source.id];
      return next;
    });
  };

  const dirtyForkDialog = (
    <Dialog
      open={dirtyForkConfirmation !== null}
      onOpenChange={(open) => {
        if (!open) cancelDirtyFork();
      }}
    >
      <DialogContent className={cn('max-w-md')}>
        <DialogHeader>
          <DialogTitle>{t('sessions.forkDirty.title', 'Uncommitted changes found')}</DialogTitle>
          <DialogDescription>
            {t(
              'sessions.forkDirty.description',
              'The new worktree starts from the latest committed HEAD. Uncommitted and untracked files will not be copied.'
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={cancelDirtyFork}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={() => {
              const confirmation = dirtyForkConfirmation;
              setDirtyForkConfirmation(null);
              if (!confirmation) return;
              void handleForkAssistant(confirmation.source, confirmation.turnId, 'worktree', {
                targetSessionId: confirmation.targetSessionId,
                acknowledgeDirtySource: true,
              });
            }}
          >
            {t('sessions.forkDirty.confirm', 'Continue from committed HEAD')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const renderViewerTabContent = (tab: ViewerTab, className = 'h-full', active = true) =>
    tab.type === 'file' ? (
      <SessionFileContentView
        key={`${activeSession.id}:${tab.id}`}
        sessionId={activeSession.id}
        session={activeSession}
        filePath={tab.filePath}
        {...(tab.fileId === undefined ? {} : { fileId: tab.fileId })}
        startLine={tab.startLine}
        endLine={tab.endLine}
        focusRequestSeq={tab.focusRequestSeq}
        htmlPreviewRequestSeq={tab.htmlPreviewRequestSeq}
        saveRequestSeq={viewerTabSaveStates[tab.id]?.saveRequestSeq ?? 0}
        copyMarkdownRequestSeq={viewerTabSaveStates[tab.id]?.copyMarkdownRequestSeq ?? 0}
        fileProvider={activeSessionFileProvider}
        fileProviderPending={activeSessionFileProviderPending}
        fileProviderMessage={activeSessionFileProviderMessage}
        active={active}
        {...(activeSessionCodeCollabFiles.role === undefined
          ? {}
          : { fileProviderRole: activeSessionCodeCollabFiles.role })}
        onSaveStateChange={(state) => handleViewerTabSaveStateChange(tab.id, state)}
        visualAnnotationReferenceKeys={
          visualAnnotationReferenceKeysBySession[activeSession.id] ??
          EMPTY_VISUAL_ANNOTATION_REFERENCE_KEYS
        }
        onAddVisualAnnotationToChat={(reference) =>
          handleAddPreviewAnnotationToChat(activeSession.id, reference)
        }
        onToggleVisualAnnotationInChat={(reference) =>
          handleTogglePreviewAnnotationInChat(activeSession.id, reference)
        }
        onOpenFile={(target) => {
          // The LSP locator travels as structured fields, never encoded into
          // the path. Round-tripping it through a `:L<line>` suffix meant the
          // path had to be re-parsed, and a filename that legitimately ends in
          // `:<digits>` lost its tail. The viewer scrolls by line, so the
          // column has nowhere to go and is dropped here rather than encoded.
          handleOpenFile(target.filePath, {
            pathKind: 'canonical',
            // Was reported as `markdown_link` only because the locator used to
            // ride in the path as a `:L<n>` suffix; name the real source now.
            ...(target.line === undefined ? {} : { startLine: target.line + 1 }),
          });
        }}
        className={className}
      />
    ) : (
      <SessionConversationDiffPanel
        sessionId={activeSession.id}
        turnId={tab.turnId}
        filePaths={tab.filePaths}
        focusFilePath={tab.focusFilePath}
        focusComment={tab.focusComment}
        focusRequestSeq={tab.focusRequestSeq}
        mode={tab.mode ?? 'conversation'}
        fileDiffs={(tab.mode ?? 'conversation') === 'base' ? [] : resolveTurnFileDiffs(tab.turnId)}
        fileDiffsPending={!sessionDiffReady}
        session={activeSession}
        workspaceSession={workspaceOwnerSession}
        onSendToChat={handleAddCommentReferenceToActiveChatInput}
        commentReferenceKeys={activeCommentReferenceKeys}
        fileProvider={
          (tab.mode ?? 'conversation') === 'base' ||
          canOpenHistoricalDiffs ||
          activeSessionFileProviderRequested
            ? activeSessionFileProvider
            : null
        }
        fileProviderPending={
          (tab.mode ?? 'conversation') === 'base' ||
          canOpenHistoricalDiffs ||
          activeSessionFileProviderRequested
            ? activeSessionFileProviderPending
            : false
        }
        onOpenFile={handleOpenFileFromDiff}
        className={className}
      />
    );

  // Traffic lights auto-hide in native fullscreen — no inset to reserve then.
  const hasMacOSTitlebarInset = isMacOSElectronRenderer() && !isElectronFullscreen;

  const nonBrowserSidebarContent =
    activeSidebarTab === 'files' || activeSidebarTab === 'changes' ? (
      <FileTreeView
        session={activeSession}
        handleOpenFile={handleOpenIndexedFile}
        fileProvider={activeSessionFileProvider}
        fileProviderPending={activeSessionFileProviderPending}
        fileProviderMessage={activeSessionFileProviderMessage}
        autoCodeCollab={false}
        fileMenuItems={activeSessionFileActions.menuItems}
        // Opening a file selects its viewer tab, which unmounts this tree. Key
        // its expanded folders per session so returning to Files restores them.
        viewStateKey={`session-files:${activeSession.id}`}
      />
    ) : null;

  // Keep the browser mounted while another sidebar tab is selected. Managed
  // pages retain DOM state and Electron's native view is only hidden, so tab
  // switching behaves like a browser rather than rebuilding the page.
  const sidebarContent = (
    <div className="relative h-full min-h-0">
      {activeSession.design && openedSidebarTabs.includes('design') ? (
        <div
          className={cn(
            'absolute inset-0',
            activeSidebarTab !== 'design' && 'invisible pointer-events-none'
          )}
        >
          <DesignCanvas
            toolbarHost={designOwnsSidePanel ? designToolbarHost : null}
            onReferenceSelection={(reference, prompt) => {
              const chat = chatRefsMap.current.get(activeTabSessionId);
              if (
                activeTabSessionId !== activeSession.id ||
                !chat ||
                !('referenceDesignSelection' in chat)
              )
                throw Error(
                  t(
                    'design.referenceConversationUnavailable',
                    'Open this artwork’s conversation before referencing elements'
                  )
                );
              chat.referenceDesignSelection(
                reference,
                t('design.selectedElements', 'Selected elements ({{count}})', {
                  count: reference.elementIds.length,
                }),
                prompt
              );
            }}
            onSyncSelection={(reference, label) => {
              const chat = chatRefsMap.current.get(activeTabSessionId);
              if (
                activeTabSessionId !== activeSession.id ||
                !chat ||
                !('syncDesignSelection' in chat)
              )
                return;
              chat.syncDesignSelection(reference, label);
            }}
            name={activeSession.title || t('design.untitled', 'Untitled design')}
            key={activeSession.id}
            sessionId={activeSession.id}
            artworkId={activeSession.design?.artworkId ?? activeSession.id}
            workspaceSlug={workspaceSlug ?? ''}
            active={
              activeSidebarTab === 'design' &&
              isSidebarVisible &&
              effectiveActiveViewerTabId === null &&
              effectiveActiveSideSessionId === null
            }
          />
        </div>
      ) : null}
      {activeBrowserSession && openedSidebarTabs.includes('browser') ? (
        <div
          className={cn(
            'absolute inset-0',
            activeSidebarTab !== 'browser' && 'invisible pointer-events-none'
          )}
          aria-hidden={activeSidebarTab !== 'browser'}
        >
          <SessionBrowserPanel
            session={activeBrowserSession}
            active={activeSidebarTab === 'browser' && isSidebarVisible}
            candidateNavigationRequestId={
              browserCandidateNavigationRequest?.sessionId === activeBrowserSession.id
                ? browserCandidateNavigationRequest.id
                : 0
            }
            onCandidateNavigationRequestHandled={handleBrowserCandidateNavigationRequestHandled}
            visualAnnotationReferenceKeys={
              visualAnnotationReferenceKeysBySession[activeBrowserSession.id] ??
              EMPTY_VISUAL_ANNOTATION_REFERENCE_KEYS
            }
            onAddVisualAnnotationToChat={(reference) =>
              handleAddPreviewAnnotationToChat(activeBrowserSession.id, reference)
            }
            onToggleVisualAnnotationInChat={(reference) =>
              handleTogglePreviewAnnotationInChat(activeBrowserSession.id, reference)
            }
          />
        </div>
      ) : null}
      {activeSidebarTab !== 'browser' && activeSidebarTab !== 'design' ? (
        <div className="absolute inset-0">{nonBrowserSidebarContent}</div>
      ) : null}
    </div>
  );

  // Viewers and side chats render their own absolutely positioned surfaces on
  // top; the fixed-panel body only shows when neither owns the panel.
  const showFixedSidePanelBody =
    effectiveActiveViewerTabId === null && effectiveActiveSideSessionId === null;
  const defaultSizes = activeSession.design
    ? getDesignPanelDefaultSizes(typeof window === 'undefined' ? 0 : window.innerWidth)
    : showFixedSidePanelBody
      ? { main: 75, sidebar: 25 }
      : { main: 60, sidebar: 40 };

  const sidebarToggleButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleToggleSidebar}
      aria-label={
        isSidebarVisible
          ? t('sessions.sidebar.hide', 'Hide right panel')
          : t('sessions.sidebar.show', 'Show right panel')
      }
      className={cn('h-7 w-7 shrink-0 text-muted-foreground', !isSidebarVisible && 'mr-[9px]')}
    >
      <PanelRight className="h-4 w-4" />
    </Button>
  );

  const leftSidebarExpandButton = isLeftSidebarHidden ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => showNavigationSidebar()}
      aria-label={t('sessions.leftSidebar.show', 'Show navigation sidebar')}
      className="h-7 w-7 shrink-0 text-muted-foreground"
    >
      <PanelLeft className="h-4 w-4" />
    </Button>
  ) : null;

  /* Right-side window controls for the merged top bar: the parent session's
     header toolbar (current artwork / "…" menu) + the sidebar toggle.
     Rendered by SessionChatInterface (headerVariant="toolbar") so the menu
     keeps root-scoped presentation while selected-tab actions are delegated. */
  const desktopHeaderToolbar = (
    <SessionChatInterface
      session={activeSession}
      workspaceSession={activeSession}
      className="h-full shrink-0"
      headerVariant="toolbar"
      onRevealDesignPanel={designCanvasVisible ? undefined : handleRevealDesignPanel}
      headerEndSlot={<>{!isSidebarVisible ? sidebarToggleButton : null}</>}
      titleSyncing={activeSessionDocIsSyncing}
      hideMessageArea
      onArchiveSession={handleArchiveCurrentSession}
      onRestoreSession={handleRestoreCurrentSession}
      onDeleteSession={handleRequestDeleteCurrentSession}
      onOpenSearch={handleOpenSearch}
      onCopyConversationHistory={handleCopyConversationHistory}
      onRequestRename={!activeDraftTab ? handleRenameCurrentSession : undefined}
      onForkSession={
        !activeDraftTab && activeTabSession && canForkSession(activeTabSession)
          ? handleForkCurrentSession
          : undefined
      }
      forkingAssistantMessageId={
        activeTabSession ? pendingForks[activeTabSession.id]?.turnId : null
      }
      onShareAsImage={
        activeDraftTab
          ? undefined
          : () => {
              void handleShareAsImage();
            }
      }
      onNavigateSession={handleNavigateSession}
      browserActionSession={activeBrowserSession}
      onOpenBrowser={() => {
        if (activeBrowserSession) {
          handleOpenBrowser(activeBrowserSession.id);
        }
      }}
    />
  );

  /* Single-row desktop top bar: [sidebar expand] [session tabs …] [toolbar].
     Replaces the old two-row header (repo title row + tab bar) — repo identity
     lives in the context strip above the composer and in the "…" menu. */
  const tabBar = (
    <SessionTabBar
      variant="session"
      parentSession={activeSession}
      childSessions={visibleChildSessions}
      draftTabs={draftTabs}
      tabOrder={sessionTabOrder}
      activeTabSessionId={activeTabSessionId}
      onTabSelect={handleSessionTabSelect}
      onNewTab={handleNewTab}
      onTabRename={handleTabRename}
      onTabClose={handleTabClose}
      archivedChildSessions={archivedChildSessions}
      onTabRestore={handleTabRestore}
      onTabReorder={handleSessionTabReorder}
      onMentionSession={handleInsertDroppedSessionMention}
      leftSlot={leftSidebarExpandButton}
      rightSlot={desktopHeaderToolbar}
      className={cn(
        // The macOS traffic lights sit over the LEFT sidebar (or, when it is
        // collapsed, over the horizontally-cleared `pl-[4.5rem]` gap below),
        // never over this top bar — so it must not reserve vertical inset.
        //
        // `mt-0.5`, not `mt-2`: the tab pills share a top border line with the
        // sidebar and side-panel cards, and both of those sit at `mt-2` (8px).
        // The h-8 pills are centered inside this h-11 row, so the row must start
        // 6px higher for them to land on that same line: 2 + (44 - 32) / 2 = 8.
        // Re-derive this if the row or the pill height changes.
        'mt-0.5 h-11',
        isLeftSidebarHidden && hasMacOSTitlebarInset && 'pl-[4.5rem]',
        !isSidebarVisible && windowsCaptionPadClass
      )}
    />
  );
  // Props every mounted conversation surface needs, whether it renders as a top
  // tab or as a right-panel side chat. Surface-specific props stay at the call
  // site so what each variant deliberately omits is visible there.
  const getSharedChatSurfaceProps = (
    chatSession: SessionMeta,
    isActive: boolean,
    // Selected is not the same as on screen: a side chat stays mounted while the
    // whole right panel is collapsed. Only a visible surface may clear unread.
    isVisible: boolean = isActive
  ) => {
    const pendingForkSourceId = pendingForkSourceByTargetSessionId.get(chatSession.id);
    return {
      ref: (element: SessionChatInterfaceHandle | null) => setChatTabRef(chatSession.id, element),
      claimNavigationFocus:
        isActive && chatSession.id === sessionId ? claimNavigationFocus : undefined,
      session: chatSession,
      workspaceSession: activeSession,
      className: 'h-full',
      hideHeader: true,
      syncEnabled: isActive || pendingForkSourceId !== undefined,
      isVisible,
      onFileDiffClick: handleOpenFileDiffForChat,
      onFilePathClick: handleOpenFile,
      onOpenHtmlFile: handleOpenHtmlFile,
      onOpenBrowser: () => handleOpenBrowser(chatSession.id, true),
      onOpenExistingBrowser: () => handleOpenBrowser(chatSession.id, false),
      onNavigateToComment: handleNavigateToComment,
      onCommentReferencesChange: getCommentReferencesChangeHandler(chatSession.id),
      onVisualAnnotationReferencesChange: getVisualAnnotationReferencesChangeHandler(
        chatSession.id
      ),
      onVisualAnnotationReferencesSubmitted: getVisualAnnotationReferencesSubmittedHandler(
        chatSession.id
      ),
      onNavigateSession: handleNavigateSession,
      onConversationPrepared: pendingForkSourceId
        ? () => handleForkedConversationPrepared(pendingForkSourceId, chatSession.id)
        : undefined,
      onConversationPrepareError: pendingForkSourceId
        ? () => handleForkedConversationPrepareError(pendingForkSourceId, chatSession.id)
        : undefined,
    };
  };

  const desktopChatSurfaces = (
    <SessionMentionDropLayer
      enabled
      excludeSessionId={sessionMentionExcludeId}
      onDropSessionId={handleInsertDroppedSessionMention}
    >
      {[activeSession, ...visibleChildSessions].map((tabSession) => {
        const isActive = tabSession.id === activeTabSessionId;
        const externalHistoryRefresh = externalHistoryRefreshBySessionId[tabSession.id];
        const externalHistoryProviderLabel = externalHistoryRefresh
          ? getExternalHistoryProviderLabel(externalHistoryRefresh.provider)
          : undefined;
        return (
          <div
            key={tabSession.id}
            className={cn('absolute inset-0', !isActive && 'hidden')}
            aria-hidden={!isActive}
          >
            <SessionChatInterface
              {...getSharedChatSurfaceProps(tabSession, isActive)}
              paintSessionMentionOverlay={false}
              isExternalHistoryRefreshing={externalHistoryRefresh !== undefined}
              externalHistoryProviderLabel={externalHistoryProviderLabel}
              messageFileDiffEntriesByTurn={
                tabSession.id === activeSessionTabId ? messageFileDiffEntriesByTurn : undefined
              }
              onOpenBrowser={() => handleOpenBrowser(tabSession.id, true)}
              onForkLastAssistant={
                canForkSession(tabSession)
                  ? (turnId, destination) => handleForkDestination(tabSession, turnId, destination)
                  : undefined
              }
              forkingAssistantMessageId={pendingForks[tabSession.id]?.turnId}
            />
          </div>
        );
      })}
      {draftTabs.map((draft) => {
        const isActive = draft.id === activeTabSessionId;
        return (
          <div
            key={draft.id}
            className={cn('absolute inset-0', !isActive && 'hidden')}
            aria-hidden={!isActive}
          >
            <DraftSessionChatInterface
              ref={(el) => setChatTabRef(draft.id, el)}
              draft={draft}
              parentSession={activeSession}
              commandsEnabled={isActive}
              onDraftChange={handleDraftChange}
              onSendDraft={handleSendDraft}
              onCommentReferencesChange={getCommentReferencesChangeHandler(draft.id)}
            />
          </div>
        );
      })}
      {pendingChildTabSurface}
    </SessionMentionDropLayer>
  );

  const desktopViewerSurfaces = viewerTabs.map((tab) => {
    const isActive = tab.id === effectiveActiveViewerTabId;
    return (
      <div
        key={tab.id}
        className={isActive ? 'h-full' : 'hidden h-full'}
        aria-hidden={!isActive || !isSidebarVisible}
      >
        {renderViewerTabContent(tab, 'h-full', isActive && isSidebarVisible)}
      </div>
    );
  });

  const desktopSideSessionSurfaces = visibleSideSessions
    .filter(
      (sideSession) =>
        mountedSideSessionIds.has(sideSession.id) ||
        // A freshly forked target must mount to report durable history ready;
        // that report is what activates it.
        pendingForkSourceByTargetSessionId.has(sideSession.id)
    )
    .map((sideSession) => {
      const isActive = sideSession.id === effectiveActiveSideSessionId;
      return (
        <div
          key={sideSession.id}
          className={cn('absolute inset-0', !isActive && 'hidden')}
          aria-hidden={!isActive}
        >
          <SessionChatInterface
            {...getSharedChatSurfaceProps(sideSession, isActive, isActive && isSidebarVisible)}
          />
        </div>
      );
    });

  // White reading surface (not bg-sidebar): the file editor/monaco canvas is
  // pure white, so a gray panel shell left a two-tone mismatch. Match the
  // surrounding cool-white chrome; keep a light border + soft shadow for card lift.
  const desktopSecondaryPanel = (
    <div
      data-molly-session-tab-region="side-panel"
      className={cn(
        'mx-2 mb-2 flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-background shadow-[0_1px_3px_-1px_rgba(15,17,21,0.08),0_1px_2px_rgba(15,17,21,0.04)]',
        'mt-2 h-[calc(100%_-_1rem)]'
      )}
    >
      <SessionSidePanelTabBar
        tabs={sidePanelTabs}
        activeTabId={activeSidePanelTabId}
        availablePanels={availableSidePanelOptions}
        onTabSelect={handleSidePanelTabSelect}
        onTabClose={handleSidePanelTabClose}
        onPanelOpen={handleSidePanelOptionOpen}
        addPanelLabel={t('sessions.sidebar.addPanel', 'Add panel')}
        closeTabLabel={(tabLabel) =>
          t('sessions.fileViewer.closeTab', 'Close {{fileName}}', { fileName: tabLabel })
        }
        moreSlot={
          <SessionFileActionsMenu
            filePath={activeViewerFilePath}
            items={activeSessionFileActions.menuItems}
          />
        }
        endSlot={sidebarToggleButton}
        soloPanelContent={
          designOwnsSidePanel ? (
            <div ref={setDesignToolbarHost} className="flex min-w-0 flex-1 items-center gap-2" />
          ) : undefined
        }
        soloPanelMinWidth={DESIGN_CANVAS_TOOLBAR_MIN_WIDTH}
        className={cn('border-b border-border/50 bg-background', 'h-11', windowsCaptionPadClass)}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {showFixedSidePanelBody && activeSidebarTab !== null ? sidebarContent : null}
        {showFixedSidePanelBody && activeSidebarTab === null && sidePanelTabs.length === 0 ? (
          <SessionSidePanelEmptyState
            panels={sidePanelOptions}
            onPanelOpen={handleSidePanelOptionOpen}
            title={t('sessions.sidebar.emptyTitle', 'Open a panel')}
            description={t(
              'sessions.sidebar.emptyDescription',
              'Choose what you want to see in this sidebar.'
            )}
          />
        ) : null}
        {desktopSideSessionSurfaces}
        {desktopViewerSurfaces}
      </div>
    </div>
  );

  // Pointer capture is required because clicking non-focusable panel content leaves
  // document.activeElement in the previous region and would close the wrong tab.
  const handleDesktopTabRegionInteraction = (target: EventTarget | null, root: HTMLElement) => {
    if (!(target instanceof Element) || !root.contains(target)) return;
    desktopTabFocusRegionRef.current = target.closest(
      '[data-molly-session-tab-region="side-panel"]'
    )
      ? 'side-panel'
      : 'conversation';
  };

  return (
    <div
      className="h-full"
      onPointerDownCapture={(event) =>
        handleDesktopTabRegionInteraction(event.target, event.currentTarget)
      }
      onFocusCapture={(event) =>
        handleDesktopTabRegionInteraction(event.target, event.currentTarget)
      }
    >
      <DesktopSessionDetailLayout
        defaultSizes={defaultSizes}
        layoutId={activeSession.design ? DESIGN_PANEL_LAYOUT_ID : undefined}
        topBar={tabBar}
        chatSurfaces={desktopChatSurfaces}
        secondaryPanel={desktopSecondaryPanel}
        sidebarOpen={isSidebarVisible}
        onSidebarCollapse={handleToggleSidebar}
        deleteConfirmDialog={deleteConfirmDialog}
        sidebarRestoreSeq={sidebarRestoreSeq}
      />
      {}
      {archiveConfirmDialog}
      {dirtyForkDialog}
      {worktreeForkObservers}
      <RenameSessionDialog
        target={renameDialogTarget}
        onClose={() => setRenameDialogTarget(null)}
      />
      <ChatShareImageDialog
        open={shareImageTarget != null}
        onOpenChange={(open) => {
          if (!open) setShareImageTarget(null);
        }}
        session={shareImageTarget?.session ?? null}
        messages={shareImageTarget?.messages ?? []}
        agentName={shareImageTarget?.agentName}
      />
    </div>
  );
};

export default SessionDetail;
