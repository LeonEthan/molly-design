/**
 * VisualDocumentKernel（docs/a1a-2-acceptance.md §3/§4）：semantic BentoDoc v4 上的
 * 稳定命令层（GD-4b B2 类型 ripple：applyCommand 切 VisualCommandV4 + BentoDocV4，
 * 冻结输入 = Active Profile v1 matrix + commands-v4.ts 命令面）。自 v3 kernel 平移
 * 行为骨架（batch 校验、STALE_BASE_REVISION、深拷贝原子应用、inverse batch、
 * undo/redo、changedElementIds），只依赖 contracts。
 *
 * 命令语义（v4，按 VISUAL_COMMAND_V4_BACKING 各 capability 行）：
 * 文档级（无 targetId，不进 changedElementIds）：
 * - setCanvasSize：正有限整数（E002 语义）；inverse = 旧 width/height；
 * - setBackground：BentoFillV4 合法形态；inverse = 旧 fill（缺省态白 solid 由 import 保证）；
 * 元素级（先 findElement，target 不存在 → TARGET_NOT_FOUND）：
 * - setText（v4 payload，用户裁决 D2）：target 须 kind "text"；string = plain 简写，
 *   "\n" 切多段、单段单 run，旧 content 顶层样式字段保留（GD-4c 前编辑面是 plain）；
 *   BentoTextContentV4 = 结构化整写；inverse 携带完整旧 content（undo 往返不丢 runs）；
 * - setBounds：四元有限且 w>0/h>0；
 * - setAsset：target 须 kind "image"；src 白名单同 v3；inverse = 旧 src 原样回写；
 * - setImageCrop（v4 语义）：target 须 kind "image"；[l,t,r,b] 四边比例、有限、
 *   l+r<1 且 t+b<1（E013 语义，负值 outset 合法）；null = 清除；
 * - setZOrder：index ∈ [0, elements.length) 整数；重排 + zIndex 连续重编号 0..n-1；
 * - setStyle（v4 patch）：字段→宿主校验（opacity 全 kind；color/文字组仅 text；
 *   fontFamily text/table/chart；fill shape/icon/table/chart；border 类不含 text），
 *   值域校验（[0,1]、枚举、互斥 lineHeight/lineHeightPx）；null = 删除字段；
 * - setRotation/setFlip/setShadow：base 字段，全 kind；null = 清除；inverse 旧值|null；
 * - setBorder：宿主 shape/line/image/icon/table/chart（text 无 border，common.border 行）；
 * - setImageFit：image 专属，词表 fill/contain/cover；
 * - createElement：id 唯一、kind ∈ 词表、bounds 有效、顶层字段 closed-world
 *   （BENTO_DOC_V4_FIELDS）、text content 结构校验；追加到末尾并重编号 zIndex；
 *   inverse = deleteElement；
 * - deleteElement：inverse = createElement(完整元素)（删除可逆不变量）。
 *
 * B3 命令面补齐（GD-4 ticket #4）新增命令语义（VISUAL_COMMAND_V4_BACKING 各行）：
 * 元素级：setShapeGeometry（shape；几何三元组全量替换——present 字段写、缺省删除）/ setLineGeometry（line；points 坐标对 ≥2 语法，
 *   curve 全量替换）/ setLineArrow（line；箭头词表或 null 清除）/ setImageCropShape（image；ShapeDef 或
 *   null）/ setIconName（icon；^[^:\s]+:[^:\s]+$）/ setGroupId（任意宿主；null=离组）/
 *   setTableCellText|setTableCellStyle（table；logical 坐标，被合并覆盖位拒绝）/
 *   setTableMerge（anchor-only；被覆盖格数据销毁，inverse = split + cell 命令重构）/ setTableSplit（仅合并 anchor；
 *   复活占位）/ setTableShape（grow-or-equal；inverse = 空 cell 尾切 shrink + setTableGrid 精确还原权重，
 *   含数据切除拒绝）/ setTableGrid（比例整写；长度=当前行列、值 [0,1]、和≈1）/ setTableStyle（全量替换含 slots 校验）/
 *   setChartData | setChartSeries（encode 逐型必选键；删除限尾部、保持 ≥1，inverse = 尾部追加）/ setChartOption（选项补丁，null=删除）/ setChartPalette；
 * 文档级（无 targetId，不进 changedElementIds）：addFontRegistration / removeFontRegistration
 *   （identity = family+weight+style；add 拒绝重复 identity，remove 无匹配拒绝——inverse 需 src；
 *   中间删除的 inverse 以 remove-后缀 + add 重放保持字节序）。
 *
 * English note (GD-4 ticket #4): the command-surface audit closes every ACTIVE
 * capability-matrix row behind a NAMED VisualCommandV4; no active row falls back on
 * createElement / a broad setStyle stand-in. chart.seriesDefaults stays command-less:
 * import materializes the defaults into each series and does not persist them
 * (packages/authoring/src/import.ts mapChartSeries).
 *
 * 校验失败 → INVALID_COMMAND；均不改文档/revision（clone 上先行，整批原子）。
 * snapshot() = contracts canonicalJson（跨进程 byte-identical 纪律的唯一实现）。
 */

import {
  BENTO_DOC_V4_FIELDS,
  BENTO_ELEMENT_KINDS_V4,
  bentoDocChartRenderInvariantError,
  canonicalJson,
  CHART_ENCODE_OPTIONAL,
  CHART_ENCODE_REQUIRED,
  CHART_SERIES_FIELDS,
  CHART_SERIES_TYPES,
  ARROWHEADS,
  BORDER_STYLES,
  CURVE_MODES,
  FIT_MODES,
  H_ALIGNS,
  TEXT_DIRECTIONS,
  V_ALIGNS,
  isValidLineHeightPx,
  isValidLineHeightRatio,
  isValidLineHeightValue,
  isStaticV1CropShape,
  isStaticV1ShapeName,
  isStaticV1ViewBox,
  staticV1FontFamilyError,
  staticV1FontDescriptorError,
  staticV1FontRegistrationFamilyError,
  staticV1UnregisteredFontFamilies,
  resolveStaticV1IconMembership,
  staticV1ShapeAdjustmentsError,
  isStaticV1LatexSource,
  staticV1SvgPathSyntaxError,
} from "../../contracts/src/index.ts";
import type {
  AddFontRegistrationCommand,
  ApplyError,
  ApplyFailure,
  ApplyResultV4,
  BentoBorder,
  BentoBounds,
  BentoDocV4,
  BentoElementV4,
  BentoShadow,
  BentoTableV4,
  BentoTableCellV4,
  BentoFontRegistrationV4,
  BentoTextContentV4,
  ChartOptionPatchV4,
  CommandBatchV4,
  ElementId,
  RemoveFontRegistrationCommand,
  SetBackgroundCommand,
  SetCanvasSizeCommand,
  SetChartDataCommand,
  SetChartOptionCommand,
  SetChartPaletteCommand,
  SetChartSeriesCommand,
  SetGroupIdCommand,
  SetIconNameCommand,
  SetImageCropShapeCommand,
  SetLineArrowCommand,
  SetLineGeometryCommand,
  SetShapeGeometryCommand,
  SetTableCellStyleCommand,
  SetTableCellTextCommand,
  SetTableGridCommand,
  SetTableStyleCommand,
  TableCellStylePatchV4,
  VisualCommandV4,
  VisualDocumentKernelV4,
  VisualDocumentSnapshot,
  VisualElementV4,
  VisualStylePatchV4,
  VisualTreeV4,
} from "../../contracts/src/index.ts";

/** 命令受影响元素：doc 级命令无 targetId（不进 changedElementIds）。 */
function affectedIdOf(command: VisualCommandV4): ElementId | undefined {
  if (command.type === "createElement") return command.element.id;
  // 文档级：canvas.* + font.registration 行（add/removeFontRegistration 无 targetId）。
  if (
    command.type === "setCanvasSize" ||
    command.type === "setBackground" ||
    command.type === "addFontRegistration" ||
    command.type === "removeFontRegistration"
  ) {
    return undefined;
  }
  return command.targetId;
}

const clone = <T>(value: T): T => structuredClone(value);

function failure(revision: number, error: ApplyError): ApplyFailure {
  return { ok: false, revision, error };
}

function findElement(doc: BentoDocV4, targetId: ElementId): BentoElementV4 | undefined {
  return doc.elements.find((candidate) => candidate.id === targetId);
}

function invalidCommand(targetId: ElementId | undefined, message: string): ApplyError {
  return { code: "INVALID_COMMAND", message, targetId };
}

function validBounds(bounds: BentoBounds): boolean {
  return bounds.every(Number.isFinite) && bounds[2] > 0 && bounds[3] > 0;
}

/** Bounds are a document invariant, not merely a positive-size hint: an
 * element must remain wholly inside the current canvas. */
function boundsWithinCanvas(bounds: BentoBounds, canvas: BentoDocV4["canvas"]): boolean {
  return validBounds(bounds) && bounds[0] >= 0 && bounds[1] >= 0 &&
    bounds[0] + bounds[2] <= canvas.width && bounds[1] + bounds[3] <= canvas.height;
}

/** v4 四边比例 crop：有限即可（负值 = outset），l+r<1 且 t+b<1（image.crop 行）。 */
function validFourEdgeCrop(crop: [number, number, number, number]): boolean {
  const [left, top, right, bottom] = crop;
  return crop.length === 4 && crop.every(Number.isFinite) && left + right < 1 && top + bottom < 1;
}

function renumberZIndex(doc: BentoDocV4): void {
  doc.elements.forEach((element, index) => {
    element.zIndex = index;
  });
}

// ---- 值域校验（fail closed；与 validator/importer 分工：kernel 只管命令面语义） ----
// 枚举词表单一来源 = contracts/value-domains.ts（H_ALIGNS 等经 import 共享）。

const HREF_SCHEMES = new Set(["https:", "http:", "mailto:"]);
const ASSET_SRC = /^asset:[0-9a-f]{64}$/;

