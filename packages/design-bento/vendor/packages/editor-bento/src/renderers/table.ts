/**
 * table 家族投影编译/渲染面（GD-4c Wave C1 ticket #9；matrix table.* 12 行 +
 * spikes/bento-static-closure/table/notes.md）。冻结裁决 C9：native Bento 词表无
 * rowSpan/colSpan/rowHeights（实测 merge-gap 渲染错位、validate 无 cell 级报告），
 * 表内语义全部 adapter——整个 table 元素投影为带 `frameRenderer: "table.grid"`
 * 的 native 元素（marker 永不进 canonical），renderTableGrid 在 .bento-el frame
 * 内渲染真实 <table>；Bento 拥有 frame/selection/transform/export 生命周期，两路
 * DOM 源绝不共存（notes.md "the adapter renderer uniformly outputs the entire
 * table interior…two DOM sources MUST NOT coexist"）。hybrid 行的 native 子集
 * （colgroup 列宽、cell color/bold/bg、cell align 水平、标签级 html）以输入兼容层
 * 复现，不在投影期退回 native table 模型。
 *
 * Node-safe：纯字符串/结构编译（compileTableGrid）跑在 Node 断言层；DOM 面只在
 * renderTableGrid 内（sealed shell 的 Chromium 消费）。类型为结构镜像（不带
 * "contracts" 包 import——nested src 不做包级 import rewrite；见 image-fill.ts
 * 同款约定）。
 *
 * 渲染契约（matrix 各行 renderContract / importContract / cellBorder "相邻格冲
 * 突规则由 adapter 定义"）：
 * - 格网（table.grid hybrid→adapter）：稀疏 rows 用 validate.ts
 *   checkTableMergeExpansion 的同款游标算法还原（列游标跳过被 rowSpan 占用的
 *   位置 → anchor 落位 → 标记 extent），覆盖格零 DOM（真合并，不双渲染）。
 *   列宽 [0,1] → <colgroup> 百分比 toFixed(4)（同 vendor renderTableHtml）；
 *   行高比例 → <tr height:%>。载具 = 真实 <table> table-layout:fixed +
 *   border-collapse:collapse（native renderTableHtml 同款），共享边由浏览器
 *   collapse 消去、radius 无关。
 * - cell 边框（table.cellBorder adapter）：BorderSpec 展开——单值=四边同、
 *   [top-bottom,left-right] 两元、[top,right,bottom,left] 四元；显式 null =
 *   border-*-style:hidden（collapse 下 hidden 优先于邻格 solid，实现"单边清除"）；
 *   字段 absent = 无声明（不生成 <hidden>，邻格边自然可见）。表级 common.border
 *   裁决：外框胜——wrap 持有 element border，边缘格（extent 触界）的外侧边框被
 *   抑制，避免双线。
 * - 样式槽位（table.styleSlots/bodyStylesCycle/rowOverColumn adapter）：字段级
 *   合并，cellStyle 为底 → rowOverColumn 决定列/行组序（缺省 true 行胜：colSlots
 *   先并、rowSlots 后并覆盖）→ cell 显式字段最后覆盖。bodyStyles 按数据行序
 *   (anchor r) % length 循环；firstRow/lastRow/firstColumn/lastColumn 归属看
 *   合并 extent（r+rowSpan===nRows 等，整个占用范围算数）。canonical 无 header
 *   概念 → 数据行 = 格网行序。
 * - cell 文本（table.cellText/cellTextProps hybrid→adapter）：结构化
 *   paragraphs/runs → inline html；表级缺省在 <table>（font-family/size/color/
 *   line-height）、cell 解析值在内容 div、p/run 覆盖在各自元素。latex run 保留
 *   `$...$` marker，DOM renderer 调用 host 的 shared resolveMath；href run → 真
 *   <a>（scheme 白名单 fail-closed）。cell.text 的 wrap/textDirection/gradient、
 *   list 结构与 text 元素共用同一个 layout resolver 口径。
 * - cell fill（table.cellFill hybrid→adapter）：solid/linear/radial → td CSS
 *   （linear 角度仍走 PPTD→CSS +90 换算，禁止依赖 vendor cssColor 偶然穿洞）；
 *   image → #23 共用 SVG 图层（crop→fit→opacity 固定顺序，asset: 引用登记进
 *   native assets 由 renderer 经 doc.assets 解析——C26 同款）。
 * - 显示缺省（确定性）：cell text 省略值消费 static-v1 共享事实
 *   18px/MiSans/#000000/lineHeight 1；padding "8px 12px" 属 table adapter
 *   布局常量（canonical 无 padding 词表），不是文字默认值。
 */
