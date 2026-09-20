import {
  getTaskIndexFlockDocId,
  getTaskIndexScanPrefix,
  listVisibleTaskIndexRows,
  readTaskIndexRows,
  type AgentConfigMeta,
  type MachineId,
  type TaskId,
  type TaskIndexRow,
  type TaskIndexScanRow,
  type WorkspaceId,
} from '@molly/shared';
import type { Logger } from '@/utils/logger';
import { getEmbeddedHarnessTargetError } from '@molly/shared/embedded-harness';
import type { TaskAutomationDispatch } from './task-automation-start';
import {
  collectTaskAutomationBaseline,
  planTaskAutomation,
  type TaskAutomationCandidate,
} from './task-automation-plan';

export type TaskAutomationSchedulerDeps = {
  workspaceId: WorkspaceId;
  machineId: MachineId;
  /** Authenticated user of this machine; only their tasks may auto-run. */
  operatorUserId: string;
  logger: Logger;
  /** Reads the workspace task index rows. */
  readTaskIndex: () => Promise<TaskIndexRow[]>;
  /** Agent configs that live on this machine. */
  listOwnedAgentConfigs: () => Promise<AgentConfigMeta[]>;
  /** Whether this machine can execute right now. */
  isMachineOnline: () => boolean;
  /** Throws only before dispatch. A result owns settlement-only work; void means already settled. */
  startTask: (taskId: TaskId, agentConfigId: string) => Promise<TaskAutomationDispatch | void>;
  /** Called when a task is eligible but has to wait its turn or for the agent. */
  onQueued?: (taskId: TaskId, position: number) => void;
};

const toCandidate = (row: TaskIndexRow): TaskAutomationCandidate => ({
  taskId: row.taskId,
  order: row.order,
  ownerId: row.ownerId,
  ...(row.agentConfigId ? { agentConfigId: row.agentConfigId } : {}),
  status: row.status,
  ready: row.ready !== false,
});

/**
 * Machine-side scheduler for tasks entrusted to an agent that lives here.
 *
 * The point of running this on the machine rather than in the app is that the
 * work continues when nobody is looking: a task assigned while the laptop was
 * closed starts when it opens, and the queue keeps draining after the user walks
 * away.
 *
 * Policy lives entirely in `planTaskAutomation`; this class only supplies facts,
 * enforces one-start-at-a-time, and performs the starts.
 */
export class TaskAutomationScheduler {
  private readonly deps: TaskAutomationSchedulerDeps;
  private baseline: Set<string> | null = null;
  private readonly started = new Set<string>();
  private readonly inFlightByAgentConfigId = new Map<string, string>();
  private readonly pendingSettlements = new Map<string, TaskAutomationDispatch>();
  private settlementTimer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private rerunRequested = false;
  private stopped = false;

  constructor(deps: TaskAutomationSchedulerDeps) {
    this.deps = deps;
  }

  stop(): void {
    this.stopped = true;
    if (this.settlementTimer !== undefined) clearTimeout(this.settlementTimer);
    this.settlementTimer = undefined;
  }