function isColor(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFontFamily(value: unknown): boolean {
  return staticV1FontFamilyError(value) === null;
}

/** First invalid weight/style descriptor in a registration (null = both valid). */
function fontDescriptorError(font: { weight?: string; style?: string }): { name: string; error: string } | null {
  for (const [name, value] of [["weight", font.weight], ["style", font.style]] as const) {
    if (value === undefined) continue;
    const error = staticV1FontDescriptorError(value);
    if (error !== null) return { name, error };
  }
  return null;
}

/** Registration identity = family+weight+style（缺省归一为 ""；add/remove 同一判定）。 */
type FontIdentityFields = { family: string; weight?: string; style?: string };

function sameFontIdentity(a: FontIdentityFields, b: FontIdentityFields): boolean {
  return a.family === b.family && (a.weight ?? "") === (b.weight ?? "") && (a.style ?? "") === (b.style ?? "");
}

function fontInvariantError(doc: BentoDocV4): string | null {
  for (const font of doc.fonts ?? []) {
    const error = staticV1FontRegistrationFamilyError(font.family);
    if (error !== null) return `PPTD-E013: invalid font registration family: ${error}`;
    const descriptor = fontDescriptorError(font);
    if (descriptor !== null) return `PPTD-E013: invalid font registration ${descriptor.name}: ${descriptor.error}`;
  }
  try {
    const missing = staticV1UnregisteredFontFamilies(doc.elements, (doc.fonts ?? []).map((font) => font.family));
    return missing.length === 0 ? null : `PPTD-E012: unregistered font family ${JSON.stringify(missing[0])}`;
  } catch (error) {
    return error instanceof Error ? error.message : `PPTD-E013: invalid fontFamily`;
  }
}

function validStops(stops: unknown): boolean {
  return (
    Array.isArray(stops) &&
    stops.length >= 2 &&
    stops.every(
      (stop) =>
        stop !== null && typeof stop === "object" &&
        !Array.isArray(stop) &&
        Object.keys(stop).every((key) => key === "position" || key === "color") &&
        Number.isFinite((stop as { position?: unknown }).position) &&
        (stop as { position: number }).position >= 0 &&
        (stop as { position: number }).position <= 1 &&
        isColor((stop as { color?: unknown }).color),
    )
  );
}

function validGradientAngle(angle: unknown): boolean {
  return angle === undefined || (typeof angle === "number" && Number.isFinite(angle) && angle >= 0 && angle < 360);
}

/** BentoFillV4 四形态（fill.* 行）。fill.image src 严格 asset: 内容寻址。 */
function validFill(fill: unknown): boolean {
  if (fill === null || typeof fill !== "object" || Array.isArray(fill)) return false;
  const rec = fill as Record<string, unknown>;
  if (rec.type === "solid") {
    return Object.keys(rec).every((key) => key === "type" || key === "color") && isColor(rec.color);
  }
  if (rec.type === "gradient") return validGradient(rec);
  if (rec.type === "image") {
    if (!Object.keys(rec).every((key) => key === "type" || key === "src" || key === "fit" || key === "crop" || key === "opacity")) return false;
    if (typeof rec.src !== "string" || !ASSET_SRC.test(rec.src)) return false;
    if (rec.fit !== undefined && !(typeof rec.fit === "string" && FIT_MODES.has(rec.fit))) return false;
    if (rec.crop !== undefined && !(Array.isArray(rec.crop) && rec.crop.length === 4 && validFourEdgeCrop(rec.crop as [number, number, number, number]))) return false;
    const opacity = rec.opacity;
    if (opacity !== undefined && (typeof opacity !== "number" || !Number.isFinite(opacity) || opacity < 0 || opacity > 1)) return false;
    return true;
  }
  return false;
}

function validGradient(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  if (!Object.keys(rec).every((key) => key === "type" || key === "gradientType" || key === "stops" || key === "angle")) return false;
  if (rec.type !== "gradient" || !validStops(rec.stops)) return false;
  if (rec.gradientType === "linear") return validGradientAngle(rec.angle);
  return rec.gradientType === "radial" && rec.angle === undefined;
}

/** 单层/多层阴影（common.shadow 行：多层 = 数组）。 */
function validShadow(shadow: BentoShadow | BentoShadow[]): boolean {
  const list = Array.isArray(shadow) ? shadow : [shadow];
  if (list.length > 16) return false;
  return list.every((layer) => {
    if (layer === null || typeof layer !== "object") return false;
    if (Array.isArray(layer)) return false;
    const rec = layer as unknown as Record<string, unknown>;
    if (!Object.keys(rec).every((key) => key === "blur" || key === "color" || key === "offset")) return false;
    if (typeof rec.blur !== "number" || !Number.isFinite(rec.blur) || rec.blur < 0 || !isColor(rec.color)) return false;
    if (rec.offset !== undefined) {
      if (!Array.isArray(rec.offset) || rec.offset.length !== 2 || !rec.offset.every(Number.isFinite)) return false;
    }
    return true;
  });
}

function validBorder(border: BentoBorder): boolean {
  if (border === null || typeof border !== "object" || Array.isArray(border)) return false;
  const rec = border as Record<string, unknown>;
  if (!Object.keys(rec).every((key) => key === "style" || key === "width" || key === "color")) return false;
  if (rec.style !== undefined && !(typeof rec.style === "string" && BORDER_STYLES.has(rec.style))) return false;
  if (rec.width !== undefined && (!Number.isFinite(rec.width) || (rec.width as number) <= 0)) return false;
  if (rec.color !== undefined && !isColor(rec.color)) return false;
  return true;
}

// ---- B3 命令面值域校验（fail closed；kernel 只管命令面语义，深度语义属 validator/adapter） ----

/** icon.name 行："style:name"。 */
/** 有限十进制数（拒绝 hex/Infinity/空白）。 */
const COORD_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const CHART_OPTION_KEYS = new Set([
  "title", "legend", "dataLabels", "xAxis", "yAxis", "spokeAxis",
  "barWidth", "barGap", "categoryGap", "fontFamily", "fill",
]);
// chart 词表单一来源 = contracts/chart-invariants.ts；下两个平面集合由逐型表派生
// （SERIES_KEYS 历史上同时含 encode 可选通道 open/isTotal/parent——保持既有接受面不变）。
const CHART_SERIES_KEYS = new Set<string>([
  ...Object.values(CHART_SERIES_FIELDS).flat(),
  ...Object.values(CHART_ENCODE_OPTIONAL).flat(),
]);
const CHART_ENCODE_KEYS = new Set<string>([
  ...Object.values(CHART_ENCODE_REQUIRED).flat(),
  ...Object.values(CHART_ENCODE_OPTIONAL).flat(),
]);

const TABLE_STYLE_KEYS = new Set([
  "cellStyle", "firstRowStyle", "lastRowStyle", "firstColumnStyle", "lastColumnStyle",
  "bodyStyles", "rowOverColumn",
]);

/** 单元格样式键面（BentoTableCellStyleV4 / TableCellStylePatchV4 共用）。 */
const CELL_STYLE_KEYS = new Set([
  "color", "fontSize", "fontFamily", "bold", "italic", "backgroundColor",
  "lineHeight", "lineHeightPx", "letterSpacing", "marginTop", "fill", "border", "align",
]);

/** image.cropShape 几何：custom 完整承载 viewBox/path；preset 不得夹带惰性字段。 */
function validShapeDef(def: unknown): boolean {
  if (def === null || typeof def !== "object" || Array.isArray(def)) return false;
  const rec = def as Record<string, unknown>;
  if (!Object.keys(rec).every((key) => key === "shapeName" || key === "adjustments" || key === "viewBox" || key === "path")) return false;
  if (!isStaticV1CropShape(rec.shapeName)) return false;
  if (staticV1ShapeAdjustmentsError(rec.shapeName, rec.adjustments as readonly number[] | undefined) !== null) return false;
  if (rec.shapeName === "custom") {
    return isStaticV1ViewBox(rec.viewBox) &&
      typeof rec.path === "string" &&
      staticV1SvgPathSyntaxError(rec.path) === null;
  }
  if (rec.viewBox !== undefined || rec.path !== undefined) return false;
  return true;
}

/** setShapeGeometry 值域：custom 完整承载 viewBox/path；preset 不得夹带惰性字段。 */
function validShapeGeometryInput(cmd: SetShapeGeometryCommand): boolean {
  if (!isStaticV1ShapeName(cmd.shapeName)) return false;
  if (staticV1ShapeAdjustmentsError(cmd.shapeName, cmd.adjustments) !== null) return false;
  if (cmd.shapeName === "custom") {
    return isStaticV1ViewBox(cmd.viewBox) &&
      typeof cmd.path === "string" &&
      staticV1SvgPathSyntaxError(cmd.path) === null;
  }
  if (cmd.viewBox !== undefined || cmd.path !== undefined) return false;
  return true;
}

/** line.points 语法："x1,y1 x2,y2 ..."，≥2 有限坐标对；返回单空格规范化串或 null。 */
function normalizePoints(points: string): string | null {
  if (typeof points !== "string") return null;
  const tokens = points.trim().split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length < 2) return null;
  const out: string[] = [];
  for (const token of tokens) {
    const comma = token.indexOf(",");
    if (comma <= 0 || comma === token.length - 1) return null;
    const rawX = token.slice(0, comma);
    const rawY = token.slice(comma + 1);
    if (!COORD_RE.test(rawX) || !COORD_RE.test(rawY)) return null;
    const x = Number(rawX);
    const y = Number(rawY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push(`${x},${y}`);
  }
  return out.join(" ");
}

function pointsWithinViewBox(points: string, viewBox: readonly [number, number]): boolean {
  return points.split(/\s+/).every((token) => {
    const comma = token.indexOf(",");
    if (comma <= 0 || comma === token.length - 1) return false;
    const x = Number(token.slice(0, comma));
    const y = Number(token.slice(comma + 1));
    return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= viewBox[0] && y >= 0 && y <= viewBox[1];
  });
}

/** line.arrow 行：[start|null, end|null] 词表校验。 */
function validArrowPair(arrow: unknown): boolean {
  if (!Array.isArray(arrow) || arrow.length !== 2) return false;
  return arrow.every((end) => end === null || (typeof end === "string" && ARROWHEADS.has(end)));
}

/** BentoCellBorderV4：null | 单边 spec | 二/四元 tuple（table.cellBorder 行）。 */
function validCellBorder(border: unknown): boolean {
  if (border === null) return true;
  if (!Array.isArray(border)) return validBorder(border as BentoBorder);
  if (border.length !== 2 && border.length !== 4) return false;
  return border.every((side) => side === null || validBorder(side as BentoBorder));
}

/** 单字段值域（table.cellTextProps/cellFill/cellBorder/cellAlign 行）；null = 删除语义由调用方处理。 */
function validCellStyleFieldValue(key: string, value: unknown): boolean {
  switch (key) {
    case "color":
    case "backgroundColor":
      return isColor(value);
    case "fontFamily":
      return isFontFamily(value);
    case "fontSize":
      return Number.isFinite(value) && (value as number) > 0;
    case "bold":
    case "italic":
      return typeof value === "boolean";
    case "lineHeight":
      return isValidLineHeightRatio(value);
    case "lineHeightPx":
      return isValidLineHeightPx(value);
    case "letterSpacing":
      return Number.isFinite(value) && Math.abs(value as number) <= 1000;
    case "marginTop":
      return Number.isFinite(value);
    case "fill":
      return validFill(value);
    case "border":
      return validCellBorder(value);
    case "align":
      return Array.isArray(value) && value.length === 2 &&
        typeof value[0] === "string" && H_ALIGNS.has(value[0]) &&
        typeof value[1] === "string" && V_ALIGNS.has(value[1]);
    default:
      return false;
  }
}

/** 单元格样式键面 + 叶子值域 + lineHeight/lineHeightPx 互斥。 */
function validCellStyleFields(rec: Record<string, unknown>): boolean {
  if (rec === null || typeof rec !== "object" || Array.isArray(rec)) return false;
  for (const key of Object.keys(rec)) {
    if (!CELL_STYLE_KEYS.has(key) || !validCellStyleFieldValue(key, rec[key])) return false;
  }
  return !(rec.lineHeight !== undefined && rec.lineHeightPx !== undefined);
}

/** BentoTableStyleV4 slots 校验（table.styleRef/styleSlots/bodyStylesCycle/rowOverColumn 行）。 */
function validTableStyle(style: unknown): boolean {
  if (style === null || typeof style !== "object" || Array.isArray(style)) return false;
  const rec = style as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!TABLE_STYLE_KEYS.has(key)) return false;
  }
  for (const slot of ["cellStyle", "firstRowStyle", "lastRowStyle", "firstColumnStyle", "lastColumnStyle"] as const) {
    if (rec[slot] !== undefined && !validCellStyleFields(rec[slot] as Record<string, unknown>)) return false;
  }
  if (rec.bodyStyles !== undefined) {
    if (!Array.isArray(rec.bodyStyles)) return false;
    for (const style of rec.bodyStyles) {
      if (!validCellStyleFields(style as Record<string, unknown>)) return false;
    }
  }
  if (rec.rowOverColumn !== undefined && typeof rec.rowOverColumn !== "boolean") return false;
  return true;
}

/** chart.data 行：cols 唯一非空；每行同长于头；cell 词表 number|string|null。 */
function validChartData(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const rec = data as Record<string, unknown>;
  if (!Array.isArray(rec.cols) || rec.cols.length === 0) return false;
  const seen = new Set<string>();
  for (const col of rec.cols) {
    if (typeof col !== "string" || col.length === 0 || seen.has(col)) return false;
    seen.add(col);
  }
  if (!Array.isArray(rec.rows)) return false;
  for (const row of rec.rows) {
    if (!Array.isArray(row) || row.length !== rec.cols.length) return false;
    for (const cell of row) {
      if (typeof cell === "number") {
        if (!Number.isFinite(cell)) return false;
      } else if (typeof cell !== "string" && cell !== null) {
        return false;
      }
    }
  }
  return true;
}

