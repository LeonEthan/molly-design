import type { TFunction } from 'i18next';
import { createStore } from 'jotai';
import {
  getAgentConfigRoomId,
  getMachineRoomId,
  getSessionRoomId,
  type AgentConfigId,
  type AgentConfigCliType,
  type AgentConfigMeta,
  type LocalProjectId,
  type MachineId,
  type MachineViewMeta,
  type MessageContent,
  type GitHubCheckRun,
  type GitHubCheckRunsSummary,
  type GitHubPullRequestDetails,
  type GitHubUser,
  type MinimalVisualAnnotationAnchor,
  type SessionHistoryParsed,
  type SessionId,
  type SessionMeta,
  type SessionPullRequestMeta,
  type WorkspaceId,
} from '@molly/shared';
import { currentWorkspaceIdAtom, currentWorkspaceSlugAtom, userAtom } from '@/atoms';
import {
  agentConfigMetaCacheAtom,
  machineMetaCacheAtom,
  sessionMetaCacheAtom,
} from '@/atoms/doc-meta';
import { authTokenAtom, runtimeAtom, type WorkspaceRuntime } from '@/atoms/runtime';
import type { TaskListTask } from '@/components/task-list';
import type { SessionDiffChangeEntry } from '@/components/sessions/session-diff-summary';
import { createTourRepo } from './tour-repo';

// The data the tour's app runs on.
//
// The rule this file exists to enforce: the tour may script the DATA, never the
// UI. Everything the user looks at during the film is the product's own
// component tree — the sidebar, the stream, the side panel, the info bar, the
// composer — mounted against the fixtures below. There is no
// second implementation of any screen, so there is nothing that can drift from
// what the user will see five minutes later, and no claim the copy can make
// that the components would not actually render.
//
// It runs against its OWN jotai store. The app underneath genuinely has one,
// and the setup screens are writing real agent configs into it; pushing invented
// sessions and machines in there would be corrupting live state to tell a story.

export const TOUR_WORKSPACE_ID = 'onboarding-tour-workspace' as WorkspaceId;
export const TOUR_WORKSPACE_SLUG = 'your-workspace';
export const TOUR_MACHINE_ID = 'onboarding-tour-machine' as MachineId;
export const TOUR_STUDIO_MACHINE_ID = 'onboarding-tour-studio' as MachineId;
export const TOUR_AGENT_CONFIG_ID = 'onboarding-tour-agent' as AgentConfigId;
export const TOUR_LOCAL_PROJECT_ID = 'local:onboarding-tour' as LocalProjectId;
export const TOUR_SESSION_ID = 'onboarding-tour-session' as SessionId;
export const TOUR_USER_ID = 'onboarding-tour-user';

/**
 * Fixed, never `now`.
 *
 * A relative timestamp that ticks would re-render the sidebar and the stream on
 * a clock the tour does not own — a second playhead, quietly, in the data.
 */
const TOUR_TIME = new Date('2026-07-27T09:31:00.000Z');
const TOUR_TIME_ISO = TOUR_TIME.toISOString();

export type TourIdentity = {
  projectName: string;
  workspaceName: string;
  userEmail: string;
  userName: string;
  agentName: string;
  agentType: string;
  agentCliType: AgentConfigCliType;
};

export const DEFAULT_TOUR_IDENTITY: TourIdentity = {
  projectName: 'your-project',
  workspaceName: 'Your workspace',
  userEmail: '',
  userName: 'You',
  agentName: 'Claude Code',
  agentType: 'claude',
  agentCliType: 'builtin',
};

export function buildTourMachine(identity: TourIdentity): MachineViewMeta {
  return {
    id: TOUR_MACHINE_ID,
    name: 'This machine',
    os: 'macOS',
    cliVersion: '1.0.0',
    sessions: [],
    localProjects: {
      [TOUR_LOCAL_PROJECT_ID]: {
        id: TOUR_LOCAL_PROJECT_ID,
        name: identity.projectName,
        rootPath: `/Users/you/Code/${identity.projectName}`,
        createdAtMs: TOUR_TIME.getTime(),
      },
    },
    raceLimits: {},
  };
}

