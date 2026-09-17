/**
 * C2-A edit surface — chart family 纯映射（GD-4c Wave C2 ticket #12）。
 *
 * Node-safe：UI state → 精确 VisualCommandV4。
 * - setChartData：数据表整写（cols 唯一非空、rows 与表头同长——kernel 校验）；
 * - setChartSeries：替换/追加（index === length）/删尾（null）——与 kernel
 *   可逆性约束一致（中间删、末 series 删具名拒绝，不静默近似）；
 * - retypeSeries：完整 13 型词表的 typeMixing 面，保留可迁移的 name/axes
 *   并按新型重建所需 encode；型专属字段不会被错误地静默折叠；
 * - setChartOption：选项补丁（title/legend/dataLabels/xAxis/yAxis/spokeAxis/
 *   barWidth/barGap/categoryGap/fontFamily/fill；null 删除）；
 * - setChartPalette：颜色循环数组或 null 清除。
 */
import type {
  BentoChartDataV4,
  BentoChartV4,
  BentoChartSeriesV4,
  BentoColor,
  BentoFillV4,
  ChartOptionPatchV4,
  VisualCommandV4,
} from "contracts";
import { bentoChartCommandBatchError, CHART_ENCODE_OPTIONAL, CHART_ENCODE_REQUIRED, CHART_SERIES_TYPES } from "contracts";

/**
 * chart.typeMixing 的完整 13 型词表。这个常量同时被纯映射和 DOM 选择器
 * 消费，避免 UI 只承认最初四个 cartesian 型而把其余 Active 行变成假支持。
 * 单一来源 = contracts/chart-invariants.ts。
 */
export const chartSeriesTypes = CHART_SERIES_TYPES;
export type ChartSeriesType = (typeof chartSeriesTypes)[number];

/** 每型 encode 通道顺序；必需通道先列，可选通道（open/parent/isTotal）随后。 */
const encodeKeys = {} as Record<ChartSeriesType, readonly string[]>;
for (const type of CHART_SERIES_TYPES) {
  encodeKeys[type] = [...(CHART_ENCODE_REQUIRED[type] ?? []), ...(CHART_ENCODE_OPTIONAL[type] ?? [])];
}
export const chartSeriesEncodeKeys: Readonly<Record<ChartSeriesType, readonly string[]>> = encodeKeys;

/** cartesian 共享 {x,y} encode 的系列族（现有 retype 快捷路径）。 */
export const cartesianSeriesTypes = ["bar", "line", "area", "scatter"] as const;

/** Lossless chart.data cell editor vocabulary.  The DOM grid uses this
 * parser for terminal drafts; the command builder below remains the shared
 * structural/finite-value gate before a setChartData command is emitted. */
