/** Shared scalar domains used by authoring, kernel, and editor adapters. */

/** Frozen enum vocabularies shared by the command kernel and the validator. */
export const H_ALIGNS: ReadonlySet<string> = new Set(["left", "center", "right", "justify", "distributed"]);
export const V_ALIGNS: ReadonlySet<string> = new Set(["top", "middle", "bottom"]);
export const FIT_MODES: ReadonlySet<string> = new Set(["fill", "contain", "cover"]);
export const BORDER_STYLES: ReadonlySet<string> = new Set(["solid", "dash", "dot"]);
export const ARROWHEADS: ReadonlySet<string> = new Set(["arrow", "stealth", "diamond", "oval"]);
export const CURVE_MODES: ReadonlySet<string> = new Set(["sharp", "round", "smooth"]);
export const TEXT_DIRECTIONS: ReadonlySet<string> = new Set(["horizontal", "vertical"]);

const PX_LINE_HEIGHT_RE = /^(?:\d+(?:\.\d*)?|\.\d+)px$/;
const LINE_HEIGHT_RATIO_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export type LineHeightValue = number | `${number}px`;

/** A unitless line-height ratio is strictly positive and capped by the frozen matrix. */
export function isValidLineHeightRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100;
}

/** A fixed line-height value is a strictly positive, finite pixel count. */
export function isValidLineHeightPx(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Paragraph/list line-height union: ratio or a positive `px` spelling. */
export function isValidLineHeightValue(value: unknown): boolean {
  if (isValidLineHeightRatio(value)) return true;
  if (typeof value !== "string" || !PX_LINE_HEIGHT_RE.test(value)) return false;
  const numeric = Number.parseFloat(value.slice(0, -2));
  return Number.isFinite(numeric) && numeric > 0;
}

/** Parse the text spelling used by PPTD rich-text styles through the same
 * domain as canonical paragraph/list values and kernel commands. */
export function parseLineHeightValue(value: string): LineHeightValue | undefined {
  const trimmed = value.trim();
  if (LINE_HEIGHT_RATIO_RE.test(trimmed)) {
    const ratio = Number(trimmed);
    return isValidLineHeightRatio(ratio) ? ratio : undefined;
  }
  return isValidLineHeightValue(trimmed) ? trimmed as `${number}px` : undefined;
}