import type { FrameHostElement, FrameHostRenderContext } from "../boot/frame-host.ts";
import { STATIC_V1_TEXT_DEFAULTS } from "contracts";
import { fmt, pptdAngleToCss } from "./fill.ts";
import { compileImageFillV4, renderImageFillLayer, type CompiledImageFillV4 } from "./image-fill.ts";
import { imageIntrinsicSize } from "./image.ts";
import {
  fontFamilyCss,
  horizontalAlignCss,
  lineHeightCss,
  normalizedTextParagraphPlan,
  resolveTextLayout,
  textParagraphsHtml,
  textDirectionCss,
  type TextFontFamily as SharedTextFontFamily,
  type TextGradient,
  type TextParagraph,
} from "./text.ts";

// ---- 结构镜像保持 Node/browser 双侧自包含；仅从 contracts 消费
// static-v1 语义事实，不复刻 canonical 类型或默认值。 ----

export type TextFontFamily = SharedTextFontFamily;
export type TableParagraphLike = TextParagraph;

export interface TableTextContentLike {
  paragraphs: TableParagraphLike[];
  color?: string;
  fontSize?: number;
  fontFamily?: TextFontFamily;
  bold?: boolean;
  italic?: boolean;
  backgroundColor?: string;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  marginTop?: number;
  align?: readonly ["left" | "center" | "right" | "justify" | "distributed", "top" | "middle" | "bottom"];
  textDirection?: "horizontal" | "vertical";
  wrap?: boolean;
  gradient?: TextGradient;
}

/** fill 镜像（判别 type 窄化；结构同 canonical BentoFillV4，无需 index signature）。 */
export type TableFillLike =
  | { type: "solid"; color: string }
  | {
      type: "gradient";
      gradientType: "linear" | "radial";
      angle?: number;
      stops: ReadonlyArray<{ position: number; color: string }>;
    }
  | { type: "image"; src: string; fit?: string; crop?: ReadonlyArray<number>; opacity?: number };

export interface TableBorderSpecLike {
  style?: string;
  width?: number;
  color?: string;
}

/** BorderSpec：单值/两元 [top-bottom,left-right]/四元 [top,right,bottom,left]/null。 */
export type TableCellBorderLike =
  | null
  | TableBorderSpecLike
  | readonly [TableBorderSpecLike | null, TableBorderSpecLike | null]
  | readonly [TableBorderSpecLike | null, TableBorderSpecLike | null, TableBorderSpecLike | null, TableBorderSpecLike | null];

export interface TableCellStyleLike {
  color?: string;
  fontSize?: number;
  fontFamily?: TextFontFamily;
  bold?: boolean;
  italic?: boolean;
  backgroundColor?: string;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  marginTop?: number;
  fill?: TableFillLike;
  border?: TableCellBorderLike;
  align?: readonly [string, string];
}

export interface TableCellLike extends TableCellStyleLike {
  text?: TableTextContentLike;
  rowSpan?: number;
  colSpan?: number;
}

export interface TableStyleLike {
  cellStyle?: TableCellStyleLike;
  firstRowStyle?: TableCellStyleLike;
  lastRowStyle?: TableCellStyleLike;
  firstColumnStyle?: TableCellStyleLike;
  lastColumnStyle?: TableCellStyleLike;
  bodyStyles?: TableCellStyleLike[];
  rowOverColumn?: boolean;
}

export interface TableLike {
  columnWidths: readonly number[];
  rowHeights: readonly number[];
  rows: readonly (readonly TableCellLike[])[];
  style?: TableStyleLike;
}

/** 编译产物：渲染器（DOM）消费的 JSON payload（projector 塞进 native 元素）。 */
export interface TableGridCellV4 {
  r: number;
  c: number;
  rowSpan: number;
  colSpan: number;
  /** td 级 cssText（vertical-align/overflow/word-break/background/borders）。 */
  style: string;
  /** 单元格 image fill 图层（fit → object-fit）；无则 null。 */
  image: CompiledImageFillV4 | null;
  /** 单元格内层内容 html（内容 div + 段落/run）。 */
  html: string;
  /** Canonical marker presence; DOM must not downgrade this to raw `$...$`. */
  hasLatex: boolean;
}

