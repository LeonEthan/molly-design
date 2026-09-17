import {
  getSessionIdFromRoomId,
  isLoroRepoDocDeleted,
  isSessionDocRoomId,
  type LocalSessionControlRequest,
  type LocalSessionControlResponse,
  type MollyError,
  type MachineId,
  type SessionMeta,
  type WorkspaceId,
} from '@molly/shared';
import { Data, Effect } from 'effect';
import {
  IpcConnectError,
  IpcProtocolError,
  IpcTimeoutError,
  makeLocalControlClientAuto,
  makeLocalProbeClientAuto,
  type LocalControlClientAutoOptions,
  type LocalProbeClientAutoOptions,
} from '@molly/shared/node/local-ipc';
import { LoroDocumentManager } from '@/lib/loro/doc';
import type { WorkspaceSummary } from '@/lib/workspace';
import { flushTelemetry } from '@/instrument';
import { getLogger, rootLogger } from '@/utils/logger';
import { formatErrorMessage } from '@/utils/format-error';
import { listAliveRoomIds } from '@/lib/loro/repo-existence';
import { LocalLoroTransportAdapter } from '@molly/shared/local-loro-transport';
import { connectLocalLoroDataPlane } from '@/lib/local-loro-data-plane-client';

export { listAliveRoomIds } from '@/lib/loro/repo-existence';

const DEFAULT_LOCAL_CONTROL_TIMEOUT_MS = 30_000;
const DAEMON_HEALTH_PROBE_TIMEOUT_MS = 2_000;
export const DAEMON_NOT_RUNNING_MESSAGE =
  'The Molly background runtime is not running. Restart Molly to start it.';
export const DAEMON_BUSY_MESSAGE =
  'Local CLI daemon did not answer in time. It may be busy; retry the request and reuse the same operationId when present.';
export const WORKSPACE_SYNC_UNAVAILABLE_MESSAGE =
  'Workspace synchronization is temporarily unavailable. Retry the request and reuse the same operationId when present.';

export class WorkspaceSyncUnavailableError extends Data.TaggedError(
  'WorkspaceSyncUnavailableError'
)<{
  message: string;
  cause?: unknown;
}> {
  toMollyError(): MollyError {
    return {
      code: 'SYNC_UNAVAILABLE',
      message: WORKSPACE_SYNC_UNAVAILABLE_MESSAGE,
      retryable: true,
    };
  }
}

export class LocalDaemonAvailabilityError extends Data.TaggedError('LocalDaemonAvailabilityError')<{
  code: 'DAEMON_NOT_RUNNING' | 'DAEMON_BUSY' | 'DAEMON_PROTOCOL_ERROR';
  message: string;
  retryable: boolean;
  cause?: unknown;
}> {
  toMollyError(): MollyError {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

export function classifyLocalDaemonIpcError(
  error: IpcConnectError | IpcTimeoutError | IpcProtocolError
): LocalDaemonAvailabilityError {
  if (error instanceof IpcConnectError) {
    return new LocalDaemonAvailabilityError({
      code: 'DAEMON_NOT_RUNNING',
      message: DAEMON_NOT_RUNNING_MESSAGE,
      retryable: false,
      cause: error,
    });
  }
  if (error instanceof IpcTimeoutError) {
    return new LocalDaemonAvailabilityError({
      code: 'DAEMON_BUSY',
      message: DAEMON_BUSY_MESSAGE,
      retryable: true,
      cause: error,
    });
  }
  const retryable =
    error.status === 408 ||
    error.status === 429 ||
    (typeof error.status === 'number' && error.status >= 500);
  const safeErrorCode =
    typeof error.errorCode === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(error.errorCode)
      ? error.errorCode
      : undefined;
  const safeValidationMessage =
    error.errorCode === undefined &&
    typeof error.status === 'number' &&
    error.status >= 200 &&
    error.status < 300
      ? error.message
      : undefined;
  return new LocalDaemonAvailabilityError({
    code: retryable ? 'DAEMON_BUSY' : 'DAEMON_PROTOCOL_ERROR',
    message: retryable
      ? `Local CLI daemon is temporarily unavailable${
          typeof error.status === 'number' ? ` (HTTP ${error.status})` : ''
        }; retry the request and reuse the same operationId when present.`
      : safeErrorCode
        ? `Local CLI daemon request failed: ${safeErrorCode}`
        : (safeValidationMessage ??
          `Local CLI daemon request failed${
            typeof error.status === 'number' ? ` (HTTP ${error.status})` : ''
          }.`),
    retryable,
    cause: error,
  });
}

type LocalIpcDiscoveryOptions = Pick<
  LocalProbeClientAutoOptions & LocalControlClientAutoOptions,
  'runFilePath' | 'socketPath'
>;

export type CommonCommandOptions = {
  workspace?: string;
  json?: boolean;
  jsonl?: boolean;
  debug?: boolean;
  offline?: boolean;
};

export type AuthContext = {
  token: string;
  userId: string;
  userName: string;
  userEmail: string;
  machineId: MachineId;
  machineName: string;
};

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value));
}