export function buildTourAgentConfig(identity: TourIdentity): AgentConfigMeta {
  return {
    id: TOUR_AGENT_CONFIG_ID,
    machineId: TOUR_MACHINE_ID,
    name: identity.agentName,
    description: 'Onboarding preview agent',
    cliType: identity.agentCliType,
    agentType: identity.agentType,
    env: {},
  };
}

export const TOUR_AGENT_CONFIG: AgentConfigMeta = buildTourAgentConfig(DEFAULT_TOUR_IDENTITY);

export function buildTourSession(identity: TourIdentity = DEFAULT_TOUR_IDENTITY): SessionMeta {
  return {
    id: TOUR_SESSION_ID,
    machineId: TOUR_MACHINE_ID,
    createdAt: TOUR_TIME_ISO,
    title: 'Extract token handling',
    userId: TOUR_USER_ID,
    status: { type: 'running' },
    cliType: identity.agentCliType,
    agentType: identity.agentType,
    agentConfigId: TOUR_AGENT_CONFIG_ID,
    project: {
      kind: 'local',
      localProjectId: TOUR_LOCAL_PROJECT_ID,
      branch: 'main',
    },
    baseBranch: 'main',
    branchName: 'molly/extract-token-handling',
    lastMessageAt: TOUR_TIME.getTime(),
  };
}

export const TOUR_PULL_REQUEST: SessionPullRequestMeta = {
  url: 'https://github.com/you/your-project/pull/128',
  status: 'open',
};

/**
 * The tasks in the sidebar.
 *
 * These are real `TaskListTask` rows, not the sidebar's simple presentational
 * shortcut. The film claims each task is on its own branch, that some are on
 * another machine, and that one of them is waiting on you — none of which the
 * shortcut has anywhere to put, so all three used to be assertions in the copy
 * beside a list that could not show them.
 */
/**
 * The two projects on screen.
 *
 * A second repository is not decoration: the sidebar GROUPS by project, and a
 * single group cannot show that grouping exists — nor that the machine a task
 * runs on is independent of the project it belongs to. Both claims are made by
 * the real `TaskList` rendering real rows, not by a sentence beside a list of
 * one.
 */
export const TOUR_PROJECT_SECONDARY = 'your-project-api';

