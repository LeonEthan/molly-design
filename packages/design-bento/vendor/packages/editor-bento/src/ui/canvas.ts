/**
 * C2-D edit surface — canvas.size 纯映射（GD-4c Wave C2 ticket #16）。
 *
 * 项目侧 Page Setup 面板把一次宽/高终态手势映射为一个
 * `setCanvasSize` VisualCommand。数值便利约束只在这个纯模块集中定义：UI
 * 可以给出任意有限数值，canonical 命令得到的宽高始终是 1..16000 的正整数；
 * kernel 仍是最终的 closed-world 校验与唯一写入者。
 */
import type { BentoDocV4, VisualCommandV4 } from "contracts";

export const CANVAS_SIZE_MIN = 1;
export const CANVAS_SIZE_MAX = 16000;

export type CanvasDimension = "width" | "height";

/**
 * 将一个 UI 尺寸输入归一化为 GD-2c 裁决的可提交整数。
 * 调用方必须先排除非有限值；这里保留显式 NaN/Infinity 处理，避免任何
 * accidental `NaN` 进入命令对象或 DOM 重投影。
 */
export function clampCanvasDimension(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.max(CANVAS_SIZE_MIN, Math.min(CANVAS_SIZE_MAX, Math.round(value)));
}

/**
 * Page Setup W/H 输入 → 文档级 setCanvasSize 命令。
 * 同值/非有限值不生成空批；另一个维度始终从当前 canonical 快照保留。
 */
export function canvasSizeCommands(
  doc: BentoDocV4,
  dimension: CanvasDimension,
  value: number,
): VisualCommandV4[] {
  if (!Number.isFinite(value)) return [];
  const next = clampCanvasDimension(value);
  const width = dimension === "width" ? next : doc.canvas.width;
  const height = dimension === "height" ? next : doc.canvas.height;
  if (width === doc.canvas.width && height === doc.canvas.height) return [];
  return [{ type: "setCanvasSize", width, height }];
}