/** Named fail-closed boundary for table math. A table cell can only materialize
 * a canonical latex run through the host's already-pinned resolver. */
export class TableMathResolverError extends Error {
  readonly code = "PPTD-E013" as const;

  constructor(message = "table.grid: resolveMath is required for a latex cell") {
    super(message);
    this.name = "PPTD-E013";
  }
}

/**
 * Guard the host seam against a resolver that silently returns the source
 * marker. This only recognizes the marker grammar emitted by text.ts; it does
 * not parse TeX or provide a second math implementation.
 */
function containsUnresolvedLatexMarker(source: string, resolved: string): boolean {
  const inline = /(^|[^\\])(\$(?:[^$\\]|\\.)+\$)/g;
  for (const match of source.matchAll(inline)) {
    if (resolved.includes(match[2]!)) return true;
  }
  return /\$\$[^$]+\$\$/.test(source)
    && /\$\$[^$]+\$\$/.test(resolved);
}

export function resolveTableCellHtml(
  cell: Pick<TableGridCellV4, "html" | "hasLatex">,
  resolveMath?: (html: string) => string,
): string {
  if (cell.hasLatex && resolveMath === undefined) throw new TableMathResolverError();
  if (resolveMath === undefined) return cell.html;
  const resolved = resolveMath(cell.html);
  if (cell.hasLatex && (
    resolved.trim().length === 0 ||
    containsUnresolvedLatexMarker(cell.html, resolved) ||
    !/<math(?:\s|>)[\s\S]*<\/math>/i.test(resolved)
  )) {
    throw new TableMathResolverError("table.grid: host resolveMath did not produce non-empty MathML");
  }
  return resolved;
}

export interface TableGridCompiledV4 {
  /** <colgroup> 列宽百分比（toFixed(4)，同 vendor renderTableHtml）。 */
  cols: string[];
  /** <tr> 行高百分比（rowHeights 比例）。 */
  rows: string[];
  /** <table> cssText（collapse/fixed + 显示缺省字型）。 */
  table: string;
  /** wrap cssText（布局 + 元素级 border/fill CSS面）。 */
  wrap: string;
  /** 表级 image fill 图层；无则 null。 */
  wrapImage: CompiledImageFillV4 | null;
  cells: TableGridCellV4[];
}

export interface TableGridCompileOptions {
  table: TableLike;
  /** 最终 table frame 尺寸；cell frame 由它和合并后的行列比例唯一派生。 */
  width: number;
  height: number;
  /** 表级 common.border（common.border 行 table 宿主；外框胜裁决）。 */
  elementBorder?: TableBorderSpecLike;
  /** 表级 fill（fill.* 行 table 宿主；垫在格网下）。 */
  elementFill?: TableFillLike;
  /** 语义资产引用 → data URI（image fill 登记进 native assets）。 */
  resolveAsset: (ref: string) => string;
  /** Shared C6 role aliases allocated for this complete document projection. */
  fontAliases?: ReadonlyMap<string, string>;
}

// ---- 显示缺省（头注假设 1；确定性，canonical 无这些词表） ----

const CELL_FONT_SIZE = STATIC_V1_TEXT_DEFAULTS.fontSize;
const CELL_FONT_FAMILY = STATIC_V1_TEXT_DEFAULTS.fontFamily;
const CELL_COLOR = STATIC_V1_TEXT_DEFAULTS.color;
const CELL_LINE_HEIGHT = STATIC_V1_TEXT_DEFAULTS.lineHeight;
const CELL_PADDING = "8px 12px";
const SUM_TOLERANCE = 1e-9;

/** 内容寻址 key：剥离 "asset:" 前缀（与 editor-bento/assets.ts 同 key 约定）。 */
const assetKeyOf = (ref: string): string => (ref.startsWith("asset:") ? ref.slice("asset:".length) : ref);

// ---- 格网还原：稀疏 rows → visible anchors（validate.ts 同款游标算法） ----

