/**
 * C2-A edit surface — transform family 纯映射（GD-4c Wave C2 ticket #12；#16
 * 追加面板映射移动：numField/z-order 从 patch panels.ts 移入本模块）。
 *
 * Node-safe：state → 精确 VisualCommandV4。
 * - common.flip 行（adapter，frame 层装饰器承载显示）：setFlip [h, v]。
 * - common.group 行（hybrid，仅扁平 group，C22 嵌套具名拒绝）：setGroupId
 *   标签或 null（离组）。
 * - image.cropShape 行（adapter）：setImageCropShape 整写 ShapeDef；preset
 *   子集 = isModeledCropShape 同一闭合面（rect/roundRect/ellipse/oval/
 *   triangle；custom 需显式 viewBox+path，不进预设表）；null = 清除。
 * - common.bounds/rotation/opacity 行（面板数字行 setNum）：setBounds /
 *   setRotation / setStyle，单轴只换受动轴、同值/非法/缺失零命令（transient 与
 *   无效输入不落 canonical）。
 * - common.zOrder 行（面板 step/reorder）：setZOrder；多选层级不在 A1a-2
 *   支持集（零命令，绝不折叠近似）、越界/已在边缘零命令。
 */
import type { BentoCropShapeDefV4, BentoDocV4, VisualCommandV4 } from "contracts";
import { STATIC_V1_CROP_SHAPES } from "contracts";

/** cropShape 预设（image.cropShape 行 modeled 子集；roundRect 万分比圆角缺省 50000）。 */
export const CROP_SHAPE_PRESETS: readonly BentoCropShapeDefV4[] = STATIC_V1_CROP_SHAPES
  .filter((shapeName) => shapeName !== "custom")
  .map((shapeName) => shapeName === "roundRect"
    ? { shapeName, adjustments: [50000] }
    : { shapeName });

/** 翻转（common.flip 行）：[水平, 垂直]；null = 清除字段（可逆缺省）。 */
export function flipCommands(id: string, flip: [boolean, boolean] | null): VisualCommandV4[] {
  return [{ type: "setFlip", targetId: id, flip }];
}

/** 组/离组（common.group 行）：组标签或 null。 */
export function groupCommands(id: string, groupId: string | null): VisualCommandV4[] {
  return [{ type: "setGroupId", targetId: id, groupId }];
}

/** 图像遮罩 ShapeDef 整写 / 清除（image.cropShape 行）。 */
export function cropShapeCommands(id: string, cropShape: BentoCropShapeDefV4 | null): VisualCommandV4[] {
  return [{ type: "setImageCropShape", targetId: id, cropShape }];
}

// ---- #16：面板数字行 / z-order 映射（patch panels.ts setNum/step/reorder 语义移入） ----

/** 面板数字行可编辑轴（setNum 的封闭键集）。 */
export type NumFieldKey = "x" | "y" | "w" | "h" | "rotation" | "opacity";

/** The transform panel shares the authoring bounds containment invariant with
 * the kernel: a terminal edit that would leave the canvas is a no-op. */
export function boundsWithinCanvas(
  bounds: readonly [number, number, number, number],
  canvas: BentoDocV4["canvas"],
): boolean {
  return bounds.every(Number.isFinite) && bounds[0] >= 0 && bounds[1] >= 0 &&
    bounds[2] > 0 && bounds[3] > 0 &&
    bounds[0] + bounds[2] <= canvas.width && bounds[1] + bounds[3] <= canvas.height;
}

/**
 * 面板数字行（common.bounds/rotation/opacity 行）：canonical 元素 + 单轴新值
 * → 精确命令批。x/y/w/h 单轴替换后 setBounds；rotation → setRotation；opacity
 * → setStyle。非法（NaN/非有限）输入、同值（不换轴）、元素缺失 → 零命令（最终
 * 手势不产生空批，transient/无效不落 canonical）。
 */
export function numFieldCommands(
  doc: BentoDocV4,
  id: string,
  key: NumFieldKey,
  value: number,
): VisualCommandV4[] {
  if (!Number.isFinite(value)) return [];
  if ((key === "w" || key === "h") && value <= 0) return [];
  if (key === "opacity" && (value < 0 || value > 1)) return [];
  const element = doc.elements.find((candidate) => candidate.id === id);
  if (element === undefined) return [];
  if (key === "opacity") {
    if (value === (element.opacity ?? 1)) return [];
    return [{ type: "setStyle", targetId: id, patch: { opacity: value } }];
  }
  if (key === "rotation") {
    if (element.kind === "table" || element.kind === "chart") return [];
    if (value === (element.rotation ?? 0)) return [];
    return [{ type: "setRotation", targetId: id, rotation: value }];
  }
  const [x, y, w, h] = element.bounds as [number, number, number, number];
  const axis = { x, y, w, h }[key];
  if (value === axis) return [];
  const bounds: [number, number, number, number] = [x, y, w, h];
  bounds["xywh".indexOf(key) as 0 | 1 | 2 | 3] = value;
  if (!boundsWithinCanvas(bounds, doc.canvas)) return [];
  return [{ type: "setBounds", targetId: id, bounds }];
}

/**
 * z-order 相邻一步（step）：候选集必须恰一个元素（多选层级不在 A1a-2 支持集，
 * 零命令——绝不折叠近似）；越界（已到边缘）零命令。
 */
export function zOrderStepCommands(
  order: readonly string[],
  candidates: readonly string[],
  dir: 1 | -1,
): VisualCommandV4[] {
  if (candidates.length !== 1) return [];
  const targetId = candidates[0] as string;
  const index = order.indexOf(targetId);
  if (index < 0) return [];
  const next = index + dir;
  if (next < 0 || next >= order.length) return [];
  return [{ type: "setZOrder", targetId, index: next }];
}

/**
 * z-order 一步到边（reorder Bring to front / Send to back）：多选零命令；
 * 已位于目标边缘（无操作空间）零命令。
 */
export function zOrderToEdgeCommands(
  order: readonly string[],
  candidates: readonly string[],
  where: "front" | "back",
): VisualCommandV4[] {
  if (candidates.length !== 1) return [];
  const targetId = candidates[0] as string;
  const index = order.indexOf(targetId);
  if (index < 0) return [];
  const edge = where === "front" ? order.length - 1 : 0;
  if (index === edge) return [];
  return [{ type: "setZOrder", targetId, index: edge }];
}
