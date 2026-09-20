import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  getSessionRoomId,
  getTaskRoomId,
  isLoroRepoDocDeleted,
  type MachineId,
  type SessionId,
  type SessionMeta,
  type TaskId,
  type WorkspaceId,
} from '@molly/shared';
import type { LoroDocumentManager } from '@/lib/loro/doc';
import { listAliveRoomIds } from '@/lib/loro/repo-existence';
import { applyAgentTaskUpdate, type TaskSnapshot } from '@/lib/task-doc';

const repairSchema = z
  .object({
    version: z.literal(1),
    dispatchState: z.enum(['prepared', 'dispatched']),
    taskId: z.string().min(1).max(256),
    agentConfigId: z.string().min(1).max(256),
    ownerId: z.string().min(1).max(256),
    taskStateHash: z.string().regex(/^[a-f0-9]{64}$/u),
    userTurnId: z.string().min(1).max(256),
  })
  .strict();

export type TaskAutomationRecoveryDeps = {
  manager: LoroDocumentManager;
  workspaceId: WorkspaceId;
  machineId: MachineId;
  userId: string;
  signal?: AbortSignal;
};

/** Ignore only dispatch's own link bookkeeping, not later human/Agent decisions. */
export function taskAutomationStateHash(snapshot: TaskSnapshot): string {
  const { updatedAt: _updatedAt, ...meta } = snapshot.meta;
  return createHash('sha256')
    .update(
      JSON.stringify(
        {
          meta,
          body: snapshot.body,
          timeline: snapshot.timeline.filter((entry) => entry.activityType !== 'session_linked'),
        },
        (_key, value: unknown) => {
          if (value !== null && typeof value === 'object' && !Array.isArray(value))
            return Object.fromEntries(
              Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            );
          return value;
        }
      )
    )
    .digest('hex');
}

/** Existing metadata is the dispatch receipt. No history open or execution is needed. */
export async function settleTaskAutomationStatus(
  deps: TaskAutomationRecoveryDeps,
  sessionId: SessionId
): Promise<void> {
  deps.signal?.throwIfAborted();
  // A previous attempt may have cleared the in-memory receipt before its final
  // flush failed. Persist that pending clear before reporting settlement.
  await deps.manager.repo.flush();
  deps.signal?.throwIfAborted();
  const roomId = getSessionRoomId(sessionId);
  const record = await deps.manager.repo.getDocMeta(roomId);
  if (!record || isLoroRepoDocDeleted(record)) return;
  const meta = record.meta as Partial<SessionMeta> | undefined;
  if (!meta || meta.machineId !== deps.machineId || meta.userId !== deps.userId) return;
  if (meta.taskAutomationStatusRepair === undefined) return;
  const receipt = repairSchema.parse(meta.taskAutomationStatusRepair);
  if (receipt.dispatchState !== 'dispatched')
    throw new Error('task_automation_dispatch_outcome_unknown');
  if (
    meta.id !== sessionId ||
    meta.cliType !== 'builtin' ||
    meta.agentType !== 'molly' ||
    meta.taskId !== receipt.taskId ||
    meta.agentConfigId !== receipt.agentConfigId ||
    receipt.ownerId !== deps.userId
  )
    throw new Error('task_automation_repair_identity_mismatch');

  const taskRecord = await deps.manager.repo.getDocMeta(getTaskRoomId(receipt.taskId as TaskId));
  deps.signal?.throwIfAborted();
  const scanner = deps.manager.repo.getMeta();
  if (!scanner) throw new Error('task_automation_recovery_index_unavailable');
  const taskRoomId = getTaskRoomId(receipt.taskId as TaskId);
  const existence = await scanner.scan({ prefix: ['e', taskRoomId], includeRaw: false });
  const taskExists = Array.from(existence).some(
    (row) => row.key.length === 2 && row.key[1] === taskRoomId && row.value === true
  );
  if (taskExists && (!taskRecord || !isLoroRepoDocDeleted(taskRecord))) {
    await applyAgentTaskUpdate(
      deps.manager,
      deps.workspaceId,
      receipt.taskId as TaskId,
      { status: 'in_progress' },
      { agentConfigId: receipt.agentConfigId },
      (current, snapshot) =>
        deps.signal?.aborted !== true &&
        current.ownerId === receipt.ownerId &&
        current.agent?.agentConfigId === receipt.agentConfigId &&
        (current.status === 'backlog' || current.status === 'todo') &&
        taskAutomationStateHash(snapshot) === receipt.taskStateHash
    );
  }
  // A failed Task/index flush keeps the receipt for the next process. A newer
  // Task decision is already settled (do not restore the old status).
  const latest = await deps.manager.repo.getDocMeta(roomId);
  deps.signal?.throwIfAborted();
  if (
    latest &&
    !isLoroRepoDocDeleted(latest) &&
    isDeepStrictEqual((latest.meta as Partial<SessionMeta>)?.taskAutomationStatusRepair, receipt)
  ) {
    await deps.manager.repo.upsertDocMeta(roomId, { taskAutomationStatusRepair: undefined });
    await deps.manager.repo.flush();
  }
}

/** Boot/meta-sync only: filter metadata first, then open one matching Task at a time. */
export async function recoverTaskAutomationStatuses(
  deps: TaskAutomationRecoveryDeps
): Promise<void> {
  if (!deps.manager.repo.getMeta()) throw new Error('task_automation_recovery_index_unavailable');
  deps.signal?.throwIfAborted();
  await deps.manager.repo.flush();
  const roomIds = await listAliveRoomIds(deps.manager, (id) => id.startsWith('session-'));
  for (const roomId of roomIds) {
    deps.signal?.throwIfAborted();
    const record = await deps.manager.repo.getDocMeta(roomId);
    if (!record || isLoroRepoDocDeleted(record)) continue;
    const meta = record.meta as Partial<SessionMeta> | undefined;
    if (
      meta?.machineId !== deps.machineId ||
      meta.userId !== deps.userId ||
      meta.taskAutomationStatusRepair === undefined
    )
      continue;
    if (!meta.id || getSessionRoomId(meta.id) !== roomId)
      throw new Error('task_automation_repair_session_mismatch');
    await settleTaskAutomationStatus(deps, meta.id);
  }
}
