/**
 * Renderer-facing chart invariants shared by the command kernel and the DOM
 * chart editor.
 *
 * The renderer is deliberately defensive and throws for inputs which cannot
 * be represented by its adapter.  Keeping this small, pure check at the
 * canonical command seam means an invalid gesture is rejected before it can
 * become canonical state.  It also gives the browser editor the same answer
 * as the kernel without importing either renderer or DOM code.
 */

import type {
  BentoChartDataLabelV4,
  BentoChartDataV4,
  BentoChartSeriesV4,
  BentoChartV4,
  BentoDocV4,
} from "./bentodoc-v4.ts";
import {
  isStaticV1ShapeName,
  isStaticV1ViewBox,
  staticV1FontFamilyError,
  staticV1ShapeAdjustmentsError,
  staticV1SvgPathSyntaxError,
} from "./static-v1.ts";
import type { ChartOptionPatchV4, VisualCommandV4 } from "./commands-v4.ts";

/**
 * Internal chart layout viewport for very small positive element bounds.
 *
 * The chart renderer's smallest standard viewport is 200×120 (the C1 chart
 * compile surface). Keeping that as the deterministic effective viewport lets
 * a chart created on a 1×1 canvas remain renderable; the outer frame still
 * scales the resulting SVG to the authored bounds.
 * Renderer and command/projector preflight both consume this one rule.
 */
export const BENTO_CHART_LAYOUT_VIEWPORT = Object.freeze({ width: 200, height: 120 });

export function bentoChartLayoutViewport(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.max(width, BENTO_CHART_LAYOUT_VIEWPORT.width),
    height: Math.max(height, BENTO_CHART_LAYOUT_VIEWPORT.height),
  };
}

/** The frozen 13-type series vocabulary; single source for kernel/validator/editor. */
export const CHART_SERIES_TYPES = [
  "bar", "line", "area", "scatter", "bubble", "candlestick", "pie", "radar",
  "waterfall", "heatmap", "treemap", "sunburst", "sankey",
] as const;

const CHART_TYPES: ReadonlySet<string> = new Set(CHART_SERIES_TYPES);

/** Per-type required encode channels (chart.encode 行逐型必选键). */
export const CHART_ENCODE_REQUIRED: Readonly<Record<string, readonly string[]>> = {
  bar: ["x", "y"],
  line: ["x", "y"],
  area: ["x", "y"],
  scatter: ["x", "y"],
  bubble: ["x", "y", "size"],
  candlestick: ["x", "high", "low", "close"],
  pie: ["category", "value"],
  radar: ["category", "y"],
  waterfall: ["x", "y"],
  heatmap: ["x", "y", "value"],
  treemap: ["category", "value"],
  sunburst: ["category", "value"],
  sankey: ["source", "target", "flow"],
};

/** Per-type optional encode channels (candlestick.open、waterfall.isTotal、treemap/sunburst.parent). */
export const CHART_ENCODE_OPTIONAL: Readonly<Record<string, readonly string[]>> = {
  candlestick: ["open"],
  waterfall: ["isTotal"],
  treemap: ["parent"],
  sunburst: ["parent"],
};

/** Per-type series top-level field vocabulary (closed world per series type). */
export const CHART_SERIES_FIELDS: Readonly<Record<string, readonly string[]>> = {
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

const NUMERIC_CHANNELS = new Set(["value", "size", "open", "high", "low", "close", "flow"]);
const LABEL_CONTENTS: Readonly<Record<string, readonly string[]>> = {
  pie: ["value", "percentage", "category"],
  waterfall: ["value", "category"],
  treemap: ["value", "category"],
  sunburst: ["value", "category"],
  // Every other renderer has only a numeric value label.
  default: ["value"],
};
const NUMBER_FORMATS = new Set(["0", "0.0", "0%", "0.0%", "#,##0", "0.0E+00"]);
const HEX_COLOR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;
const VALUE_CARTESIAN_TYPES = new Set(["bar", "line", "area", "candlestick"]);
const NUMERIC_TYPES = new Set(["scatter", "bubble"]);
const TEXT_STYLE_FIELDS = ["color", "fontSize", "fontFamily"] as const;

type Raw = Record<string, unknown>;

function record(value: unknown): value is Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function color(value: unknown): boolean {
  return typeof value === "string" && HEX_COLOR.test(value);
}

function gradient(value: unknown): boolean {
  if (!record(value) || value.type !== "gradient" ||
      (value.gradientType !== "linear" && value.gradientType !== "radial") ||
      !Array.isArray(value.stops) || value.stops.length < 2) return false;
  if (Object.keys(value).some((key) => !["type", "gradientType", "angle", "stops"].includes(key))) return false;
  if (value.gradientType === "radial" && value.angle !== undefined) return false;
  if (value.angle !== undefined && (!finite(value.angle) || value.angle < 0 || value.angle >= 360)) return false;
  return value.stops.every((stop) => record(stop) &&
    Object.keys(stop).every((key) => key === "position" || key === "color") &&
    finite(stop.position) && stop.position >= 0 && stop.position <= 1 && color(stop.color));
}

function seriesFillAtom(value: unknown): boolean {
  return color(value) || gradient(value);
}

function seriesFill(type: string, value: unknown): boolean {
  if (seriesFillAtom(value)) return true;
  if (type === "treemap") {
    if (!Array.isArray(value) || value.length === 0) return false;
    // The treemap union is deliberately closed at one or two dimensions:
    // either every item is a fill atom (1-D) or every item is a non-empty row
    // of fill atoms (2-D).  Accepting a mixed top-level array would let the
    // renderer choose a branch from the first item and silently reinterpret
    // the remaining items.
    return value.every(seriesFillAtom) || value.every((item) =>
      Array.isArray(item) && item.length > 0 && item.every(seriesFillAtom));
  }
  if (type === "pie" || type === "sunburst") {
    return Array.isArray(value) && value.length > 0 && value.every(seriesFillAtom);
  }
  if (type === "sankey" && record(value)) {
    return Object.keys(value).length > 0 && Object.values(value).every(seriesFillAtom);
  }
  return false;
}

function containsGradient(value: unknown): boolean {
  if (gradient(value)) return true;
  if (Array.isArray(value)) return value.some(containsGradient);
  if (record(value)) return Object.values(value).some(containsGradient);
  return false;
}

function fill(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.type === "solid") return Object.keys(value).every((key) => key === "type" || key === "color") && color(value.color);
  if (value.type === "gradient") return gradient(value);
  if (value.type !== "image") return false;
  if (Object.keys(value).some((key) => !["type", "src", "fit", "crop", "opacity"].includes(key)) ||
      typeof value.src !== "string" || !/^asset:[0-9a-f]{64}$/i.test(value.src)) return false;
  if (value.fit !== undefined && value.fit !== "fill" && value.fit !== "contain" && value.fit !== "cover") return false;
  if (value.crop !== undefined && (!Array.isArray(value.crop) || value.crop.length !== 4 ||
      !value.crop.every(finite) || value.crop[0]! + value.crop[2]! >= 1 || value.crop[1]! + value.crop[3]! >= 1)) return false;
  return value.opacity === undefined || (finite(value.opacity) && value.opacity >= 0 && value.opacity <= 1);
}