/** chart.encode 行逐型必选键：series.type ∈ 词表且必选 encode 键为非空字符串。 */
function validChartSeries(series: unknown): boolean {
  if (series === null || typeof series !== "object" || Array.isArray(series)) return false;
  const rec = series as Record<string, unknown>;
  if (!Object.keys(rec).every((key) => CHART_SERIES_KEYS.has(key))) return false;
  if (typeof rec.type !== "string" || !(CHART_SERIES_TYPES as readonly string[]).includes(rec.type)) return false;
  if (rec.encode === null || typeof rec.encode !== "object" || Array.isArray(rec.encode)) return false;
  const encode = rec.encode as Record<string, unknown>;
  if (!Object.keys(encode).every((key) => CHART_ENCODE_KEYS.has(key))) return false;
  for (const key of CHART_ENCODE_REQUIRED[rec.type] ?? []) {
    const value = encode[key];
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}

function validChartValue(chart: unknown): boolean {
  if (chart === null || typeof chart !== "object" || Array.isArray(chart)) return false;
  const rec = chart as Record<string, unknown>;
  const chartKeys = new Set([
    "data", "series", "seriesDefaults", "xAxis", "yAxis", "barWidth", "barGap", "categoryGap",
    "spokeAxis", "title", "legend", "dataLabels", "fontFamily", "palette", "fill",
  ]);
  if (!Object.keys(rec).every((key) => chartKeys.has(key))) return false;
  if (!validChartData(rec.data)) return false;
  if (!Array.isArray(rec.series) || rec.series.length < 1 || !rec.series.every(validChartSeries)) return false;
  for (const key of ["barWidth", "barGap", "categoryGap"] as const) {
    if (rec[key] !== undefined && (typeof rec[key] !== "number" || !Number.isFinite(rec[key]))) return false;
  }
  if (rec.fontFamily !== undefined && !isFontFamily(rec.fontFamily)) return false;
  if (rec.palette !== undefined && (!Array.isArray(rec.palette) || rec.palette.length === 0 || !rec.palette.every(isColor))) return false;
  if (rec.fill !== undefined && !validFill(rec.fill)) return false;
  for (const key of ["title", "legend", "dataLabels", "xAxis", "yAxis", "spokeAxis"] as const) {
    if (rec[key] !== undefined && !validChartOptionValue(key, rec[key])) return false;
  }
  return true;
}

/** ChartOptionPatchV4 单项值域（表层类型；嵌套细节属 validator/adapter）。 */
function validChartOptionValue(key: string, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const object = value !== null && typeof value === "object" && !Array.isArray(value);
  switch (key) {
    case "title":
      if (typeof value === "string") return value.length > 0;
      return object && typeof (value as Record<string, unknown>).text === "string" && ((value as Record<string, unknown>).text as string).length > 0;
    case "legend":
      return typeof value === "boolean" || object;
    case "dataLabels":
    case "spokeAxis":
      return object;
    case "xAxis":
    case "yAxis":
      return object || (Array.isArray(value) && value.length > 0 && value.every((item) => item !== null && typeof item === "object" && !Array.isArray(item)));
    case "barWidth":
    case "barGap":
    case "categoryGap":
      return typeof value === "number" && Number.isFinite(value);
    case "fontFamily":
      return isFontFamily(value);
    case "fill":
      return validFill(value);
    default:
      return false;
  }
}

function validRatioLayout(value: unknown, expectedLength: number): boolean {
  if (!Array.isArray(value) || value.length !== expectedLength || expectedLength < 1) return false;
  const values = value as unknown[];
  const sum = values.reduce<number>((acc, item) => acc + (typeof item === "number" ? item : Number.NaN), 0);
  return values.every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 1) && Math.abs(sum - 1) <= 1e-6;
}

function validTableCell(cell: unknown): boolean {
  if (cell === null || typeof cell !== "object" || Array.isArray(cell)) return false;
  const rec = cell as Record<string, unknown>;
  const allowed = new Set([...CELL_STYLE_KEYS, "text", "rowSpan", "colSpan"]);
  if (!Object.keys(rec).every((key) => allowed.has(key))) return false;
  const style: Record<string, unknown> = {};
  for (const key of CELL_STYLE_KEYS) {
    if (rec[key] !== undefined) style[key] = rec[key];
  }
  if (!validCellStyleFields(style)) return false;
  if (rec.text !== undefined && !validTextContent(rec.text as BentoTextContentV4)) return false;
  for (const key of ["rowSpan", "colSpan"] as const) {
    if (rec[key] !== undefined && (!Number.isInteger(rec[key]) || (rec[key] as number) < 1)) return false;
  }
  return true;
}

function validTableValue(table: unknown): boolean {
  if (table === null || typeof table !== "object" || Array.isArray(table)) return false;
  const rec = table as Record<string, unknown>;
  if (!Object.keys(rec).every((key) => key === "columnWidths" || key === "rowHeights" || key === "rows" || key === "style")) return false;
  if (!Array.isArray(rec.columnWidths) || !Array.isArray(rec.rowHeights) || !Array.isArray(rec.rows)) return false;
  if (!validRatioLayout(rec.columnWidths, rec.columnWidths.length) || !validRatioLayout(rec.rowHeights, rec.rowHeights.length)) return false;
  if (rec.rows.length !== rec.rowHeights.length) return false;
  if (!rec.rows.every((row) => Array.isArray(row) && row.every(validTableCell))) return false;
  if (rec.style !== undefined && !validTableStyle(rec.style)) return false;
  return expandGrid(table as BentoTableV4) !== null;
}

/**
 * 逻辑格网展开（table.merge 行占位省略形态）：rows.length×cols 视图，被合并覆盖位
 * undefined；物理布局越出/重叠/洞不合法 → null（与 validator E014 覆盖纪律同源）。
 */
function expandGrid(table: BentoTableV4): (BentoTableCellV4 | undefined)[][] | null {
  const cols = table.columnWidths.length;
  const nRows = table.rows.length;
  const grid: (BentoTableCellV4 | undefined)[][] = Array.from({ length: nRows }, () => Array<BentoTableCellV4 | undefined>(cols).fill(undefined));
  const occupied: boolean[][] = Array.from({ length: nRows }, () => Array<boolean>(cols).fill(false));
  for (let r = 0; r < nRows; r += 1) {
    let c = 0;
    for (const cell of table.rows[r]!) {
      while (c < cols && occupied[r]![c]) c += 1;
      const rs = cell.rowSpan ?? 1;
      const cs = cell.colSpan ?? 1;
      if (c + cs > cols || r + rs > nRows) return null;
      for (let rr = r; rr < r + rs; rr += 1) {
        for (let cc = c; cc < c + cs; cc += 1) {
          if (occupied[rr]![cc]) return null;
          occupied[rr]![cc] = true;
        }
      }
      grid[r]![c] = cell;
      c += cs;
    }
  }
  for (let r = 0; r < nRows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!occupied[r]![c]) return null;
    }
  }
  return grid;
}

/** 逻辑格网 → 物理 rows（占位省略形态）。 */
function rebuildRows(grid: (BentoTableCellV4 | undefined)[][]): BentoTableCellV4[][] {
  return grid.map((row) => row.filter((cell): cell is BentoTableCellV4 => cell !== undefined));
}

/** 表宽/高数组等比重分配：grow 缩存保留既有比例；shrink 前 to 项归一化（sum≈1、值 [0,1]，setTableGrid 可合法落地）。 */
function redistributeLayout(weights: number[], fromCount: number, toCount: number): number[] {
  if (toCount > fromCount) {
    const out = weights.map((w) => w * (fromCount / toCount));
    for (let i = 0; i < toCount - fromCount; i += 1) out.push(1 / toCount);
    return out;
  }
  if (toCount < fromCount) {
    const head = weights.slice(0, toCount);
    const sum = head.reduce((acc, value) => acc + value, 0);
    return sum === 0 ? Array<number>(toCount).fill(1 / toCount) : head.map((w) => w / sum);
  }
  return [...weights];
}


// ---- text content 结构校验（setText/createElement 共用；嵌套不设子表纪律下的
// 键面封闭 + 叶子类型检查，深度语义属 validator/projector） ----

const TEXT_CONTENT_KEYS = new Set([
  "paragraphs", "color", "fontSize", "fontFamily", "bold", "italic", "backgroundColor",
  "lineHeight", "lineHeightPx", "letterSpacing", "marginTop", "textDirection", "wrap", "align", "gradient",
]);
const PARAGRAPH_KEYS = new Set(["runs", "align", "lineHeight", "margin", "list"]);
const RUN_KEYS = new Set([
  "text", "color", "fontSize", "fontFamily", "backgroundColor", "bold", "italic",
  "underline", "strikethrough", "baselineShift", "href", "latex",
]);
const PARAGRAPH_MARGIN_KEYS = new Set(["top", "left", "right"]);
const LIST_KEYS = new Set(["ordered", "marker", "indent", "style"]);
const LIST_STYLE_KEYS = new Set(["align", "lineHeight", "letterSpacing", "marginTop", "marginLeft", "marker"]);

function validHref(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const colon = value.indexOf(":");
  return colon > 0 && HREF_SCHEMES.has(value.slice(0, colon + 1).toLowerCase());
}

function validTextRun(run: unknown): boolean {
  if (run === null || typeof run !== "object" || Array.isArray(run)) return false;
  const rec = run as Record<string, unknown>;
  if (!Object.keys(rec).every((key) => RUN_KEYS.has(key)) || typeof rec.text !== "string") return false;
  if (rec.color !== undefined && !isColor(rec.color)) return false;
  if (rec.backgroundColor !== undefined && !isColor(rec.backgroundColor)) return false;
  if (rec.fontSize !== undefined && (!Number.isFinite(rec.fontSize) || (rec.fontSize as number) <= 0)) return false;
  if (rec.fontFamily !== undefined && !isFontFamily(rec.fontFamily)) return false;
  if (rec.bold !== undefined && typeof rec.bold !== "boolean") return false;
  if (rec.italic !== undefined && typeof rec.italic !== "boolean") return false;
  if (rec.underline !== undefined && typeof rec.underline !== "boolean") return false;
  if (rec.strikethrough !== undefined && typeof rec.strikethrough !== "boolean") return false;
  if (rec.baselineShift !== undefined && rec.baselineShift !== "sup" && rec.baselineShift !== "sub") return false;
  if (rec.href !== undefined && !validHref(rec.href)) return false;
  return rec.latex === undefined || isStaticV1LatexSource(rec.latex);
}

function validParagraph(paragraph: unknown): boolean {
  if (paragraph === null || typeof paragraph !== "object" || Array.isArray(paragraph)) return false;
  const rec = paragraph as Record<string, unknown>;
  if (!Object.keys(rec).every((key) => PARAGRAPH_KEYS.has(key)) || !Array.isArray(rec.runs)) return false;
  if (!rec.runs.every(validTextRun)) return false;
  if (rec.align !== undefined && (typeof rec.align !== "string" || !H_ALIGNS.has(rec.align))) return false;
  if (rec.lineHeight !== undefined && !isValidLineHeightValue(rec.lineHeight)) return false;
  if (rec.margin !== undefined) {
    if (rec.margin === null || typeof rec.margin !== "object" || Array.isArray(rec.margin)) return false;
    const margin = rec.margin as Record<string, unknown>;
    if (!Object.keys(margin).every((key) => PARAGRAPH_MARGIN_KEYS.has(key))) return false;
    if (Object.values(margin).some((value) => !Number.isFinite(value))) return false;
  }
  if (rec.list !== undefined) {
    if (rec.list === null || typeof rec.list !== "object" || Array.isArray(rec.list)) return false;
    const list = rec.list as Record<string, unknown>;
    if (!Object.keys(list).every((key) => LIST_KEYS.has(key))) return false;
    if (list.ordered !== undefined && typeof list.ordered !== "boolean") return false;
    if (list.marker !== undefined && (typeof list.marker !== "string" || list.marker.length === 0)) return false;
    if (list.indent !== undefined && (!Number.isFinite(list.indent) || (list.indent as number) < 0)) return false;
    if (list.style !== undefined) {
      if (list.style === null || typeof list.style !== "object" || Array.isArray(list.style)) return false;
      const style = list.style as Record<string, unknown>;
      if (!Object.keys(style).every((key) => LIST_STYLE_KEYS.has(key))) return false;
      if (style.align !== undefined && (typeof style.align !== "string" || !H_ALIGNS.has(style.align))) return false;
      if (style.lineHeight !== undefined && !isValidLineHeightValue(style.lineHeight)) return false;
      for (const key of ["letterSpacing", "marginTop", "marginLeft"] as const) {
        if (style[key] !== undefined && !Number.isFinite(style[key])) return false;
      }
      if (style.marker !== undefined && (typeof style.marker !== "string" || style.marker.length === 0)) return false;
    }
  }
  return true;
}

