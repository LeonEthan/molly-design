import { CanvasSizeSelector } from './canvas-size-selector';
import { usePendingDesignRecovery } from '@/components/sessions/design-canvas';
import { chatLandingCanvasDraftAtomFamily } from '@/atoms/chat-landing-draft';
import { writeStoredLastActiveTabState } from '@/lib/session-draft-tabs';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  buildPendingUserHistoryEntry,
  buildSessionPreparationRunConfig,
  buildSessionTurnInputConfig,
  extractPromptPreviewFromInputBlocks,
  getServerNow,
  hashAnalyticsId,
  type SessionStartFailureReason,
  normalizeSessionInputBlocks,
  type AgentConfigMeta,
  type AgentRole,
  type AgentRoleId,
  githubFetchBranches,
  type LocalProjectId,
  type MachineId,
  type MachineViewMeta,
  type ProjectRef,
  type WorktreeSetupScriptConfig,
  type WorktreeCleanupScriptConfig,
  type WorkspaceId,
} from '@molly/shared';
import { usePostHog } from '@posthog/react';
import { RefreshCw, PanelLeft } from 'lucide-react';
import { Button } from '@/ui/button';

import { type AgentSelection } from '@/components/shared';
import { cn } from '@/lib/utils';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { flushDesignCanvasBeforeSend } from '@/lib/design-canvas-save-gate';
import {
  chatLandingSessionStateAtomFamily,
  getAllAgentConfigAtom,
  runtimeInitializingAtom,
  navigationSidebarHiddenAtom,
  showNavigationSidebarAtom,
  tasksFeatureEnabledAtom,
  userAtom,
} from '@/atoms';
import { docMetaCacheReadyAtom } from '@/atoms/doc-meta';
import { localProbeAttemptedAtom, localProbeResultAtom } from '@/atoms/local-probe';
import { buildAgentPrompt } from '@/lib';

import { isImeComposingKeyboardEvent } from '@/lib/ime';
import { useNavigate } from '@tanstack/react-router';
import { activeWorkspaceRuntimeAtom } from '@/atoms/runtime';

import { toast } from 'sonner';
import { useOpenSettings } from '@/hooks/use-open-settings';
import {
  focusFirstChatLandingOption,
  useChatLandingKeyboardNav,
} from '@/hooks/use-chat-landing-keyboard-nav';
import { useFireOnKeyChange, useFireOncePerKey } from '@/hooks/use-fire-once';
import { useSessionActions } from '@/hooks/use-session-actions';
import { useChatLandingDefaults } from '@/hooks/use-chat-landing-defaults';
import {
  useAcpSessionConfigSelectionState,
  useResolvedAcpSessionConfigSelection,
} from '@/hooks/use-acp-session-config-selection';
import { useOnlineMachineIds } from '@/hooks/use-machine-online-status';
import { useResolvedWorkspaceScope } from '@/hooks/use-resolved-workspace-scope';
import {
  getChatLandingAgentSelectionsForMachine,
  readChatLandingDefaults,
  resolvePreferredChatLandingAgentSelection,
} from '@/lib/chat-landing-defaults';
import {
  agentDefaultsCache,
  githubBranchesCache,
  persistAgentSessionDefaults,
} from '@/lib/local-storage-cache';
import { filterAcpSessionConfigOptionValues } from '@/lib/acp-session-config-selection';
import {
  buildRecentRunConfigItems,
  describeRunConfigSelection,
  getRecentRunConfigKey,
  readRecentRunConfigs,
  recordRecentRunConfig,
  resolveApplicableConfigOptionValues,
  sanitizeConfigOptionValues,
  type RecentRunConfigRecord,
} from '@/lib/recent-run-configs';
import {
  buildComposerAgentRoleItems,
  doesAgentRolePinPermissionMode,
  isComposerAgentRoleApplied,
  resolvePendingAgentRoleSelection,
} from '@/lib/composer-agent-roles';
import { buildAgentRoleFormValueFromRunConfig } from '@/lib/agent-role-form';
import {
  AgentRoleEditorDialog,
  openAgentRoleEditorForCreate,
  openAgentRoleEditorForEdit,
  type AgentRoleEditorState,
} from '@/components/settings/agent-role-editor-dialog';
import { useAcpSelectorOptions } from '@/hooks/use-acp-selector-options';
import {
  useAgentRoleAvailability,
  useWorkspaceAgentRoles,
} from '@/hooks/use-workspace-agent-roles';
import { useAvailableCommands } from '@/hooks/use-available-commands';

import { useResolvedTheme } from '../../theme-provider';
import {
  areChatLandingBranchListsEqual,
  createChatLandingBranchSnapshot,
  getGitHubBranchesCacheId,
  resolveChatLandingBranchSelection,
  type ChatLandingBranchSnapshot,
} from '@/lib/chat-landing-branches';

import {
  capturePostHogEvent,
  detectAppLaunchMode,
  getDurationSinceMs,
  getPerformanceNowMs,
} from '@/lib/posthog-analytics';
import {
  SESSION_ACP_CONFIG_USED_EVENT,
  buildSessionCreateAcpAnalyticsProperties,
} from '@/lib/session-create-analytics';
import { toIntlLocale } from '@/lib/intl-locale';
import {
  arePastedTextDraftsEqual,
  getPastedTextByteSize,
  getPastedTextCharacterCount,
  getPastedTextDraftsAfterInsertion,
  insertPastedTextDraft,
  isPastedTextTooLarge,
  MAX_PASTED_TEXT_BYTE_SIZE,
  normalizePastedTextDraft,
  sanitizePastedTextDrafts,
  shouldCapturePastedTextDraft,
  type PastedTextDraft,
} from '@/lib/pasted-text-draft';
import { formatFileSize } from '@/lib/session-file-presentation';
import { wrapPastedTextChipLabel } from '@/components/mentions/mention-chips';

import { ErrorBoundary } from '@/components/error-boundary';
import { ChatLandingView, type ChatLandingHintType } from './chat-landing-view';
import { getSessionCreationNavigation } from './submission/use-composer-navigation-focus';
import { getSelectorTagClassName } from './chat-landing-selectors';
import {
  extractIssuePRMentionsFromText,
  useKnownIssuePrItems,
} from '@/components/mentions/issue-pr-hash-mention';
import { useMentionPromptExpansion } from '@/components/mentions/mention-expansion';
import type { Mention as MentionRange } from '@/ui/mention/index';
import {
  arePersistedMentionRangesEqual,
  toPersistedMentionRanges,
} from '@/components/mentions/mention-persistence';
import {
  buildChatLandingDraftKey,
  chatLandingSubmittingAtomFamily,
} from '@/atoms/chat-landing-draft';
import { useChatLandingImageDraft } from '@/hooks/use-chat-landing-image-draft';
import { useChatLandingFileDraft } from '@/hooks/use-chat-landing-file-draft';
import { useChatLandingDraftSession } from '@/hooks/use-chat-landing-draft-session';
import { useSessionPreparation } from '@/hooks/use-session-preparation';
import { getCommandKeybindings, useCommand } from '@/lib/commands';
import { isElectronRenderer } from '@/lib/electron';
import { withGitHubTokenRetry } from '@/lib/github-token';
import { useVisibleMachineMetas } from '@/hooks/use-visible-machine-metas';
import { useVisibleLocalProjectsFromMachineIndex } from '@/hooks/use-visible-local-projects';
import { useLocalProjectRemovalResultNotifications } from '@/hooks/use-remove-local-project';
import {
  useVisibleArchivedSessionMetas,
  useVisibleSessionMetas,
} from '@/hooks/use-visible-session-metas';
import { useReportVisibleSessionsForEagerSync } from '@/hooks/use-report-visible-sessions-for-eager-sync';
import { getLocalProjectVisibilityKey } from '@/lib/visible-local-project-index';
import { openExternalUrl } from '@/lib/native-browser';
import { getDownloadPageUrl, MOLLY_ISSUES_URL } from '@/lib/molly-urls';

import { getChatComposerPromptPlaceholderKey } from '@/lib/chat-composer-placeholder';
import { selectPastedClipboardFiles, splitImageAndFileAttachments } from '@/lib/file-drop';
import { canShowSubscriptionRateLimits } from '@/lib/session-usage';
import { canShowCodexResetForecast } from '@/lib/codex-reset-forecast';
import { type SessionContextType } from './context-switch';
import {
  UNIFIED_PROJECT_OPTION_RENDER_LIMIT,
  UnifiedProjectSelectorView,
  buildUnifiedLocalProjectOptions,
  type LocalProjectSelection,
  type UnifiedProjectSelection,
} from './unified-project-selector';
import {
  DesktopMachineMenu,
  DesktopPermissionModeButton,
  DesktopRunConfigMenu,
} from '@/components/sessions/desktop-run-config-menu';
import { resolvePermissionModeFace } from '@/lib/permission-mode-face';
import { SessionUsagePopover } from '@/components/sessions/session-usage-popover';

import { useSessionMcpSelection } from '@/hooks/use-session-mcp-selection';

import { AddLocalProjectDialogContainer } from '@/components/local-projects/add-local-project-dialog-container';

import {
  isThoughtLevelSelector,
  type AcpSelectConfigOptionSelector,
} from '@/components/shared/acp-selector-options';
import { useComposerCycleCommands } from '@/hooks/use-composer-cycle-commands';

import {
  buildChatLandingPreSelectionKey,
  getChatLandingSelectionSearch,
  getChatLandingSelectionSyncDecision,
  type ChatLandingSearch,
  getChatLandingHasAnyOnlineMachine,
  getChatLandingHintType,
  getChatLandingInitialDataLoading,
  getChatLandingProjectRecency,
  getChatLandingSelectedMachineProjectStatus,
  getEmptyLocalProjectsMessageKey,
  getChatLandingSubmitDisabled,
  getChatLandingVisibleComposerStatus,
  isChatLandingMachineReachable,
} from './chat-landing-derived';

interface ChatLandingProps {
  workspaceSlug: string;
  preSelectedContext?: 'local' | 'github' | 'chat';
  preSelectedMachine?: string;
  preSelectedProject?: string;
  preSelectedRepo?: string;
  /**
   * Mirrors the composer's effective selection back into the chat-route URL
   * (with `replace`) once the URL names a selection. Passed by the desktop
   * chat route only; mobile keeps its base-context model.
   */
  onSelectionUrlSync?: (search: ChatLandingSearch) => void;
}

const CHAT_LANDING_MACHINE_FLOCK_FAMILIES = [
  'localProject',
  'deleteLocalProjectCommand',
  'acpCapability',
  'rateLimit',
  'agentConfig',
  'providerSetup',
] as const;
const EMPTY_FRESH_REPOSITORIES: { fullName: string; private: boolean }[] = [];
const EMPTY_WORKSPACE_REPOSITORIES: {
  repoFullName: string;
  worktreeSetup?: WorktreeSetupScriptConfig;
  worktreeCleanup?: WorktreeCleanupScriptConfig;
}[] = [];
const EMPTY_REPOSITORIES: { fullName: string }[] = [];

export function ChatLanding(props: ChatLandingProps) {
  return <WorkspaceChatLanding key={props.workspaceSlug} {...props} />;
}