// 格网还原的中间类型（placeTableGrid 返回；C2-A ui/table.ts 复用 anchor/跨距）。
export interface PlacedTableCellV4 {
  r: number;
  c: number;
  rowSpan: number;
  colSpan: number;
  cell: TableCellLike;
}

export function placeTableGrid(table: TableLike): { nRows: number; nCols: number; cells: PlacedTableCellV4[] } {
  const nRows = table.rows.length;
  const nCols = table.columnWidths.length;
  if (nRows === 0) throw new Error("table.grid: table must have at least one row");
  if (table.rowHeights.length !== nRows) {
    throw new Error(`table.grid: rowHeights length ${table.rowHeights.length} != rows ${nRows}`);
  }
  const occupied: boolean[][] = Array.from({ length: nRows }, () => Array<boolean>(nCols).fill(false));
  const cells: PlacedTableCellV4[] = [];
  for (const [r, row] of table.rows.entries()) {
    let c = 0;
    for (const cellEntry of row) {
      // 跳过被上一行 rowSpan 覆盖的位置（sparse 形态：覆盖格从 rows 数组省略）。
      while (c < nCols && occupied[r]![c]!) c += 1;
      const rowSpan = cellEntry.rowSpan ?? 1;
      const colSpan = cellEntry.colSpan ?? 1;
      if (c + colSpan > nCols || r + rowSpan > nRows) {
        throw new Error(
          `table.grid: merged region (${r},${c}) ${rowSpan}x${colSpan} exceeds the ${nRows}x${nCols} grid（table.merge 行）`,
        );
      }
      for (let rr = r; rr < r + rowSpan; rr += 1) {
        for (let cc = c; cc < c + colSpan; cc += 1) occupied[rr]![cc] = true;
      }
      cells.push({ r, c, rowSpan, colSpan, cell: cellEntry });
      c += colSpan;
    }
  }
  return { nRows, nCols, cells };
}

// ---- 槽位解析（styleSlots/bodyStylesCycle/rowOverColumn；字段级合并） ----

const STYLE_FIELD_KEYS = [
  "color",
  "fontSize",
  "fontFamily",
  "bold",
  "italic",
  "backgroundColor",
  "lineHeight",
  "lineHeightPx",
  "letterSpacing",
  "marginTop",
  "fill",
  "border",
  "align",
] as const;

function mergeStyle(target: TableCellStyleLike, source: TableCellStyleLike | undefined): TableCellStyleLike {
  if (source === undefined) return target;
  for (const key of STYLE_FIELD_KEYS) {
    const value = source[key];
    if (value !== undefined) (target as Record<string, unknown>)[key] = value;
  }
  return target;
}

/** slot 槽位解析（头注 C9 后的 adapter 裁决）：字段级、行/列组序按 rowOverColumn。 */
function resolveCellStyle(
  cell: TableCellLike,
  placement: PlacedTableCellV4,
  nRows: number,
  nCols: number,
  style: TableStyleLike | undefined,
): TableCellStyleLike {
  const { r, c, rowSpan, colSpan } = placement;
  const merged: TableCellStyleLike = {};
  if (style === undefined) {
    mergeStyle(merged, cell);
    mergeStyle(merged, textContentStyle(cell.text));
    return merged;
  }
  mergeStyle(merged, style.cellStyle);
  const colGroup: TableCellStyleLike[] = [];
  const rowGroup: TableCellStyleLike[] = [];
  const bodyCycle = style.bodyStyles;
  if (bodyCycle !== undefined && bodyCycle.length > 0) {
    rowGroup.push(bodyCycle[r % bodyCycle.length]!);
  }
  const firstRow = r === 0 ? style.firstRowStyle : undefined;
  const lastRow = r + rowSpan === nRows ? style.lastRowStyle : undefined;
  const firstColumn = c === 0 ? style.firstColumnStyle : undefined;
  const lastColumn = c + colSpan === nCols ? style.lastColumnStyle : undefined;
  for (const slot of [firstColumn, lastColumn]) if (slot !== undefined) colGroup.push(slot);
  for (const slot of [firstRow, lastRow]) if (slot !== undefined) rowGroup.push(slot);
  // rowOverColumn 缺省 true（行胜）：colGroup 先并、rowGroup 后并覆盖。
  if (style.rowOverColumn !== false) {
    for (const slot of colGroup) mergeStyle(merged, slot);
    for (const slot of rowGroup) mergeStyle(merged, slot);
  } else {
    for (const slot of rowGroup) mergeStyle(merged, slot);
    for (const slot of colGroup) mergeStyle(merged, slot);
  }
  // cell 显式字段最后覆盖所有 slot（C25 同款口径：显式 > 展开默认）。
  mergeStyle(merged, cell);
  mergeStyle(merged, textContentStyle(cell.text));
  return merged;
}

