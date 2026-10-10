import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import {
  AlarmClock,
  ChevronDown,
  Clock,
  Folder,
  GitBranch,
  Github,
  Pause,
  Play,
  Target,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  isSessionGoalCleared,
  isSessionGoalResumable,
  sanitizeGoalObjective,
  type PendingScheduledTask,
  type SessionGoalCommand,
  type SessionGoalMessage,
} from '@molly/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { writeTextToClipboard } from '@/lib/clipboard';
import { getGoalStatusPresentation } from '@/lib/session-goal-status';
import { formatDurationCompact, type DurationUnitLabels } from '@/lib/format-duration';
import { ClusterChip, StageChip } from './info-chip';
import { WorktreeIcon } from '@/components/icons/worktree-icon';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { GoalActionButton, formatTokensCompact } from './session-goal-banner';
import { ScheduledTaskList, useResolvedScheduledTasks } from './scheduled-tasks-panel';
import { useSessionStatusPresentation, type SessionStatusStripState } from './session-status-strip';

/**
 * Shared contract: the bar renders each item either collapsed in the cluster
 * (`mode: 'cluster'`, click promotes) or as THE active item on the stage
 * (`mode: 'stage'`, icon is an inert marker / summary opens detail).
 */
export type InfoBarItemMode = { mode: 'cluster'; onPromote: () => void } | { mode: 'stage' };

/* ── Status (offline / removed) ──────────────────────────────────────── */

export function StatusChip({
  state,
  ...itemMode
}: { state: SessionStatusStripState } & InfoBarItemMode) {
  const presentation = useSessionStatusPresentation(state);
  if (!presentation) return null;
  const { Icon, text, warning } = presentation;
  const textClassName = warning ? 'text-status-warning' : 'text-muted-foreground';

  if (itemMode.mode === 'cluster') {
    return (
      <ClusterChip
        icon={Icon}
        label={text}
        textClassName={textClassName}
        onPromote={itemMode.onPromote}
      />
    );
  }
  return <StageChip icon={Icon} label={text} textClassName={textClassName} summary={text} />;
}

/* ── Goal ────────────────────────────────────────────────────────────── */

export type GoalChipCommandHandler = (
  command: SessionGoalCommand,
  goal: SessionGoalMessage
) => void;

/**
 * Goal item. Cluster = a Target icon tinted by goal status (pulsing while
 * active); stage = "status · objective" with the detail popover carrying the
 * full objective, usage metrics, and Pause / Resume / Clear / Dismiss (this
 * replaces the old sticky top banner). A terminal/cleared goal keeps its
 * chip until dismissed.
 */
