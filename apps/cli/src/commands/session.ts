import { readSessionHistory, type SessionTurn } from '@molly/shared/session-data';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { v4 as uuidV4 } from 'uuid';
import {
  getLocalProjectGitStateAtRootPath,
  normalizeLocalProjectRootPath,
  resolveLocalProjectBranchAtRootPath,
  selectLocalProjectBranchSelector,
} from '@molly/shared/node/local-project';
import {
  type ACPSessionConfig,
  type MessageContent,
  MachineStatusResponseSchema,
  SessionStatusFactory,
  type BillingQuotaAdmission,
  countBillableSessionTurns,
  evaluateBillingQuota,
  evaluateSessionCreateQuota,
  formatSessionQuotaRejection,
  FREE_SESSION_TURN_LIMIT,
  isBillingQuotaExempt,
  getAcpCapabilityCacheKey,
  getBuiltinDefaultModeId,
  getMachineFlockAcpCapabilities,
  getMachineFlockDocId,
  readMachineFlockRowsFromFlock,
  getServerNow,
  getSessionRoomId,
  isLoroRepoDocDeleted,
  isMachineDocRoomId,
  isSessionDocRoomId,
  hasAgentRunConfigSelection,
  resolveAgentRunConfigSelection,
  resolveBaseBranchPreference,
  resolveProjectGitHubRepo,
  type AgentRunConfigSelection,
  type AcpCapabilityCacheEntry,
  type AcpConfigOptionSummary,
  type AgentConfigMeta,
  type AgentRoleId,
  type LocalProjectGitState,
  type MachineLegacyMetaFields,
  type MachineId,
  type MachineMeta,
  type ProjectRef,
  type SessionHistory,
  type SessionHistoryInput,
  type SessionQuotaKind,
  type SessionTurnInputConfig,
  type SessionId,
  type SessionMeta,
  type TaskId,
  type WorkspaceId,
  shouldQueueMachineDeleteSession,
} from '@molly/shared';
import {
  dispatchLocalControl,
  ensureWorkspaceMetaSynced,
  listAliveDocMetas,
  listAliveSessionMetas,
  listAliveRoomIds,
  LocalDaemonAvailabilityError,
  normalizeCliValue,
  syncDocForRead,
  syncWorkspaceMetaForRead,
  type AuthContext,
  type CommonCommandOptions,
} from '@/lib/command-runtime';
import { LoroDocumentManager, type SessionDocument } from '@/lib/loro/doc';
import {
  type WorkspaceBillingEntitlement,
  type MachineAccessCheckResult,
  type WorkspaceSummary,
} from '@/lib/workspace';
import { readMachineLocalProjects } from '@/lib/local-project-meta';
import { linkTaskSessionFromCli } from '@/lib/task-doc';
import { listMergedAgentConfigs } from '@/lib/agent-config-machine-flock';
import { getLogger } from '@/utils/logger';
import { formatErrorMessage } from '@/utils/format-error';
import {
  type SessionTurnOutputEvent,
  type StructuredSessionOutputMode,
  waitForTurnCompletion,
} from './session-output';