export type ChartDataCellKind = "number" | "string" | "null";
const CHART_DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseChartDataCell(kind: ChartDataCellKind, raw: string): number | string | null | undefined {
  if (kind === "null") return null;
  if (kind === "string") return raw;
  const value = raw.trim();
  if (value.length === 0 || !CHART_DECIMAL_NUMBER.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function isChartDataCell(value: unknown): value is number | string | null {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

/** 数据表整写 → setChartData。 */
export function chartDataCommands(id: string, data: BentoChartDataV4): VisualCommandV4[] {
  return [{ type: "setChartData", targetId: id, data }];
}

/**
 * Data Apply composite: a column rename is also an encode migration.  A
 * referenced column may not be deleted; returning null leaves the editor state
 * uncommitted rather than emitting a chart that only fails during projection.
 */
export function chartDataWithSeriesCommands(
  id: string,
  before: BentoChartDataV4,
  next: BentoChartDataV4,
  series: readonly BentoChartSeriesV4[],
): VisualCommandV4[] | null {
  if (!Array.isArray(next.cols) || next.cols.length === 0 ||
      next.cols.some((col) => typeof col !== "string" || col.trim().length === 0) ||
      new Set(next.cols).size !== next.cols.length || !Array.isArray(next.rows) ||
      next.rows.some((row) => !Array.isArray(row) || row.length !== next.cols.length) ||
      next.rows.some((row) => row.some((cell) => !isChartDataCell(cell)))) return null;
  const renamedSeries = structuredClone(series);
  for (const item of renamedSeries) {
    const encode = item.encode as Record<string, unknown>;
    for (const [key, raw] of Object.entries(encode)) {
      if (typeof raw !== "string") return null;
      if (next.cols.includes(raw)) continue;
      const oldIndex = before.cols.indexOf(raw);
      // Same-width replacement is an intentional rename by position.  A
      // shorter table is a deletion: even optional channels fail closed.
      if (before.cols.length !== next.cols.length || oldIndex < 0 || next.cols[oldIndex] === undefined) return null;
      encode[key] = next.cols[oldIndex];
    }
  }
  const commands: VisualCommandV4[] = chartDataCommands(id, next);
  renamedSeries.forEach((item, index) => {
    if (JSON.stringify(item) !== JSON.stringify(series[index])) commands.push(...chartSeriesCommands(id, index, item));
  });
  return commands;
}

/**
 * 数据单元格编辑（纯函数）：返回 edits 后新数据，不改入参。cell 值词表
 * number | string | null（validator/kernel 同面）。越界具名拒绝。
 */
export function setDataCell(
  data: BentoChartDataV4,
  row: number,
  col: number,
  value: number | string | null,
): BentoChartDataV4 {
  if (!Number.isInteger(row) || row < 0 || row >= data.rows.length) throw new Error(`chart: 数据行越界（${row}）`);
  if (!Number.isInteger(col) || col < 0 || col >= data.cols.length) throw new Error(`chart: 数据列越界（${col}）`);
  const next = structuredClone(data);
  next.rows[row]![col] = value;
  return next;
}

/** series 整写（替换/追加/删尾；kernel 可逆性约束兜底）。 */
export function chartSeriesCommands(
  id: string,
  index: number,
  series: BentoChartSeriesV4 | null,
): VisualCommandV4[] {
  return [{ type: "setChartSeries", targetId: id, index, series }];
}

const RETYPE_FIELDS: Readonly<Record<ChartSeriesType, readonly string[]>> = {
  bar: ["type", "encode", "name", "xAxisIndex", "yAxisIndex", "stack", "symbol", "fill", "border", "dataLabels"],
  line: ["type", "encode", "name", "xAxisIndex", "yAxisIndex", "smooth", "lineStyle", "width", "marker", "nullHandling", "lineColor", "dataLabels"],
  area: ["type", "encode", "name", "xAxisIndex", "yAxisIndex", "smooth", "lineStyle", "width", "marker", "nullHandling", "lineColor", "stack", "areaColor", "dataLabels"],
  scatter: ["type", "encode", "name", "xAxisIndex", "yAxisIndex", "dataFilter", "marker", "fill", "border", "dataLabels"],
  bubble: ["type", "encode", "name", "xAxisIndex", "yAxisIndex", "dataFilter", "sizeScale", "sizeRange", "fill", "border", "dataLabels"],
  candlestick: ["type", "encode", "name", "xAxisIndex", "yAxisIndex", "upBars", "downBars", "wickStyle"],
  pie: ["type", "encode", "name", "xAxisIndex", "yAxisIndex", "innerRadius", "startAngle", "fill", "border", "dataLabels"],
  radar: ["type", "encode", "name", "xAxisIndex", "yAxisIndex", "smooth", "lineStyle", "width", "marker", "nullHandling", "lineColor", "areaColor", "dataLabels"],
  waterfall: ["type", "encode", "name", "xAxisIndex", "yAxisIndex", "totalBars", "increaseBars", "decreaseBars", "dataLabels"],
  heatmap: ["type", "encode", "name", "xAxisIndex", "yAxisIndex", "colorScheme", "colorScale", "colorbar", "dataLabels"],
  treemap: ["type", "encode", "name", "xAxisIndex", "yAxisIndex", "levels", "fill", "border", "dataLabels"],
  sunburst: ["type", "encode", "name", "xAxisIndex", "yAxisIndex", "levels", "fill", "border", "dataLabels"],
  sankey: ["type", "encode", "name", "xAxisIndex", "yAxisIndex", "nodeAlign", "fill", "border", "dataLabels"],
};

const RETYPE_ENCODE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // Only category/value-compatible slots may be translated.  Endpoint roles
  // and OHLC roles are intentionally not guessed: a type switch must not
  // manufacture three candlestick channels from one generic y column.
  x: ["x", "category"],
  y: ["y", "value"],
  size: ["size"],
  category: ["category", "x"],
  value: ["value", "y"],
  source: ["source"],
  target: ["target"],
  flow: ["flow"],
  high: ["high"],
  low: ["low"],
  close: ["close"],
  open: ["open"],
  parent: ["parent"],
  isTotal: ["isTotal"],
};

// A type switch from the DOM receives the chart's real column vocabulary.  If
// a required channel has no semantically equivalent source channel, use an
// explicitly named column already present in that table (never invent a
// placeholder or guess from position).  The no-columns unit seam remains
// fail-closed, preserving the stronger generic helper contract.
const RETYPE_COLUMN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  x: ["x", "category", "q", "label"],
  y: ["y", "value", "v"],
  size: ["size"],
  category: ["category", "x", "q", "label"],
  value: ["value", "y", "v"],
  source: ["source"],
  target: ["target"],
  flow: ["flow"],
  high: ["high"],
  low: ["low"],
  close: ["close"],
  open: ["open"],
  parent: ["parent"],
  isTotal: ["isTotal"],
};

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Complete type switch with a strict lossless boundary. Required encodes must
 * already exist (or map to an existing semantic channel/column); no
 * placeholder column is invented. Any authored field without a semantically
 * equivalent slot in the target type rejects the retype, so a type gesture
 * cannot silently discard canonical data or styles.
 */
export function retypeSeries(
  series: BentoChartSeriesV4,
  type: ChartSeriesType,
  columns: readonly string[] = [],
): BentoChartSeriesV4 | null {
  const source = series as unknown as Record<string, unknown>;
  const sourceEncode = source.encode;
  if (sourceEncode === null || typeof sourceEncode !== "object" || Array.isArray(sourceEncode)) return null;
  const sourceChannels = sourceEncode as Record<string, unknown>;
  const sourceEncodeKeys = chartSeriesEncodeKeys[series.type];
  const targetEncodeKeys = chartSeriesEncodeKeys[type];
  if (sourceEncodeKeys === undefined || targetEncodeKeys === undefined || RETYPE_FIELDS[type] === undefined) return null;
  if (Object.entries(sourceChannels).some(([key, value]) => !sourceEncodeKeys.includes(key) || typeof value !== "string" || value.length === 0)) return null;
  const targetFields = new Set(RETYPE_FIELDS[type]);
  const consumedSourceFields = new Set(["type", "encode", "name", "xAxisIndex", "yAxisIndex"]);
  const out: Record<string, unknown> = { type };
  for (const key of ["name", "xAxisIndex", "yAxisIndex"] as const) {
    if (source[key] !== undefined) out[key] = structuredClone(source[key]);
  }
  const targetEncode: Record<string, string> = {};
  for (const key of targetEncodeKeys) {
    const optional = key === "open" || key === "parent" || key === "isTotal";
    const candidates = [
      ...(RETYPE_ENCODE_ALIASES[key] ?? [key]),
      ...(!optional && columns.length > 0 ? (RETYPE_COLUMN_ALIASES[key] ?? []) : []),
    ];
    const chosen = candidates.map((candidate) => {
      const authored = sourceChannels[candidate];
      // A required channel may be absent from the source type while its
      // explicitly named data column is present (for example scatter → bubble
      // needs the existing `size` column).  Reusing that exact column is a
      // lossless migration; inventing or position-guessing one is not.
      if (typeof authored === "string" && authored.length > 0) return authored;
      if (columns.includes(candidate)) return candidate;
      return undefined;
    }).find((value): value is string => {
      if (typeof value !== "string" || value.length === 0) return false;
      return columns.length === 0 || columns.includes(value);
    });
    if (chosen !== undefined) targetEncode[key] = chosen;
    else if (!optional) return null;
  }
  out.encode = targetEncode;

  // Copy fields that are represented by the target type. This keeps style
  // composites byte-for-byte intact instead of rebuilding only a subset.
  for (const [key, value] of Object.entries(source)) {
    if (key === "type" || key === "encode" || key === "name" || key === "xAxisIndex" || key === "yAxisIndex" || value === undefined) continue;
    if (targetFields.has(key)) {
      out[key] = structuredClone(value);
      consumedSourceFields.add(key);
    }
  }

  // fill and lineColor are the only cross-type paint aliases. They are an
  // equivalent atom only; arrays/keyed palettes cannot be squeezed into a
  // scalar target without loss.
  for (const [from, to] of [["fill", "lineColor"], ["lineColor", "fill"]] as const) {
    const value = source[from];
    if (value === undefined || targetFields.has(from)) continue;
    if (!targetFields.has(to) || !isChartSeriesFillAtom(value)) return null;
    if (out[to] !== undefined && !jsonEqual(out[to], value)) return null;
    out[to] = structuredClone(value);
    consumedSourceFields.add(from);
  }
  // Any source field omitted above is not semantically representable in the
  // target, so fail closed instead of silently dropping it.
  for (const key of Object.keys(source)) {
    if (source[key] === undefined || consumedSourceFields.has(key)) continue;
    return null;
  }
  return out as unknown as BentoChartSeriesV4;
}

/**
 * 对单个 series 字段做结构化 patch。DOM 面板的每一个终态控件都经此 helper
 * 重新携带完整 series，kernel 因而获得一个可逆的 setChartSeries，而不是
 * 在 vendor 投影对象上做宽泛直写。null 明确表示删除可选字段。
 */
export function chartSeriesPatchCommands(
  id: string,
  index: number,
  series: BentoChartSeriesV4,
  patch: Readonly<Record<string, unknown>>,
): VisualCommandV4[] {
  const next = structuredClone(series) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = structuredClone(value);
  }
  return chartSeriesCommands(id, index, next as unknown as BentoChartSeriesV4);
}