export function GoalChip({
  goal,
  commands,
  pendingCommand,
  onGoalCommand,
  onDismiss,
  ...itemMode
}: {
  goal: SessionGoalMessage;
  /** Commands the current session transport can safely dispatch. */
  commands?: readonly SessionGoalCommand[];
  pendingCommand?: SessionGoalCommand | null;
  onGoalCommand?: GoalChipCommandHandler;
  onDismiss?: (goal: SessionGoalMessage) => void;
} & InfoBarItemMode) {
  const { t } = useTranslation();
  const objective = sanitizeGoalObjective(goal.objective);
  if (!objective) return null;

  const meta = getGoalStatusPresentation(goal.status);
  const statusLabel = t(meta.labelKey, meta.fallbackLabel);
  const label = `${t('sessions.goal.banner.label', 'Goal')} · ${statusLabel}`;

  if (itemMode.mode === 'cluster') {
    // Neutral inline chrome — color is reserved for genuine status (CI, diff);
    // goal state reads from the popover, not an ambient tint or motion.
    return <ClusterChip icon={Target} label={label} onPromote={itemMode.onPromote} />;
  }

  const isPending = pendingCommand != null;
  const isCleared = isSessionGoalCleared(goal);
  const showPause =
    goal.status === 'active' && commands?.includes('pause') === true && onGoalCommand != null;
  const showResume =
    isSessionGoalResumable(goal) && commands?.includes('resume') === true && onGoalCommand != null;
  const showClear = !isCleared && commands?.includes('clear') === true && onGoalCommand != null;
  const showDismiss = isCleared && onDismiss != null;

  const durationUnitLabels: DurationUnitLabels = {
    hour: t('time.unitShort.hour', 'h'),
    minute: t('time.unitShort.minute', 'm'),
    second: t('time.unitShort.second', 's'),
  };
  const timeUsedMs = Math.max(0, Math.floor((goal.timeUsedSeconds ?? 0) * 1000));
  const timeLabel = timeUsedMs > 0 ? formatDurationCompact(timeUsedMs, durationUnitLabels) : '';
  const tokensUsed = Math.max(0, Math.floor(goal.tokensUsed ?? 0));
  const tokenBudget =
    typeof goal.tokenBudget === 'number' && goal.tokenBudget > 0
      ? Math.floor(goal.tokenBudget)
      : null;
  const showTokens = tokensUsed > 0 || tokenBudget != null;
  const tokensLabel = showTokens
    ? tokenBudget != null
      ? t('sessions.goal.metrics.tokensValueWithBudget', 'tokens: {{used}} / {{budget}}', {
          used: formatTokensCompact(tokensUsed),
          budget: formatTokensCompact(tokenBudget),
        })
      : t('sessions.goal.metrics.tokensValue', 'tokens: {{used}}', {
          used: formatTokensCompact(tokensUsed),
        })
    : '';

  const triggerCommand = (command: SessionGoalCommand) => {
    if (isPending) return;
    onGoalCommand?.(command, goal);
  };

  return (
    <StageChip
      icon={Target}
      label={label}
      summary={`${statusLabel} · ${objective}`}
      detail={{
        kind: 'popover',
        ariaLabel: t('sessions.goal.banner.label', 'Goal'),
        content: (
          <div className="flex flex-col gap-2 p-3 text-xs">
            <div className="flex items-center gap-2">
              <Target className={cn('h-4 w-4 shrink-0', meta.textClassName)} aria-hidden="true" />
              <span
                className={cn(
                  'text-[11px] font-semibold uppercase tracking-wide',
                  meta.textClassName
                )}
              >
                {t('sessions.goal.banner.label', 'Goal')}
              </span>
              <span className={cn('font-medium', meta.textClassName)}>{statusLabel}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                {timeLabel ? (
                  <span
                    className="inline-flex items-center gap-1 tabular-nums leading-none"
                    title={t('sessions.goal.metrics.elapsed', 'Elapsed time')}
                  >
                    <Clock className="relative -top-px h-3 w-3" aria-hidden="true" />
                    <span>{timeLabel}</span>
                  </span>
                ) : null}
                {tokensLabel ? <span className="tabular-nums">{tokensLabel}</span> : null}
              </span>
            </div>
            <p className="scrollbar-pro max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-snug text-foreground">
              {objective}
            </p>
            {showPause || showResume || showClear || showDismiss ? (
              <div className="flex items-center justify-end gap-1.5">
                {showPause ? (
                  <GoalActionButton
                    icon={Pause}
                    label={t('sessions.goal.actions.pause', 'Pause')}
                    onClick={() => triggerCommand('pause')}
                    disabled={isPending}
                    loading={pendingCommand === 'pause'}
                  />
                ) : null}
                {showResume ? (
                  <GoalActionButton
                    icon={Play}
                    label={t('sessions.goal.actions.resume', 'Resume')}
                    onClick={() => triggerCommand('resume')}
                    disabled={isPending}
                    loading={pendingCommand === 'resume'}
                    tone="success"
                  />
                ) : null}
                {showClear ? (
                  <GoalActionButton
                    icon={X}
                    label={t('sessions.goal.actions.clear', 'Clear')}
                    onClick={() => triggerCommand('clear')}
                    disabled={isPending}
                    loading={pendingCommand === 'clear'}
                    tone="danger"
                  />
                ) : null}
                {showDismiss ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onDismiss?.(goal)}
                    aria-label={t('sessions.goal.actions.dismiss', 'Dismiss goal banner')}
                    title={t('sessions.goal.actions.dismiss', 'Dismiss goal banner')}
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ),
      }}
    />
  );
}

/* ── Scheduled tasks ─────────────────────────────────────────────────── */

/** "12m" / "45s" / "3h" / "2d" — the schedule chip's persistent glanceable value. */
function formatCompactCountdown(
  diffMs: number,
  t: (key: string, fallback: string) => string
): string {
  if (diffMs <= 5_000) return t('sessions.scheduledTasks.firingShort', 'now');
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `${seconds}${t('time.unitShort.second', 's')}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}${t('time.unitShort.minute', 'm')}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}${t('time.unitShort.hour', 'h')}`;
  const days = Math.round(hours / 24);
  return `${days}${t('time.unitShort.day', 'd')}`;
}

/**
 * Scheduled-tasks item. Both modes keep the countdown to the soonest fire as
 * the icon's short value (its glanceable core); the stage adds the heading +
 * soonest summary, with the full task list in the detail popover.
 */
export function ScheduleChip({
  tasks,
  ...itemMode
}: { tasks: readonly PendingScheduledTask[] } & InfoBarItemMode) {
  const { t } = useTranslation();
  const { rows, nowMs } = useResolvedScheduledTasks(tasks);
  if (rows.length === 0) return null;

  const soonest = rows[0];
  const countdown =
    soonest?.fireMs !== undefined ? formatCompactCountdown(soonest.fireMs - nowMs, t) : undefined;
  const heading = t('sessions.scheduledTasks.heading');
  const summary = t('sessions.scheduledTasks.summary', { count: rows.length });
  const label = `${heading} · ${summary}`;

  if (itemMode.mode === 'cluster') {
    return (
      <ClusterChip
        icon={AlarmClock}
        label={label}
        value={countdown}
        onPromote={itemMode.onPromote}
      />
    );
  }

  return (
    <StageChip
      icon={AlarmClock}
      label={label}
      value={countdown}
      summary={`${heading} · ${soonest?.task.summary ?? summary}`}
      detail={{
        kind: 'popover',
        ariaLabel: heading,
        content: (
          <div className="flex flex-col gap-1.5 p-3">
            <div className="flex items-center gap-1.5 text-xs">
              <AlarmClock className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span className="font-medium text-foreground">{heading}</span>
              <span className="text-muted-foreground">· {summary}</span>
            </div>
            <ScheduledTaskList rows={rows} nowMs={nowMs} />
          </div>
        ),
      }}
    />
  );
}

/* ── PR / repo context ───────────────────────────────────────────────── */

export type WorkspaceLocationKind = 'worktree' | 'folder' | 'github-worktree';

export type ContextChipStandardAction = {
  kind?: 'action';
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export type ContextChipAction = ContextChipStandardAction;

function ContextChipActions({ actions }: { actions: readonly ContextChipAction[] }) {
  const { t } = useTranslation();
  const [primaryAction, ...overflowActions] = actions;
  if (!primaryAction) return null;

  return (
    <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-foreground/[0.08] bg-foreground/[0.03] dark:border-transparent dark:bg-muted-foreground/[0.08]">
      <button
        type="button"
        onClick={primaryAction.onClick}
        disabled={primaryAction.disabled}
        title={primaryAction.label}
        className="flex shrink-0 select-none items-center px-1.5 py-0.5 text-xs font-medium text-muted-foreground outline-none transition-colors enabled:hover:bg-foreground/[0.05] enabled:hover:text-foreground focus:outline-none focus:ring-0 focus:ring-offset-0 focus:shadow-none focus-visible:bg-foreground/[0.05] focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-50 dark:text-muted-foreground/80 dark:enabled:hover:bg-muted-foreground/[0.08] dark:focus-visible:bg-muted-foreground/[0.08]"
      >
        <span className="truncate">{primaryAction.label}</span>
      </button>
      {overflowActions.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('sessions.moreActions', 'More actions')}
              title={t('sessions.moreActions', 'More actions')}
              className="relative flex w-5 shrink-0 self-stretch items-center justify-center text-muted-foreground/75 outline-none transition-colors before:absolute before:left-0 before:h-3 before:w-px before:bg-foreground/10 hover:bg-foreground/[0.05] hover:text-foreground focus:outline-none focus:ring-0 focus:ring-offset-0 focus:shadow-none focus-visible:bg-foreground/[0.05] focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:before:bg-muted-foreground/15 dark:hover:bg-muted-foreground/[0.08] dark:focus-visible:bg-muted-foreground/[0.08]"
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" sideOffset={6}>
            {overflowActions.map((action) => (
              <DropdownMenuItem
                key={action.id}
                disabled={action.disabled}
                onSelect={action.onClick}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/**
 * The workspace-location affordance inside the context chip: the worktree or
 * folder glyph rendered as a copy control. Hover shows a "Worktree"/"Folder"
 * tooltip that hints the click copies the path; clicking copies it and confirms
 * with a toast. With no resolvable path it degrades to a plain, non-interactive
 * glyph that still labels the mode on hover. Worktree and local-folder sessions
 * share this control so their leading icon behaves symmetrically.
 */
function LocationControl({
  kind,
  path,
  className,
}: {
  kind: WorkspaceLocationKind;
  path?: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const trimmedPath = path?.trim() || '';
  const canCopy = trimmedPath.length > 0;
  const isGitHub = kind === 'github-worktree';
  const isFolder = kind === 'folder';

  // A GitHub session is always a worktree, so it leads with the GitHub identity
  // instead of the redundant worktree mark; the underlying path is still a
  // worktree checkout, so it copies the worktree path.
  const label = isGitHub
    ? t('sessions.infoBar.github', 'GitHub')
    : isFolder
      ? t('sessions.infoCard.folder', 'Folder')
      : t('sessions.infoCard.worktree', 'Worktree');
  const copiedMessage = isFolder
    ? t('sessions.infoBar.folderPathCopied', 'Copied the path to the folder')
    : t('sessions.infoBar.worktreePathCopied', 'Copied the path to the worktree');

  const handleCopy = useCallback(() => {
    if (!trimmedPath) return;
    void writeTextToClipboard(trimmedPath).then((ok) => {
      if (ok) toast.success(copiedMessage);
    });
  }, [trimmedPath, copiedMessage]);

  const Icon = isGitHub ? Github : isFolder ? Folder : WorktreeIcon;
  const glyph = <Icon className={cn('h-3.5 w-3.5 shrink-0', className)} />;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          {canCopy ? (
            <button
              type="button"
              onClick={handleCopy}
              aria-label={label}
              // -mr-1 cancels the stage's icon→summary gap so the glyph sits
              // close to the repo/branch text (a lone icon otherwise floats).
              className="-mr-1 flex h-6 shrink-0 select-none items-center rounded-md px-1 text-muted-foreground transition-colors hover:bg-muted-foreground/10 hover:text-foreground"
            >
              {glyph}
            </button>
          ) : (
            <span className="flex h-6 shrink-0 select-none items-center px-1 text-muted-foreground">
              {glyph}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="top">
          <span className="font-medium text-foreground">{label}</span>
          {canCopy ? (
            <span className="ml-1.5 text-muted-foreground">
              {t('sessions.infoBar.copyPathHint', 'click to copy path')}
            </span>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ContextChip({
  projectName,
  branch,
  workspaceLocation,
  actions,
  ...itemMode
}: {
  projectName?: string | null;
  branch?: string | null;
  /** The session's on-disk location: a worktree or a local folder. Drives the
   *  leading glyph (worktree/folder mark vs the default branch icon) and makes
   *  it a click-to-copy control for `path`. Omit for remote/repo-only sessions
   *  that have no local path to surface (leading icon stays an inert branch). */
  workspaceLocation?: { kind: WorkspaceLocationKind; path?: string | null } | null;
  /** Agent-driven PR/worktree actions pinned after the context summary. */
  actions?: readonly ContextChipAction[];
  /** Open the complete working-tree diff. */
} & InfoBarItemMode) {
  const { t } = useTranslation();
  const trimmedBranch = branch?.trim() || '';
  if (!projectName && !trimmedBranch && !actions?.length) return null;

  const LocationIcon =
    workspaceLocation?.kind === 'github-worktree'
      ? Github
      : workspaceLocation?.kind === 'worktree'
        ? WorktreeIcon
        : workspaceLocation?.kind === 'folder'
          ? Folder
          : GitBranch;
  const label = trimmedBranch || projectName || t('sessions.infoBar.context', 'Work context');

  if (itemMode.mode === 'cluster') {
    return <ClusterChip icon={LocationIcon} label={label} onPromote={itemMode.onPromote} />;
  }

  const copyBranchLabel = t('sessions.copyBranchName', 'Copy branch name');
  const handleCopyBranch = () => {
    if (!trimmedBranch) return;
    void writeTextToClipboard(trimmedBranch).then((ok) => {
      if (ok) {
        toast.success(t('sessions.currentBranchCopied', 'Current branch name copied to clipboard'));
      }
    });
  };

  const summary = (
    <span className="flex min-w-0 items-center gap-2 font-normal">
      {projectName ? (
        <span className="min-w-0 shrink-[2] truncate text-muted-foreground">{projectName}</span>
      ) : null}
      {trimmedBranch ? (
        <button
          type="button"
          onClick={handleCopyBranch}
          aria-label={`${copyBranchLabel}: ${trimmedBranch}`}
          title={copyBranchLabel}
          className="-mx-1 flex h-6 min-w-0 shrink items-center rounded-md px-1 text-foreground/85 transition-colors hover:bg-muted-foreground/10 hover:text-foreground"
        >
          <span className="truncate">{trimmedBranch}</span>
        </button>
      ) : null}
    </span>
  );

  const locationControl = workspaceLocation ? (
    <LocationControl kind={workspaceLocation.kind} path={workspaceLocation.path} />
  ) : null;

  return (
    <StageChip
      icon={LocationIcon}
      iconOverride={locationControl ?? undefined}
      label={label}
      textClassName="text-muted-foreground"
      summary={summary}
      trailing={actions?.length ? <ContextChipActions actions={actions} /> : undefined}
    />
  );
}

export function useScheduledTaskSignature(
  tasks: readonly PendingScheduledTask[] | undefined
): string | null {
  return useMemo(() => {
    if (!tasks || tasks.length === 0) return null;
    return tasks
      .map((task) => task.id)
      .sort()
      .join(',');
  }, [tasks]);
}
