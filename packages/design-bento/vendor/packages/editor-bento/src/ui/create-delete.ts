/**
 * C2-A edit surface — create/delete 命令映射（GD-4c Wave C2 ticket #12；
 * docs/gd-4-progress.md Wave C2 item 1 "create/delete surface——kernel 已有
 * createElement/deleteElement 命令，UI 缺失；common.createDelete 行 C23 接管"）。
 *
 * Node-safe 纯映射：UI state（kind/id/画布/asset）→ 精确 VisualCommandV4 批。
 * 每个终态手势只产出生效命令，DOM 面板不内联构造命令（命令面单一来源）。
 */
import type { VisualCommandV4 } from "contracts";
import { defaultElement, defaultImageElement, type CanvasSize } from "./defaults.ts";

/** 以缺省元素创建（common.createDelete 行）。 */
export function createElementCommand(
  kind: "text" | "shape" | "line" | "icon" | "table" | "chart",
  id: string,
  canvas: CanvasSize,
): VisualCommandV4[] {
  return [{ type: "createElement", element: defaultElement(kind, id, canvas) }];
}

/** image 创建必须携带 asset 引用（registerAsset 前置；image.src 行 src 不手编）。 */
export function imageCreateElementCommand(
  id: string,
  canvas: CanvasSize,
  assetRef: string,
): VisualCommandV4[] {
  return [{ type: "createElement", element: defaultImageElement(id, canvas, assetRef) }];
}

/** 删除选中元素（inverse = createElement 完整元素，内核保证）。 */
export function deleteElementCommand(id: string): VisualCommandV4[] {
  return [{ type: "deleteElement", targetId: id }];
}