export function normalizeCliValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export async function resolveWorkspaceOrThrow(
  auth: AuthContext,
  selector?: string
): Promise<WorkspaceSummary> {
  if (auth.token) throw new Error('Product-cloud workspaces are unavailable in local Molly.');
  const workspaceId = normalizeCliValue(selector);
  if (!workspaceId?.startsWith('lw_')) {
    throw new Error('The local Molly workspace identity is unavailable.');
  }
  return { id: workspaceId, name: 'Molly', slug: 'local', role: 'owner' };
}

async function confirmLocalRepoDelivery(repo: LoroDocumentManager['repo']): Promise<void> {
  await Promise.all(
    repo.transportRooms('local').map(async ({ subscription }) => {
      await new Promise<void>((resolve, reject) => {
        let sawRejoin = false;
        let settled = false;
        let unsubscribe = () => {};
        const timer = setTimeout(
          () => finish(() => reject(new Error('Local workspace sync timed out.'))),
          15_000
        );
        const finish = (settle: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsubscribe();
          settle();
        };
        unsubscribe = subscription.onStatusChange((status) => {
          if (status === 'connecting' || status === 'reconnecting') sawRejoin = true;
          if (sawRejoin && status === 'joined') finish(resolve);
          if (status === 'disconnected') {
            finish(() => reject(new Error('The local daemon data plane disconnected.')));
          }
        });
        void subscription.rejoin().catch((error: unknown) => finish(() => reject(error)));
      });
    })
  );
}

export type WorkspaceManagerDeliveryConfirmation = 'required' | 'best-effort';

export async function confirmWorkspaceManagerDelivery(args: {
  repo: LoroDocumentManager['repo'];
  mode: WorkspaceManagerDeliveryConfirmation;
  logger?: Pick<ReturnType<typeof getLogger>, 'warn'>;
}): Promise<void> {
  try {
    await confirmLocalRepoDelivery(args.repo);
  } catch (error) {
    if (args.mode === 'required') throw error;
    (args.logger ?? getLogger('workspace-manager')).warn(
      `Local workspace delivery confirmation did not complete; the durable dispatch will converge on reconnect: ${formatErrorMessage(error)}`
    );
  }
}

export async function withWorkspaceManager<T>(
  auth: AuthContext,
  workspace: WorkspaceSummary,
  loggerName: string,
  fn: (manager: LoroDocumentManager) => Promise<T>,
  options: { deliveryConfirmation?: WorkspaceManagerDeliveryConfirmation } = {}
): Promise<T> {
  if (auth.token) throw new Error('Product-cloud workspaces are unavailable in local Molly.');
  const logger = getLogger(loggerName);
  const manager = await LoroDocumentManager.create(
    workspace.id as WorkspaceId,
    auth.userId,
    logger
  );
  let link: Awaited<ReturnType<typeof connectLocalLoroDataPlane>> | null = null;
  try {
    link = await connectLocalLoroDataPlane();
    await manager.repo.addTransport(
      'local',
      new LocalLoroTransportAdapter({ workspaceId: workspace.id, connection: link.connection }),
      { ephemeral: true }
    );
    await manager.repo.refreshTransportRoutes();
    const result = await fn(manager);
    await confirmWorkspaceManagerDelivery({
      repo: manager.repo,
      mode: options.deliveryConfirmation ?? 'required',
      logger,
    });
    return result;
  } finally {
    await manager.cleanUp({ fast: true, preserveSessionStatus: true }).catch(() => undefined);
    link?.close();
  }
}

export async function ensureWorkspaceMetaSynced(
  manager: Pick<LoroDocumentManager, 'waitUntilMetaSynced'>,
  reason: string
): Promise<void> {
  const synced = await manager.waitUntilMetaSynced({ reason });
  if (!synced) {
    throw new Error(
      `Workspace metadata changes were not confirmed by Loro Streams (${reason}). Retry the command after checking network connectivity.`
    );
  }
}

function buildOfflineHint(error: unknown): WorkspaceSyncUnavailableError {
  return new WorkspaceSyncUnavailableError({
    message: `${formatErrorMessage(error)} Use --offline to read the local cache without syncing.`,
    cause: error,
  });
}

export async function syncWorkspaceMetaForRead(
  manager: Pick<LoroDocumentManager, 'syncMetaOrThrow'>,
  reason: string
): Promise<void> {
  try {
    await manager.syncMetaOrThrow({ reason });
  } catch (error) {
    throw buildOfflineHint(error);
  }
}

export async function syncDocForRead(
  manager: Pick<LoroDocumentManager, 'syncDocOrThrow'>,
  docId: string,
  reason: string
): Promise<void> {
  try {
    await manager.syncDocOrThrow(docId, { reason });
  } catch (error) {
    throw buildOfflineHint(error);
  }
}