function parseEnvAssignments(entries: string[] | undefined): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const entry of entries ?? []) {
    const normalizedEntry = normalizeCliValue(entry);
    if (!normalizedEntry) continue;
    const separatorIndex = normalizedEntry.indexOf('=');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid --env entry: ${entry}. Expected KEY=VALUE.`);
    }
    const key = normalizedEntry.slice(0, separatorIndex).trim();
    if (!key) {
      throw new Error(`Invalid --env entry: ${entry}. Expected KEY=VALUE.`);
    }
    parsed[key] = normalizedEntry.slice(separatorIndex + 1);
  }
  return parsed;
}

type CommonOptions = CommonCommandOptions;

export type DelegatedSessionRequester = {
  userId: string;
};

type ResolvedSessionRequester = {
  userId: string;
  isDelegated: boolean;
};

export const DEFAULT_SESSION_LIST_LIMIT = 50;
export const MAX_MCP_SESSION_LIST_LIMIT = 200;
export const DEFAULT_SESSION_HISTORY_LIMIT = 50;
export const MAX_MCP_SESSION_HISTORY_LIMIT = 200;

type PromptOptions = {
  prompt?: string;
  promptFile?: string;
};

export type CreateOptions = CommonOptions &
  PromptOptions & {
    title?: string;
    machine?: string;
    agent?: string;
    agentConfig?: string;
    currentSessionId?: SessionId;
    defaultMachineId?: MachineId;
    requesterUserId?: string;
    /** Trusted human requester supplied by a delegated internal caller. */
    delegatedRequester?: DelegatedSessionRequester;
    sessionOwnerUserId?: string;
    parent?: string;
    useCurrentSessionAsParent?: boolean;
    repo?: string;
    localProject?: string;
    worktree?: boolean;
    branch?: string;
    mode?: string;
    model?: string;
    configOption?: string[];
    env?: string[];
    wait?: boolean;
    timeout?: number;
    /** Stable ids preallocated by durable orchestration recovery. */
    sessionId?: SessionId;
    userTurnId?: string;
    /** Molly-originated execution-chain depth for the initial input. */
    chainDepth?: number;
    /** Agent Role provenance frozen when the create Operation is accepted. */
    agentRoleId?: string;
    agentRoleRevision?: number;
    /**
     * Task this session belongs to. Inherited from the invoking session when it
     * is itself working on a task, so an agent spawning helpers keeps the whole
     * fan-out attached to the same task.
     */
    taskId?: string;
    /** Provenance for the task link; automation starts are runs, spawns inherit. */
    taskLinkOrigin?: 'run' | 'agent-spawn';
    /** Durable batch Operations intentionally bypass cooperative session quotas. */
    bypassSessionQuota?: boolean;
    /**
     * Trusted internal marker for a create whose caller already completed the
     * request-level workspace Meta read before accepting durable target ids.
     * Materialization/replay must not add a second remote read barrier.
     */
    workspaceMetaPrewriteSatisfied?: boolean;
  };

export type ChatOptions = CommonOptions &
  PromptOptions & {
    mode?: string;
    model?: string;
    configOption?: string[];
    wait?: boolean;
    timeout?: number;
  };

export async function ensureSessionCreateWorkspaceMetaFresh(args: {
  manager: Pick<LoroDocumentManager, 'syncMetaOrThrow'>;
  workspaceId: WorkspaceId;
  prewriteSatisfied: boolean;
}): Promise<void> {
  if (args.prewriteSatisfied) return;
  await syncWorkspaceMetaForRead(args.manager, `session.create:${args.workspaceId}:prewrite`);
}

type SessionStatusResult = {
  workspace: WorkspaceSummary;
  sessionId: SessionId;
  status: SessionMeta['status'];
  liveStatus: {
    state: 'idle' | 'initializing' | 'running' | 'waiting' | 'unavailable' | 'unknown';
    source: 'machine' | 'none';
    reason?: string;
  };
  machineId: MachineId;
  machineOnline: boolean;
  agent: {
    cliType: SessionMeta['cliType'];
    agentType: SessionMeta['agentType'];
    agentConfigId?: SessionMeta['agentConfigId'];
  };
  archived: boolean;
  activeTurn?: {
    assistantTurnId: string;
    processingUserMsgId?: string;
    latestUserMsgId?: string;
  };
  openedBySessionId?: SessionId;
  openedByRootSessionId?: SessionId;
  parentSessionId?: SessionId;
  latestUserMsgId?: string;
  processingUserMsgId?: string;
  lastHandledUserMsgId?: string;
};

type SessionTranscriptRole = Extract<SessionHistoryInput['role'], 'user' | 'assistant' | 'system'>;

export type SessionTranscriptEntry = {
  index: number;
  id: string;
  role: SessionTranscriptRole;
  timestamp: string;
  text: string;
};

type SessionCreateRollbackManager = {
  repo: {
    deleteDoc(roomId: string): Promise<void>;
  };
  cleanSessionDoc(sessionId: SessionId, options?: { preserveStatus?: boolean }): Promise<void>;
};

type LocalProjectSelectorCandidate = {
  id: string;
  name?: string | null;
  rootPath?: string | null;
};

type ResolvedCreateContext = {
  targetMachine: MachineMeta;
  agentConfig: AgentConfigMeta;
  project?: ProjectRef;
  parentSessionId?: SessionId;
  openedBySessionId?: SessionId;
  openedByRootSessionId?: SessionId;
  taskId?: TaskId;
};

type SessionActivityTimestampManager = {
  repo: {
    getDocMeta(roomId: string): Promise<{ meta?: unknown; deleted?: boolean } | undefined>;
    upsertDocMeta(roomId: string, meta: Partial<SessionMeta>): Promise<unknown>;
  };
};

// Re-export for backward compatibility with tests
export { normalizeCliValue };

export function resolvePromptCandidate(input: {
  prompt?: string;
  promptFileContent?: string;
  positionalPrompt?: string;
  stdinText?: string;
}): string | undefined {
  return (
    normalizeCliValue(input.prompt) ??
    normalizeCliValue(input.promptFileContent) ??
    normalizeCliValue(input.positionalPrompt) ??
    normalizeCliValue(input.stdinText)
  );
}

export function sortSessionMetas(sessions: SessionMeta[]): SessionMeta[] {
  return [...sessions].sort((left, right) => {
    const leftCreatedAt = Date.parse(left.createdAt);
    const rightCreatedAt = Date.parse(right.createdAt);
    const leftTime = left.lastMessageAt ?? (Number.isFinite(leftCreatedAt) ? leftCreatedAt : 0);
    const rightTime = right.lastMessageAt ?? (Number.isFinite(rightCreatedAt) ? rightCreatedAt : 0);
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    return right.id.localeCompare(left.id);
  });
}

export function filterSessionMetas(
  sessions: SessionMeta[],
  options: { archivedOnly?: boolean; includeAll?: boolean; openedBySessionId?: SessionId }
): SessionMeta[] {
  let result: SessionMeta[];
  if (options.includeAll) {
    result = [...sessions];
  } else if (options.archivedOnly) {
    result = sessions.filter((session) => session.isArchived === true);
  } else {
    result = sessions.filter((session) => session.isArchived !== true);
  }
  if (options.openedBySessionId) {
    result = result.filter((session) => session.openedBySessionId === options.openedBySessionId);
  }
  return result;
}

function formatAgentConfigCandidates(configs: AgentConfigMeta[]): string {
  return configs
    .map((config) => `${config.name} (${config.id})`)
    .sort((left, right) => left.localeCompare(right))
    .join(', ');
}

function selectUniqueAgentConfigByIdOrName(
  configs: AgentConfigMeta[],
  selector: string
): AgentConfigMeta {
  const normalizedSelector = normalizeCliValue(selector);
  if (!normalizedSelector) {
    throw new Error('Missing agent config selector.');
  }

  const idMatch = configs.find((config) => config.id === normalizedSelector);
  if (idMatch) {
    return idMatch;
  }

  const nameMatches = configs.filter(
    (config) => normalizeCliValue(config.name) === normalizedSelector
  );
  if (nameMatches.length === 1) {
    return nameMatches[0]!;
  }
  if (nameMatches.length > 1) {
    throw new Error(
      `Agent config selector is ambiguous: ${normalizedSelector}. Use an id instead. Candidates: ${formatAgentConfigCandidates(configs)}`
    );
  }

  throw new Error(
    `Agent config not found: ${normalizedSelector}. Candidates: ${formatAgentConfigCandidates(configs)}`
  );
}

export function resolveCreateAgentSelector(options: {
  agent?: string;
  agentConfig?: string;
}): string | undefined {
  const agent = normalizeCliValue(options.agent);
  const agentConfig = normalizeCliValue(options.agentConfig);
  if (agent && agentConfig && agent !== agentConfig) {
    throw new Error('Pass either --agent or --agent-config, not both.');
  }
  return agentConfig ?? agent;
}

function buildAgentPrompt(prompt: string, agentPrompt = ''): string {
  return [agentPrompt, prompt].filter((part) => part?.trim()).join('\n\n');
}

export function shouldWaitForSessionCompletion(options: {
  wait?: boolean;
  json?: boolean;
  jsonl?: boolean;
}): boolean {
  return options.wait === true;
}

function isTranscriptRole(role: SessionTurn['role']): role is SessionTranscriptRole {
  return role === 'user' || role === 'assistant' || role === 'system';
}

function formatTranscriptImage(item: Extract<MessageContent, { type: 'image' }>): string {
  const fileName = normalizeCliValue(item.fileName);
  return fileName ? `[image: ${fileName}]` : '[image]';
}

function formatVisibleTranscriptItem(item: MessageContent): string | undefined {
  if (item.type === 'text') {
    return normalizeCliValue(item.text);
  }

  if (item.type === 'image') {
    return formatTranscriptImage(item);
  }

  if (item.type === 'image_group') {
    const parts = item.images.map((image) => formatTranscriptImage({ type: 'image', ...image }));
    return parts.join('\n\n').trim() || undefined;
  }

  if (item.type === 'operation_completion') {
    return JSON.stringify({
      type: item.type,
      deliveryId: item.deliveryId,
      operationId: item.operationId,
      operationKind: item.operationKind,
      ...(item.progressMessageId ? { progressMessageId: item.progressMessageId } : {}),
      completion: item.completion,
      ...(item.continuation ? { continuation: item.continuation } : {}),
    });
  }

  return undefined;
}

function extractTranscriptText(
  items: MessageContent[] | undefined,
  role: SessionTranscriptRole
): string | undefined {
  if (role === 'assistant') {
    let lastVisible: string | undefined;
    for (const item of items ?? []) {
      const visible = formatVisibleTranscriptItem(item);
      if (visible) {
        lastVisible = visible;
      }
    }
    return lastVisible;
  }

  const parts: string[] = [];
  for (const item of items ?? []) {
    const visible = formatVisibleTranscriptItem(item);
    if (visible) {
      parts.push(visible);
    }
  }

  const text = parts.join('\n\n').trim();
  return text || undefined;
}

/**
 * Whether a raw history row is part of the displayable transcript. Shared by the
 * whole-history formatter and by bounded paging, so both agree on `limit`
 * counting displayable entries while positions stay raw.
 */
export function isVisibleTranscriptTurn(
  entry: SessionTurn
): entry is SessionTurn & { role: SessionTranscriptRole } {
  if (!isTranscriptRole(entry.role)) return false;
  if (
    entry.role === 'system' &&
    !(entry.items as Array<{ type?: string }> | undefined)?.some(
      (item) => item.type === 'operation_completion'
    )
  ) {
    return false;
  }
  return (
    extractTranscriptText(entry.items as MessageContent[] | undefined, entry.role) !== undefined
  );
}

/** Format one raw row at its raw position, or `undefined` when not displayable. */
export function toSessionTranscriptEntry(
  index: number,
  entry: SessionTurn
): SessionTranscriptEntry | undefined {
  if (!isVisibleTranscriptTurn(entry)) return undefined;
  const text = extractTranscriptText(entry.items as MessageContent[] | undefined, entry.role);
  if (!text) return undefined;
  return {
    index,
    id: entry.id,
    role: entry.role,
    timestamp: entry.timestamp,
    text,
  };
}

export function toSessionTranscriptEntries(
  history: readonly SessionTurn[]
): SessionTranscriptEntry[] {
  const entries: SessionTranscriptEntry[] = [];
  for (const [index, entry] of history.entries()) {
    const formatted = toSessionTranscriptEntry(index, entry);
    if (formatted) entries.push(formatted);
  }

  return entries;
}

export function selectSessionTranscriptEntries(
  entries: SessionTranscriptEntry[],
  options: { all?: boolean; limit?: number; reverse?: boolean }
): SessionTranscriptEntry[] {
  const selected = options.all ? [...entries] : entries.slice(-1 * (options.limit ?? 50));
  if (options.reverse) {
    selected.reverse();
  }
  return selected;
}

export function renderSessionTranscript(entries: SessionTranscriptEntry[]): string {
  if (entries.length === 0) {
    return 'No visible history found.';
  }

  return entries
    .map((entry) => `[${entry.role}] ${entry.timestamp} ${entry.id}\n${entry.text}`)
    .join('\n\n');
}

export function renderAssistantTurnCompletion(content: MessageContent[]): string {
  return extractTranscriptText(content, 'assistant') ?? 'No visible assistant reply found.';
}

export function hasNonPositionalPromptSource(input: {
  prompt?: string;
  promptFile?: string;
  stdinText?: string;
}): boolean {
  return (
    normalizeCliValue(input.prompt) !== undefined ||
    normalizeCliValue(input.promptFile) !== undefined ||
    normalizeCliValue(input.stdinText) !== undefined
  );
}

export function shouldReadStdinForChatArgResolution(input: {
  sessionIdArg?: string;
  promptArg?: string;
  envSessionId?: string;
  prompt?: string;
  promptFile?: string;
  stdinIsTty: boolean;
}): boolean {
  if (input.stdinIsTty) {
    return false;
  }

  if (hasNonPositionalPromptSource({ prompt: input.prompt, promptFile: input.promptFile })) {
    return false;
  }

  return (
    normalizeCliValue(input.sessionIdArg) !== undefined &&
    normalizeCliValue(input.promptArg) === undefined &&
    normalizeCliValue(input.envSessionId) !== undefined
  );
}

export function resolveRenameArgs(input: {
  sessionIdArg?: string;
  titleArg?: string;
  optionTitle?: string;
  envSessionId?: string;
}): { sessionId: SessionId; title: string } {
  const sessionIdArg = normalizeCliValue(input.sessionIdArg);
  const titleArg = normalizeCliValue(input.titleArg);
  const optionTitle = normalizeCliValue(input.optionTitle);
  const envSessionId = normalizeCliValue(input.envSessionId);

  if (optionTitle) {
    const sessionId = sessionIdArg ?? envSessionId;
    if (!sessionId) {
      throw new Error('Missing session ID. Pass one explicitly or set MOLLY_SESSION_ID.');
    }
    return {
      sessionId: sessionId as SessionId,
      title: optionTitle,
    };
  }

  if (titleArg) {
    const sessionId = sessionIdArg ?? envSessionId;
    if (!sessionId) {
      throw new Error('Missing session ID. Pass one explicitly or set MOLLY_SESSION_ID.');
    }
    return {
      sessionId: sessionId as SessionId,
      title: titleArg,
    };
  }

  if (sessionIdArg && envSessionId) {
    throw new Error(
      'Missing title. When MOLLY_SESSION_ID is set, pass --title to rename that session or provide both <sessionId> <title>.'
    );
  }

  if (!sessionIdArg && envSessionId) {
    throw new Error('Missing title. Pass it positionally or with --title.');
  }

  if (sessionIdArg) {
    throw new Error('Missing title. Pass it positionally or with --title.');
  }

  throw new Error('Missing session ID. Pass one explicitly or set MOLLY_SESSION_ID.');
}

export function resolveChatArgs(input: {
  sessionIdArg?: string;
  promptArg?: string;
  envSessionId?: string;
  hasNonPositionalPromptSource?: boolean;
}): { sessionId: SessionId; positionalPrompt?: string } {
  const sessionIdArg = normalizeCliValue(input.sessionIdArg);
  const promptArg = normalizeCliValue(input.promptArg);
  const envSessionId = normalizeCliValue(input.envSessionId);

  if (promptArg) {
    const sessionId = sessionIdArg ?? envSessionId;
    if (!sessionId) {
      throw new Error('Missing session ID. Pass one explicitly or set MOLLY_SESSION_ID.');
    }
    return {
      sessionId: sessionId as SessionId,
      positionalPrompt: promptArg,
    };
  }

  if (sessionIdArg && envSessionId && !input.hasNonPositionalPromptSource) {
    return {
      sessionId: envSessionId as SessionId,
      positionalPrompt: sessionIdArg,
    };
  }

  const sessionId = sessionIdArg ?? envSessionId;
  if (!sessionId) {
    throw new Error('Missing session ID. Pass one explicitly or set MOLLY_SESSION_ID.');
  }

  return {
    sessionId: sessionId as SessionId,
  };
}

export async function rollbackPendingSessionCreate(
  manager: SessionCreateRollbackManager,
  sessionId: SessionId,
  logger: Pick<ReturnType<typeof getLogger>, 'warn'> = getLogger('session')
): Promise<void> {
  const sessionRoomId = getSessionRoomId(sessionId);

  try {
    await manager.repo.deleteDoc(sessionRoomId);
  } catch (error) {
    logger.warn(
      `Failed to delete session metadata during rollback for ${sessionId}: ${formatErrorMessage(
        error
      )}`
    );
  }

  try {
    await manager.cleanSessionDoc(sessionId, { preserveStatus: true });
  } catch (error) {
    logger.warn(
      `Failed to clean session document during rollback for ${sessionId}: ${formatErrorMessage(
        error
      )}`
    );
  }
}

async function listSessionMetasForWorkspace(manager: LoroDocumentManager): Promise<SessionMeta[]> {
  return (await listAliveSessionMetas(manager)).map((entry) => entry.meta);
}

/**
 * Session quotas are cooperative, so the entitlement only has to select the
 * plan (see context/billing-entitlements.md). Caching the in-flight promise
 * keeps create / chat off the network on the prompt hot path — and collapses
 * concurrent callers onto one query — while still noticing a plan change
 * within a minute.
 */
const BILLING_ENTITLEMENT_CACHE_TTL_MS = 60_000;
const billingEntitlementCache = new Map<
  string,
  {
    port: NonNullable<LoroDocumentManager['cloudBilling']>;
    expiresAt: number;
    entitlement: Promise<WorkspaceBillingEntitlement>;
  }
>();

async function getWorkspaceBillingEntitlementBestEffort(
  manager: LoroDocumentManager,
  workspace: WorkspaceSummary
): Promise<WorkspaceBillingEntitlement | null> {
  const port = manager.cloudBilling;
  if (!port) {
    return null;
  }
  const now = getServerNow();
  let entry = billingEntitlementCache.get(workspace.id);
  if (!entry || entry.port !== port || entry.expiresAt <= now) {
    entry = {
      port,
      expiresAt: now + BILLING_ENTITLEMENT_CACHE_TTL_MS,
      entitlement: port.getWorkspaceEntitlement(workspace.id as WorkspaceId),
    };
    billingEntitlementCache.set(workspace.id, entry);
  }
  try {
    return await entry.entitlement;
  } catch (error) {
    // A failure must not be cached for the rest of the TTL.
    if (billingEntitlementCache.get(workspace.id) === entry) {
      billingEntitlementCache.delete(workspace.id);
    }
    getLogger('session').warn(
      `Billing entitlement unavailable; allowing local operation: ${formatErrorMessage(error)}`
    );
    return null;
  }
}

function assertQuotaAdmission(admission: BillingQuotaAdmission, kind: SessionQuotaKind): void {
  if (admission.allowed) return;
  throw new Error(formatSessionQuotaRejection(kind, admission));
}

async function assertSessionCreateQuota(args: {
  workspace: WorkspaceSummary;
  manager: LoroDocumentManager;
  sessionId?: SessionId;
}): Promise<void> {
  if (args.sessionId) {
    const existing = await args.manager.repo.getDocMeta(getSessionRoomId(args.sessionId));
    if (existing?.meta && !isLoroRepoDocDeleted(existing)) {
      return;
    }
  }

  // The count is the expensive part, so settle the plan first: an exempt
  // workspace never has to pay for the scan.
  const entitlement = await getWorkspaceBillingEntitlementBestEffort(args.manager, args.workspace);
  if (!entitlement || isBillingQuotaExempt(entitlement)) return;
  // Existence rows already carry the count; materializing every session's meta
  // just to take a length is the expensive way to ask.
  const sessionCount = (await listAliveRoomIds(args.manager, isSessionDocRoomId)).length;
  assertQuotaAdmission(
    evaluateSessionCreateQuota({ ...entitlement, sessionCount }),
    'session_create'
  );
}

async function checkSessionTurnQuotaAndReadHistory(args: {
  manager: LoroDocumentManager;
  workspace: WorkspaceSummary;
  sessionDoc: SessionDocument;
  userTurnId?: string;
}): Promise<SessionHistory[] | undefined> {
  // Same ordering as session create: settle the plan before reading the doc.
  const entitlement = await getWorkspaceBillingEntitlementBestEffort(args.manager, args.workspace);
  if (!entitlement || isBillingQuotaExempt(entitlement)) return undefined;
  const [history, queue] = await Promise.all([
    readSessionHistory(args.sessionDoc.sessionData.history),
    args.sessionDoc.getMessageQueue(),
  ]);
  if (
    args.userTurnId &&
    (history.some((entry) => entry.id === args.userTurnId) ||
      queue.some((item) => item.userTurnId === args.userTurnId))
  ) {
    return history;
  }
  assertQuotaAdmission(
    evaluateBillingQuota({
      ...entitlement,
      current: countBillableSessionTurns({ history, queue }),
      limit: FREE_SESSION_TURN_LIMIT,
    }),
    'session_turn'
  );
  return history;
}

export async function listChildSessionIds(
  manager: LoroDocumentManager,
  parentSessionId: SessionId
): Promise<SessionId[]> {
  return (await listSessionMetasForWorkspace(manager))
    .filter(
      (session) => session.parentSessionId === parentSessionId && session.id !== parentSessionId
    )
    .map((session) => session.id);
}

async function syncMachineFlockDocsForRead(
  manager: LoroDocumentManager,
  workspaceId: WorkspaceId,
  machineIds: readonly MachineId[],
  reason: string
): Promise<void> {
  await Promise.all(
    Array.from(new Set(machineIds)).map(
      async (machineId) =>
        await manager.syncFlockDocOrThrow(getMachineFlockDocId(workspaceId, machineId), {
          reason: `${reason}:${machineId}`,
        })
    )
  );
}

export async function resolveLocalProjectRefOrThrow(
  manager: LoroDocumentManager,
  workspaceId: WorkspaceId,
  machineId: MachineId,
  selector: string,
  requestedBranch?: string,
  useWorktree?: boolean
): Promise<ProjectRef> {
  await syncMachineFlockDocsForRead(manager, workspaceId, [machineId], 'session.local-projects');
  const localProjects = Object.values(
    await readMachineLocalProjects(manager.repo, workspaceId, machineId)
  );
  if (localProjects.length === 0) {
    throw new Error('No local project is registered on this machine for the target workspace.');
  }

  const normalizedSelector = normalizeCliValue(selector);
  if (!normalizedSelector) {
    throw new Error('Missing local project selector.');
  }

  const matches = selectLocalProjectsBySelector(localProjects, normalizedSelector);

  if (matches.length === 0) {
    throw new Error(
      `Local project not found: ${normalizedSelector}. Candidates: ${localProjects
        .map((project) => `${project.name} (${project.id})`)
        .join(', ')}`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Local project selector is ambiguous: ${normalizedSelector}. Use a project id instead.`
    );
  }

  const project = matches[0]!;
  const branch = await resolveLocalProjectBranchForCreate(project, requestedBranch, {
    requireGit: useWorktree === true,
  });

  return {
    kind: 'local',
    localProjectId: project.id,
    ...(branch ? { branch } : {}),
    ...(useWorktree === true ? { useWorktree: true } : {}),
  };
}