function validTextContent(content: BentoTextContentV4): boolean {
  if (content === null || typeof content !== "object" || Array.isArray(content)) return false;
  const rec = content as unknown as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!TEXT_CONTENT_KEYS.has(key)) return false;
  }
  if (!Array.isArray(rec.paragraphs)) return false;
  if (!rec.paragraphs.every(validParagraph)) return false;
  if (rec.color !== undefined && !isColor(rec.color)) return false;
  if (rec.backgroundColor !== undefined && !isColor(rec.backgroundColor)) return false;
  if (rec.fontSize !== undefined && (!Number.isFinite(rec.fontSize) || (rec.fontSize as number) <= 0)) return false;
  if (rec.fontFamily !== undefined && !isFontFamily(rec.fontFamily)) return false;
  if (rec.bold !== undefined && typeof rec.bold !== "boolean") return false;
  if (rec.italic !== undefined && typeof rec.italic !== "boolean") return false;
  if (rec.wrap !== undefined && typeof rec.wrap !== "boolean") return false;
  if (rec.textDirection !== undefined && !(typeof rec.textDirection === "string" && TEXT_DIRECTIONS.has(rec.textDirection))) return false;
  if (rec.letterSpacing !== undefined && (!Number.isFinite(rec.letterSpacing) || Math.abs(rec.letterSpacing as number) > 1000)) return false;
  if (rec.marginTop !== undefined && !Number.isFinite(rec.marginTop)) return false;
  if (rec.lineHeight !== undefined && !isValidLineHeightRatio(rec.lineHeight)) return false;
  if (rec.lineHeightPx !== undefined && !isValidLineHeightPx(rec.lineHeightPx)) return false;
  if (rec.lineHeight !== undefined && rec.lineHeightPx !== undefined) return false;
  if (rec.align !== undefined) {
    if (!Array.isArray(rec.align) || rec.align.length !== 2) return false;
    const [h, v] = rec.align as unknown[];
    if (typeof h !== "string" || !H_ALIGNS.has(h) || typeof v !== "string" || !V_ALIGNS.has(v)) return false;
  }
  if (rec.gradient !== undefined && !validGradient(rec.gradient)) return false;
  return true;
}

/** plain 简写 → v4 content："\n" 切多段、单段单 run；旧 content 顶层样式字段保留。 */
function textContentFromPlain(text: string, previous: BentoTextContentV4): BentoTextContentV4 {
  const {
    paragraphs: _paragraphs,
    ...style
  } = previous;
  return {
    ...style,
    paragraphs: text.split("\n").map((line) => ({ runs: [{ text: line }] })),
  };
}

// ---- setStyle v4 patch：字段 → 宿主（commands-v4.ts 头注宿主面） ----

const TEXT_PATCH_KEYS = new Set([
  "color", "fontSize", "bold", "italic", "lineHeight", "lineHeightPx", "letterSpacing",
  "marginTop", "align", "wrap", "textDirection", "backgroundColor", "gradient",
]);
const STYLE_PATCH_KEYS = new Set(["opacity", "fontFamily", "fill", ...TEXT_PATCH_KEYS]);

/**
 * 返回 inverse setStyle 命令；校验失败返回 ApplyError。写入直接落在 clone 后的 target 上。
 */
function applyStylePatch(target: BentoElementV4, patch: VisualStylePatchV4): VisualCommandV4 | ApplyError {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return invalidCommand(target.id, "setStyle patch must be an object");
  }
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    return invalidCommand(target.id, "setStyle patch requires at least one key");
  }
  const unknown = keys.find((key) => !STYLE_PATCH_KEYS.has(key));
  if (unknown !== undefined) {
    return invalidCommand(target.id, `setStyle unknown patch key ${unknown}`);
  }
  const inversePatch: VisualStylePatchV4 = {};
  const has = (key: string) => keys.includes(key);

  // opacity：v4 提为 base，全 kind（common.opacity 行）。
  if (has("opacity")) {
    const value = patch.opacity;
    if (value !== null && value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
      return invalidCommand(target.id, "setStyle opacity must be in [0,1]");
    }
    inversePatch.opacity = target.opacity ?? null;
    if (value === null || value === undefined) delete target.opacity;
    else target.opacity = value;
  }

  // 文本宿主字段（text.* 行）。
  const textKeys = keys.filter((key) => TEXT_PATCH_KEYS.has(key));
  if (textKeys.length > 0) {
    if (target.kind !== "text") {
      return invalidCommand(target.id, `setStyle ${textKeys.join("/")} only applies to text elements`);
    }
    const content = target.text;
    if (has("lineHeight") && patch.lineHeight !== null && patch.lineHeight !== undefined && content.lineHeightPx !== undefined) {
      return invalidCommand(target.id, "lineHeight conflicts with existing lineHeightPx (mutually exclusive)");
    }
    if (has("lineHeightPx") && patch.lineHeightPx !== null && patch.lineHeightPx !== undefined && content.lineHeight !== undefined) {
      return invalidCommand(target.id, "lineHeightPx conflicts with existing lineHeight (mutually exclusive)");
    }
    if (has("color")) {
      const value = patch.color;
      if (value !== null && value !== undefined && !isColor(value)) {
        return invalidCommand(target.id, "setStyle color must be a string");
      }
      inversePatch.color = content.color ?? null;
      if (value === null || value === undefined) delete content.color;
      else content.color = value;
    }
    if (has("fontSize")) {
      const value = patch.fontSize;
      if (value !== null && value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        return invalidCommand(target.id, "setStyle fontSize must be a positive finite number");
      }
      inversePatch.fontSize = content.fontSize ?? null;
      if (value === null || value === undefined) delete content.fontSize;
      else content.fontSize = value;
    }
    for (const key of ["bold", "italic"] as const) {
      if (!has(key)) continue;
      const value = patch[key];
      if (value !== null && value !== undefined && typeof value !== "boolean") {
        return invalidCommand(target.id, `setStyle ${key} must be a boolean`);
      }
      inversePatch[key] = content[key] ?? null;
      if (value === null || value === undefined) delete content[key];
      else content[key] = value;
    }
    for (const key of ["lineHeight", "lineHeightPx", "letterSpacing", "marginTop"] as const) {
      if (!has(key)) continue;
      const value = patch[key];
      if (value !== null && value !== undefined && !validCellStyleFieldValue(key, value)) {
        return invalidCommand(target.id, `setStyle ${key} has an invalid value`);
      }
      inversePatch[key] = content[key] ?? null;
      if (value === null || value === undefined) delete content[key];
      else content[key] = value;
    }
    if (has("align")) {
      const value = patch.align;
      const valid =
        value === null || value === undefined ||
        (Array.isArray(value) && value.length === 2 &&
          typeof value[0] === "string" && H_ALIGNS.has(value[0]) &&
          typeof value[1] === "string" && V_ALIGNS.has(value[1]));
      if (!valid) return invalidCommand(target.id, "setStyle align must be a [horizontal, vertical] pair");
      inversePatch.align = content.align ? [...content.align] : null;
      if (value === null || value === undefined) delete content.align;
      else content.align = [...value] as typeof content.align;
    }
    if (has("wrap")) {
      const value = patch.wrap;
      if (value !== null && value !== undefined && typeof value !== "boolean") {
        return invalidCommand(target.id, "setStyle wrap must be a boolean");
      }
      inversePatch.wrap = content.wrap ?? null;
      if (value === null || value === undefined) delete content.wrap;
      else content.wrap = value;
    }
    if (has("textDirection")) {
      const value = patch.textDirection;
      if (value !== null && value !== undefined && !(typeof value === "string" && TEXT_DIRECTIONS.has(value))) {
        return invalidCommand(target.id, "setStyle textDirection must be horizontal or vertical");
      }
      inversePatch.textDirection = content.textDirection ?? null;
      if (value === null || value === undefined) delete content.textDirection;
      else content.textDirection = value;
    }
    if (has("backgroundColor")) {
      const value = patch.backgroundColor;
      if (value !== null && value !== undefined && !isColor(value)) {
        return invalidCommand(target.id, "setStyle backgroundColor must be a string");
      }
      inversePatch.backgroundColor = content.backgroundColor ?? null;
      if (value === null || value === undefined) delete content.backgroundColor;
      else content.backgroundColor = value;
    }
    if (has("gradient")) {
      const value = patch.gradient;
      if (value !== null && value !== undefined && !validGradient(value)) {
        return invalidCommand(target.id, "setStyle gradient must be a linear/radial gradient with >= 2 stops");
      }
      inversePatch.gradient = content.gradient ?? null;
      if (value === null || value === undefined) delete content.gradient;
      else content.gradient = clone(value);
    }
  }

  // fontFamily：text/table/chart 宿主（font.familyUniform/familyLatinEa 行）。
  if (has("fontFamily")) {
    const value = patch.fontFamily;
    if (value !== null && value !== undefined && !isFontFamily(value)) {
      return invalidCommand(target.id, "setStyle fontFamily must be a stack string or {latin, ea}");
    }
    if (target.kind === "text") {
      inversePatch.fontFamily = target.text.fontFamily ?? null;
      if (value === null || value === undefined) delete target.text.fontFamily;
      else target.text.fontFamily = clone(value);
    } else if (target.kind === "table") {
      inversePatch.fontFamily = target.table.style?.cellStyle?.fontFamily ?? null;
      if (value === null || value === undefined) {
        if (target.table.style?.cellStyle) delete target.table.style.cellStyle.fontFamily;
      } else {
        target.table.style = {
          ...target.table.style,
          cellStyle: { ...target.table.style?.cellStyle, fontFamily: clone(value) },
        };
      }
    } else if (target.kind === "chart") {
      inversePatch.fontFamily = target.chart.fontFamily ?? null;
      if (value === null || value === undefined) delete target.chart.fontFamily;
      else target.chart.fontFamily = clone(value);
    } else {
      return invalidCommand(target.id, "setStyle fontFamily applies to text/table/chart elements");
    }
  }

  // fill：shape/icon/table/chart 宿主（fill.* 行；chart 落 chart.fill 外框）。
  if (has("fill")) {
    const value = patch.fill;
    if (value !== null && value !== undefined && !validFill(value)) {
      return invalidCommand(target.id, "setStyle fill must be a valid BentoFillV4 (image fill src must be asset:<sha256>)");
    }
    if (target.kind === "text") {
      return invalidCommand(target.id, "setStyle fill does not apply to text elements (use gradient)");
    }
    if (target.kind === "line" || target.kind === "image") {
      return invalidCommand(target.id, "setStyle fill does not apply to line/image elements");
    }
    inversePatch.fill = (target.kind === "chart" ? target.chart.fill : target.fill) ?? null;
    if (value === null || value === undefined) {
      if (target.kind === "chart") delete target.chart.fill;
      else delete target.fill;
    } else {
      const fill = clone(value);
      if (target.kind === "chart") target.chart.fill = fill;
      else target.fill = fill;
    }
  }

  return { type: "setStyle", targetId: target.id, patch: inversePatch };
}

// ---- 元素顶层 closed-world（createElement；BENTO_DOC_V4_FIELDS 词表） ----

function validElementTopLevel(element: BentoElementV4): boolean {
  const fields = BENTO_DOC_V4_FIELDS.elements;
  const allowed = new Set<string>([...fields.common, ...fields[element.kind]]);
  const rec = element as unknown as Record<string, unknown>;
  return Object.keys(rec).every((key) => allowed.has(key));
}

