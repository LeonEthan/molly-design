/**
 * C2-A edit surface — line arrow 家族纯映射（GD-4c Wave C2 ticket #12）。
 *
 * Node-safe：state（[起, 终] 箭头对）→ 精确 setLineArrow 命令。PPTD
 * line.arrow 行全词表 {arrow, stealth, diamond, oval}；null 端 = 无箭头、
 * [null, null] = 清除（inverse 永远合法）。
 */
import type { BentoArrowheadV4, VisualCommandV4 } from "contracts";

export type LineCurveMode = "sharp" | "round" | "smooth";

const LINE_COORDINATE = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Authoring/editor gate for the same points-in-viewBox contract enforced by
 * the kernel.  Coordinates on the viewBox edge are legal; malformed or
 * outside points produce no terminal command. */
export function linePointsWithinViewBox(points: string, viewBox: readonly [number, number]): boolean {
  if (!Number.isFinite(viewBox[0]) || !Number.isFinite(viewBox[1]) || viewBox[0] <= 0 || viewBox[1] <= 0) return false;
  const tokens = points.trim().split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length < 2) return false;
  return tokens.every((token) => {
    const comma = token.indexOf(",");
    if (comma <= 0 || comma === token.length - 1) return false;
    const rawX = token.slice(0, comma);
    const rawY = token.slice(comma + 1);
    if (!LINE_COORDINATE.test(rawX) || !LINE_COORDINATE.test(rawY)) return false;
    const x = Number(rawX);
    const y = Number(rawY);
    return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= viewBox[0] && y >= 0 && y <= viewBox[1];
  });
}

/** 箭头词表（PPTD line.arrow 行：arrow/stealth/diamond/oval）。 */
export const ARROWHEAD_VOCABULARY: readonly BentoArrowheadV4[] = [
  "arrow",
  "stealth",
  "diamond",
  "oval",
];

/** 双端箭头整写（[起, 终]；null 端 = 无箭头，[null, null] 清除）。 */
export function arrowCommands(
  id: string,
  arrow: [BentoArrowheadV4 | null, BentoArrowheadV4 | null],
): VisualCommandV4[] {
  return [{ type: "setLineArrow", targetId: id, arrow }];
}

/**
 * line.points/line.curve → complete setLineGeometry command. The kernel treats
 * an omitted curve as deletion, so the editor must always pass the current or
 * intentionally selected curve mode. Making the argument required keeps a
 * points-only caller from silently destroying a sibling semantic.
 */
export function lineGeometryCommands(
  id: string,
  viewBox: [number, number],
  points: string,
  currentCurve: LineCurveMode | undefined,
  curvePatch?: LineCurveMode | null,
): VisualCommandV4[] {
  // `undefined` means preserve the current optional field; `null` is the
  // explicit clear form.  Passing the current value is mandatory at the
  // call-site so a points-only edit cannot accidentally delete a smooth/round
  // curve when the kernel receives an omitted field.
  const curve = curvePatch === null ? undefined : curvePatch ?? currentCurve;
  return [{
    type: "setLineGeometry",
    targetId: id,
    viewBox: [...viewBox] as [number, number],
    points,
    ...(curve === undefined ? {} : { curve }),
  }];
}
