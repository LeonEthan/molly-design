/**
 * 编辑 bridge（docs/a1a-2-acceptance.md §3）：自 spikes/a0b-bento/src/editor-bento.ts
 * 提升，类型换成 contracts 公共 VisualCommandV4/kernel 类型（GD-4b B2 类型 ripple），
 * kernel 换成 semantic BentoDocV4 kernel（packages/kernel）。Bento Store 私有类型不跨本模块 public API。
 */

import type { ApplyResultV4, VisualCommandV4, VisualDocumentSnapshot, VisualTreeV4 } from "contracts";
import { installEditSurface } from "./ui/dom/mount.ts";
import type { RecordingVisualDocumentKernel, VisualTraceEntry } from "./trace-kernel.ts";

// C2-B trace 测试 seam（ticket #13）：recording kernel 是 Node-safe 纯模块
// （无浏览器语法），bridge.ts 只 re-export——Node 测试直接消费 trace-kernel.ts。
export type { RecordingVisualDocumentKernel, VisualTraceEntry } from "./trace-kernel.ts";
export { createRecordingVisualDocumentKernel } from "./trace-kernel.ts";

/**
 * Bento 事件 adapter：只依赖公开 recording kernel seam 与宿主持有的视图刷新回调。
 * 成功才 refreshView；refresh 参数是 semantic snapshot（canonical JSON），由宿主
 * 投影为 native 视图——单向，永不反向。
 */
export class BentoVisualBridge {
  private sequence = 0;
  private readonlyMode = false;

  setReadonly(value: boolean): void { this.readonlyMode = value; }
  private readonly kernel: RecordingVisualDocumentKernel;
  private readonly refreshView: (snapshot: VisualDocumentSnapshot) => void;

  constructor(
    kernel: RecordingVisualDocumentKernel,
    refreshView: (snapshot: VisualDocumentSnapshot) => void,
  ) {
    this.kernel = kernel;
    this.refreshView = refreshView;
    // C2-A project-side edit surface（ticket #12）：浏览器路径挂载，Node 惰性跳过。
    // 全项目侧实现（src/ui/dom/*），零 vendor patch——所有手势经本 bridge 命令面。
    installEditSurface(this);
  }

  dispatch(commands: readonly VisualCommandV4[]): ApplyResultV4 {
    // Empty mappings are a real UI no-op (same/invalid form values, selection
    // changes, edge z-order).  Do not allocate a batch id, advance the bridge
    // sequence, call the kernel, or refresh the native view for them.
    if (commands.length === 0) {
      return {
        ok: false,
        revision: this.kernel.revision,
        error: {
          code: "INVALID_BATCH",
          message: "empty command batch is a no-op",
        },
      };
    }
    this.sequence += 1;
    return this.runAndRefresh(() =>
      this.kernel.apply({
        batchId: `ui-${this.sequence}`,
        actor: "user",
        baseRevision: this.kernel.revision,
        commands,
      }),
    );
  }

  undo(): ApplyResultV4 {
    return this.runAndRefresh(() => this.kernel.undo());
  }

  redo(): ApplyResultV4 {
    return this.runAndRefresh(() => this.kernel.redo());
  }

  trace(): readonly VisualTraceEntry[] {
    return this.kernel.trace();
  }

  inspect(): VisualTreeV4 {
    return this.kernel.inspect();
  }

  /** canonical 全量 JSON（canonicalJson 品牌串；面板经 JSON.parse 读取当前态）。 */
  snapshot(): VisualDocumentSnapshot {
    return this.kernel.snapshot();
  }

  get revision(): number {
    return this.kernel.revision;
  }

  private runAndRefresh(run: () => ApplyResultV4): ApplyResultV4 {
    if (this.readonlyMode) return {
      ok: false, revision: this.kernel.revision,
      error: { code: "INVALID_BATCH", message: "Canvas is read-only" },
    };
    const result = run();
    if (result.ok) this.refreshView(result.snapshot);
    return result;
  }
}