function validCommonElementFields(element: BentoElementV4, canvas: BentoDocV4["canvas"]): boolean {
  const rec = element as unknown as Record<string, unknown>;
  if (!boundsWithinCanvas(rec.bounds as BentoBounds, canvas)) return false;
  if (!Number.isInteger(rec.zIndex) || (rec.zIndex as number) < 0) return false;
  if (rec.rotation !== undefined && (typeof rec.rotation !== "number" || !Number.isFinite(rec.rotation))) return false;
  if (rec.flip !== undefined && (!Array.isArray(rec.flip) || rec.flip.length !== 2 || rec.flip.some((value) => typeof value !== "boolean"))) return false;
  if (rec.groupId !== undefined && (typeof rec.groupId !== "string" || rec.groupId.length === 0)) return false;
  if (rec.opacity !== undefined && (typeof rec.opacity !== "number" || !Number.isFinite(rec.opacity) || rec.opacity < 0 || rec.opacity > 1)) return false;
  if (rec.shadow !== undefined && !validShadow(rec.shadow as BentoShadow | BentoShadow[])) return false;
  if ((element.kind === "table" || element.kind === "chart") && (rec.rotation !== undefined || rec.flip !== undefined)) return false;
  return true;
}

function validElementPayload(element: BentoElementV4, canvas: BentoDocV4["canvas"]): boolean {
  if (!validElementTopLevel(element) || !validCommonElementFields(element, canvas)) return false;
  switch (element.kind) {
    case "text":
      return validTextContent(element.text);
    case "shape":
      return validShapeGeometryInput({
        type: "setShapeGeometry",
        targetId: element.id,
        shapeName: element.shapeName,
        ...(element.adjustments !== undefined ? { adjustments: element.adjustments } : {}),
        ...(element.viewBox !== undefined ? { viewBox: element.viewBox } : {}),
        ...(element.path !== undefined ? { path: element.path } : {}),
      }) && (element.fill === undefined || validFill(element.fill)) && (element.border === undefined || validBorder(element.border));
    case "line": {
      if (!Array.isArray(element.viewBox) || element.viewBox.length !== 2 || !element.viewBox.every((value) => typeof value === "number" && Number.isFinite(value) && value > 0)) return false;
      const points = normalizePoints(element.points);
      if (points === null || !pointsWithinViewBox(points, element.viewBox)) return false;
      if (element.curve !== undefined && !CURVE_MODES.has(element.curve)) return false;
      return (element.arrow === undefined || validArrowPair(element.arrow)) && (element.border === undefined || validBorder(element.border));
    }
    case "image": {
      const srcOk = typeof element.src === "string" && (ASSET_SRC.test(element.src) || (/^media\//.test(element.src) && !element.src.includes("..")));
      return srcOk && (element.fit === undefined || FIT_MODES.has(element.fit)) &&
        (element.crop === undefined || (Array.isArray(element.crop) && element.crop.length === 4 && validFourEdgeCrop(element.crop))) &&
        (element.cropShape === undefined || validShapeDef(element.cropShape)) &&
        (element.border === undefined || validBorder(element.border));
    }
    case "icon":
      return typeof element.iconName === "string" && (element.fill === undefined || validFill(element.fill)) && (element.border === undefined || validBorder(element.border));
    case "table":
      return validTableValue(element.table) && (element.fill === undefined || validFill(element.fill)) && (element.border === undefined || validBorder(element.border));
    case "chart":
      return validChartValue(element.chart) && (element.border === undefined || validBorder(element.border));
  }
  return false;
}

/** 元素级命令（doc 级 setCanvasSize/setBackground 及 B3 字体命令由 applyCommand 先行分流）。 */
type ElementCommandV4 = Exclude<
  VisualCommandV4,
  SetCanvasSizeCommand | SetBackgroundCommand | AddFontRegistrationCommand | RemoveFontRegistrationCommand
>;

/** 单命令结果包装（inverse 通常为单命令；merge/shape 返回多命令逆序链）。 */
function single(command: VisualCommandV4): VisualCommandV4[] {
  return [command];
}

/** 返回 inverse 命令链；校验失败返回 ApplyError。作用于 clone 后的 next 文档。 */
function applyElementCommand(doc: BentoDocV4, command: ElementCommandV4): VisualCommandV4[] | ApplyError {
  if (command.type === "createElement") {
    const result = applyCreateElement(doc, command);
    return "code" in result ? result : single(result);
  }
  const targetId = command.targetId;
  const target = findElement(doc, targetId);
  if (!target) {
    return {
      code: "TARGET_NOT_FOUND",
      message: `element ${targetId} was not found`,
      targetId,
    };
  }

  switch (command.type) {
    case "setText": {
      if (target.kind !== "text") {
        return invalidCommand(targetId, "setText requires a text target");
      }
      if (typeof command.text === "string") {
        const inverse: VisualCommandV4 = { type: "setText", targetId, text: clone(target.text) };
        target.text = textContentFromPlain(command.text, target.text);
        return single(inverse);
      }
      if (!validTextContent(command.text)) {
        return invalidCommand(targetId, "setText content must be a valid BentoTextContentV4");
      }
      const inverse: VisualCommandV4 = { type: "setText", targetId, text: clone(target.text) };
      target.text = clone(command.text);
      return single(inverse);
    }
    case "setBounds": {
      if (!boundsWithinCanvas(command.bounds, doc.canvas)) {
        return invalidCommand(targetId, "setBounds requires finite positive bounds contained by the canvas");
      }
      const inverse: VisualCommandV4 = { type: "setBounds", targetId, bounds: [...target.bounds] };
      target.bounds = [...command.bounds];
      return single(inverse);
    }
    case "setAsset": {
      // src 形态白名单：asset:<sha256hex>（内容寻址）或 media/ 相对引用（禁逃逸）。
      const src = command.src;
      const valid = ASSET_SRC.test(src) || (/^media\//.test(src) && !src.includes(".."));
      if (target.kind !== "image" || !valid) {
        return invalidCommand(
          targetId,
          'setAsset requires an image target and src of form "asset:<sha256hex>" or "media/..." (no "..")',
        );
      }
      const inverse: VisualCommandV4 = { type: "setAsset", targetId, src: target.src };
      target.src = src;
      return single(inverse);
    }
    case "setImageCrop": {
      if (target.kind !== "image") {
        return invalidCommand(targetId, "setImageCrop requires an image target");
      }
      if (command.crop !== null && !validFourEdgeCrop(command.crop)) {
        return invalidCommand(
          targetId,
          "setImageCrop crop must be finite with left+right < 1 and top+bottom < 1",
        );
      }
      const previous = target.crop;
      const inverse: VisualCommandV4 = {
        type: "setImageCrop",
        targetId,
        crop: previous ? [...previous] : null,
      };
      if (command.crop === null) delete target.crop;
      else target.crop = [...command.crop];
      return single(inverse);
    }
    case "setZOrder": {
      const oldIndex = doc.elements.findIndex((candidate) => candidate.id === targetId);
      if (!Number.isInteger(command.index) || command.index < 0 || command.index >= doc.elements.length) {
        return invalidCommand(targetId, "setZOrder index must address the elements array");
      }
      doc.elements.splice(oldIndex, 1);
      doc.elements.splice(command.index, 0, target);
      renumberZIndex(doc);
      return single({ type: "setZOrder", targetId, index: oldIndex });
    }
    case "setStyle": {
      const result = applyStylePatch(target, command.patch);
      return "code" in result ? result : single(result);
    }
    case "setRotation": {
      if (target.kind === "table" || target.kind === "chart") {
        return invalidCommand(targetId, "setRotation does not apply to table/chart elements");
      }
      if (command.rotation !== null && !Number.isFinite(command.rotation)) {
        return invalidCommand(targetId, "setRotation requires a finite number of degrees or null");
      }
      const inverse: VisualCommandV4 = { type: "setRotation", targetId, rotation: target.rotation ?? null };
      if (command.rotation === null) delete target.rotation;
      else target.rotation = command.rotation;
      return single(inverse);
    }
    case "setFlip": {
      if (target.kind === "table" || target.kind === "chart") {
        return invalidCommand(targetId, "setFlip does not apply to table/chart elements");
      }
      if (command.flip !== null && (!Array.isArray(command.flip) || command.flip.length !== 2 || command.flip.some((value) => typeof value !== "boolean"))) {
        return invalidCommand(targetId, "setFlip requires a [boolean, boolean] pair or null");
      }
      const inverse: VisualCommandV4 = { type: "setFlip", targetId, flip: target.flip ? [...target.flip] : null };
      if (command.flip === null) delete target.flip;
      else target.flip = [...command.flip];
      return single(inverse);
    }
    case "setShadow": {
      if (command.shadow !== null && !validShadow(command.shadow)) {
        return invalidCommand(targetId, "setShadow requires valid shadow layer(s) (blur >= 0, color, optional offset) or null");
      }
      const inverse: VisualCommandV4 = {
        type: "setShadow",
        targetId,
        shadow: target.shadow ? (clone(target.shadow) as typeof command.shadow) : null,
      };
      if (command.shadow === null) delete target.shadow;
      else target.shadow = clone(command.shadow);
      return single(inverse);
    }
    case "setBorder": {
      // text 无 border（common.border 行宿主面：shape/line/image/icon/table/chart）。
      if (target.kind === "text") {
        return invalidCommand(targetId, "setBorder does not apply to text elements");
      }
      if (command.border !== null && !validBorder(command.border)) {
        return invalidCommand(targetId, "setBorder requires a valid border (style/width/color) or null");
      }
      const inverse: VisualCommandV4 = {
        type: "setBorder",
        targetId,
        border: target.border ? (clone(target.border) as typeof command.border) : null,
      };
      if (command.border === null) delete target.border;
      else target.border = clone(command.border);
      return single(inverse);
    }
    case "setImageFit": {
      if (target.kind !== "image") {
        return invalidCommand(targetId, "setImageFit requires an image target");
      }
      if (!FIT_MODES.has(command.fit)) {
        return invalidCommand(targetId, "setImageFit fit must be fill, contain or cover");
      }
      const inverse: VisualCommandV4 = { type: "setImageFit", targetId, fit: target.fit ?? "contain" };
      target.fit = command.fit;
      return single(inverse);
    }
    // ---- B3 命令面补齐（host-kind = matrix 各行宿主） ----
    case "setShapeGeometry": {
      if (target.kind !== "shape") {
        return invalidCommand(targetId, "setShapeGeometry requires a shape target");
      }
      if (!validShapeGeometryInput(command)) {
        return invalidCommand(
          targetId,
          "setShapeGeometry requires static-v1 geometry: modeled name, preset-specific adjustments, custom positive viewBox + valid path, and no preset viewBox/path",
        );
      }
      // 全量替换几何三元组：present 字段写、缺省字段删除；inverse 携带旧几何（present 键即字节序）。
      const inverse: SetShapeGeometryCommand = { type: "setShapeGeometry", targetId, shapeName: target.shapeName };
      if (target.adjustments !== undefined) inverse.adjustments = [...target.adjustments];
      if (target.viewBox !== undefined) inverse.viewBox = [...target.viewBox];
      if (target.path !== undefined) inverse.path = target.path;
      target.shapeName = command.shapeName;
      if (command.adjustments !== undefined) target.adjustments = [...command.adjustments];
      else delete target.adjustments;
      if (command.viewBox !== undefined) target.viewBox = [...command.viewBox];
      else delete target.viewBox;
      if (command.path !== undefined) target.path = command.path;
      else delete target.path;
      return single(inverse);
    }
    case "setLineGeometry": {
      if (target.kind !== "line") {
        return invalidCommand(targetId, "setLineGeometry requires a line target");
      }
      if (!(Array.isArray(command.viewBox) && command.viewBox.length === 2 && command.viewBox.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0))) {
        return invalidCommand(targetId, "setLineGeometry viewBox must be a positive finite [width, height] pair");
      }
      const points = normalizePoints(command.points);
      if (points === null) {
        return invalidCommand(targetId, 'setLineGeometry points must contain >= 2 finite "x,y" coordinate pairs');
      }
      if (!pointsWithinViewBox(points, command.viewBox)) {
        return invalidCommand(targetId, "setLineGeometry points must stay inside the viewBox");
      }
      if (command.curve !== undefined && !CURVE_MODES.has(command.curve)) {
        return invalidCommand(targetId, "setLineGeometry curve must be sharp, round or smooth");
      }
      const inverse: SetLineGeometryCommand = { type: "setLineGeometry", targetId, viewBox: [...target.viewBox], points: target.points };
      // curve 全量替换：present 写、缺省删除。
      if (target.curve !== undefined) inverse.curve = target.curve;
      if (command.curve !== undefined) target.curve = command.curve;
      else delete target.curve;
      target.viewBox = [...command.viewBox];
      target.points = points;
      return single(inverse);
    }
    case "setLineArrow": {
      if (target.kind !== "line") {
        return invalidCommand(targetId, "setLineArrow requires a line target");
      }
      if (command.arrow !== null && !validArrowPair(command.arrow)) {
        return invalidCommand(targetId, "setLineArrow arrow must be a [start, end] pair of arrow/stealth/diamond/oval or null");
      }
      const inverse: SetLineArrowCommand = { type: "setLineArrow", targetId, arrow: target.arrow ? [...target.arrow] : null };
      if (command.arrow === null) delete target.arrow;
      else target.arrow = [...command.arrow];
      return single(inverse);
    }
    case "setImageCropShape": {
      if (target.kind !== "image") {
        return invalidCommand(targetId, "setImageCropShape requires an image target");
      }
      if (command.cropShape !== null && !validShapeDef(command.cropShape)) {
        return invalidCommand(
          targetId,
          "setImageCropShape requires null or static-v1 cropShape geometry: modeled name, preset-specific adjustments, custom positive viewBox + valid path, and no preset viewBox/path",
        );
      }
      const inverse: SetImageCropShapeCommand = {
        type: "setImageCropShape",
        targetId,
        cropShape: target.cropShape ? clone(target.cropShape) : null,
      };
      if (command.cropShape === null) delete target.cropShape;
      else target.cropShape = clone(command.cropShape);
      return single(inverse);
    }
    case "setIconName": {
      if (target.kind !== "icon") {
        return invalidCommand(targetId, "setIconName requires an icon target");
      }
      let iconName: string;
      try {
        iconName = resolveStaticV1IconMembership(command.iconName).iconName;
      } catch (error) {
        return invalidCommand(targetId, error instanceof Error ? error.message : "setIconName is outside static-v1");
      }
      const inverse: SetIconNameCommand = { type: "setIconName", targetId, iconName: target.iconName };
      target.iconName = iconName;
      return single(inverse);
    }
    case "setGroupId": {
      if (command.groupId !== null && (typeof command.groupId !== "string" || command.groupId.length === 0)) {
        return invalidCommand(targetId, "setGroupId requires a non-empty group label or null");
      }
      const inverse: SetGroupIdCommand = { type: "setGroupId", targetId, groupId: target.groupId ?? null };
      if (command.groupId === null) delete target.groupId;
      else target.groupId = command.groupId;
      return single(inverse);
    }
    case "setTableCellText":
    case "setTableCellStyle": {
      if (target.kind !== "table") {
        return invalidCommand(targetId, `${command.type} requires a table target`);
      }
      const table = target.table;
      const grid = expandGrid(table);
      if (!grid) {
        return invalidCommand(targetId, "table grid is structurally invalid (overlap, out-of-bounds or uncovered cell)");
      }
      const row = command.row;
      const col = command.col;
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= grid.length || col >= grid[0]!.length) {
        return invalidCommand(targetId, `${command.type} row/col must address a grid cell`);
      }
      const cell = grid[row]![col];
      if (cell === undefined) {
        return invalidCommand(targetId, `${command.type} targets a cell covered by a merge`);
      }
      if (command.type === "setTableCellText") {
        const inverse: SetTableCellTextCommand = {
          type: "setTableCellText",
          targetId,
          row,
          col,
          text: cell.text ? clone(cell.text) : null,
        };
        if (command.text === null) {
          delete cell.text;
          return single(inverse);
        }
        if (typeof command.text === "string") {
          const previous: BentoTextContentV4 = cell.text ?? { paragraphs: [] };
          cell.text = textContentFromPlain(command.text, previous);
          return single(inverse);
        }
        if (!validTextContent(command.text)) {
          return invalidCommand(targetId, "setTableCellText content must be a valid BentoTextContentV4");
        }
        cell.text = clone(command.text);
        return single(inverse);
      }
      const patch = command.patch;
      const keys = Object.keys(patch);
      if (keys.length === 0) {
        return invalidCommand(targetId, "setTableCellStyle patch requires at least one key");
      }
      for (const key of keys) {
        if (!CELL_STYLE_KEYS.has(key)) {
          return invalidCommand(targetId, `setTableCellStyle unknown patch key ${key}`);
        }
      }
      if (patch.lineHeight !== undefined && patch.lineHeight !== null) {
        if (patch.lineHeightPx !== undefined && patch.lineHeightPx !== null) {
          return invalidCommand(targetId, "setTableCellStyle lineHeight and lineHeightPx are mutually exclusive");
        }
        if (cell.lineHeightPx !== undefined) {
          return invalidCommand(targetId, "setTableCellStyle lineHeight conflicts with the cell's existing lineHeightPx");
        }
      }
      if (patch.lineHeightPx !== undefined && patch.lineHeightPx !== null && cell.lineHeight !== undefined) {
        return invalidCommand(targetId, "setTableCellStyle lineHeightPx conflicts with the cell's existing lineHeight");
      }
      for (const key of keys) {
        const value = patch[key as keyof TableCellStylePatchV4];
        if (value !== null && value !== undefined && !validCellStyleFieldValue(key, value)) {
          return invalidCommand(targetId, `setTableCellStyle ${key} has an invalid value`);
        }
      }
      const inversePatch = {} as TableCellStylePatchV4;
      for (const key of keys as Array<keyof TableCellStylePatchV4>) {
        const oldValue: unknown = cell[key];
        (inversePatch as Record<string, unknown>)[key] = oldValue === undefined ? null : clone(oldValue);
        const value = patch[key];
        if (value === null || value === undefined) {
          delete (cell as Record<string, unknown>)[key as string];
        } else {
          (cell as Record<string, unknown>)[key as string] = clone(value);
        }
      }
      const inverse: SetTableCellStyleCommand = { type: "setTableCellStyle", targetId, row, col, patch: inversePatch };
      return single(inverse);
    }
    case "setTableMerge": {
      if (target.kind !== "table") {
        return invalidCommand(targetId, "setTableMerge requires a table target");
      }
      const grid = expandGrid(target.table);
      if (!grid) {
        return invalidCommand(targetId, "table grid is structurally invalid (overlap, out-of-bounds or uncovered cell)");
      }
      const { row, col, rowSpan, colSpan } = command;
      if (!Number.isInteger(row) || !Number.isInteger(col) || !Number.isInteger(rowSpan) || !Number.isInteger(colSpan) || row < 0 || col < 0 || rowSpan < 1 || colSpan < 1) {
        return invalidCommand(targetId, "setTableMerge row/col/rowSpan/colSpan must be non-negative integers (spans >= 1)");
      }
      if (rowSpan === 1 && colSpan === 1) {
        return invalidCommand(targetId, "setTableMerge requires rowSpan or colSpan > 1");
      }
      const nRows = grid.length;
      const cols = grid[0]!.length;
      if (row + rowSpan > nRows || col + colSpan > cols) {
        return invalidCommand(targetId, "setTableMerge region must be fully inside the grid");
      }
      // 区域每格必须是未合并 anchor；无物理 cell = 被上方合并覆盖（重叠拒绝）。
      for (let rr = row; rr < row + rowSpan; rr += 1) {
        for (let cc = col; cc < col + colSpan; cc += 1) {
          const cell = grid[rr]![cc];
          if (cell === undefined) {
            return invalidCommand(targetId, `setTableMerge region overlaps a merged area at (${rr},${cc})`);
          }
          if ((cell.rowSpan ?? 1) > 1 || (cell.colSpan ?? 1) > 1) {
            return invalidCommand(targetId, `setTableMerge region contains a merged cell at (${rr},${cc})`);
          }
        }
      }
      const anchor = grid[row]![col]!;
      const destroyed: Array<{ row: number; col: number; cell: BentoTableCellV4 }> = [];
      for (let rr = row; rr < row + rowSpan; rr += 1) {
        for (let cc = col; cc < col + colSpan; cc += 1) {
          if (rr === row && cc === col) continue;
          destroyed.push({ row: rr, col: cc, cell: grid[rr]![cc]! });
        }
      }
      // 写 anchor spans（仅 >1 落字段——与 import 缺省省略形态一致），销毁被覆盖格数据。
      if (rowSpan > 1) anchor.rowSpan = rowSpan;
      else delete anchor.rowSpan;
      if (colSpan > 1) anchor.colSpan = colSpan;
      else delete anchor.colSpan;
      for (const d of destroyed) {
        grid[d.row]![d.col] = undefined;
      }
      target.table.rows = rebuildRows(grid);
      // inverse = split + 逐格重构（被销毁 cell 的 text/style 以具名命令复活）。
      const inverse: VisualCommandV4[] = [{ type: "setTableSplit", targetId, row, col }];
      for (const d of destroyed) {
        if (d.cell.text !== undefined) {
          inverse.push({ type: "setTableCellText", targetId, row: d.row, col: d.col, text: clone(d.cell.text) });
        }
        const stylePatch = {} as TableCellStylePatchV4;
        for (const key of CELL_STYLE_KEYS) {
          const value: unknown = (d.cell as Record<string, unknown>)[key];
          if (value !== undefined) {
            (stylePatch as Record<string, unknown>)[key] = clone(value);
          }
        }
        if (Object.keys(stylePatch).length > 0) {
          inverse.push({ type: "setTableCellStyle", targetId, row: d.row, col: d.col, patch: stylePatch });
        }
      }
      return inverse;
    }
    case "setTableSplit": {
      if (target.kind !== "table") {
        return invalidCommand(targetId, "setTableSplit requires a table target");
      }
      const grid = expandGrid(target.table);
      if (!grid) {
        return invalidCommand(targetId, "table grid is structurally invalid (overlap, out-of-bounds or uncovered cell)");
      }
      const { row, col } = command;
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= grid.length || col >= grid[0]!.length) {
        return invalidCommand(targetId, "setTableSplit row/col must address a grid cell");
      }
      const anchor = grid[row]![col];
      if (anchor === undefined) {
        return invalidCommand(targetId, "setTableSplit targets a cell covered by a merge");
      }
      const rs = anchor.rowSpan ?? 1;
      const cs = anchor.colSpan ?? 1;
      if (rs === 1 && cs === 1) {
        return invalidCommand(targetId, "setTableSplit requires a merged anchor cell");
      }
      // 复位 anchor 为 1x1，并复活被覆盖位为占位空格。
      delete anchor.rowSpan;
      delete anchor.colSpan;
      for (let rr = row; rr < row + rs; rr += 1) {
        for (let cc = col; cc < col + cs; cc += 1) {
          if (rr === row && cc === col) continue;
          if (grid[rr]![cc] === undefined) grid[rr]![cc] = {};
        }
      }
      target.table.rows = rebuildRows(grid);
      const inverse: VisualCommandV4 = { type: "setTableMerge", targetId, row, col, rowSpan: rs, colSpan: cs };
      return single(inverse);
    }
    case "setTableShape": {
      if (target.kind !== "table") {
        return invalidCommand(targetId, "setTableShape requires a table target");
      }
      const table = target.table;
      const currentRows = table.rows.length;
      const currentCols = table.columnWidths.length;
      if (!Number.isInteger(command.rows) || !Number.isInteger(command.cols) || command.rows < 1 || command.cols < 1) {
        return invalidCommand(targetId, "setTableShape rows/cols must be positive integers");
      }
      const oldColumnWidths = [...table.columnWidths];
      const oldRowHeights = [...table.rowHeights];
      if (command.rows >= currentRows && command.cols >= currentCols) {
        // grow：新增列按物理行尾追加空 cell（新列不被既有 merge 覆盖），新增行整行空 cell。
        for (const rowArr of table.rows) {
          for (let i = 0; i < command.cols - currentCols; i += 1) rowArr.push({});
        }
        for (let r = 0; r < command.rows - currentRows; r += 1) {
          table.rows.push(Array.from({ length: command.cols }, (): BentoTableCellV4 => ({})));
        }
      } else {
        // shrink：仅允许切除纯空 cell（grow 的对称逆——grow 的 inverse 必须是可表达的
        // shrink，否则字节往返不变量断裂）；任何含数据/被合并覆盖的切除都拒绝（防数据销毁）。
        const grid = expandGrid(table);
        if (!grid) {
          return invalidCommand(targetId, "table grid is structurally invalid (overlap, out-of-bounds or uncovered cell)");
        }
        const removeCols = command.cols < currentCols;
        const removeRows = command.rows < currentRows;
        if (removeCols) {
          for (let cc = command.cols; cc < currentCols; cc += 1) {
            for (let rr = 0; rr < currentRows; rr += 1) {
              const cell = grid[rr]![cc];
              if (cell === undefined || Object.keys(cell).length > 0) {
                return invalidCommand(targetId, "setTableShape may only shrink over data-less cells (destroying cell data is rejected)");
              }
            }
          }
        }
        if (removeRows) {
          for (let rr = command.rows; rr < currentRows; rr += 1) {
            for (let cc = 0; cc < currentCols; cc += 1) {
              const cell = grid[rr]![cc];
              if (cell === undefined || Object.keys(cell).length > 0) {
                return invalidCommand(targetId, "setTableShape may only shrink over data-less cells (destroying cell data is rejected)");
              }
            }
          }
        }
        // 重建成目标尺寸格网：保留既有 cell，被切除位丢弃、被合并覆盖位保持省略。
        const next: (BentoTableCellV4 | undefined)[][] = [];
        for (let rr = 0; rr < command.rows; rr += 1) {
          const row: (BentoTableCellV4 | undefined)[] = [];
          for (let cc = 0; cc < command.cols; cc += 1) {
            const cell = grid[rr]?.[cc];
            if (cell !== undefined) row.push(cell);
          }
          next.push(row);
        }
        table.rows = rebuildRows(next);
      }
      // 比例同步裁剪/补齐（保留既有相对比例；随 inverse 的 setTableGrid 精确还原）。
      table.columnWidths = redistributeLayout(oldColumnWidths, currentCols, command.cols);
      table.rowHeights = redistributeLayout(oldRowHeights, currentRows, command.rows);
      const inverse: VisualCommandV4[] = [
        { type: "setTableShape", targetId, rows: currentRows, cols: currentCols },
        { type: "setTableGrid", targetId, columnWidths: oldColumnWidths, rowHeights: oldRowHeights },
      ];
      return inverse;
    }
    case "setTableGrid": {
      if (target.kind !== "table") {
        return invalidCommand(targetId, "setTableGrid requires a table target");
      }
      const table = target.table;
      const { columnWidths, rowHeights } = command;
      if (columnWidths === undefined && rowHeights === undefined) {
        return invalidCommand(targetId, "setTableGrid requires at least one of columnWidths/rowHeights");
      }
      const currentRows = table.rows.length;
      const currentCols = table.columnWidths.length;
      if (columnWidths !== undefined && !validRatioLayout(columnWidths, currentCols)) {
        return invalidCommand(targetId, `setTableGrid columnWidths must have ${currentCols} values in [0,1] summing to ~1`);
      }
      if (rowHeights !== undefined && !validRatioLayout(rowHeights, currentRows)) {
        return invalidCommand(targetId, `setTableGrid rowHeights must have ${currentRows} values in [0,1] summing to ~1`);
      }
      const inverse: SetTableGridCommand = { type: "setTableGrid", targetId };
      if (columnWidths !== undefined) {
        inverse.columnWidths = [...table.columnWidths];
        table.columnWidths = [...columnWidths];
      }
      if (rowHeights !== undefined) {
        inverse.rowHeights = [...table.rowHeights];
        table.rowHeights = [...rowHeights];
      }
      return single(inverse);
    }
    case "setTableStyle": {
      if (target.kind !== "table") {
        return invalidCommand(targetId, "setTableStyle requires a table target");
      }
      const table = target.table;
      if (command.style !== null && !validTableStyle(command.style)) {
        return invalidCommand(targetId, "setTableStyle requires a valid BentoTableStyleV4 (slots, border/fill value domains) or null");
      }
      const inverse: SetTableStyleCommand = { type: "setTableStyle", targetId, style: table.style ? clone(table.style) : null };
      if (command.style === null) delete table.style;
      else table.style = clone(command.style);
      return single(inverse);
    }
    case "setChartData": {
      if (target.kind !== "chart") {
        return invalidCommand(targetId, "setChartData requires a chart target");
      }
      if (!validChartData(command.data)) {
        return invalidCommand(targetId, "setChartData requires unique non-empty cols and rows matching the header with number|string|null cells");
      }
      const inverse: SetChartDataCommand = { type: "setChartData", targetId, data: clone(target.chart.data) };
      target.chart.data = clone(command.data);
      return single(inverse);
    }
    case "setChartSeries": {
      if (target.kind !== "chart") {
        return invalidCommand(targetId, "setChartSeries requires a chart target");
      }
      const seriesList = target.chart.series;
      // 寻址 0..length：index == length = 追加（inverse 表达路径——命令面无 insert，
      // 删除的 undo 必须可追加回尾部）；删除限尾部（中间删除无法字节级 undo，具名拒绝）。
      if (!Number.isInteger(command.index) || command.index < 0 || command.index > seriesList.length) {
        return invalidCommand(targetId, "setChartSeries index must address 0..series.length");
      }
      if (command.series === null) {
        if (command.index !== seriesList.length - 1) {
          return invalidCommand(targetId, "setChartSeries delete is only reversible for the trailing series (the command surface has no insert command, so a middle-delete undo could not restore byte equality)");
        }
        if (seriesList.length <= 1) {
          return invalidCommand(targetId, "setChartSeries cannot delete the last remaining series");
        }
        const removed = seriesList.splice(command.index, 1)[0]!;
        const inverse: SetChartSeriesCommand = { type: "setChartSeries", targetId, index: command.index, series: clone(removed) };
        return single(inverse);
      }
      if (!validChartSeries(command.series)) {
        return invalidCommand(targetId, "setChartSeries requires a known series type with its required encode keys");
      }
      const replaced = command.index < seriesList.length ? seriesList[command.index] : undefined;
      const inverse: SetChartSeriesCommand = {
        type: "setChartSeries",
        targetId,
        index: command.index,
        series: replaced !== undefined ? clone(replaced) : null,
      };
      if (command.index === seriesList.length) seriesList.push(clone(command.series));
      else seriesList[command.index] = clone(command.series);
      return single(inverse);
    }
    case "setChartOption": {
      if (target.kind !== "chart") {
        return invalidCommand(targetId, "setChartOption requires a chart target");
      }
      const option = command.option;
      const keys = Object.keys(option);
      if (keys.length === 0) {
        return invalidCommand(targetId, "setChartOption requires at least one option key");
      }
      for (const key of keys) {
        if (!CHART_OPTION_KEYS.has(key) || !validChartOptionValue(key, option[key as keyof ChartOptionPatchV4])) {
          return invalidCommand(targetId, `setChartOption key ${key} has an invalid value`);
        }
      }
      const inverseOption = {} as ChartOptionPatchV4;
      for (const key of keys) {
        const oldValue: unknown = target.chart[key as keyof ChartOptionPatchV4];
        (inverseOption as Record<string, unknown>)[key] = oldValue === undefined ? null : clone(oldValue);
      }
      for (const key of keys) {
        const value = option[key as keyof ChartOptionPatchV4];
        if (value === null || value === undefined) {
          delete (target.chart as unknown as Record<string, unknown>)[key];
        } else {
          (target.chart as unknown as Record<string, unknown>)[key] = clone(value);
        }
      }
      const inverse: SetChartOptionCommand = { type: "setChartOption", targetId, option: inverseOption };
      return single(inverse);
    }
    case "setChartPalette": {
      if (target.kind !== "chart") {
        return invalidCommand(targetId, "setChartPalette requires a chart target");
      }
      if (command.palette !== null && (!Array.isArray(command.palette) || command.palette.length === 0 || !command.palette.every(isColor))) {
        return invalidCommand(targetId, "setChartPalette requires a non-empty array of colors or null");
      }
      const inverse: SetChartPaletteCommand = { type: "setChartPalette", targetId, palette: target.chart.palette ? [...target.chart.palette] : null };
      if (command.palette === null) delete target.chart.palette;
      else target.chart.palette = [...command.palette];
      return single(inverse);
    }
    case "deleteElement": {
      const index = doc.elements.findIndex((candidate) => candidate.id === targetId);
      doc.elements.splice(index, 1);
      renumberZIndex(doc);
      // createElement intentionally appends, so deletion's inverse must carry
      // the old array position as a second public command.  Without this,
      // undoing a delete after a prior setZOrder restores the element at the
      // end; the next setZOrder inverse becomes a semantic no-op and stalls
      // the remaining undo history.
      return [
        { type: "createElement", element: clone(target) },
        { type: "setZOrder", targetId, index },
      ];
    }
    default: {
      // 穷尽性守卫：命令面新增变体时在此编译失败，强制补 case + inverse。
      const _exhaustive: never = command;
      return invalidCommand(targetId, `unsupported command ${String((_exhaustive as { type?: string }).type)}`);
    }
  }
}

