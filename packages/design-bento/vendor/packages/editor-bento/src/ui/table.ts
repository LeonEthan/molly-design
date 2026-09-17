/**
 * C2-A edit surface — table family 纯映射（GD-4c Wave C2 ticket #12）。
 *
 * Node-safe：state + 渲染格网锚点 → 精确 VisualCommandV4。格网还原复用
 * renderers/table.ts 的 placeTableGrid（C9 adapter 格网模型，单一实现）。
 * - setTableShape 只增不减（grow 语义；收缩会拒绝销毁数据的切除）；
 * - setTableCellText/SetTableCellStyle 用逻辑 anchor 坐标（锚点格行/列）；
 * - setTableMerge anchor-only + canMerge 先验（region 未越界/未覆盖邻格）；
 * - setTableSplit 复位合并锚点（复活占位格）。
 */
import type {
  BentoTableV4,
  BentoTableCellV4,
  BentoTableCellStyleV4,
  BentoTableStyleV4,
  BentoBorderSpecV4,
  BentoCellBorderV4,
  BentoTextContentV4,
  BentoTextParagraphV4,
  BentoTextRunV4,
  TableCellStylePatchV4,
  VisualCommandV4,
} from "contracts";
import { placeTableGrid, type PlacedTableCellV4 } from "../renderers/table.ts";

/** 渲染格网锚点（逻辑坐标 + 跨距；DOM td data-r/data-c 定位后映射）。 */
export interface TableAnchorV4 {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

/** TableStyleV4's persistent style slots.  `bodyStyles` is addressed by its
 * data-row cycle index, not by a derived/rendered row number. */
export const TABLE_STYLE_SLOTS = [
  "cellStyle",
  "firstRowStyle",
  "lastRowStyle",
  "firstColumnStyle",
  "lastColumnStyle",
] as const;

export type TableStyleSlotV4 = (typeof TABLE_STYLE_SLOTS)[number];

export type TableBorderSidesV4 = [
  BentoBorderSpecV4 | null,
  BentoBorderSpecV4 | null,
  BentoBorderSpecV4 | null,
  BentoBorderSpecV4 | null,
];

function cloneBorderSpec(spec: BentoBorderSpecV4 | null): BentoBorderSpecV4 | null {
  return spec === null ? null : structuredClone(spec);
}

/** Expand the compact table border union into independent editable sides. */
export function expandCellBorderSides(border: BentoCellBorderV4 | undefined): TableBorderSidesV4 {
  if (border === undefined || border === null) return [null, null, null, null];
  if (Array.isArray(border)) {
    if (border.length === 2) {
      const topBottom = cloneBorderSpec(border[0] ?? null);
      const leftRight = cloneBorderSpec(border[1] ?? null);
      return [cloneBorderSpec(topBottom), cloneBorderSpec(leftRight), cloneBorderSpec(topBottom), cloneBorderSpec(leftRight)];
    }
    return [
      cloneBorderSpec(border[0] ?? null),
      cloneBorderSpec(border[1] ?? null),
      cloneBorderSpec(border[2] ?? null),
      cloneBorderSpec(border[3] ?? null),
    ];
  }
  const uniform = cloneBorderSpec(border);
  return [cloneBorderSpec(uniform), cloneBorderSpec(uniform), cloneBorderSpec(uniform), cloneBorderSpec(uniform)];
}

/** Canonical image fills are content-addressed; UI text cannot invent a key. */
const ASSET_FILL_SOURCE = /^asset:[0-9a-f]{64}$/;

export function isAssetFillSource(value: string): boolean {
  return ASSET_FILL_SOURCE.test(value.trim());
}

export type TableTextContentStylePatchV4 = {
  [K in keyof Pick<
    BentoTextContentV4,
    "color" | "fontSize" | "fontFamily" | "bold" | "italic" | "backgroundColor" |
    "lineHeight" | "lineHeightPx" | "letterSpacing" | "marginTop" | "textDirection" |
    "wrap" | "align"
  >]?: BentoTextContentV4[K] | null;
};

export type TableTextRunStylePatchV4 = {
  [K in keyof Pick<
    BentoTextRunV4,
    "color" | "fontSize" | "fontFamily" | "backgroundColor" | "bold" | "italic" |
    "underline" | "strikethrough" | "baselineShift" | "href" | "latex"
  >]?: BentoTextRunV4[K] | null;
};

export type TableTextParagraphStylePatchV4 = {
  [K in keyof Pick<BentoTextParagraphV4, "align" | "lineHeight" | "margin" | "list">]?: BentoTextParagraphV4[K] | null;
};

const toAnchor = (cell: PlacedTableCellV4): TableAnchorV4 => ({
  row: cell.r,
  col: cell.c,
  rowSpan: cell.rowSpan,
  colSpan: cell.colSpan,
});

/** 全部可见（未覆盖）锚点（与被覆盖占位零 DOM 的渲染格网同面）。 */
export function tableAnchors(table: BentoTableV4): TableAnchorV4[] {
  return placeTableGrid(table).cells.map(toAnchor);
}

/** 逻辑坐标 → 锚点 + 物理格（DOM 面板读取文本/样式用）；越界 → null。 */
export function anchorCell(
  table: BentoTableV4,
  row: number,
  col: number,
): { anchor: TableAnchorV4; cell: BentoTableCellV4 } | null {
  const { nRows, nCols, cells } = placeTableGrid(table);
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= nRows || col >= nCols) {
    return null;
  }
  const owner = cells.find(
    (cell) => row >= cell.r && row < cell.r + cell.rowSpan && col >= cell.c && col < cell.c + cell.colSpan,
  );
  // owner.cell 是投影层对 canonical 格的结构镜像（TableCellLike）——同一数据形态。
  return owner ? { anchor: toAnchor(owner), cell: owner.cell as unknown as BentoTableCellV4 } : null;
}