export const TOUR_TASKS: TaskListTask[] = [
  {
    taskId: 'tour-1',
    title: 'Extract token handling',
    branchName: 'molly/extract-token-handling',
    machineName: 'This machine',
    latestMessageAt: TOUR_TIME,
    addedLines: 53,
    deletedLines: 29,
    isWorking: true,
    hasUnreadMessages: false,
    isOffline: false,
    isWaitingPermission: false,
    isWorktree: true,
  },
  {
    taskId: 'tour-2',
    title: 'Add tests for expiry',
    branchName: 'molly/expiry-tests',
    machineName: 'This machine',
    latestMessageAt: TOUR_TIME,
    addedLines: 34,
    deletedLines: 0,
    isWorking: true,
    hasUnreadMessages: false,
    isOffline: false,
    isWaitingPermission: true,
    isWorktree: true,
  },
  {
    taskId: 'tour-3',
    title: 'Update the login docs',
    branchName: 'molly/login-docs',
    machineName: 'This machine',
    latestMessageAt: TOUR_TIME,
    addedLines: 12,
    deletedLines: 4,
    isWorking: true,
    hasUnreadMessages: true,
    isOffline: false,
    isWaitingPermission: false,
    isWorktree: true,
  },
  {
    taskId: 'tour-4',
    title: 'Rename the session helpers',
    branchName: 'molly/rename-session-helpers',
    // Another machine — the entire point of that beat, visible in the row the
    // product would show it in.
    machineName: 'Studio',
    repoFullName: TOUR_PROJECT_SECONDARY,
    latestMessageAt: TOUR_TIME,
    addedLines: 21,
    deletedLines: 18,
    isWorking: true,
    hasUnreadMessages: false,
    isOffline: false,
    isWorktree: true,
    isWaitingPermission: false,
  },
  {
    taskId: 'tour-5',
    title: 'Check the migration script',
    branchName: 'molly/migration-check',
    machineName: 'Studio',
    repoFullName: TOUR_PROJECT_SECONDARY,
    latestMessageAt: TOUR_TIME,
    addedLines: 7,
    deletedLines: 2,
    isWorking: true,
    hasUnreadMessages: false,
    isOffline: false,
    isWorktree: true,
    isWaitingPermission: false,
  },
  {
    taskId: 'tour-6',
    title: 'Cache the workspace lookup',
    branchName: 'molly/cache-workspace-lookup',
    machineName: 'This machine',
    latestMessageAt: TOUR_TIME,
    addedLines: 18,
    deletedLines: 6,
    isWorking: true,
    hasUnreadMessages: false,
    isOffline: false,
    isWorktree: true,
    isWaitingPermission: false,
  },
  {
    taskId: 'tour-7',
    title: 'Drop the unused legacy exports',
    branchName: 'molly/drop-legacy-exports',
    machineName: 'This machine',
    latestMessageAt: TOUR_TIME,
    addedLines: 2,
    deletedLines: 64,
    isWorking: true,
    hasUnreadMessages: true,
    isOffline: false,
    isWorktree: true,
    isWaitingPermission: false,
  },
  {
    taskId: 'tour-8',
    title: 'Retry the flaky upload test',
    branchName: 'molly/flaky-upload-test',
    machineName: 'Studio',
    repoFullName: TOUR_PROJECT_SECONDARY,
    latestMessageAt: TOUR_TIME,
    addedLines: 9,
    deletedLines: 3,
    isWorking: true,
    hasUnreadMessages: false,
    isOffline: false,
    isWorktree: true,
    isWaitingPermission: false,
  },
  {
    taskId: 'tour-9',
    title: 'Rate-limit the preview tunnel',
    branchName: 'molly/preview-rate-limit',
    machineName: 'Studio',
    repoFullName: TOUR_PROJECT_SECONDARY,
    latestMessageAt: TOUR_TIME,
    addedLines: 31,
    deletedLines: 7,
    isWorking: true,
    hasUnreadMessages: false,
    isOffline: false,
    isWorktree: true,
    isWaitingPermission: true,
  },
  {
    taskId: 'tour-10',
    title: 'Write the release notes',
    branchName: 'molly/release-notes',
    machineName: 'This machine',
    latestMessageAt: TOUR_TIME,
    addedLines: 44,
    deletedLines: 0,
    isWorking: true,
    hasUnreadMessages: false,
    isOffline: false,
    isWorktree: true,
    isWaitingPermission: false,
  },
  {
    taskId: 'tour-11',
    title: 'Fix the dark-mode contrast on chips',
    branchName: 'molly/chip-contrast',
    machineName: 'This machine',
    latestMessageAt: TOUR_TIME,
    addedLines: 7,
    deletedLines: 7,
    isWorking: true,
    hasUnreadMessages: false,
    isOffline: false,
    isWorktree: true,
    isWaitingPermission: false,
  },
  {
    taskId: 'tour-12',
    title: 'Split the settings route',
    branchName: 'molly/split-settings-route',
    machineName: 'Studio',
    repoFullName: TOUR_PROJECT_SECONDARY,
    latestMessageAt: TOUR_TIME,
    addedLines: 26,
    deletedLines: 24,
    isWorking: true,
    hasUnreadMessages: false,
    isOffline: false,
    isWorktree: true,
    isWaitingPermission: false,
  },
];

/**
 * The pull request, as the real PR tab's own data.
 *
 * `PrTabView` is fully presentational — it takes details, threads, reviews,
 * comments and check runs as props — so the film opens the PRODUCT's pull
 * request tab rather than a picture of one. That matters more here than
 * anywhere else in the tour: "Molly keeps watching it" is a claim about a
 * surface, and the surface is right there.
 */
export const TOUR_PR_NUMBER = 128;
export const TOUR_PR_REPO = 'you/your-project';

const TOUR_PR_AUTHOR: GitHubUser = {
  login: 'you',
  id: 1,
  avatarUrl: '',
  htmlUrl: 'https://github.com/you',
};