/**
 * createElement 校验 + 追加。canonical 纪律：image fit 一律显式（import 显式写、
 * 不依赖默认值分歧）——入参缺 fit 时归一化为 "contain"，保证 setImageFit 的
 * inverse 永远携带具体旧值。zIndex 不取入参值：追加到末尾并重编号 0..n-1。
 */
function applyCreateElement(doc: BentoDocV4, command: Extract<VisualCommandV4, { type: "createElement" }>): VisualCommandV4 | ApplyError {
  const element = command.element;
  if (element === null || typeof element !== "object" || Array.isArray(element)) {
    return invalidCommand(undefined, "createElement requires a complete element object");
  }
  if (!element.id || typeof element.id !== "string") {
    return invalidCommand(element.id, "createElement requires a non-empty string id");
  }
  if (findElement(doc, element.id)) {
    return invalidCommand(element.id, `createElement id ${element.id} already exists`);
  }
  if (!BENTO_ELEMENT_KINDS_V4.includes(element.kind)) {
    return invalidCommand(element.id, `createElement kind ${String(element.kind)} is out of the v4 vocabulary`);
  }
  if (!boundsWithinCanvas(element.bounds, doc.canvas)) {
    return invalidCommand(element.id, "createElement requires finite positive bounds contained by the canvas");
  }
  if (!validElementPayload(element, doc.canvas)) {
    return invalidCommand(element.id, "createElement nested fields are outside the validated v4 domains");
  }
  if (element.kind === "image" && element.fit === undefined) element.fit = "contain";
  if (element.kind === "icon") {
    try {
      element.iconName = resolveStaticV1IconMembership(element.iconName).iconName;
    } catch (error) {
      return invalidCommand(element.id, error instanceof Error ? error.message : "createElement iconName is outside static-v1");
    }
  }
  doc.elements.push(element);
  renumberZIndex(doc);
  return { type: "deleteElement", targetId: element.id };
}