function WorkspaceChatLanding({
  workspaceSlug,
  preSelectedContext,
  preSelectedMachine,
  preSelectedProject,
  preSelectedRepo,
  onSelectionUrlSync,
}: ChatLandingProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { openSettings } = useOpenSettings();
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const postHog = usePostHog();
  const currentUser = useAtomValue(userAtom);
  const userId = currentUser?.id;
  const tasksFeatureEnabled = useAtomValue(tasksFeatureEnabledAtom);
  const promptEnterKeyHint = 'send' as const;
  const resolvedTheme = useResolvedTheme();
  const isDark = resolvedTheme === 'dark';
  const tone = isDark ? 'dark' : 'light';
  const intlLocale = useMemo(
    () => toIntlLocale(i18n.resolvedLanguage ?? i18n.language),
    [i18n.language, i18n.resolvedLanguage]
  );
  const numberFormatter = useMemo(() => new Intl.NumberFormat(intlLocale), [intlLocale]);
  const runtimeInitializing = useAtomValue(runtimeInitializingAtom);
  const executorConfigs = useAtomValue(getAllAgentConfigAtom);
  const { workspaceId } = useResolvedWorkspaceScope();
  const visibleMachineIndex = useVisibleMachineMetas({
    machineFlockFamilies: CHAT_LANDING_MACHINE_FLOCK_FAMILIES,
  });
  const { machines, isLoading: visibleMachinesLoading } = visibleMachineIndex;
  const visibleMachineIds = useMemo(() => Array.from(machines.keys()), [machines]);
  useLocalProjectRemovalResultNotifications(visibleMachineIds);
  const visibleLocalProjects = useVisibleLocalProjectsFromMachineIndex(visibleMachineIndex);
  const { projects: visibleLocalProjectMap, isLoading: visibleLocalProjectsLoading } =
    visibleLocalProjects;
  const { sessions: visibleActiveSessions, allActiveSessions: visibleAllActiveSessions } =
    useVisibleSessionMetas();
  useReportVisibleSessionsForEagerSync(
    'chat-landing',
    visibleActiveSessions,
    visibleAllActiveSessions
  );
  const { archivedSessions: visibleArchivedSessions } = useVisibleArchivedSessionMetas();
  /* Default cross-feature `visibleSessions` reference stays mapped to
     the *active* list — that's what every existing consumer (desktop
     sidebar, project pickers, analytics, etc.) wants. The mobile
     archive toggle picks the archived list explicitly when needed
     (see `mobileHomeChats` / `mobileProjectConversations`). */
  const visibleSessions = visibleActiveSessions;
  // Best-effort count of sessions this user has already created (active +
  // archived), used to derive `session_number`/`is_first_session_ever` for the
  // activation anchor (spec §3.1). Client-side CRDT visibility is not an
  // authoritative cross-client/CLI count — the server-side union anchor (§3.4)
  // remains the source of truth; this only lets the Web funnel define "first".
  const ownPriorSessionCount = useMemo(() => {
    if (!userId) return 0;
    let count = 0;
    for (const session of visibleActiveSessions) {
      if (session.userId === userId) count += 1;
    }
    for (const session of visibleArchivedSessions) {
      if (session.userId === userId) count += 1;
    }
    return count;
  }, [userId, visibleActiveSessions, visibleArchivedSessions]);
  const ownPriorSessionCountRef = useRef(ownPriorSessionCount);
  ownPriorSessionCountRef.current = ownPriorSessionCount;
  const docMetaCacheReady = useAtomValue(docMetaCacheReadyAtom);
  const localProbeResult = useAtomValue(localProbeResultAtom);
  const localProbeAttempted = useAtomValue(localProbeAttemptedAtom);
  const onlineMachineIds = useOnlineMachineIds();
  const onlineMachineIdsRef = useRef(onlineMachineIds);
  onlineMachineIdsRef.current = onlineMachineIds;
  const isPresenceMachineOnline = useCallback(
    (machineId: string) => onlineMachineIds.has(machineId as MachineId),
    [onlineMachineIds]
  );
  const freshRepositories = EMPTY_FRESH_REPOSITORIES;
  const workspaceReposWithStatus = EMPTY_WORKSPACE_REPOSITORIES;
  const repositories = EMPTY_REPOSITORIES;
  const isElectron = isElectronRenderer();
  const launchMode = useMemo(() => detectAppLaunchMode(isElectron), [isElectron]);
  const hasGitHubRepos = false;
  const { startSession, requestSessionDispatch } = useSessionActions();
  const isLeftSidebarHidden = useAtomValue(navigationSidebarHiddenAtom);
  const showNavigationSidebar = useSetAtom(showNavigationSidebarAtom);
  const visibleLocalMachineId = useMemo(() => {
    const machineId = localProbeResult?.machineId as MachineId | undefined;
    return machineId && machines.has(machineId) ? machineId : null;
  }, [localProbeResult?.machineId, machines]);

  const hasLocalProjects = visibleLocalProjectMap.size > 0;
  const localProjectCount = visibleLocalProjectMap.size;

  // ── Context type (Local Projects vs GitHub Worktrees) ──
  const [contextType, setContextType] = useState<SessionContextType>(
    () => preSelectedContext ?? readChatLandingDefaults(workspaceId)?.contextType ?? 'chat'
  );
  const analyticsProjectKind = contextType === 'chat' ? null : contextType;

  // ── Prompt state (shared across contexts) ──
  const chatLandingDraftKey = buildChatLandingDraftKey(userId ?? null, workspaceSlug);
  const [sessionState, setSessionState] = useAtom(
    chatLandingSessionStateAtomFamily(chatLandingDraftKey)
  );
  const [canvasDraft, setCanvasDraft] = useAtom(
    chatLandingCanvasDraftAtomFamily(chatLandingDraftKey)
  );
  usePendingDesignRecovery();
  const prompt = sessionState.prompt;
  const [draftActivityRevision, setDraftActivityRevision] = useState(0);
  const pastedTextDrafts = useMemo(
    () => sanitizePastedTextDrafts(sessionState.pastedTextDrafts),
    [sessionState.pastedTextDrafts]
  );
  /**
   * Committed mention ranges, kept for the before-send rewrite. `@path` and
   * `#123` survive into the sent text unchanged, so the range is the only
   * record that the region was ever a mention.
   *
   * The persisted copy is the only copy. It is narrower than the live range —
   * no `pasted_text`, no kindless range — and neither rewrite builder wants
   * either of those: pasted text is rebuilt from `pastedTextDrafts`, and a
   * range with no kind has nothing to dispatch on. Holding a second live list
   * beside it would be two states updated from one callback that must not
   * drift, which is the bug `session-chat-input-area.tsx` documents.
   */
  const persistedMentionRanges = sessionState.mentionRanges;
  const handleMentionRangesChange = useCallback(
    (ranges: MentionRange[]) => {
      // Stored with the prompt so a returning draft does not have to have its
      // mentions recognised again from the text — which only works once each
      // source has loaded, and not at all for one that never does.
      const persisted = toPersistedMentionRanges(ranges);
      setSessionState((prev) =>
        arePersistedMentionRangesEqual(prev.mentionRanges ?? [], persisted)
          ? prev
          : { ...prev, mentionRanges: persisted }
      );
    },
    [setSessionState]
  );
  const [composerStatus, setComposerStatus] = useState<{
    message: ReactNode;
    tone: 'error' | 'warning' | 'info';
  } | null>(null);
  const setPrompt = useCallback(
    (value: string) => {
      setSessionState((prev) => ({ ...prev, prompt: value }));
      setDraftActivityRevision((revision) => revision + 1);
      setComposerStatus(null);
    },
    [setSessionState]
  );
  const setComposerError = useCallback((message: string) => {
    setComposerStatus({ message, tone: 'error' });
  }, []);
  const setPastedTextDrafts = useCallback(
    (drafts: PastedTextDraft[]) => {
      setSessionState((prev) => {
        const sanitizedDrafts = sanitizePastedTextDrafts(drafts);
        if (
          arePastedTextDraftsEqual(sanitizePastedTextDrafts(prev.pastedTextDrafts), sanitizedDrafts)
        ) {
          return prev;
        }
        return { ...prev, pastedTextDrafts: sanitizedDrafts };
      });
      setComposerStatus(null);
    },
    [setSessionState]
  );
  const clearPastedTextDrafts = useCallback(() => {
    setSessionState((prev) => {
      if (sanitizePastedTextDrafts(prev.pastedTextDrafts).length === 0) {
        return prev;
      }
      return { ...prev, pastedTextDrafts: [] };
    });
  }, [setSessionState]);

  // ── Machine & Agent selection ──
  const [selectedMachineId, setSelectedMachineId] = useState<MachineId | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentSelection | null>(null);
  const [submitting, setSubmitting] = useAtom(chatLandingSubmittingAtomFamily(chatLandingDraftKey));
  const mcpSelection = useSessionMcpSelection(undefined, { disabled: submitting });
  // The project selector always uses the machine-aware picker so multi-machine
  // workspaces can choose the target explicitly. Standalone Electron entry
  // points such as the sidebar and onboarding may still use the native dialog.
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [addProjectInitialMachineId, setAddProjectInitialMachineId] = useState<MachineId | null>(
    null
  );
  const openAddProjectDialog = useCallback((initialMachineId?: MachineId | null) => {
    setAddProjectInitialMachineId(initialMachineId ?? null);
    setAddProjectOpen(true);
  }, []);
  const handleAddProjectOpenChange = useCallback((open: boolean) => {
    setAddProjectOpen(open);
    if (!open) {
      setAddProjectInitialMachineId(null);
    }
  }, []);
  /* Mobile-only: controls the bottom-sheet composer launched from the
     home screen's new-chat chip. The sheet hosts the same composer +
     selectors as the desktop landing — opening it doesn't navigate,
     so the home tab list stays visible underneath. */
  // ── GitHub context state ──
  const [selectedRepo, setSelectedRepo] = useState<string | undefined>(undefined);
  const selectedRepoWorktreeSetup = useMemo(() => {
    if (!selectedRepo) return undefined;
    return workspaceReposWithStatus?.find((repo) => repo.repoFullName === selectedRepo)
      ?.worktreeSetup;
  }, [selectedRepo, workspaceReposWithStatus]);
  const selectedRepoWorktreeCleanup = useMemo(() => {
    if (!selectedRepo) return undefined;
    return workspaceReposWithStatus?.find((repo) => repo.repoFullName === selectedRepo)
      ?.worktreeCleanup;
  }, [selectedRepo, workspaceReposWithStatus]);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [repoBranches, setRepoBranches] = useState<string[]>([]);
  const applyGitHubBranchSnapshot = useCallback((snapshot: ChatLandingBranchSnapshot) => {
    setRepoBranches((prev) =>
      areChatLandingBranchListsEqual(prev, snapshot.branches) ? prev : snapshot.branches
    );
    setSelectedBranch((prev) => {
      const next = resolveChatLandingBranchSelection(snapshot, prev);
      return next === prev ? prev : next;
    });
  }, []);

  // ── Local project context state ──
  const [selectedLocalProject, setSelectedLocalProject] = useState<LocalProjectSelection | null>(
    null
  );
  // ── Common refs ──
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Scope root for the keyboard-nav controller (arrow roving over the desktop landing's
  // config + composer column). Mobile/touch keeps native focus behavior.
  const keyboardNavRef = useRef<HTMLDivElement>(null);
  const keyboardNavEnabled = true;
  useChatLandingKeyboardNav(keyboardNavRef, {
    enabled: keyboardNavEnabled,
  });

  // Focus the new-chat composer with ⌘L on the landing. Shares the `session.focusInput`
  // command id (and binding) with the in-session composer; the two surfaces don't both
  // "win" the shortcut — on desktop only one mounts at a time, and on mobile the registry
  // stack lets the most-recently-mounted (the open session) take the binding.
  useCommand({
    id: 'session.focusInput',
    title: t('commands.session.focusInput', 'Focus Current Input'),
    category: 'Editor',
    keybindings: getCommandKeybindings('session.focusInput'),
    when: () => Boolean(promptTextareaRef.current),
    run: () => {
      const el = promptTextareaRef.current;
      if (!el) return;
      // Where keyboard nav is on, ⌘L is a toggle: focus the composer, or — when it's
      // already focused — leave its focus mode and hand control to the option ring (Esc
      // does the same from the keyboard-nav controller).
      if (keyboardNavEnabled && document.activeElement === el) {
        focusFirstChatLandingOption(keyboardNavRef.current, el);
        return;
      }
      el.focus();
    },
  });
  const landingLoadStartMsRef = useRef(getPerformanceNowMs());
  const fireLandingViewedOnce = useFireOncePerKey();
  const fireProjectSourceReadyOnce = useFireOncePerKey();
  const previousContextTypeRef = useRef(contextType);
  const fireProjectSelectedOnChange = useFireOnKeyChange();
  const fireAgentConfigOnChange = useFireOnKeyChange();
  const preSelectionAppliedRef = useRef<string | null>(null);
  // False while a just-applied URL intent has not rendered yet; the selection
  // mirror must not compare against that pre-application state.
  const selectionSyncArmedRef = useRef(false);
  const selectedLocalProjectRef = useRef<LocalProjectSelection | null>(null);
  selectedLocalProjectRef.current = selectedLocalProject;
  const selectedLocalProjectMachineId = selectedLocalProject?.machineId ?? null;
  const activeLocalProjectId = selectedLocalProject?.localProjectId ?? null;
  useEffect(() => {
    setComposerStatus(null);
  }, [
    activeLocalProjectId,
    contextType,
    selectedAgent?.agentId,
    selectedBranch,
    selectedMachineId,
    selectedRepo,
  ]);
  const handleSelectedLocalProjectChange = useCallback(
    (nextProject: LocalProjectSelection | null) => {
      selectedLocalProjectRef.current = nextProject;
      setSelectedLocalProject(nextProject);
      if (nextProject) {
        setSelectedMachineId((current) =>
          current === nextProject.machineId ? current : nextProject.machineId
        );
      }
    },
    []
  );
  const getFirstVisibleLocalProjectForMachine = useCallback(
    (machineId: MachineId): LocalProjectSelection | null => {
      for (const entry of visibleLocalProjectMap.values()) {
        if (entry.machineId === machineId) {
          return {
            machineId,
            localProjectId: entry.project.id,
          };
        }
      }
      return null;
    },
    [visibleLocalProjectMap]
  );
  const shouldRestoreContextType =
    !preSelectedContext && !preSelectedMachine && !preSelectedProject && !preSelectedRepo;
  const {
    sessionId: draftSessionId,
    ensureSessionId: ensureDraftSessionId,
    resetSessionId: resetDraftSessionId,
  } = useChatLandingDraftSession(chatLandingDraftKey);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const {
    imageItems,
    hasBlockingImages,
    hasUploadedImages,
    canAddMoreImages,
    addFiles,
    handlePromptPaste: handleImagePromptPaste,
    handleRemoveImage,
    handleRetryImage,
    clearPendingImages,
    buildInputBlocks,
  } = useChatLandingImageDraft({
    draftKey: chatLandingDraftKey,
    workspaceId: (workspaceId as WorkspaceId | null) ?? null,
    machineId: selectedMachineId,
    isMobile: false,
    projectKind: contextType === 'chat' ? null : contextType,
    sessionId: draftSessionId,
    ensureSessionId: ensureDraftSessionId,
  });
  const {
    fileItems,
    hasBlockingFiles,
    hasUploadedFiles,
    canAddMoreFiles,
    addFiles: addFileAttachments,
    handleRemoveFile,
    handleRetryFile,
    clearPendingFiles,
    buildFileInputBlocks,
  } = useChatLandingFileDraft({
    draftKey: chatLandingDraftKey,
    workspaceId: (workspaceId as WorkspaceId | null) ?? null,
    machineId: selectedMachineId,
    sessionId: draftSessionId,
    ensureSessionId: ensureDraftSessionId,
  });
  const insertLargePastedTextAtSelection = useCallback(
    (text: string) => {
      const normalizedText = normalizePastedTextDraft(text).trim();
      if (!normalizedText) {
        return false;
      }

      const currentValue = promptTextareaRef.current?.value ?? prompt;
      const selectionStart = promptTextareaRef.current?.selectionStart ?? null;
      const selectionEnd = promptTextareaRef.current?.selectionEnd ?? null;
      const result = insertPastedTextDraft({
        currentValue,
        pastedText: normalizedText,
        displayText: wrapPastedTextChipLabel(
          t('composer.pastedTextInlineLabel', '[Pasted {{charCount}} chars]', {
            charCount: numberFormatter.format(getPastedTextCharacterCount(normalizedText)),
          })
        ),
        selectionStart,
        selectionEnd,
      });

      if (!result) {
        return false;
      }

      const editEnd = Math.max(
        result.draft.start,
        Math.min(selectionEnd ?? result.draft.start, currentValue.length)
      );

      setSessionState((prev) => ({
        ...prev,
        prompt: result.nextValue,
        pastedTextDrafts: getPastedTextDraftsAfterInsertion({
          drafts: prev.pastedTextDrafts ?? [],
          draft: result.draft,
          editStart: result.draft.start,
          editEnd,
        }),
      }));
      setComposerStatus(null);

      requestAnimationFrame(() => {
        promptTextareaRef.current?.focus();
        promptTextareaRef.current?.setSelectionRange(result.draft.end, result.draft.end);
      });

      return true;
    },
    [numberFormatter, prompt, setSessionState, t]
  );

  // Auto-focus textarea on mount (desktop only)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      promptTextareaRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // ── Apply pre-selection from search params ──
  const preSelectionKey = buildChatLandingPreSelectionKey({
    context: preSelectedContext,
    machine: preSelectedMachine,
    project: preSelectedProject,
    repo: preSelectedRepo,
  });
  useEffect(() => {
    if (preSelectionAppliedRef.current === preSelectionKey) return;
    preSelectionAppliedRef.current = preSelectionKey;
    // The applied selection reaches state next render; disarm the mirror so it
    // cannot race this intent with the still-stale selection (see the mirror
    // effect below, which must run after this one).
    selectionSyncArmedRef.current = false;

    if (preSelectedContext === 'chat') {
      setContextType('chat');
    } else if (preSelectedContext === 'local' && preSelectedMachine && preSelectedProject) {
      setContextType('local');
      const currentProject = selectedLocalProjectRef.current;
      if (
        currentProject?.machineId !== preSelectedMachine ||
        currentProject?.localProjectId !== preSelectedProject
      ) {
        handleSelectedLocalProjectChange({
          machineId: preSelectedMachine as MachineId,
          localProjectId: preSelectedProject as LocalProjectId,
        });
      }
    } else if (preSelectedRepo) {
      setContextType('github');
      setSelectedRepo(preSelectedRepo);
    }
  }, [
    preSelectionKey,
    preSelectedContext,
    preSelectedMachine,
    preSelectedProject,
    preSelectedRepo,
    handleSelectedLocalProjectChange,
  ]);

  // ── Mirror the effective selection back into the URL ──
  // The composer owns the selection once pre-selection is applied. When the
  // URL names a selection, it must keep telling the truth: steering or
  // clearing the composer would otherwise leave a stale project in the URL,
  // and re-activating that project's sidebar row would be an identical-URL
  // no-op. A plain /chat URL names nothing and stays plain, so restored
  // defaults and auto-selection never rewrite the home landing's address.
  const selectionSearch = useMemo(
    () =>
      getChatLandingSelectionSearch({
        contextType,
        machineId: selectedLocalProject?.machineId ?? null,
        localProjectId: selectedLocalProject?.localProjectId ?? null,
        repoFullName: selectedRepo ?? null,
      }),
    [contextType, selectedLocalProject, selectedRepo]
  );
  const urlNamesSelection =
    preSelectedContext !== undefined ||
    preSelectedMachine !== undefined ||
    preSelectedProject !== undefined ||
    preSelectedRepo !== undefined;
  useEffect(() => {
    if (!onSelectionUrlSync) return;
    const selectionKey = buildChatLandingPreSelectionKey({
      context: selectionSearch.context,
      machine: selectionSearch.machine,
      project: selectionSearch.project,
      repo: selectionSearch.repo,
    });
    const decision = getChatLandingSelectionSyncDecision({
      urlNamesSelection,
      intentApplied: preSelectionAppliedRef.current === preSelectionKey,
      armed: selectionSyncArmedRef.current,
      urlKey: preSelectionKey,
      selectionKey,
    });
    if (decision === 'arm') {
      selectionSyncArmedRef.current = true;
      return;
    }
    if (decision !== 'sync') return;
    // The URL will soon name this state-originated selection; stamp it as
    // already applied so the pre-selection effect does not re-apply it.
    preSelectionAppliedRef.current = selectionKey;
    onSelectionUrlSync(selectionSearch);
  }, [onSelectionUrlSync, urlNamesSelection, preSelectionKey, selectionSearch]);

  // A saved local-project selection may refer to a removed project or an old host.
  useEffect(() => {
    if (contextType !== 'local' || !selectedLocalProject) return;
    if (
      !localProbeAttempted ||
      visibleMachinesLoading ||
      visibleLocalProjectsLoading ||
      !docMetaCacheReady
    )
      return;
    const projectKey = getLocalProjectVisibilityKey(
      selectedLocalProject.machineId,
      selectedLocalProject.localProjectId
    );
    if (
      selectedLocalProject.machineId === visibleLocalMachineId &&
      visibleLocalProjectMap.has(projectKey)
    )
      return;
    toast.error(t('sidebar.localProjects.forbidden', 'Local project is not available'));
    handleSelectedLocalProjectChange(null);
    setContextType(hasGitHubRepos ? 'github' : 'chat');
  }, [
    contextType,
    docMetaCacheReady,
    selectedLocalProject,
    localProbeAttempted,
    visibleMachinesLoading,
    visibleLocalProjectsLoading,
    visibleLocalMachineId,
    visibleLocalProjectMap,
    hasGitHubRepos,
    t,
    handleSelectedLocalProjectChange,
  ]);

  // ── Auto-switch to available tab if current is disabled ──
  useEffect(() => {
    if (repositories === undefined) return; // Wait for repos to load
    if (machines.size === 0) return; // Wait for machine data to load
    // `hasLocalProjects` derives from `useVisibleLocalProjects`; switching
    // before its query resolves would kick teammates whose only local access
    // is through shared projects.
    if (visibleLocalProjectsLoading) return;
    // Don't auto-switch away from a URL-pre-selected context
    if (preSelectedContext === 'local' && contextType === 'local') return;
    if (contextType === 'local' && !hasLocalProjects) {
      setContextType(hasGitHubRepos ? 'github' : 'chat');
    } else if (contextType === 'github' && !hasGitHubRepos) {
      setContextType(hasLocalProjects ? 'local' : 'chat');
    }
  }, [
    contextType,
    hasLocalProjects,
    hasGitHubRepos,
    repositories,
    machines.size,
    preSelectedContext,
    visibleLocalProjectsLoading,
  ]);

  // ── Agent/Mode/Model config ──
  const selectorTagClassName = getSelectorTagClassName(tone);

  const selectedConfig = useMemo<AgentConfigMeta | undefined>(
    () =>
      selectedAgent ? executorConfigs.find((cfg) => cfg.id === selectedAgent.agentId) : undefined,
    [executorConfigs, selectedAgent]
  );
  const selectedMachine = useMemo(
    () => (selectedAgent ? machines.get(selectedAgent.machineId) : undefined),
    [machines, selectedAgent]
  );
  /* ── Agent Role selection ──
     A Role is one packaged run configuration, so picking one flows through the
     SAME preference channel as this agent's remembered defaults rather than a
     second apply path: the derivation seeds mode/model/options from the Role,
     and an option the agent no longer supports falls back to the agent's own
     value there — visibly — instead of being forced in.

     `token` makes re-picking the same Role after hand-editing a knob a new
     preference, and the preference deliberately OUTLIVES `activeAgentRole`
     below: clearing it on a hand edit would re-seed the very value the user
     just changed. */
  const { roles: workspaceAgentRoles, synced: agentRolesSynced } = useWorkspaceAgentRoles();
  /* Whether the stored Role has been resolved yet. Until it has, the composer
     has no opinion to persist — see `selectedAgentRoleId` on the defaults hook. */
  const [agentRoleRestored, setAgentRoleRestored] = useState(false);
  /* The Role editor is a Dialog, so it is hosted OUT here rather than inside the
     run-config dropdown: a Dialog rendered in menu content unmounts with the
     menu the moment it opens. */
  const [agentRoleEditor, setAgentRoleEditor] = useState<AgentRoleEditorState | null>(null);
  const { resolve: resolveAgentRoleAvailability } = useAgentRoleAvailability(workspaceAgentRoles);
  useEffect(() => {
    setAgentRoleRestored(false);
  }, [workspaceId]);
  const agentRolePreferenceTokenRef = useRef(0);
  /* The preference NAMES a Role; it does not hold a copy of one. Editing a Role
     bumps its `revision`, which rides in `preferenceRevision` below, so the
     composer re-seeds from what the Role says NOW — a captured copy would keep
     running the old values under the edited Role's name. A deleted Role simply
     stops resolving. */
  const [agentRolePreference, setAgentRolePreference] = useState<{
    roleId: AgentRoleId;
    token: number;
  } | null>(null);
  /* A Role binds `machineId + agentConfigId` exactly, so its preference applies
     only while the composer is on that agent. Derived rather than cleared: a
     Role never re-points at whichever agent happens to be selected. */
  const activeAgentRolePreference = useMemo(() => {
    if (!agentRolePreference || !selectedAgent) return null;
    const role = workspaceAgentRoles.find((entry) => entry.id === agentRolePreference.roleId);
    if (!role) return null;
    const bound =
      role.agentConfigId === selectedAgent.agentId && role.machineId === selectedAgent.machineId;
    return bound ? { role, token: agentRolePreference.token } : null;
  }, [agentRolePreference, selectedAgent, workspaceAgentRoles]);
  const selectedAgentDefaults = useMemo(() => {
    const roleRunConfig = activeAgentRolePreference?.role.runConfig;
    if (roleRunConfig) {
      return {
        modeId: roleRunConfig.modeId ?? null,
        modelId: roleRunConfig.modelId ?? null,
        configOptionValues: roleRunConfig.configOptionValues,
      };
    }
    return selectedAgent ? (agentDefaultsCache.get(selectedAgent.agentId) ?? {}) : {};
  }, [activeAgentRolePreference, selectedAgent]);
  /* No effects: user edits are the only stored selection state; the effective
     values derive per render. Candidates feed the capability lookup so the
     catalog can depend on the selection without feeding back into it. */
  const {
    selection: sessionConfigSelection,
    candidates: sessionConfigCandidates,
    appliedTargetKey: appliedSessionConfigTargetKey,
    selectMode: setSelectedModeId,
    selectModel: setSelectedModelName,
    selectConfigOption: handleConfigOptionChange,
  } = useAcpSessionConfigSelectionState({
    targetKey: selectedAgent ? `${selectedAgent.machineId}:${selectedAgent.agentId}` : null,
    preferenceRevision: activeAgentRolePreference
      ? `role:${activeAgentRolePreference.role.id}:${activeAgentRolePreference.role.revision}:${activeAgentRolePreference.token}`
      : (selectedAgent?.agentId ?? 'none'),
    preferences: selectedAgentDefaults,
  });
  const selectorOptions = useAcpSelectorOptions({
    configId: selectedConfig?.id,
    cliType: selectedConfig?.cliType,
    agentType: selectedConfig?.agentType,
    selectedModeId: sessionConfigCandidates.modeId,
    selectedModelId: sessionConfigCandidates.modelId,
    configOptionValues: sessionConfigCandidates.configOptionValues,
    runtimeOverrides: selectedConfig?.runtimeOverrides,
    machine: selectedMachine,
  });
  const { modeOptions, modelOptions, configOptionSelectors } = selectorOptions;
  const {
    selectedModeId,
    selectedModelId,
    configOptionValues,
    configOptionSelectors: resolvedConfigOptionSelectors,
  } = useResolvedAcpSessionConfigSelection(sessionConfigSelection, selectorOptions, {
    cliType: selectedConfig?.cliType,
    agentType: selectedConfig?.agentType,
  });
  const dispatchConfigOptionValues = useMemo(
    () => filterAcpSessionConfigOptionValues(configOptionValues, resolvedConfigOptionSelectors),
    [configOptionValues, resolvedConfigOptionSelectors]
  );
  const selectedRateLimits =
    selectedConfig &&
    canShowSubscriptionRateLimits({
      cliType: selectedConfig.cliType,
      agentType: selectedConfig.agentType,
      config: selectedConfig,
    })
      ? selectedMachine?.raceLimits
      : undefined;
  // The landing knows the picked provider's full config, so eligibility is
  // decided here rather than from `cliType`/`agentType` further down.
  const showCodexResetForecast =
    !!selectedConfig &&
    canShowCodexResetForecast({
      cliType: selectedConfig.cliType,
      agentType: selectedConfig.agentType,
      config: selectedConfig,
    });
  const selectedModelLabel = modelOptions.find((option) => option.value === selectedModelId)?.label;
  /* The Role the composer IS, not the one last clicked. The footer names a Role
     only while every value that Role pins is still what will run, so moving a
     knob — or an unsupported pin falling back — takes the name away instead of
     leaving it claiming a configuration that is no longer the Role's. */
  const activeAgentRole = useMemo(() => {
    const role = activeAgentRolePreference?.role;
    if (!role) return null;
    return isComposerAgentRoleApplied(role, {
      agentSelection: selectedAgent,
      modeId: selectedModeId,
      modelId: selectedModelId,
      configOptionValues,
    })
      ? role
      : null;
  }, [
    activeAgentRolePreference,
    configOptionValues,
    selectedAgent,
    selectedModeId,
    selectedModelId,
  ]);

  /* ── Recently used run configurations ──
     Device-local history of whole combinations (agent + model + every config
     option) the user has actually started a chat with, surfaced at the top of
     the desktop run-config menu. */
  const [recentRunConfigRecords, setRecentRunConfigRecords] = useState<RecentRunConfigRecord[]>([]);
  useEffect(() => {
    setRecentRunConfigRecords(readRecentRunConfigs(workspaceId));
  }, [workspaceId]);
  const currentRunConfigFace = useMemo(
    () =>
      describeRunConfigSelection({
        modelOptions,
        selectedModelId,
        configOptionSelectors,
        configOptionValues,
      }),
    [configOptionSelectors, configOptionValues, modelOptions, selectedModelId]
  );
  const currentRunConfigKey = useMemo(
    () =>
      selectedAgent
        ? getRecentRunConfigKey({
            agentId: selectedAgent.agentId,
            machineId: selectedAgent.machineId,
            modelId: currentRunConfigFace.modelId,
            configOptionValues: sanitizeConfigOptionValues(dispatchConfigOptionValues),
            agentRoleId: activeAgentRole?.id ?? null,
          })
        : null,
    [activeAgentRole, currentRunConfigFace.modelId, dispatchConfigOptionValues, selectedAgent]
  );
  /* Picking an entry switches the agent first; its model and options can only
     be applied after that agent's own reconcile pass has seeded the selection
     state, or the seeded defaults would overwrite them. */
  const [pendingRecentRunConfig, setPendingRecentRunConfig] =
    useState<RecentRunConfigRecord | null>(null);
  useEffect(() => {
    if (!pendingRecentRunConfig || !selectedAgent) return;
    if (
      selectedAgent.agentId !== pendingRecentRunConfig.agentId ||
      selectedAgent.machineId !== pendingRecentRunConfig.machineId
    ) {
      setPendingRecentRunConfig(null);
      return;
    }
    if (appliedSessionConfigTargetKey !== `${selectedAgent.machineId}:${selectedAgent.agentId}`) {
      return;
    }
    // A cold agent reports no models until its capabilities resolve; applying
    // then would silently drop the recorded model. Wait — unless the user has
    // meanwhile picked a model themselves, which outranks the entry.
    if (pendingRecentRunConfig.modelId && modelOptions.length === 0) {
      if (sessionConfigSelection.edits.model !== undefined) {
        setPendingRecentRunConfig(null);
      }
      return;
    }
    setPendingRecentRunConfig(null);
    const appliedModelId =
      pendingRecentRunConfig.modelId &&
      modelOptions.some((option) => option.value === pendingRecentRunConfig.modelId)
        ? pendingRecentRunConfig.modelId
        : undefined;
    if (appliedModelId) {
      setSelectedModelName(appliedModelId);
    }
    for (const { configId, value } of resolveApplicableConfigOptionValues(
      pendingRecentRunConfig,
      configOptionSelectors,
      // The selectors still describe the model this entry replaces, so its
      // effort must not be validated against the outgoing model's ladder.
      { switchesModel: appliedModelId !== undefined && appliedModelId !== selectedModelId }
    )) {
      handleConfigOptionChange(configId, value);
    }
  }, [
    appliedSessionConfigTargetKey,
    configOptionSelectors,
    handleConfigOptionChange,
    modelOptions,
    pendingRecentRunConfig,
    selectedAgent,
    selectedModelId,
    sessionConfigSelection.edits.model,
    setSelectedModelName,
  ]);
  const availableCommands = useAvailableCommands({
    configId: selectedConfig?.id,
    cliType: selectedConfig?.cliType,
    agentType: selectedConfig?.agentType,
    runtimeOverrides: selectedConfig?.runtimeOverrides,
    machine: selectedMachine,
  });
  // Filters the `$` skill mention to the selected provider's skill directories.
  const skillAgent = useMemo(
    () =>
      selectedConfig?.cliType && selectedConfig.agentType
        ? {
            cliType: selectedConfig.cliType,
            agentType: selectedConfig.agentType,
            // The selected agent's machine — lets the `$` menu surface that
            // machine's global skills even for GitHub / plain (chat) contexts.
            ...(selectedAgent?.machineId ? { machineId: selectedAgent.machineId } : {}),
          }
        : undefined,
    [selectedConfig?.cliType, selectedConfig?.agentType, selectedAgent?.machineId]
  );

  // Keyboard cyclers shared with the in-session composer. The chat landing is also where
  // the agent provider can be cycled (it's fixed once a session exists).
  const cycleThinkEffortSelector = useMemo(
    () =>
      configOptionSelectors.find(
        (selector): selector is AcpSelectConfigOptionSelector =>
          selector.type === 'select' && isThoughtLevelSelector(selector)
      ),
    [configOptionSelectors]
  );
  const cycleThinkEffortCurrent = cycleThinkEffortSelector
    ? configOptionValues[cycleThinkEffortSelector.configId]
    : undefined;
  const cycleProviderSelections = useMemo(
    () =>
      getChatLandingAgentSelectionsForMachine(executorConfigs, selectedAgent?.machineId ?? null),
    [executorConfigs, selectedAgent?.machineId]
  );
  useComposerCycleCommands({
    mode: {
      values: modeOptions.map((option) => option.value),
      current: selectedModeId,
      onSelect: (value) => setSelectedModeId(value),
    },
    model: {
      values: modelOptions.map((option) => option.value),
      current: selectedModelId,
      onSelect: (value) => setSelectedModelName(value),
    },
    thinkEffort: cycleThinkEffortSelector
      ? {
          values: cycleThinkEffortSelector.options.map((option) => option.value),
          current:
            typeof cycleThinkEffortCurrent === 'string'
              ? cycleThinkEffortCurrent
              : cycleThinkEffortSelector.currentValue,
          onSelect: (value) => handleConfigOptionChange(cycleThinkEffortSelector.configId, value),
        }
      : null,
    provider: selectedAgent
      ? {
          values: cycleProviderSelections.map((selection) => selection.agentId),
          current: selectedAgent.agentId,
          onSelect: (agentId) => {
            const nextSelection = cycleProviderSelections.find(
              (selection) => selection.agentId === agentId
            );
            if (nextSelection) setSelectedAgent(nextSelection);
          },
        }
      : null,
  });

  // ── Machine online check (context-dependent) ──
  const hasAnyOnlineMachine = useMemo(() => {
    return getChatLandingHasAnyOnlineMachine({
      localMachineId: visibleLocalMachineId,
      machines,
      isMachineOnline: isPresenceMachineOnline,
    });
  }, [visibleLocalMachineId, machines, isPresenceMachineOnline]);
  const onlineMachineCount = useMemo(() => {
    let count = 0;
    for (const machineId of machines.keys()) {
      if (onlineMachineIds.has(machineId)) {
        count += 1;
      }
    }
    return count;
  }, [machines, onlineMachineIds]);
  const hasNoMachine = !hasAnyOnlineMachine;

  // ── Sync selectedMachineId from selectedAgent (e.g. when restored from defaults) ──
  // Skip sync when the machine was explicitly changed by the user via handleMachineChange.
  const machineChangedByUserRef = useRef(false);
  useEffect(() => {
    if (machineChangedByUserRef.current) {
      machineChangedByUserRef.current = false;
      return;
    }
    if (contextType === 'local' && selectedLocalProjectMachineId) {
      if (selectedLocalProjectMachineId !== selectedMachineId) {
        setSelectedMachineId(selectedLocalProjectMachineId);
      }
      return;
    }
    if (selectedAgent?.machineId && selectedAgent.machineId !== selectedMachineId) {
      setSelectedMachineId(selectedAgent.machineId);
    }
  }, [contextType, selectedAgent?.machineId, selectedLocalProjectMachineId, selectedMachineId]);

  // ── Handle explicit machine change: auto-select an agent owned by the new machine ──
  const handleMachineChange = useCallback(
    (machineId: MachineId) => {
      machineChangedByUserRef.current = true;
      setSelectedMachineId(machineId);
      if (contextType === 'local') {
        const currentProject = selectedLocalProjectRef.current;
        if (currentProject?.machineId !== machineId) {
          handleSelectedLocalProjectChange(null);
          setContextType('chat');
        }
      }
      if (selectedAgent?.machineId === machineId) return;

      // Agent configs are per-machine: only configs owned by the new machine
      // are valid choices here.
      const configsOnMachine = executorConfigs.filter((cfg) => cfg.machineId === machineId);

      // Prefer a config with the same agentType as the previously selected one.
      const previousConfig = selectedAgent
        ? executorConfigs.find((cfg) => cfg.id === selectedAgent.agentId)
        : undefined;
      const matchByType = previousConfig
        ? configsOnMachine.find((cfg) => cfg.agentType === previousConfig.agentType)
        : undefined;

      const nextConfig = matchByType ?? configsOnMachine[0];
      if (nextConfig) {
        setSelectedAgent({ agentId: nextConfig.id, machineId });
      } else {
        setSelectedAgent(null);
      }
    },
    [contextType, executorConfigs, handleSelectedLocalProjectChange, selectedAgent]
  );

  // ── Selectable machines: reachable AND own at least one configured agent. ──
  // The hook uses this to ensure the current selection still resolves; falling
  // back to a valid default when machines stream in late (e.g. relogin) or go
  // offline.
  const selectableMachines = useMemo(() => {
    const machineIdsWithConfigs = new Set<MachineId>();
    for (const config of executorConfigs) {
      machineIdsWithConfigs.add(config.machineId);
    }
    const next = new Map<MachineId, MachineViewMeta>();
    for (const [machineId, machine] of machines) {
      if (!machineIdsWithConfigs.has(machineId)) continue;
      if (
        !isChatLandingMachineReachable({
          machineId,
          localMachineId: visibleLocalMachineId,
          machines,
          isMachineOnline: isPresenceMachineOnline,
        })
      ) {
        continue;
      }
      next.set(machineId, machine);
    }
    return next;
  }, [executorConfigs, isPresenceMachineOnline, machines, visibleLocalMachineId]);

  // Suppress empty-state flashes during cold start, but do not let a stalled
  // Convex visibility query mask machine/agent data already available from the
  // local CRDT cache. This is the idle-resume path: local repo is usable while
  // remote visibility/auth may still be reconnecting.
  const isInitialDataLoading = getChatLandingInitialDataLoading({
    isRuntimeInitializing: runtimeInitializing,
    isVisibleMachinesLoading: visibleMachinesLoading,
    isDocMetaCacheReady: docMetaCacheReady,
    localMachineStateAttempted: localProbeAttempted,
    hasSelectableMachine: selectableMachines.size > 0,
  });

  // ── Defaults loading (all contexts) ──
  const { defaultsReady, repoDefaultsReady } = useChatLandingDefaults({
    workspaceId,
    shouldRestoreContextType,
    contextType,
    setContextType,
    executorConfigs,
    machines,
    selectableMachines,
    visibleMachinesLoading,
    docMetaCacheReady,
    repositories,
    selectedAgent,
    setSelectedAgent,
    selectedMachineId,
    selectedRepo,
    setSelectedRepo,
    selectedBranch,
    setSelectedBranch,
    selectedLocalProject,
    setSelectedLocalProject: handleSelectedLocalProjectChange,
    selectedAgentRoleId: agentRoleRestored ? (activeAgentRole?.id ?? null) : undefined,
  });

  // ── Auto-select first repo when none selected ──
  useEffect(() => {
    if (!repoDefaultsReady) return;
    if (contextType !== 'github' || selectedRepo) return;
    const firstRepo = repositories?.[0];
    if (firstRepo) setSelectedRepo(firstRepo.fullName);
  }, [contextType, repoDefaultsReady, repositories, selectedRepo]);

  // ── Auto-select first local project when none selected ──
  useEffect(() => {
    if (!defaultsReady) return;
    if (contextType !== 'local' || selectedLocalProject) return;
    if (selectedMachineId) {
      const machineProject = getFirstVisibleLocalProjectForMachine(selectedMachineId);
      if (machineProject) {
        handleSelectedLocalProjectChange(machineProject);
      }
      return;
    }
    const firstLocalProject = Array.from(visibleLocalProjectMap.values()).find(
      (entry) => entry.machineId === visibleLocalMachineId
    );
    if (firstLocalProject) {
      handleSelectedLocalProjectChange({
        machineId: firstLocalProject.machineId,
        localProjectId: firstLocalProject.project.id,
      });
    }
  }, [
    contextType,
    defaultsReady,
    getFirstVisibleLocalProjectForMachine,
    visibleLocalMachineId,
    selectedMachineId,
    visibleLocalProjectMap,
    selectedLocalProject,
    handleSelectedLocalProjectChange,
  ]);

  // Keep local project selection as the source of truth for its machine.
  // Explicit machine changes update/clear the project in `handleMachineChange`;
  // async agent/default fallback must not clear an offline project's selection.
  useEffect(() => {
    if (!defaultsReady || visibleLocalProjectsLoading) return;
    if (contextType !== 'local' || !selectedMachineId || !selectedLocalProject) return;
    if (selectedLocalProject.machineId === selectedMachineId) return;
    setSelectedMachineId(selectedLocalProject.machineId);
  }, [
    contextType,
    defaultsReady,
    selectedLocalProject,
    selectedMachineId,
    visibleLocalProjectsLoading,
  ]);

  // ── Local project: auto-select agent when machine changes ──
  useEffect(() => {
    if (contextType !== 'local' || !selectedLocalProject) return;

    const currentConfig = selectedAgent
      ? executorConfigs.find((cfg) => cfg.id === selectedAgent.agentId)
      : undefined;
    if (selectedAgent?.machineId === selectedLocalProject.machineId && currentConfig) {
      return;
    }

    const storedDefaults = readChatLandingDefaults(workspaceId);
    const nextSelection = resolvePreferredChatLandingAgentSelection({
      preferredAgentId: selectedAgent?.agentId ?? storedDefaults?.agentId ?? null,
      preferredMachineId: selectedAgent?.machineId ?? storedDefaults?.machineId ?? null,
      requiredMachineId: selectedLocalProject.machineId,
      executorConfigs,
      machines,
    });
    if (
      nextSelection &&
      (nextSelection.agentId !== selectedAgent?.agentId ||
        nextSelection.machineId !== selectedAgent?.machineId)
    ) {
      setSelectedAgent(nextSelection);
    }
  }, [contextType, executorConfigs, machines, selectedAgent, selectedLocalProject, workspaceId]);

  // ── PostHog tracking ──
  useEffect(() => {
    if (!postHog || !userId || !workspaceId) return;
    if (!fireLandingViewedOnce(`${userId}:${workspaceId}`)) return;
    capturePostHogEvent(postHog, 'chat_landing/viewed', {
      user_id: userId,
      workspace_id: workspaceId,
      context_type: contextType,
      launch_mode: launchMode,
      has_preselected_context: Boolean(preSelectedContext),
      has_preselected_project: Boolean(preSelectedProject || preSelectedRepo),
      github_repo_count: repositories?.length ?? null,
      local_project_count: localProjectCount,
      online_machine_count: onlineMachineCount,
      ready_ms: getDurationSinceMs(landingLoadStartMsRef.current),
    });
  }, [
    contextType,
    fireLandingViewedOnce,
    launchMode,
    localProjectCount,
    onlineMachineCount,
    postHog,
    preSelectedContext,
    preSelectedProject,
    preSelectedRepo,
    repositories?.length,
    userId,
    workspaceId,
  ]);

  useEffect(() => {
    const previousContextType = previousContextTypeRef.current;
    if (previousContextType === contextType) return;
    previousContextTypeRef.current = contextType;
    capturePostHogEvent(postHog, 'chat_landing/context_changed', {
      user_id: userId ?? null,
      workspace_id: workspaceId ?? null,
      previous_context_type: previousContextType,
      context_type: contextType,
      github_repo_count: repositories?.length ?? null,
      local_project_count: localProjectCount,
      online_machine_count: onlineMachineCount,
    });
  }, [
    contextType,
    localProjectCount,
    onlineMachineCount,
    postHog,
    repositories?.length,
    userId,
    workspaceId,
  ]);

  useEffect(() => {
    if (!postHog || !userId || !workspaceId) return;
    // Wait until the GitHub repo query has settled (undefined = still loading)
    if (repositories === undefined) return;
    if (visibleLocalProjectsLoading) return;
    const githubRepoCount = repositories.length;
    if (githubRepoCount === 0 && localProjectCount === 0) return;
    if (!fireProjectSourceReadyOnce(`${userId}:${workspaceId}`)) return;
    const sourceKind =
      githubRepoCount > 0 && localProjectCount > 0
        ? 'mixed'
        : githubRepoCount > 0
          ? 'github'
          : 'local';
    capturePostHogEvent(postHog, 'onboarding/project_source_ready', {
      user_id: userId,
      workspace_id: workspaceId,
      source_kind: sourceKind,
      github_repo_count: githubRepoCount,
      local_project_count: localProjectCount,
    });
  }, [
    fireProjectSourceReadyOnce,
    localProjectCount,
    postHog,
    repositories,
    userId,
    visibleLocalProjectsLoading,
    workspaceId,
  ]);

  useEffect(() => {
    if (!postHog || !userId || !workspaceId) return;
    if (contextType === 'chat') return;
    if (contextType === 'github' && !selectedRepo) return;
    if (contextType === 'local' && !selectedLocalProject) return;
    const selectionKey =
      contextType === 'github'
        ? `github:${selectedRepo}`
        : `local:${selectedLocalProject?.machineId}:${selectedLocalProject?.localProjectId}`;
    const analyticsKey = `${userId}:${workspaceId}:${selectionKey}`;
    if (!fireProjectSelectedOnChange(analyticsKey)) return;
    capturePostHogEvent(postHog, 'onboarding/project_selected', {
      user_id: userId,
      workspace_id: workspaceId,
      project_kind: contextType,
      repo_id_hash: contextType === 'github' ? hashAnalyticsId(selectedRepo) : null,
      local_project_id:
        contextType === 'local' ? (selectedLocalProject?.localProjectId ?? null) : null,
      machine_id: contextType === 'local' ? (selectedLocalProject?.machineId ?? null) : null,
      has_git_branch: contextType === 'github' ? true : null,
    });
  }, [
    contextType,
    fireProjectSelectedOnChange,
    postHog,
    selectedLocalProject,
    selectedRepo,
    userId,
    workspaceId,
  ]);

  useEffect(() => {
    if (!postHog || !userId || !workspaceId || !selectedAgent || !selectedConfig) return;
    const analyticsKey = [
      userId,
      workspaceId,
      selectedAgent.machineId,
      selectedAgent.agentId,
      selectedConfig.cliType,
      selectedConfig.agentType,
    ].join(':');
    if (!fireAgentConfigOnChange(analyticsKey)) return;
    capturePostHogEvent(postHog, 'onboarding/agent_config_selected', {
      user_id: userId,
      workspace_id: workspaceId,
      machine_id: selectedAgent.machineId,
      agent_config_id: selectedAgent.agentId,
      cli_type: selectedConfig.cliType,
      agent_type: selectedConfig.agentType,
    });
  }, [fireAgentConfigOnChange, postHog, selectedAgent, selectedConfig, userId, workspaceId]);

  // ── GitHub branch loading ──
  useLayoutEffect(() => {
    if (contextType !== 'github') return undefined;
    if (!workspaceId || !selectedRepo) {
      setRepoBranches([]);
      setSelectedBranch(null);

      return undefined;
    }

    const cached = githubBranchesCache.get(getGitHubBranchesCacheId(workspaceId, selectedRepo));
    if (cached) {
      applyGitHubBranchSnapshot(cached);
      return undefined;
    }

    setRepoBranches((prev) => (prev.length === 0 ? prev : []));
    return undefined;
  }, [applyGitHubBranchSnapshot, contextType, selectedRepo, workspaceId]);

  useEffect(() => {
    if (contextType !== 'github') return undefined;
    if (!workspaceId || !selectedRepo) return undefined;

    let cancelled = false;
    void (async () => {
      try {
        const result = await withGitHubTokenRetry(workspaceId, selectedRepo, (token) =>
          githubFetchBranches(token, selectedRepo)
        );
        const snapshot = createChatLandingBranchSnapshot(result.branches, result.defaultBranch);
        githubBranchesCache.set(getGitHubBranchesCacheId(workspaceId, selectedRepo), {
          ...snapshot,
          updatedAt: Date.now(),
        });
        if (cancelled) return;
        applyGitHubBranchSnapshot(snapshot);
      } catch (error) {
        if (cancelled) return;
        console.warn('Failed to load repository branches', error);
        setSelectedBranch((prev) => {
          const trimmed = prev?.trim() || null;
          return trimmed === prev ? prev : trimmed;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyGitHubBranchSnapshot, contextType, selectedRepo, workspaceId]);

  // ── Prompt keydown ──
  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || isImeComposingKeyboardEvent(event)) return;
    if (event.shiftKey) return;
    event.preventDefault();
    void handleSubmit();
  };

  const attachPastedFiles = useCallback(
    (files: File[]) => {
      const { images, attachments } = splitImageAndFileAttachments(files);
      if (images.length > 0) {
        addFiles(images);
      }
      if (attachments.length > 0) {
        addFileAttachments(attachments);
      }
    },
    [addFileAttachments, addFiles]
  );
  const handlePromptPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const text = event.clipboardData.getData('text/plain');

      // Refuse the whole paste rather than silently truncating it: a blob this
      // large is a log dump, and a half-pasted log is worse than none.
      if (text && isPastedTextTooLarge(text)) {
        event.preventDefault();
        toast.error(
          t('composer.pastedTextTooLarge', 'Pasted text is too large ({{size}}).', {
            size: formatFileSize(getPastedTextByteSize(text)),
          }),
          {
            description: t(
              'composer.pastedTextTooLargeDescription',
              'The limit is {{limit}}. Attach it as a file instead.',
              { limit: formatFileSize(MAX_PASTED_TEXT_BYTE_SIZE) }
            ),
          }
        );
        return;
      }

      if (text && shouldCapturePastedTextDraft(text)) {
        event.preventDefault();
        insertLargePastedTextAtSelection(text);
      }

      const clipboardFiles = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      // A Word or PowerPoint copy carries a picture of the selection beside the
      // text, so attaching every clipboard file turned those pastes into a
      // screenshot of themselves.
      const { files: pastedFiles, renderedImages } = selectPastedClipboardFiles({
        text,
        files: clipboardFiles,
      });

      if (renderedImages.length > 0) {
        toast(t('composer.pastedRichTextAsText', 'Pasted as text.'), {
          // One id, so pasting repeatedly replaces the hint instead of stacking it.
          id: 'composer-pasted-rich-text-as-text',
          action: {
            label: t('composer.pastedRichTextAttachImage', 'Attach image instead'),
            onClick: () => attachPastedFiles(renderedImages),
          },
        });
      }

      if (pastedFiles.length > 0) {
        event.preventDefault();
        attachPastedFiles(pastedFiles);
        return;
      }

      handleImagePromptPaste(event);
    },
    [attachPastedFiles, handleImagePromptPaste, insertLargePastedTextAtSelection, t]
  );
  const handleImageDrop = useCallback(
    (files: File[]) => {
      const { images, attachments } = splitImageAndFileAttachments(files);
      if (images.length > 0) {
        addFiles(images);
      }
      if (attachments.length > 0) {
        addFileAttachments(attachments);
      }
    },
    [addFileAttachments, addFiles]
  );
  const handleAttachmentInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length > 0) {
        handleImageDrop(files);
      }
      event.target.value = '';
    },
    [handleImageDrop]
  );
  const handleOpenAttachmentPicker = useCallback(() => {
    attachmentInputRef.current?.click();
  }, []);

  const handleAddLocalProject = useCallback(() => {
    openAddProjectDialog();
  }, [openAddProjectDialog]);

  const handleLocalProjectAdded = useCallback(
    (info: { machineId: MachineId; localProjectId: LocalProjectId }) => {
      handleSelectedLocalProjectChange({
        machineId: info.machineId,
        localProjectId: info.localProjectId,
      });
      setContextType('local');
    },
    [handleSelectedLocalProjectChange]
  );

  const captureSessionInputBlocked = useCallback(
    (
      reason:
        | 'image_upload_in_progress'
        | 'empty_input'
        | 'missing_agent_config'
        | 'missing_machine'
        | 'missing_context'
        | 'local_project_git_state_failed'
        | 'missing_branch'
        | 'missing_project'
        | 'design_save_failed',
      extra?: Record<string, unknown>
    ) => {
      capturePostHogEvent(postHog, 'session/input_blocked', {
        reason,
        entrypoint: 'chat_landing',
        project_kind: analyticsProjectKind,
        has_pending_images: hasBlockingImages,
        workspace_id: workspaceId ?? null,
        machine_id:
          contextType === 'local'
            ? (selectedLocalProject?.machineId ?? selectedAgent?.machineId ?? null)
            : (selectedAgent?.machineId ?? null),
        agent_config_id: selectedAgent?.agentId ?? null,
        repo_id_hash: contextType === 'github' ? hashAnalyticsId(selectedRepo) : null,
        local_project_id:
          contextType === 'local' ? (selectedLocalProject?.localProjectId ?? null) : null,
        ...extra,
      });
    },
    [
      analyticsProjectKind,
      contextType,
      hasBlockingImages,
      postHog,
      selectedAgent,
      selectedLocalProject,
      selectedRepo,
      workspaceId,
    ]
  );

  // ── Submit ──
  const handleSubmit = async () => {
    if (submitting) return;
    const submitStartedAtMs = getPerformanceNowMs();
    if (hasBlockingImages || hasBlockingFiles) {
      captureSessionInputBlocked('image_upload_in_progress');
      return;
    }

    // One pass: pasted placeholders, `$skill`, `@session:`, and the mentions
    // that need no rewrite all resolve against the same original text, and the
    // spans record where each landed. `normalizeSessionInputBlocks` re-anchors
    // them across its trim.
    const expandedPrompt = expandSkillMentionsForPrompt({
      text: prompt,
      mentions: persistedMentionRanges ?? [],
      pastedTextDrafts,
    });
    const inputBlocks = normalizeSessionInputBlocks(
      buildInputBlocks(expandedPrompt.text, buildFileInputBlocks(), expandedPrompt.spans),
      ''
    );
    const promptText = extractPromptPreviewFromInputBlocks(inputBlocks);
    if (inputBlocks.length === 0) {
      captureSessionInputBlocked('empty_input');
      setComposerError(t('chat.validation.missingPrompt'));
      return;
    }
    if (
      isElectron &&
      canvasDraft.mode === 'custom' &&
      ![canvasDraft.width, canvasDraft.height].every(
        (value) => Number.isInteger(value) && value >= 1 && value <= 4096
      )
    ) {
      setComposerError(
        t('design.invalidSize', 'Canvas dimensions must be whole numbers from 1 to 4096.')
      );
      return;
    }
    if (!selectedAgent || !selectedConfig) {
      captureSessionInputBlocked('missing_agent_config');
      setComposerError(t('chat.validation.missingAgent'));
      return;
    }
    const scopedMachineId =
      contextType === 'local'
        ? selectedMachineId && isSelectedMachineValid
          ? selectedMachineId
          : (selectedLocalProject?.machineId ?? null)
        : selectedMachineId && isSelectedMachineValid
          ? selectedMachineId
          : null;
    if (!scopedMachineId || selectedAgent.machineId !== scopedMachineId) {
      captureSessionInputBlocked('missing_machine');
      setComposerError(t('chat.validation.missingMachine'));
      return;
    }
    const machine = machines.get(scopedMachineId);
    if (!machine) {
      captureSessionInputBlocked('missing_machine');
      setComposerError(t('chat.validation.missingMachine'));
      return;
    }
    if (!currentUser || !userId || !workspaceId) {
      captureSessionInputBlocked('missing_context');
      setComposerError(t('chat.validation.missingContext'));
      return;
    }
    if (!runtime) {
      captureSessionInputBlocked('missing_context');
      setComposerError(t('chat.validation.missingContext'));
      return;
    }
    const githubBranch = selectedBranch?.trim() || '';
    // Only require branch selection when the repo actually has branches.
    // Empty repos have no branches, but sessions can still be created.
    if (contextType === 'github' && !githubBranch && repoBranches.length > 0) {
      captureSessionInputBlocked('missing_branch');
      setComposerError(t('chat.validation.missingBranch'));
      return;
    }

    // Tracks the dispatch phase so the catch block can emit a structured
    // failure_reason (spec §5.4) instead of a flat "unknown". Each phase sets
    // this immediately before the awaited call that owns it.
    let startFailureReason: SessionStartFailureReason = 'unknown';
    const acpAnalyticsProperties = buildSessionCreateAcpAnalyticsProperties({
      cliType: selectedConfig?.cliType,
      agentType: selectedConfig?.agentType,
      modeId: modeOptions.length > 0 ? selectedModeId : null,
      modelId: modelOptions.length > 0 ? selectedModelId : null,
      configOptionValues,
      configOptionSelectors,
    });
    const sessionIdForStart = draftSessionId ?? ensureDraftSessionId();
    try {
      setSubmitting(true);
      setComposerStatus(null);
      // Preserve React draft state until startSession is accepted, but clear the
      // controlled element immediately so click/Enter feedback cannot wait for
      // the first local writer await.
      if (promptTextareaRef.current) {
        promptTextareaRef.current.value = '';
      }

      let project: ProjectRef | undefined;
      let repoFullNameForMentions: string | undefined;

      if (contextType === 'local' && !selectedLocalProject) {
        captureSessionInputBlocked('missing_project');
        setComposerError(t('chat.validation.missingProject', 'Please select a project'));
        return;
      }
      if (contextType === 'local' && selectedLocalProject?.machineId !== scopedMachineId) {
        captureSessionInputBlocked('missing_project');
        setComposerError(t('chat.validation.missingProject', 'Please select a project'));
        return;
      }

      if (contextType === 'local' && selectedLocalProject) {
        project = { kind: 'local', localProjectId: selectedLocalProject.localProjectId };
      } else if (contextType === 'github' && selectedRepo) {
        project = { kind: 'github', repoFullName: selectedRepo, branch: githubBranch };
        repoFullNameForMentions = selectedRepo;
      }

      const draftTitle = promptText
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0)
        ?.slice(0, 50);
      /* Agent config prompt, then the Role's instruction, then the task — the
         Role speaks for how this agent is being used, so it sits between the
         two. A Role only reaches here while it is still what will run. */
      const promptPayload = buildAgentPrompt(
        promptText,
        buildAgentPrompt(activeAgentRole?.promptPrefix ?? '', selectedConfig.prompt ?? '')
      );
      const issuePRMentions = extractIssuePRMentionsFromText(
        promptText,
        knownIssuePrItems,
        repoFullNameForMentions
      );
      const inputConfig = buildSessionTurnInputConfig({
        inputBlocks,
        prompt: promptPayload,
        cliType: selectedConfig.cliType,
        agentType: selectedConfig.agentType,
        modeId: modeOptions.length > 0 ? (selectedModeId ?? undefined) : undefined,
        modelId: modelOptions.length > 0 ? (selectedModelId ?? undefined) : undefined,
        configOptionValues: dispatchConfigOptionValues,
        issuePRMentions,
        mcpServerIds: mcpSelection.selectedIds,
        taskToolsEnabled: tasksFeatureEnabled,
        agentRoleId: activeAgentRole?.id ?? null,
        agentRoleRevision: activeAgentRole?.revision,
      });
      const pendingHistoryEntry = buildPendingUserHistoryEntry({
        userId,
        inputBlocks,
        timestamp: new Date().toISOString(),
        inputConfig,
      });
      if (!pendingHistoryEntry) {
        throw new Error('Initial session history missing effective items');
      }
      startFailureReason = 'session_create_failed';
      const designService = isElectron ? getIpcServices()?.design : undefined;
      if (
        isElectron &&
        (!designService || selectedAgent.machineId !== localProbeResult?.machineId)
      ) {
        throw new Error('The canvas requires the local workspace');
      }
      if (designService) {
        const association = canvasDraft.association ?? {
          sessionId: sessionIdForStart,
          name: t('design.untitled', 'Untitled design'),
          userId,
          machineId: selectedAgent.machineId,
          createdAt: new Date().toISOString(),
        };
        setCanvasDraft({ ...canvasDraft, association });
        await designService.create({
          association,
          ...(canvasDraft.mode === 'custom'
            ? { width: canvasDraft.width, height: canvasDraft.height }
            : {}),
        });
        /* P2.2: the first turn's baseline must be the saved canvas. Create is
           the initial save; also flush any already-open editor (a no-op when
           none is attached). On failure block the send and keep the draft. */
        try {
          await flushDesignCanvasBeforeSend(association.sessionId);
        } catch (error) {
          captureSessionInputBlocked('design_save_failed', {
            error_message: error instanceof Error ? error.message : String(error),
          });
          setComposerError(
            t(
              'design.saveFailedBeforeSend',
              'The canvas could not be saved; your edits are kept. Please try sending again.'
            )
          );
          return;
        }
      }
      const { sessionId, historyEntry } = await startSession(
        {
          sessionId: sessionIdForStart,
          ...(designService
            ? { design: { artworkId: sessionIdForStart, path: 'design.json' as const } }
            : {}),
          userId,
          cliType: selectedConfig.cliType,
          agentType: selectedConfig.agentType,
          customAcp: selectedConfig.customAcp,
          runtimeOverrides: selectedConfig.runtimeOverrides,
          machineId: selectedAgent.machineId,
          agentConfigId: selectedAgent.agentId,
          env: selectedConfig.env,
          repoFullName: repoFullNameForMentions,
          project,
          worktreeSetup:
            contextType === 'github' && selectedRepoWorktreeSetup
              ? selectedRepoWorktreeSetup
              : undefined,
          worktreeCleanup:
            contextType === 'github' && selectedRepoWorktreeCleanup
              ? selectedRepoWorktreeCleanup
              : undefined,
          branchName: contextType === 'github' ? githubBranch : undefined,
          title: draftTitle,
          titleSource: draftTitle ? 'draft' : undefined,
          // Provenance only: the dispatch config above is already frozen, so a
          // Role edited or deleted later cannot change how this session runs.
          ...(activeAgentRole
            ? { agentRoleId: activeAgentRole.id, agentRoleRevision: activeAgentRole.revision }
            : {}),
        },
        pendingHistoryEntry
      );
      if (!historyEntry || typeof historyEntry !== 'object' || !('id' in historyEntry)) {
        throw new Error(`Initial session history missing entry id (sessionId=${sessionId})`);
      }
      if (designService) {
        writeStoredLastActiveTabState(sessionId, {
          sessionTabId: sessionId,
          viewerTab: null,
          sidePanel: { open: true, tab: 'design', tabs: ['design'], sideSessionId: null },
        });
        // Session acceptance is durable: acknowledgement failure must not resend the turn.
        void designService.acknowledge(sessionId).catch((error) => toast.error(String(error)));
      }
      persistAgentSessionDefaults(selectedAgent.agentId, {
        modeId: modeOptions.length > 0 ? selectedModeId : null,
        modelId: modelOptions.length > 0 ? selectedModelId : null,
        configOptionValues: dispatchConfigOptionValues,
      });
      // A recent entry is a configuration the user actually RAN, so it is
      // recorded here — after the session was accepted — not when a knob moves.
      setRecentRunConfigRecords(
        recordRecentRunConfig(
          workspaceId,
          {
            agentId: selectedAgent.agentId,
            machineId: selectedAgent.machineId,
            modelId: currentRunConfigFace.modelId,
            modelLabel: currentRunConfigFace.modelLabel,
            reasoningLabel: currentRunConfigFace.reasoningLabel,
            planOn: currentRunConfigFace.planOn,
            fastOn: currentRunConfigFace.fastOn,
            configOptionValues: sanitizeConfigOptionValues(dispatchConfigOptionValues),
            // A Role is one of these combinations, so it is recorded as one —
            // as the Role, not as the values it happened to set.
            agentRoleId: activeAgentRole?.id ?? null,
          },
          Date.now()
        )
      );
      handoffSessionPreparation(sessionId);

      capturePostHogEvent(postHog, 'session/start_requested', {
        user_id: userId,
        workspace_id: workspaceId,
        session_id: sessionId,
        machine_id: selectedAgent.machineId,
        agent_config_id: selectedAgent.agentId,
        cli_type: selectedConfig.cliType,
        agent_type: selectedConfig.agentType,
        ...acpAnalyticsProperties,
        repo_id_hash: hashAnalyticsId(repoFullNameForMentions),
        project_kind: analyticsProjectKind,
        local_project_id: selectedLocalProject?.localProjectId ?? null,
        workdir_mode: contextType === 'local' ? 'local' : null,
        has_images: inputBlocks.some((block) => block.type === 'image'),
        image_count: inputBlocks.filter((block) => block.type === 'image').length,
        entrypoint: 'chat_landing',
        launch_mode: launchMode,
        submit_prepare_ms: getDurationSinceMs(submitStartedAtMs),
      });
      capturePostHogEvent(postHog, SESSION_ACP_CONFIG_USED_EVENT, {
        user_id: userId,
        workspace_id: workspaceId,
        session_id: sessionId,
        machine_id: selectedAgent.machineId,
        agent_config_id: selectedAgent.agentId,
        cli_type: selectedConfig.cliType,
        agent_type: selectedConfig.agentType,
        ...acpAnalyticsProperties,
        project_kind: analyticsProjectKind,
        entrypoint: 'chat_landing',
        launch_mode: launchMode,
      });

      const dispatchStartedAtMs = getPerformanceNowMs();
      void requestSessionDispatch(sessionId, historyEntry.id, {
        inputConfig,
        machineId: selectedAgent.machineId,
      }).catch((dispatchError: unknown) => {
        const errorMessage =
          dispatchError instanceof Error ? dispatchError.message : String(dispatchError);
        capturePostHogEvent(postHog, 'session/start_dispatch_failed', {
          user_id: userId,
          workspace_id: workspaceId,
          session_id: sessionId,
          machine_id: selectedAgent.machineId,
          agent_config_id: selectedAgent.agentId,
          cli_type: selectedConfig.cliType,
          agent_type: selectedConfig.agentType,
          ...acpAnalyticsProperties,
          repo_id_hash: hashAnalyticsId(repoFullNameForMentions),
          project_kind: analyticsProjectKind,
          local_project_id: selectedLocalProject?.localProjectId ?? null,
          workdir_mode: contextType === 'local' ? 'local' : null,
          entrypoint: 'chat_landing',
          launch_mode: launchMode,
          duration_ms: getDurationSinceMs(dispatchStartedAtMs),
          error_message: errorMessage,
        });
        console.error('Failed to request session dispatch', dispatchError);
        toast.error(t('chat.failed'), { description: errorMessage });
      });
      // session_number is derived from the user's own prior sessions counted at
      // submit start (ref snapshot avoids races with the just-created session
      // streaming into the visible list). 1 = first-ever, which drives the
      // activation anchor below (spec §3.1).
      const sessionNumber = ownPriorSessionCountRef.current + 1;
      const isFirstSessionEver = sessionNumber === 1;

      capturePostHogEvent(postHog, 'session/start_success', {
        user_id: userId,
        workspace_id: workspaceId,
        session_id: sessionId,
        machine_id: selectedAgent.machineId,
        agent_config_id: selectedAgent.agentId,
        cli_type: selectedConfig.cliType,
        agent_type: selectedConfig.agentType,
        ...acpAnalyticsProperties,
        repo_id_hash: hashAnalyticsId(repoFullNameForMentions),
        project_kind: analyticsProjectKind,
        local_project_id: selectedLocalProject?.localProjectId ?? null,
        workdir_mode: contextType === 'local' ? 'local' : null,
        session_number: sessionNumber,
        launch_mode: launchMode,
        dispatch_duration_ms: getDurationSinceMs(submitStartedAtMs),
      });

      // Unified activation anchor (spec §3.1/§3.4). Web fires it for the user's
      // first-ever successful start; the CLI fires the same anchor for CLI-first
      // users so the D1/D7/D30 cohort is the Web ∪ CLI union. signup_at /
      // days_since_signup are sent only when available (not surfaced client-side
      // today) so the property stays absent rather than wrong.
      if (isFirstSessionEver) {
        capturePostHogEvent(postHog, 'activation/first_session_succeeded', {
          user_id: userId,
          workspace_id: workspaceId,
          session_id: sessionId,
          machine_id: selectedAgent.machineId,
          agent_config_id: selectedAgent.agentId,
          cli_type: selectedConfig.cliType,
          agent_type: selectedConfig.agentType,
          project_kind: analyticsProjectKind,
          is_first_session_ever: true,
          created_via: 'web',
          launch_mode: launchMode,
        });
      }

      // Local session creation and history write succeeded; a later navigate()
      // throw is not a session-start failure, so reset the phase before it can
      // be misattributed.
      startFailureReason = 'unknown';

      setPrompt('');
      clearPastedTextDrafts();
      clearPendingImages();
      clearPendingFiles();
      resetDraftSessionId();
      setCanvasDraft({
        mode: canvasDraft.mode,
        width: canvasDraft.width,
        height: canvasDraft.height,
      });
      await navigate(getSessionCreationNavigation(workspaceSlug, sessionId, false));
    } catch (error) {
      capturePostHogEvent(postHog, 'session/start_failed', {
        user_id: userId ?? null,
        workspace_id: workspaceId ?? null,
        machine_id: selectedAgent?.machineId ?? null,
        agent_config_id: selectedAgent?.agentId ?? null,
        cli_type: selectedConfig?.cliType ?? null,
        agent_type: selectedConfig?.agentType ?? null,
        ...acpAnalyticsProperties,
        repo_id_hash: contextType === 'github' ? hashAnalyticsId(selectedRepo) : null,
        project_kind: analyticsProjectKind,
        local_project_id: selectedLocalProject?.localProjectId ?? null,
        failure_reason: startFailureReason,
        entrypoint: 'chat_landing',
        launch_mode: launchMode,
        duration_ms: getDurationSinceMs(submitStartedAtMs),
        error_message: error instanceof Error ? error.message : String(error),
      });
      console.error('Failed to start session', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      toast.error(t('chat.failed'), { description: errMsg });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Selector nodes ──
  // Only constrain to selectedMachineId if it still refers to a valid online machine.
  const isSelectedMachineValid = useMemo(() => {
    if (!selectedMachineId) return false;
    return isChatLandingMachineReachable({
      machineId: selectedMachineId,
      localMachineId: visibleLocalMachineId,
      machines,
      isMachineOnline: isPresenceMachineOnline,
    });
  }, [selectedMachineId, machines, visibleLocalMachineId, isPresenceMachineOnline]);

  // The agent selector must always be scoped to exactly one machine.
  const localProjectMachineId =
    contextType === 'local' && selectedLocalProject ? selectedLocalProject.machineId : null;
  const scopedMachineId = useMemo(
    () => (selectedMachineId && isSelectedMachineValid ? selectedMachineId : localProjectMachineId),
    [localProjectMachineId, selectedMachineId, isSelectedMachineValid]
  );

  const projectRecency = useMemo(
    () => getChatLandingProjectRecency(visibleSessions),
    [visibleSessions]
  );

  const desktopProjectSelection = useMemo<UnifiedProjectSelection>(() => {
    if (contextType === 'local' && selectedLocalProject) {
      return { kind: 'local', ...selectedLocalProject };
    }
    if (contextType === 'github' && selectedRepo) {
      return { kind: 'github', repoFullName: selectedRepo };
    }
    return { kind: 'none' };
  }, [contextType, selectedLocalProject, selectedRepo]);
  const handleDesktopProjectChange = useCallback(
    (selection: UnifiedProjectSelection) => {
      if (selection.kind === 'none') {
        setContextType('chat');
        return;
      }
      if (selection.kind === 'github') {
        setSelectedRepo(selection.repoFullName);
        setContextType('github');
        return;
      }
      handleSelectedLocalProjectChange({
        machineId: selection.machineId,
        localProjectId: selection.localProjectId,
      });
      setContextType('local');
    },
    [handleSelectedLocalProjectChange]
  );
  const desktopAgentMachineIds = useMemo(
    () => (scopedMachineId ? [scopedMachineId] : []),
    [scopedMachineId]
  );
  /* Roles offered for the machine this chat will start on. Scoped to that one
     machine because a Role binds its execution site exactly — a Role from
     another machine could only move the chat off the selected one. */
  const composerAgentRoleItems = useMemo(
    () =>
      buildComposerAgentRoleItems({
        roles: workspaceAgentRoles,
        machineId: scopedMachineId,
        agentConfigs: executorConfigs,
        resolveAvailability: resolveAgentRoleAvailability,
      }),
    [executorConfigs, resolveAgentRoleAvailability, scopedMachineId, workspaceAgentRoles]
  );
  const handleAgentRoleSelect = useCallback(
    (roleId: AgentRoleId | null) => {
      // Leaving a Role clears the NAME, not the configuration: the values it
      // seeded are now the user's own, and silently rolling them back would
      // undo choices they never asked to undo.
      if (roleId === null) {
        setAgentRolePreference(null);
        return;
      }
      const item = composerAgentRoleItems.find((entry) => entry.role.id === roleId);
      // An unavailable Role is listed so its owner can see why it cannot run;
      // it is never something the composer quietly starts a chat with.
      if (!item || item.availability.kind !== 'available') return;
      const { role } = item;
      agentRolePreferenceTokenRef.current += 1;
      setPendingRecentRunConfig(null);
      setSelectedAgent({ agentId: role.agentConfigId, machineId: role.machineId });
      setAgentRolePreference({ roleId: role.id, token: agentRolePreferenceTokenRef.current });
    },
    [composerAgentRoleItems]
  );

  /* Creating a Role from the composer opens on the configuration already in
     front of the user — "save what I am about to run" is the whole reason the
     entry point is here rather than only in Settings. */
  const handleAgentRoleCreate = useCallback(() => {
    setAgentRoleEditor(
      openAgentRoleEditorForCreate(
        buildAgentRoleFormValueFromRunConfig({
          machineId: selectedAgent?.machineId ?? scopedMachineId,
          agentConfigId: selectedAgent?.agentId ?? null,
          modeId: selectedModeId,
          modelId: modelOptions.length > 0 ? selectedModelId : null,
          configOptionValues: sanitizeConfigOptionValues(dispatchConfigOptionValues),
        })
      )
    );
  }, [
    dispatchConfigOptionValues,
    modelOptions.length,
    scopedMachineId,
    selectedAgent,
    selectedModeId,
    selectedModelId,
  ]);
  const handleAgentRoleEdit = useCallback(
    (roleId: AgentRoleId) => {
      const role = composerAgentRoleItems.find((entry) => entry.role.id === roleId)?.role;
      if (role) setAgentRoleEditor(openAgentRoleEditorForEdit(role));
    },
    [composerAgentRoleItems]
  );
  /* Creating a Role from the composer means "use this now", so the new Role is
     selected as soon as the composer can offer it. Deferred rather than
     immediate: the write resolves on durability while the catalog snapshot
     arrives on its own tick, so the Role is not in the list yet at that moment. */
  const [pendingAgentRoleSelection, setPendingAgentRoleSelection] = useState<AgentRoleId | null>(
    null
  );
  const handleAgentRoleSaved = useCallback((role: AgentRole, { created }: { created: boolean }) => {
    if (created) setPendingAgentRoleSelection(role.id);
  }, []);
  useEffect(() => {
    if (!pendingAgentRoleSelection) return;
    const outcome = resolvePendingAgentRoleSelection({
      roleId: pendingAgentRoleSelection,
      items: composerAgentRoleItems,
      isInCatalog: workspaceAgentRoles.some((role) => role.id === pendingAgentRoleSelection),
    });
    if (outcome === 'wait') return;
    setPendingAgentRoleSelection(null);
    if (outcome === 'select') handleAgentRoleSelect(pendingAgentRoleSelection);
  }, [
    composerAgentRoleItems,
    handleAgentRoleSelect,
    pendingAgentRoleSelection,
    workspaceAgentRoles,
  ]);

  /* Restore the last-used Role once, and only once the catalog can answer.
     Until the workspace document has synced, "not in the list" means "not
     loaded yet", so giving up then would silently drop the stored Role. */
  useEffect(() => {
    if (agentRoleRestored || !defaultsReady) return;
    const storedRoleId = readChatLandingDefaults(workspaceId)?.agentRoleId as
      | AgentRoleId
      | undefined;
    if (!storedRoleId) {
      setAgentRoleRestored(true);
      return;
    }
    const item = composerAgentRoleItems.find((entry) => entry.role.id === storedRoleId);
    if (!item) {
      if (agentRolesSynced) setAgentRoleRestored(true);
      return;
    }
    setAgentRoleRestored(true);
    handleAgentRoleSelect(storedRoleId);
  }, [
    agentRoleRestored,
    agentRolesSynced,
    composerAgentRoleItems,
    defaultsReady,
    handleAgentRoleSelect,
    workspaceId,
  ]);
  const agentRolePinsPermissionMode = useMemo(() => {
    if (!activeAgentRole) return false;
    const { source } = resolvePermissionModeFace({
      modeOptions,
      selectedModeId,
      configOptionSelectors,
      configOptionValues,
    });
    return doesAgentRolePinPermissionMode(activeAgentRole, source);
  }, [activeAgentRole, configOptionSelectors, configOptionValues, modeOptions, selectedModeId]);

  /* Recent entries are offered only for agents the menu itself can select: one
     recorded on another machine must not silently move the chat off the
     selected one. */
  const recentRunConfigAgentConfigs = useMemo(
    () =>
      scopedMachineId
        ? executorConfigs.filter((config) => config.machineId === scopedMachineId)
        : executorConfigs,
    [executorConfigs, scopedMachineId]
  );
  /* Only Roles the composer could pick right now: a recorded Role entry whose
     Role is gone or unavailable must drop out rather than re-running its values
     without it. */
  const selectableAgentRoles = useMemo(
    () =>
      composerAgentRoleItems
        .filter((item) => item.availability.kind === 'available')
        .map((item) => item.role),
    [composerAgentRoleItems]
  );
  const recentRunConfigItems = useMemo(
    () =>
      buildRecentRunConfigItems({
        records: recentRunConfigRecords,
        agentConfigs: recentRunConfigAgentConfigs,
        agentRoles: selectableAgentRoles,
        currentKey: currentRunConfigKey,
      }),
    [currentRunConfigKey, recentRunConfigAgentConfigs, recentRunConfigRecords, selectableAgentRoles]
  );
  const handleRecentRunConfigSelect = useCallback(
    (id: string) => {
      const record = recentRunConfigRecords.find((entry) => getRecentRunConfigKey(entry) === id);
      if (!record) return;
      // Recorded AS a Role: re-apply the Role, not the values it set. Those
      // values are only half of it — the instruction and the provenance ride
      // with the Role, and re-running "the same knobs" would drop both.
      if (record.agentRoleId) {
        handleAgentRoleSelect(record.agentRoleId as AgentRoleId);
        return;
      }
      const config = recentRunConfigAgentConfigs.find(
        (entry) => entry.id === record.agentId && entry.machineId === record.machineId
      );
      if (!config) return;
      // A recent entry and a Role are two whole configurations; the one just
      // picked owns the selection, so the other stops driving it.
      setAgentRolePreference(null);
      setSelectedAgent({ agentId: config.id, machineId: config.machineId });
      setPendingRecentRunConfig(record);
    },
    [handleAgentRoleSelect, recentRunConfigAgentConfigs, recentRunConfigRecords]
  );

  const desktopMachineOptions = useMemo(
    () =>
      Array.from(selectableMachines.values()).map((machine) => ({
        value: machine.id,
        label: machine.name,
      })),
    [selectableMachines]
  );
  const desktopSelectedMachineId = scopedMachineId;
  const desktopSelectedMachineLabel = desktopSelectedMachineId
    ? machines.get(desktopSelectedMachineId)?.name
    : null;
  const desktopLocalProjectOptions = useMemo(
    () =>
      buildUnifiedLocalProjectOptions({
        visibleLocalProjects,
        selectedMachineId: desktopSelectedMachineId,
        latestMessageAtByLocalProject: projectRecency.byProject,
      }),
    [desktopSelectedMachineId, projectRecency.byProject, visibleLocalProjects]
  );

  const topSelectorNode = (
    <ErrorBoundary
      name="ChatLandingTopSelector"
      variant="inline"
      resetKeys={[workspaceId, selectedRepo, selectedLocalProject, selectedMachineId, contextType]}
      fallbackRender={({ resetErrorBoundary }) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(selectorTagClassName, 'text-xs leading-tight')}
          onClick={resetErrorBoundary}
          aria-label={t('chat.retryTargetSelector', 'Retry target selector')}
        >
          <RefreshCw aria-hidden="true" className="size-3" />
          {t('common.retry', 'Retry')}
        </Button>
      )}
    >
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
        <DesktopMachineMenu
          value={desktopSelectedMachineId}
          visibleLocalMachineId={visibleLocalMachineId}
          selectedLabel={desktopSelectedMachineLabel}
          options={desktopMachineOptions}
          onChange={handleMachineChange}
          disabled={isInitialDataLoading}
        />
        <UnifiedProjectSelectorView
          value={desktopProjectSelection}
          onChange={handleDesktopProjectChange}
          localProjects={desktopLocalProjectOptions}
          repositories={repositories}
          latestMessageAtByRepo={projectRecency.byRepo}
          onAddLocalProject={handleAddLocalProject}
          renderLimit={UNIFIED_PROJECT_OPTION_RENDER_LIMIT}
        />

        {isElectron ? (
          <div className="ml-auto shrink-0">
            <CanvasSizeSelector
              {...canvasDraft}
              disabled={submitting || Boolean(canvasDraft.association)}
              onChange={setCanvasDraft}
            />
          </div>
        ) : null}
      </div>
    </ErrorBoundary>
  );

  const footerSelectorNode = (
    <ErrorBoundary
      name="ChatLandingFooterSelector"
      variant="inline"
      resetKeys={[workspaceId, selectedAgent?.agentId]}
      fallback={null}
    >
      <div className="contents">
        <DesktopRunConfigMenu
          agentSelection={selectedAgent}
          allowedMachineIds={desktopAgentMachineIds}
          disabledReason={
            scopedMachineId
              ? undefined
              : t('chat.machineSelector.selectFirst', 'Select a machine first')
          }
          fallbackAgent={{
            cliType: selectedConfig?.cliType,
            agentType: selectedConfig?.agentType,
          }}
          onAgentConfigChange={setSelectedAgent}
          modelOptions={modelOptions}
          selectedModelId={selectedModelId}
          onModelChange={setSelectedModelName}
          configOptionSelectors={configOptionSelectors}
          configOptionValues={configOptionValues}
          onConfigOptionChange={handleConfigOptionChange}
          recentRunConfigs={recentRunConfigItems}
          onRecentRunConfigSelect={handleRecentRunConfigSelect}
          modeOptions={modeOptions}
          selectedModeId={selectedModeId}
          agentRoles={{
            items: composerAgentRoleItems,
            selectedRoleId: activeAgentRole?.id ?? null,
            onSelect: handleAgentRoleSelect,
            onCreate: handleAgentRoleCreate,
            onEdit: handleAgentRoleEdit,
            machine: scopedMachineId ? (machines.get(scopedMachineId) ?? null) : null,
          }}
        />
        {/* Permission is part of what a Role pins, so behind one it stops being
            a separate control and is stated in the Role's own face instead. It
            stays a button when the Role pins nothing there — an agent with no
            permission control leaves a Role nothing to own, and hiding the knob
            then would take away one the Role never had. */}
        {agentRolePinsPermissionMode ? null : (
          <DesktopPermissionModeButton
            modeOptions={modeOptions}
            selectedModeId={selectedModeId}
            onModeChange={setSelectedModeId}
            configOptionSelectors={configOptionSelectors}
            configOptionValues={configOptionValues}
            onConfigOptionChange={handleConfigOptionChange}
          />
        )}
        <SessionUsagePopover
          rateLimits={selectedRateLimits}
          agentType={selectedConfig?.agentType ?? ''}
          modelId={selectedModelId}
          modelLabel={selectedModelLabel}
          showCodexResetForecast={showCodexResetForecast}
          showRateLimitWithoutContext
        />
      </div>
    </ErrorBoundary>
  );

  const bottomBarNode = null;

  // ── Hints ──
  const hasNoAgentConfig = executorConfigs.length === 0;
  const hintType: ChatLandingHintType = getChatLandingHintType({
    hasNoMachine,
    hasNoAgentConfig,
    isInitialDataLoading,
  });

  // Web/mobile users without any machine need the desktop client; send them to
  // the download page (localized) in their browser / external shell.
  const handleDownloadClient = () => {
    void openExternalUrl(getDownloadPageUrl(i18n.resolvedLanguage ?? i18n.language));
  };

  // The local desktop opens the public issue tracker explicitly.
  const handleReportBug = () => {
    void openExternalUrl(MOLLY_ISSUES_URL);
  };

  const handleGoToAgentSettings = () => {
    openSettings('agents');
  };

  // ── Mention source ──
  const isSelectedRepoPublic = useMemo(() => {
    if (!selectedRepo) return undefined;
    const repo = freshRepositories?.find((r) => r.fullName === selectedRepo);
    return repo ? !repo.private : undefined;
  }, [freshRepositories, selectedRepo]);
  const preparationMachineId = useMemo(() => {
    if (!selectedAgent) return null;
    const candidateMachineId =
      selectedMachineId && isSelectedMachineValid
        ? selectedMachineId
        : contextType === 'local'
          ? (selectedLocalProject?.machineId ?? null)
          : null;
    return candidateMachineId === selectedAgent.machineId ? candidateMachineId : null;
  }, [
    contextType,
    isSelectedMachineValid,
    selectedAgent,
    selectedLocalProject?.machineId,
    selectedMachineId,
  ]);
  const preparationProject = useMemo<ProjectRef | undefined>(() => {
    if (contextType === 'chat') return undefined;
    if (contextType === 'github') {
      const branch = selectedBranch?.trim();
      if (!selectedRepo || !branch) return undefined;
      return { kind: 'github', repoFullName: selectedRepo, branch };
    }
    if (!selectedLocalProject || selectedLocalProject.machineId !== preparationMachineId) {
      return undefined;
    }
    return { kind: 'local', localProjectId: selectedLocalProject.localProjectId };
  }, [contextType, preparationMachineId, selectedBranch, selectedLocalProject, selectedRepo]);
  const preparationContextReady =
    contextType === 'chat' ||
    (contextType === 'github' && preparationProject?.kind === 'github') ||
    (contextType === 'local' && preparationProject?.kind === 'local');
  const preparationRunConfig = useMemo(
    () =>
      buildSessionPreparationRunConfig({
        modeId: modeOptions.length > 0 ? selectedModeId : null,
        modelId: modelOptions.length > 0 ? selectedModelId : null,
        configOptionValues: dispatchConfigOptionValues,
        mcpServerIds: mcpSelection.selectedIds,
        taskToolsEnabled: tasksFeatureEnabled,
      }),
    [
      dispatchConfigOptionValues,
      mcpSelection.selectedIds,
      modeOptions.length,
      modelOptions.length,
      selectedModeId,
      selectedModelId,
      tasksFeatureEnabled,
    ]
  );
  const { handoffToSession: handoffSessionPreparation } = useSessionPreparation({
    runtime,
    machineId: preparationMachineId,
    requestedByUserId: userId ?? null,
    agentConfigId: selectedConfig?.id ?? null,
    cliType: selectedConfig?.cliType ?? null,
    agentType: selectedConfig?.agentType ?? null,
    project: preparationProject,
    runConfig: preparationRunConfig,
    sessionId: draftSessionId,
    ensureSessionId: ensureDraftSessionId,
    enabled:
      preparationContextReady &&
      Boolean(
        runtime &&
        preparationMachineId &&
        userId &&
        selectedConfig &&
        (prompt.trim().length > 0 || imageItems.length > 0 || fileItems.length > 0)
      ),
    activityRevision: `${draftActivityRevision}:${imageItems.length}:${fileItems.length}`,
  });

  const mentionSource = useMemo(() => {
    if (contextType === 'chat') return undefined;
    if (contextType === 'local' && selectedLocalProject && workspaceId) {
      return {
        kind: 'local' as const,
        machineId: selectedLocalProject.machineId,
        workspaceId,
        localProjectId: selectedLocalProject.localProjectId,
      };
    }
    return { kind: 'github' as const, repoFullName: selectedRepo, isPublic: isSelectedRepoPublic };
  }, [contextType, isSelectedRepoPublic, selectedLocalProject, selectedRepo, workspaceId]);
  const expandSkillMentionsForPrompt = useMentionPromptExpansion({
    source: mentionSource,
    skillAgent,
    promptValue: prompt,
  });
  const promptPlaceholder = t(
    getChatComposerPromptPlaceholderKey({ mentionSource, availableCommands, skillAgent })
  );
  const issuePrRepoFullName = contextType === 'github' ? selectedRepo : undefined;
  const issuePrRepoIsPublic = contextType === 'github' ? isSelectedRepoPublic : undefined;

  const { knownItems: knownIssuePrItems } = useKnownIssuePrItems(
    issuePrRepoFullName,
    issuePrRepoIsPublic
  );

  const hasSendableContent = prompt.trim().length > 0 || hasUploadedImages || hasUploadedFiles;
  const submitDisabled = getChatLandingSubmitDisabled({
    submitting,
    hasBlockingImages,
    hasBlockingFiles,
    hasSendableContent,
    contextType,
    workdirMode: 'local',
    hasSelectedLocalProject: Boolean(selectedLocalProject),
    isRuntimeInitializing: runtimeInitializing,
    isLoadingLocalGitState: false,
    hasLocalGitStateError: false,
  });
  const selectedMachineHasVisibleLocalProject = useMemo(
    () =>
      selectedMachineId ? getFirstVisibleLocalProjectForMachine(selectedMachineId) !== null : false,
    [selectedMachineId, getFirstVisibleLocalProjectForMachine]
  );
  const selectedMachineProjectStatus = getChatLandingSelectedMachineProjectStatus({
    contextType,
    selectedMachineId,
    hasSelectedLocalProject: Boolean(selectedLocalProject),
    hasAnyVisibleLocalProject: visibleLocalProjectMap.size > 0,
    selectedMachineHasVisibleLocalProject,
    isVisibleLocalProjectsLoading: visibleLocalProjectsLoading,
    isDocMetaCacheReady: docMetaCacheReady,
  });
  const selectedMachineProjectStatusMessage =
    selectedMachineProjectStatus === null
      ? null
      : t(
          getEmptyLocalProjectsMessageKey(
            selectedMachineProjectStatus === 'no-projects-on-selected-machine'
          )
        );
  const visibleComposerStatus = getChatLandingVisibleComposerStatus({
    contextType,
    composerStatus,
    localGitStateError: null,
    selectedMachineProjectStatus: selectedMachineProjectStatusMessage
      ? { message: selectedMachineProjectStatusMessage, tone: 'warning' }
      : null,
  });

  // ── Title ──
  // Rotate the landing heading once per (UTC) day: stable within a day, no
  // flicker across re-renders, no Math.random().
  const headings = [t('chat.heading'), t('chat.heading2')];
  const title = headings[Math.floor(getServerNow() / 86_400_000) % headings.length];

  return (
    <>
      <input
        ref={attachmentInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleAttachmentInputChange}
      />
      <ChatLandingView
        tone={tone}
        navRootRef={keyboardNavRef}
        mentionSource={mentionSource}
        availableCommands={availableCommands}
        skillAgent={skillAgent}
        title={title}
        promptValue={prompt}
        onPromptChange={setPrompt}
        onPromptKeyDown={handlePromptKeyDown}
        onPromptPaste={handlePromptPaste}
        onImageDrop={handleImageDrop}
        promptPlaceholder={promptPlaceholder}
        promptEnterKeyHint={promptEnterKeyHint}
        promptRef={promptTextareaRef}
        pastedTextDrafts={pastedTextDrafts}
        onPastedTextDraftsChange={setPastedTextDrafts}
        onMentionRangesChange={handleMentionRangesChange}
        persistedMentions={persistedMentionRanges}
        imageItems={imageItems}
        attachmentAddDisabled={submitting || (!canAddMoreImages && !canAddMoreFiles)}
        onAttachmentAddClick={handleOpenAttachmentPicker}
        onImageRemove={handleRemoveImage}
        onImageRetry={handleRetryImage}
        fileItems={fileItems}
        onFileRemove={handleRemoveFile}
        onFileRetry={handleRetryFile}
        mcp={mcpSelection.menu}
        topSelector={<div className="w-full min-w-0">{topSelectorNode}</div>}
        footerSelector={footerSelectorNode}
        bottomBar={bottomBarNode}
        composerStatusMessage={visibleComposerStatus?.message}
        composerStatusTone={visibleComposerStatus?.tone}
        submitDisabled={submitDisabled}
        submissionPending={submitting}
        onSubmit={() => {
          void handleSubmit();
        }}
        submitLabel={t('chat.send')}
        submittingLabel={t('chat.submitting')}
        hintType={hintType}
        noMachineVariant={isElectron ? 'daemon-starting' : 'download-client'}
        hintDownloadClientMessage={t('chat.cliHint.downloadClient')}
        hintDownloadClientLabel={t('chat.cliHint.downloadClientButton')}
        hintDaemonStartingMessage={t('chat.cliHint.daemonStarting')}
        hintReportBugLabel={t('chat.cliHint.reportBug')}
        hintNoAgentConfigMessage={t('chat.cliHint.noAgentConfig')}
        hintGoToSettingsLabel={t('chat.cliHint.goToSettings')}
        hintDiscordMessage={t(
          'chat.cliHint.discordMessage',
          'Have questions? Join our Discord community for help.'
        )}
        hintDiscordLabel={t('chat.cliHint.discordLink', 'Discord')}
        onDownloadClient={handleDownloadClient}
        onReportBug={handleReportBug}
        onGoToAgentSettings={handleGoToAgentSettings}
        leftSidebarExpandSlot={
          isLeftSidebarHidden ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => showNavigationSidebar()}
              aria-label={t('chat.leftSidebar.show', 'Show navigation sidebar')}
              className="h-7 w-7 shrink-0 text-muted-foreground"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          ) : null
        }
        resetKeys={[workspaceId, workspaceSlug, contextType]}
        errorLabels={{
          somethingWentWrong: t('common.somethingWentWrong', 'Something went wrong'),
          composerCrashed: t(
            'chat.composerCrashed',
            'The chat composer failed to render. Your draft is preserved below.'
          ),
          tryAgain: t('common.tryAgain', 'Try again'),
          unavailable: t('common.unavailable', 'Unavailable'),
        }}
      />
      <AddLocalProjectDialogContainer
        open={addProjectOpen}
        onOpenChange={handleAddProjectOpenChange}
        initialMachineId={addProjectInitialMachineId}
        onAdded={handleLocalProjectAdded}
        onLocated={handleLocalProjectAdded}
      />
      <AgentRoleEditorDialog
        editor={agentRoleEditor}
        accessibleRoles={workspaceAgentRoles}
        onChange={setAgentRoleEditor}
        onClose={() => setAgentRoleEditor(null)}
        onSaved={handleAgentRoleSaved}
        source="chat_landing"
      />
    </>
  );
}