  /**
   * Re-evaluates the queue. Safe to call on every task-index change: passes are
   * coalesced, so a burst of assignments produces one evaluation, not one per row.
   */
  async evaluate(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerunRequested = false;
        await this.runPass();
      } while (this.rerunRequested && !this.stopped);
    } finally {
      this.running = false;
    }
  }

  private async runPass(): Promise<void> {
    await this.settleDispatchedTasks();
    if (this.stopped) return;
    const rows = await this.deps.readTaskIndex();
    const candidates = rows.map(toCandidate);
    const ownedAgents = await this.deps.listOwnedAgentConfigs();
    if (this.stopped) return;
    const ownedAgentConfigIds = new Set(
      ownedAgents
        .filter((config) => config.machineId === this.deps.machineId)
        .map((config) => config.id as string)
    );

    if (this.baseline === null) {
      // First pass only records what was already waiting. Starting it here would
      // mean every daemon restart replays the whole backlog.
      this.baseline = collectTaskAutomationBaseline(candidates, {
        ownedAgentConfigIds,
        operatorUserId: this.deps.operatorUserId,
      });
      if (this.baseline.size > 0) {
        this.deps.logger.debug(
          `[task-automation] baseline recorded count=${this.baseline.size} (not started)`
        );
      }
      return;
    }

    // A task that left eligibility is no longer "pre-existing": if it comes back,
    // that is a fresh observed transition and may run.
    const stillEligible = new Set(
      candidates
        .filter(
          (entry) =>
            (entry.status === 'backlog' || entry.status === 'todo') &&
            entry.ready &&
            entry.agentConfigId
        )
        .map((entry) => entry.taskId)
    );
    for (const taskId of [...this.baseline]) {
      if (!stillEligible.has(taskId)) {
        this.baseline.delete(taskId);
      }
    }

    // The machine being offline is the same wait as the agent being unreachable.
    const onlineAgentConfigIds = this.deps.isMachineOnline()
      ? ownedAgentConfigIds
      : new Set<string>();

    const plan = planTaskAutomation({
      candidates,
      // Baseline ownership above includes retired records: making a config
      // executable later must not replay tasks that were present at boot.
      ownedAgentConfigIds: new Set(
        ownedAgents
          .filter(
            (config) =>
              ownedAgentConfigIds.has(config.id) &&
              getEmbeddedHarnessTargetError(config) === undefined
          )
          .map((config) => config.id)
      ),
      onlineAgentConfigIds,
      operatorUserId: this.deps.operatorUserId,
      inFlightByAgentConfigId: this.inFlightByAgentConfigId,
      baselineTaskIds: this.baseline,
      startedTaskIds: this.started,
    });

    for (const queued of plan.queued) {
      this.deps.onQueued?.(queued.taskId as TaskId, queued.position);
    }

    for (const start of plan.start) {
      if (this.stopped) break;
      if (this.inFlightByAgentConfigId.has(start.agentConfigId)) {
        // Another start in this same pass already claimed the agent's slot.
        continue;
      }
      this.inFlightByAgentConfigId.set(start.agentConfigId, start.taskId);
      this.started.add(start.taskId);
      try {
        this.deps.logger.debug(
          `[task-automation] starting taskId=${start.taskId} agentConfigId=${start.agentConfigId}`
        );
        const dispatched = await this.deps.startTask(start.taskId as TaskId, start.agentConfigId);
        if (dispatched) {
          this.pendingSettlements.set(start.agentConfigId, dispatched);
        } else {
          this.inFlightByAgentConfigId.delete(start.agentConfigId);
        }
      } catch (error) {
        // This boundary is pre-dispatch only. Post-dispatch status failures are
        // held separately and may never cause another Session creation.
        this.started.delete(start.taskId);
        this.inFlightByAgentConfigId.delete(start.agentConfigId);
        this.deps.logger.warn(
          `[task-automation] failed to start taskId=${start.taskId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    await this.settleDispatchedTasks();
  }

  private async settleDispatchedTasks(): Promise<void> {
    for (const [agentConfigId, dispatched] of this.pendingSettlements) {
      if (this.stopped) break;
      try {
        await dispatched.settle();
        this.pendingSettlements.delete(agentConfigId);
        this.inFlightByAgentConfigId.delete(agentConfigId);
      } catch (error) {
        this.deps.logger.warn(
          `[task-automation] dispatched task status pending agentConfigId=${agentConfigId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    if (!this.stopped && this.pendingSettlements.size > 0 && this.settlementTimer === undefined) {
      this.settlementTimer = setTimeout(() => {
        this.settlementTimer = undefined;
        void this.evaluate().catch((error: unknown) =>
          this.deps.logger.warn(
            `[task-automation] status repair failed: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }, 5_000);
      this.settlementTimer.unref?.();
    } else if (this.pendingSettlements.size === 0 && this.settlementTimer !== undefined) {
      clearTimeout(this.settlementTimer);
      this.settlementTimer = undefined;
    }
  }
}

/** Minimal repo surface needed to read the workspace task index. */
export type TaskIndexReadableRepo = {
  openFlockDoc: (flockDocId: string) => Promise<{
    flock: { scan(options?: { prefix?: string[] }): Iterable<TaskIndexScanRow> };
  }>;
};

/** Reads the workspace task index rows from a Flock handle. */
export const readTaskIndexRowsForWorkspace = async (
  repo: TaskIndexReadableRepo,
  workspaceId: WorkspaceId
): Promise<TaskIndexRow[]> => {
  const handle = await repo.openFlockDoc(getTaskIndexFlockDocId(workspaceId));
  // `scan` must stay a method call: the Flock implementation reads `this`, so a
  // detached reference throws `Cannot read properties of undefined`.
  return listVisibleTaskIndexRows(
    readTaskIndexRows(handle.flock.scan({ prefix: getTaskIndexScanPrefix() }))
  );
};