export const TOUR_PR_DETAILS: GitHubPullRequestDetails = {
  number: TOUR_PR_NUMBER,
  nodeId: 'PR_onboarding_tour',
  title: 'Extract token handling',
  body: [
    'Pulls token issuing out of session creation into its own module and updates',
    'the call sites.',
    '',
    '- `src/auth/token.ts` is new',
    '- `createSession` no longer signs anything itself',
    '- typecheck and `pnpm test auth` pass',
  ].join('\n'),
  state: 'open',
  merged: false,
  draft: false,
  htmlUrl: 'https://github.com/you/your-project/pull/128',
  baseRef: 'main',
  headRef: 'molly/extract-token-handling',
  headSha: 'a1b2c3d4e5f60718',
  user: TOUR_PR_AUTHOR,
  createdAt: TOUR_TIME_ISO,
  updatedAt: TOUR_TIME_ISO,
  mergedAt: null,
  closedAt: null,
  additions: 53,
  deletions: 29,
  changedFiles: 3,
  commits: 2,
  mergeable: true,
  mergeableState: 'clean',
};

/**
 * The same pull request, merged.
 *
 * The film used to stop at "a pull request exists", which leaves the task
 * unfinished on screen — a strange note to end on for a film about finishing
 * things. `PrTabView` renders the merged state itself; it only needs the data.
 */
export const TOUR_PR_MERGED: GitHubPullRequestDetails = {
  ...TOUR_PR_DETAILS,
  state: 'closed',
  merged: true,
  mergedAt: TOUR_TIME_ISO,
  closedAt: TOUR_TIME_ISO,
};

export const TOUR_PR_CHECKS: GitHubCheckRunsSummary = {
  status: 'completed',
  conclusion: 'success',
  total: 2,
  runs: [
    {
      id: 1,
      name: 'typecheck',
      status: 'completed',
      conclusion: 'success',
      htmlUrl: 'https://github.com/you/your-project/actions/runs/1',
      startedAt: TOUR_TIME_ISO,
      completedAt: TOUR_TIME_ISO,
    },
    {
      id: 2,
      name: 'test',
      status: 'completed',
      conclusion: 'success',
      htmlUrl: 'https://github.com/you/your-project/actions/runs/2',
      startedAt: TOUR_TIME_ISO,
      completedAt: TOUR_TIME_ISO,
    },
  ] as GitHubCheckRun[],
};

/**
 * What the run changed, for All Changes and the side panel.
 *
 * Eight files, not three. "Read it before it lands" is a claim about REVIEW,
 * and a list short enough to take in at a glance does not need reviewing — the
 * beat only means something if the panel looks like a change you would actually
 * want to read through.
 */
export const TOUR_CHANGES: SessionDiffChangeEntry[] = [
  { filePath: 'src/auth/token.ts', add: 41, del: 0 },
  { filePath: 'src/auth/session.ts', add: 8, del: 27 },
  { filePath: 'src/auth/index.ts', add: 4, del: 2 },
  { filePath: 'src/auth/expiry.ts', add: 22, del: 5 },
  { filePath: 'src/server/middleware/require-auth.ts', add: 6, del: 9 },
  { filePath: 'src/server/routes/login.ts', add: 3, del: 11 },
  { filePath: 'tests/auth/token.test.ts', add: 58, del: 0 },
  { filePath: 'tests/auth/session.test.ts', add: 12, del: 18 },
];

/**
 * The scripted run.
 *
 * Two rules govern what may be faked, both inherited from the version before
 * this one because both were right:
 *
 *  - Only the SLOW is compressed, never the UNCERTAIN. These are tool calls
 *    with the shape real ones have — a name, its actual argument, a result —
 *    not prose narrating what the agent was "thinking". Narration where the
 *    real UI shows structure is exactly what makes a mock look like a mock.
 *  - Compression is stated on screen.
 */