/**
 * Remove a secondary y axis as one valid command batch.  Every series bound
 * to index 1 is first detached; only then is the secondary axis removed.  The
 * order matters because the kernel validates the whole candidate document
 * and a chart may legally have multiple secondary series.
 */
export function removeSecondaryYAxisCommands(
  id: string,
  chart: BentoChartV4,
): VisualCommandV4[] | null {
  if (!Array.isArray(chart.yAxis) || chart.yAxis.length < 2) return null;
  const commands: VisualCommandV4[] = [];
  chart.series.forEach((series, index) => {
    if (series.yAxisIndex === 1) commands.push(...chartSeriesPatchCommands(id, index, series, { yAxisIndex: null }));
  });
  const primary = structuredClone(chart.yAxis[0] ?? { type: "value" });
  commands.push(...chartOptionCommands(id, { yAxis: primary }));
  return commands;
}

/** Nested series style patch (marker.fill/border, bar upBars, etc.). */
export function chartSeriesNestedPatchCommands(
  id: string,
  index: number,
  series: BentoChartSeriesV4,
  key: string,
  nestedKey: string,
  value: unknown,
): VisualCommandV4[] {
  const parent = series[key as keyof BentoChartSeriesV4] as unknown;
  const next = parent !== null && typeof parent === "object" && !Array.isArray(parent)
    ? structuredClone(parent) as Record<string, unknown>
    : {};
  if (value === null || value === undefined || value === "") delete next[nestedKey];
  else next[nestedKey] = structuredClone(value);
  return chartSeriesPatchCommands(id, index, series, { [key]: Object.keys(next).length === 0 ? null : next });
}