/**
 * 合并可行性先验（kernel setTableMerge 同面拒绝，见 kernel.ts setTableMerge
 * 校验：region 全在 grid；每格必须是无物理 cell 缺失（被合并覆盖即拒绝）的
 * 未合并 anchor——已合并锚点（含锚点自身）在区域内即拒绝；其余未合并 anchor
 * 可覆盖，数据销毁由 inverse 逐格重构）。
 */
export function canMerge(
  table: BentoTableV4,
  anchor: TableAnchorV4,
  drop: { rows: number; cols: number },
): boolean {
  if (drop.rows < 0 || drop.cols < 0 || (drop.rows === 0 && drop.cols === 0)) return false;
  if (anchor.rowSpan > 1 || anchor.colSpan > 1) return false; // 已合并锚点自身即“merged cell”
  const { nRows, nCols } = placeTableGrid(table);
  const rowSpan = anchor.rowSpan + drop.rows;
  const colSpan = anchor.colSpan + drop.cols;
  if (anchor.row + rowSpan > nRows || anchor.col + colSpan > nCols) return false;
  const anchors = tableAnchors(table);
  for (let rr = anchor.row; rr < anchor.row + rowSpan; rr += 1) {
    for (let cc = anchor.col; cc < anchor.col + colSpan; cc += 1) {
      const owner = anchors.find(
        (cell) => rr >= cell.row && rr < cell.row + cell.rowSpan && cc >= cell.col && cc < cell.col + cell.colSpan,
      );
      if (!owner) return false; // 无物理 cell = 被上方合并覆盖
      if (owner !== anchor && (owner.rowSpan > 1 || owner.colSpan > 1)) return false; // 其他已合并锚点
    }
  }
  return true;
}

/** 行/列增（table.grid grow；只增不减，负增量具名拒绝）。 */
export function growCommands(id: string, table: BentoTableV4, addRows: number, addCols: number): VisualCommandV4[] {
  if (!Number.isInteger(addRows) || !Number.isInteger(addCols) || addRows < 0 || addCols < 0 || (addRows === 0 && addCols === 0)) {
    throw new Error("table: grow 增量必须是非负整数且至少一项 > 0");
  }
  return [{
    type: "setTableShape",
    targetId: id,
    rows: table.rows.length + addRows,
    cols: table.columnWidths.length + addCols,
  }];
}

/** 单元格文本（plain 简写 / 完整 content / null 清除）。 */
export function cellTextCommands(
  id: string,
  row: number,
  col: number,
  text: string | BentoTextContentV4 | null,
): VisualCommandV4[] {
  return [{ type: "setTableCellText", targetId: id, row, col, text }];
}

/** Structured cell text write.  The command deliberately carries the complete
 * content so a rich-text edit remains lossless through kernel undo/redo. */
export function cellTextContentCommands(
  id: string,
  row: number,
  col: number,
  text: BentoTextContentV4 | null,
): VisualCommandV4[] {
  return [{
    type: "setTableCellText",
    targetId: id,
    row,
    col,
    text: text === null ? null : structuredClone(text),
  }];
}

/** Apply a content-level rich-text patch and emit one complete cell-text
 * command.  `null` removes an optional field; switching line-height modes is
 * represented by the resulting content (only one of the mutually exclusive
 * fields remains), so the final gesture remains one command. */