/** 文档级命令（canvas.* + font.registration 行）：无 targetId；其余走元素级。 */
function applyCommand(doc: BentoDocV4, command: VisualCommandV4): VisualCommandV4[] | ApplyError {
  if (command.type === "setCanvasSize") {
    const { width, height } = command;
    if (![width, height].every((value) => Number.isInteger(value) && Number.isFinite(value) && value > 0)) {
      return invalidCommand(undefined, "setCanvasSize requires a positive finite integer pair");
    }
    const canvas = { width, height };
    if (doc.elements.some((element) => !boundsWithinCanvas(element.bounds, canvas))) {
      return invalidCommand(undefined, "setCanvasSize would leave an element outside the canvas");
    }
    const inverse: VisualCommandV4 = { type: "setCanvasSize", width: doc.canvas.width, height: doc.canvas.height };
    doc.canvas = { width, height };
    return single(inverse);
  }
  if (command.type === "setBackground") {
    if (!validFill(command.background)) {
      return invalidCommand(undefined, "setBackground requires a valid BentoFillV4 (image fill src must be asset:<sha256>)");
    }
    const inverse: VisualCommandV4 = { type: "setBackground", background: clone(doc.background) };
    doc.background = clone(command.background);
    return single(inverse);
  }
  // font.registration 行（文档级）：identity = family+weight+style；add 拒绝重复、remove 无匹配拒绝。
  if (command.type === "addFontRegistration") {
    const font = command.font;
    if (font === null || typeof font !== "object" || Array.isArray(font)) {
      return invalidCommand(undefined, "addFontRegistration requires a font registration object");
    }
    const familyError = staticV1FontRegistrationFamilyError(font.family);
    if (familyError !== null) {
      return invalidCommand(undefined, `PPTD-E013: addFontRegistration ${familyError}`);
    }
    if (typeof font.src !== "string" || !ASSET_SRC.test(font.src)) {
      return invalidCommand(undefined, "addFontRegistration src must be an asset:<sha256> content address");
    }
    const descriptor = fontDescriptorError(font);
    if (descriptor !== null) {
      return invalidCommand(undefined, `PPTD-E013: addFontRegistration ${descriptor.name} ${descriptor.error}`);
    }
    if ((doc.fonts ?? []).some((f) => sameFontIdentity(f, font))) {
      return invalidCommand(undefined, `addFontRegistration identity already registered: ${font.family}`);
    }
    (doc.fonts ??= []).push(clone(font));
    const inverse: RemoveFontRegistrationCommand = {
      type: "removeFontRegistration",
      family: font.family,
      ...(font.weight !== undefined ? { weight: font.weight } : {}),
      ...(font.style !== undefined ? { style: font.style } : {}),
    };
    return single(inverse);
  }
  if (command.type === "removeFontRegistration") {
    const familyError = staticV1FontRegistrationFamilyError(command.family);
    if (familyError !== null) {
      return invalidCommand(undefined, `PPTD-E013: removeFontRegistration ${familyError}`);
    }
    const descriptor = fontDescriptorError(command);
    if (descriptor !== null) {
      return invalidCommand(undefined, `PPTD-E013: removeFontRegistration ${descriptor.name} ${descriptor.error}`);
    }
    const fontIdentity = (f: BentoFontRegistrationV4): RemoveFontRegistrationCommand => ({
      type: "removeFontRegistration",
      family: f.family,
      ...(f.weight !== undefined ? { weight: f.weight } : {}),
      ...(f.style !== undefined ? { style: f.style } : {}),
    });
    const fonts = doc.fonts ?? [];
    const index = fonts.findIndex((f) => sameFontIdentity(f, command));
    if (index < 0) {
      return invalidCommand(undefined, `removeFontRegistration found no registration matching ${command.family}`);
    }
    const removed = fonts.splice(index, 1)[0]!;
    const suffix = fonts.slice(index);
    if (fonts.length === 0) delete doc.fonts;
    // inverse：中间删除恢复字节序——先逆序移除后缀（各自命中尾部 identity），再重放
    // removed（append 至原 index），再按序重放后缀。
    const inverse: VisualCommandV4[] = [];
    for (let i = suffix.length - 1; i >= 0; i -= 1) {
      inverse.push(fontIdentity(suffix[i]!));
    }
    inverse.push({ type: "addFontRegistration", font: clone(removed) });
    for (const font of suffix) {
      inverse.push({ type: "addFontRegistration", font: clone(font) });
    }
    return inverse;
  }
  return applyElementCommand(doc, command);
}

