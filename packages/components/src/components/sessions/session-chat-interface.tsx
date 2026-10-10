import { canStopAgentEnabled } from '@/lib/session-context-compaction';
import type { DesignElementReference } from '@molly/shared/design-element-reference';
import {
  MessageSelectionContext,
  MessageSelectionToolbar,
  useMessageSelection,
} from '@/components/ai-gui/message-selection';
import {
  startTransition,
  forwardRef,
  memo,
  useDeferredValue,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useOpenSettings } from '../../hooks/use-open-settings';
import { v4 as uuidv4 } from 'uuid';
import {
  ArrowDown,
  ArrowUp,
  Archive,
  ArchiveRestore,
  Copy,
  CornerLeftUp,
  Ellipsis,
  Folder,
  GitBranch,
  GitBranchPlus,
  GitFork,
  Github,
  History,
  Image,
  Loader2,
  MessageCircle,
  Pencil,
  Play,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/ui/button';
import { isMacOSElectronRenderer, useElectronFullscreen } from '@/lib/electron';

import { flushDesignCanvasBeforeSend } from '@/lib/design-canvas-save-gate';
import { isMac } from '@/lib/commands/platform';
import { matchesKeyboardEvent, parseBinding } from '@/lib/commands/key-matcher';
import { isSessionContextCompacting } from '@/lib/session-context-compaction';
import { hasFileTransfer, getFilesFromDataTransfer } from '@/lib/file-drop';
import { selectDesignAgentConfigsForMachine } from '@/lib/design-agent-switch';
import { mergeDropZoneHandlers, useDropZone } from '@/hooks/use-drop-zone';
import { useSessionMentionDropZone } from '@/hooks/use-session-mention-drag';
import { SessionChatInputArea, type SessionChatInputAreaHandle } from './session-chat-input-area';
import { useSessionMcpSelection } from '@/hooks/use-session-mcp-selection';
import { MessageQueueDisplay, shouldRequestNativeQueueSteer } from './message-queue';
import {
  resolveUserSessionStopCancelOptions,
  shouldShowDispatchPauseInterstitial,
} from './session-stop-control';
import { useTranslation } from 'react-i18next';
import { useRouter } from '@tanstack/react-router';
import { toast } from 'sonner';
import type {
  LocalProjectId,
  MessageContent,
  MessageQueueItemInput,
  MessageQueueItem,
  ProjectRef,
  SessionHistory,
  SessionHistoryParsed,
  SessionFilePayload,
  SessionId,
  SessionInputBlock,
  SessionLegacyMetaFields,
  SessionMeta,
  SessionStatus,
  SessionTurnInputConfig,
  CommentReferencePayload,
  ConversationMarkdownStats,
  VisualAnnotationReferencePayload,
} from '@molly/shared';
import {
  buildConversationMarkdown,
  buildPendingUserHistoryEntry,
  buildSessionTurnInputConfig,
  collectConversationMessages,
  type ConversationMessage,
  getAcpCapabilityCacheEntryAuthority,
  getAcpCapabilityCacheKey,
  getMachineFlockLocalProjects,
  getProjectRefBranch,
  extractPromptPreviewFromInputBlocks,
  getServerNow,
  getSessionRoomId,
  historyItemsToInputBlocks,
  hasReportedPreviewTarget,
  isSessionGoalCleared,
  isSessionGoalActive,
  normalizeSessionInputBlocks,
  normalizeSessionTurnInputConfig,
  resolveSessionAcpRuntimeConfig,
  resolveSessionConversationConfig,
  resolveVisibleSessionGoal,
  resolveActiveAssistantTurnId,
  resolveBaseBranchPreference,
  resolveProjectGitHubRepo,
  machineSupportsDesignContinuationPreparation,
  machineSupportsProtocolCapability,
  MACHINE_PROTOCOL_CAPABILITIES,
  SESSION_STOP_CONTROL_USER_STOP_VERSION,
} from '@molly/shared';
import { DesignContinuationDialog } from './design-continuation-dialog';

import { useStableCallback } from '@/hooks/use-stable-callback';
import {
  conversationFontSizeAtom,
  currentWorkspaceIdAtom,
  getAllAgentConfigAtom,
  queuedMessageBehaviorAtom,
  userAtom,
} from '@/atoms';
import { currentWorkspaceSlugAtom } from '@/atoms';
import { activeWorkspaceRuntimeAtom } from '@/atoms/runtime';
import { browserOnlineAtom } from '@/atoms/control-connection';
import {
  docMetaCacheReadyAtom,
  openedSessionsAtomFamily,
  sessionMetaAtomFamily,
} from '@/atoms/doc-meta';
import { useMachineOnlineStatus } from '@/hooks/use-machine-online-status';
import { useDelayedFlag } from '@/hooks/use-delayed-flag';
import { resolveSessionStatusStripState } from './session-status-strip';
import { isSyncingRoomSyncState } from '@/lib/room-sync-state';
import {
  resolveSessionConversationPreparationState,
  type SessionConversationPreparationState,
} from '@/lib/session-conversation-preparation';
import { useAtomValue } from 'jotai';
import SessionChatStream, {
  type AssistantMessageAction,
  type GoalCommand,
  type MessageFileDiffEntriesByTurn,
  type SessionChatStreamHandle,
} from '../ai-gui';
import { MessageSendStatusContext } from '../ai-gui/message-send-status-context';
import { format, formatDistanceToNow } from 'date-fns';
import type { Locale } from 'date-fns';
import { enUS, zhCN } from 'date-fns/locale';
import { getAppShareUrl } from '@/lib/app-location';

import { cn } from '@/lib/utils';
import { SessionArchivedBadge } from './session-archived-badge';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/ui/sheet';
import { Badge } from '@/ui/badge';
import { Input } from '@/ui/input';
import { Separator } from '@/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { useSessionDoc } from '@/hooks/use-session-doc';
import { useSessionActions } from '@/hooks/use-session-actions';
import { useMachineFlockAgentConfigsForMachineIds } from '@/hooks/use-machine-flock-agent-configs';
import { RenameSessionDialog, type RenameSessionDialogTarget } from './rename-session-dialog';
import { useResolvedTheme } from '../../theme-provider';
import { SessionInfoBar } from './session-info-bar';
import {
  canPauseGoalThroughPromptBridge,
  getPromptBridgeGoalCommands,
  GOAL_PROMPT_DISPATCH_OPTIONS,
  isSessionPromptBusy,
} from './session-goal-control';
import { resolveSessionMessageSubmitRoute } from './session-message-submit-route';
import {
  CAPACITY_RETRY_CONTINUATION_PROMPT,
  useCapacityAutoRetry,
} from './use-capacity-auto-retry';
import { PrLinkProvider } from '@/components/ai-gui/pr-link-context';
import { WorktreeIcon } from '@/components/icons/worktree-icon';
import {
  getSessionForkDestinationOptions,
  type SessionForkDestination,
  type SessionForkWorktreeAvailability,
} from './session-fork-destination-menu';
import { ConversationColumn } from '@/components/shared/conversation-column';
import { SessionRelationCard } from '@/components/shared/session-relation-card';
import {
  resolveOpenedByNavigationTarget,
  type SessionNavigationTarget,
} from '@/lib/session-navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import {
  isThoughtLevelSelector,
  type AcpConfigOptionValue,
  type AcpSelectConfigOptionSelector,
} from '@/components/shared/acp-selector-options';
import { useComposerCycleCommands } from '@/hooks/use-composer-cycle-commands';
import { useSessionAcpSelectorContext } from '@/hooks/use-session-acp-selector-context';
import {
  useAcpSessionConfigSelectionState,
  useResolvedAcpSessionConfigSelection,
} from '@/hooks/use-acp-session-config-selection';
import { ErrorBoundary } from '@/components/error-boundary';
import { MessageListErrorFallback } from './message-list-error-fallback';
import { FamiconsCloudOfflineOutline } from '@/components/icons/famicons-cloud-offline-outline';
import { NotificationPermissionPrompt } from './notification-permission-prompt';
import {
  FloatingPermissionRequest,
  hasPendingPermissionRequest,
} from './floating-permission-request';
import { SessionPin } from './session-pin';
import { SessionPinContext, type SessionPinContextValue } from './session-pin-context';
import { SessionSyncingIndicator } from './session-syncing-indicator';
import {
  SessionConversationPage,
  SessionConversationPageHeader,
} from './session-conversation-page';
import { localHomeDirAtom, localMachineIdAtom } from '@/atoms/local-probe';
import { sessionLivePresenceAtomFamily } from '@/atoms/presence';
import {
  resolveUnstartedTrailingDispatchAtMs,
  UNSTARTED_TRAILING_USER_TURN_TIMEOUT_MS,
} from '@/lib/session-dispatch-state';
import { shouldMarkSessionRead } from '@/lib/session-read-receipt';
import { recordSessionRenderTrace, shortTraceId } from '@/lib/session-render-trace';

import { extractIssuePRMentionsFromText } from '@/components/mentions/issue-pr-hash-mention';
import { SessionSearchProvider } from './session-search-context';
import {
  buildSessionSearchResults,
  normalizeSessionSearchQuery,
  type SessionSearchResult,
} from '@/lib/session-chat-search';
import { useIncrementalSearchBlocks } from '@/hooks/use-incremental-search-blocks';
import {
  useConversationTail,
  useConversationVersion,
  useTurn,
} from '@/hooks/use-conversation-view';
import { collectConversationConfigSources } from '@/lib/conversation-view';
import {
  latestGoalFromFacts,
  latestProposedPlanFromFacts,
  schedulingEntriesFromFacts,
  useSessionTurnFacts,
} from './session-turn-facts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog';
import { resolveSessionHtmlAttachmentAction } from './session-html-attachment-action';
import { collectPendingScheduledTasksFromHistory, type PendingScheduledTask } from '@molly/shared';
import { getSessionGitHubState } from '@/lib/session-github-state';
import {
  resolveMachineDotlodyPath,
  resolveSessionWorkspacePath,
} from '@/lib/session-workspace-path';
import { shouldShowCodexProposedPlanDecision } from '@/lib/codex-plan-decision';
import { buildExecutionTurnConfigOverrides } from '@/lib/execution-turn-config';
import { canShowSubscriptionRateLimits } from '@/lib/session-usage';
import { canShowCodexResetForecast } from '@/lib/codex-reset-forecast';

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

/**
 * Copy-as-Markdown never trims message text, so it can trim tool output, thinking,
 * or nothing at all — and it can still land over budget. Silent truncation reads as
 * "I copied everything", so the toast always names what happened.
 */
function describeCopiedConversation(
  stats: ConversationMarkdownStats,
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string
): string {
  if (stats.overBudget) {
    return t(
      'sessions.copyConversationHistoryCopiedOverBudget',
      'Conversation copied as Markdown (~{{tokens}}k tokens — message text alone exceeds the target)',
      { tokens: Math.round(stats.estimatedTokens / 1000) }
    );
  }

  const trimmed: string[] = [];
  if (stats.toolCallsCollapsed) {
    trimmed.push(t('sessions.copyConversationHistoryTrimToolCalls', 'tool call details'));
  }
  if (stats.thinkingOmitted) {
    trimmed.push(t('sessions.copyConversationHistoryTrimThinking', 'thinking'));
  }
  if (stats.terminalOutputOmitted || stats.terminalOutputTruncated) {
    trimmed.push(t('sessions.copyConversationHistoryTrimTerminal', 'terminal output'));
  }
  if (stats.toolResultsTruncated > 0) {
    trimmed.push(
      // `value`, not `count`: `count` would send i18next down its plural-key
      // lookup (`..._one` / `..._other`), which these strings do not define.
      t('sessions.copyConversationHistoryTrimToolResults', '{{value}} tool results', {
        value: stats.toolResultsTruncated,
      })
    );
  }

  if (trimmed.length === 0) {
    return t('sessions.copyConversationHistoryCopied', 'Conversation copied as Markdown');
  }
  return t(
    'sessions.copyConversationHistoryCopiedTrimmed',
    'Conversation copied as Markdown (trimmed: {{omitted}})',
    { omitted: trimmed.join(', ') }
  );
}

const EMPTY_ASSISTANT_QUICK_ACTIONS: AssistantMessageAction[] = [];
const DISPATCHING_TIMEOUT_MS = 15_000;
/** Grace before the header "Syncing" spinner appears (kills session-switch flicker). */
const TITLE_SYNCING_INDICATOR_DELAY_MS = 400;

/** Exact ⌘F / Ctrl+F — no Alt/Shift/secondary primary mod. See find keydown handler. */
const FIND_IN_CHAT_BINDING = parseBinding('$mod+f');

const formatSessionDate = (value?: string, localeObj?: Locale) => {
  if (!value) return '';
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return format(new Date(parsed), 'PPpp', { locale: localeObj });
};

const parseTimestamp = (value?: number | string | null): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return asNumber;
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
};

const STATUS_TONE_STYLES = {
  info: {
    text: 'text-primary',
    dot: 'bg-primary',
  },
  warn: {
    text: 'text-status-warning',
    dot: 'bg-status-warning',
  },
  success: {
    text: 'text-status-success',
    dot: 'bg-status-success',
  },
  error: {
    text: 'text-destructive',
    dot: 'bg-destructive',
  },
  neutral: {
    text: 'text-muted-foreground',
    dot: 'bg-muted-foreground',
  },
} as const;

type ToolCallMessage = Extract<MessageContent, { type: 'tool_call' }>;
type ToolKind = NonNullable<ToolCallMessage['kind']>;
type AgentActivity = 'thinking' | 'exploring' | 'writing' | 'imageGenerating';

const WRITING_TOOL_KINDS = new Set<ToolKind>(['edit', 'write', 'delete', 'move']);
const EXPLORING_TOOL_KINDS = new Set<ToolKind>([
  'read',
  'search',
  'fetch',
  'execute',
  'bash',
  'computer',
  'mcp',
]);
const THINKING_TOOL_KINDS = new Set<ToolKind>(['think', 'switch_mode', 'other']);

const isToolCallItem = (item: MessageContent): item is ToolCallMessage => item.type === 'tool_call';

const resolveActivityFromToolKind = (kind?: ToolKind | null): AgentActivity => {
  if (kind && WRITING_TOOL_KINDS.has(kind)) {
    return 'writing';
  }
  if (kind && EXPLORING_TOOL_KINDS.has(kind)) {
    return 'exploring';
  }
  if (kind && THINKING_TOOL_KINDS.has(kind)) {
    return 'thinking';
  }
  return 'thinking';
};

const resolveActivityFromItems = (items: MessageContent[]): AgentActivity => {
  let lastToolKind: ToolKind | null = null;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || !isToolCallItem(item)) {
      continue;
    }
    if (item.status === 'in_progress' || item.status === 'pending' || item.status === 'completed') {
      return resolveActivityFromToolKind(item.kind ?? null);
    }
    if (lastToolKind == null && item.kind) {
      lastToolKind = item.kind;
    }
  }
  return resolveActivityFromToolKind(lastToolKind);
};

const resolveActivityFromHistory = (history?: readonly SessionHistory[]): AgentActivity => {
  if (!history?.length) {
    return 'thinking';
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry?.role !== 'assistant') {
      continue;
    }
    const items = Array.isArray(entry.items) ? (entry.items as unknown as MessageContent[]) : [];
    return resolveActivityFromItems(items);
  }
  return 'thinking';
};

const resolveActivityFromSessionStatus = (
  status: SessionStatus | undefined
): AgentActivity | null => {
  if (status?.type === 'running' && status.activity === 'image_generation') {
    return 'imageGenerating';
  }
  return null;
};

const resolveToneByStatus = (status: SessionStatus['type']) => {
  switch (status) {
    case 'running':
      return 'info';
    case 'initializing':
      return 'info';
    case 'requestPermission':
      return 'warn';
    case 'idle':
      return 'neutral';
  }
  return 'neutral';
};

interface SessionHistoryButtonProps {
  sessions: SessionMeta[];
  activeSessionId: SessionId;
  onSelectSession?: (sessionId: SessionId) => void;
  compact?: boolean;
}