/** cell.text 内容级样式（text 元素内容级同款语义；run/段再往下覆盖）。
 *  文本面字段 = STYLE_FIELD_KEYS 去 fill/border（BentoTextContentV4 无这两个）。 */
const TEXT_CONTENT_KEYS = STYLE_FIELD_KEYS.filter((key) => key !== "fill" && key !== "border");

function textContentStyle(text: TableTextContentLike | undefined): TableCellStyleLike {
  const out: TableCellStyleLike = {};
  if (text === undefined) return out;
  for (const key of TEXT_CONTENT_KEYS) {
    const value = text[key];
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

// ---- 文本：cell.text → inline html（run/段/p 覆盖，头注 cell 文本契约） ----

function alignCss(align: readonly [string, string] | undefined, vertical: boolean): string | undefined {
  if (align === undefined) return undefined;
  return vertical ? align[1] : align[0];
}

// ---- 边框：BorderSpec 展开 + collapse hidden + 外框抑制 ----

const SIDES = ["top", "right", "bottom", "left"] as const;
type Side = (typeof SIDES)[number];

/** BorderSpec → 四边（单值=四边同；两元 [top-bottom,left-right]；四元 [t,r,b,l]；null=全清）。 */
function borderSides(border: TableCellBorderLike | undefined): Partial<Record<Side, TableBorderSpecLike | null>> {
  if (border === undefined) return {};
  if (border === null) return { top: null, right: null, bottom: null, left: null };
  if (Array.isArray(border)) {
    if (border.length === 2) {
      // 两元形态 [top-bottom, left-right]（TS 无法按 length 判别 tuple 联合）。
      const tb: TableBorderSpecLike | null = border[0];
      const lr: TableBorderSpecLike | null = border[1];
      return { top: tb, bottom: tb, left: lr, right: lr };
    }
    const t: TableBorderSpecLike | null = border[0];
    const r: TableBorderSpecLike | null = border[1];
    const b: TableBorderSpecLike | null = border[2];
    const l: TableBorderSpecLike | null = border[3];
    return { top: t, right: r, bottom: b, left: l };
  }
  // Array.isArray 的 false 分支不排除 readonly tuple（TS 已知边界）→ 显式窄化。
  const spec = border as TableBorderSpecLike;
  return { top: spec, right: spec, bottom: spec, left: spec };
}

function borderStyleCss(style: string | undefined): string {
  if (style === "dash") return "dashed";
  if (style === "dot") return "dotted";
  return "solid";
}

function sideBorderCss(side: Side, spec: TableBorderSpecLike | null): string {
  if (spec === null) return `border-${side}-style:hidden`;
  return `border-${side}:${fmt(spec.width ?? 1)}px ${borderStyleCss(spec.style)} ${spec.color ?? "#000000"}`;
}

// ---- fill：solid/渐变 → td/wrap CSS；image → 定位图层负载 + 资产登记 ----

function gradientStopsCss(stops: unknown): string {
  const list = stops as Array<{ position: number; color: string }>;
  return list.map((stop) => `${stop.color} ${fmt(stop.position * 100)}%`).join(", ");
}

interface FillCssResult {
  css?: string;
  image?: CompiledImageFillV4;
}

/** solid/linear/radial → CSS 串；image → shared crop→fit→opacity payload. */
function fillCss(
  fill: TableFillLike | undefined,
  host: { width: number; height: number },
  resolveAsset: (ref: string) => string,
): FillCssResult {
  if (fill === undefined) return {};
  switch (fill.type) {
    case "solid":
      return { css: `background-color:${fill.color}` };
    case "gradient": {
      const stops = gradientStopsCss(fill.stops);
      if (fill.gradientType === "radial") {
        return { css: `background:radial-gradient(circle, ${stops})` };
      }
      const angle = typeof fill.angle === "number" ? fill.angle : 90;
      return { css: `background:linear-gradient(${pptdAngleToCss(angle)}deg, ${stops})` };
    }
    case "image": {
      const ref = fill.src as string;
      const dataUri = resolveAsset(ref);
      const key = assetKeyOf(ref);
      return {
        image: compileImageFillV4(
          { ...fill, src: `asset:${key}` },
          { ...host, source: imageIntrinsicSize(dataUri) },
        ),
      };
    }
    default:
      return {};
  }
}

/** 单元格内容级 → td cssText（vertical-align 由 align[1] 决定，缺省 middle）。
 *  bgCss：已解析的 fill/backgroundColor 背景 CSS（fillCss 在编译入口统一解析）。 */
function tdStyleCss(
  elementBorder: TableBorderSpecLike | undefined,
  placement: PlacedTableCellV4,
  nRows: number,
  nCols: number,
  resolved: TableCellStyleLike,
  bgCss: string | undefined,
  text: TableTextContentLike | undefined,
): string {
  const parts: string[] = [];
  const v = alignCss(resolved.align, true) ?? "middle";
  const wrap = text?.wrap ?? true;
  parts.push(`vertical-align:${v}`, `overflow:${wrap ? "hidden" : "visible"}`, `word-break:${wrap ? "break-word" : "normal"}`);
  if (bgCss !== undefined) parts.push(bgCss);
  const outer = elementBorder !== undefined;
  const { r, c, rowSpan, colSpan } = placement;
  const sides = borderSides(resolved.border);
  for (const side of SIDES) {
    const spec = sides[side];
    if (spec === undefined) continue;
    // 外框胜：表级边框在场时边缘格（extent 触界）的外侧边不声明。
    const onOuterEdge = side === "top"
      ? r === 0
      : side === "left"
        ? c === 0
        : side === "bottom"
          ? r + rowSpan === nRows
          : c + colSpan === nCols;
    if (outer && onOuterEdge) continue;
    parts.push(sideBorderCss(side, spec));
  }
  return parts.join(";") + ";";
}

/** Resolve the same text layout used by text elements from the merged cell
 * style. Content-level direction/wrap/gradient are supplied separately because
 * they are not table style-slot fields. */
function cellTextLayout(
  resolved: TableCellStyleLike,
  text: TableTextContentLike | undefined,
  fontAliases?: ReadonlyMap<string, string>,
) {
  return resolveTextLayout({
    paragraphs: [],
    ...(resolved.color !== undefined ? { color: resolved.color } : {}),
    ...(resolved.fontSize !== undefined ? { fontSize: resolved.fontSize } : {}),
    ...(resolved.fontFamily !== undefined ? { fontFamily: resolved.fontFamily } : {}),
    ...(resolved.bold !== undefined ? { bold: resolved.bold } : {}),
    ...(resolved.italic !== undefined ? { italic: resolved.italic } : {}),
    ...(resolved.lineHeight !== undefined ? { lineHeight: resolved.lineHeight } : {}),
    ...(resolved.lineHeightPx !== undefined ? { lineHeightPx: resolved.lineHeightPx } : {}),
    ...(resolved.letterSpacing !== undefined ? { letterSpacing: resolved.letterSpacing } : {}),
    ...(resolved.marginTop !== undefined ? { marginTop: resolved.marginTop } : {}),
    ...(text?.textDirection !== undefined ? { textDirection: text.textDirection } : {}),
    ...(text?.wrap !== undefined ? { wrap: text.wrap } : {}),
    ...(resolved.align !== undefined ? { align: resolved.align as ["left" | "center" | "right" | "justify" | "distributed", "top" | "middle" | "bottom"] } : {}),
  }, fontAliases);
}

/** 单元格内容 div cssText：位于绝对定位图片填充之上，再应用 shared text layout。 */
function contentDivCss(
  resolved: TableCellStyleLike,
  text: TableTextContentLike | undefined,
  fontAliases?: ReadonlyMap<string, string>,
): string {
  const parts: string[] = ["position:relative", `padding:${CELL_PADDING}`];
  const layout = cellTextLayout(resolved, text, fontAliases);
  const h = alignCss(resolved.align, false);
  if (h !== undefined) {
    parts.push(`text-align:${horizontalAlignCss(layout.align)}`);
    if (h === "distributed") parts.push("text-align-last:justify");
  }
  if (resolved.fontSize !== undefined) parts.push(`font-size:${fmt(resolved.fontSize)}px`);
  if (resolved.fontFamily !== undefined) parts.push(`font-family:${fontFamilyCss(resolved.fontFamily, fontAliases)}`);
  if (resolved.bold) parts.push("font-weight:700");
  if (resolved.italic) parts.push("font-style:italic");
  if (resolved.color !== undefined) parts.push(`color:${resolved.color}`);
  if (resolved.backgroundColor !== undefined) parts.push(`background-color:${resolved.backgroundColor}`);
  if (resolved.lineHeightPx !== undefined || resolved.lineHeight !== undefined) {
    parts.push(`line-height:${lineHeightCss(layout.lineHeight, layout.lineHeightPx)!}`);
  }
  if (resolved.letterSpacing !== undefined) parts.push(`letter-spacing:${fmt(layout.letterSpacing!)}px`);
  if (resolved.marginTop !== undefined) parts.push(`margin-top:${fmt(layout.marginTop!)}px`);
  if (text?.textDirection !== undefined) parts.push(`writing-mode:${textDirectionCss(layout.textDirection)}`);
  if (text?.wrap !== undefined) {
    parts.push(`white-space:${layout.wrap ? "normal" : "nowrap"}`);
    parts.push(`overflow-wrap:${layout.wrap ? "break-word" : "normal"}`);
    parts.push(`word-break:${layout.wrap ? "break-word" : "normal"}`);
  }
  return parts.join(";") + ";";
}

// ---- 编译入口：canonical table → JSON payload + assets ----

/** 列/行比例数组校验（[0,1]、和为 1；fail-closed 于脏载荷）。 */
function checkRatios(values: readonly number[], label: string): void {
  if (values.length === 0 || !values.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) {
    throw new Error(`table.grid ${label}: ratios must be [0,1] finite numbers`);
  }
  if (Math.abs(values.reduce((a, b) => a + b, 0) - 1) > SUM_TOLERANCE) {
    throw new Error(`table.grid ${label}: ratios must sum to 1`);
  }
}

const percent = (ratio: number): string => `${(ratio * 100).toFixed(4)}%`;

/**
 * 投影期编译：canonical 表 → frame hook payload。全部表内语义在此确定
 * （格子/槽位/文本/边框/fill），DOM renderer 只做装配；assets 表由调用方
 * （project.ts）并入 native doc.assets。
 */
export function compileTableGrid(opts: TableGridCompileOptions): { grid: TableGridCompiledV4; assets: Record<string, string> } {
  const { table } = opts;
  checkRatios(table.columnWidths, "columnWidths");
  checkRatios(table.rowHeights, "rowHeights");
  const { nRows, nCols, cells } = placeTableGrid(table);
  const assets: Record<string, string> = {};
  const resolveWithRegister = (ref: string): string => {
    const dataUri = opts.resolveAsset(ref);
    assets[assetKeyOf(ref)] = dataUri;
    return dataUri;
  };

  const gridCells = cells.map((placement) => {
    const resolved = resolveCellStyle(placement.cell, placement, nRows, nCols, table.style);
    const cellWidth = opts.width * table.columnWidths
      .slice(placement.c, placement.c + placement.colSpan)
      .reduce((sum, ratio) => sum + ratio, 0);
    const cellHeight = opts.height * table.rowHeights
      .slice(placement.r, placement.r + placement.rowSpan)
      .reduce((sum, ratio) => sum + ratio, 0);
    const fillOut = fillCss(resolved.fill, { width: cellWidth, height: cellHeight }, resolveWithRegister);
    const bgCss = fillOut.css ?? (resolved.backgroundColor !== undefined ? `background-color:${resolved.backgroundColor}` : undefined);
    const text = placement.cell.text;
    const style = tdStyleCss(opts.elementBorder, placement, nRows, nCols, resolved, bgCss, text);
    const paragraphs = text?.paragraphs ?? [];
    const paragraphPlan = normalizedTextParagraphPlan(paragraphs);
    const hasLatex = paragraphs.some((paragraph) => paragraph.runs.some((run) => run.latex !== undefined));
    const html = `<div style="${contentDivCss(resolved, text, opts.fontAliases)}">${textParagraphsHtml(paragraphs, { mode: "inline", gradient: text?.gradient, fontAliases: opts.fontAliases, paragraphPlan })}</div>`;
    return {
      r: placement.r,
      c: placement.c,
      rowSpan: placement.rowSpan,
      colSpan: placement.colSpan,
      style,
      image: fillOut.image ?? null,
      html,
      hasLatex,
    };
  });

  // 表级面：wrap cssText（布局 + 元素 border/fill）+ wrapImage 图层。
  const wrapParts = ["width:100%", "height:100%", "position:relative", "overflow:hidden", "box-sizing:border-box"];
  let wrapImage: CompiledImageFillV4 | null = null;
  const elementFill = fillCss(opts.elementFill, { width: opts.width, height: opts.height }, resolveWithRegister);
  if (elementFill.css !== undefined) wrapParts.push(elementFill.css);
  else if (elementFill.image !== undefined) wrapImage = elementFill.image;
  if (opts.elementBorder !== undefined) {
    const b = opts.elementBorder;
    wrapParts.push(`border:${fmt(b.width ?? 1)}px ${borderStyleCss(b.style)} ${b.color ?? "#000000"}`);
  }

  return {
    grid: {
      cols: table.columnWidths.map(percent),
      rows: table.rowHeights.map(percent),
      table:
        "width:100%;height:100%;border-collapse:collapse;table-layout:fixed;"
        + `font-family:${CELL_FONT_FAMILY};font-size:${CELL_FONT_SIZE}px;color:${CELL_COLOR};line-height:${CELL_LINE_HEIGHT};`,
      wrap: wrapParts.join(";") + ";",
      wrapImage,
      cells: gridCells,
    },
    assets,
  };
}

// ---- DOM 面（browser only；sealed shell 的 Chromium 消费） ----

interface TableGridElement extends FrameHostElement {
  tableGrid: TableGridCompiledV4;
}

/**
 * table.grid frame 渲染器：把编译 payload 装配成真实 <table>
 * （table-layout:fixed + border-collapse:collapse + 真 rowspan/colspan），
 * 挂进 .bento-el frame。frame 层级/旋转/透明度/选择/变换/导出全部原生。
 */
export function renderTableGrid(element: FrameHostElement, ctx: FrameHostRenderContext): HTMLElement {
  const grid = (element as TableGridElement).tableGrid;
  if (!grid) throw new Error("table.grid requires a tableGrid payload from the projector");

  const wrap = document.createElement("div");
  wrap.style.cssText = grid.wrap;
  if (grid.wrapImage !== null) wrap.appendChild(renderImageFillLayer(grid.wrapImage, ctx));

  const table = document.createElement("table");
  table.style.cssText = grid.table;
  const colgroup = document.createElement("colgroup");
  for (const col of grid.cols) {
    const colEl = document.createElement("col");
    colEl.style.width = col;
    colgroup.appendChild(colEl);
  }
  table.appendChild(colgroup);

  const byRow = new Map<number, TableGridCellV4[]>();
  for (const cell of grid.cells) {
    const list = byRow.get(cell.r) ?? [];
    list.push(cell);
    byRow.set(cell.r, list);
  }
  for (let r = 0; r < grid.rows.length; r += 1) {
    const tr = document.createElement("tr");
    tr.style.height = grid.rows[r]!;
    for (const cell of byRow.get(r) ?? []) {
      const td = document.createElement("td");
      td.dataset.r = String(cell.r);
      td.dataset.c = String(cell.c);
      if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
      if (cell.colSpan > 1) td.colSpan = cell.colSpan;
      td.style.cssText = cell.style;
      if (cell.image !== null) {
        td.style.position = "relative";
        td.appendChild(renderImageFillLayer(cell.image, ctx));
      }
      const inner = document.createElement("div");
      // The host owns Temml/resolveMath. Reuse that exact resolver for table
      // cells; the adapter only owns structure/layout and never downgrades a
      // canonical latex run to ordinary text.
      inner.innerHTML = resolveTableCellHtml(cell, ctx.resolveMath);
      td.appendChild(inner);
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  wrap.appendChild(table);
  return wrap;
}