export function cellTextContentStyleCommands(
  id: string,
  row: number,
  col: number,
  content: BentoTextContentV4,
  patch: TableTextContentStylePatchV4,
): VisualCommandV4[] {
  const next = structuredClone(content);
  for (const [key, value] of Object.entries(patch) as Array<[keyof TableTextContentStylePatchV4, unknown]>) {
    if (value === null || value === undefined) delete (next as unknown as Record<string, unknown>)[key as string];
    else (next as unknown as Record<string, unknown>)[key as string] = structuredClone(value);
  }
  if (patch.lineHeight !== undefined && patch.lineHeight !== null) delete next.lineHeightPx;
  if (patch.lineHeightPx !== undefined && patch.lineHeightPx !== null) delete next.lineHeight;
  return cellTextContentCommands(id, row, col, next);
}

/** Apply one rich-text run patch by rebuilding the containing cell content. */
export function cellTextRunStyleCommands(
  id: string,
  row: number,
  col: number,
  content: BentoTextContentV4,
  paragraphIndex: number,
  runIndex: number,
  patch: TableTextRunStylePatchV4,
): VisualCommandV4[] {
  const paragraph = content.paragraphs[paragraphIndex];
  if (paragraph === undefined) throw new Error(`table text: paragraph index out of bounds (${paragraphIndex})`);
  if (paragraph.runs[runIndex] === undefined) throw new Error(`table text: run index out of bounds (${runIndex})`);
  const next = structuredClone(content);
  const run = next.paragraphs[paragraphIndex]!.runs[runIndex]!;
  for (const [key, value] of Object.entries(patch) as Array<[keyof TableTextRunStylePatchV4, unknown]>) {
    if (value === null || value === undefined) delete (run as unknown as Record<string, unknown>)[key as string];
    else (run as unknown as Record<string, unknown>)[key as string] = structuredClone(value);
  }
  return cellTextContentCommands(id, row, col, next);
}

/** Apply one paragraph-level rich-text patch by rebuilding the containing cell. */
export function cellTextParagraphStyleCommands(
  id: string,
  row: number,
  col: number,
  content: BentoTextContentV4,
  paragraphIndex: number,
  patch: TableTextParagraphStylePatchV4,
): VisualCommandV4[] {
  if (content.paragraphs[paragraphIndex] === undefined) {
    throw new Error(`table text: paragraph index out of bounds (${paragraphIndex})`);
  }
  const next = structuredClone(content);
  const paragraph = next.paragraphs[paragraphIndex]!;
  for (const [key, value] of Object.entries(patch) as Array<[keyof TableTextParagraphStylePatchV4, unknown]>) {
    if (value === null || value === undefined) delete (paragraph as unknown as Record<string, unknown>)[key as string];
    else (paragraph as unknown as Record<string, unknown>)[key as string] = structuredClone(value);
  }
  return cellTextContentCommands(id, row, col, next);
}

/** 单元格样式补丁（行：cellTextProps/cellFill/cellBorder/cellAlign）。 */
export function cellStyleCommands(
  id: string,
  row: number,
  col: number,
  patch: TableCellStylePatchV4,
): VisualCommandV4[] {
  return [{ type: "setTableCellStyle", targetId: id, row, col, patch: structuredClone(patch) }];
}

/** Full table grid ratio write.  Keeping both dimensions in one command gives
 * the composite editor an atomic final gesture and lets kernel inverse restore
 * the exact prior arrays. */
export function tableGridCommands(
  id: string,
  columnWidths?: readonly number[],
  rowHeights?: readonly number[],
): VisualCommandV4[] {
  if (columnWidths === undefined && rowHeights === undefined) {
    throw new Error("table.grid: at least one ratio array is required");
  }
  return [{
    type: "setTableGrid",
    targetId: id,
    ...(columnWidths === undefined ? {} : { columnWidths: [...columnWidths] }),
    ...(rowHeights === undefined ? {} : { rowHeights: [...rowHeights] }),
  }];
}

/** A mounted grid form may only apply while both canonical dimensions still
 * match the form.  Structural +Row/+Col gestures otherwise make its indexed
 * fields stale; callers must wait for reprojection and rebuild. */
export function tableGridDraftMatches(
  table: BentoTableV4,
  columnCount: number,
  rowCount: number,
): boolean {
  return table.columnWidths.length === columnCount && table.rowHeights.length === rowCount;
}

/** Normalize ratio drafts only when every entered value is in the kernel's
 * finite [0,1] domain; malformed drafts fail closed instead of becoming a
 * different equal/zero-weight layout. */
export function normalizeRatios(values: readonly number[]): number[] | null {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return values.map((value) => value / sum);
}

/** Full table style replacement (including slots, body cycle, and conflict
 * rule).  `null` clears the style object and is the only clear path. */
export function tableStyleCommands(
  id: string,
  style: BentoTableStyleV4 | null,
): VisualCommandV4[] {
  return [{
    type: "setTableStyle",
    targetId: id,
    style: style === null ? null : structuredClone(style),
  }];
}

