/**
 * C2-D canvas.size 面板（GD-4c Wave C2 ticket #16）。
 *
 * 这是项目侧的 Page Setup UI；它不接触 vendor Store。每个 change 只通过
 * `dispatch` 交给 `ui/canvas.ts` 的纯映射，再由 BentoVisualBridge 进入 kernel。
 */
import type { BentoDocV4, VisualCommandV4 } from "contracts";
import { canvasSizeCommands, CANVAS_SIZE_MAX, CANVAS_SIZE_MIN } from "../canvas.ts";
import { numberInput, row, section } from "./primitives.ts";

export interface CanvasPanelContext {
  dispatch(commands: readonly VisualCommandV4[]): void;
  /** 每次终态 change 都重读 canonical，避免焦点守卫期间使用旧尺寸。 */
  readDoc(): BentoDocV4;
}

/** 渲染文档级画布尺寸控件（无选中元素时也可编辑）。 */
export function renderCanvasPanel(
  host: HTMLElement,
  doc: BentoDocV4,
  ctx: CanvasPanelContext,
): void {
  host.appendChild(section("Canvas"));

  const width = numberInput(
    doc.canvas.width,
    (value) => ctx.dispatch(canvasSizeCommands(ctx.readDoc(), "width", value)),
    { min: CANVAS_SIZE_MIN, max: CANVAS_SIZE_MAX, step: 1 },
    "setCanvasSize",
  );
  width.classList.add("ed-a1a2-canvas-width");
  host.appendChild(row("Canvas width", width));

  const height = numberInput(
    doc.canvas.height,
    (value) => ctx.dispatch(canvasSizeCommands(ctx.readDoc(), "height", value)),
    { min: CANVAS_SIZE_MIN, max: CANVAS_SIZE_MAX, step: 1 },
    "setCanvasSize",
  );
  height.classList.add("ed-a1a2-canvas-height");
  host.appendChild(row("Canvas height", height));
}