/**
 * #47（docs/local-demo-saas-plan.md §2 P1 ruling）：regenerate 候选的文本级
 * added/replaced/deleted 清单。按稳定 ElementId 对齐：仅 candidate = added；
 * 同 id + 语义差异 = replaced；仅 base = deleted。
 *
 * 语义差异 = canonicalJson(元素去掉 zIndex)：数组序即 z-order 的唯一真相，
 * zIndex 只是它的物化投影（派生态，§3.1）——纯重排不入 replaced，否则中部
 * 插入会把后续所有元素误报为替换。视觉 diff 出 P1 范围。
 */
export type DocumentDiffEntry = {
  id: ElementId;
  type: BentoElementV4["kind"];
  /** text 元素的纯文本预览（与 inspect() 同一 textPreview helper）。 */
  text?: string;
};

export type DocumentDiff = {
  added: DocumentDiffEntry[];
  replaced: DocumentDiffEntry[];
  deleted: DocumentDiffEntry[];
};

/** text 元素的纯文本预览——inspect() 与 diffDocuments 共用的唯一投影。 */
const textPreview = (element: BentoElementV4): string | undefined =>
  element.kind === "text"
    ? element.text.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join("\n")
    : undefined;

const diffEntry = (element: BentoElementV4): DocumentDiffEntry => {
  const text = textPreview(element);
  return { id: element.id, type: element.kind, ...(text !== undefined ? { text } : {}) };
};

const semanticJson = (element: BentoElementV4): string => {
  const { zIndex: _zIndex, ...rest } = element;
  return canonicalJson(rest);
};

export function diffDocuments(base: BentoDocV4, candidate: BentoDocV4): DocumentDiff {
  const baseById = new Map(base.elements.map((element) => [element.id, element]));
  const candidateIds = new Set(candidate.elements.map((element) => element.id));
  const diff: DocumentDiff = { added: [], replaced: [], deleted: [] };
  for (const element of candidate.elements) {
    const before = baseById.get(element.id);
    if (before === undefined) diff.added.push(diffEntry(element));
    else if (semanticJson(before) !== semanticJson(element)) diff.replaced.push(diffEntry(element));
  }
  for (const element of base.elements) {
    if (!candidateIds.has(element.id)) diff.deleted.push(diffEntry(element));
  }
  return diff;
}

export function createVisualDocumentKernel(initial: BentoDocV4): VisualDocumentKernelV4 {
  let doc = clone(initial);
  let revision = 0;
  type HistoryEntry = { forward: CommandBatchV4; inverse: CommandBatchV4 };
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];

  // canonicalJson(doc) 只在 execute 提交点变化；缓存同一 revision 的快照，
  // 避免 execute 的 no-op 检测与 snapshot() 重复序列化同一文档。
  let docSnapshot: VisualDocumentSnapshot | null = null;
  const currentSnapshot = (): VisualDocumentSnapshot =>
    (docSnapshot ??= canonicalJson(doc) as VisualDocumentSnapshot);

  type ExecuteResult = ApplyResultV4 | (Extract<ApplyResultV4, { ok: true }> & { noOp: true });

  const execute = (batch: CommandBatchV4): ExecuteResult => {
    if (!batch.batchId || !batch.actor || batch.commands.length === 0) {
      return failure(revision, {
        code: "INVALID_BATCH",
        message: "batchId, actor and at least one command are required",
      });
    }
    if (batch.baseRevision !== revision) {
      return failure(revision, {
        code: "STALE_BASE_REVISION",
        message: `base revision ${batch.baseRevision} does not match current revision ${revision}`,
      });
    }

    const previousSnapshot = currentSnapshot();
    const next = clone(doc);
    const inverse: VisualCommandV4[] = [];
    const changed = new Set<ElementId>();
    const chartCandidates = new Set<ElementId>();

    for (const [commandIndex, command] of batch.commands.entries()) {
      const inverseCommands = applyCommand(next, command);
      if ("code" in inverseCommands) {
        return failure(revision, {
          ...inverseCommands,
          commandIndex,
          commandType: command.type,
          targetId: affectedIdOf(command),
        });
      }
      inverse.unshift(...inverseCommands);
      const affected = affectedIdOf(command);
      if (affected !== undefined) changed.add(affected);
      if (affected !== undefined && next.elements.some((element) => element.id === affected && element.kind === "chart")) {
        chartCandidates.add(affected);
      }
      if (command.type === "createElement" && command.element.kind === "chart") chartCandidates.add(command.element.id);
      const fontError = fontInvariantError(next);
      if (fontError !== null) {
        return failure(revision, {
          code: "INVALID_COMMAND",
          message: fontError,
          commandIndex,
          commandType: command.type,
          targetId: affected,
        });
      }
    }

    // Chart commands can be intentionally invalid between two commands in a
    // composite (for example, a column rename emits setChartData followed by
    // setChartSeries).  Validate the complete candidate only after the whole
    // clone has been assembled; a failed final projection therefore commits
    // neither the intermediate nor the final state.
    const chartError = bentoDocChartRenderInvariantError(next, chartCandidates);
    if (chartError !== null) {
      return failure(revision, {
        code: "INVALID_COMMAND",
        message: chartError,
        commandIndex: batch.commands.length - 1,
        commandType: batch.commands[batch.commands.length - 1]!.type,
        targetId: affectedIdOf(batch.commands[batch.commands.length - 1]!),
      });
    }

    doc = next;
    const snapshot = canonicalJson(doc) as VisualDocumentSnapshot;
    docSnapshot = snapshot;
    if (snapshot === previousSnapshot) {
      return {
        ok: true,
        noOp: true,
        revision,
        snapshot,
        inverseBatch: {
          batchId: `${batch.batchId}:inverse`,
          actor: batch.actor,
          baseRevision: revision,
          commands: [],
        },
        changedElementIds: [],
      };
    }
    revision += 1;
    return {
      ok: true,
      revision,
      snapshot,
      inverseBatch: {
        batchId: `${batch.batchId}:inverse`,
        actor: batch.actor,
        baseRevision: revision,
        commands: inverse,
      },
      changedElementIds: [...changed],
    };
  };

  return {
    get revision() {
      return revision;
    },

    apply(batch: CommandBatchV4): ApplyResultV4 {
      const forward = clone(batch);
      const result = execute(forward);
      if (result.ok && !("noOp" in result && result.noOp)) {
        undoStack.push({ forward, inverse: result.inverseBatch });
        redoStack.length = 0;
      }
      return result;
    },

    undo(): ApplyResultV4 {
      const entry = undoStack.pop();
      if (!entry) return failure(revision, { code: "INVALID_BATCH", message: "nothing to undo" });
      const result = execute({ ...entry.inverse, baseRevision: revision });
      if (result.ok && !("noOp" in result && result.noOp)) redoStack.push(entry);
      else undoStack.push(entry);
      return result;
    },

    redo(): ApplyResultV4 {
      const entry = redoStack.pop();
      if (!entry) return failure(revision, { code: "INVALID_BATCH", message: "nothing to redo" });
      const result = execute({ ...entry.forward, baseRevision: revision });
      if (result.ok && !("noOp" in result && result.noOp)) undoStack.push(entry);
      else redoStack.push(entry);
      return result;
    },

    inspect(): VisualTreeV4 {
      const elements: VisualElementV4[] = doc.elements.map((element, zIndex) => {
        const [x, y, width, height] = element.bounds;
        const style: VisualStylePatchV4 = {};
        if (element.opacity !== undefined) style.opacity = element.opacity;
        if (element.kind === "text" && element.text.color !== undefined) style.color = element.text.color;
        const text = textPreview(element);
        return {
          id: element.id,
          type: element.kind,
          bounds: { x, y, width, height },
          zIndex,
          ...(text !== undefined ? { text } : {}),
          ...(element.kind === "image" ? { assetRef: element.src } : {}),
          ...(element.kind === "image" && element.crop !== undefined ? { crop: [...element.crop] } : {}),
          ...(element.rotation !== undefined ? { rotation: element.rotation } : {}),
          ...(element.flip !== undefined ? { flip: [...element.flip] } : {}),
          ...(Object.keys(style).length === 0 ? {} : { style }),
        };
      });
      return { width: doc.canvas.width, height: doc.canvas.height, elements };
    },

    snapshot(): VisualDocumentSnapshot {
      return currentSnapshot();
    },
  };
}

// #40 结构化编辑三路对账（自 editor-bento/src/ui/dom 上移——纯域函数，
// 服务端（orchestration commitEditCandidate）与编辑器面板共用，不应住在 UI 包）。
export {
  reconcileStructuredEdit,
  semanticEqual,
  type StructuredEditDecision,
  type StructuredEditIntent,
} from "./structured-edit.ts";