export async function listAliveDocMetas<Meta>(
  manager: LoroDocumentManager,
  predicate: (roomId: string) => boolean
): Promise<Array<{ roomId: string; meta: Meta }>> {
  const roomIds = await listAliveRoomIds(manager, predicate);
  const results = await Promise.all(
    roomIds.map(async (roomId) => {
      const record = await manager.repo.getDocMeta(roomId);
      if (!record?.meta || isLoroRepoDocDeleted(record)) {
        return null;
      }
      return { roomId, meta: record.meta as Meta };
    })
  );

  return results.filter((result): result is { roomId: string; meta: Meta } => result !== null);
}

/**
 * Lists Session metadata with identity normalized from the authoritative room key.
 * Session metadata is patchable CRDT state and may be sparse, so its embedded id
 * must not be trusted for discovery or identity.
 */
export async function listAliveSessionMetas(
  manager: LoroDocumentManager
): Promise<Array<{ roomId: string; meta: SessionMeta }>> {
  const rows = await listAliveDocMetas<SessionMeta>(manager, isSessionDocRoomId);
  return rows.flatMap(({ roomId, meta }) => {
    const id = getSessionIdFromRoomId(roomId);
    return id === null ? [] : [{ roomId, meta: { ...meta, id } }];
  });
}

function readLocalControlTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = normalizeCliValue(
    env.MOLLY_SESSION_LOCAL_CONTROL_TIMEOUT_MS ?? env.LODY_SESSION_LOCAL_CONTROL_TIMEOUT_MS
  );
  if (!raw) {
    return DEFAULT_LOCAL_CONTROL_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LOCAL_CONTROL_TIMEOUT_MS;
  }
  return parsed;
}

export async function ensureDaemonReachable(options: LocalIpcDiscoveryOptions = {}): Promise<void> {
  // Connectivity check only, matching the original behavior (HTTP 2xx = running).
  // A 2xx whose body fails health validation still means the daemon is serving
  // the probe (e.g. CLI/daemon version skew), so we must not report it as down.
  const outcome = await Effect.runPromise(
    Effect.either(
      makeLocalProbeClientAuto(options).health({
        timeoutMs: DAEMON_HEALTH_PROBE_TIMEOUT_MS,
      })
    )
  );
  if (outcome._tag === 'Left') {
    if (
      outcome.left instanceof IpcProtocolError &&
      typeof outcome.left.status === 'number' &&
      outcome.left.status >= 200 &&
      outcome.left.status < 300
    ) {
      return;
    }
    throw classifyLocalDaemonIpcError(outcome.left);
  }
}

export async function dispatchLocalControl(
  message: LocalSessionControlRequest,
  options: LocalIpcDiscoveryOptions = {}
): Promise<LocalSessionControlResponse[]> {
  // Send the real request once. A health preflight doubles local IPC traffic and
  // cannot distinguish a daemon that exits between the probe and the request.
  const outcome = await Effect.runPromise(
    Effect.either(
      makeLocalControlClientAuto(options).sessionControl(message, {
        timeoutMs: readLocalControlTimeoutMs(),
      })
    )
  );
  if (outcome._tag === 'Left') {
    throw classifyLocalDaemonIpcError(outcome.left);
  }
  return outcome.right;
}

function shouldForceExitProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VITEST !== 'true' && env.NODE_ENV !== 'test';
}

async function flushWritableStream(stream: NodeJS.WriteStream): Promise<void> {
  if (stream.destroyed || !stream.writable) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    stream.write('', (error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function exitOneShotCommand(code: number): Promise<void> {
  process.exitCode = code;
  // Flush buffered analytics before the process can terminate: one-shot commands
  // may exit immediately and the flush timer is unref'd, so events would be lost.
  await flushTelemetry();
  if (!shouldForceExitProcess()) {
    return;
  }

  try {
    await Promise.all([flushWritableStream(process.stdout), flushWritableStream(process.stderr)]);
  } finally {
    process.exit(code);
  }
}

export async function runOneShotCommand(
  loggerName: string,
  options: Pick<CommonCommandOptions, 'json' | 'jsonl' | 'debug'>,
  action: () => Promise<void>
): Promise<void> {
  if (options.debug) {
    rootLogger.setDebug(true);
  }

  try {
    await action();
    await exitOneShotCommand(0);
  } catch (error) {
    const commandError =
      error && typeof error === 'object'
        ? (error as { suppressCommandErrorOutput?: boolean; exitCode?: number })
        : undefined;
    const message = formatErrorMessage(error);
    if (commandError?.suppressCommandErrorOutput !== true) {
      if (options.json || options.jsonl) {
        printJson({ ok: false, error: message });
      } else {
        getLogger(loggerName).error(message);
      }
    }
    await exitOneShotCommand(commandError?.exitCode ?? 1);
  }
}