export async function resolveLocalProjectBranchForCreate(
  project: { rootPath: string },
  requestedBranch?: string,
  options: { requireGit?: boolean } = {}
): Promise<string | undefined> {
  // A direct local-project session runs in the project's current working
  // directory. Capturing its current branch here would turn a harmless
  // snapshot into a later `git switch` if the directory changes before the
  // daemon starts the session. Branch selection is meaningful only when the
  // caller explicitly requested one or when a worktree needs a base ref.
  if (!requestedBranch?.trim() && options.requireGit !== true) {
    return undefined;
  }

  const gitState = await getLocalProjectGitStateAtRootPath(project.rootPath);
  if (!gitState.git) {
    if (options.requireGit === true) {
      throw new Error('Cannot use --worktree with a local project that is not a git repository.');
    }
    if (requestedBranch) {
      throw new Error('Cannot use --branch with a local project that is not a git repository.');
    }
    return undefined;
  }

  if (gitState.branches.length === 0) {
    if (requestedBranch?.trim()) {
      throw new Error(`Local project branch not found: ${requestedBranch.trim()}`);
    }
    if (options.requireGit === true) {
      throw new Error('The local project does not have a branch to use as a worktree base.');
    }
    return undefined;
  }

  const branch = resolveBaseBranchPreference({
    preferredBranch: requestedBranch,
    baseBranch: gitState.currentBranch,
    fallbackBranch: gitState.defaultBranch ?? gitState.branches[0],
  });
  // `branch` is either a selector this project reported or a name a human typed
  // as `--branch`. A typed `main` may match both refs/heads/main and
  // refs/remotes/origin/main, so validate it the way git resolves it.
  await resolveLocalProjectBranchAtRootPath(project.rootPath, branch, {
    preferLocalOnCollision: true,
  });
  return branch;
}

function isPathLikeLocalProjectSelector(selector: string): boolean {
  return (
    selector === '.' ||
    selector === '..' ||
    selector.startsWith('./') ||
    selector.startsWith('.\\') ||
    selector.startsWith('../') ||
    selector.startsWith('..\\') ||
    selector.includes('/') ||
    selector.includes('\\') ||
    /^[A-Za-z]:/.test(selector)
  );
}

export function normalizeLocalProjectPathSelector(selector: string): string | undefined {
  const normalizedSelector = normalizeCliValue(selector);
  if (!normalizedSelector || !isPathLikeLocalProjectSelector(normalizedSelector)) {
    return undefined;
  }
  return normalizeLocalProjectRootPath(normalizedSelector);
}

export function selectLocalProjectsBySelector<T extends LocalProjectSelectorCandidate>(
  localProjects: T[],
  selector: string
): T[] {
  const normalizedSelector = normalizeCliValue(selector);
  if (!normalizedSelector) {
    return [];
  }

  const normalizedPathSelector = normalizeLocalProjectPathSelector(normalizedSelector);
  return localProjects.filter((project) => {
    const projectRootPath = normalizeCliValue(project.rootPath);
    return (
      project.id === normalizedSelector ||
      normalizeCliValue(project.name) === normalizedSelector ||
      projectRootPath === normalizedSelector ||
      (normalizedPathSelector !== undefined &&
        projectRootPath !== undefined &&
        normalizeLocalProjectRootPath(projectRootPath) === normalizedPathSelector)
    );
  });
}

export function filterAuthorizedLocalProjectCandidates<T extends LocalProjectSelectorCandidate>(
  localProjects: readonly T[],
  authorizedLocalProjectIds: ReadonlySet<string>
): T[] {
  return localProjects.filter((project) => authorizedLocalProjectIds.has(project.id));
}

async function resolveSessionMetaOrThrow(
  manager: LoroDocumentManager,
  sessionId: SessionId
): Promise<SessionMeta> {
  const raw = await manager.repo.getDocMeta(getSessionRoomId(sessionId));
  if (!raw?.meta || isLoroRepoDocDeleted(raw)) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return raw.meta as SessionMeta;
}

async function appendUserPromptHistory(args: {
  sessionDoc: SessionDocument;
  prompt: string;
  userId: string;
  inputConfig?: SessionHistoryInput['inputConfig'];
  preallocatedId?: string;
  /** History the caller already read, so the idempotency check can skip a re-read. */
  knownHistory?: readonly SessionHistory[];
}): Promise<{ id: string; timestamp: string; inputConfig?: SessionTurnInputConfig }> {
  const { sessionDoc, prompt, userId, inputConfig, preallocatedId } = args;
  const historyId = preallocatedId?.trim() || uuidV4();
  if (preallocatedId) {
    const history = args.knownHistory ?? readSessionHistory(sessionDoc.sessionData.history);
    const existing = history.find((entry) => entry.id === historyId);
    if (existing) {
      const existingText = existing.items?.find((item) => item.type === 'text');
      if (
        existing.role !== 'user' ||
        existingText?.type !== 'text' ||
        existingText.text !== prompt ||
        !isDeepStrictEqual(existing.inputConfig ?? {}, inputConfig ?? {})
      ) {
        throw new Error(`Preallocated user turn id is already used: ${historyId}`);
      }
      return {
        id: historyId,
        timestamp: existing.timestamp,
        ...(existing.inputConfig ? { inputConfig: existing.inputConfig } : {}),
      };
    }
  }
  const timestamp = new Date(getServerNow()).toISOString();
  const entry: SessionHistoryInput = {
    id: historyId,
    role: 'user',
    timestamp,
    status: 'pending',
    read: false,
    userId,
    items: [{ type: 'text', text: prompt }],
    inputConfig,
    fileDiff: [],
    finished: true,
  };
  await sessionDoc.sessionData.commands.appendTurn(entry);
  return {
    id: historyId,
    timestamp,
    ...(inputConfig ? { inputConfig: inputConfig as SessionTurnInputConfig } : {}),
  };
}

function buildCliHistoryInputConfig(args: {
  prompt: string;
  cliType: SessionMeta['cliType'];
  agentType: SessionMeta['agentType'];
  modeId?: string;
  modelId?: string;
  configOptionValues?: Record<string, string | boolean>;
  taskToolsEnabled?: boolean;
  resume?: ACPSessionConfig['resume'];
  chainDepth?: number;
}): NonNullable<SessionHistoryInput['inputConfig']> {
  return {
    prompt: args.prompt,
    cliType: args.cliType,
    agentType: args.agentType,
    modeId: args.modeId,
    modelId: args.modelId,
    configOptionValues:
      args.configOptionValues && Object.keys(args.configOptionValues).length > 0
        ? args.configOptionValues
        : undefined,
    taskToolsEnabled: args.taskToolsEnabled === true,
    resume: args.resume,
    chainDepth: args.chainDepth,
  };
}

export type ResolvedTurnDispatchConfig = {
  modeId?: string;
  modelId?: string;
  configOptionValues?: Record<string, string | boolean>;
  /** Frozen capability gate for the built-in Molly Task MCP tools. */
  taskToolsEnabled?: boolean;
  /** Prevent create replay from re-reading mutable defaults from the requester history. */
  inheritSessionDefaults?: false;
  /**
   * Upgrade compatibility for Operations accepted before per-target configs
   * were stored. Filter this frozen requester input against the resolved target
   * agent kind before treating it as inherited defaults.
   */
  frozenInheritedInputConfig?: SessionTurnInputConfig;
  /**
   * Semantic run-config selection (model / reasoning effort / fast / plan) that
   * only becomes concrete ACP ids once the target agent's capabilities are
   * known. Resolved by `applyAgentRunConfigSelection` before validation.
   *
   * Session creation only: `sendSessionChatResult` does not resolve it, because
   * a follow-up turn keeps the settings the session was created with.
   */
  runConfig?: AgentRunConfigSelection;
};

/**
 * Turns a semantic run-config selection into the concrete mode/model/config
 * option values the target agent advertises. Explicit ids on the config win over
 * the semantic selection only where the selection produced nothing.
 *
 * Returns the ids the resolver validated against the TARGET model so the caller
 * can exclude them from the probed-model snapshot check, plus any selection that
 * could not be verified offline.
 */
export function applyAgentRunConfigSelection(
  config: ResolvedTurnDispatchConfig,
  capability: AcpCapabilityCacheEntry | undefined
): {
  config: ResolvedTurnDispatchConfig;
  validatedConfigIds: ReadonlySet<string>;
  unverifiedSelections: readonly string[];
} {
  const { runConfig, ...rest } = config;
  if (!hasAgentRunConfigSelection(runConfig)) {
    return { config: rest, validatedConfigIds: new Set(), unverifiedSelections: [] };
  }
  const resolved = resolveAgentRunConfigSelection(runConfig, capability);
  const configOptionValues = {
    ...(rest.configOptionValues ?? {}),
    ...(resolved.configOptionValues ?? {}),
  };
  return {
    config: {
      ...(rest.taskToolsEnabled !== undefined ? { taskToolsEnabled: rest.taskToolsEnabled } : {}),
      ...((resolved.modeId ?? rest.modeId) ? { modeId: resolved.modeId ?? rest.modeId } : {}),
      ...((resolved.modelId ?? rest.modelId) ? { modelId: resolved.modelId ?? rest.modelId } : {}),
      ...(Object.keys(configOptionValues).length > 0 ? { configOptionValues } : {}),
    },
    validatedConfigIds: new Set(resolved.validatedConfigIds ?? []),
    unverifiedSelections: resolved.unverifiedSelections ?? [],
  };
}