/**
 * Closed, lossless fill shape accepted by the chart JSON composites.  The
 * kernel validates command envelopes, but it intentionally does not inspect
 * every nested series fill field; the editor therefore rejects malformed JSON
 * before dispatch instead of relying on a projection failure.  Colors are
 * kept in their authored HEX6/HEX8 spelling (no alpha normalization).
 */
const HEX_COLOR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validColor(value: unknown): value is BentoColor {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function validGradient(value: unknown): boolean {
  if (!plainRecord(value) || value.type !== "gradient" ||
      (value.gradientType !== "linear" && value.gradientType !== "radial") ||
      !Array.isArray(value.stops) || value.stops.length < 2) return false;
  const allowed = new Set(["type", "gradientType", "stops", "angle"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  if (value.gradientType === "radial" && value.angle !== undefined) return false;
  if (value.angle !== undefined &&
      (typeof value.angle !== "number" || !Number.isFinite(value.angle) || value.angle < 0 || value.angle >= 360)) return false;
  return value.stops.every((stop) => plainRecord(stop) &&
    Object.keys(stop).every((key) => key === "position" || key === "color") &&
    typeof stop.position === "number" && Number.isFinite(stop.position) &&
    stop.position >= 0 && stop.position <= 1 && validColor(stop.color));
}

export function isChartSeriesFillAtom(value: unknown): boolean {
  return validColor(value) || validGradient(value);
}

/** True when `value` is one complete BentoSeriesFillV4 for `type`. */
export function isChartSeriesFillValue(type: ChartSeriesType, value: unknown): boolean {
  if (isChartSeriesFillAtom(value)) return true;
  if (type === "treemap") {
    if (!Array.isArray(value) || value.length === 0) return false;
    if (value.every((item) => isChartSeriesFillAtom(item))) return true;
    return value.every((row) => Array.isArray(row) && row.length > 0 && row.every(isChartSeriesFillAtom));
  }
  if (type === "pie" || type === "sunburst" || type === "sankey") {
    if (Array.isArray(value)) return value.length > 0 && value.every(isChartSeriesFillAtom);
    if (type === "sankey" && plainRecord(value)) {
      const keys = Object.keys(value);
      return keys.length > 0 && keys.every((key) => isChartSeriesFillAtom(value[key]));
    }
  }
  return false;
}

/** True when `value` is one complete BentoFillV4 for the chart host. */
export function isChartFillValue(value: unknown): value is BentoFillV4 {
  if (!plainRecord(value)) return false;
  if (value.type === "solid") {
    return Object.keys(value).every((key) => key === "type" || key === "color") && validColor(value.color);
  }
  if (value.type === "gradient") return validGradient(value);
  if (value.type === "image") {
    const allowed = new Set(["type", "src", "fit", "crop", "opacity"]);
    if (Object.keys(value).some((key) => !allowed.has(key)) ||
        typeof value.src !== "string" || !/^asset:[0-9a-f]{64}$/i.test(value.src)) return false;
    if (value.fit !== undefined && value.fit !== "fill" && value.fit !== "contain" && value.fit !== "cover") return false;
    if (value.crop !== undefined && (!Array.isArray(value.crop) || value.crop.length !== 4 ||
        !value.crop.every((part) => typeof part === "number" && Number.isFinite(part)) ||
        value.crop[0]! + value.crop[2]! >= 1 || value.crop[1]! + value.crop[3]! >= 1)) return false;
    return value.opacity === undefined || (typeof value.opacity === "number" && Number.isFinite(value.opacity) && value.opacity >= 0 && value.opacity <= 1);
  }
  return false;
}

/**
 * Structured fill variants need a lossless JSON composite in the DOM editor.
 * Sankey is always keyed JSON—even when a valid node key is literally
 * `type`—so no shape-based gradient heuristic can discard a node palette.
 */
export function seriesFillRequiresJsonEditor(
  series: BentoChartSeriesV4,
  key: string,
  value: unknown,
): boolean {
  if (key !== "fill" && key !== "lineColor" && key !== "areaColor" && key !== "marker.fill") return false;
  // Every series-fill atom/array gets a lossless owning JSON surface.  The
  // compact color/first-last-stop controls remain convenience controls for
  // simple values, but never replace this editor for a structured value.
  if (value === undefined || value === null) return true;
  if (key === "fill") return isChartSeriesFillValue(series.type, value);
  return isChartSeriesFillAtom(value);
}

/** 选项补丁整写（chart.title/legend/dataLabels/axis 系/barLayout/font/外框）。 */
export function chartOptionCommands(id: string, option: ChartOptionPatchV4): VisualCommandV4[] {
  return [{ type: "setChartOption", targetId: id, option }];
}

/** 颜色循环数组 / 清除（chart.palette 行）。 */
export function chartPaletteCommands(id: string, palette: BentoColor[] | null): VisualCommandV4[] {
  return [{ type: "setChartPalette", targetId: id, palette }];
}

/**
 * Terminal DOM guard shared by every chart control.  The kernel repeats the
 * same check on the candidate document, but checking the complete command
 * batch here is what gives an invalid gesture the required zero-dispatch
 * behavior (including setChartData + encode rename composites).
 */
export function chartCommandBatchError(
  chart: BentoChartV4,
  commands: readonly VisualCommandV4[],
  dimensions?: { width: number; height: number },
): string | null {
  return bentoChartCommandBatchError(chart, commands, dimensions);
}
