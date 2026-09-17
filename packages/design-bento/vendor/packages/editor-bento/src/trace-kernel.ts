/**
 * Recording visual-document kernel seam（GD-4c Wave C2 ticket #13：命令 trace
 * 测试 seam —— C2-B 手势路由 trace 断言经此模块；走 Node-safe 纯函数/接口，
 * 无浏览器语法，Node --test strip 模式可直接加载）。
 *
 * 被包裹的 kernel 仍是 canonical 状态与历史的唯一 owner；本模块只附加只读的
 * apply/undo/redo 命令 trace（成功批次和失败调用各保留一条记录）。BentoVisualBridge
 * 与 boot 端经 bridge.ts re-export 消费同一实现。
 */
import { createVisualDocumentKernel } from "kernel";
import type {
  ApplyError,
  ApplyResultV4,
  BentoDocV4,
  CommandBatchV4,
  VisualCommandV4,
  VisualDocumentKernelV4,
  VisualDocumentSnapshot,
  VisualTreeV4,
} from "contracts";

export interface VisualTraceEntry {
  /** Zero-based position in the recording; the position is part of the evidence contract. */
  index: number;
  operation: "apply" | "undo" | "redo";
  batchId: string;
  commandTypes: readonly string[];
  /** Exact command payloads sent to the semantic kernel for this batch. */
  commands: readonly VisualCommandV4[];
  revisionBefore: number;
  revisionAfter: number;
  ok: boolean;
  /** Exact batch submitted to the production kernel; null for history ops. */
  batch: CommandBatchV4 | null;
  /** Exact kernel rejection, if any. Successful entries carry null. */
  error: ApplyError | null;
}

export interface RecordingVisualDocumentKernel extends VisualDocumentKernelV4 {
  trace(): readonly VisualTraceEntry[];
}

/** 记录公开命令/历史协议；被包裹的 kernel 仍是 canonical 状态与历史的唯一 owner。 */
export function createRecordingVisualDocumentKernel(
  doc: BentoDocV4,
): RecordingVisualDocumentKernel {
  const kernel = createVisualDocumentKernel(doc);
  const entries: VisualTraceEntry[] = [];
  let sequence = 0;
  type HistoryEntry = {
    forward: CommandBatchV4;
    inverse: CommandBatchV4;
  };
  // Keep only the command batches needed to describe undo/redo at this seam.
  // The wrapped kernel remains the owner of canonical state and history.
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];

  const record = (
    operation: VisualTraceEntry["operation"],
    batch: CommandBatchV4 | null,
    run: () => ApplyResultV4,
  ): ApplyResultV4 => {
    const revisionBefore = kernel.revision;
    const result = run();
    const batchId = batch?.batchId ?? `${operation}-${sequence}`;
    const commandTypes = batch?.commands.map((command) => command.type) ?? [];
    const commands = batch?.commands ?? [];
    // A successful no-op is not a persistent operation and therefore must not
    // create a trace entry which claims the revision advanced. Failed calls do
    // remain observable, with their revision unchanged and exact error.
    if (!result.ok || result.revision !== revisionBefore) {
      entries.push({
        index: entries.length,
        operation,
        batchId,
        commandTypes,
        commands: structuredClone(commands),
        revisionBefore,
        revisionAfter: result.revision,
        ok: result.ok,
        batch: batch === null ? null : structuredClone(batch),
        error: result.ok ? null : structuredClone(result.error),
      });
    }
    return result;
  };

  return {
    get revision() {
      return kernel.revision;
    },

    apply(batch: CommandBatchV4): ApplyResultV4 {
      // The recording seam mirrors BentoVisualBridge's no-op interception:
      // empty UI mappings must not create a failed trace entry.  The wrapped
      // kernel remains the validator for non-empty batches.
      if (batch.commands.length === 0) {
        return {
          ok: false,
          revision: kernel.revision,
          error: {
            code: "INVALID_BATCH",
            message: "empty command batch is a no-op",
          },
        };
      }
      sequence += 1;
      const before = kernel.revision;
      const result = record(
        "apply",
        batch,
        () => kernel.apply(batch),
      );
      if (result.ok && result.revision === before + 1) {
        // `inverseBatch` is the exact inverse returned by the production
        // kernel. It is retained only to make a later undo trace explicit.
        undoStack.push({
          forward: structuredClone(batch),
          inverse: structuredClone(result.inverseBatch),
        });
        redoStack.length = 0;
      }
      return result;
    },

    undo(): ApplyResultV4 {
      sequence += 1;
      const before = kernel.revision;
      const entry = undoStack.at(-1);
      const batch = entry === undefined
        ? null
        : { ...structuredClone(entry.inverse), baseRevision: before };
      const result = record("undo", batch, () => kernel.undo());
      if (entry !== undefined && result.ok && result.revision === before + 1) {
        undoStack.pop();
        redoStack.push(entry);
      }
      return result;
    },

    redo(): ApplyResultV4 {
      sequence += 1;
      const before = kernel.revision;
      const entry = redoStack.at(-1);
      const batch = entry === undefined
        ? null
        : { ...structuredClone(entry.forward), baseRevision: before };
      const result = record("redo", batch, () => kernel.redo());
      if (entry !== undefined && result.ok && result.revision === before + 1) {
        redoStack.pop();
        undoStack.push(entry);
      }
      return result;
    },

    inspect(): VisualTreeV4 {
      return kernel.inspect();
    },

    snapshot(): VisualDocumentSnapshot {
      return kernel.snapshot();
    },

    trace(): readonly VisualTraceEntry[] {
      // Entries are immutable by construction (structuredClone at record time);
      // consumers read length/fields only, so a shallow copy of the list suffices.
      return entries.slice();
    },
  };
}