function parseConfigOptionAssignments(
  values: string[] | undefined
): Record<string, string | boolean> | undefined {
  const result: Record<string, string | boolean> = {};
  for (const value of values ?? []) {
    const separator = value.indexOf('=');
    if (separator <= 0) {
      throw new Error(`Invalid --config-option value: ${value}. Expected key=value.`);
    }
    const key = value.slice(0, separator).trim();
    const rawValue = value.slice(separator + 1).trim();
    if (!key) {
      throw new Error(`Invalid --config-option value: ${value}. Key is empty.`);
    }
    if (rawValue === 'true') {
      result[key] = true;
    } else if (rawValue === 'false') {
      result[key] = false;
    } else {
      result[key] = rawValue;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function resolveTurnDispatchConfig(args: {
  mode?: string;
  model?: string;
  configOption?: string[];
}): ResolvedTurnDispatchConfig {
  const modeId = normalizeCliValue(args.mode);
  const modelId = normalizeCliValue(args.model);

  return {
    modeId: modeId ?? undefined,
    modelId: modelId ?? undefined,
    configOptionValues: parseConfigOptionAssignments(args.configOption),
  };
}

export function withBuiltinDefaultTurnMode(
  config: ResolvedTurnDispatchConfig,
  target: Pick<SessionMeta, 'cliType' | 'agentType'>,
  capability?: AcpCapabilityCacheEntry
): ResolvedTurnDispatchConfig {
  if (config.modeId || typeof config.configOptionValues?.mode === 'string') {
    return config;
  }
  const modeId = getBuiltinDefaultModeId(target.cliType, target.agentType);
  if (!modeId) {
    return config;
  }
  // Match the UI selector: only apply Lody's builtin default when the adapter
  // actually offers that mode. Grok used to inherit Codex `agent` and Role/MCP
  // creates then failed with "Unsupported ACP mode for the selected agent".
  if (capability && !getSupportedTurnSelectorIds(capability, 'mode').has(modeId)) {
    return config;
  }
  return { ...config, modeId };
}

function mergeTurnDispatchConfig(
  explicitConfig: ResolvedTurnDispatchConfig,
  fallbackConfig: ResolvedTurnDispatchConfig | undefined
): ResolvedTurnDispatchConfig {
  return {
    modeId: explicitConfig.modeId ?? fallbackConfig?.modeId,
    modelId: explicitConfig.modelId ?? fallbackConfig?.modelId,
    configOptionValues: explicitConfig.configOptionValues ?? fallbackConfig?.configOptionValues,
    taskToolsEnabled: explicitConfig.taskToolsEnabled ?? fallbackConfig?.taskToolsEnabled,
  };
}

function validateConfigOptionValue(
  option: AcpConfigOptionSummary,
  value: string | boolean
): string | undefined {
  if (option.type === 'boolean') {
    return typeof value === 'boolean'
      ? undefined
      : `Config option "${option.id}" expects a boolean value.`;
  }
  if (typeof value !== 'string') {
    return `Config option "${option.id}" expects a select value.`;
  }
  if (!option.options.some((candidate) => candidate.value === value)) {
    return `Invalid value for config option "${option.id}": ${value}. Allowed values: ${option.options
      .map((candidate) => candidate.value)
      .join(', ')}.`;
  }
  return undefined;
}

export function validateTurnConfigOptionValues(
  values: Record<string, string | boolean> | undefined,
  capability: AcpCapabilityCacheEntry | undefined,
  /**
   * Ids already validated against the model actually being selected. The
   * capability's `configOptions` only describe the probed model, so re-checking
   * them here would reject values that are valid for the target model.
   */
  skipIds?: ReadonlySet<string>
): void {
  const entries = Object.entries(values ?? {}).filter(([id]) => !skipIds?.has(id));
  if (entries.length === 0) {
    return;
  }
  if (!capability?.configOptions) {
    throw new Error('ACP config options are unavailable for the selected agent.');
  }
  const optionsById = new Map(capability.configOptions.map((option) => [option.id, option]));
  for (const [id, value] of entries) {
    const option = optionsById.get(id);
    if (!option) {
      throw new Error(`Unknown ACP config option for the selected agent: ${id}.`);
    }
    const error = validateConfigOptionValue(option, value);
    if (error) {
      throw new Error(error);
    }
  }
}

export function filterCompatibleTurnConfigOptionValues(
  values: Record<string, string | boolean> | undefined,
  capability: AcpCapabilityCacheEntry | undefined
): Record<string, string | boolean> | undefined {
  if (!values || !capability?.configOptions) {
    return undefined;
  }
  const optionsById = new Map(capability.configOptions.map((option) => [option.id, option]));
  const compatible = Object.fromEntries(
    Object.entries(values).filter(([id, value]) => {
      const option = optionsById.get(id);
      return option !== undefined && validateConfigOptionValue(option, value) === undefined;
    })
  );
  return Object.keys(compatible).length > 0 ? compatible : undefined;
}

function getSupportedTurnSelectorIds(
  capability: AcpCapabilityCacheEntry | undefined,
  category: 'mode' | 'model'
): Set<string> {
  const ids = new Set<string>(
    category === 'mode'
      ? (capability?.modes ?? []).map((mode) => mode.id)
      : (capability?.models ?? []).map((model) => model.modelId)
  );
  for (const option of capability?.configOptions ?? []) {
    if (option.category !== category || option.type !== 'select') {
      continue;
    }
    for (const candidate of option.options) {
      if (typeof candidate.value === 'string') {
        ids.add(candidate.value);
      }
    }
  }
  return ids;
}

export function validateTurnModeAndModel(
  config: Pick<ResolvedTurnDispatchConfig, 'modeId' | 'modelId'>,
  capability: AcpCapabilityCacheEntry | undefined
): void {
  if (config.modeId && !getSupportedTurnSelectorIds(capability, 'mode').has(config.modeId)) {
    throw new Error(`Unsupported ACP mode for the selected agent: ${config.modeId}.`);
  }
  if (config.modelId && !getSupportedTurnSelectorIds(capability, 'model').has(config.modelId)) {
    throw new Error(`Unsupported ACP model for the selected agent: ${config.modelId}.`);
  }
}

export function filterCompatibleInheritedTurnConfig(
  config: ResolvedTurnDispatchConfig | undefined,
  capability: AcpCapabilityCacheEntry | undefined
): ResolvedTurnDispatchConfig | undefined {
  if (!config) {
    return undefined;
  }
  const supportedModes = getSupportedTurnSelectorIds(capability, 'mode');
  const supportedModels = getSupportedTurnSelectorIds(capability, 'model');
  const configOptionValues = filterCompatibleTurnConfigOptionValues(
    config.configOptionValues,
    capability
  );
  return {
    ...(config.modeId && supportedModes.has(config.modeId) ? { modeId: config.modeId } : {}),
    ...(config.modelId && supportedModels.has(config.modelId) ? { modelId: config.modelId } : {}),
    ...(configOptionValues ? { configOptionValues } : {}),
    ...(config.taskToolsEnabled !== undefined ? { taskToolsEnabled: config.taskToolsEnabled } : {}),
  };
}

async function readAgentAcpCapability(args: {
  manager: LoroDocumentManager;
  workspaceId: WorkspaceId;
  machineId: MachineId;
  agentConfigId?: AgentConfigMeta['id'];
}): Promise<AcpCapabilityCacheEntry | undefined> {
  if (!args.agentConfigId) {
    return undefined;
  }
  await syncMachineFlockDocsForRead(
    args.manager,
    args.workspaceId,
    [args.machineId],
    'session.acp-capabilities'
  );
  const handle = await args.manager.repo.openFlockDoc(
    getMachineFlockDocId(args.workspaceId, args.machineId)
  );
  const capabilities = getMachineFlockAcpCapabilities(
    readMachineFlockRowsFromFlock(handle.flock, { families: ['acpCapability'] })
  );
  return capabilities[getAcpCapabilityCacheKey(args.agentConfigId)];
}

export function resolveTurnDispatchConfigFromInputConfig(
  inputConfig: SessionTurnInputConfig | undefined,
  agentConfig: AgentConfigMeta
): ResolvedTurnDispatchConfig | undefined {
  if (
    inputConfig?.cliType !== agentConfig.cliType ||
    inputConfig.agentType !== agentConfig.agentType
  ) {
    return undefined;
  }
  return {
    ...(inputConfig.modeId ? { modeId: inputConfig.modeId } : {}),
    ...(inputConfig.modelId ? { modelId: inputConfig.modelId } : {}),
    ...(inputConfig.configOptionValues
      ? { configOptionValues: inputConfig.configOptionValues }
      : {}),
    ...(inputConfig.taskToolsEnabled !== undefined
      ? { taskToolsEnabled: inputConfig.taskToolsEnabled }
      : {}),
  };
}

async function resolveSessionTurnDispatchDefaults(
  manager: LoroDocumentManager,
  sessionId: SessionId,
  agentConfig: AgentConfigMeta
): Promise<ResolvedTurnDispatchConfig | undefined> {
  const sessionDoc = await manager.getOrCreateSessionDoc(sessionId);
  const history = readSessionHistory(sessionDoc.sessionData.history);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry?.role !== 'user') {
      continue;
    }
    const defaults = resolveTurnDispatchConfigFromInputConfig(
      entry.inputConfig as SessionTurnInputConfig | undefined,
      agentConfig
    );
    if (defaults) {
      return defaults;
    }
  }
  return undefined;
}

async function removeHistoryEntryById(
  sessionDoc: SessionDocument,
  historyId: string
): Promise<void> {
  await sessionDoc.sessionData.commands.applyHistoryAction({
    kind: 'remove-turn',
    turnId: historyId,
  });
}

export async function updateSessionActivityTimestamps(
  manager: SessionActivityTimestampManager,
  sessionId: SessionId
): Promise<void> {
  const nowMs = getServerNow();
  const roomId = getSessionRoomId(sessionId);
  const existing = await manager.repo.getDocMeta(roomId);
  if (isLoroRepoDocDeleted(existing)) return;
  const meta = existing?.meta as SessionMeta | undefined;

  await manager.repo.upsertDocMeta(roomId, {
    lastMessageAt: nowMs,
    lastReadAt: nowMs,
  } satisfies Partial<SessionMeta>);

  const parentSessionId = meta?.parentSessionId;
  if (!parentSessionId || parentSessionId === sessionId) {
    return;
  }

  const parentRoomId = getSessionRoomId(parentSessionId);
  const parentExisting = await manager.repo.getDocMeta(parentRoomId);
  if (isLoroRepoDocDeleted(parentExisting)) return;
  const parentMeta = parentExisting?.meta as SessionMeta | undefined;
  const parentPatch: Partial<SessionMeta> = {};
  const parentLastMessageAt =
    typeof parentMeta?.lastMessageAt === 'number' && Number.isFinite(parentMeta.lastMessageAt)
      ? parentMeta.lastMessageAt
      : null;
  if (parentLastMessageAt === null || nowMs > parentLastMessageAt) {
    parentPatch.lastMessageAt = nowMs;
  }
  const parentLastReadAt =
    typeof parentMeta?.lastReadAt === 'number' && Number.isFinite(parentMeta.lastReadAt)
      ? parentMeta.lastReadAt
      : null;
  if (parentLastReadAt === null || nowMs > parentLastReadAt) {
    parentPatch.lastReadAt = nowMs;
  }
  if (Object.keys(parentPatch).length > 0) {
    await manager.repo.upsertDocMeta(parentRoomId, parentPatch);
  }
}

export async function updateSessionActivityTimestampsBestEffort(
  manager: SessionActivityTimestampManager,
  sessionId: SessionId,
  logger: Pick<ReturnType<typeof getLogger>, 'warn'> = getLogger('session')
): Promise<void> {
  try {
    await updateSessionActivityTimestamps(manager, sessionId);
  } catch (error) {
    logger.warn(
      `Failed to update session activity timestamps for ${sessionId}: ${formatErrorMessage(error)}`
    );
  }
}

function extractMachineStatusResponse(
  responses: Awaited<ReturnType<typeof dispatchLocalControl>>
): z.infer<typeof MachineStatusResponseSchema> {
  const target = responses.find((response) => response.type === 'machine/status_response');
  if (!target) {
    throw new Error('Missing machine/status_response from local CLI daemon.');
  }
  return MachineStatusResponseSchema.parse(target);
}

async function ensureLocalRuntimeAvailable(
  machineId: MachineId,
  workspaceId: WorkspaceId
): Promise<void> {
  try {
    extractMachineStatusResponse(
      await dispatchLocalControl({
        type: 'machine/status',
        machineId,
        workspaceId,
      })
    );
  } catch (error) {
    if (error instanceof LocalDaemonAvailabilityError) {
      throw error;
    }
    throw new Error(`Local session runtime is not available: ${formatErrorMessage(error)}`, {
      cause: error,
    });
  }
}

async function ensureTargetMachineOnline(args: {
  auth: AuthContext;
  workspaceId: WorkspaceId;
  machineId: MachineId;
}): Promise<void> {
  if (args.machineId === args.auth.machineId) {
    await ensureLocalRuntimeAvailable(args.machineId, args.workspaceId);
    return;
  }
  throw new Error('Remote hosts are unavailable in local Molly.');
}

export async function readSessionMachineAccess(args: {
  auth: AuthContext;
  workspaceId: WorkspaceId;
  machineId: MachineId;
  requesterUserId?: string;
  delegatedRequester?: DelegatedSessionRequester;
  localProjectId?: string;
}): Promise<MachineAccessCheckResult> {
  const requester = resolveSessionRequester(
    args.auth,
    args.requesterUserId,
    args.delegatedRequester
  );
  return await readResolvedSessionMachineAccess({
    auth: args.auth,
    workspaceId: args.workspaceId,
    machineId: args.machineId,
    requester,
    ...(args.localProjectId ? { localProjectId: args.localProjectId } : {}),
  });
}

async function readResolvedSessionMachineAccess(args: {
  auth: AuthContext;
  workspaceId: WorkspaceId;
  machineId: MachineId;
  requester: ResolvedSessionRequester;
  localProjectId?: string;
}): Promise<MachineAccessCheckResult> {
  return args.machineId === args.auth.machineId
    ? { allowed: true }
    : { allowed: false, reason: 'not_visible' };
}

async function assertMachineAccess(args: {
  auth: AuthContext;
  workspaceId: WorkspaceId;
  machineId: MachineId;
  requester: ResolvedSessionRequester;
  localProjectId?: string;
}): Promise<void> {
  const access = await readResolvedSessionMachineAccess(args);
  if (!access.allowed) {
    throw new Error(`Machine access denied for ${args.machineId}: ${access.reason}`);
  }
}

/**
 * Write the durable dispatch pointer that tells the daemon a turn is pending.
 * Once this resolves the pointer is committed to the local repo and the daemon
 * may already be executing the turn, so this is the point of no rollback: a
 * later failure must NOT delete the session/turn. Cloud confirmation is a
 * separate, best-effort step — see {@link confirmDispatchSyncedBestEffort}.
 */
async function writeDispatchPointer(args: {
  manager: LoroDocumentManager;
  sessionId: SessionId;
  userTurnId: string;
}): Promise<void> {
  await args.manager.repo.upsertDocMeta(getSessionRoomId(args.sessionId), {
    latestUserMsgId: args.userTurnId,
    lastMissingHistoryUserMsgId: undefined,
  } satisfies Partial<SessionMeta>);
}

/**
 * Best-effort confirmation that the durable dispatch write reached Loro Streams.
 *
 * We still AWAIT it so the push completes before {@link withWorkspaceManager}
 * tears the one-shot transport down; otherwise the write strands locally and the
 * daemon can only re-materialize the turn from the Operation store after its
 * ~60s claim expires (slower session start). But a failed/timed-out confirmation
 * is NOT fatal and NEVER throws: the durable dispatch pointer plus the SQLite
 * Operation are the delivery truth, and the repo transport reconciles on its own
 * schedule. Treating a transient sync blip as a hard error previously caused the
 * caller's catch to delete an already-dispatched session out from under the
 * running turn (and drop its generated title). Log and let the command succeed.
 */
export async function confirmDispatchSyncedBestEffort(args: {
  manager: Pick<LoroDocumentManager, 'waitUntilMetaSynced'>;
  sessionDoc: Pick<SessionDocument, 'waitUntilSynced'>;
  reason: string;
  logger?: Pick<ReturnType<typeof getLogger>, 'warn'>;
}): Promise<void> {
  const logger = args.logger ?? getLogger('session');
  try {
    const synced = await args.sessionDoc.waitUntilSynced();
    if (!synced) {
      logger.warn(
        `Session dispatch not yet confirmed by Loro Streams (${args.reason}:doc); ` +
          `the durable dispatch pointer will converge on reconnect.`
      );
      return;
    }
    await ensureWorkspaceMetaSynced(args.manager, `${args.reason}:meta`);
  } catch (error) {
    logger.warn(
      `Session dispatch confirmation did not complete (${args.reason}); ` +
        `the durable dispatch pointer will converge on reconnect: ${formatErrorMessage(error)}`
    );
  }
}

async function listMachineMetasForWorkspace(manager: LoroDocumentManager): Promise<MachineMeta[]> {
  return (await listAliveDocMetas<MachineMeta>(manager, isMachineDocRoomId)).map(
    (entry) => entry.meta
  );
}

function formatMachineCandidates(machines: MachineMeta[]): string {
  return machines
    .map((machine) => `${machine.name} (${machine.id})`)
    .sort((left, right) => left.localeCompare(right))
    .join(', ');
}

function selectUniqueMachineByIdOrName(machines: MachineMeta[], selector: string): MachineMeta {
  const normalizedSelector = normalizeCliValue(selector);
  if (!normalizedSelector) {
    throw new Error('Missing machine selector.');
  }
  const idMatch = machines.find((machine) => machine.id === normalizedSelector);
  if (idMatch) {
    return idMatch;
  }
  const nameMatches = machines.filter(
    (machine) => normalizeCliValue(machine.name) === normalizedSelector
  );
  if (nameMatches.length === 1) {
    return nameMatches[0]!;
  }
  if (nameMatches.length > 1) {
    throw new Error(
      `Machine selector is ambiguous: ${normalizedSelector}. Use a machine id. Candidates: ${formatMachineCandidates(nameMatches)}`
    );
  }
  throw new Error(
    `Machine not found: ${normalizedSelector}. Candidates: ${formatMachineCandidates(machines)}`
  );
}

export function filterAuthorizedMachineMetas(
  machines: readonly MachineMeta[],
  authorizedMachineIds: ReadonlySet<MachineId>
): MachineMeta[] {
  return machines.filter((machine) => authorizedMachineIds.has(machine.id));
}

export function resolveSessionCommandRequesterUserId(
  auth: Pick<AuthContext, 'userId'>,
  requesterUserId?: string
): string {
  const requested = normalizeCliValue(requesterUserId);
  if (requested !== undefined && requested !== auth.userId) {
    throw new Error('Requester identity must match the authenticated CLI user.');
  }
  return auth.userId;
}

export function resolveSessionRequester(
  auth: Pick<AuthContext, 'userId'>,
  requesterUserId?: string,
  delegatedRequester?: DelegatedSessionRequester
): ResolvedSessionRequester {
  if (!delegatedRequester) {
    return {
      userId: resolveSessionCommandRequesterUserId(auth, requesterUserId),
      isDelegated: false,
    };
  }
  const delegatedUserId = normalizeCliValue(delegatedRequester.userId);
  if (!delegatedUserId) {
    throw new Error('Delegated Session requester must identify a user.');
  }
  const requested = normalizeCliValue(requesterUserId);
  if (requested !== undefined && requested !== delegatedUserId) {
    throw new Error('Requester identity must match the delegated Session requester.');
  }
  return { userId: delegatedUserId, isDelegated: true };
}

export function resolveSessionCreateOwnerUserId(
  requesterUserId: string,
  sessionOwnerUserId?: string
): string {
  return normalizeCliValue(sessionOwnerUserId) ?? requesterUserId;
}

export function selectTargetMachineForCreate(args: {
  authorizedMachines: readonly MachineMeta[];
  authMachineId: MachineId;
  machineSelector?: string;
  defaultMachineId?: MachineId;
  parentMachineId?: MachineId;
}): MachineMeta {
  const machines = [...args.authorizedMachines];
  if (args.parentMachineId) {
    if (args.machineSelector) {
      const explicit = selectUniqueMachineByIdOrName(machines, args.machineSelector);
      if (explicit.id !== args.parentMachineId) {
        throw new Error('Child session target machine must match the parent session machine.');
      }
      return explicit;
    }
    return selectUniqueMachineByIdOrName(machines, args.parentMachineId);
  }
  if (args.machineSelector) {
    return selectUniqueMachineByIdOrName(machines, args.machineSelector);
  }
  const defaultMachineId = normalizeCliValue(args.defaultMachineId) ?? args.authMachineId;
  return selectUniqueMachineByIdOrName(machines, defaultMachineId);
}

async function listAuthorizedMachineMetasForCreate(args: {
  auth: AuthContext;
  workspaceId: WorkspaceId;
  machines: readonly MachineMeta[];
  requester: ResolvedSessionRequester;
}): Promise<MachineMeta[]> {
  const rows = await Promise.all(
    args.machines.map(async (machine) => ({
      machine,
      access: await readResolvedSessionMachineAccess({
        auth: args.auth,
        workspaceId: args.workspaceId,
        machineId: machine.id,
        requester: args.requester,
      }),
    }))
  );
  return filterAuthorizedMachineMetas(
    rows.map((row) => row.machine),
    new Set(rows.filter((row) => row.access.allowed).map((row) => row.machine.id))
  );
}

async function filterAuthorizedLocalProjectsForCreate<
  T extends LocalProjectSelectorCandidate,
>(args: {
  auth: AuthContext;
  workspaceId: WorkspaceId;
  machineId: MachineId;
  localProjects: readonly T[];
  requester: ResolvedSessionRequester;
}): Promise<T[]> {
  const rows = await Promise.all(
    args.localProjects.map(async (project) => ({
      project,
      access: await readResolvedSessionMachineAccess({
        auth: args.auth,
        workspaceId: args.workspaceId,
        machineId: args.machineId,
        requester: args.requester,
        localProjectId: project.id,
      }),
    }))
  );
  return filterAuthorizedLocalProjectCandidates(
    rows.map((row) => row.project),
    new Set(rows.filter((row) => row.access.allowed).map((row) => row.project.id))
  );
}

async function resolveTargetMachineForCreate(args: {
  manager: LoroDocumentManager;
  workspaceId: WorkspaceId;
  auth: AuthContext;
  machineSelector?: string;
  defaultMachineId?: MachineId;
  requester: ResolvedSessionRequester;
  parentSessionId?: SessionId;
}): Promise<MachineMeta> {
  const machines = await listMachineMetasForWorkspace(args.manager);
  if (machines.length === 0) {
    throw new Error('No machines are registered in this workspace.');
  }
  const authorizedMachines = await listAuthorizedMachineMetasForCreate({
    auth: args.auth,
    workspaceId: args.workspaceId,
    machines,
    requester: args.requester,
  });
  if (authorizedMachines.length === 0) {
    throw new Error('No authorized machines are available in this workspace.');
  }
  const parent = args.parentSessionId
    ? await resolveSessionMetaOrThrow(args.manager, args.parentSessionId)
    : undefined;
  return selectTargetMachineForCreate({
    authorizedMachines,
    authMachineId: args.auth.machineId,
    machineSelector: args.machineSelector,
    defaultMachineId: args.defaultMachineId,
    ...(parent ? { parentMachineId: parent.machineId } : {}),
  });
}

async function listAgentConfigsForMachine(
  manager: LoroDocumentManager,
  workspaceId: WorkspaceId,
  machineId: MachineId
): Promise<AgentConfigMeta[]> {
  await syncMachineFlockDocsForRead(manager, workspaceId, [machineId], 'session.agent-configs');
  const configs = await listMergedAgentConfigs(manager.repo, workspaceId, [machineId]);
  configs.sort((left, right) => {
    const nameCompare = left.name.localeCompare(right.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }
    return left.id.localeCompare(right.id);
  });
  return configs;
}

export function selectDefaultAgentConfigForCreate(
  configs: AgentConfigMeta[],
  machineId: MachineId,
  currentSession?: SessionMeta
): AgentConfigMeta | undefined {
  if (currentSession?.machineId === machineId && currentSession.agentConfigId !== undefined) {
    const currentConfig = configs.find((config) => config.id === currentSession.agentConfigId);
    if (currentConfig) {
      return currentConfig;
    }
  }
  if (currentSession) {
    const sameKind = configs.filter(
      (config) =>
        config.cliType === currentSession.cliType && config.agentType === currentSession.agentType
    );
    if (sameKind.length === 1) {
      return sameKind[0];
    }
  }
  return configs.length === 1 ? configs[0] : undefined;
}

async function resolveAgentConfigForCreate(args: {
  manager: LoroDocumentManager;
  workspaceId: WorkspaceId;
  machineId: MachineId;
  selector?: string;
  currentSession?: SessionMeta;
}): Promise<AgentConfigMeta> {
  const configs = await listAgentConfigsForMachine(args.manager, args.workspaceId, args.machineId);
  if (configs.length === 0) {
    throw new Error(`No agent config exists on machine ${args.machineId}.`);
  }
  const selector =
    normalizeCliValue(args.selector) ??
    normalizeCliValue(process.env.MOLLY_AGENT_CONFIG_ID ?? process.env.LODY_AGENT_CONFIG_ID);
  if (selector) {
    return selectUniqueAgentConfigByIdOrName(configs, selector);
  }
  const defaultConfig = selectDefaultAgentConfigForCreate(
    configs,
    args.machineId,
    args.currentSession
  );
  if (defaultConfig) {
    return defaultConfig;
  }
  throw new Error(
    `Multiple agent configs are available on machine ${args.machineId}; pass --agent-config. Candidates: ${formatAgentConfigCandidates(configs)}`
  );
}

async function assertGitHubRepoAccess(_args: {
  auth: AuthContext;
  workspaceId: WorkspaceId;
  repoFullName: string;
  requesterUserId: string;
}): Promise<void> {
  throw new Error('Hosted GitHub workspace projects are unavailable in local Molly.');
}

export async function readLocalProjectGitStateOnMachine(args: {
  auth: AuthContext;
  workspaceId: WorkspaceId;
  machineId: MachineId;
  localProjectId: string;
  localRootPath: string;
  requesterUserId: string;
}): Promise<
  | { success: true; state: Awaited<ReturnType<typeof getLocalProjectGitStateAtRootPath>> }
  | { success: false; error: string; message?: string }
> {
  if (args.machineId === args.auth.machineId) {
    try {
      return {
        success: true,
        state: await getLocalProjectGitStateAtRootPath(args.localRootPath),
      };
    } catch (error) {
      return { success: false, error: formatErrorMessage(error) };
    }
  }

  return { success: false, error: 'Remote hosts are unavailable in local Molly.' };
}

/**
 * Create-time projection of a local project's git state onto the `ProjectRef`
 * fields the daemon and every GitHub surface later read.
 */
type LocalProjectCreateGitContext = {
  branch?: string;
  githubRepoFullName?: string;
};

/**
 * A local project's `origin` only becomes a Session's repository identity when
 * the workspace actually enables that repository, which is exactly what desktop
 * creation does (`chat-landing.tsx`). Matching is case-insensitive and returns
 * the workspace's spelling so the persisted `repoFullName` is the same string
 * every repository lookup uses.
 */
function selectWorkspaceRepoFullName(
  githubRepoFullName: string | null | undefined,
  workspaceRepositories: readonly { fullName: string }[]
): string | undefined {
  const repoFullName = normalizeCliValue(githubRepoFullName);
  if (!repoFullName) {
    return undefined;
  }
  const normalized = repoFullName.toLowerCase();
  return workspaceRepositories.find((repo) => repo.fullName.toLowerCase() === normalized)?.fullName;
}

/**
 * Pure part of local create resolution: branch selection and GitHub identity
 * read off one git-state snapshot.
 *
 * Identity is resolved for direct and worktree local sessions alike, because a
 * Session's repository is a property of the project rather than of the workdir
 * mode; without it `createSessionResult` persists no `repoFullName` and the
 * client hides `Create PR` / `Commit & Push` and skips post-turn PR detection.
 * An unauthorized or absent `origin` simply leaves the Session local.
 */
export function resolveLocalProjectCreateGitContext(args: {
  gitState: LocalProjectGitState;
  workspaceRepositories: readonly { fullName: string }[];
  requestedBranch?: string;
  useWorktree?: boolean;
}): LocalProjectCreateGitContext {
  const requestedBranch = normalizeCliValue(args.requestedBranch);
  if (!args.gitState.git) {
    if (args.useWorktree === true) {
      throw new Error('Cannot use --worktree with a local project that is not a git repository.');
    }
    if (requestedBranch) {
      throw new Error('Cannot use --branch with a local project that is not a git repository.');
    }
    return {};
  }
  const githubRepoFullName = selectWorkspaceRepoFullName(
    args.gitState.githubRepoFullName,
    args.workspaceRepositories
  );
  const identity = githubRepoFullName ? { githubRepoFullName } : {};
  // Keep direct local sessions branchless. The target daemon must use the
  // directory as it exists at dispatch time rather than switching back to a
  // branch observed by this remote preflight.
  if (!requestedBranch && args.useWorktree !== true) {
    return identity;
  }
  if (args.gitState.branches.length === 0) {
    if (requestedBranch) {
      throw new Error(`Local project branch not found: ${requestedBranch}`);
    }
    throw new Error('The local project does not have a branch to use as a worktree base.');
  }
  const branch = resolveBaseBranchPreference({
    preferredBranch: requestedBranch,
    baseBranch: args.gitState.currentBranch,
    fallbackBranch: args.gitState.defaultBranch ?? args.gitState.branches[0],
  });
  // Only the remote machine can resolve refs, so map a typed `--branch main`
  // onto one of the selectors it reported instead of demanding an exact match.
  const selected = selectLocalProjectBranchSelector(args.gitState.branches, branch);
  if (!selected) {
    throw new Error(`Local project branch not found: ${branch}`);
  }
  return { branch: selected, ...identity };
}

/**
 * Repository identity is best effort: a workspace whose repository list cannot
 * be read still creates the local Session, just without GitHub actions.
 */
async function listWorkspaceGitHubRepositoriesBestEffort(_args: {
  auth: AuthContext;
  workspaceId: WorkspaceId;
  requesterUserId: string;
}): Promise<{ fullName: string }[]> {
  return [];
}

async function resolveLocalProjectCreateGitContextOnMachine(args: {
  auth: AuthContext;
  workspaceId: WorkspaceId;
  machineId: MachineId;
  localProjectId: string;
  localRootPath: string;
  requesterUserId: string;
  requestedBranch?: string;
  useWorktree?: boolean;
}): Promise<LocalProjectCreateGitContext> {
  const response = await readLocalProjectGitStateOnMachine(args);
  if (!response.success) {
    // Only an explicit branch or a worktree base depends on this read; a direct
    // local session must still be creatable when the state cannot be read.
    if (normalizeCliValue(args.requestedBranch) || args.useWorktree === true) {
      throw new Error(response.message ?? response.error);
    }
    return {};
  }
  // Only a project that actually reports a GitHub `origin` needs the workspace
  // repository list, so a purely local project stays off the network.
  const workspaceRepositories =
    response.state.git && normalizeCliValue(response.state.githubRepoFullName)
      ? await listWorkspaceGitHubRepositoriesBestEffort(args)
      : [];
  return resolveLocalProjectCreateGitContext({
    gitState: response.state,
    workspaceRepositories,
    ...(args.requestedBranch ? { requestedBranch: args.requestedBranch } : {}),
    ...(args.useWorktree !== undefined ? { useWorktree: args.useWorktree } : {}),
  });
}

async function resolveLocalProjectRefOnMachineOrThrow(
  manager: LoroDocumentManager,
  workspaceId: WorkspaceId,
  auth: AuthContext,
  machineId: MachineId,
  selector: string,
  requester: ResolvedSessionRequester,
  requestedBranch?: string,
  useWorktree?: boolean
): Promise<ProjectRef> {
  await syncMachineFlockDocsForRead(manager, workspaceId, [machineId], 'session.local-projects');
  const localProjects = Object.values(
    await readMachineLocalProjects(manager.repo, workspaceId, machineId)
  );
  if (localProjects.length === 0) {
    throw new Error('No local project is registered on the target machine for this workspace.');
  }
  const authorizedLocalProjects = await filterAuthorizedLocalProjectsForCreate({
    auth,
    workspaceId,
    machineId,
    localProjects,
    requester,
  });
  if (authorizedLocalProjects.length === 0) {
    throw new Error('No authorized local projects are available on the target machine.');
  }
  const normalizedSelector = normalizeCliValue(selector);
  if (!normalizedSelector) {
    throw new Error('Missing local project selector.');
  }
  const matches = selectLocalProjectsBySelector(authorizedLocalProjects, normalizedSelector);
  if (matches.length === 0) {
    throw new Error(
      `Local project not found on ${machineId}: ${normalizedSelector}. Candidates: ${authorizedLocalProjects
        .map((project) => `${project.name} (${project.id})`)
        .join(', ')}`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Local project selector is ambiguous on ${machineId}: ${normalizedSelector}. Use a project id instead.`
    );
  }
  const project = matches[0]!;
  const { branch, githubRepoFullName } = await resolveLocalProjectCreateGitContextOnMachine({
    auth,
    workspaceId,
    machineId,
    localProjectId: project.id,
    localRootPath: project.rootPath,
    requesterUserId: requester.userId,
    requestedBranch,
    useWorktree,
  });
  return {
    kind: 'local',
    localProjectId: project.id,
    ...(branch ? { branch } : {}),
    ...(githubRepoFullName ? { githubRepoFullName } : {}),
    ...(useWorktree === true ? { useWorktree: true } : {}),
  };
}

function resolveParentProjectRef(parentSession: SessionMeta): ProjectRef | undefined {
  const project = parentSession.project;
  if (project?.kind === 'github') {
    return {
      ...project,
      branch: normalizeCliValue(project.branch) ?? parentSession.baseBranch ?? 'main',
    };
  }
  if (project?.kind === 'local') {
    const branch = normalizeCliValue(project.branch) ?? parentSession.baseBranch;
    return branch ? { ...project, branch } : project;
  }
  const repoFullName = normalizeCliValue(parentSession.repoFullName);
  if (!repoFullName) {
    return undefined;
  }
  return {
    kind: 'github',
    repoFullName,
    branch: parentSession.baseBranch ?? 'main',
  };
}

export function resolveCreateCurrentSessionId(
  options: Pick<CreateOptions, 'currentSessionId'>,
  env: NodeJS.ProcessEnv = process.env
): SessionId | undefined {
  return (normalizeCliValue(options.currentSessionId) ??
    normalizeCliValue(env.MOLLY_SESSION_ID ?? env.LODY_SESSION_ID)) as SessionId | undefined;
}

export function resolveOpenedBySessionRelation(
  currentSession: Pick<SessionMeta, 'id' | 'parentSessionId'> | undefined
): { openedBySessionId?: SessionId; openedByRootSessionId?: SessionId } {
  if (!currentSession) return {};
  return {
    openedBySessionId: currentSession.id,
    ...(currentSession.parentSessionId
      ? { openedByRootSessionId: currentSession.parentSessionId }
      : {}),
  };
}

export function assertSupportedParentDepth(
  parentSession: Pick<SessionMeta, 'parentSessionId'> | undefined
): void {
  if (parentSession?.parentSessionId) {
    throw new Error(
      `Nested child sessions are not supported. Use the root parent session ${parentSession.parentSessionId}.`
    );
  }
}

async function resolveCreateContext(args: {
  auth: AuthContext;
  workspace: WorkspaceSummary;
  manager: LoroDocumentManager;
  options: CreateOptions;
  requester: ResolvedSessionRequester;
  skipMachineAvailabilityCheck?: boolean;
}): Promise<ResolvedCreateContext> {
  const workspaceId = args.workspace.id as WorkspaceId;
  const agentSelector = resolveCreateAgentSelector(args.options);
  const requesterUserId = args.requester.userId;
  const parentSelector = normalizeCliValue(args.options.parent);
  const currentSessionId = resolveCreateCurrentSessionId(args.options);
  if (parentSelector && args.options.useCurrentSessionAsParent === true) {
    throw new Error('Pass either --parent or --use-current-session-as-parent, not both.');
  }
  const parentSessionId = (parentSelector ??
    (args.options.useCurrentSessionAsParent === true ? currentSessionId : undefined)) as
    | SessionId
    | undefined;
  if (args.options.useCurrentSessionAsParent === true && !parentSessionId) {
    throw new Error('No current session is available for --use-current-session-as-parent.');
  }

  const normalizedRepo = normalizeCliValue(args.options.repo);
  const normalizedLocalProject = normalizeCliValue(args.options.localProject);
  const requestedBranch = normalizeCliValue(args.options.branch);
  if (
    parentSessionId &&
    (normalizedRepo || normalizedLocalProject || args.options.worktree || requestedBranch)
  ) {
    throw new Error(
      '--parent cannot be used with --repo, --local-project, --worktree, or --branch.'
    );
  }

  const currentSession = currentSessionId
    ? await resolveSessionMetaOrThrow(args.manager, currentSessionId)
    : undefined;
  const parentSession = parentSessionId
    ? await resolveSessionMetaOrThrow(args.manager, parentSessionId)
    : undefined;
  assertSupportedParentDepth(parentSession);

  // An explicit taskId wins; otherwise inherit from the session that asked for
  // this one, which is what keeps agent-spawned work on the same task.
  const taskId = (normalizeCliValue(args.options.taskId) ?? currentSession?.taskId) as
    | TaskId
    | undefined;
  const targetMachine = await resolveTargetMachineForCreate({
    manager: args.manager,
    workspaceId,
    auth: args.auth,
    machineSelector: args.options.machine,
    defaultMachineId: args.options.defaultMachineId,
    requester: args.requester,
    parentSessionId,
  });
  await assertMachineAccess({
    auth: args.auth,
    workspaceId,
    machineId: targetMachine.id,
    requester: args.requester,
  });
  if (args.skipMachineAvailabilityCheck !== true) {
    await ensureTargetMachineOnline({
      auth: args.auth,
      workspaceId,
      machineId: targetMachine.id,
    });
  }
  const agentConfig = await resolveAgentConfigForCreate({
    manager: args.manager,
    workspaceId,
    machineId: targetMachine.id,
    selector: agentSelector,
    currentSession,
  });

  let project: ProjectRef | undefined;
  if (normalizedRepo && normalizedLocalProject) {
    throw new Error('Pass either --repo or --local-project, not both.');
  }
  if (args.options.worktree === true && !normalizedLocalProject) {
    throw new Error('Pass --worktree together with --local-project.');
  }
  if (requestedBranch && !normalizedRepo && !normalizedLocalProject) {
    throw new Error('Pass --branch together with --repo or --local-project.');
  }
  if (parentSession) {
    project = resolveParentProjectRef(parentSession);
    const parentRepoFullName = project?.kind === 'github' ? project.repoFullName : undefined;
    if (parentRepoFullName) {
      await assertGitHubRepoAccess({
        auth: args.auth,
        workspaceId,
        repoFullName: parentRepoFullName,
        requesterUserId,
      });
    }
  } else if (normalizedRepo) {
    await assertGitHubRepoAccess({
      auth: args.auth,
      workspaceId,
      repoFullName: normalizedRepo,
      requesterUserId,
    });
    const branch = resolveBaseBranchPreference({
      preferredBranch: requestedBranch,
      fallbackBranch: 'main',
    });
    project = { kind: 'github', repoFullName: normalizedRepo, branch };
  } else if (normalizedLocalProject) {
    project = await resolveLocalProjectRefOnMachineOrThrow(
      args.manager,
      workspaceId,
      args.auth,
      targetMachine.id,
      normalizedLocalProject,
      args.requester,
      requestedBranch,
      args.options.worktree === true
    );
  }

  await assertMachineAccess({
    auth: args.auth,
    workspaceId,
    machineId: targetMachine.id,
    requester: args.requester,
    localProjectId: project?.kind === 'local' ? project.localProjectId : undefined,
  });

  return {
    targetMachine,
    agentConfig,
    ...(project ? { project } : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
    ...resolveOpenedBySessionRelation(currentSession),
    ...(taskId ? { taskId } : {}),
  };
}

/** Validate every create selector and access rule without writing a Session or Turn. */
export async function validateSessionCreateOptions(args: {
  auth: AuthContext;
  workspace: WorkspaceSummary;
  manager: LoroDocumentManager;
  options: CreateOptions;
  /**
   * Durable orchestration callers may validate selectors before accepting the
   * Operation and defer the fallible availability probe to materialization.
   */
  skipMachineAvailabilityCheck?: boolean;
  /**
   * Validated against the resolved target agent's ACP capabilities so an
   * unsupported model/effort/fast/plan selection is rejected BEFORE a durable
   * Operation is accepted, instead of failing after the target ids are fixed.
   */
  dispatchConfig?: ResolvedTurnDispatchConfig;
}): Promise<ResolvedTurnDispatchConfig> {
  const requester = resolveSessionRequester(
    args.auth,
    args.options.requesterUserId,
    args.options.delegatedRequester
  );
  const resolved = await resolveCreateContext({ ...args, requester });
  return await resolveEffectiveSessionCreateDispatchConfig({
    manager: args.manager,
    workspaceId: args.workspace.id as WorkspaceId,
    agentConfig: resolved.agentConfig,
    openedBySessionId: resolved.openedBySessionId,
    dispatchConfig: args.dispatchConfig ?? resolveTurnDispatchConfig({}),
  });
}

async function resolveEffectiveSessionCreateDispatchConfig(args: {
  manager: LoroDocumentManager;
  workspaceId: WorkspaceId;
  agentConfig: AgentConfigMeta;
  openedBySessionId?: SessionId;
  dispatchConfig: ResolvedTurnDispatchConfig;
}): Promise<ResolvedTurnDispatchConfig> {
  const { frozenInheritedInputConfig, ...dispatchConfig } = args.dispatchConfig;
  const inheritedDispatchConfig =
    frozenInheritedInputConfig !== undefined
      ? resolveTurnDispatchConfigFromInputConfig(frozenInheritedInputConfig, args.agentConfig)
      : dispatchConfig.inheritSessionDefaults !== false && args.openedBySessionId
        ? await resolveSessionTurnDispatchDefaults(
            args.manager,
            args.openedBySessionId,
            args.agentConfig
          )
        : undefined;
  // Builtin Role/MCP creates often have no modeId. Read capabilities before
  // accepting so withBuiltinDefaultTurnMode cannot freeze an unoffered mode.
  const mayApplyBuiltinDefault =
    Boolean(getBuiltinDefaultModeId(args.agentConfig.cliType, args.agentConfig.agentType)) &&
    dispatchConfig.modeId === undefined &&
    typeof dispatchConfig.configOptionValues?.mode !== 'string' &&
    inheritedDispatchConfig?.modeId === undefined &&
    typeof inheritedDispatchConfig?.configOptionValues?.mode !== 'string';
  const needsCapability =
    mayApplyBuiltinDefault ||
    dispatchConfig.modeId !== undefined ||
    dispatchConfig.modelId !== undefined ||
    dispatchConfig.configOptionValues !== undefined ||
    hasAgentRunConfigSelection(dispatchConfig.runConfig) ||
    inheritedDispatchConfig?.modeId !== undefined ||
    inheritedDispatchConfig?.modelId !== undefined ||
    inheritedDispatchConfig?.configOptionValues !== undefined;
  const capability = needsCapability
    ? await readAgentAcpCapability({
        manager: args.manager,
        workspaceId: args.workspaceId,
        machineId: args.agentConfig.machineId,
        agentConfigId: args.agentConfig.id,
      })
    : undefined;
  const requested = applyAgentRunConfigSelection(dispatchConfig, capability);
  validateTurnModeAndModel(requested.config, capability);
  validateTurnConfigOptionValues(
    requested.config.configOptionValues,
    capability,
    requested.validatedConfigIds
  );
  return {
    ...withBuiltinDefaultTurnMode(
      mergeTurnDispatchConfig(
        requested.config,
        filterCompatibleInheritedTurnConfig(inheritedDispatchConfig, capability)
      ),
      args.agentConfig,
      capability
    ),
    inheritSessionDefaults: false,
  };
}

export function shouldQueueMachineDelete(
  session: Pick<SessionMeta, 'repoFullName' | 'project' | 'isWorktree' | 'parentSessionId'>
): boolean {
  return shouldQueueMachineDeleteSession(session);
}

export function buildSessionArchiveMetaPatch(): Partial<SessionMeta> {
  return {
    isArchived: true,
    status: SessionStatusFactory.idle(),
  };
}

export function buildSessionRestoreMetaPatch(): Partial<SessionMeta> {
  return {
    isArchived: false,
  };
}

export function buildLegacyMachineRestoreQueueCleanupPatch(
  sessionId: SessionId,
  machineMeta:
    | Pick<MachineLegacyMetaFields, 'needToArchiveSessions' | 'needToDeleteSessions'>
    | undefined
): Pick<MachineLegacyMetaFields, 'needToArchiveSessions' | 'needToDeleteSessions'> | null {
  const nextNeedToArchiveSessions = { ...(machineMeta?.needToArchiveSessions ?? {}) };
  const nextNeedToDeleteSessions = { ...(machineMeta?.needToDeleteSessions ?? {}) };
  let changed = false;

  if (sessionId in nextNeedToArchiveSessions) {
    delete nextNeedToArchiveSessions[sessionId];
    changed = true;
  }
  if (sessionId in nextNeedToDeleteSessions) {
    delete nextNeedToDeleteSessions[sessionId];
    changed = true;
  }

  if (!changed) {
    return null;
  }
  return {
    needToArchiveSessions: nextNeedToArchiveSessions,
    needToDeleteSessions: nextNeedToDeleteSessions,
  };
}

export async function createSessionResult(
  auth: AuthContext,
  workspace: WorkspaceSummary,
  manager: LoroDocumentManager,
  prompt: string,
  options: CreateOptions,
  dispatchConfig: ResolvedTurnDispatchConfig,
  structuredOutput?: {
    outputMode: StructuredSessionOutputMode;
    timeoutMs: number;
    onEvent?: (event: SessionTurnOutputEvent) => void;
  }
): Promise<{
  sessionId: SessionId;
  machineId: MachineId;
  workspaceId: WorkspaceId;
  userTurnId: string;
  agentConfigId: string;
  project?: ProjectRef;
  parentSessionId?: SessionId;
  openedBySessionId?: SessionId;
  openedByRootSessionId?: SessionId;
  completionPromise?: Promise<Awaited<ReturnType<typeof waitForTurnCompletion>>>;
}> {
  const envOverrides = parseEnvAssignments(options.env);
  if (Object.keys(envOverrides).length > 0) {
    throw new Error(
      'Per-session --env overrides are no longer persisted. Configure environment variables on the agent config instead.'
    );
  }
  await ensureSessionCreateWorkspaceMetaFresh({
    manager,
    workspaceId: workspace.id as WorkspaceId,
    prewriteSatisfied: options.workspaceMetaPrewriteSatisfied === true,
  });
  if (!options.bypassSessionQuota) {
    await assertSessionCreateQuota({
      workspace,
      manager,
      sessionId: options.sessionId,
    });
  }
  const requester = resolveSessionRequester(
    auth,
    options.requesterUserId,
    options.delegatedRequester
  );
  const requesterUserId = requester.userId;
  const sessionOwnerUserId = resolveSessionCreateOwnerUserId(
    requesterUserId,
    options.sessionOwnerUserId
  );
  const resolved = await resolveCreateContext({ auth, workspace, manager, options, requester });
  const {
    targetMachine,
    agentConfig,
    project,
    parentSessionId,
    openedBySessionId,
    openedByRootSessionId,
    taskId,
  } = resolved;
  const effectiveDispatchConfig = await resolveEffectiveSessionCreateDispatchConfig({
    manager,
    workspaceId: workspace.id as WorkspaceId,
    agentConfig,
    ...(openedBySessionId ? { openedBySessionId } : {}),
    dispatchConfig,
  });

  const sessionId = options.sessionId ?? (uuidV4() as SessionId);
  const sessionRoomId = getSessionRoomId(sessionId);
  const sessionDoc = await manager.getOrCreateSessionDoc(sessionId);
  const repoFullName = resolveProjectGitHubRepo(project);
  const baseBranch = project?.kind === 'local' ? undefined : project?.branch?.trim();
  const title = normalizeCliValue(options.title);
  await manager.repo.upsertDocMeta(sessionRoomId, {
    id: sessionId,
    machineId: targetMachine.id,
    createdAt: new Date(getServerNow()).toISOString(),
    userId: sessionOwnerUserId,
    status: SessionStatusFactory.initializing(),
    isArchived: false,
    cliType: agentConfig.cliType,
    agentType: agentConfig.agentType,
    agentConfigId: agentConfig.id,
    ...(title ? { title } : {}),
    ...(project ? { project } : {}),
    ...(repoFullName ? { repoFullName } : {}),
    ...(baseBranch ? { baseBranch } : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(openedBySessionId ? { openedBySessionId } : {}),
    ...(openedByRootSessionId ? { openedByRootSessionId } : {}),
    ...(options.agentRoleId ? { agentRoleId: options.agentRoleId as AgentRoleId } : {}),
    ...(options.agentRoleRevision !== undefined
      ? { agentRoleRevision: options.agentRoleRevision }
      : {}),
    ...(taskId ? { taskId } : {}),
    // `agentRoleId`/`agentRoleRevision` are declared on `SessionMeta` now, so
    // the provenance fields no longer need a local intersection here.
  } satisfies SessionMeta);

  let completionAbortController: AbortController | undefined;
  let completionPromise: Promise<Awaited<ReturnType<typeof waitForTurnCompletion>>> | undefined;
  // Once the durable dispatch pointer is written the daemon may already be
  // running the turn, so a later failure must not roll the session back.
  let dispatched = false;
  try {
    const modeId = effectiveDispatchConfig.modeId;
    const modelId = effectiveDispatchConfig.modelId;
    const sessionCreatePrompt = buildAgentPrompt(prompt, agentConfig.prompt ?? '');
    const userTurn = await appendUserPromptHistory({
      sessionDoc,
      prompt,
      userId: requesterUserId,
      inputConfig: buildCliHistoryInputConfig({
        prompt: sessionCreatePrompt,
        cliType: agentConfig.cliType,
        agentType: agentConfig.agentType,
        modeId: modeId ?? undefined,
        modelId: modelId ?? undefined,
        configOptionValues: effectiveDispatchConfig.configOptionValues,
        taskToolsEnabled: taskId ? true : effectiveDispatchConfig.taskToolsEnabled,
        chainDepth: options.chainDepth,
      }),
      preallocatedId: options.userTurnId,
    });
    const userTurnId = userTurn.id;
    completionAbortController = structuredOutput ? new AbortController() : undefined;
    completionPromise = structuredOutput
      ? waitForTurnCompletion({
          sessionDoc,
          userTurnId,
          outputMode: structuredOutput.outputMode,
          timeoutMs: structuredOutput.timeoutMs,
          signal: completionAbortController?.signal,
          onEvent: structuredOutput.onEvent,
        })
      : undefined;

    await updateSessionActivityTimestampsBestEffort(manager, sessionId);
    await manager.repo.upsertDocMeta(sessionRoomId, {
      status: SessionStatusFactory.idle(),
    } satisfies Partial<SessionMeta>);
    await writeDispatchPointer({ manager, sessionId, userTurnId });
    dispatched = true;
    await confirmDispatchSyncedBestEffort({
      manager,
      sessionDoc,
      reason: `session.create:${sessionId}`,
    });
    if (taskId) {
      // AFTER the fast path on purpose: this opens and syncs the task document,
      // which is a network round trip, and the prompt must not wait on it
      // (context/cli-prompt-hot-path.md). Best effort too — it runs past the
      // dispatch point of no rollback, so a failure must never unwind a running
      // session, and the reverse pointer on session meta is already durable.
      // Still awaited rather than fired: this command's workspace transport is
      // torn down on return, so an un-awaited write could be dropped.
      await linkTaskSessionFromCli(
        manager,
        workspace.id as WorkspaceId,
        taskId,
        {
          sessionId,
          // A Run from the app authors its own session and links it there, so a
          // taskId arriving here is either delegated automation (an explicit
          // run) or an agent spawning helpers.
          origin: options.taskLinkOrigin ?? 'agent-spawn',
          ...(openedBySessionId ? { parentSessionId: openedBySessionId } : {}),
        },
        { agentConfigId: agentConfig.id }
      ).catch(() => undefined);
    }

    return {
      sessionId,
      machineId: targetMachine.id,
      workspaceId: workspace.id as WorkspaceId,
      userTurnId,
      agentConfigId: agentConfig.id,
      ...(project ? { project } : {}),
      ...(parentSessionId ? { parentSessionId } : {}),
      ...(openedBySessionId ? { openedBySessionId } : {}),
      ...(openedByRootSessionId ? { openedByRootSessionId } : {}),
      ...(taskId ? { taskId } : {}),
      completionPromise,
    };
  } catch (error) {
    completionAbortController?.abort();
    await completionPromise?.catch(() => undefined);
    // Only roll back a create that failed BEFORE the durable dispatch pointer
    // was committed. After dispatch, deleting the session would destroy an
    // already-running turn (and its title) — the durable pointer plus Operation
    // store own eventual delivery instead.
    if (!dispatched) {
      await rollbackPendingSessionCreate(manager, sessionId);
    }
    throw error;
  }
}

/** Validate a chat target without appending history or dispatching work. */
export async function validateSessionChatTarget(args: {
  auth: AuthContext;
  workspace: WorkspaceSummary;
  manager: LoroDocumentManager;
  sessionId: SessionId;
  requesterUserIdOverride?: string;
  delegatedRequester?: DelegatedSessionRequester;
}): Promise<SessionMeta> {
  const requester = resolveSessionRequester(
    args.auth,
    args.requesterUserIdOverride,
    args.delegatedRequester
  );
  return await validateSessionChatTargetForRequester({
    auth: args.auth,
    workspace: args.workspace,
    manager: args.manager,
    sessionId: args.sessionId,
    requester,
  });
}

async function validateSessionChatTargetForRequester(args: {
  auth: AuthContext;
  workspace: WorkspaceSummary;
  manager: LoroDocumentManager;
  sessionId: SessionId;
  requester: ResolvedSessionRequester;
}): Promise<SessionMeta> {
  await syncWorkspaceMetaForRead(args.manager, `session.chat:${args.sessionId}:prewrite:meta`);
  const session = await resolveSessionMetaOrThrow(args.manager, args.sessionId);
  if (session.isArchived) {
    throw new Error(`Session ${args.sessionId} is archived. Restore it before chatting.`);
  }
  await assertMachineAccess({
    auth: args.auth,
    workspaceId: args.workspace.id as WorkspaceId,
    machineId: session.machineId,
    requester: args.requester,
    localProjectId: session.project?.kind === 'local' ? session.project.localProjectId : undefined,
  });
  await ensureTargetMachineOnline({
    auth: args.auth,
    workspaceId: args.workspace.id as WorkspaceId,
    machineId: session.machineId,
  });
  return session;
}

export async function sendSessionChatResult(
  auth: AuthContext,
  workspace: WorkspaceSummary,
  manager: LoroDocumentManager,
  sessionId: SessionId,
  prompt: string,
  dispatchConfig: ResolvedTurnDispatchConfig,
  structuredOutput?: {
    outputMode: StructuredSessionOutputMode;
    timeoutMs: number;
    onEvent?: (event: SessionTurnOutputEvent) => void;
  },
  requesterUserIdOverride?: string,
  orchestration?: {
    userTurnId: string;
    chainDepth: number;
    bypassSessionQuota?: boolean;
  },
  delegatedRequester?: DelegatedSessionRequester
): Promise<{
  sessionId: SessionId;
  machineId: MachineId;
  workspaceId: WorkspaceId;
  userTurnId: string;
  completionPromise?: Promise<Awaited<ReturnType<typeof waitForTurnCompletion>>>;
}> {
  const requester = resolveSessionRequester(auth, requesterUserIdOverride, delegatedRequester);
  const requesterUserId = requester.userId;
  const session = await validateSessionChatTargetForRequester({
    auth,
    workspace,
    manager,
    sessionId,
    requester,
  });
  const mayApplyBuiltinDefault =
    Boolean(getBuiltinDefaultModeId(session.cliType, session.agentType)) &&
    !dispatchConfig.modeId &&
    typeof dispatchConfig.configOptionValues?.mode !== 'string';
  const capability =
    dispatchConfig.modeId ||
    dispatchConfig.modelId ||
    dispatchConfig.configOptionValues ||
    mayApplyBuiltinDefault
      ? await readAgentAcpCapability({
          manager,
          workspaceId: workspace.id as WorkspaceId,
          machineId: session.machineId,
          agentConfigId: session.agentConfigId,
        })
      : undefined;
  if (dispatchConfig.modeId || dispatchConfig.modelId || dispatchConfig.configOptionValues) {
    validateTurnModeAndModel(dispatchConfig, capability);
    validateTurnConfigOptionValues(dispatchConfig.configOptionValues, capability);
  }
  const effectiveDispatchConfig = withBuiltinDefaultTurnMode(dispatchConfig, session, capability);

  await syncDocForRead(
    manager,
    getSessionRoomId(sessionId),
    `session.chat:${sessionId}:prewrite:doc`
  );
  const sessionDoc = await manager.getOrCreateSessionDoc(sessionId);
  const quotaHistory = orchestration?.bypassSessionQuota
    ? undefined
    : await checkSessionTurnQuotaAndReadHistory({
        manager,
        workspace,
        sessionDoc,
        userTurnId: orchestration?.userTurnId,
      });
  const userTurn = await appendUserPromptHistory({
    sessionDoc,
    prompt,
    userId: requesterUserId,
    inputConfig: buildCliHistoryInputConfig({
      prompt,
      cliType: session.cliType,
      agentType: session.agentType,
      modeId: effectiveDispatchConfig.modeId,
      modelId: effectiveDispatchConfig.modelId,
      configOptionValues: effectiveDispatchConfig.configOptionValues,
      taskToolsEnabled: effectiveDispatchConfig.taskToolsEnabled,
      resume: session.acpSessionId ?? undefined,
      chainDepth: orchestration?.chainDepth,
    }),
    preallocatedId: orchestration?.userTurnId,
    knownHistory: quotaHistory,
  });
  const userTurnId = userTurn.id;
  const completionAbortController = structuredOutput ? new AbortController() : undefined;
  const completionPromise = structuredOutput
    ? waitForTurnCompletion({
        sessionDoc,
        userTurnId,
        outputMode: structuredOutput.outputMode,
        timeoutMs: structuredOutput.timeoutMs,
        signal: completionAbortController?.signal,
        onEvent: structuredOutput.onEvent,
      })
    : undefined;

  // Once the durable dispatch pointer is written the daemon may already be
  // running the turn, so a later failure must not un-dispatch it.
  let dispatched = false;
  try {
    await updateSessionActivityTimestampsBestEffort(manager, sessionId);
    await writeDispatchPointer({ manager, sessionId, userTurnId });
    dispatched = true;
    await confirmDispatchSyncedBestEffort({
      manager,
      sessionDoc,
      reason: `session.chat:${sessionId}:${userTurnId}`,
    });
    return {
      sessionId,
      machineId: session.machineId,
      workspaceId: workspace.id as WorkspaceId,
      userTurnId,
      completionPromise,
    };
  } catch (error) {
    completionAbortController?.abort();
    await completionPromise?.catch(() => undefined);
    // Only unwind the appended user turn if it was never durably dispatched.
    // After dispatch, removing the history entry and clearing the pointer would
    // corrupt a turn the daemon is already executing.
    if (!dispatched) {
      await removeHistoryEntryById(sessionDoc, userTurnId);
      await manager.repo
        .upsertDocMeta(getSessionRoomId(sessionId), {
          latestUserMsgId: undefined,
          lastMissingHistoryUserMsgId: undefined,
        } satisfies Partial<SessionMeta>)
        .catch(() => undefined);
    }
    throw error;
  }
}

export function deriveSessionLiveStatus(machineStatus: {
  online: boolean;
  state?: 'idle' | 'initializing' | 'running' | 'waiting' | 'unknown';
  message?: string;
}): SessionStatusResult['liveStatus'] {
  if (!machineStatus.online) {
    return {
      state: 'unavailable',
      source: 'none',
      ...(machineStatus.message ? { reason: machineStatus.message } : {}),
    };
  }
  if (machineStatus.state) {
    return {
      state: machineStatus.state,
      source: 'machine',
      ...(machineStatus.message ? { reason: machineStatus.message } : {}),
    };
  }
  return {
    state: 'unavailable',
    source: 'none',
    reason: machineStatus.message ?? 'Session live status is unavailable.',
  };
}

export type SessionLiveStatusBatchItem = {
  sessionId: SessionId;
  machineOnline: boolean;
  state?: string;
  fresh: boolean;
  observedAt?: number;
  reason?: string;
};

/** Local metadata does not claim live turn status. */
export async function readSessionLiveStatusesMany(args: {
  auth: AuthContext;
  workspaceId: WorkspaceId;
  sessions: ReadonlyArray<Pick<SessionMeta, 'id' | 'machineId'>>;
}): Promise<Map<SessionId, SessionLiveStatusBatchItem>> {
  return new Map(
    args.sessions.map((session) => [
      session.id,
      {
        sessionId: session.id,
        machineOnline: session.machineId === args.auth.machineId,
        fresh: false,
        reason: 'Live status is unavailable from the local Session metadata view.',
      },
    ])
  );
}