const buildTourRunItems = (t: TFunction): MessageContent[] => [
  toolCall('read-1', 'Read(design.yaml)', 'read', '182 lines'),
  {
    type: 'text',
    text: t('onboarding.preview.designRead'),
  },
  toolCall('grep-1', 'Read(brief.md)', 'read', '7 matches in 4 files'),
  toolCall('read-2', 'Read(references.md)', 'read', '64 lines'),
  {
    type: 'text',
    text: t('onboarding.preview.designLayout'),
  },
  toolCall('edit-1', 'Edit(design.yaml)', 'edit', '+41 −0'),
  toolCall('edit-2', 'Edit(design.yaml)', 'edit', '+8 −27'),
  // Everything from here only exists because the permission was allowed.
  toolCall('bash-1', 'Render(design.yaml)', 'execute', '2 errors'),
  {
    type: 'text',
    text: t('onboarding.preview.designRefine'),
  },
  toolCall('edit-3', 'Edit(design.yaml)', 'edit', '+4 −2'),
  toolCall('edit-4', 'Edit(design.yaml)', 'edit', '+3 −11'),
  toolCall('bash-2', 'Render(design.yaml)', 'execute', 'clean'),
  toolCall('bash-3', 'Read(preview.png)', 'execute', '1.2 MB'),
  {
    type: 'text',
    text: t('onboarding.preview.designReview'),
  },
  toolCall('git-1', 'Read(design.yaml)', 'execute', '8 sections'),
  {
    type: 'text',
    text: t('onboarding.preview.designDone'),
  },
];

/** How many run items land before the agent stops to ask. */
export const TOUR_ITEMS_BEFORE_PERMISSION = 7;

export const TOUR_PERMISSION_REQUEST_ID = 'onboarding-tour-permission';

/**
 * The permission the run asks for, as a real pending `tool_call`.
 *
 * Rendered by the product's own `PermissionRequestCard`, in the conversation,
 * with real option shapes — so the first time this appears during actual work
 * it is recognised rather than met cold. The scripted cursor presses the real
 * button on it; nothing about the answer is simulated except who pressed.
 */
export function buildPermissionItem(answeredOptionId: string | null): MessageContent {
  return {
    type: 'tool_call',
    toolCallId: 'onboarding-tour-permission-call',
    title: 'Render(design.yaml)',
    status: answeredOptionId === null ? 'pending' : 'completed',
    kind: 'execute',
    permissionRequest: {
      requestId: TOUR_PERMISSION_REQUEST_ID,
      options: [
        { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'deny', name: 'Not this time', kind: 'reject_once' },
      ],
      ...(answeredOptionId === null
        ? {}
        : { outcome: { outcome: 'selected' as const, optionId: answeredOptionId } }),
    },
  };
}

/** The consequence of denying: real, and not dressed up as a failure. */
export const TOUR_DENIED_ITEMS: MessageContent[] = [
  {
    type: 'text',
    text: 'Understood — I won’t run anything. The edits are saved but unrendered.',
  },
  {
    type: 'text',
    text: 'When you’re ready, run the render and tell me what it shows.',
  },
];

function toolCall(
  id: string,
  title: string,
  kind: 'read' | 'edit' | 'execute',
  result: string
): MessageContent {
  return {
    type: 'tool_call',
    toolCallId: `onboarding-tour-${id}`,
    title,
    status: 'completed',
    kind,
    content: [{ type: 'content', content: { type: 'text', text: result } }],
  };
}

/** The background work rolled up inside the turn, as the product renders it. */
export const TOUR_SUBAGENT_ITEM: MessageContent = {
  type: 'subagent_task',
  taskId: 'onboarding-tour-subagent',
  subagentType: 'explore',
  description: 'Collect the brief’s color references into one palette',
  status: 'in_progress',
} as MessageContent;

/**
 * The comment the film leaves on the running preview, in the shape the real
 * annotation layer produces.
 *
 * Written out in full rather than approximated: the composer's chip reads
 * `anchor.page.pathname` and `anchor.target`, and a half-filled anchor crashes
 * it. That is a good property — the reference the tour stages is the same
 * object a real click on a real page would have produced, or it does not render
 * at all.
 */