export function SessionHistoryButton({
  sessions,
  activeSessionId,
  onSelectSession,
  compact = false,
}: SessionHistoryButtonProps) {
  const { t, i18n } = useTranslation();

  const [open, setOpen] = useState(false);
  const localeObj = i18n.language?.startsWith('zh') ? zhCN : enUS;
  const defaultSessionTitle = t('sessions.untitled', 'Untitled session');

  const historySessions = useMemo(() => {
    const map = new Map<SessionId, SessionMeta>();
    sessions.forEach((session) => {
      map.set(session.id, session);
    });
    return Array.from(map.values()).sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [sessions]);

  const handleSelect = useCallback(
    (sessionId: SessionId) => {
      if (sessionId === activeSessionId) {
        setOpen(false);
        return;
      }
      onSelectSession?.(sessionId);
      setOpen(false);
    },
    [activeSessionId, onSelectSession]
  );

  const trigger = (
    <Button
      variant={compact ? 'ghost' : 'outline'}
      size={compact ? 'icon' : 'sm'}
      className={cn('shrink-0', compact ? 'h-8 w-8' : '')}
      disabled={historySessions.length === 0}
    >
      <History className={cn('h-4 w-4', compact ? '' : 'mr-2')} />
      {!compact && <span>{t('sessions.history', 'History')}</span>}
    </Button>
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side={'right'} className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('sessions.history', 'History')}</SheetTitle>
          <p className="text-sm text-muted-foreground">{t('sessions.newSession.title')}</p>
        </SheetHeader>
        <div className="mt-6 space-y-2">
          {historySessions.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t('sessions.noSessions')}</div>
          ) : (
            historySessions.map((session) => {
              const sessionTitle = (session.title ?? '').trim() || defaultSessionTitle;
              const createdAtLabel = (() => {
                const parsed = Date.parse(session.createdAt);
                if (Number.isNaN(parsed)) return session.createdAt;
                return formatDistanceToNow(parsed, {
                  addSuffix: true,
                  locale: localeObj,
                });
              })();
              const tone = resolveToneByStatus(session.status?.type ?? 'running');
              const statusLabel = t(
                `sessions.status.${session.status?.type ?? 'running'}` as const
              );
              const isActive = session.id === activeSessionId;

              return (
                <button
                  key={session.id}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted',
                    isActive && 'border-border/70 bg-selection text-selection-foreground'
                  )}
                  onClick={() => handleSelect(session.id as SessionId)}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        'mt-1 h-2.5 w-2.5 rounded-full',
                        STATUS_TONE_STYLES[tone ?? 'info'].dot
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium">{sessionTitle}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{createdAtLabel}</span>
                        <span className="h-1 w-1 rounded-full bg-border" />
                        <span className="truncate">{statusLabel}</span>
                      </div>
                    </div>
                    {isActive && (
                      <Badge variant="secondary">{t('common.current', 'Current')}</Badge>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Compact project/repo + branch info for the session header */
export function SessionProjectInfo({
  session,
  isLoading,
  isSyncing,
  isMachineOffline,
  t,
  localProjectMeta,
}: {
  session: SessionMeta;
  isLoading?: boolean;
  isSyncing?: boolean;
  isMachineOffline?: boolean;
  t: (key: string, fallback: string) => string;
  localProjectMeta?: { name?: string; rootPath?: string } | null;
}) {
  const project = session.project as
    | { kind: 'github'; repoFullName?: string; branch?: string }
    | { kind: 'local'; localProjectId?: string; branch?: string; githubRepoFullName?: string }
    | undefined;
  const repoFullName = (resolveProjectGitHubRepo(project) ?? session.repoFullName)?.trim() ?? '';
  const branch =
    session.branchName?.trim() || getProjectRefBranch(project) || session.baseBranch?.trim() || '';
  const isGitHub = project?.kind === 'github' || !!repoFullName;
  const projectLabel = repoFullName || '';
  // Local projects: resolve name/path from machine metadata
  const localProjectName = localProjectMeta?.name ?? '';

  const hasProjectInfo = !!(projectLabel || localProjectName || branch);

  if (!hasProjectInfo) {
    return (
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-sm leading-tight">
          <span className="inline-flex shrink-0 items-center text-muted-foreground">
            <MessageCircle className="h-3.5 w-3.5" />
          </span>
          <span className="truncate font-medium">{t('sessions.chat', 'Chat')}</span>
          {isLoading && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              {t('common.loading', 'Loading')}
            </span>
          )}
          {isSyncing && <SessionSyncingIndicator />}
          {isMachineOffline && (
            <span
              className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
              title={t('sessions.machineOffline', 'Machine is offline')}
            >
              <FamiconsCloudOfflineOutline className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5 text-sm leading-tight">
        {(projectLabel || localProjectName) && (
          <span className="inline-flex shrink-0 items-center text-muted-foreground">
            {isGitHub ? <Github className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
          </span>
        )}
        <span className="truncate font-medium">{projectLabel || localProjectName || ''}</span>
        {isLoading && (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {t('common.loading', 'Loading')}
          </span>
        )}
        {isSyncing && <SessionSyncingIndicator />}
        {isMachineOffline && (
          <span
            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
            title={t('sessions.machineOffline', 'Machine is offline')}
          >
            <FamiconsCloudOfflineOutline className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Navigation across the presentation-only "opened by" relationship (see
 * `lib/session-opened-by-tree.ts`). Both directions live here so an
 * MCP-opened independent Session can walk back to the Session that created it,
 * and an opener can reach every Session it opened, from inside the
 * conversation — not only from the sidebar tree.
 */
export type SessionOpenedByMenuState = {
  /** The Session that created this one, when it is still resolvable. */
  openedBy?: { sessionId: SessionId; title: string; target: SessionNavigationTarget } | null;
  /** Independent Sessions this Session opened, oldest first. */
  opened?: Array<{ sessionId: SessionId; title: string; target: SessionNavigationTarget }>;
  onOpenSession: (target: SessionNavigationTarget) => void;
};

/** Session header "···" menu — local context and session actions. */
export function SessionHeaderMenu({
  session,
  workspacePath,
  onCopyConversationHistory,
  onCopyUrl,
  onShareAsImage,
  onOpenSearch,
  onFork,
  onContinueWithMolly,
  isForking = false,
  forkWorktreeAvailability = 'hidden',
  onForkMenuOpen,
  onRename,
  openedByRelations,
  onArchive,
  onRestore,
  onDelete,
  t,
}: {
  session: SessionMeta;
  workspacePath?: string | null;
  onCopyConversationHistory?: () => void | Promise<void>;
  onCopyUrl: () => void | Promise<void>;
  /** Opens the share-as-image preview dialog. Pure local feature; no gating. */
  onShareAsImage?: () => void;
  onOpenSearch?: () => void | Promise<void>;
  onFork?: (destination?: SessionForkDestination) => void | Promise<void>;
  onContinueWithMolly?: () => void;
  isForking?: boolean;
  forkWorktreeAvailability?: SessionForkWorktreeAvailability;
  onForkMenuOpen?: () => void;
  onRename?: () => void | Promise<void>;
  onOpenReviewSettings?: () => void;
  /** Omitted when this Session neither opened nor was opened by another. */
  openedByRelations?: SessionOpenedByMenuState;
  onArchive?: () => void | Promise<void>;
  onRestore?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  t: (key: string, fallback: string, options?: Record<string, unknown>) => string;
}) {
  const isArchived = !!session.isArchived;
  const project = session.project as
    | { kind: 'github'; repoFullName?: string; branch?: string }
    | { kind: 'local'; localProjectId?: string; branch?: string; githubRepoFullName?: string }
    | undefined;
  const baseBranch = session.baseBranch?.trim() || getProjectRefBranch(project) || '';
  const currentBranch = session.branchName?.trim() || '';
  const trimmedWorkspacePath = workspacePath?.trim() || '';
  const showBaseBranchContext = Boolean(
    currentBranch && baseBranch && currentBranch !== baseBranch
  );

  const openedBySession = openedByRelations?.openedBy ?? null;
  const openedSessions = openedByRelations?.opened ?? [];
  const openedByRelationRows =
    openedByRelations && (openedBySession || openedSessions.length > 0) ? (
      <>
        {openedBySession ? (
          <DropdownMenuItem
            onClick={() => {
              openedByRelations.onOpenSession(openedBySession.target);
            }}
            title={openedBySession.title}
          >
            <CornerLeftUp className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {t('sessions.openedBy.openOpener', 'Opened by')}: {openedBySession.title}
            </span>
          </DropdownMenuItem>
        ) : null}
        {openedSessions.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <GitBranchPlus className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {t('sessions.openedBy.openedSessions', 'Opened sessions')} ({openedSessions.length})
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 min-w-[200px] max-w-[280px] overflow-y-auto">
              {openedSessions.map((opened) => (
                <DropdownMenuItem
                  key={opened.sessionId}
                  onClick={() => {
                    openedByRelations.onOpenSession(opened.target);
                  }}
                  title={opened.title}
                >
                  <span className="min-w-0 flex-1 truncate">{opened.title}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuSeparator />
      </>
    ) : null;

  const copyToClipboard = useCallback(
    // successMessage names what was copied in a full sentence (e.g. "Base
    // branch name copied to clipboard") — no raw value echo, which reads
    // noisy for long paths/URLs.
    (text: string, successMessage: string) => {
      void navigator.clipboard
        .writeText(text)
        .then(() => toast.success(successMessage))
        .catch(() => toast.error(t('sessions.copyFailed', 'Unable to copy')));
    },
    [t]
  );

  const [chatPanelBoundary, setChatPanelBoundary] = useState<HTMLElement | null>(null);
  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) onForkMenuOpen?.();
          if (open) {
            // The Copy submenu trigger sits at the chat panel's right edge, and
            // Radix submenus always open right (their side is not configurable).
            // Without a boundary the submenu reaches into the design-canvas host,
            // whose overlay gate then blanks the whole native canvas for the
            // overlap sliver. Bound collisions to the chat panel so the submenu
            // flips left instead; Radix falls back to the viewport when the
            // panel can't host it.
            setChatPanelBoundary(document.querySelector('[data-panel-id="chat"]'));
          }
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            aria-label={t('sessions.moreActions', 'More actions')}
          >
            <Ellipsis className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[200px] max-w-[320px]">
          {openedByRelationRows}

          {onOpenSearch && (
            <DropdownMenuItem
              onClick={() => {
                void onOpenSearch();
              }}
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              {t('sessions.findInConversation', 'Find in conversation')}
            </DropdownMenuItem>
          )}

          {onFork && !isArchived && forkWorktreeAvailability !== 'hidden' ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={isForking}>
                {isForking ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : (
                  <GitFork className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {t('sessions.forkSession', 'Fork session')}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[16rem]">
                {getSessionForkDestinationOptions(t, forkWorktreeAvailability).map((option) => (
                  <DropdownMenuItem
                    key={option.id}
                    disabled={option.disabled || isForking}
                    className="items-start py-1.5"
                    onSelect={() => {
                      void onFork(option.id);
                    }}
                  >
                    {option.id === 'new-worktree' ? (
                      <WorktreeIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Folder className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="leading-tight">{option.label}</span>
                      <span className="text-xs font-normal leading-snug text-muted-foreground">
                        {option.hint}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : onFork && !isArchived ? (
            <DropdownMenuItem
              disabled={isForking}
              onClick={() => {
                if (!isForking) {
                  void onFork('shared');
                }
              }}
            >
              {isForking ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <GitFork className="h-3.5 w-3.5 shrink-0" />
              )}
              {t('sessions.forkSession', 'Fork session')}
            </DropdownMenuItem>
          ) : null}

          {onContinueWithMolly ? (
            <DropdownMenuItem onClick={onContinueWithMolly}>
              {t('design.continuation.title', 'Continue this design with Molly')}
            </DropdownMenuItem>
          ) : null}
          {onRename && !isArchived && (
            <DropdownMenuItem
              onClick={() => {
                void onRename();
              }}
            >
              <Pencil className="h-3.5 w-3.5 shrink-0" />
              {t('sidebar.renameChat.title', 'Rename conversation')}
            </DropdownMenuItem>
          )}

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Copy className="h-3.5 w-3.5 shrink-0" />
              {t('sessions.copy', 'Copy')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              className="min-w-[200px]"
              collisionBoundary={chatPanelBoundary ?? undefined}
            >
              {showBaseBranchContext ? (
                <>
                  <DropdownMenuItem
                    onClick={() =>
                      copyToClipboard(
                        baseBranch,
                        t('sessions.baseBranchCopied', 'Base branch name copied to clipboard')
                      )
                    }
                    title={baseBranch}
                  >
                    <GitBranch className="h-3.5 w-3.5 shrink-0" />
                    {t('sessions.copyBaseBranch', 'Copy base branch')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem
                onClick={() =>
                  copyToClipboard(
                    trimmedWorkspacePath,
                    t('sessions.workspacePathCopied', 'Session workspace path copied to clipboard')
                  )
                }
                disabled={!trimmedWorkspacePath}
                title={
                  trimmedWorkspacePath ||
                  t('sessions.copyPathUnavailable', 'Workspace path unavailable')
                }
              >
                <Copy className="h-3.5 w-3.5 shrink-0" />
                {t('sessions.copyPath', 'Copy path')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void onCopyConversationHistory?.();
                }}
                disabled={!onCopyConversationHistory}
                title={
                  onCopyConversationHistory
                    ? undefined
                    : t(
                        'sessions.copyConversationHistoryUnavailable',
                        'Conversation history is unavailable for this tab'
                      )
                }
              >
                <Copy className="h-3.5 w-3.5 shrink-0" />
                {t('sessions.copyAsMarkdown', 'Copy as Markdown')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void onCopyUrl();
                }}
              >
                <Copy className="h-3.5 w-3.5 shrink-0" />
                {t('sessions.copyUrl', 'Copy URL')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuItem
            disabled={!onShareAsImage}
            onClick={() => {
              onShareAsImage?.();
            }}
          >
            <Image className="h-3.5 w-3.5 shrink-0" />
            {t('sessions.shareAsImage', 'Share as image…')}
          </DropdownMenuItem>

          {/* Archive / Restore + Delete */}
          {isArchived
            ? (onRestore || onDelete) && (
                <>
                  <DropdownMenuSeparator />
                  {onRestore && (
                    <DropdownMenuItem
                      onClick={() => {
                        void onRestore();
                      }}
                    >
                      <ArchiveRestore className="h-3.5 w-3.5 shrink-0" />
                      {t('archive.restore', 'Restore session')}
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <DropdownMenuItem
                      onClick={() => {
                        void onDelete();
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5 shrink-0" />
                      {t('archive.delete', 'Delete permanently')}
                    </DropdownMenuItem>
                  )}
                </>
              )
            : onArchive && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      void onArchive();
                    }}
                  >
                    <Archive className="h-3.5 w-3.5 shrink-0" />
                    {t('sessions.archive', 'Archive session')}
                  </DropdownMenuItem>
                </>
              )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function SessionSearchBar({
  query,
  currentIndex,
  totalCount,
  inputRef,
  onQueryChange,
  onPrevious,
  onNext,
  onClose,
  t,
}: {
  query: string;
  currentIndex: number;
  totalCount: number;
  inputRef: { current: HTMLInputElement | null };
  onQueryChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  t: (key: string, fallback: string, vars?: Record<string, unknown>) => string;
}) {
  const hasQuery = query.length > 0;
  const hasResults = totalCount > 0;
  const noResults = hasQuery && !hasResults;

  const countLabel = hasResults
    ? t('sessions.searchResultPosition', '{{current}} / {{total}}', {
        current: currentIndex + 1,
        total: totalCount,
      })
    : hasQuery
      ? t('sessions.searchNoResults', 'No results')
      : '';

  const renderNavButton = (
    Icon: typeof ArrowUp,
    label: string,
    shortcut: string,
    onClick: () => void
  ) => {
    const button = (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground disabled:pointer-events-none disabled:text-muted-foreground/40"
        disabled={!hasResults}
        onClick={onClick}
        aria-label={label}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
      </Button>
    );
    if (!hasResults) return button;
    return (
      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-1.5 px-2 py-1 text-[11px]">
          <span>{label}</span>
          <span className="rounded-sm border border-border/70 bg-muted px-1 font-mono text-[10px] leading-none text-muted-foreground">
            {shortcut}
          </span>
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-20 w-[min(440px,calc(100%-1.5rem))] sm:right-4 sm:top-4 sm:w-[min(440px,calc(100%-2rem))]">
      <div
        role="search"
        className={cn(
          'group/search flex h-11 items-center gap-1 rounded-full border bg-background/95 pl-3.5 pr-1.5 shadow-[0_14px_40px_-18px_rgba(15,23,42,0.45),0_2px_10px_-4px_rgba(15,23,42,0.16)] backdrop-blur-md transition-colors supports-[backdrop-filter]:bg-background/85',
          'border-border focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20',
          noResults &&
            'border-destructive/30 focus-within:border-destructive/60 focus-within:ring-destructive/15'
        )}
      >
        <Search
          className={cn(
            'h-4 w-4 shrink-0 transition-colors',
            hasQuery ? 'text-foreground' : 'text-muted-foreground/80',
            noResults && 'text-destructive/80'
          )}
          strokeWidth={2.25}
        />
        <Input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t('sessions.findInConversation', 'Find in conversation')}
          aria-label={t('sessions.findInConversation', 'Find in conversation')}
          className="h-9 min-w-0 flex-1 border-0 bg-transparent px-2 py-0 text-[13.5px] tracking-tight shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0 [&::-webkit-search-cancel-button]:hidden"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (event.shiftKey) {
                onPrevious();
              } else {
                onNext();
              }
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              if (query) {
                onQueryChange('');
                return;
              }
              onClose();
            }
          }}
        />

        {hasQuery && (
          <span
            className={cn(
              'shrink-0 select-none px-1 text-[11.5px] font-medium tabular-nums tracking-tight transition-colors',
              hasResults ? 'text-muted-foreground' : 'text-destructive/90'
            )}
            aria-live="polite"
          >
            {countLabel}
          </span>
        )}

        <Separator orientation="vertical" className="mx-0.5 h-5 bg-border/60" />

        <div className="flex items-center gap-px">
          {renderNavButton(
            ArrowUp,
            t('sessions.previousResult', 'Previous result'),
            '⇧↵',
            onPrevious
          )}
          {renderNavButton(ArrowDown, t('sessions.nextResult', 'Next result'), '↵', onNext)}
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                onClick={onClose}
                aria-label={t('common.close', 'Close')}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.25} />
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="flex items-center gap-1.5 px-2 py-1 text-[11px]"
            >
              <span>{t('common.close', 'Close')}</span>
              <span className="rounded-sm border border-border/70 bg-muted px-1 font-mono text-[10px] leading-none text-muted-foreground">
                Esc
              </span>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

interface SessionChatInterfaceProps {
  claimNavigationFocus?: () => boolean;
  session: SessionMeta;
  workspaceSession?: SessionMeta | null;
  className?: string;
  hideHeader?: boolean;
  onFileDiffClick?: (turnId: string, filePath: string) => void;
  onFilePathClick?: (filePath: string) => void;
  /** Opens an agent-uploaded HTML source path directly in rendered file preview. */
  onOpenHtmlFile?: (filePath: string) => void;
  messageFileDiffEntriesByTurn?: MessageFileDiffEntriesByTurn;
  /** Optional replacement for the GitHub badge area in the header. */
  headerActionsSlot?: React.ReactNode;
  /** Optional action rendered after the session menu at the far right of the header. */
  headerEndSlot?: React.ReactNode;
  /** Optional action rendered before the session title at the far left of the header. */
  headerStartSlot?: React.ReactNode;
  /** Optional override for split header/message layouts where another surface owns doc sync. */
  titleSyncing?: boolean;
  /** Content rendered between the header and message area (e.g. tab bar) */
  subHeader?: React.ReactNode;
  /** When true, hide the message area and input but keep the header and subHeader visible */
  hideMessageArea?: boolean;
  /** When false, keep the local doc mounted without holding the remote room subscription. */
  syncEnabled?: boolean;
  /**
   * Whether this mounted surface is actually on screen. Session tabs and side
   * chats stay mounted while hidden, so the read receipt must be gated on real
   * visibility: otherwise opening a parent session marks every one of its
   * sub-sessions read without the user ever seeing them.
   */
  isVisible?: boolean;
  /** External imported history is refreshing; input remains editable but sending is blocked. */
  isExternalHistoryRefreshing?: boolean;
  /** Display label for the external history provider currently refreshing. */
  externalHistoryProviderLabel?: string;
  /** Called when a comment reference chip is clicked to navigate to the comment in diff */
  onNavigateToComment?: (reference: CommentReferencePayload) => void;
  /** Called whenever comment references attached to the input change. */
  onCommentReferencesChange?: (references: CommentReferencePayload[]) => void;
  /** Called whenever visual annotation references attached to the input change. */
  onVisualAnnotationReferencesChange?: (references: VisualAnnotationReferencePayload[]) => void;
  /** Called after a send containing visual annotation references is accepted. */
  onVisualAnnotationReferencesSubmitted?: (
    references: VisualAnnotationReferencePayload[]
  ) => void | Promise<void>;
  /** Called to archive the current session */
  onArchiveSession?: () => void | Promise<void>;
  /** Called to restore the current session when it is archived */
  onRestoreSession?: () => void | Promise<void>;
  /** Called to permanently delete the current session when it is archived */
  onDeleteSession?: () => void | Promise<void>;
  /** External callback for opening search (used when header and message area are split) */
  onOpenSearch?: () => void | Promise<void>;
  /** External callback for copying conversation history (used when header and message area are split) */
  onCopyConversationHistory?: () => void | Promise<void>;
  /** External rename request for split header/message layouts. */
  onRequestRename?: () => void | Promise<void>;
  /** External latest-assistant fork callback for split header/message layouts. */
  onForkSession?: (destination?: SessionForkDestination) => void | Promise<void>;
  /** Opens the parent-owned share-as-image preview dialog. */
  onShareAsImage?: () => void;
  /** Called when the user clicks the PR badge and wants to open the in-app PR tab. */
  onOpenPrTab?: (args: { prNumber: number; repoFullName: string; headCommitSha?: string }) => void;
  /** Session associated with the header Browser button. Defaults to `session`. */
  browserActionSession?: SessionMeta | null;
  /** Called when the user wants to open the Browser panel. */
  onOpenBrowser?: () => void;
  /**
   * Reveals this session's design canvas (its side-panel tab), owned by the
   * parent layout.
   */
  onRevealDesignPanel?: () => void;
  /** Opens Browser without forcing a newly reported candidate navigation. */
  onOpenExistingBrowser?: () => void;
  /**
   * 'page' renders the classic full header row. 'toolbar' (desktop
   * `hideMessageArea` instance) renders ONLY the compact right-side controls
   * (IDE launcher / browser / "…" menu / end slot) so session-detail can embed
   * them in the tab row — no title, no PR badge (the context strip owns PR).
   */
  headerVariant?: 'page' | 'toolbar';
  /**
   * When false, this surface still accepts a session-mention drop but does not
   * paint the page mask. Used under `SessionMentionDropLayer`, which owns one
   * overlay for the whole keep-alive tab stack.
   */
  paintSessionMentionOverlay?: boolean;
  /** All-Changes totals for the context strip; null/undefined hides the diffstat. */
  /** Called when the context strip's diffstat is clicked. */
  /** Native ACP fork action for the latest completed assistant turn. */
  onForkLastAssistant?: (turnId: string, destination?: SessionForkDestination) => void;
  forkWorktreeAvailability?: SessionForkWorktreeAvailability;
  onForkWorktreeMenuOpen?: () => void;
  forkingAssistantMessageId?: string | null;
  /** Opens another session from an in-conversation link (e.g. a fork's origin). */
  onNavigateSession?: (target: SessionNavigationTarget) => void;
  /** Signals when this mounted conversation surface has loaded durable history. */
  onConversationPrepared?: () => void;
  /** Signals a terminal failure while preparing this conversation surface. */
  onConversationPrepareError?: () => void;
}

function SpinningLoaderIcon({ className }: { className?: string }) {
  return <Loader2 className={cn(className, 'animate-spin')} />;
}

const EMPTY_CHAT_STREAM_EMPTY_STATE = <></>;

export type SessionChatInterfaceHandle = {
  focusInput: () => void;
  addCommentReference: (reference: CommentReferencePayload) => boolean;
  toggleCommentReference: (reference: CommentReferencePayload) => boolean;
  addVisualAnnotationReference: (reference: VisualAnnotationReferencePayload) => boolean;
  toggleVisualAnnotationReference: (reference: VisualAnnotationReferencePayload) => boolean;
  copyConversationHistory: () => Promise<void>;
  /** Plain-text conversation snapshot for the share-as-image card; null while
   * durable history has not loaded. */
  getShareImageData: () => Promise<{ messages: ConversationMessage[]; agentName?: string } | null>;
  startShareImageSelection: (
    messages: ConversationMessage[],
    onConfirm: (messages: ConversationMessage[]) => void
  ) => void;
  openSearch: () => void;
  getLastAssistantTurnId: () => string | null;
  referenceDesignSelection: (
    reference: DesignElementReference,
    label: string,
    prompt?: string
  ) => boolean;
  syncDesignSelection: (reference: DesignElementReference | null, label: string) => boolean;
  insertSessionMention: (sessionId: string) => boolean;
};

export type DispatchInputBlocksOptions = {
  forceQueue?: boolean;
  forceDirect?: boolean;
  modeIdOverride?: string | null;
  modelIdOverride?: string | null;
  configOptionValuesOverride?: Record<string, AcpConfigOptionValue>;
};

function buildEditedMessageQueueItem(
  item: MessageQueueItem,
  task: string,
  imageOnlyLabel: string
): MessageQueueItem {
  const nextTask = task.trim();
  const inputBlocks = normalizeSessionInputBlocks(
    item.acpSessionConfig?.inputBlocks,
    item.acpSessionConfig?.prompt ?? item.task
  );
  const nonTextInputBlocks: SessionInputBlock[] = inputBlocks.filter(
    (block) => block.type !== 'text'
  );
  const nextInputBlocks: SessionInputBlock[] = nextTask
    ? [{ type: 'text', text: nextTask }, ...nonTextInputBlocks]
    : nonTextInputBlocks;

  if (!item.acpSessionConfig) {
    return {
      ...item,
      task: nextTask || imageOnlyLabel,
      isEditing: false,
      editingStartedAt: undefined,
    };
  }

  return {
    ...item,
    task: nextTask || imageOnlyLabel,
    isEditing: false,
    editingStartedAt: undefined,
    acpSessionConfig: {
      ...item.acpSessionConfig,
      prompt: nextTask,
      inputBlocks: nextInputBlocks.length > 0 ? nextInputBlocks : undefined,
    },
  };
}

/**
 * Session chat interface component
 * Only loads the active session document; allows switching history from the header.
 */
export const SessionChatInterface = memo(
  forwardRef<SessionChatInterfaceHandle, SessionChatInterfaceProps>(function SessionChatInterface(
    {
      session,
      workspaceSession,
      className,
      hideHeader = false,
      onFileDiffClick,
      onFilePathClick,
      onOpenHtmlFile,
      messageFileDiffEntriesByTurn,
      headerActionsSlot,
      headerEndSlot,
      headerStartSlot,
      titleSyncing,
      subHeader,
      hideMessageArea = false,
      syncEnabled = !hideMessageArea,
      isVisible = true,
      claimNavigationFocus,
      isExternalHistoryRefreshing = false,
      externalHistoryProviderLabel,
      onNavigateToComment,
      onCommentReferencesChange,
      onVisualAnnotationReferencesChange,
      onVisualAnnotationReferencesSubmitted,
      onArchiveSession,
      onRestoreSession,
      onDeleteSession,
      onOpenSearch: onOpenSearchExternal,
      onCopyConversationHistory: onCopyConversationHistoryExternal,
      onRequestRename,
      onForkSession: onForkSessionExternal,
      onShareAsImage,
      browserActionSession,
      onOpenBrowser,
      onOpenExistingBrowser,
      onRevealDesignPanel,
      headerVariant = 'page',
      paintSessionMentionOverlay = true,
      onForkLastAssistant,
      forkWorktreeAvailability = 'hidden',
      onForkWorktreeMenuOpen,
      forkingAssistantMessageId,
      onNavigateSession,
      onConversationPrepared,
      onConversationPrepareError,
    },
    ref
  ) {
    /* Mount/unmount into the crash-report render trace. The 0.89.x #185 crash
       ends in this component's mount layout effects — a LAYOUT effect (passive
       ones may never flush inside the crashing cascade) is what proves whether
       the loop is remounting this surface or lives elsewhere. */
    useLayoutEffect(() => {
      recordSessionRenderTrace(`surface mount ${shortTraceId(session.id)}`);
      return () => {
        recordSessionRenderTrace(`surface unmount ${shortTraceId(session.id)}`);
      };
    }, [session.id]);
    const { t, i18n } = useTranslation();

    const isElectronFullscreen = useElectronFullscreen();
    const resolvedTheme = useResolvedTheme();
    const isDark = resolvedTheme === 'dark';
    const localeObj = i18n.language?.startsWith('zh') ? zhCN : enUS;
    const workspaceId = useAtomValue(currentWorkspaceIdAtom);
    const currentUser = useAtomValue(userAtom);
    const { openSettings } = useOpenSettings();
    const conversationFontSize = useAtomValue(conversationFontSizeAtom);

    const localMachineId = useAtomValue(localMachineIdAtom);
    const localHomeDir = useAtomValue(localHomeDirAtom);
    const liveSessionPresence = useAtomValue(sessionLivePresenceAtomFamily(session.id));
    const liveSessionStatus = liveSessionPresence?.status ?? null;
    const isLocalSession = !!localMachineId && session.machineId === localMachineId;
    const [pendingRemoteHtmlFileName, setPendingRemoteHtmlFileName] = useState<string | null>(null);
    const {
      doc: sessionDoc,
      history: conversationView,
      addHistory: addSessionHistory,
      pushMessageQueue,
      removeMessageQueueItem,
      updateMessageQueueItem,
      reorderMessageQueueItem,
      updateHistoryEntry,
      waitUntilSynced,
      ready: sessionDocReady,
      synced: sessionDocSynced,
      syncState: sessionDocSyncState,
    } = useSessionDoc(session.id, {
      enabled: !hideMessageArea,
      syncEnabled: !hideMessageArea && syncEnabled,
    });
    const conversationVersion = useConversationVersion(conversationView);
    const { turns: sessionTailHistory, from: sessionTailFrom } = useConversationTail(
      conversationView,
      { extendToLastUserTurn: true }
    );
    const conversationConfigSources = useMemo(() => {
      void conversationVersion; // The stable view object invalidates its projections by version.
      return conversationView
        ? collectConversationConfigSources(conversationView, sessionTailFrom)
        : [];
    }, [conversationVersion, conversationView, sessionTailFrom]);
    const sessionConversationConfig = useMemo(
      () =>
        resolveSessionConversationConfig(
          conversationConfigSources,
          sessionDoc?.mq ?? [],
          session.design
            ? {
                agentConfigId: session.agentConfigId,
                legacyAgentConfigId: session.acpSessionAgentConfigId,
              }
            : undefined
        ),
      [
        conversationConfigSources,
        sessionDoc?.mq,
        session.design,
        session.agentConfigId,
        session.acpSessionAgentConfigId,
      ]
    );
    const sessionRuntimeConfig = useMemo(
      () =>
        session.design &&
        (session.acpSessionAgentConfigId !== session.agentConfigId ||
          sessionDoc?.acpRuntimeConfig?.acpSessionId !== session.acpSessionId)
          ? null
          : resolveSessionAcpRuntimeConfig(
              sessionTailHistory,
              sessionDoc?.mq ?? [],
              sessionDoc?.acpRuntimeConfig
            ),
      [
        sessionDoc?.acpRuntimeConfig,
        sessionTailHistory,
        sessionDoc?.mq,
        session.design,
        session.acpSessionAgentConfigId,
        session.agentConfigId,
        session.acpSessionId,
      ]
    );
    // `sourceConfigKey` identifies the durable turn selected by the resolver,
    // so there is no need to hash its mode/model/option values separately.
    const sessionConversationConfigRevision = `${session.id}:${
      sessionConversationConfig.sourceConfigKey ?? ''
    }`;
    const sessionConfigPreferences = useMemo(
      () => ({
        modeId: sessionConversationConfig.modeId,
        modelId: sessionConversationConfig.modelId,
        configOptionValues: sessionConversationConfig.configOptionValues,
      }),
      [
        sessionConversationConfig.configOptionValues,
        sessionConversationConfig.modeId,
        sessionConversationConfig.modelId,
      ]
    );
    /* No effects here: user edits are the only stored selection state and the
       effective values derive per render. The UNVALIDATED candidates feed the
       capability lookup so the catalog can depend on the selection (Codex
       reasoning tiers, provisional menu enrichment) without feeding back into
       the values it validates — the #185 reconcile loop is unrepresentable. */
    const {
      selection: sessionConfigSelection,
      candidates: sessionConfigCandidates,
      selectMode: handleModeChange,
      selectModel: handleModelChange,
      selectConfigOption: handleConfigOptionChange,
    } = useAcpSessionConfigSelectionState({
      enabled: !hideMessageArea && sessionDocReady,
      targetKey: `${session.id}:${session.cliType}:${session.agentType}:${session.design ? session.agentConfigId : ''}`,
      preferenceRevision: sessionConversationConfigRevision,
      preferences: sessionConfigPreferences,
      runtimePreferences: sessionRuntimeConfig,
      preserveUnsentUserEdits: true,
    });
    const {
      availableCommands,
      capabilityAuthority,
      configOptionSelectors,
      defaultModeId,
      defaultModelId,
      machineFlockRows,
      modeOptions,
      modelOptions,
      modelReasoningEfforts,
      sessionMachine,
    } = useSessionAcpSelectorContext({
      machineId: session.machineId,
      configId: session.agentConfigId,
      cliType: session.cliType,
      agentType: session.agentType,
      selectedModeId: sessionConfigCandidates.modeId,
      selectedModelId: sessionConfigCandidates.modelId,
      configOptionValues: sessionConfigCandidates.configOptionValues,
    });
    const sessionSelectorOptions = useMemo(
      () => ({
        capabilityAuthority,
        configOptionSelectors,
        defaultModeId,
        defaultModelId,
        modeOptions,
        modelOptions,
        modelReasoningEfforts,
      }),
      [
        capabilityAuthority,
        configOptionSelectors,
        defaultModeId,
        defaultModelId,
        modeOptions,
        modelOptions,
        modelReasoningEfforts,
      ]
    );
    const { selectedModeId, selectedModelId, configOptionValues } =
      useResolvedAcpSessionConfigSelection(sessionConfigSelection, sessionSelectorOptions, {
        cliType: session.cliType,
        agentType: session.agentType,
      });
    useMachineFlockAgentConfigsForMachineIds([session.machineId]);
    const machineDotlodyPath = useMemo(
      () => resolveMachineDotlodyPath(machineFlockRows, isLocalSession ? localHomeDir : null),
      [isLocalSession, localHomeDir, machineFlockRows]
    );
    const sessionMachineLocalProjects = useMemo(
      () => ({
        ...(sessionMachine?.localProjects ?? {}),
        ...getMachineFlockLocalProjects(machineFlockRows),
      }),
      [machineFlockRows, sessionMachine?.localProjects]
    );
    // Two distinct machine states, previously conflated:
    // - removed: machine meta no longer exists (deleted from the workspace).
    //   Blocks sending. Gated on doc-meta cache readiness so a cold start
    //   never mistakes "meta not loaded yet" for "machine gone".
    // - offline: presence heartbeat missing. Informational only — the turn is
    //   written durably and runs when the machine reconnects.
    const docMetaCacheReady = useAtomValue(docMetaCacheReadyAtom);
    const isMachineRemoved = !sessionMachine && docMetaCacheReady;
    const sessionMachineOnlineStatus = useMachineOnlineStatus(session.machineId);
    const browserOnline = useAtomValue(browserOnlineAtom);
    const externalHistorySyncLabel = isExternalHistoryRefreshing
      ? t('sessions.externalHistorySyncing', {
          defaultValue: 'Syncing {{provider}} history',
          provider: externalHistoryProviderLabel ?? 'external',
        })
      : undefined;
    // Resolve local project metadata for header display
    const resolvedLocalProjectMeta = useMemo(() => {
      const proj = session.project as { kind?: string; localProjectId?: string } | undefined;
      if (proj?.kind !== 'local' || !proj.localProjectId) return null;
      return sessionMachineLocalProjects[proj.localProjectId as LocalProjectId] ?? null;
    }, [session.project, sessionMachineLocalProjects]);
    const sessionWorkspacePath = useMemo(() => {
      return resolveSessionWorkspacePath({
        sessionId: session.id,
        ownerSessionId: session.parentSessionId,
        isWorktree: session.isWorktree,
        dotlodyPath: machineDotlodyPath,
        localProjectRootPath: resolvedLocalProjectMeta?.rootPath,
        repoFullName: resolveProjectGitHubRepo(session.project) ?? session.repoFullName,
        legacyWorkspacePath: sessionMachine?.workspacePaths?.[session.id],
      });
    }, [
      machineDotlodyPath,
      resolvedLocalProjectMeta?.rootPath,
      session.id,
      session.isWorktree,
      session.parentSessionId,
      session.project,
      session.repoFullName,
      sessionMachine,
    ]);
    const agentConfigs = useAtomValue(getAllAgentConfigAtom);
    const sessionAgentConfig = useMemo(
      () => agentConfigs.find((config) => config.id === session.agentConfigId),
      [agentConfigs, session.agentConfigId]
    );
    // Same guard as the rate limits below: wait for the config to resolve, then
    // judge on the full provider identity. `cliType`/`agentType` alone would let
    // a Codex-compatible provider behind a custom key show OpenAI's forecast.
    const showCodexResetForecast =
      (!session.agentConfigId || !!sessionAgentConfig) &&
      canShowCodexResetForecast({
        cliType: session.cliType,
        agentType: session.agentType,
        config: sessionAgentConfig,
      });
    const sessionRateLimits =
      (!session.agentConfigId || sessionAgentConfig) &&
      canShowSubscriptionRateLimits({
        cliType: session.cliType,
        agentType: session.agentType,
        config: sessionAgentConfig,
      })
        ? sessionMachine?.raceLimits
        : undefined;
    const sessionDividerLabel = useMemo(() => {
      if (!session) return '';
      return formatSessionDate(session.createdAt, localeObj) || session.id;
    }, [session, localeObj]);

    const { repoFullName } = useMemo(
      () => getSessionGitHubState(session, workspaceSession),
      [session, workspaceSession]
    );
    const knownIssuePrItems = useMemo(() => new Map(), []);
    const isRepoPublic = undefined;

    type InputActionState = 'ready' | 'dispatching';
    const [inputActionState, setInputActionState] = useState<InputActionState>('ready');
    const directDispatchInFlightRef = useRef(false);
    const steeringQueueItemIdsRef = useRef(new Set<string>());
    const isArchivedSession = session.isArchived === true;
    const [pendingGoalCommand, setPendingGoalCommand] = useState<{
      threadId: string;
      command: GoalCommand;
    } | null>(null);
    const chatStreamRef = useRef<SessionChatStreamHandle>(null);
    const shareSelection = useMessageSelection(session.id);
    const inputAreaRef = useRef<SessionChatInputAreaHandle>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const messageAreaRef = useRef<HTMLDivElement>(null);
    const [outlineOverlayRoot, setOutlineOverlayRoot] = useState<HTMLDivElement | null>(null);
    const skipNextViewportResizeAutoScrollRef = useRef(false);
    const suppressStickyAutoScrollRef = useRef(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const [activeSearchResultIndex, setActiveSearchResultIndex] = useState(0);

    const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
    const [designContinuationSourceId, setDesignContinuationSourceId] = useState<string | null>(
      null
    );
    const canContinueWithMolly =
      !!session.design &&
      !(session.cliType === 'builtin' && session.agentType === 'molly') &&
      currentUser?.id === session.userId &&
      !!runtime &&
      machineSupportsDesignContinuationPreparation(sessionMachine);
    const queuedMessageBehavior = useAtomValue(queuedMessageBehaviorAtom);
    const {
      markSessionRead,
      requestSessionCancel,
      requestSessionDispatch,
      requestSessionSteer,
      touchSessionActivity,
    } = useSessionActions();
    const [renameDialogTarget, setRenameDialogTarget] = useState<RenameSessionDialogTarget | null>(
      null
    );
    const [sendingMessageIds, setSendingMessageIds] = useState<ReadonlySet<string>>(new Set());
    const [dismissedProposedPlanDecisionKeys, setDismissedProposedPlanDecisionKeys] = useState<
      ReadonlySet<string>
    >(new Set());
    const [pendingProposedPlanDecisionKey, setPendingProposedPlanDecisionKey] = useState<
      string | null
    >(null);
    const pendingProposedPlanDecisionKeyRef = useRef<string | null>(null);
    // Reset per-session transient UI state on session change.
    useEffect(() => {
      setSendingMessageIds(new Set());
      setDismissedProposedPlanDecisionKeys(new Set());
      setPendingProposedPlanDecisionKey(null);
      pendingProposedPlanDecisionKeyRef.current = null;
    }, [session.id]);

    const trackMessageSend = useCallback(
      (messageId: string) => {
        setSendingMessageIds((prev) => new Set(prev).add(messageId));
        waitUntilSynced()
          .then(() => {
            setSendingMessageIds((prev) => {
              const next = new Set(prev);
              next.delete(messageId);
              return next;
            });
          })
          .catch(() => {
            // On error, remove from sending set — transport will retry automatically
            setSendingMessageIds((prev) => {
              const next = new Set(prev);
              next.delete(messageId);
              return next;
            });
          });
      },
      [waitUntilSynced]
    );

    const sessionHistoryLength = conversationView?.turnCount ?? 0;
    const conversationPreparationSignalRef = useRef<SessionConversationPreparationState | null>(
      null
    );
    useEffect(() => {
      if (!onConversationPrepared && !onConversationPrepareError) {
        conversationPreparationSignalRef.current = null;
        return;
      }
      const preparationState = resolveSessionConversationPreparationState({
        docReady: sessionDocReady,
        historyLength: sessionHistoryLength,
        syncState: sessionDocSyncState,
      });
      if (
        preparationState === 'waiting' ||
        conversationPreparationSignalRef.current === preparationState
      ) {
        return;
      }
      conversationPreparationSignalRef.current = preparationState;
      if (preparationState === 'ready') {
        onConversationPrepared?.();
        return;
      }
      onConversationPrepareError?.();
    }, [
      onConversationPrepareError,
      onConversationPrepared,
      sessionDocReady,
      sessionDocSyncState,
      sessionHistoryLength,
    ]);
    const isEmptyConversation = useMemo(() => {
      if (!sessionDocReady) return false;
      return sessionHistoryLength === 0;
    }, [sessionHistoryLength, sessionDocReady]);

    const shouldShowTitleLoading = isEmptyConversation && !sessionDocSynced;
    // The header spinner only means "actively catching up". Degraded states
    // (disconnected/error) escalate to the status strip instead of spinning
    // forever, and a ~400ms delay keeps routine session switches flicker-free.
    const shouldShowTitleSyncing =
      !isEmptyConversation && sessionDocReady && isSyncingRoomSyncState(sessionDocSyncState);
    const effectiveTitleSyncing = useDelayedFlag(
      titleSyncing ?? shouldShowTitleSyncing,
      TITLE_SYNCING_INDICATOR_DELAY_MS
    );

    const mcpSelection = useSessionMcpSelection(sessionConversationConfig.mcpServerIds, {
      existingSession: true,
      disabled: isArchivedSession,
    });
    const executionTurnConfigOverrides = useMemo(
      () =>
        buildExecutionTurnConfigOverrides({
          selectedModeId,
          defaultModeId,
          modeOptions,
          configOptionSelectors,
          configOptionValues,
        }),
      [configOptionSelectors, configOptionValues, defaultModeId, modeOptions, selectedModeId]
    );

    // Session status strip above the composer: one priority-ordered slot for
    // "will my message run?" (self offline > machine removed > machine offline).
    const statusStripState = useMemo(
      () =>
        resolveSessionStatusStripState({
          browserOnline,
          machineRemoved: isMachineRemoved,
          machineOnlineStatus: sessionMachineOnlineStatus,
          machineName: sessionMachine?.name ?? null,
        }),
      [browserOnline, isMachineRemoved, sessionMachineOnlineStatus, sessionMachine?.name]
    );

    // Keyboard cyclers (⇧Tab mode + rebindable model / thinking). The agent provider is
    // fixed once a session exists, so it isn't cyclable here (only on the chat landing).
    const thinkEffortSelector = useMemo(
      () =>
        configOptionSelectors.find(
          (selector): selector is AcpSelectConfigOptionSelector =>
            selector.type === 'select' && isThoughtLevelSelector(selector)
        ),
      [configOptionSelectors]
    );
    const thinkEffortCurrent = thinkEffortSelector
      ? configOptionValues[thinkEffortSelector.configId]
      : undefined;
    useComposerCycleCommands({
      // Session detail keeps its toolbar and inactive tabs mounted. Only the active
      // conversation may own these duplicate command ids.
      enabled: !hideMessageArea && syncEnabled,
      mode: hideMessageArea
        ? null
        : {
            values: modeOptions.map((option) => option.value),
            current: selectedModeId,
            onSelect: handleModeChange,
          },
      model: hideMessageArea
        ? null
        : {
            values: modelOptions.map((option) => option.value),
            current: selectedModelId,
            onSelect: handleModelChange,
          },
      thinkEffort:
        !hideMessageArea && thinkEffortSelector
          ? {
              values: thinkEffortSelector.options.map((option) => option.value),
              current:
                typeof thinkEffortCurrent === 'string'
                  ? thinkEffortCurrent
                  : thinkEffortSelector.currentValue,
              onSelect: (value) => handleConfigOptionChange(thinkEffortSelector.configId, value),
            }
          : null,
      provider: null,
    });

    const initStatusLabel = useMemo<string | null>(() => {
      const heartbeatStepMs = 20_000;
      const heartbeatWindowMs = 120_000;
      const heartbeatBucketCount = 6;

      const createdAtMs = Date.parse(session.createdAt);
      const fallbackElapsedMs = Number.isFinite(createdAtMs)
        ? Math.max(0, Date.now() - createdAtMs)
        : 0;
      const elapsedMs = fallbackElapsedMs;
      const isSlow = elapsedMs >= heartbeatWindowMs;
      const bucket = Math.min(
        heartbeatBucketCount - 1,
        Math.max(0, Math.floor(elapsedMs / heartbeatStepMs))
      );
      const variantKey = isSlow ? 'slow' : (`h${bucket}` as const);

      const tHeartbeat = (baseKey: string, vars?: Record<string, unknown>) =>
        String(
          (t as unknown as (key: string, options?: Record<string, unknown>) => string)(
            `${baseKey}.${variantKey}`,
            vars
          )
        );

      if (liveSessionStatus == null) {
        return null;
      }

      switch (liveSessionStatus.type) {
        case 'initializing': {
          const stage = liveSessionStatus.stage;
          switch (stage) {
            case 'git-clone':
              return tHeartbeat('sessions.statusIndicator.gitClone', {
                repo: '',
              });
            case 'managed-runtime':
              return (
                liveSessionStatus.detail ??
                t('sessions.statusIndicator.managedRuntime', 'Preparing agent runtime')
              );
            case 'acp':
              return tHeartbeat('sessions.statusIndicator.acpInitialize', {
                agent: 'ACP',
              });
            case 'resuming':
              return t('sessions.statusIndicator.resuming');
            default:
              return tHeartbeat('sessions.statusIndicator.created');
          }
        }
        case 'running':
        case 'requestPermission':
          return null;
      }
      return null;
    }, [liveSessionStatus, session.createdAt, t]);

    /** The hydrated tail; every reader below that scans backwards for the latest turn uses it. */
    const sessionHistory = sessionTailHistory;
    const turnFacts = useSessionTurnFacts(conversationView);
    const [lastCompletedAssistantTarget, setLastCompletedAssistantTarget] = useState<{
      sessionId: SessionId;
      messageId: string | null;
    } | null>(null);
    const lastCompletedAssistantMessageId =
      lastCompletedAssistantTarget?.sessionId === session.id
        ? lastCompletedAssistantTarget.messageId
        : null;
    const handleLastCompletedAssistantMessageIdChange = useCallback(
      (messageId: string | null) => {
        setLastCompletedAssistantTarget((current) => {
          if (current?.sessionId === session.id && current.messageId === messageId) {
            return current;
          }
          return { sessionId: session.id, messageId };
        });
      },
      [session.id]
    );
    const handleForkFromMenu = useCallback(
      (destination?: SessionForkDestination) => {
        if (onForkSessionExternal) {
          void onForkSessionExternal(destination);
          return;
        }
        if (lastCompletedAssistantMessageId && onForkLastAssistant) {
          onForkLastAssistant(lastCompletedAssistantMessageId, destination);
        }
      },
      [lastCompletedAssistantMessageId, onForkLastAssistant, onForkSessionExternal]
    );
    const canForkFromMenu = Boolean(
      onForkSessionExternal || (lastCompletedAssistantMessageId && onForkLastAssistant)
    );
    const isContextCompacting = useMemo(
      () => isSessionContextCompacting(sessionHistory),
      [sessionHistory]
    );
    // Pending scheduled tasks (cron / wakeup) are derived on the fly from the
    // Cron*/ScheduleWakeup tool_call items already in history — nothing extra is
    // persisted. Serialize to a key so the input area only re-renders when the
    // derived set actually changes (not on every streaming token).
    const scheduledTasksKey = useMemo(
      () =>
        JSON.stringify(
          collectPendingScheduledTasksFromHistory(schedulingEntriesFromFacts(turnFacts.ordered))
        ),
      [turnFacts.ordered]
    );
    const pendingScheduledTasks = useMemo(
      () => JSON.parse(scheduledTasksKey) as PendingScheduledTask[],
      [scheduledTasksKey]
    );
    const legacySession = session as SessionLegacyMetaFields;
    const latestGoal = useMemo(() => {
      const goalItem = latestGoalFromFacts(turnFacts.ordered);
      return resolveVisibleSessionGoal(
        goalItem ? [{ items: [goalItem] as never }] : [],
        legacySession.latestGoal,
        session.dismissedGoalThreadId
      );
    }, [legacySession.latestGoal, session.dismissedGoalThreadId, turnFacts.ordered]);
    const isGoalActive = isSessionGoalActive(latestGoal);
    // The existing prompt bridge is Codex-specific. Other providers may publish
    // neutral goal snapshots, but their advertised `_session/goal` extension is
    // not yet routed through Molly's session control plane, so keep them read-only.
    const goalCommands = getPromptBridgeGoalCommands(session.agentType);
    const canPauseGoal = canPauseGoalThroughPromptBridge(session.agentType);

    useEffect(() => {
      if (!pendingGoalCommand) {
        return;
      }

      if (pendingGoalCommand.command === 'clear') {
        // Clear now lands as a 'cleared' status (not a delete), so treat either
        // a missing goal, a thread switch, or the cleared status as success.
        if (
          !latestGoal ||
          latestGoal.threadId !== pendingGoalCommand.threadId ||
          isSessionGoalCleared(latestGoal)
        ) {
          setPendingGoalCommand(null);
        }
        return;
      }

      if (latestGoal?.threadId !== pendingGoalCommand.threadId) {
        return;
      }
      if (pendingGoalCommand.command === 'pause' && latestGoal.status === 'paused') {
        setPendingGoalCommand(null);
        return;
      }
      if (pendingGoalCommand.command === 'resume' && latestGoal.status === 'active') {
        setPendingGoalCommand(null);
      }
    }, [latestGoal, pendingGoalCommand]);

    const isSessionActive = liveSessionStatus != null;
    // CLI-reported presence is the fact source for "working now". The only
    // frontend-derived state is the dispatched-but-not-started window, read
    // from the trailing pending user turn in history — never from meta
    // dispatch pointers, which can be stale in this client.
    //
    // That optimism is time-bounded: it is anchored on the turn's own durable
    // dispatch timestamp and expires after
    // `UNSTARTED_TRAILING_USER_TURN_TIMEOUT_MS` if the CLI never publishes
    // presence. Without the bound a crashed daemon / desynced dispatch left
    // "Starting…" showing forever, reading as a stuck-busy agent. Anchoring on
    // the durable timestamp (not mount time) makes a stalled turn report its
    // full age immediately after a reload instead of restarting the clock.
    const pendingDispatchAtMs = useMemo(
      () => resolveUnstartedTrailingDispatchAtMs(sessionHistory),
      [sessionHistory]
    );
    const [dispatchNowMs, setDispatchNowMs] = useState(() => getServerNow());
    useEffect(() => {
      if (pendingDispatchAtMs == null) return undefined;
      const tick = () => setDispatchNowMs(getServerNow());
      const remaining =
        pendingDispatchAtMs + UNSTARTED_TRAILING_USER_TURN_TIMEOUT_MS - getServerNow();
      if (remaining <= 0) {
        tick();
        return undefined;
      }
      const timer = setTimeout(tick, remaining);
      return () => clearTimeout(timer);
    }, [pendingDispatchAtMs]);
    const hasPendingDispatch =
      pendingDispatchAtMs != null &&
      dispatchNowMs - pendingDispatchAtMs < UNSTARTED_TRAILING_USER_TURN_TIMEOUT_MS;
    const isSessionWorking = isSessionActive || hasPendingDispatch;

    const runningActivity = useMemo<AgentActivity | null>(() => {
      if (liveSessionStatus == null) {
        return null;
      }
      const statusActivity = resolveActivityFromSessionStatus(liveSessionStatus);
      if (statusActivity) {
        return statusActivity;
      }
      return resolveActivityFromHistory(sessionHistory);
    }, [liveSessionStatus, sessionHistory]);

    const activeAssistantTurnId = useMemo(() => {
      return resolveActiveAssistantTurnId(sessionHistory);
    }, [sessionHistory]);
    const messageQueue = useMemo(
      () => (sessionDoc?.mq ?? []) as MessageQueueItem[],
      [sessionDoc?.mq]
    );
    const freeSessionTurnNotice = null;
    const guardNewBillableTurn = useCallback(() => true, []);
    const editableLastUserMessageId = useMemo(() => {
      if (
        session.isArchived ||
        isGoalActive ||
        session.cliType !== 'builtin' ||
        (session.agentType !== 'codex' && session.agentType !== 'claude')
      ) {
        return null;
      }
      let userIndex = -1;
      for (let index = sessionHistory.length - 1; index >= 0; index -= 1) {
        if (sessionHistory[index]?.role === 'user') {
          userIndex = index;
          break;
        }
      }
      const userMessage = sessionHistory[userIndex];
      if (
        !userMessage ||
        userMessage.status === 'pending_apply' ||
        userMessage.status === 'delivery_unknown' ||
        (userMessage.inputConfig as Record<string, unknown> | undefined)?._lodyDeliveryKind ===
          'steer'
      ) {
        return null;
      }

      for (let index = userIndex - 1; index >= 0; index -= 1) {
        const entry = sessionHistory[index];
        if (!entry) continue;
        if (entry.role === 'user') return null;
        if (entry.role !== 'assistant') continue;
        if (entry.finished !== true || !entry.acpTurnId || !session.agentConfigId) return null;
        const capability =
          sessionMachine?.acpCapabilities?.[getAcpCapabilityCacheKey(session.agentConfigId)];
        return getAcpCapabilityCacheEntryAuthority(capability, undefined) === 'authoritative' &&
          capability?.sessionFork === true
          ? userMessage.id
          : null;
      }

      // The first user message uses session/new and therefore has no fork boundary.
      return userMessage.id;
    }, [
      isGoalActive,
      session.agentConfigId,
      session.agentType,
      session.cliType,
      session.isArchived,
      sessionHistory,
      sessionMachine?.acpCapabilities,
    ]);
    const handleEditLastUser = useCallback(
      async (message: SessionHistoryParsed, text: string): Promise<boolean> => {
        const nextText = text.trim();
        const requesterUserId = currentUser?.id ?? session.userId;
        if (
          !runtime ||
          !requesterUserId ||
          message.id !== editableLastUserMessageId ||
          !nextText ||
          !guardNewBillableTurn()
        ) {
          return false;
        }

        const originalBlocks = historyItemsToInputBlocks(message.items);
        const inputBlocks: SessionInputBlock[] = [];
        let replacedText = false;
        for (const block of originalBlocks) {
          if (block.type === 'text') {
            if (!replacedText) {
              inputBlocks.push({ type: 'text', text: nextText });
              replacedText = true;
            }
            continue;
          }
          inputBlocks.push(block);
        }
        if (!replacedText) {
          inputBlocks.push({ type: 'text', text: nextText });
        }

        const originalConfig = normalizeSessionTurnInputConfig(message.inputConfig) ?? {};
        const inputConfig: SessionTurnInputConfig = {
          ...originalConfig,
          prompt: extractPromptPreviewFromInputBlocks(inputBlocks),
          inputBlocks,
          cliType: session.cliType,
          agentType: session.agentType,
        };
        const replacementUserTurnId = uuidv4();
        try {
          const response = await runtime.requestSessionEditAndResend(
            session.machineId,
            {
              sessionId: session.id,
              expectedUserTurnId: message.id,
              replacementUserTurnId,
              requestedByUserId: requesterUserId,
              timestamp: new Date(getServerNow()).toISOString(),
              inputConfig,
            },
            { timeoutMs: 120_000 }
          );
          if (!response?.success) {
            toast.error(
              response?.error?.message ??
                t('sessions.editAndResendFailed', 'Unable to edit and resend this message')
            );
            return false;
          }
        } catch (error) {
          console.warn('Edit and resend RPC failed', error);
          toast.error(t('sessions.editAndResendFailed', 'Unable to edit and resend this message'));
          return false;
        }
        return true;
      },
      [
        currentUser?.id,
        editableLastUserMessageId,
        guardNewBillableTurn,
        runtime,
        session.agentType,
        session.cliType,
        session.id,
        session.machineId,
        session.userId,
        t,
      ]
    );
    const searchBlocks = useIncrementalSearchBlocks(conversationView, isSearchOpen);
    const normalizedSearchQuery = useMemo(
      () => normalizeSessionSearchQuery(deferredSearchQuery),
      [deferredSearchQuery]
    );
    const searchResults = useMemo<SessionSearchResult[]>(
      () => buildSessionSearchResults(searchBlocks, normalizedSearchQuery),
      [normalizedSearchQuery, searchBlocks]
    );
    const activeSearchResult = searchResults[activeSearchResultIndex] ?? null;
    const searchBlockMatches = useMemo(() => {
      const next = new Map<
        string,
        {
          blockId: string;
          resultIds: string[];
          activeResultId: string | null;
          activeOccurrenceIndex: number | null;
        }
      >();

      searchResults.forEach((result) => {
        const existing = next.get(result.blockId);
        if (existing) {
          existing.resultIds.push(result.resultId);
          if (activeSearchResult?.resultId === result.resultId) {
            existing.activeResultId = result.resultId;
            existing.activeOccurrenceIndex = result.localIndex;
          }
          return;
        }

        next.set(result.blockId, {
          blockId: result.blockId,
          resultIds: [result.resultId],
          activeResultId: activeSearchResult?.resultId === result.resultId ? result.resultId : null,
          activeOccurrenceIndex:
            activeSearchResult?.resultId === result.resultId ? result.localIndex : null,
        });
      });

      return next;
    }, [activeSearchResult?.resultId, searchResults]);
    const searchContextValue = useMemo(() => {
      const isSearchActive = isSearchOpen && normalizedSearchQuery.length > 0;
      const matchedBlockIds = isSearchActive ? Array.from(searchBlockMatches.keys()) : [];
      const activeBlockId = isSearchActive ? (activeSearchResult?.blockId ?? null) : null;
      return {
        isOpen: isSearchActive,
        query: isSearchActive ? normalizedSearchQuery : '',
        activeBlockId,
        activeResultId: isSearchActive ? (activeSearchResult?.resultId ?? null) : null,
        blockMatches: isSearchActive ? searchBlockMatches : new Map(),
        hasMatchedPrefix: (prefix: string) =>
          matchedBlockIds.some((blockId) => blockId === prefix || blockId.startsWith(`${prefix}:`)),
        hasActivePrefix: (prefix: string) =>
          activeBlockId !== null &&
          (activeBlockId === prefix || activeBlockId.startsWith(`${prefix}:`)),
      };
    }, [
      activeSearchResult?.blockId,
      activeSearchResult?.resultId,
      isSearchOpen,
      normalizedSearchQuery,
      searchBlockMatches,
    ]);

    const focusSearchInput = useCallback(() => {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    }, []);

    const openSearch = useCallback(() => {
      if (!isSearchOpen) {
      }
      setIsSearchOpen(true);
      focusSearchInput();
    }, [focusSearchInput, isSearchOpen]);

    const closeSearch = useCallback(() => {
      setIsSearchOpen(false);
    }, []);

    const moveToSearchResult = useCallback(
      (direction: 'previous' | 'next') => {
        if (searchResults.length === 0) {
          return;
        }
        startTransition(() => {
          setActiveSearchResultIndex((previousIndex) => {
            if (direction === 'previous') {
              return previousIndex <= 0 ? searchResults.length - 1 : previousIndex - 1;
            }
            return previousIndex >= searchResults.length - 1 ? 0 : previousIndex + 1;
          });
        });
      },
      [searchResults.length]
    );

    useEffect(() => {
      setIsSearchOpen(false);
      setSearchQuery('');
      setActiveSearchResultIndex(0);
    }, [session.id]);

    const handleSearchQueryChange = useCallback((next: string) => {
      setSearchQuery(next);
      setActiveSearchResultIndex(0);
    }, []);

    // ── Page-level drag-and-drop ────────────────────────────────────────
    // Two kinds land on the whole conversation, not just on the composer: image
    // and file attachments, and a session dragged out of the sidebar, which
    // becomes a mention of that conversation. Each zone ignores the other's
    // transfer, so they share the container without competing for it.
    const canHandlePageDrop = !isArchivedSession && !hideMessageArea;
    const imageDropZone = useDropZone({
      enabled: canHandlePageDrop,
      accepts: hasFileTransfer,
      onDrop: useCallback((dataTransfer: DataTransfer) => {
        const files = getFilesFromDataTransfer(dataTransfer);
        if (files.length > 0) {
          inputAreaRef.current?.handleImageDrop(files);
        }
      }, []),
    });
    const { dropZone: sessionMentionDropZone, overlayActive: sessionMentionOverlay } =
      useSessionMentionDropZone({
        enabled: canHandlePageDrop,
        excludeSessionId: session.id,
        observeInFlight: paintSessionMentionOverlay && isVisible,
        onDropSessionId: useCallback((droppedSessionId: string) => {
          inputAreaRef.current?.insertSessionMention(droppedSessionId);
        }, []),
      });
    const pageDropHandlers = mergeDropZoneHandlers(imageDropZone, sessionMentionDropZone);

    useEffect(() => {
      if (searchResults.length === 0) {
        if (activeSearchResultIndex !== 0) {
          setActiveSearchResultIndex(0);
        }
        return;
      }
      if (activeSearchResultIndex < searchResults.length) {
        return;
      }
      setActiveSearchResultIndex(searchResults.length - 1);
    }, [activeSearchResultIndex, searchResults.length]);

    useEffect(() => {
      if (hideMessageArea) {
        return undefined;
      }
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.defaultPrevented) {
          return;
        }
        // Exact chord only: ⌘F (macOS) / Ctrl+F (Windows/Linux). Refuse any extra
        // modifier (Shift/Alt/the other primary mod) so chords like ⌘⌥F, ⌘⇧F, or
        // ⌘⌃F keep their other meanings and are not stolen via preventDefault.
        // Matches the command registry's `$mod+f` matcher (primary-mod exclusive).
        if (!matchesKeyboardEvent(FIND_IN_CHAT_BINDING, event, isMac())) {
          return;
        }
        event.preventDefault();
        openSearch();
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [hideMessageArea, openSearch]);

    useEffect(() => {
      if (!isSearchOpen || !activeSearchResult) {
        return undefined;
      }

      // Disable smooth scrolling and sticky auto-scroll during search navigation
      // to prevent virtua animation from fighting scrollIntoView and causing freezes.
      suppressStickyAutoScrollRef.current = true;
      chatStreamRef.current?.scrollToIndex(activeSearchResult.messageIndex, false);

      let cancelled = false;
      let attempts = 0;
      const maxAttempts = 12;

      const tryReveal = () => {
        if (cancelled) {
          // Don't reset suppressStickyAutoScrollRef here — cleanup already handles it.
          // Resetting here would race with a newer effect instance that has already
          // set it back to true.
          return;
        }
        const root = messageAreaRef.current;
        if (!root) {
          return;
        }

        const byResult = root.querySelector(
          `[data-search-result-id="${activeSearchResult.resultId}"]`
        );
        const byBlock = root.querySelector(
          `[data-search-block-id="${activeSearchResult.blockId}"]`
        );
        const target = (byResult ?? byBlock) as HTMLElement | null;

        if (target) {
          target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          suppressStickyAutoScrollRef.current = false;
          return;
        }

        if (attempts >= maxAttempts) {
          suppressStickyAutoScrollRef.current = false;
          return;
        }
        attempts += 1;
        setTimeout(() => {
          requestAnimationFrame(tryReveal);
        }, 50);
      };

      // Give the instant scroll + virtual-list render a short buffer before revealing.
      const timeoutId = window.setTimeout(() => {
        requestAnimationFrame(tryReveal);
      }, 100);

      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
        suppressStickyAutoScrollRef.current = false;
      };
    }, [activeSearchResult, isSearchOpen]);

    const handleCopyConversationHistory = useCallback(async () => {
      if (!conversationView?.turnCount) {
        toast.error(t('sessions.copyConversationHistoryEmpty', 'No conversation history to copy'));
        return;
      }

      try {
        const { markdown, stats } = buildConversationMarkdown({
          history: (await conversationView.readAll()) as Parameters<
            typeof buildConversationMarkdown
          >[0]['history'],
          title: session.title ?? undefined,
        });
        await navigator.clipboard.writeText(markdown);
        toast.success(describeCopiedConversation(stats, t));
      } catch (error) {
        console.error('Failed to copy conversation history', error);
        toast.error(
          t('sessions.copyConversationHistoryFailed', 'Failed to copy conversation history')
        );
      }
    }, [session.title, conversationView, t]);

    // Inactive tabs and collapsed side chats stay mounted for fast switching, so
    // being mounted is not evidence the user saw this conversation: only the
    // visible surface may clear unread state. Otherwise opening a parent session
    // marks every one of its sub-sessions read at once.
    const lastReadAtForReceiptRef = useRef(parseTimestamp(session.lastReadAt));
    lastReadAtForReceiptRef.current = parseTimestamp(session.lastReadAt);

    useEffect(() => {
      const lastMessageAt = parseTimestamp(session.lastMessageAt);
      if (
        !shouldMarkSessionRead({
          rendersConversation: !hideMessageArea,
          isVisible,
          lastMessageAt,
          lastReadAt: lastReadAtForReceiptRef.current,
        })
      ) {
        return;
      }
      void markSessionRead(session.id, session.lastMessageAt ?? null).catch((error: unknown) => {
        console.warn('Failed to mark session as read', error);
      });
      // A receipt gets a new opportunity when this surface becomes visible or
      // a new message arrives. Deliberately do not depend on lastReadAt: moving
      // that receipt backwards is the user's explicit "Mark as unread" action,
      // which must remain visible until they leave and reopen the conversation.
    }, [hideMessageArea, isVisible, markSessionRead, session.id, session.lastMessageAt]);

    const isDispatching = inputActionState === 'dispatching';
    const isAgentBusy = isSessionPromptBusy({
      isDispatching,
      isSessionWorking,
      isGoalActive,
    });
    const canStopAgent = canStopAgentEnabled({
      isContextCompacting,
      isSessionActive,
      activeAssistantTurnId: activeAssistantTurnId ?? null,
      isGoalActive,
      canPauseGoal,
    });
    const latestCompletedProposedPlan = useMemo(
      () => latestProposedPlanFromFacts(turnFacts.ordered),
      [turnFacts.ordered]
    );
    const isCodexPlanSession = session.agentType === 'codex';
    const isProposedPlanDecisionPending =
      latestCompletedProposedPlan !== null &&
      pendingProposedPlanDecisionKey === latestCompletedProposedPlan.key;
    const shouldShowProposedPlanDecisionPrompt = shouldShowCodexProposedPlanDecision({
      plan: latestCompletedProposedPlan,
      dismissed:
        latestCompletedProposedPlan !== null &&
        dismissedProposedPlanDecisionKeys.has(latestCompletedProposedPlan.key),
      pending: isProposedPlanDecisionPending,
      isCodexSession: isCodexPlanSession,
      isSessionIdle: session.status?.type === 'idle',
      isSessionActive,
      isAgentBusy,
    });
    const isProposedPlanDecisionReady =
      !isMachineRemoved && !isArchivedSession && !isExternalHistoryRefreshing;

    const sessionBranch = useMemo(
      () =>
        resolveBaseBranchPreference({
          preferredBranch: getProjectRefBranch(session.project),
          baseBranch: session.baseBranch,
        }),
      [session.baseBranch, session.project]
    );
    const sessionProject = useMemo<ProjectRef | undefined>(() => {
      const rawProject = session.project as
        | (
            | { kind: 'github'; repoFullName?: unknown; branch?: unknown }
            | {
                kind: 'local';
                localProjectId?: unknown;
                branch?: unknown;
                githubRepoFullName?: unknown;
                useWorktree?: unknown;
              }
          )
        | undefined;
      if (rawProject?.kind === 'github') {
        const projectRepoFullName =
          typeof rawProject.repoFullName === 'string'
            ? rawProject.repoFullName.trim()
            : (session.repoFullName?.trim() ?? '');
        if (!projectRepoFullName) {
          return undefined;
        }
        const branch =
          typeof rawProject.branch === 'string' && rawProject.branch.trim()
            ? rawProject.branch.trim()
            : sessionBranch;
        return { kind: 'github', repoFullName: projectRepoFullName, branch };
      }
      if (rawProject?.kind === 'local') {
        if (typeof rawProject.localProjectId !== 'string' || !rawProject.localProjectId.trim()) {
          return undefined;
        }
        const branch =
          typeof rawProject.branch === 'string' && rawProject.branch.trim()
            ? rawProject.branch.trim()
            : undefined;
        return {
          kind: 'local',
          localProjectId: rawProject.localProjectId as LocalProjectId,
          githubRepoFullName:
            typeof rawProject.githubRepoFullName === 'string' &&
            rawProject.githubRepoFullName.trim()
              ? rawProject.githubRepoFullName.trim()
              : (session.repoFullName?.trim() ?? undefined),
          ...(branch ? { branch } : {}),
          ...(typeof rawProject.useWorktree === 'boolean'
            ? { useWorktree: rawProject.useWorktree }
            : session.isWorktree
              ? { useWorktree: true }
              : {}),
        };
      }
      const fallbackRepo = session.repoFullName?.trim();
      if (!fallbackRepo) {
        return undefined;
      }
      return { kind: 'github', repoFullName: fallbackRepo, branch: sessionBranch };
    }, [session.isWorktree, session.project, session.repoFullName, sessionBranch]);
    const agentActivityLabel =
      initStatusLabel && !isEmptyConversation
        ? initStatusLabel
        : isSessionActive
          ? liveSessionStatus?.type === 'requestPermission'
            ? t('sessions.statusIndicator.requestPermission')
            : t(`sessions.statusIndicator.${runningActivity ?? 'thinking'}`)
          : hasPendingDispatch && statusStripState == null
            ? // Pre-start only while the turn can actually start: any
              // connection/machine problem (browser offline, machine removed or
              // offline) hands the story to the status chip instead.
              t('sessions.statusIndicator.pendingDispatch')
            : null;
    const agentActivityTone =
      isSessionActive && liveSessionStatus?.type === 'requestPermission' ? 'warning' : 'primary';

    const scrollChatToBottom = useCallback(() => {
      requestAnimationFrame(() => chatStreamRef.current?.scrollToBottom());
    }, []);

    const guideHistoryEntry = useCallback(
      async (userTurnId: string, expectedTurnId: string): Promise<boolean> => {
        return await requestSessionSteer(session.id, expectedTurnId, userTurnId, {
          machineId: session.machineId,
        });
      },
      [requestSessionSteer, session.id, session.machineId]
    );

    const enqueueInputBlocks = useCallback(
      async (
        inputBlocks: SessionInputBlock[],
        options?: {
          createHistory?: boolean;
          existingUserTurnId?: string;
          requestDispatch?: boolean;
          guideExpectedTurnId?: string;
          modeIdOverride?: string | null;
          modelIdOverride?: string | null;
          configOptionValuesOverride?: Record<string, AcpConfigOptionValue>;
        }
      ): Promise<boolean> => {
        try {
          const turnModeId =
            options?.modeIdOverride !== undefined ? options.modeIdOverride : selectedModeId;
          const turnModelId =
            options?.modelIdOverride !== undefined ? options.modelIdOverride : selectedModelId;
          const turnConfigOptionValues = options?.configOptionValuesOverride ?? configOptionValues;
          const derivedUserId = currentUser?.id ?? session.userId;
          const prompt = extractPromptPreviewFromInputBlocks(inputBlocks);
          const issuePRMentions = prompt
            ? extractIssuePRMentionsFromText(prompt, knownIssuePrItems, repoFullName)
            : undefined;
          const inputConfig = buildSessionTurnInputConfig({
            inputBlocks,
            agentConfigId: session.design ? session.agentConfigId : undefined,
            cliType: session.cliType,
            agentType: session.agentType,
            modeId: turnModeId,
            modelId: turnModelId,
            configOptionValues: turnConfigOptionValues,
            issuePRMentions,
            mcpServerIds: mcpSelection.selectedIds,
            agentRoleId: null,
            resume: session.acpSessionId ?? undefined,
          });

          let userTurnId = options?.existingUserTurnId?.trim() || null;
          if (!userTurnId && options?.createHistory) {
            const pendingHistoryEntry = buildPendingUserHistoryEntry({
              userId: derivedUserId,
              inputBlocks,
              timestamp: new Date().toISOString(),
              inputConfig,
              status: options?.guideExpectedTurnId ? 'pending_apply' : 'pending',
            });
            if (!pendingHistoryEntry) {
              return false;
            }
            if (!guardNewBillableTurn()) {
              return false;
            }
            const { entry: historyEntry } = await addSessionHistory(pendingHistoryEntry, {
              dispatch: options?.requestDispatch === true,
            });
            userTurnId = historyEntry.id;
            touchSessionActivity(session.id).catch((err: unknown) => {
              console.warn('Failed to update session lastMessageAt/lastReadAt', err);
            });
          } else if (userTurnId) {
            await updateHistoryEntry(userTurnId, (entry) => ({
              ...entry,
              status: 'pending',
              inputConfig,
              read: false,
            }));
          }

          // Track CRDT sync to server for this message
          if (userTurnId) {
            trackMessageSend(userTurnId);
          }
          if (options?.requestDispatch && userTurnId) {
            void requestSessionDispatch(session.id, userTurnId, {
              inputConfig,
              machineId: session.machineId,
            }).catch((err: unknown) => {
              console.error('Failed to request session dispatch', err);
              // A failed dispatch must unblock resend right away; otherwise the
              // composer stays locked until DISPATCHING_TIMEOUT_MS expires.
              directDispatchInFlightRef.current = false;
              setInputActionState('ready');
              toast.error(t('sessions.sendError'), { description: getErrorMessage(err) });
            });
          } else if (options?.guideExpectedTurnId && userTurnId) {
            void guideHistoryEntry(userTurnId, options.guideExpectedTurnId).catch(
              (error: unknown) => {
                console.error('Failed to apply guide message', error);
                toast.error(t('sessions.sendError'), { description: getErrorMessage(error) });
              }
            );
          }

          scrollChatToBottom();
          return true;
        } catch (err) {
          console.error('Failed to queue session message', err);
          toast.error(t('sessions.sendError'), { description: getErrorMessage(err) });
          return false;
        }
      },
      [
        addSessionHistory,
        configOptionValues,
        currentUser?.id,
        guardNewBillableTurn,
        guideHistoryEntry,
        knownIssuePrItems,
        mcpSelection.selectedIds,
        repoFullName,
        requestSessionDispatch,
        scrollChatToBottom,
        selectedModeId,
        selectedModelId,
        session.acpSessionId,
        session.agentConfigId,
        session.design,
        session.agentType,
        session.cliType,
        session.id,
        session.machineId,
        session.userId,
        trackMessageSend,
        touchSessionActivity,
        updateHistoryEntry,
        t,
      ]
    );

    const queueInputBlocks = useCallback(
      async (
        inputBlocks: SessionInputBlock[],
        options?: Pick<
          DispatchInputBlocksOptions,
          'modeIdOverride' | 'modelIdOverride' | 'configOptionValuesOverride'
        >
      ): Promise<boolean> => {
        try {
          const turnModeId =
            options?.modeIdOverride !== undefined ? options.modeIdOverride : selectedModeId;
          const turnModelId =
            options?.modelIdOverride !== undefined ? options.modelIdOverride : selectedModelId;
          const turnConfigOptionValues = options?.configOptionValuesOverride ?? configOptionValues;
          const derivedUserId = currentUser?.id ?? session.userId;
          const prompt = extractPromptPreviewFromInputBlocks(inputBlocks);
          const issuePRMentions = prompt
            ? extractIssuePRMentionsFromText(prompt, knownIssuePrItems, repoFullName)
            : undefined;
          const inputConfig = buildSessionTurnInputConfig({
            inputBlocks,
            agentConfigId: session.design ? session.agentConfigId : undefined,
            cliType: session.cliType,
            agentType: session.agentType,
            modeId: turnModeId,
            modelId: turnModelId,
            configOptionValues: turnConfigOptionValues,
            issuePRMentions,
            mcpServerIds: mcpSelection.selectedIds,
            agentRoleId: null,
            resume: session.acpSessionId ?? undefined,
          });
          const queuedInputConfig: MessageQueueItemInput['acpSessionConfig'] = {
            prompt: inputConfig.prompt,
            agentConfigId: inputConfig.agentConfigId,
            inputBlocks,
            cliType: inputConfig.cliType,
            agentType: inputConfig.agentType,
            modeId: inputConfig.modeId ?? undefined,
            modelId: inputConfig.modelId ?? undefined,
            configOptionValues: inputConfig.configOptionValues ?? undefined,
            issuePRMentions: inputConfig.issuePRMentions ?? undefined,
            mcpServerIds: [...mcpSelection.selectedIds],
            agentRoleId: inputConfig.agentRoleId,
            agentRoleRevision: inputConfig.agentRoleRevision,
            resume: inputConfig.resume ?? undefined,
            chainDepth: 0,
          };

          if (!guardNewBillableTurn()) {
            return false;
          }
          const userTurnId = uuidv4();
          await pushMessageQueue({
            task: prompt || t('sessions.messageQueue.imageOnly', '[Image message]'),
            project: sessionProject,
            userId: derivedUserId,
            userTurnId,
            acpSessionConfig: queuedInputConfig,
          });
          return true;
        } catch (err) {
          console.error('Failed to queue session message', err);
          toast.error(t('sessions.queueError', 'Failed to queue message'), {
            description: getErrorMessage(err),
          });
          return false;
        }
      },
      [
        configOptionValues,
        currentUser?.id,
        guardNewBillableTurn,
        knownIssuePrItems,
        mcpSelection.selectedIds,
        pushMessageQueue,
        repoFullName,
        selectedModeId,
        selectedModelId,
        session.acpSessionId,
        session.agentConfigId,
        session.design,
        session.agentType,
        session.cliType,
        session.userId,
        sessionProject,
        t,
      ]
    );

    const directDispatchInputBlocks = useCallback(
      async (
        inputBlocks: SessionInputBlock[],
        options?: Pick<
          DispatchInputBlocksOptions,
          'modeIdOverride' | 'modelIdOverride' | 'configOptionValuesOverride'
        >
      ): Promise<boolean> => {
        const turnConfigOptionValues = options?.configOptionValuesOverride ?? configOptionValues;
        return await enqueueInputBlocks(inputBlocks, {
          createHistory: true,
          requestDispatch: true,
          modeIdOverride: options?.modeIdOverride,
          modelIdOverride: options?.modelIdOverride,
          configOptionValuesOverride: turnConfigOptionValues,
        });
      },
      [configOptionValues, enqueueInputBlocks]
    );

    const dispatchInputBlocks = useCallback(
      async (
        inputBlocks: SessionInputBlock[],
        options?: DispatchInputBlocksOptions
      ): Promise<boolean> => {
        const normalized = normalizeSessionInputBlocks(inputBlocks, '');
        if (normalized.length === 0) {
          return false;
        }
        if (!sessionDocReady) {
          return false;
        }

        const turnModeId =
          options?.modeIdOverride !== undefined ? options.modeIdOverride : selectedModeId;
        const turnModelId =
          options?.modelIdOverride !== undefined ? options.modelIdOverride : selectedModelId;
        const turnConfigOptionValues = options?.configOptionValuesOverride ?? configOptionValues;
        const forceDirect = options?.forceDirect === true;
        const submitRoute = resolveSessionMessageSubmitRoute({
          forceDirect,
          forceQueue: options?.forceQueue === true,
          isPromptBusy: isAgentBusy,
          hasUnfinishedAssistantTurn: activeAssistantTurnId != null,
          queuedMessageBehavior,
        });
        if (isArchivedSession) {
          return false;
        }
        if (isExternalHistoryRefreshing) {
          return false;
        }
        // P2.2: a design turn may only leave once the canvas editor (possibly
        // open-but-hidden) has durably saved; the daemon pins the post-save
        // baseline in the turn-input manifest. On failure the send is blocked
        // and the composer draft is left untouched.
        if (session.design) {
          try {
            await flushDesignCanvasBeforeSend(
              session.design.artworkId,
              normalized
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join('\n')
            );
          } catch (error) {
            toast.error(t('design.saveFailedBeforeSend', 'Canvas save failed'), {
              description: getErrorMessage(error),
            });
            return false;
          }
        }
        if (submitRoute.type === 'queue') {
          const accepted = await queueInputBlocks(normalized, {
            modeIdOverride: turnModeId,
            modelIdOverride: turnModelId,
            configOptionValuesOverride: turnConfigOptionValues,
          });
          return accepted;
        }

        if (submitRoute.type === 'guide' && activeAssistantTurnId) {
          const accepted = await enqueueInputBlocks(normalized, {
            createHistory: true,
            guideExpectedTurnId: activeAssistantTurnId,
            modeIdOverride: turnModeId,
            modelIdOverride: turnModelId,
            configOptionValuesOverride: turnConfigOptionValues,
          });
          return accepted;
        }

        if (directDispatchInFlightRef.current) {
          return false;
        }

        directDispatchInFlightRef.current = true;
        setInputActionState('dispatching');

        const accepted = await directDispatchInputBlocks(normalized, {
          modeIdOverride: turnModeId,
          modelIdOverride: turnModelId,
          configOptionValuesOverride: turnConfigOptionValues,
        });
        if (!accepted) {
          directDispatchInFlightRef.current = false;
          setInputActionState('ready');
        }
        return accepted;
      },
      [
        configOptionValues,
        directDispatchInputBlocks,
        activeAssistantTurnId,
        enqueueInputBlocks,
        isExternalHistoryRefreshing,
        isArchivedSession,
        isAgentBusy,
        queueInputBlocks,
        queuedMessageBehavior,
        session.design,
        sessionDocReady,
        selectedModeId,
        selectedModelId,
        t,
      ]
    );

    const dispatchPrompt = useCallback(
      async (prompt: string, options?: DispatchInputBlocksOptions): Promise<boolean> => {
        return await dispatchInputBlocks([{ type: 'text', text: prompt }], options);
      },
      [dispatchInputBlocks]
    );

    const handleSendMessage = useCallback(
      async (inputBlocks: SessionInputBlock[]): Promise<boolean> => {
        return await dispatchInputBlocks(inputBlocks);
      },
      [dispatchInputBlocks]
    );

    const capacityRetry = useCapacityAutoRetry({
      sessionId: session.id,
      history: sessionHistory,
      canRetry:
        sessionDocReady &&
        !isAgentBusy &&
        !isMachineRemoved &&
        !isArchivedSession &&
        !isExternalHistoryRefreshing,
      onRetry: async () =>
        await dispatchPrompt(
          t('sessions.capacityRetry.continuationPrompt', CAPACITY_RETRY_CONTINUATION_PROMPT)
        ),
    });

    // Resend a user turn the missing-history recovery negatively acknowledged:
    // the row's "Not delivered" label opens a confirmation dialog that calls
    // this with the turn's exact content. It rides the ordinary send path as a
    // NEW message — the old turn is never revived.
    const handleResendUndelivered = useCallback(
      async (userTurnId: string, inputBlocks: SessionInputBlock[]): Promise<boolean> => {
        const accepted = await handleSendMessage(inputBlocks);
        if (accepted) {
          // The marker stays as a tombstone; terminalize the abandoned entry.
          try {
            await updateHistoryEntry(userTurnId, (entry) =>
              entry.status === 'delivery_unknown'
                ? entry
                : {
                    ...entry,
                    status: 'canceled',
                    read: true,
                  }
            );
          } catch (error) {
            console.warn('Failed to supersede the undelivered user turn', {
              userTurnId,
              error,
            });
          }
        }
        return accepted;
      },
      [handleSendMessage, updateHistoryEntry]
    );

    const handleContinueDiscussingProposedPlan = useCallback(() => {
      if (!latestCompletedProposedPlan) {
        return;
      }
      setDismissedProposedPlanDecisionKeys((prev) => {
        const next = new Set(prev);
        next.add(latestCompletedProposedPlan.key);
        return next;
      });
    }, [latestCompletedProposedPlan]);

    const handleExecuteProposedPlan = useCallback(async () => {
      if (!latestCompletedProposedPlan || pendingProposedPlanDecisionKeyRef.current) {
        return;
      }

      const decisionKey = latestCompletedProposedPlan.key;
      pendingProposedPlanDecisionKeyRef.current = decisionKey;
      setPendingProposedPlanDecisionKey(decisionKey);

      const accepted = await dispatchPrompt(
        t('sessions.proposedPlanDecision.executePrompt', 'Implement the plan'),
        {
          ...executionTurnConfigOverrides,
          forceDirect: true,
        }
      );

      if (accepted) {
        setDismissedProposedPlanDecisionKeys((prev) => {
          const next = new Set(prev);
          next.add(decisionKey);
          return next;
        });
      } else {
        toast.error(t('sessions.proposedPlanDecision.executeError', 'Failed to execute plan'));
      }

      pendingProposedPlanDecisionKeyRef.current = null;
      setPendingProposedPlanDecisionKey(null);
    }, [dispatchPrompt, executionTurnConfigOverrides, latestCompletedProposedPlan, t]);

    const handleGoalCommand = useCallback(
      async (
        command: GoalCommand,
        goal: Extract<MessageContent, { type: 'goal' }> | null = latestGoal,
        options?: { showPending?: boolean }
      ): Promise<boolean> => {
        if (!goalCommands.includes(command)) {
          toast.error(t('sessions.goal.commandError', 'Failed to send goal command'));
          return false;
        }

        if (!goal) {
          toast.error(t('sessions.goal.commandError', 'Failed to send goal command'));
          return false;
        }

        directDispatchInFlightRef.current = false;
        setInputActionState('ready');
        if (options?.showPending !== false) {
          setPendingGoalCommand({ threadId: goal.threadId, command });
        }

        try {
          const accepted = await dispatchPrompt(`/goal ${command}`, GOAL_PROMPT_DISPATCH_OPTIONS);
          if (!accepted) {
            throw new Error('Goal command was not accepted for dispatch');
          }
          return true;
        } catch (error) {
          if (options?.showPending !== false) {
            setPendingGoalCommand((current) =>
              current?.threadId === goal.threadId && current.command === command ? null : current
            );
          }
          toast.error(t('sessions.goal.commandError', 'Failed to send goal command'), {
            description: getErrorMessage(error),
          });
          return false;
        }
      },
      [dispatchPrompt, goalCommands, latestGoal, t]
    );

    const handleGoalCardCommand = useCallback(
      (command: GoalCommand, goal: Extract<MessageContent, { type: 'goal' }>) => {
        void handleGoalCommand(command, goal);
      },
      [handleGoalCommand]
    );

    const handleDismissGoalBanner = useCallback(
      (goal: Extract<MessageContent, { type: 'goal' }>) => {
        if (!runtime) return;
        if (session.dismissedGoalThreadId === goal.threadId) return;
        const roomId = getSessionRoomId(session.id);
        void runtime.writer.upsertDocMeta(roomId, {
          dismissedGoalThreadId: goal.threadId,
        } as Partial<SessionMeta>);
      },
      [runtime, session.id, session.dismissedGoalThreadId]
    );

    // ── Pin management ──────────────────────────────────────────────────
    const handlePinMessage = useCallback(
      (historyId: string | null) => {
        if (!runtime) {
          return;
        }
        const roomId = getSessionRoomId(session.id);
        // Use empty string as "cleared" — undefined is skipped by upsertDocMeta merge
        void runtime.writer.upsertDocMeta(roomId, {
          pinnedHistoryId: historyId ?? '',
        } as Partial<SessionMeta>);
      },
      [runtime, session.id]
    );

    const pinnedHistoryId = session.pinnedHistoryId || null;

    const handleUnpin = useCallback(() => {
      handlePinMessage(null);
    }, [handlePinMessage]);

    const pinContextValue = useMemo<SessionPinContextValue>(
      () => ({
        pinnedHistoryId,
        onPin: handlePinMessage,
      }),
      [pinnedHistoryId, handlePinMessage]
    );

    // The pinned turn is hydrated on demand through the view; nothing else
    // needs the whole history for the pin banner.
    const pinnedTurn = useTurn(conversationView, pinnedHistoryId);
    const pinnedMessage = useMemo<SessionHistoryParsed | null>(() => {
      if (!pinnedTurn) return null;
      const rawItems: unknown = pinnedTurn.items;
      return {
        ...pinnedTurn,
        items: Array.isArray(rawItems) ? rawItems : [],
        read: pinnedTurn.read ?? false,
      } as SessionHistoryParsed;
    }, [pinnedTurn]);

    const handleScrollToMessage = useCallback(
      (historyId: string) => {
        const index = conversationView?.indexOf(historyId) ?? -1;
        if (index >= 0) {
          chatStreamRef.current?.scrollToIndex(index);
        }
      },
      [conversationView]
    );

    const router = useRouter();
    const workspaceSlug = useAtomValue(currentWorkspaceSlugAtom);

    // Presentation-only "opened by" provenance (MCP `molly_session_create`).
    // Read from the already-loaded session meta cache, so it costs no extra
    // document. `parentSessionId` children are excluded by the atom — they are
    // child tabs / side chats and must keep their own semantics.
    const openerSessionId = session.openedBySessionId ?? null;
    const openerSessionMeta = useAtomValue(
      sessionMetaAtomFamily(openerSessionId ? getSessionRoomId(openerSessionId) : '')
    );
    const openedSessions = useAtomValue(openedSessionsAtomFamily(session.id));
    const openerNavigationTarget = useMemo(
      () => resolveOpenedByNavigationTarget(session, openerSessionMeta),
      [openerSessionMeta, session]
    );
    const handleOpenRelatedSession = useCallback(
      (target: SessionNavigationTarget) => {
        onNavigateSession?.(target);
      },
      [onNavigateSession]
    );
    const openedByRelations = useMemo<SessionOpenedByMenuState | undefined>(() => {
      const opened = openedSessions.map((item) => ({
        sessionId: item.id,
        title: (item.title ?? '').trim() || t('sessions.untitled', 'Untitled session'),
        target: { sessionId: item.id },
      }));
      // An opener that is archived or not synced to this client still has a
      // usable id, so navigation stays available; only the label falls back.
      const openedBy =
        openerSessionId && openerNavigationTarget
          ? {
              sessionId: openerSessionId,
              title:
                (openerSessionMeta?.title ?? '').trim() ||
                t('sessions.untitled', 'Untitled session'),
              target: openerNavigationTarget,
            }
          : null;
      if (!openedBy && opened.length === 0) return undefined;
      return { openedBy, opened, onOpenSession: handleOpenRelatedSession };
    }, [
      handleOpenRelatedSession,
      openedSessions,
      openerNavigationTarget,
      openerSessionId,
      openerSessionMeta?.title,
      t,
    ]);
    const openedByConversationStart = useMemo(() => {
      const openedBy = openedByRelations?.openedBy;
      if (!openedBy) return undefined;
      return (
        <ConversationColumn className="py-2 sm:py-3">
          <SessionRelationCard
            relation="opened-by"
            label={
              session.designContinuation
                ? t(
                    'design.continuation.createdFrom',
                    'This conversation continues the design from'
                  )
                : t(
                    'sessions.openedBy.createdAutomaticallyBy',
                    'This session was automatically created by'
                  )
            }
            sessionTitle={openedBy.title}
            actionLabel={t('sessions.openedBy.backToOpener', 'Back to session')}
            actionIcon={CornerLeftUp}
            onAction={() => openedByRelations.onOpenSession(openedBy.target)}
          />
        </ConversationColumn>
      );
    }, [openedByRelations, session.designContinuation, t]);

    const headerBrowserSession =
      browserActionSession === undefined ? session : browserActionSession;
    const browserActionAvailable = Boolean(
      onOpenBrowser &&
      headerBrowserSession &&
      hasReportedPreviewTarget({
        candidateStatus: headerBrowserSession.previewCandidate?.status,
        connectionStatus: headerBrowserSession.previewConnection?.status,
      })
    );

    const handleOpenBrowser = useCallback(() => {
      onOpenBrowser?.();
    }, [onOpenBrowser]);

    const assistantQuickActions = useMemo<AssistantMessageAction[]>(() => {
      const actions: AssistantMessageAction[] = [];

      if (shouldShowProposedPlanDecisionPrompt) {
        actions.push(
          {
            id: 'codex-implement-plan',
            label: isProposedPlanDecisionPending
              ? t('sessions.proposedPlanDecision.executing', 'Implementing plan...')
              : t('sessions.proposedPlanDecision.execute', 'Implement plan'),
            onClick: () => {
              void handleExecuteProposedPlan();
            },
            disabled: !isProposedPlanDecisionReady || isProposedPlanDecisionPending,
            icon: isProposedPlanDecisionPending ? SpinningLoaderIcon : Play,
            tone: 'accent',
          },
          {
            id: 'codex-continue-discussing',
            label: t('sessions.proposedPlanDecision.continue', 'Continue discussing'),
            onClick: handleContinueDiscussingProposedPlan,
            disabled: isProposedPlanDecisionPending,
            icon: MessageCircle,
          }
        );
      }

      // Identity matters downstream: this array invalidates the last assistant
      // turn's cached virtual rows (view.tsx assistantTurnRowsCache), and the
      // memo deps churn on every history change. Hand back a stable empty so
      // the common no-actions case never busts that cache.
      return actions.length > 0 ? actions : EMPTY_ASSISTANT_QUICK_ACTIONS;
    }, [
      handleContinueDiscussingProposedPlan,
      handleExecuteProposedPlan,
      isProposedPlanDecisionPending,
      isProposedPlanDecisionReady,
      shouldShowProposedPlanDecisionPrompt,
      t,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        focusInput: () => {
          inputAreaRef.current?.focusInput();
        },
        addCommentReference: (reference) => {
          return inputAreaRef.current?.addCommentReference(reference) ?? false;
        },
        toggleCommentReference: (reference) => {
          return inputAreaRef.current?.toggleCommentReference(reference) ?? false;
        },
        addVisualAnnotationReference: (reference) => {
          return inputAreaRef.current?.addVisualAnnotationReference(reference) ?? false;
        },
        toggleVisualAnnotationReference: (reference) => {
          return inputAreaRef.current?.toggleVisualAnnotationReference(reference) ?? false;
        },
        copyConversationHistory: handleCopyConversationHistory,
        getShareImageData: async () => {
          if (!conversationView?.turnCount) return null;
          return {
            messages: collectConversationMessages(await conversationView.readAll()),
            agentName: session.cliType === 'custom' ? sessionAgentConfig?.name : undefined,
          };
        },
        startShareImageSelection: shareSelection.start,
        openSearch,
        getLastAssistantTurnId: () => lastCompletedAssistantMessageId,
        referenceDesignSelection: (reference, label, prompt) =>
          inputAreaRef.current?.referenceDesignSelection(reference, label, prompt) ?? false,
        syncDesignSelection: (reference, label) =>
          inputAreaRef.current?.syncDesignSelection(reference, label) ?? false,
        insertSessionMention: (sessionId: string) => {
          return inputAreaRef.current?.insertSessionMention(sessionId) ?? false;
        },
      }),
      [
        handleCopyConversationHistory,
        shareSelection.start,
        lastCompletedAssistantMessageId,
        openSearch,
        session.cliType,
        sessionAgentConfig?.name,
        conversationView,
      ]
    );

    const [prevSessionIdForActionReset, setPrevSessionIdForActionReset] = useState(session.id);
    if (prevSessionIdForActionReset !== session.id) {
      setPrevSessionIdForActionReset(session.id);
      setInputActionState('ready');
      directDispatchInFlightRef.current = false;
      setPendingGoalCommand(null);
    }

    useEffect(() => {
      if (inputActionState !== 'dispatching') {
        directDispatchInFlightRef.current = false;
        return undefined;
      }

      if (isSessionWorking) {
        setInputActionState('ready');
        return undefined;
      }

      const timeoutId = window.setTimeout(() => {
        setInputActionState('ready');
      }, DISPATCHING_TIMEOUT_MS);

      return () => window.clearTimeout(timeoutId);
    }, [inputActionState, isSessionWorking, liveSessionStatus]);

    const handleStop = useCallback(async () => {
      if (!workspaceId) {
        toast.error(t('sessions.stopError'));
        return;
      }

      const goalToPause = isGoalActive && canPauseGoal ? latestGoal : null;
      const goalTurnId = goalToPause?.turnId?.trim() || null;
      const turnIdToCancel = activeAssistantTurnId ?? goalTurnId;

      if (goalToPause) {
        setInputActionState('ready');
      }

      if (!turnIdToCancel) {
        if (goalToPause) {
          await handleGoalCommand('pause', goalToPause, { showPending: false });
          return;
        }
        toast.error(t('sessions.stopError'));
        return;
      }

      setInputActionState('ready');
      try {
        const cancelOptions = resolveUserSessionStopCancelOptions({
          supportsUserStop: machineSupportsProtocolCapability(
            sessionMachine,
            MACHINE_PROTOCOL_CAPABILITIES.sessionStopControl,
            SESSION_STOP_CONTROL_USER_STOP_VERSION
          ),
          hasQueuedInput: messageQueue.length > 0,
        });
        await requestSessionCancel(session.id, turnIdToCancel, cancelOptions);
      } catch (error) {
        console.error('Failed to request session cancel', error);
        toast.error(t('sessions.stopError'), { description: getErrorMessage(error) });
        return;
      }

      if (goalToPause) {
        await handleGoalCommand('pause', goalToPause, { showPending: false });
      }
    }, [
      activeAssistantTurnId,
      canPauseGoal,
      handleGoalCommand,
      isGoalActive,
      latestGoal,
      messageQueue.length,
      requestSessionCancel,
      session.id,
      sessionMachine,
      t,
      workspaceId,
    ]);

    const handleInterruptAndSend = useCallback(async () => {
      if (isExternalHistoryRefreshing) {
        return;
      }
      if (!workspaceId || !activeAssistantTurnId) {
        toast.error(t('sessions.interruptFailed', 'Failed to interrupt current task'));
        return;
      }
      setInputActionState('ready');
      try {
        await requestSessionCancel(session.id, activeAssistantTurnId, { action: 'interrupt' });
      } catch (error) {
        console.error('Failed to interrupt for queued message', error);
        toast.error(t('sessions.interruptFailed', 'Failed to interrupt current task'), {
          description: getErrorMessage(error),
        });
      }
    }, [
      activeAssistantTurnId,
      isExternalHistoryRefreshing,
      requestSessionCancel,
      session.id,
      t,
      workspaceId,
    ]);

    const handleNativeSteerQueuedMessage = useCallback(
      async (item: MessageQueueItem) => {
        if (isExternalHistoryRefreshing || !activeAssistantTurnId) {
          return;
        }
        if (steeringQueueItemIdsRef.current.has(item.$cid)) {
          return;
        }
        steeringQueueItemIdsRef.current.add(item.$cid);
        try {
          const inputConfig = normalizeSessionTurnInputConfig(item.acpSessionConfig);
          if (!inputConfig) {
            throw new Error('Queued message input config is invalid');
          }
          const inputBlocks = normalizeSessionInputBlocks(
            inputConfig.inputBlocks,
            inputConfig.prompt ?? item.task
          );
          const pendingHistoryEntry = buildPendingUserHistoryEntry({
            userId: item.userId,
            inputBlocks,
            timestamp: item.timestamp,
            inputConfig,
            status: 'pending_apply',
          });
          if (!pendingHistoryEntry) {
            throw new Error('Queued message is empty');
          }
          const queuedUserTurnId = item.userTurnId?.trim() || `queued-${item.$cid}`;
          const { entry: historyEntry } = await addSessionHistory({
            ...pendingHistoryEntry,
            id: queuedUserTurnId,
          });
          await removeMessageQueueItem(item.$cid);
          trackMessageSend(historyEntry.id);
          touchSessionActivity(session.id).catch((error: unknown) => {
            console.warn('Failed to update session activity for steer', error);
          });
          await guideHistoryEntry(historyEntry.id, activeAssistantTurnId);
        } catch (error) {
          console.error('Failed to guide with queued message', error);
          toast.error(t('sessions.sendError'), {
            description: getErrorMessage(error),
          });
        } finally {
          steeringQueueItemIdsRef.current.delete(item.$cid);
        }
      },
      [
        activeAssistantTurnId,
        addSessionHistory,
        guideHistoryEntry,
        isExternalHistoryRefreshing,
        removeMessageQueueItem,
        session.id,
        t,
        touchSessionActivity,
        trackMessageSend,
      ]
    );

    const queueSteerCapability = session.agentConfigId
      ? sessionMachine?.acpCapabilities?.[getAcpCapabilityCacheKey(session.agentConfigId)]
      : undefined;
    const shouldUseNativeQueueSteer = shouldRequestNativeQueueSteer(
      capabilityAuthority,
      queueSteerCapability
    );
    const handleSteerQueuedMessage = useCallback(
      async (item: MessageQueueItem) => {
        if (shouldUseNativeQueueSteer) {
          await handleNativeSteerQueuedMessage(item);
          return;
        }
        await handleInterruptAndSend();
      },
      [handleInterruptAndSend, handleNativeSteerQueuedMessage, shouldUseNativeQueueSteer]
    );

    const handleReorderQueueItem = useCallback(
      async (activeCid: string, overCid: string) => {
        try {
          await reorderMessageQueueItem(activeCid, overCid);
        } catch (error) {
          console.error('Failed to reorder queued message', error);
          toast.error(t('sessions.queueReorderError', 'Failed to reorder messages'), {
            description: getErrorMessage(error),
          });
          throw error;
        }
      },
      [reorderMessageQueueItem, t]
    );

    const handleStartQueueItemEdit = useCallback(
      async (item: MessageQueueItem) => {
        const isFirstItem = messageQueue[0]?.$cid === item.$cid;
        try {
          await updateMessageQueueItem(item.$cid, (current) =>
            current.isEditing
              ? current
              : { ...current, isEditing: true, editingStartedAt: getServerNow() }
          );
          if (isFirstItem) {
            await waitUntilSynced();
          }
        } catch (error) {
          console.error('Failed to start editing queued message', error);
          toast.error(t('sessions.queueEditError', 'Failed to edit message'), {
            description: getErrorMessage(error),
          });
          throw error;
        }
      },
      [messageQueue, t, updateMessageQueueItem, waitUntilSynced]
    );

    const handleCancelQueueItemEdit = useCallback(
      async (item: MessageQueueItem) => {
        const isFirstItem = messageQueue[0]?.$cid === item.$cid;
        try {
          await updateMessageQueueItem(item.$cid, (current) =>
            current.isEditing
              ? { ...current, isEditing: false, editingStartedAt: undefined }
              : current
          );
          if (isFirstItem) {
            await waitUntilSynced();
          }
        } catch (error) {
          console.error('Failed to cancel queued message edit', error);
          toast.error(t('sessions.queueEditError', 'Failed to edit message'), {
            description: getErrorMessage(error),
          });
          throw error;
        }
      },
      [messageQueue, t, updateMessageQueueItem, waitUntilSynced]
    );

    const handleSaveQueueItemEdit = useCallback(
      async (item: MessageQueueItem, task: string) => {
        const isFirstItem = messageQueue[0]?.$cid === item.$cid;
        try {
          await updateMessageQueueItem(item.$cid, (current) =>
            buildEditedMessageQueueItem(
              current,
              task,
              t('sessions.messageQueue.imageOnly', '[Image message]')
            )
          );
          if (isFirstItem) {
            await waitUntilSynced();
          }
        } catch (error) {
          console.error('Failed to save queued message edit', error);
          toast.error(t('sessions.queueEditError', 'Failed to edit message'), {
            description: getErrorMessage(error),
          });
          throw error;
        }
      },
      [messageQueue, t, updateMessageQueueItem, waitUntilSynced]
    );

    const handleRemoveQueueItem = useCallback(
      async (itemId: string) => {
        try {
          await removeMessageQueueItem(itemId);
        } catch (error) {
          console.error('Failed to remove queued message', error);
          toast.error(t('sessions.queueRemoveError', 'Failed to remove message'), {
            description: getErrorMessage(error),
          });
        }
      },
      [removeMessageQueueItem, t]
    );

    const shouldHideHeader = hideHeader;

    const handleFilePathClick = useStableCallback((filePath: string) => {
      onFilePathClick?.(filePath);
    });
    const handleOpenHtmlAttachment = useStableCallback((file: SessionFilePayload): boolean => {
      const action = resolveSessionHtmlAttachmentAction({
        isLocalSession,
        sourcePath: file.sourcePath,
        connectionStatus: session.previewConnection?.status,
        candidateStatus: session.previewCandidate?.status,
      });
      switch (action.kind) {
        case 'open-local-file':
          if (!onOpenHtmlFile) return false;
          onOpenHtmlFile(action.sourcePath);
          return true;
        case 'open-existing-browser':
          if (!onOpenExistingBrowser) return false;
          onOpenExistingBrowser();
          return true;
        case 'confirm-reported-port':
          if (!onOpenBrowser) return false;
          setPendingRemoteHtmlFileName(file.fileName);
          return true;
        case 'fallback':
          return false;
      }
      return false;
    });
    const handleCopySessionLink = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(getAppShareUrl());
        toast.success(t('sessions.urlCopied', 'Session URL copied to clipboard'));
      } catch {
        toast.error(t('sessions.shareFailed', 'Unable to share link'));
      }
    }, [t]);

    const headerGitHubActions = headerActionsSlot;

    const permissionSessionHistory = sessionHistory as unknown as Parameters<
      typeof FloatingPermissionRequest
    >[0]['sessionHistory'];
    const shouldReplaceComposerWithPermission = hasPendingPermissionRequest(
      liveSessionStatus ?? undefined,
      permissionSessionHistory
    );

    /* Shared header pieces used by both header variants. */
    const headerDesignAction =
      session.design && onRevealDesignPanel ? (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onRevealDesignPanel}
        >
          {t('design.files.currentCanvas', 'Show artwork')}
        </Button>
      ) : null;
    const headerMenuNode = (
      <SessionHeaderMenu
        session={session}
        workspacePath={sessionWorkspacePath}
        onCopyConversationHistory={
          hideMessageArea && onCopyConversationHistoryExternal
            ? onCopyConversationHistoryExternal
            : () => {
                void handleCopyConversationHistory();
              }
        }
        onCopyUrl={() => {
          void handleCopySessionLink();
        }}
        onShareAsImage={onShareAsImage}
        onOpenSearch={hideMessageArea ? onOpenSearchExternal : openSearch}
        onFork={canForkFromMenu ? handleForkFromMenu : undefined}
        onContinueWithMolly={
          canContinueWithMolly ? () => setDesignContinuationSourceId(session.id) : undefined
        }
        isForking={forkingAssistantMessageId !== null && forkingAssistantMessageId !== undefined}
        forkWorktreeAvailability={forkWorktreeAvailability}
        onForkMenuOpen={onForkWorktreeMenuOpen}
        onRename={
          headerVariant === 'toolbar'
            ? onRequestRename
            : () => {
                setRenameDialogTarget({
                  sessionId: session.id,
                  initialTitle: session.title ?? '',
                });
              }
        }
        onOpenReviewSettings={() => openSettings('preferences')}
        openedByRelations={openedByRelations}
        onArchive={onArchiveSession}
        onRestore={onRestoreSession}
        onDelete={onDeleteSession}
        t={t}
      />
    );
    const headerArchivedNode = session.isArchived === true ? <SessionArchivedBadge /> : null;

    return (
      <PrLinkProvider>
        <SessionConversationPage
          className={className}
          dropActive={imageDropZone.isActive || sessionMentionOverlay}
          dropKind={sessionMentionOverlay ? 'session-mention' : 'files'}
          hideMessageArea={hideMessageArea}
          {...pageDropHandlers}
        >
          {/* The outline must centre in the whole conversation page, not only
              the flex area left after the composer takes its height. */}
          <div
            ref={setOutlineOverlayRoot}
            className="pointer-events-none absolute inset-0 @container"
          />
          {!shouldHideHeader &&
            (headerVariant === 'toolbar' ? (
              /* Compact toolbar for the merged desktop tab row: right-side
                 controls only — no title (the context strip owns identity) and
                 no PR badge (the strip owns PR). */
              <ErrorBoundary name="SessionChatHeader" variant="inline" resetKeys={[session.id]}>
                <div className="flex h-full shrink-0 items-center gap-1 pl-1 pr-2">
                  {headerDesignAction}
                  {headerArchivedNode}
                  {headerMenuNode}
                  {headerEndSlot}
                </div>
              </ErrorBoundary>
            ) : (
              <ErrorBoundary name="SessionChatHeader" variant="inline" resetKeys={[session.id]}>
                <SessionConversationPageHeader
                  startSlot={headerStartSlot}
                  titleSlot={
                    <SessionProjectInfo
                      session={session}
                      isLoading={shouldShowTitleLoading}
                      isSyncing={effectiveTitleSyncing}
                      isMachineOffline={sessionMachineOnlineStatus === 'offline'}
                      t={t}
                      localProjectMeta={resolvedLocalProjectMeta}
                    />
                  }
                  desktopActionsSlot={
                    <div className={cn('flex shrink-0 items-center gap-2')}>
                      {headerDesignAction}
                      {headerGitHubActions}
                      {headerArchivedNode}
                    </div>
                  }
                  menuSlot={headerMenuNode}
                  endSlot={headerEndSlot}
                  reserveMacTrafficLightInset={
                    Boolean(headerStartSlot) && isMacOSElectronRenderer() && !isElectronFullscreen
                  }
                />
              </ErrorBoundary>
            ))}
          {subHeader}
          {hideMessageArea ? null : (
            <>
              <SessionPin
                pinnedHistoryId={pinnedHistoryId}
                pinnedMessage={pinnedMessage}
                onUnpin={handleUnpin}
                onScrollToMessage={handleScrollToMessage}
              />
              <SessionSearchProvider value={searchContextValue}>
                <SessionPinContext.Provider value={pinContextValue}>
                  {/* Message area */}
                  <div ref={messageAreaRef} className="relative flex-1 min-h-0">
                    {isSearchOpen ? (
                      <SessionSearchBar
                        query={searchQuery}
                        currentIndex={activeSearchResultIndex}
                        totalCount={searchResults.length}
                        inputRef={searchInputRef}
                        onQueryChange={handleSearchQueryChange}
                        onPrevious={() => moveToSearchResult('previous')}
                        onNext={() => moveToSearchResult('next')}
                        onClose={closeSearch}
                        t={t}
                      />
                    ) : null}
                    <ErrorBoundary
                      name="SessionChatStream"
                      variant="section"
                      resetKeys={[session.id]}
                      fallbackRender={(props) => <MessageListErrorFallback {...props} />}
                    >
                      {/* Key forces remount on session change, preventing scroll state bleed between sessions */}
                      <MessageSendStatusContext.Provider value={sendingMessageIds}>
                        <MessageSelectionContext.Provider value={shareSelection.context}>
                          <SessionChatStream
                            key={session.id}
                            ref={chatStreamRef}
                            sessionId={session?.id}
                            workspaceId={workspaceId}
                            view={conversationView}
                            sessionCreatedAt={session?.createdAt}
                            dividerLabel={sessionDividerLabel}
                            className="h-full"
                            leadingContent={openedByConversationStart}
                            emptyState={EMPTY_CHAT_STREAM_EMPTY_STATE}
                            agentActivityLabel={agentActivityLabel}
                            agentActivityTone={agentActivityTone}
                            onFileDiffClick={onFileDiffClick}
                            onFilePathClick={onFilePathClick ? handleFilePathClick : undefined}
                            onOpenHtmlFile={handleOpenHtmlAttachment}
                            messageFileDiffEntriesByTurn={messageFileDiffEntriesByTurn}
                            assistantActions={assistantQuickActions}
                            assistantActionsMessageId={latestCompletedProposedPlan?.entryId}
                            onForkLastAssistant={onForkLastAssistant}
                            forkWorktreeAvailability={forkWorktreeAvailability}
                            onForkWorktreeMenuOpen={onForkWorktreeMenuOpen}
                            onEditLastUser={
                              editableLastUserMessageId ? handleEditLastUser : undefined
                            }
                            onResendUndelivered={handleResendUndelivered}
                            capacityRetry={capacityRetry ?? undefined}
                            forkingAssistantMessageId={forkingAssistantMessageId}
                            onNavigateSession={onNavigateSession}
                            onLastCompletedAssistantMessageIdChange={
                              handleLastCompletedAssistantMessageIdChange
                            }
                            conversationFontSize={conversationFontSize}
                            skipNextViewportResizeAutoScrollRef={
                              skipNextViewportResizeAutoScrollRef
                            }
                            suppressStickyAutoScrollRef={suppressStickyAutoScrollRef}
                            outlineOverlayRoot={outlineOverlayRoot}
                          />
                        </MessageSelectionContext.Provider>
                      </MessageSendStatusContext.Provider>
                    </ErrorBoundary>
                  </div>

                  {/* Floating permission request - shown when session is waiting for permission */}
                  <FloatingPermissionRequest
                    key={session.id}
                    sessionId={session.id}
                    sessionStatus={liveSessionStatus ?? undefined}
                    sessionHistory={permissionSessionHistory}
                    onStop={canStopAgent && !isArchivedSession ? handleStop : undefined}
                  />

                  {/* Notification permission prompt - shown when session becomes idle (turn completed) */}
                  <NotificationPermissionPrompt
                    sessionCompleted={session.status?.type === 'idle' && !isSessionWorking}
                  />

                  {(() => {
                    const dispatchPause = session.dispatchPause;
                    if (!shouldShowDispatchPauseInterstitial(dispatchPause)) return null;
                    return (
                      <div role="status" className="flex items-center gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1">
                          {dispatchPause.error ??
                            t(
                              'sessions.dispatchPaused',
                              'Molly stopped. Anything you queued will wait until you continue.'
                            )}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            void requestSessionCancel(session.id, dispatchPause.turnId).catch(
                              (error) => toast.error(getErrorMessage(error))
                            );
                          }}
                        >
                          {t('sessions.retryStop', 'Stop again')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            void requestSessionCancel(session.id, dispatchPause.turnId, {
                              action: 'resume',
                            }).catch((error) => toast.error(getErrorMessage(error)));
                          }}
                        >
                          {t('sessions.continueQueue', 'Continue')}
                        </Button>
                      </div>
                    );
                  })()}
                  <SessionInfoBar
                    status={statusStripState}
                    goal={latestGoal}
                    goalCommands={goalCommands}
                    goalPendingCommand={
                      pendingGoalCommand && pendingGoalCommand.threadId === latestGoal?.threadId
                        ? pendingGoalCommand.command
                        : null
                    }
                    onGoalCommand={handleGoalCardCommand}
                    onGoalDismiss={handleDismissGoalBanner}
                    scheduledTasks={pendingScheduledTasks}
                    projectName={repoFullName || resolvedLocalProjectMeta?.name || null}
                    branch={session.branchName?.trim() || null}
                    workspaceLocation={
                      session.isWorktree
                        ? {
                            // GitHub sessions are always worktrees, so surface the
                            // GitHub identity rather than the redundant worktree mark.
                            kind: repoFullName ? 'github-worktree' : 'worktree',
                            path: sessionWorkspacePath,
                          }
                        : resolvedLocalProjectMeta
                          ? { kind: 'folder', path: sessionWorkspacePath }
                          : null
                    }
                    onOpenBrowser={browserActionAvailable ? handleOpenBrowser : undefined}
                    syncing={effectiveTitleSyncing}

                    // edge-back strip so its leading chip stays tappable.
                  />

                  {/* Input area - isolated component to prevent full re-renders on typing.
                      Hidden while a permission is pending so the response buttons claim
                      the bottom surface; chat queue is bypassed for the same reason. */}
                  <MessageSelectionToolbar selection={shareSelection} />
                  <div className={shareSelection.active ? 'hidden' : 'contents'}>
                    {shouldReplaceComposerWithPermission ? null : (
                      <SessionChatInputArea
                        claimNavigationFocus={isVisible ? claimNavigationFocus : undefined}
                        ref={inputAreaRef}
                        session={session}
                        sessionLocalProjectRootPath={resolvedLocalProjectMeta?.rootPath ?? null}
                        isMachineRemoved={isMachineRemoved}
                        canStopAgent={canStopAgent}
                        isExternalHistoryRefreshing={isExternalHistoryRefreshing}
                        externalHistorySyncLabel={externalHistorySyncLabel}
                        isDark={isDark}
                        selectedModeId={selectedModeId}
                        selectedModelId={selectedModelId}
                        sessionConfigReady={sessionDocReady}
                        modeOptions={modeOptions}
                        modelOptions={modelOptions}
                        rateLimits={sessionRateLimits}
                        showCodexResetForecast={showCodexResetForecast}
                        isContextCompacting={isContextCompacting}
                        configOptionSelectors={configOptionSelectors}
                        configOptionValues={configOptionValues}
                        isRepoPublic={isRepoPublic}
                        availableCommands={availableCommands}
                        commandsEnabled={isVisible}
                        freeTurnLimitNotice={freeSessionTurnNotice}
                        queueDisplay={
                          messageQueue.length > 0 ? (
                            <MessageQueueDisplay
                              sessionId={session.id}
                              items={messageQueue}
                              onRemove={handleRemoveQueueItem}
                              onReorder={handleReorderQueueItem}
                              onEditStart={handleStartQueueItemEdit}
                              onEditCancel={handleCancelQueueItemEdit}
                              onEditSave={handleSaveQueueItemEdit}
                              onSteer={handleSteerQueuedMessage}
                              showSteerAction={
                                isSessionActive &&
                                !!activeAssistantTurnId &&
                                !isExternalHistoryRefreshing
                              }
                            />
                          ) : null
                        }
                        mcp={mcpSelection.menu}
                        skipNextViewportResizeAutoScrollRef={skipNextViewportResizeAutoScrollRef}
                        onModeChange={handleModeChange}
                        onModelChange={handleModelChange}
                        onConfigOptionChange={handleConfigOptionChange}
                        onSendMessage={handleSendMessage}
                        onStop={() => {
                          void handleStop();
                        }}
                        onRemoveQueueItem={handleRemoveQueueItem}
                        designAgentConfigs={
                          session.design
                            ? selectDesignAgentConfigsForMachine(agentConfigs, session.machineId)
                            : undefined
                        }
                        onNavigateToComment={onNavigateToComment}
                        onCommentReferencesChange={onCommentReferencesChange}
                        onVisualAnnotationReferencesChange={onVisualAnnotationReferencesChange}
                        onVisualAnnotationReferencesSubmitted={
                          onVisualAnnotationReferencesSubmitted
                        }
                      />
                    )}
                  </div>
                </SessionPinContext.Provider>
              </SessionSearchProvider>
            </>
          )}
          {canContinueWithMolly && designContinuationSourceId === session.id ? (
            <DesignContinuationDialog
              key={session.id}
              source={session}
              configs={agentConfigs.filter(
                (config) =>
                  config.machineId === session.machineId &&
                  config.cliType === 'builtin' &&
                  config.agentType === 'molly'
              )}
              onClose={() => setDesignContinuationSourceId(null)}
              onPublished={(published) => {
                setDesignContinuationSourceId(null);
                if (onNavigateSession) onNavigateSession({ sessionId: published.id });
                else if (workspaceSlug)
                  void router.navigate({
                    to: '/$workspaceName/sessions/$sessionId',
                    params: { workspaceName: workspaceSlug, sessionId: published.id },
                  });
              }}
            />
          ) : null}
          <RenameSessionDialog
            target={renameDialogTarget}
            onClose={() => setRenameDialogTarget(null)}
          />
          <AlertDialog
            open={pendingRemoteHtmlFileName !== null}
            onOpenChange={(open) => {
              if (!open) setPendingRemoteHtmlFileName(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t('sessions.htmlAttachment.openReportedPortTitle', 'Open the reported port?')}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t(
                    'sessions.htmlAttachment.openReportedPortDescription',
                    'To preview {{name}}, Molly will connect to the local port reported by the Agent and open it in Browser.',
                    { name: pendingRemoteHtmlFileName ?? '' }
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setPendingRemoteHtmlFileName(null);
                    onOpenBrowser?.();
                  }}
                >
                  {t('sessions.htmlAttachment.openReportedPortAction', 'Connect and open')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SessionConversationPage>
      </PrLinkProvider>
    );
  })
);

SessionChatInterface.displayName = 'SessionChatInterface';