/** Stable visible status for the table-style clear control. */
export function tableStyleClearLabel(style: BentoTableStyleV4 | undefined): string {
  return style !== undefined && Object.keys(style).length > 0
    ? "Clear table style (present)"
    : "Clear table style (cleared)";
}

function applyTableStylePatch(
  base: BentoTableCellStyleV4 | undefined,
  patch: TableCellStylePatchV4,
): BentoTableCellStyleV4 {
  const next = structuredClone(base ?? {});
  for (const [key, value] of Object.entries(patch) as Array<[keyof TableCellStylePatchV4, unknown]>) {
    if (value === null || value === undefined) delete (next as unknown as Record<string, unknown>)[key as string];
    else (next as unknown as Record<string, unknown>)[key as string] = structuredClone(value);
  }
  if (patch.lineHeight !== undefined && patch.lineHeight !== null) delete next.lineHeightPx;
  if (patch.lineHeightPx !== undefined && patch.lineHeightPx !== null) delete next.lineHeight;
  return next;
}

function tableStyleOrNull(style: BentoTableStyleV4): BentoTableStyleV4 | null {
  return Object.keys(style).length === 0 ? null : style;
}

/** Replace one named style slot while preserving every other slot byte-for-byte. */
export function tableStyleSlotCommands(
  id: string,
  style: BentoTableStyleV4 | undefined,
  slot: TableStyleSlotV4,
  patch: TableCellStylePatchV4 | null,
): VisualCommandV4[] {
  const next = structuredClone(style ?? {});
  if (patch === null) delete next[slot];
  else next[slot] = applyTableStylePatch(next[slot], patch);
  return tableStyleCommands(id, tableStyleOrNull(next));
}

/** Replace one body-style cycle entry.  A null patch removes the entry and
 * preserves the remaining cycle order. */
export function tableBodyStyleCommands(
  id: string,
  style: BentoTableStyleV4 | undefined,
  index: number,
  patch: TableCellStylePatchV4 | null,
): VisualCommandV4[] {
  if (!Number.isInteger(index) || index < 0) throw new Error(`table style: body style index out of bounds (${index})`);
  const next = structuredClone(style ?? {});
  const body = [...(next.bodyStyles ?? [])];
  if (patch === null) body.splice(index, 1);
  else body[index] = applyTableStylePatch(body[index], patch);
  if (body.length === 0) delete next.bodyStyles;
  else next.bodyStyles = body;
  return tableStyleCommands(id, tableStyleOrNull(next));
}

/** Indexed edit/remove paths are intentionally distinct from the append path.
 * A mounted DOM row can outlive a preceding remove gesture; returning an
 * empty batch keeps that stale control fail-closed instead of reusing its
 * index to append or mutate a different body style. */
export function tableBodyStyleEditCommands(
  id: string,
  style: BentoTableStyleV4 | undefined,
  index: number,
  patch: TableCellStylePatchV4,
): VisualCommandV4[] {
  if (!Number.isInteger(index) || index < 0 || style?.bodyStyles?.[index] === undefined) return [];
  return tableBodyStyleCommands(id, style, index, patch);
}

export function tableBodyStyleRemoveCommands(
  id: string,
  style: BentoTableStyleV4 | undefined,
  index: number,
): VisualCommandV4[] {
  if (!Number.isInteger(index) || index < 0 || style?.bodyStyles?.[index] === undefined) return [];
  return tableBodyStyleCommands(id, style, index, null);
}

export function tableBodyStyleAppendCommands(
  id: string,
  style: BentoTableStyleV4 | undefined,
  patch: TableCellStylePatchV4 = {},
): VisualCommandV4[] {
  return tableBodyStyleCommands(id, style, style?.bodyStyles?.length ?? 0, patch);
}

/** Edit the style conflict rule.  The unset form (`null`) restores the
 * contract default (row wins) without persisting a redundant false value. */
export function rowOverColumnCommands(
  id: string,
  style: BentoTableStyleV4 | undefined,
  value: boolean | null,
): VisualCommandV4[] {
  const next = structuredClone(style ?? {});
  if (value === null) delete next.rowOverColumn;
  else next.rowOverColumn = value;
  return tableStyleCommands(id, tableStyleOrNull(next));
}

/** 合并（anchor-only；region 全在 grid 且未覆盖邻格——kernel 拒绝兜底）。 */
export function mergeCommands(
  id: string,
  row: number,
  col: number,
  rowSpan: number,
  colSpan: number,
): VisualCommandV4[] {
  return [{ type: "setTableMerge", targetId: id, row, col, rowSpan, colSpan }];
}

/** 拆分合并锚点（复位 1x1，复活被覆盖占位格）。 */
export function splitCommands(id: string, row: number, col: number): VisualCommandV4[] {
  return [{ type: "setTableSplit", targetId: id, row, col }];
}