export const TOUR_ANNOTATION_ANCHOR: MinimalVisualAnnotationAnchor = {
  version: 1,
  page: {
    url: 'http://localhost:5173/settings',
    pathname: '/settings',
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 2 },
  },
  click: {
    clientX: 420,
    clientY: 512,
    pageX: 420,
    pageY: 512,
    viewportXRatio: 0.33,
    viewportYRatio: 0.64,
  },
  target: {
    tag: 'div',
    attributes: { class: 'empty-state' },
    text: 'Nothing here yet',
    rect: { x: 300, y: 480, width: 420, height: 80 },
    rectRatio: { x: 0.23, y: 0.6, width: 0.33, height: 0.1 },
    selector: '.empty-state',
  },
  context: { ancestors: [{ tag: 'section', selector: 'section.settings' }] },
};

/**
 * The OTHER tasks' conversations.
 *
 * The parallel beat adds rows to the sidebar and then selects them in turn. A
 * selection that changes the highlight but not the conversation would say the
 * opposite of what the beat is claiming — that these are five views of one
 * thing rather than five tasks. Each row therefore has its own prompt and its
 * own short run, rendered by the same stream as the main one.
 */
export const TOUR_TASK_CONVERSATIONS: Record<string, { prompt: string; items: MessageContent[] }> =
  {
    'tour-2': {
      prompt: 'Add tests for the token expiry path.',
      items: [
        toolCall('t2-read', 'Read(src/auth/expiry.ts)', 'read', '96 lines'),
        {
          type: 'text',
          text: 'There is no coverage for the refresh window at all. Writing table-driven cases around the boundary.',
        },
        toolCall('t2-edit', 'Edit(tests/auth/token.test.ts)', 'edit', '+58 −0'),
        toolCall('t2-bash', 'Bash(pnpm test auth/token)', 'execute', 'needs approval'),
      ],
    },
    'tour-3': {
      prompt: 'The login docs still describe the old flow — bring them up to date.',
      items: [
        toolCall('t3-grep', 'Grep(signToken)', 'read', '3 matches in docs/'),
        {
          type: 'text',
          text: 'Rewrote the walkthrough against `issueToken`, and dropped the section about clearing the cache by hand.',
        },
        toolCall('t3-edit', 'Edit(docs/login.md)', 'edit', '+12 −4'),
      ],
    },
    'tour-4': {
      prompt: 'Rename the session helpers so they say what they do.',
      items: [
        toolCall('t4-grep', 'Grep(sessionHelper)', 'read', '21 matches in 9 files'),
        {
          type: 'text',
          text: 'Running this on Studio — it touches nine files and I would rather not tie up this machine for it.',
        },
        toolCall('t4-edit', 'Edit(src/session/helpers.ts)', 'edit', '+21 −18'),
      ],
    },
    'tour-5': {
      prompt: 'Check the migration script against the new token table.',
      items: [
        toolCall('t5-read', 'Read(migrations/0042_tokens.sql)', 'read', '38 lines'),
        {
          type: 'text',
          text: 'The backfill assumes every row already has an `issued_at`. Adding a guard before it runs.',
        },
      ],
    },
  };

export type TourHistoryInput = {
  prompt: string;
  /** How many run items have arrived. */
  revealed: number;
  /** null while the request is up; the option id once answered. */
  permissionAnswer: string | null;
  /** Whether the background-task rollup is showing. */
  subagents: boolean;
  /** Which sidebar row is selected. Non-first rows show their own run. */
  taskId?: string | null;
};

/**
 * The conversation, in the shape the real stream renders.
 *
 * ONE assistant turn, with everything it did as items underneath it. An earlier
 * version pushed a separate message per event, so a run with three tool calls
 * rendered as three assistant replies to one question — which is not what a
 * turn looks like.
 */