function textStyle(value: unknown, extraFields: readonly string[] = []): boolean {
  if (!record(value)) return false;
  const allowed = new Set<string>([...TEXT_STYLE_FIELDS, ...extraFields]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  if (value.color !== undefined && !color(value.color)) return false;
  if (value.fontSize !== undefined && (!finite(value.fontSize) || value.fontSize <= 0)) return false;
  if (value.fontFamily !== undefined && staticV1FontFamilyError(value.fontFamily) !== null) return false;
  return true;
}

function title(value: unknown): boolean {
  if (typeof value === "string") return true;
  return record(value) && typeof value.text === "string" && textStyle(value, ["text"]);
}

function legend(value: unknown): boolean {
  if (typeof value === "boolean") return true;
  return record(value) && textStyle(value, ["show", "position"]) &&
    (value.show === undefined || typeof value.show === "boolean") &&
    (value.position === undefined || ["top", "bottom", "left", "right"].includes(value.position as string));
}

function dataLabels(value: unknown): value is BentoChartDataLabelV4 {
  if (!record(value) || !textStyle(value, ["show", "content", "numberFormat"])) return false;
  if (value.show !== undefined && typeof value.show !== "boolean") return false;
  if (value.content !== undefined && (value.content !== "value" && value.content !== "percentage" && value.content !== "category")) return false;
  return value.numberFormat === undefined || (typeof value.numberFormat === "string" && NUMBER_FORMATS.has(value.numberFormat));
}

function borderStyle(value: unknown): boolean {
  if (!record(value) || Object.keys(value).some((key) => !["style", "width", "color"].includes(key))) return false;
  if (value.style !== undefined && value.style !== "solid" && value.style !== "dash" && value.style !== "dot") return false;
  if (value.color !== undefined && !color(value.color)) return false;
  return value.width === undefined || (finite(value.width) && value.width > 0);
}

function marker(value: unknown): boolean {
  if (!record(value) || Object.keys(value).some((key) => !["shape", "fill", "border", "size"].includes(key))) return false;
  if (value.shape !== undefined && !["circle", "rect", "diamond", "triangle"].includes(value.shape as string)) return false;
  if (value.fill !== undefined && !seriesFillAtom(value.fill)) return false;
  if (value.border !== undefined && !borderStyle(value.border)) return false;
  return value.size === undefined || (finite(value.size) && value.size > 0);
}

/** Bar-like nested styles are color-only fills in the frozen series types. */
function barStyle(value: unknown): boolean {
  if (!record(value) || Object.keys(value).some((key) => !["fill", "border"].includes(key))) return false;
  if (value.fill !== undefined && !color(value.fill)) return false;
  return value.border === undefined || borderStyle(value.border);
}

function lineStyle(value: unknown, arrow = false): boolean {
  if (!record(value)) return false;
  const allowed = arrow ? ["style", "color", "width", "arrow"] : ["style", "color", "width"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return false;
  if (value.style !== undefined && value.style !== "solid" && value.style !== "dash" && value.style !== "dot") return false;
  if (value.color !== undefined && !color(value.color)) return false;
  if (arrow && value.arrow !== undefined && value.arrow !== true && value.arrow !== false &&
      value.arrow !== "start" && value.arrow !== "end" && value.arrow !== "both") return false;
  return value.width === undefined || (finite(value.width) && value.width > 0);
}

function axis(value: unknown, spoke = false): boolean {
  if (!record(value)) return false;
  const allowed = spoke
    ? ["show", "min", "max", "label", "axisLine", "gridLine"]
    : ["show", "type", "min", "max", "reverse", "title", "label", "axisLine", "gridLine"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return false;
  if (value.show !== undefined && typeof value.show !== "boolean") return false;
  if (!spoke && value.type !== undefined && value.type !== "category" && value.type !== "value") return false;
  if (value.min !== undefined && !finite(value.min)) return false;
  if (value.max !== undefined && !finite(value.max)) return false;
  if (value.min !== undefined && value.max !== undefined && value.min >= value.max) return false;
  if (value.reverse !== undefined && typeof value.reverse !== "boolean") return false;
  if (value.title !== undefined && !title(value.title)) return false;
  for (const key of ["label"] as const) {
    const child = value[key];
    if (child !== undefined && typeof child !== "boolean" && (!textStyle(child, ["numberFormat"]) || !record(child) ||
      (child.numberFormat !== undefined && (typeof child.numberFormat !== "string" || !NUMBER_FORMATS.has(child.numberFormat))))) return false;
  }
  for (const key of ["axisLine", "gridLine"] as const) {
    const child = value[key];
    if (child !== undefined && typeof child !== "boolean" && !lineStyle(child, key === "axisLine" && !spoke)) return false;
  }
  return true;
}

function chartDataError(data: unknown): string | null {
  if (!record(data) || !Array.isArray(data.cols) || data.cols.length === 0 ||
      data.cols.some((col) => typeof col !== "string" || col.length === 0) ||
      new Set(data.cols).size !== data.cols.length || !Array.isArray(data.rows)) {
    return "chart.data must have unique non-empty cols and rows";
  }
  for (const [rowIndex, row] of data.rows.entries()) {
    if (!Array.isArray(row) || row.length !== data.cols.length) return `chart.data row ${rowIndex} length does not match cols`;
    if (row.some((cell) => !(cell === null || typeof cell === "string" || finite(cell)))) {
      return `chart.data row ${rowIndex} contains a non-finite/non-primitive cell`;
    }
  }
  return null;
}

function numericColumnError(data: BentoChartDataV4, column: string, type: string, channel: string, requiredValue = true): string | null {
  const index = data.cols.indexOf(column);
  if (index < 0) return `series ${type} encode.${channel} references unknown column ${JSON.stringify(column)}`;
  let hasNumericValue = false;
  for (const [rowIndex, row] of data.rows.entries()) {
    const cell = row[index];
    if (cell === null || cell === "") continue;
    if (typeof cell === "number") {
      hasNumericValue = true;
      continue;
    }
    if (typeof cell === "string" && Number.isFinite(Number(cell))) {
      hasNumericValue = true;
      continue;
    }
    return `series ${type} encode.${channel} has a non-numeric value at row ${rowIndex}`;
  }
  // Numeric strings are part of the import/render contract (the renderer's
  // Number() path accepts them).  A textual column with no parseable numeric
  // value, however, must fail before projection rather than throw in render.
  return hasNumericValue || !requiredValue ? null : `series ${type} encode.${channel} cannot target a string-only/empty column`;
}

function numericChannel(type: string, channel: string): boolean {
  // x is numeric only for the two Cartesian point types.  Category x values
  // (bar/line/area/candlestick/waterfall) remain lossless strings, including
  // "001" and the empty string.
  return NUMERIC_CHANNELS.has(channel) ||
    (channel === "y" && (VALUE_CARTESIAN_TYPES.has(type) || NUMERIC_TYPES.has(type) || type === "radar" || type === "waterfall")) ||
    (NUMERIC_TYPES.has(type) && channel === "x");
}

function categoryColumnError(data: BentoChartDataV4, column: string, type: string, channel: string): string | null {
  const index = data.cols.indexOf(column);
  if (index < 0) return `series ${type} encode.${channel} references unknown column ${JSON.stringify(column)}`;
  return data.rows.some((row) => row[index] !== null)
    ? null
    : `series ${type} encode.${channel} has no usable category rows`;
}

function shapeDef(value: unknown): boolean {
  if (!record(value) || Object.keys(value).some((key) => !["shapeName", "adjustments", "viewBox", "path"].includes(key))) return false;
  if (!isStaticV1ShapeName(value.shapeName)) return false;
  if (staticV1ShapeAdjustmentsError(value.shapeName, value.adjustments as readonly number[] | undefined) !== null) return false;
  if (value.shapeName === "custom") {
    return isStaticV1ViewBox(value.viewBox) && typeof value.path === "string" && staticV1SvgPathSyntaxError(value.path) === null;
  }
  return value.viewBox === undefined && value.path === undefined;
}

function matchingFilter(data: BentoChartDataV4, series: Raw): boolean {
  const filter = series.dataFilter;
  if (!record(filter) || Object.keys(filter).some((key) => key !== "col" && key !== "value")) return false;
  if (typeof filter.col !== "string" || !data.cols.includes(filter.col) ||
      !(typeof filter.value === "string" || finite(filter.value))) return false;
  const index = data.cols.indexOf(filter.col);
  return data.rows.some((row) => String(row[index]) === String(filter.value));
}

function seriesError(series: unknown, data: BentoChartDataV4): string | null {
  if (!record(series) || typeof series.type !== "string" || !CHART_TYPES.has(series.type)) return "series has an unknown chart type";
  const type = series.type;
  const allowed = new Set(CHART_SERIES_FIELDS[type]);
  if (Object.keys(series).some((key) => !allowed.has(key))) return `series ${type} contains an unsupported field`;
  if (!record(series.encode)) return `series ${type} encode must be an object`;
  const encode = series.encode;
  const encodeAllowed = new Set([...(CHART_ENCODE_REQUIRED[type] ?? []), ...(CHART_ENCODE_OPTIONAL[type] ?? [])]);
  if (Object.keys(encode).some((key) => !encodeAllowed.has(key))) return `series ${type} encode contains an unsupported channel`;
  for (const channel of CHART_ENCODE_REQUIRED[type] ?? []) {
    const column = encode[channel];
    if (typeof column !== "string" || column.length === 0 || !data.cols.includes(column)) return `series ${type} encode.${channel} references an unknown column`;
    if (numericChannel(type, channel)) {
      const error = numericColumnError(data, column, type, channel);
      if (error !== null) return error;
    } else {
      const error = categoryColumnError(data, column, type, channel);
      if (error !== null) return error;
    }
  }
  for (const channel of CHART_ENCODE_OPTIONAL[type] ?? []) {
    const column = encode[channel];
    if (column !== undefined) {
      if (typeof column !== "string" || column.length === 0 || !data.cols.includes(column)) return `series ${type} encode.${channel} references an unknown column`;
      if (numericChannel(type, channel)) {
        const error = numericColumnError(data, column, type, channel, false);
        if (error !== null) return error;
      }
    }
  }
  if (series.name !== undefined && typeof series.name !== "string") return `series ${type}.name must be a string`;
  if (series.border !== undefined && !borderStyle(series.border)) return `series ${type}.border is invalid`;
  for (const key of ["xAxisIndex", "yAxisIndex"] as const) {
    if (series[key] !== undefined && (!finite(series[key]) || series[key] < 0 || !Number.isInteger(series[key]))) return `series ${type}.${key} must be a non-negative integer`;
    if (key === "xAxisIndex" && series[key] !== undefined && series[key] !== 0) return "secondary x axes are not supported";
  }
  if (series.dataLabels !== undefined && !dataLabels(series.dataLabels)) return `series ${type}.dataLabels is invalid`;
  if (series.dataFilter !== undefined && !matchingFilter(data, series)) return `series ${type}.dataFilter is invalid or matches no row`;

  switch (type) {
    case "bar":
      if (series.stack !== undefined && series.stack !== "value" && series.stack !== "percent") return "bar stack must be value or percent";
      if (series.symbol !== undefined && !shapeDef(series.symbol)) return "bar symbol is invalid";
      if (series.fill !== undefined && !seriesFill(type, series.fill)) return "bar fill is invalid";
      break;
    case "line":
    case "area":
    case "radar":
      if (series.smooth !== undefined && typeof series.smooth !== "boolean") return `${type}.smooth is invalid`;
      if (series.lineStyle !== undefined && !["solid", "dash", "dot"].includes(series.lineStyle as string)) return `${type}.lineStyle is invalid`;
      if (series.width !== undefined && (!finite(series.width) || series.width <= 0)) return `${type}.width is invalid`;
      if (series.nullHandling !== undefined && !["zero", "gap", "connect"].includes(series.nullHandling as string)) return `${type}.nullHandling is invalid`;
      if (series.lineColor !== undefined && !seriesFillAtom(series.lineColor)) return `${type}.lineColor is invalid`;
      if (series.marker !== undefined && series.marker !== false && !marker(series.marker)) return `${type}.marker is invalid`;
      if (type === "area" && series.stack !== undefined && !["value", "percent", "stream"].includes(series.stack as string)) return "area stack is invalid";
      if ((type === "area" || type === "radar") && series.areaColor !== undefined && !seriesFillAtom(series.areaColor)) return `${type}.areaColor is invalid`;
      break;
    case "scatter":
      if (series.marker === false) return "scatter marker=false is unsupported";
      if (series.fill !== undefined && !seriesFill(type, series.fill)) return "scatter fill is invalid";
      if (series.marker !== undefined && !marker(series.marker)) return "scatter marker is invalid";
      break;
    case "bubble":
      if (series.sizeScale !== undefined && !["linear", "sqrt", "log"].includes(series.sizeScale as string)) return "bubble sizeScale is invalid";
      if (series.sizeRange !== undefined && (!Array.isArray(series.sizeRange) || series.sizeRange.length !== 2 || !series.sizeRange.every(finite) || series.sizeRange[0]! >= series.sizeRange[1]!)) return "bubble sizeRange min must be less than max";
      if (series.fill !== undefined && !seriesFill(type, series.fill)) return "bubble fill is invalid";
      break;
    case "candlestick":
      for (const key of ["upBars", "downBars"] as const) {
        if (series[key] !== undefined && !barStyle(series[key])) return `candlestick.${key} is invalid`;
      }
      if (series.wickStyle !== undefined && !borderStyle(series.wickStyle)) return "candlestick.wickStyle is invalid";
      break;
    case "pie": {
      if (series.innerRadius !== undefined && (!finite(series.innerRadius) || series.innerRadius < 0 || series.innerRadius > 1)) return "pie innerRadius is invalid";
      if (series.startAngle !== undefined && !finite(series.startAngle)) return "pie startAngle is invalid";
      if (series.fill !== undefined && !seriesFill(type, series.fill)) return "pie fill is invalid";
      const vi = data.cols.indexOf(encode.value as string);
      const values = data.rows.map((row) => row[vi]).filter((cell): cell is number | string => cell !== null && cell !== "").map((cell) => typeof cell === "number" ? cell : Number(cell));
      if (values.some((value) => !Number.isFinite(value) || value < 0) || values.length === 0 || values.reduce((sum, value) => sum + value, 0) <= 0) return "pie values must be non-negative with a positive total";
      break;
    }
    case "waterfall":
      for (const key of ["totalBars", "increaseBars", "decreaseBars"] as const) {
        if (series[key] !== undefined && !barStyle(series[key])) return `waterfall.${key} is invalid`;
      }
      break;
    case "heatmap": {
      if (series.colorScheme !== undefined && (!Array.isArray(series.colorScheme) || series.colorScheme.length < 2 || !series.colorScheme.every(color))) return "heatmap colorScheme must contain at least two colors";
      if (series.colorScale !== undefined) {
        if (!record(series.colorScale) || Object.keys(series.colorScale).some((key) => key !== "type" && key !== "domain") || (series.colorScale.type !== undefined && series.colorScale.type !== "linear" && series.colorScale.type !== "diverging")) return "heatmap colorScale is invalid";
        if (series.colorScale.domain !== undefined && (!Array.isArray(series.colorScale.domain) || series.colorScale.domain.length !== 2 || !series.colorScale.domain.every(finite) || series.colorScale.domain[0]! >= series.colorScale.domain[1]!)) return "heatmap colorScale domain min must be less than max";
        if (series.colorScale.type === "diverging" && series.colorScheme !== undefined && series.colorScheme.length !== 3) return "heatmap diverging colorScheme must contain exactly three colors";
      }
      if (series.colorbar !== undefined && series.colorbar !== false && series.colorbar !== true) {
        if (!legend(series.colorbar)) return "heatmap colorbar is invalid";
        if (record(series.colorbar) && series.colorbar.position !== undefined && series.colorbar.position !== "right") return "heatmap colorbar position must be right";
      }
      const xi = data.cols.indexOf(encode.x as string);
      const yi = data.cols.indexOf(encode.y as string);
      const vi = data.cols.indexOf(encode.value as string);
      if (!data.rows.some((row) => row[xi] !== null && row[yi] !== null && row[vi] !== null && row[vi] !== "")) return "heatmap requires at least one complete cell";
      break;
    }
    case "treemap":
    case "sunburst":
      if (series.levels !== undefined && (!finite(series.levels) || series.levels < 1)) return `${type}.levels is invalid`;
      if (series.fill !== undefined && !seriesFill(type, series.fill)) return `${type} fill is invalid`;
      if (series.fill !== undefined && containsGradient(series.fill)) return `${type} gradient fill is unsupported`;
      break;
    case "sankey":
      if (series.nodeAlign !== undefined && !["left", "right", "justify"].includes(series.nodeAlign as string)) return "sankey nodeAlign is invalid";
      if (series.fill !== undefined && !seriesFill(type, series.fill)) return "sankey fill is invalid";
      if (series.fill !== undefined && containsGradient(series.fill)) return "sankey gradient fill is unsupported";
      {
        const source = data.cols.indexOf(encode.source as string);
        const target = data.cols.indexOf(encode.target as string);
        const flow = data.cols.indexOf(encode.flow as string);
        if (data.rows.some((row) => row[source] === null || row[target] === null)) return "sankey source/target must not be null";
        if (data.rows.some((row) => {
          const value = row[flow];
          const parsed = value === null || value === "" ? NaN : typeof value === "number" ? value : Number(value);
          return !Number.isFinite(parsed) || parsed < 0;
        })) return "sankey flow must be non-negative";
        const names = new Set<string>();
        const edges: Array<[string, string]> = [];
        data.rows.forEach((row) => {
          const sourceName = String(row[source]);
          const targetName = String(row[target]);
          names.add(sourceName); names.add(targetName);
          edges.push([sourceName, targetName]);
        });
        const state = new Map<string, 0 | 1 | 2>();
        const adjacency = new Map<string, string[]>();
        for (const [from, to] of edges) adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
        const visit = (name: string): boolean => {
          const current = state.get(name) ?? 0;
          if (current === 1) return true;
          if (current === 2) return false;
          state.set(name, 1);
          for (const child of adjacency.get(name) ?? []) if (visit(child)) return true;
          state.set(name, 2);
          return false;
        };
        for (const name of names) if (visit(name)) return "sankey edges must form a DAG";
      }
      break;
  }
  const labels = series.dataLabels;
  if (labels?.content !== undefined && !(LABEL_CONTENTS[type] ?? LABEL_CONTENTS.default!).includes(labels.content)) return `series ${type} dataLabels.content is unsupported`;
  return null;
}

function typeMixingError(series: readonly unknown[]): string | null {
  if (series.length === 0) return "chart.series must contain at least one series";
  const types: string[] = [];
  for (const item of series) {
    if (!record(item) || typeof item.type !== "string" || !CHART_TYPES.has(item.type)) return "series has an unknown chart type";
    types.push(item.type);
  }
  const exclusive = new Set(["pie", "radar", "waterfall", "heatmap", "treemap", "sunburst", "sankey"]);
  const exclusiveType = types.find((type) => exclusive.has(type));
  if (exclusiveType !== undefined && (series.length !== 1 || types.some((type) => type !== exclusiveType))) return `${exclusiveType} series must be exclusive`;
  if (types.includes("candlestick") && types.some((type) => !["candlestick", "bar", "line", "area"].includes(type))) return "candlestick may mix only with bar/line/area";
  const barModes = new Set(series.filter((item): item is Raw => record(item) && item.type === "bar" && item.stack !== undefined).map((item) => item.stack));
  const areaModes = new Set(series.filter((item): item is Raw => record(item) && item.type === "area" && item.stack !== undefined).map((item) => item.stack));
  if (barModes.size > 1 || areaModes.size > 1 || new Set([...barModes, ...areaModes].filter((mode) => mode === "value" || mode === "percent")).size > 1) return "stack mode value/percent must be consistent";
  if (types.every((type) => type === "radar")) {
    const categories = new Set(series.map((item) => record(item) && record(item.encode) ? item.encode.category : undefined));
    if (categories.size > 1) return "radar series must share encode.category";
  }
  return null;
}

function axisError(chart: BentoChartV4): string | null {
  if (Array.isArray(chart.xAxis)) return "xAxis arrays are unsupported";
  if (chart.xAxis !== undefined && !axis(chart.xAxis)) return "xAxis is invalid";
  if (chart.yAxis !== undefined) {
    const axes = Array.isArray(chart.yAxis) ? chart.yAxis : [chart.yAxis];
    if (axes.length === 0 || axes.length > 2 || axes.some((item) => !axis(item))) return "yAxis must contain at most two valid axes";
  }
  if (chart.spokeAxis !== undefined && !axis(chart.spokeAxis, true)) return "spokeAxis is invalid";
  // Waterfall uses the same category x-axis layout even though it is rendered
  // by its own exclusive renderer branch.  It does not consume chart.yAxis,
  // however, so keep x-axis category rules separate from y-axis binding.
  const categoryXAxisPlot = chart.series.some((item) => VALUE_CARTESIAN_TYPES.has(item.type) || item.type === "waterfall");
  const usesYAxes = chart.series.some((item) => VALUE_CARTESIAN_TYPES.has(item.type) || NUMERIC_TYPES.has(item.type));
  if (categoryXAxisPlot && chart.xAxis !== undefined && !Array.isArray(chart.xAxis) &&
      (chart.xAxis.min !== undefined || chart.xAxis.max !== undefined)) return "category xAxis cannot have min/max";
  const axes = chart.yAxis === undefined ? [] : Array.isArray(chart.yAxis) ? chart.yAxis : [chart.yAxis];
  if (usesYAxes) {
    for (const item of chart.series) {
      if ((item.yAxisIndex ?? 0) >= Math.max(1, axes.length)) return `series ${item.type} yAxisIndex requires a corresponding yAxis`;
    }
    for (let index = 0; index < axes.length; index += 1) {
      if (!chart.series.some((item) => (item.yAxisIndex ?? 0) === index)) return `yAxis ${index} has no bound series`;
    }
  }
  return null;
}

function numberCell(value: unknown): number | null {
  if (value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function categoryValues(data: BentoChartDataV4, column: string): string[] {
  const index = data.cols.indexOf(column);
  return data.rows
    .map((row) => row[index])
    .filter((value): value is string | number => value !== null)
    .map((value) => String(value));
}

function filteredRows(data: BentoChartDataV4, series: Raw): number[] {
  const filter = record(series.dataFilter) ? series.dataFilter as Raw : undefined;
  if (filter === undefined) return data.rows.map((_row, index) => index);
  const index = data.cols.indexOf(filter.col as string);
  return data.rows.flatMap((row, rowIndex) => String(row[index]) === String(filter.value) ? [rowIndex] : []);
}

function catPoint(data: BentoChartDataV4, series: Raw, categories: string[], slot: number): number | null {
  const encode = series.encode as Raw;
  const xIndex = data.cols.indexOf(encode.x as string);
  const yIndex = data.cols.indexOf(encode.y as string);
  const rowIndex = data.rows.findIndex((row) => row[xIndex] !== null && String(row[xIndex]) === categories[slot]);
  return rowIndex < 0 ? null : numberCell(data.rows[rowIndex]![yIndex]);
}

function valueDomainValues(chart: Raw, bound: Raw[], categories: string[] | null): number[] {
  const data = chart.data as BentoChartDataV4;
  const values: number[] = [];
  const barStack = bound.filter((series) => series.type === "bar" && series.stack !== undefined);
  const areaStack = bound.filter((series) => series.type === "area" && series.stack !== undefined);
  if (barStack.some((series) => series.stack === "percent") || areaStack.some((series) => series.stack === "percent")) return [-1, 1];
  const stackable = barStack.concat(areaStack.filter((series) => series.stack !== "stream"));
  const streamAreas = areaStack.filter((series) => series.stack === "stream");
  if (stackable.length > 0 || streamAreas.length > 0) {
    const slotCount = categories?.length ?? 0;
    for (let slot = 0; slot < slotCount; slot += 1) {
      let positive = 0;
      let negative = 0;
      for (const series of stackable) {
        const value = catPoint(data, series, categories ?? [], slot) ?? 0;
        if (value >= 0) positive += value;
        else negative += value;
        values.push(positive, negative);
      }
      if (streamAreas.length > 0) {
        const total = streamAreas.reduce((sum, series) => sum + (catPoint(data, series, categories ?? [], slot) ?? 0), 0);
        let cumulative = 0;
        for (const series of streamAreas) {
          cumulative += catPoint(data, series, categories ?? [], slot) ?? 0;
          values.push(cumulative - total / 2, total / 2 - cumulative);
        }
      }
    }
  }
  for (const series of bound) {
    const encode = series.encode as Raw;
    if (series.type === "candlestick") {
      for (const channel of ["high", "low", "close", "open"]) {
        const column = encode[channel];
        if (column === undefined) continue;
        const index = data.cols.indexOf(column as string);
        for (const row of data.rows) {
          const value = numberCell(row[index]);
          if (value !== null) values.push(value);
        }
      }
    } else if (NUMERIC_TYPES.has(series.type as string)) {
      const yIndex = data.cols.indexOf(encode.y as string);
      for (const rowIndex of filteredRows(data, series)) {
        const value = numberCell(data.rows[rowIndex]![yIndex]);
        if (value !== null) values.push(value);
      }
    } else if ((series.type === "bar" || series.type === "area") && series.stack !== undefined) {
      // Included above as cumulative stack extents.
    } else {
      const yIndex = data.cols.indexOf(encode.y as string);
      for (const row of data.rows) {
        const value = numberCell(row[yIndex]);
        if (value !== null) values.push(value);
      }
    }
  }
  return values;
}

function cartesianDataError(chart: Raw): string | null {
  const data = chart.data as BentoChartDataV4;
  const series = chart.series as Raw[];
  const valueSeries = series.filter((item) => VALUE_CARTESIAN_TYPES.has(item.type as string));
  const numericSeries = series.filter((item) => NUMERIC_TYPES.has(item.type as string));
  const categories = valueSeries.length === 0
    ? null
    : categoryValues(data, (valueSeries[0]!.encode as Raw).x as string);
  if (categories !== null) {
    const first = categories.join("\u0000");
    for (const item of valueSeries.slice(1)) {
      const values = categoryValues(data, (item.encode as Raw).x as string);
      if (values.join("\u0000") !== first) return `series ${item.type} encode.x category values must match the first series`;
    }
  }
  if (numericSeries.length > 0 && categories !== null) {
    for (const item of numericSeries) {
      const encode = item.encode as Raw;
      const xIndex = data.cols.indexOf(encode.x as string);
      const yIndex = data.cols.indexOf(encode.y as string);
      for (const [pointIndex, rowIndex] of filteredRows(data, item).entries()) {
        if (numberCell(data.rows[rowIndex]![xIndex]) !== null && numberCell(data.rows[rowIndex]![yIndex]) !== null && pointIndex >= categories.length) {
          return "scatter/bubble data rows exceed category slots";
        }
      }
    }
  }
  const axes = chart.yAxis === undefined ? [] : Array.isArray(chart.yAxis) ? chart.yAxis as unknown[] : [chart.yAxis];
  if (valueSeries.length > 0 || numericSeries.length > 0) {
    const axisCount = Math.max(axes.length, 1);
    for (let axisIndex = 0; axisIndex < axisCount; axisIndex += 1) {
      const bound = series.filter((item) => (item.yAxisIndex ?? 0) === axisIndex);
      if (valueDomainValues(chart, bound, categories).length === 0) return `y axis ${axisIndex} has no usable numeric data`;
    }
    if (categories === null) {
      let hasX = false;
      for (const item of numericSeries) {
        const xIndex = data.cols.indexOf((item.encode as Raw).x as string);
        if (filteredRows(data, item).some((rowIndex) => numberCell(data.rows[rowIndex]![xIndex]) !== null)) {
          hasX = true;
          break;
        }
      }
      if (!hasX) return "x axis has no usable numeric data";
    }
  }
  return null;
}

function hierarchyDataError(data: BentoChartDataV4, series: Raw): string | null {
  const type = series.type as string;
  if (type !== "treemap" && type !== "sunburst") return null;
  const encode = series.encode as Raw;
  const categoryIndex = data.cols.indexOf(encode.category as string);
  const valueIndex = data.cols.indexOf(encode.value as string);
  const parentIndex = encode.parent === undefined ? -1 : data.cols.indexOf(encode.parent as string);
  const nodes = new Map<string, { value: number; parent: string | null }>();
  for (const row of data.rows) {
    const category = row[categoryIndex];
    if (category === null) continue;
    nodes.set(String(category), { value: numberCell(row[valueIndex]) ?? 0, parent: parentIndex < 0 || row[parentIndex] === null ? null : String(row[parentIndex]) });
  }
  const roots = [...nodes.entries()].filter(([, node]) => node.parent === null || node.parent === "" || !nodes.has(node.parent));
  if (roots.length === 0) return `${type} requires at least one root node`;
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (name: string): boolean => {
    const current = state.get(name) ?? 0;
    if (current === 1) return true;
    if (current === 2) return false;
    state.set(name, 1);
    const parent = nodes.get(name)?.parent;
    if (parent !== null && parent !== undefined && nodes.has(parent) && visit(parent)) return true;
    state.set(name, 2);
    return false;
  };
  for (const name of nodes.keys()) if (visit(name)) return `${type} parent hierarchy contains a cycle`;
  if (type === "sunburst") {
    const children = new Map<string, string[]>();
    for (const [name, node] of nodes) if (node.parent !== null && node.parent !== "" && nodes.has(node.parent)) {
      children.set(node.parent, [...(children.get(node.parent) ?? []), name]);
    }
    const total = (name: string): number => (nodes.get(name)?.value ?? 0) + (children.get(name) ?? []).reduce((sum, child) => sum + total(child), 0);
    if (roots.reduce((sum, [name]) => sum + total(name), 0) <= 0) return "sunburst root total must be positive";
  }
  return null;
}

// The projector passes element.bounds[2:4] as the renderer's width/height.
// These helpers intentionally mirror the renderer's deterministic layout
// arithmetic.  They are not a generic minimum-size policy: a command is
// rejected only when the same margins would produce the renderer's own
// non-positive plot (or its bar-layout rejection).
const LABEL_FONT_SIZE = 10;
const TITLE_FONT_SIZE = 16;
const AXIS_TITLE_FONT_SIZE = 12;
const LEGEND_FONT_SIZE = 10;
const CHAR_WIDTH_RATIO = 0.62;
const LEGEND_SWATCH = 14;
const LEGEND_GAP = 8;

function rendererNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function rendererNumberLabel(value: number, numberFormat: string | undefined): string {
  switch (numberFormat) {
    case "0": return String(Math.round(value));
    case "0.0": return value.toFixed(1);
    case "0%": return `${String(Math.round(value * 100))}%`;
    case "0.0%": return `${(value * 100).toFixed(1)}%`;
    case "#,##0": return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    case "0.0E+00": return value.toExponential(1);
    default: return rendererNumber(value);
  }
}

function niceStep(span: number, target = 5): number {
  const raw = span / Math.max(target, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function rendererDomain(lo: number, hi: number): [number, number] {
  if (lo === hi) {
    const padding = Math.abs(lo) || 1;
    return [lo - padding, hi + padding];
  }
  return [lo, hi];
}

function rendererTicks(lo: number, hi: number): number[] {
  const [domainLo, domainHi] = rendererDomain(lo, hi);
  const step = niceStep(domainHi - domainLo);
  const first = Math.ceil(domainLo / step) * step;
  const out: number[] = [];
  for (let value = first; value <= domainHi + step * 1e-9; value += step) out.push(Math.round(value / step) * step);
  return out;
}

function axisLabelFontSize(value: unknown): number {
  const label = record(value) ? value.label : undefined;
  return record(label) && finite(label.fontSize) ? label.fontSize : LABEL_FONT_SIZE;
}

function axisNumberFormat(value: unknown): string | undefined {
  const label = record(value) ? value.label : undefined;
  return record(label) && typeof label.numberFormat === "string" ? label.numberFormat : undefined;
}

function axisTitleSize(value: unknown): number {
  const raw = record(value) ? value.title : undefined;
  if (raw === undefined) return 0;
  if (typeof raw === "string") return AXIS_TITLE_FONT_SIZE + 6;
  return record(raw) && finite(raw.fontSize) ? raw.fontSize + 6 : AXIS_TITLE_FONT_SIZE + 6;
}

function valueTickGutter(axisValue: unknown, ticks: number[]): number {
  const fontSize = axisLabelFontSize(axisValue);
  const numberFormat = axisNumberFormat(axisValue);
  const width = ticks.reduce((max, tick) => Math.max(max, Math.max(fontSize, rendererNumberLabel(tick, numberFormat).length * CHAR_WIDTH_RATIO * fontSize)), 0);
  return Math.max(10, width) + 8;
}

function legendMargins(chart: Raw, labels: string[], availableWidth: number): { top: number; right: number; bottom: number; left: number } {
  if (labels.length === 0 || chart.legend === false) return { top: 0, right: 0, bottom: 0, left: 0 };
  const defaultShown = !["waterfall", "treemap", "sunburst", "sankey"].some((type) => (chart.series as Raw[]).some((series) => series.type === type));
  const config = record(chart.legend) ? chart.legend : {};
  const show = chart.legend === true ? true : config.show ?? defaultShown;
  if (!show) return { top: 0, right: 0, bottom: 0, left: 0 };
  const fontSize = finite(config.fontSize) ? config.fontSize : LEGEND_FONT_SIZE;
  const itemWidth = Math.max(0, ...labels.map((label) => LEGEND_SWATCH + LEGEND_GAP + Math.max(fontSize, label.length * CHAR_WIDTH_RATIO * fontSize) + LEGEND_GAP));
  const rowHeight = fontSize + 4;
  const position = config.position ?? "bottom";
  if (position === "left" || position === "right") {
    const width = itemWidth + 6;
    return { top: 0, right: position === "right" ? width : 0, bottom: 0, left: position === "left" ? width : 0 };
  }
  const perRow = Math.max(1, Math.floor(Math.max(availableWidth, 1) / itemWidth));
  const rows = Math.ceil(labels.length / perRow);
  const height = rows * rowHeight + 4;
  return { top: position === "top" ? height : 0, right: 0, bottom: position === "bottom" ? height : 0, left: 0 };
}

function titleMargin(chart: Raw): number {
  if (chart.title === undefined) return 0;
  const titleValue = record(chart.title) ? chart.title : {};
  return (finite(titleValue.fontSize) ? titleValue.fontSize : TITLE_FONT_SIZE) + 12;
}

function waterfallDomainValues(chart: Raw, series: Raw, categories: string[]): number[] {
  const data = chart.data as BentoChartDataV4;
  const encode = series.encode as Raw;
  const xIndex = data.cols.indexOf(encode.x as string);
  const yIndex = data.cols.indexOf(encode.y as string);
  const totalIndex = encode.isTotal === undefined ? -1 : data.cols.indexOf(encode.isTotal as string);
  const rows: Array<{ value: number; total: boolean }> = [];
  for (const category of categories) {
    const row = data.rows.find((candidate) => candidate[xIndex] !== null && String(candidate[xIndex]) === category);
    if (row === undefined) continue;
    rows.push({ value: numberCell(row[yIndex]) ?? 0, total: totalIndex >= 0 && (row[totalIndex] === "true" || row[totalIndex] === 1) });
  }
  const values: number[] = [];
  let running = 0;
  for (const row of rows) {
    const end = row.total ? row.value : running + row.value;
    values.push(row.total ? 0 : running, end);
    running = end;
  }
  return values;
}

function chartPlotError(chart: Raw, width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "chart plot dimensions must be positive";
  const viewport = bentoChartLayoutViewport(width, height);
  width = viewport.width;
  height = viewport.height;
  const series = chart.series as Raw[];
  const firstType = series[0]?.type as string;
  const valueSeries = series.filter((item) => VALUE_CARTESIAN_TYPES.has(item.type as string));
  const numericSeries = series.filter((item) => NUMERIC_TYPES.has(item.type as string));
  const isWaterfall = firstType === "waterfall";
  const usesCartesianLayout = isWaterfall || VALUE_CARTESIAN_TYPES.has(firstType) || NUMERIC_TYPES.has(firstType);
  let plotWidth = width;
  let plotHeight = height;

  if (usesCartesianLayout) {
    const data = chart.data as BentoChartDataV4;
    const categories = isWaterfall
      ? categoryValues(data, ((series[0]!.encode as Raw).x as string))
      : valueSeries.length > 0 ? categoryValues(data, ((valueSeries[0]!.encode as Raw).x as string)) : null;
    const axisValues: unknown[] = isWaterfall
      ? [undefined]
      : chart.yAxis === undefined ? [] : Array.isArray(chart.yAxis) ? chart.yAxis as unknown[] : [chart.yAxis];
    const axisCount = Math.max(axisValues.length, 1);
    const yGutters: number[] = [];
    for (let index = 0; index < axisCount; index += 1) {
      let values: number[];
      if (isWaterfall) values = waterfallDomainValues(chart, series[0]!, categories ?? []);
      else values = valueDomainValues(chart, series.filter((item) => (item.yAxisIndex ?? 0) === index), categories);
      if (values.length === 0) return `y axis ${index} has no usable numeric data`;
      const rawAxis = axisValues[index];
      const axisLo = record(rawAxis) && finite(rawAxis.min) ? rawAxis.min : Math.min(0, ...values);
      const axisHi = record(rawAxis) && finite(rawAxis.max) ? rawAxis.max : Math.max(0, ...values);
      const [lo, hi] = rendererDomain(axisLo, axisHi);
      yGutters.push(valueTickGutter(rawAxis, rendererTicks(lo, hi)) + axisTitleSize(rawAxis));
    }
    const left = yGutters[0] ?? 0;
    const right = yGutters[1] ?? 0;
    const xAxis = chart.xAxis;
    const xAxisValue = Array.isArray(xAxis) ? undefined : xAxis;
    let bottom: number;
    if (categories === null) {
      const xValues: number[] = [];
      for (const item of numericSeries) {
        const xIndex = data.cols.indexOf(((item.encode as Raw).x as string));
        for (const rowIndex of filteredRows(data, item)) {
          const value = numberCell(data.rows[rowIndex]![xIndex]);
          if (value !== null) xValues.push(value);
        }
      }
      if (xValues.length === 0) return "x axis has no usable numeric data";
      // cartesianLayout intentionally gives a pure numeric plot the stable
      // fallback domain [0, 10]; renderCartesian uses the actual data domain
      // only for point placement.  Mirror the layout seam exactly so margin
      // preflight cannot diverge merely because a data point is large.
      const hasExplicitXDomain = record(xAxisValue) && (xAxisValue.min !== undefined || xAxisValue.max !== undefined);
      const xLo = hasExplicitXDomain && record(xAxisValue) && finite(xAxisValue.min) ? xAxisValue.min : 0;
      const xHi = hasExplicitXDomain && record(xAxisValue) && finite(xAxisValue.max) ? xAxisValue.max : hasExplicitXDomain ? 1 : 10;
      bottom = valueTickGutter(xAxisValue, rendererTicks(...rendererDomain(xLo, xHi))) + axisTitleSize(xAxisValue);
    } else {
      bottom = LABEL_FONT_SIZE + 14 + axisTitleSize(xAxisValue);
    }
    const labels = isWaterfall ? [] : series.map((item) => String(item.name ?? ((item.encode as Raw).y ?? (item.encode as Raw).value ?? (item.encode as Raw).close ?? (item.encode as Raw).x)));
    const legend = legendMargins(chart, labels, Math.max(1, width - left - right));
    const top = titleMargin(chart) + legend.top;
    plotWidth = width - left - right - legend.left - legend.right;
    plotHeight = height - top - bottom - legend.bottom;
    if (plotWidth <= 0 || plotHeight <= 0) return "chart plot dimensions are non-positive";

    const bars = series.filter((item) => item.type === "bar");
    if (bars.length > 0 && categories !== null) {
      const slotWidth = plotWidth / categories.length;
      const contentWidth = slotWidth * (1 - ((finite(chart.categoryGap) ? chart.categoryGap : 0.2)));
      const desiredWidth = finite(chart.barWidth) ? slotWidth * chart.barWidth : contentWidth * 0.8;
      const gapWidth = slotWidth * (finite(chart.barGap) ? chart.barGap : 0);
      const stacked = bars.filter((item) => item.stack !== undefined);
      const columnCount = bars.length - stacked.length + (stacked.length > 0 ? 1 : 0);
      const maxBarWidth = (contentWidth - Math.max(columnCount - 1, 0) * gapWidth) / Math.max(columnCount, 1);
      const barWidth = Math.min(desiredWidth, maxBarWidth);
      if (!Number.isFinite(maxBarWidth) || maxBarWidth <= 0 || !Number.isFinite(barWidth) || barWidth <= 0) {
        return "bar 柱组无法布局：maxBarWidth/barWidth 必须为正（barLayout）";
      }
      const totalWidth = columnCount * barWidth + Math.max(columnCount - 1, 0) * gapWidth;
      if (!Number.isFinite(totalWidth) || totalWidth > contentWidth + 1e-9) return "bar layout parameters exceed the category slot";
    }
    return null;
  }

  let extraRight = 0;
  let extraLeft = 0;
  let extraBottom = 0;
  let labels: string[] = [];
  if (firstType === "pie") {
    const data = chart.data as BentoChartDataV4;
    const item = series[0]!;
    const encode = item.encode as Raw;
    const categoryIndex = data.cols.indexOf(encode.category as string);
    const valueIndex = data.cols.indexOf(encode.value as string);
    labels = data.rows.flatMap((row, index) => numberCell(row[valueIndex]) === null ? [] : [row[categoryIndex] === null ? `slice ${index}` : String(row[categoryIndex])]);
  } else if (firstType === "radar") {
    labels = series.map((item) => String(item.name ?? ((item.encode as Raw).y as string)));
  } else if (firstType === "heatmap") {
    const item = series[0]!;
    if (item.colorbar !== false) extraRight = 30;
    const data = chart.data as BentoChartDataV4;
    const valueIndex = data.cols.indexOf((item.encode as Raw).value as string);
    const values = data.rows.flatMap((row) => { const value = numberCell(row[valueIndex]); return value === null ? [] : [value]; });
    const scaleType = record(item.colorScale) && item.colorScale.type === "diverging" ? "diverging" : "linear";
    const maxAbs = Math.max(Math.abs(Math.min(...values)), Math.abs(Math.max(...values)));
    const scale = record(item.colorScale) && Array.isArray(item.colorScale.domain) ? item.colorScale.domain as unknown[] : undefined;
    const domain: [number, number] = scale !== undefined && finite(scale[0]) && finite(scale[1])
      ? [scale[0], scale[1]]
      : scaleType === "diverging" ? [-maxAbs, maxAbs] : [Math.min(...values), Math.max(...values)];
    const yAxis = chart.yAxis === undefined ? undefined : Array.isArray(chart.yAxis) ? chart.yAxis[0] : chart.yAxis;
    extraLeft = valueTickGutter(yAxis, rendererTicks(...domain));
    extraBottom = LABEL_FONT_SIZE + 14;
  }
  const legend = legendMargins(chart, labels, Math.max(1, width - extraLeft - extraRight));
  const top = titleMargin(chart) + legend.top;
  plotWidth = width - extraLeft - extraRight - legend.left - legend.right;
  plotHeight = height - top - extraBottom - legend.bottom;
  return plotWidth <= 0 || plotHeight <= 0 ? "chart plot dimensions are non-positive" : null;
}

/** Return a deterministic reason when a chart cannot be consumed by the adapter. */
export function bentoChartRenderInvariantError(chart: unknown, dimensions?: { width: number; height: number }): string | null {
  if (!record(chart)) return "chart must be an object";
  const dataError = chartDataError(chart.data);
  if (dataError !== null) return dataError;
  const data = chart.data as BentoChartDataV4;
  if (!Array.isArray(chart.series)) return "chart.series must be an array";
  const series = chart.series as BentoChartSeriesV4[];
  const mixError = typeMixingError(series);
  if (mixError !== null) return mixError;
  for (const item of series) {
    const error = seriesError(item, data);
    if (error !== null) return error;
    const hierarchyError = hierarchyDataError(data, item as unknown as Raw);
    if (hierarchyError !== null) return hierarchyError;
  }
  const axisInvariant = axisError(chart as unknown as BentoChartV4);
  if (axisInvariant !== null) return axisInvariant;
  const cartesianInvariant = cartesianDataError(chart);
  if (cartesianInvariant !== null) return cartesianInvariant;
  if (chart.barWidth !== undefined && (!finite(chart.barWidth) || chart.barWidth <= 0 || chart.barWidth > 1)) return "barWidth must be in (0,1]";
  if (chart.barGap !== undefined && (!finite(chart.barGap) || chart.barGap < 0 || chart.barGap >= 1)) return "barGap must be in [0,1)";
  if (chart.categoryGap !== undefined && (!finite(chart.categoryGap) || chart.categoryGap < 0 || chart.categoryGap >= 1)) return "categoryGap must be in [0,1)";
  if (chart.title !== undefined && !title(chart.title)) return "chart.title is invalid";
  if (chart.legend !== undefined && !legend(chart.legend)) return "chart.legend is invalid";
  if (chart.dataLabels !== undefined && !dataLabels(chart.dataLabels)) return "chart.dataLabels is invalid";
  const globalLabels = chart.dataLabels as BentoChartDataLabelV4 | undefined;
  if (globalLabels?.content !== undefined && series.some((item) => !(LABEL_CONTENTS[item.type] ?? LABEL_CONTENTS.default!).includes(globalLabels.content!))) return "global dataLabels.content is unsupported by a series";
  if (chart.palette !== undefined && (!Array.isArray(chart.palette) || chart.palette.length === 0 || !chart.palette.every(color))) return "chart.palette must contain colors";
  if (chart.fontFamily !== undefined && staticV1FontFamilyError(chart.fontFamily) !== null) return "chart.fontFamily is invalid";
  if (chart.fill !== undefined && !fill(chart.fill)) return "chart.fill is invalid";
  if (dimensions !== undefined) {
    const plotError = chartPlotError(chart, dimensions.width, dimensions.height);
    if (plotError !== null) return plotError;
  }
  return null;
}

/** Purely preview a chart command batch. Non-chart commands are ignored. */
export function bentoChartCommandBatchError(
  chart: BentoChartV4,
  commands: readonly VisualCommandV4[],
  dimensions?: { width: number; height: number },
): string | null {
  const next = structuredClone(chart);
  for (const command of commands) {
    switch (command.type) {
      case "setChartData":
        next.data = structuredClone(command.data);
        break;
      case "setChartSeries":
        if (command.series === null) next.series.splice(command.index, 1);
        else if (command.index === next.series.length) next.series.push(structuredClone(command.series));
        else next.series[command.index] = structuredClone(command.series);
        break;
      case "setChartOption": {
        for (const [key, value] of Object.entries(command.option as ChartOptionPatchV4)) {
          if (value === null || value === undefined) delete (next as unknown as Raw)[key];
          else (next as unknown as Raw)[key] = structuredClone(value);
        }
        break;
      }
      case "setChartPalette":
        if (command.palette === null) delete next.palette;
        else next.palette = [...command.palette];
        break;
    }
  }
  return bentoChartRenderInvariantError(next, dimensions);
}

/** Validate every chart in a candidate document before one command batch commits. */
export function bentoDocChartRenderInvariantError(doc: BentoDocV4, onlyIds?: ReadonlySet<string>): string | null {
  for (const element of doc.elements) {
    if (element.kind !== "chart") continue;
    if (onlyIds !== undefined && !onlyIds.has(element.id)) continue;
    const error = bentoChartRenderInvariantError(element.chart, { width: element.bounds[2], height: element.bounds[3] });
    if (error !== null) return `element ${element.id}: ${error}`;
  }
  return null;
}