export function buildTourHistory(
  { prompt, revealed, permissionAnswer, subagents, taskId }: TourHistoryInput,
  t: TFunction
): SessionHistoryParsed[] {
  const runItems = buildTourRunItems(t);
  // A different task selected in the sidebar shows ITS conversation. The main
  // run belongs to the first row; the others are their own short runs.
  const other = taskId ? TOUR_TASK_CONVERSATIONS[taskId] : undefined;
  if (other) {
    return [
      {
        id: `onboarding-tour-user-${taskId}`,
        role: 'user',
        timestamp: TOUR_TIME_ISO,
        read: true,
        userId: TOUR_USER_ID,
        items: [{ type: 'text', text: other.prompt }],
        finished: true,
      },
      {
        id: `onboarding-tour-assistant-${taskId}`,
        role: 'assistant',
        timestamp: TOUR_TIME_ISO,
        read: true,
        items: other.items,
        finished: false,
      },
    ];
  }
  const count = Math.max(0, Math.floor(revealed));
  const items: MessageContent[] = [];
  const beforePermission = runItems.slice(0, Math.min(count, TOUR_ITEMS_BEFORE_PERMISSION));
  items.push(...beforePermission);

  if (count >= TOUR_ITEMS_BEFORE_PERMISSION) {
    items.push(buildPermissionItem(permissionAnswer));
  }
  if (permissionAnswer === 'deny') {
    items.push(...TOUR_DENIED_ITEMS);
  } else if (permissionAnswer === 'allow') {
    items.push(...runItems.slice(TOUR_ITEMS_BEFORE_PERMISSION, count));
  }
  if (subagents) items.push(TOUR_SUBAGENT_ITEM);

  const history: SessionHistoryParsed[] = [
    {
      id: 'onboarding-tour-user',
      role: 'user',
      timestamp: TOUR_TIME_ISO,
      read: true,
      userId: TOUR_USER_ID,
      items: [{ type: 'text', text: prompt }],
      finished: true,
    },
  ];
  if (items.length > 0) {
    history.push({
      id: 'onboarding-tour-assistant',
      role: 'assistant',
      timestamp: TOUR_TIME_ISO,
      read: true,
      items,
      finished: false,
    });
  }
  return history;
}

// ─── Store ────────────────────────────────────────────────────────────────────

const tourRuntime = {
  workspaceId: TOUR_WORKSPACE_ID,
  workspaceSlug: TOUR_WORKSPACE_SLUG,
  // The reused product components DO read: the composer opens the workspace
  // catalog and machine Flock documents through the repo. `createTourRepo` is
  // the read-only stand-in for local product documents.
  repo: createTourRepo(),
  // Nothing in the tour writes. A runtime that threw on read would take the
  // whole overlay down; one that silently accepted writes would let a scripted
  // surface believe it had persisted something.
  withSessionStore: async () => Promise.reject(new Error('The tour does not persist changes')),
} as unknown as WorkspaceRuntime;

export function createTourStore(identity: TourIdentity) {
  const store = createStore();
  const session = buildTourSession(identity);
  const agentConfig = buildTourAgentConfig(identity);
  store.set(currentWorkspaceIdAtom, TOUR_WORKSPACE_ID);
  store.set(currentWorkspaceSlugAtom, TOUR_WORKSPACE_SLUG);
  store.set(authTokenAtom, 'onboarding-tour-token');
  store.set(runtimeAtom, tourRuntime);
  store.set(userAtom, {
    id: TOUR_USER_ID,
    name: identity.userName,
    email: identity.userEmail,
    image: null,
  });
  store.set(machineMetaCacheAtom, {
    [getMachineRoomId(TOUR_MACHINE_ID)]: buildTourMachine(identity),
  });
  store.set(agentConfigMetaCacheAtom, {
    [getAgentConfigRoomId(TOUR_AGENT_CONFIG_ID)]: agentConfig,
  });
  store.set(sessionMetaCacheAtom, {
    [getSessionRoomId(session.id)]: session,
  });
  return store;
}

export function buildTourStableSession(identity: TourIdentity) {
  const data = {
    user: {
      id: TOUR_USER_ID,
      name: identity.userName,
      email: identity.userEmail,
      image: null,
    },
    session: { id: 'onboarding-tour-auth', userId: TOUR_USER_ID },
  };
  return {
    data,
    rawData: data,
    bootstrapSnapshot: null,
    hasLocalToken: true,
    hasRawUser: true,
    isOptimistic: false,
    isPending: false,
    isRetrying: false,
    error: null,
    confirmedUnauthenticated: false,
    refetch: async () => ({ data, error: null }),
  };
}

