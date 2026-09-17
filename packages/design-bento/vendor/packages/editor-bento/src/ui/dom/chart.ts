/**
 * C2-A chart editor — every durable chart control is a composite editor over
 * the semantic chart value.  A terminal change clones the current canonical
 * series/option, builds one exact setChartSeries/setChartOption command, and
 * lets the bridge refresh the projected SVG.  There is no vendor chart object
 * to mutate here.
 *
 * The panel covers the complete chart Active surface: data, per-series encode
 * and all thirteen types, type-specific style fields, title/legend/labels,
 * axes (including the secondary y axis), spoke axis, bar layout, chart fill /
 * border, font and palette.  seriesDefaults is intentionally not presented as
 * an editor: authoring materializes it into each series at import, so there is
 * no canonical field or reversible command to edit.
 */
import { button, checkbox, colorInput, numberInput, parseNumberInputValue, row, section, select, textInput, type NumberInputOptions } from "./primitives.ts";
import {
  chartCommandBatchError,
  parseChartDataCell,
  chartDataWithSeriesCommands,
  chartOptionCommands,
  chartPaletteCommands,
  removeSecondaryYAxisCommands,
  chartSeriesCommands,
  chartSeriesEncodeKeys,
  chartSeriesNestedPatchCommands,
  chartSeriesPatchCommands,
  chartSeriesTypes,
  type ChartDataCellKind,
  isChartFillValue,
  isChartSeriesFillAtom,
  isChartSeriesFillValue,
  retypeSeries,
  seriesFillRequiresJsonEditor,
} from "../chart.ts";
import { pickImageFile } from "./image.ts";
import { renderFontFamilyControls } from "./font-family.ts";
import { currentDoc, compositeConflictNote, semanticEqual, stagedCropInputs, type PanelContext } from "./context.ts";
import { reconcileStructuredEdit } from "kernel";
import {
  STATIC_V1_SHAPE_PRESETS,
  isStaticV1ShapeName,
  isStaticV1ViewBox,
  staticV1ShapeAdjustmentsError,
  staticV1SvgPathSyntaxError,
} from "contracts";
import type {
  BentoBorder,
  BentoChartAxisV4,
  BentoChartDataLabelV4,
  BentoChartElementV4,
  BentoChartSeriesV4,
  BentoChartSpokeAxisV4,
  BentoChartTextStyleV4,
  BentoColor,
  BentoFillV4,
  BentoFontFamilyV4,
  BentoSeriesFillV4,
  BentoDocV4,
  VisualCommandV4,
} from "contracts";

type Chart = BentoChartElementV4["chart"];
type Loose = Record<string, unknown>;
type SeriesType = (typeof chartSeriesTypes)[number];

const SERIES_TYPES = chartSeriesTypes.map((type) => ({ value: type, label: type }));
const LINE_STYLES = ["solid", "dash", "dot"].map((value) => ({ value, label: value }));
const AXIS_TYPES = ["category", "value"].map((value) => ({ value, label: value }));
const NUMBER_FORMATS = ["", "0", "0.0", "0%", "0.0%", "#,##0", "0.0E+00"]
  .map((value) => ({ value, label: value === "" ? "— none —" : value }));
// Marker and static shape vocabularies are distinct schema surfaces.  The
// marker union has no ellipse; static-v1 shape names come from contracts so
// this editor cannot silently drift from the validator/kernel vocabulary.
const MARKER_SHAPES = ["circle", "rect", "triangle", "diamond"].map((value) => ({ value, label: value }));
const STATIC_V1_SHAPE_NAMES = [...STATIC_V1_SHAPE_PRESETS, "custom"] as const;

function chartOf(element: BentoDocV4["elements"][number]): Chart | null {
  return element.kind === "chart" && element.chart !== undefined ? element.chart : null;
}

/** Every terminal callback re-reads canonical, because the panel DOM can span
 * multiple bridge revisions while focus is retained.  A captured render-frame
 * series/option is only the initial shape used to build controls. */
function currentElement(ctx: PanelContext): BentoDocV4["elements"][number] | null {
  try {
    const doc = currentDoc(ctx.bridge);
    const element = doc.elements.find((candidate) => candidate.id === ctx.element.id);
    return element ?? null;
  } catch {
    return null;
  }
}

function currentChart(ctx: PanelContext): Chart | null {
  const element = currentElement(ctx);
  return element === null ? null : chartOf(element);
}

function currentSeries(ctx: PanelContext, index: number): BentoChartSeriesV4 | null {
  return currentChart(ctx)?.series[index] ?? null;
}

/** Terminal chart write guard. The bridge remains the final authority, but
 * no invalid chart batch reaches it from a DOM gesture. */
function dispatchChart(ctx: PanelContext, commands: readonly VisualCommandV4[]): void {
  const element = currentElement(ctx);
  const chart = element === null ? null : chartOf(element);
  if (chart === null || element === null || chartCommandBatchError(chart, commands, { width: element.bounds[2], height: element.bounds[3] }) !== null) return;
  ctx.dispatch(commands);
}

function loose(value: unknown): Loose {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Loose : {};
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function commitIfChanged<T>(readCurrent: () => unknown, commit: (value: T) => void, next: T): void {
  const current = readCurrent();
  if (semanticEqual(current ?? null, next ?? null)) return;
  commit(next);
}

/** Stable machine-readable capability anchor in addition to command type. */
function mark<T extends HTMLElement>(control: T, capability?: string): T {
  if (capability !== undefined) control.dataset.c2aCapability = capability;
  return control;
}

function chartRow(label: string, control: HTMLElement, capability?: string): HTMLElement {
  const marked = mark(control, capability);
  const reset = (marked as HTMLElement & { c2aReset?: () => void; c2aResetDisabled?: boolean }).c2aReset;
  if (reset === undefined) return row(label, marked);
  const wrap = document.createElement("span");
  wrap.className = "c2a-number-with-reset";
  const resetButton = button("Reset", reset, (marked.dataset.c2aCommand ?? "setChartOption"));
  resetButton.disabled = (marked as HTMLElement & { c2aResetDisabled?: boolean }).c2aResetDisabled === true;
  wrap.append(marked, resetButton);
  return row(label, wrap);
}

function dispatchSeries(ctx: PanelContext, index: number, patch: Loose): void {
  const live = currentSeries(ctx, index);
  if (live === null) return;
  dispatchChart(ctx, chartSeriesPatchCommands(ctx.element.id, index, live, patch));
}

function dispatchSeriesNested(
  ctx: PanelContext,
  index: number,
  key: string,
  nestedKey: string,
  value: unknown,
): void {
  const live = currentSeries(ctx, index);
  if (live === null) return;
  dispatchChart(ctx, chartSeriesNestedPatchCommands(ctx.element.id, index, live, key, nestedKey, value));
}

function selectValue(
  options: readonly { value: string; label: string }[],
  value: string | undefined,
  onChange: (value: string) => void,
  command: string,
): HTMLSelectElement {
  const values = options.some((option) => option.value === value)
    ? options
    : value === undefined ? options : [...options, { value, label: value }];
  return select(values, value ?? "", onChange, command);
}

function optionalNumber(
  value: unknown,
  onChange: (value: number) => void,
  command: string,
  options: NumberInputOptions = {},
  onClear: () => void,
): HTMLInputElement {
  const input = numberInput(finite(value), onChange, options, command) as HTMLInputElement & { c2aReset?: () => void; c2aResetDisabled?: boolean };
  input.c2aReset = onClear;
  input.c2aResetDisabled = finite(value) === undefined;
  return input;
}

function mergedObject(value: unknown, patch: Loose): Loose {
  const next = structuredClone(loose(value));
  for (const [key, item] of Object.entries(patch)) {
    if (item === null || item === undefined || item === "") delete next[key];
    else next[key] = structuredClone(item);
  }
  return next;
}

function optionalText(value: unknown, onChange: (value: string) => void, command: string): HTMLInputElement {
  return textInput(str(value), onChange, command);
}

function optionalBoolean(value: unknown, onChange: (value: boolean) => void, command: string): HTMLInputElement {
  return checkbox(value === true, onChange, command);
}

/** Adapter around the shared lossless family-union editor. */
function fontFamilyEditor(
  host: HTMLElement,
  prefix: string,
  value: unknown,
  commit: (value: unknown) => void,
  capability: string,
  command: string,
  readCurrent: () => unknown = () => value,
): void {
  const staging = document.createElement("span");
  renderFontFamilyControls({
    host: staging,
    label: prefix,
    initial: value as BentoFontFamilyV4 | undefined,
    onCommit: commit as (family: BentoFontFamilyV4 | null) => void,
    command,
    readCurrent: () => readCurrent() as BentoFontFamilyV4 | undefined,
    prefix: "c2a",
  });
  staging.querySelectorAll<HTMLElement>("input, select").forEach((control) => {
    if (control.dataset.c2aCommand === undefined) control.dataset.c2aCommand = command;
    mark(control, capability);
  });
  host.append(...Array.from(staging.childNodes));
}

function colorValue(value: unknown, fallback = "#4E79A7"): string {
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(value)) return value;
  if (value !== null && typeof value === "object") {
    const stops = (value as { stops?: unknown }).stops;
    if (Array.isArray(stops) && typeof stops[0] === "object" && stops[0] !== null) {
      const color = (stops[0] as { color?: unknown }).color;
      if (typeof color === "string") return color;
    }
  }
  return fallback;
}

function fillFromMode(mode: string, first: string, second: string, angle: number | undefined): BentoSeriesFillV4 {
  if (mode === "linear" || mode === "radial") {
    const value: BentoSeriesFillV4 & { angle?: number } = {
      type: "gradient",
      gradientType: mode,
      stops: [{ position: 0, color: first }, { position: 1, color: second }],
    } as BentoSeriesFillV4 & { angle?: number };
    if (mode === "linear" && angle !== undefined) value.angle = angle;
    return value;
  }
  return first as BentoColor;
}

/** Change only the gradient discriminator while carrying every authored stop
 * and optional angle.  A mode selector is not permission to collapse a
 * multi-stop canonical value into the two-stop convenience default. */
function seriesFillModeValue(
  current: unknown,
  mode: string,
  first: string,
  second: string,
  angle: number | undefined,
  updateEndpoints = false,
): BentoSeriesFillV4 {
  const record = loose(current);
  if ((mode === "linear" || mode === "radial") && record.type === "gradient" && Array.isArray(record.stops)) {
    const next = structuredClone(record);
    next.gradientType = mode;
    if (mode === "radial") delete next.angle;
    if (updateEndpoints) {
      const stops = next.stops as unknown[];
      if (stops[0] !== null && typeof stops[0] === "object") (stops[0] as Loose).color = first;
      if (stops[1] !== null && typeof stops[1] === "object") (stops[1] as Loose).color = second;
    }
    return next as unknown as BentoSeriesFillV4;
  }
  return fillFromMode(mode, first, second, angle);
}

function chartFillFromMode(mode: string, first: string, second: string, angle: number | undefined): BentoFillV4 {
  if (mode === "linear" || mode === "radial") {
    const gradient = {
      type: "gradient" as const,
      gradientType: mode,
      stops: [{ position: 0, color: first }, { position: 1, color: second }],
    } as BentoFillV4 & { angle?: number };
    if (mode === "linear" && angle !== undefined) gradient.angle = angle;
    return gradient;
  }
  return { type: "solid", color: first };
}

function chartFillModeValue(
  current: unknown,
  mode: string,
  first: string,
  second: string,
  angle: number | undefined,
  updateEndpoints = false,
): BentoFillV4 {
  const record = loose(current);
  if ((mode === "linear" || mode === "radial") && record.type === "gradient" && Array.isArray(record.stops)) {
    const next = structuredClone(record);
    next.gradientType = mode;
    if (mode === "radial") delete next.angle;
    if (updateEndpoints) {
      const stops = next.stops as unknown[];
      if (stops[0] !== null && typeof stops[0] === "object") (stops[0] as Loose).color = first;
      if (stops[1] !== null && typeof stops[1] === "object") (stops[1] as Loose).color = second;
    }
    return next as unknown as BentoFillV4;
  }
  return chartFillFromMode(mode, first, second, angle);
}

function seriesFieldValue(series: BentoChartSeriesV4, key: string): unknown {
  if (key === "marker.fill") return loose((series as unknown as Loose).marker).fill;
  return (series as unknown as Loose)[key];
}

function liveSeriesFieldValue(ctx: PanelContext, index: number, key: string): unknown {
  const live = currentSeries(ctx, index);
  return live === null ? undefined : seriesFieldValue(live, key);
}

function fillList(value: unknown): BentoSeriesFillV4[] {
  const values: BentoSeriesFillV4[] = Array.isArray(value)
    ? value.filter((item): item is BentoSeriesFillV4 => typeof item === "string" || (item !== null && typeof item === "object"))
    : [value as BentoSeriesFillV4 | undefined].filter((item): item is BentoSeriesFillV4 => item !== undefined);
  return values.length === 0 ? ["#4E79A7" as BentoColor] : values;
}

/**
 * Lossless JSON editor used only for structured fill values.  The validator is
 * selected by the owning host (series type/key or chart host), so malformed
 * JSON, remote image sources, unknown fill shapes, and lossy approximations
 * are rejected before a command reaches the bridge/kernel.
 */
function fillJsonEditor(
  host: HTMLElement,
  label: string,
  value: unknown,
  commit: (value: unknown) => void,
  capability: string,
  command: "setChartSeries" | "setChartOption",
  validate: (value: unknown) => boolean,
): void {
  const input = document.createElement("textarea");
  input.value = JSON.stringify(value ?? null);
  input.rows = 3;
  input.dataset.c2aCommand = command;
  const apply = button(`${label} JSON Apply`, () => {
    try {
      const parsed: unknown = JSON.parse(input.value);
      if (!validate(parsed)) return;
      commit(parsed);
    } catch {
      // Invalid JSON is a no-op.  No guessed/partial fill reaches canonical.
    }
  }, command);
  host.appendChild(chartRow(`${label} JSON`, input, capability));
  host.appendChild(chartRow(`${label} JSON`, apply, capability));
}

function isSimpleSeriesGradient(value: unknown): boolean {
  const current = loose(value);
  return current.type === "gradient" && Array.isArray(current.stops) &&
    current.stops.length === 2 && current.angle === undefined &&
    current.stops[0]?.position === 0 && current.stops[1]?.position === 1;
}

function validAssetSource(value: unknown): value is string {
  return typeof value === "string" && /^asset:[0-9a-f]{64}$/i.test(value);
}

function validCrop(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every((part) => typeof part === "number" && Number.isFinite(part)) &&
    value[0]! + value[2]! < 1 && value[1]! + value[3]! < 1;
}

function chartFillCapability(value: unknown): string {
  const record = loose(value);
  if (record.type === "image") return "fill.image";
  if (record.type === "gradient" && record.gradientType === "radial") return "fill.gradientRadial";
  if (record.type === "gradient" && record.gradientType === "linear") return "fill.gradientLinear";
  return "fill.solid";
}

function isStaticV1Symbol(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Loose;
  if (!isStaticV1ShapeName(record.shapeName)) return false;
  if (Object.keys(record).some((key) => !["shapeName", "adjustments", "viewBox", "path"].includes(key))) return false;
  if (record.adjustments !== undefined && staticV1ShapeAdjustmentsError(record.shapeName, record.adjustments as number[]) !== null) return false;
  if (record.shapeName === "custom") {
    return isStaticV1ViewBox(record.viewBox) && typeof record.path === "string" && staticV1SvgPathSyntaxError(record.path) === null;
  }
  return record.viewBox === undefined && record.path === undefined;
}

function chartGradientAngleEditor(host: HTMLElement, ctx: PanelContext, initial: Loose): void {
  host.appendChild(chartRow("Chart fill angle", optionalNumber(initial.angle, (angle) => {
    const live = loose(currentChart(ctx)?.fill);
    if (live.type !== "gradient" || live.gradientType !== "linear") return;
    const next = { ...live, angle } as unknown as BentoFillV4;
    if (semanticEqual(currentChart(ctx)?.fill ?? null, next)) return;
    dispatchChart(ctx, chartOptionCommands(ctx.element.id, { fill: next }));
  }, "setChartOption", { min: 0, max: 360, maxExclusive: true, step: 1 }, () => {
    const live = loose(currentChart(ctx)?.fill);
    if (live.type !== "gradient" || live.gradientType !== "linear") return;
    const next = { ...live };
    delete next.angle;
    if (semanticEqual(currentChart(ctx)?.fill ?? null, next)) return;
    dispatchChart(ctx, chartOptionCommands(ctx.element.id, { fill: next as unknown as BentoFillV4 }));
  }), "fill.gradientLinear"));
}

/** Series fills are scalar in most types; array variants get an explicit list. */
function seriesFillEditor(
  host: HTMLElement,
  ctx: PanelContext,
  index: number,
  series: BentoChartSeriesV4,
  key: string,
  capability: string,
  commitValue?: (value: unknown) => void,
  valueOverride?: unknown,
): void {
  const value = valueOverride === undefined ? seriesFieldValue(series, key) : valueOverride;
  const commit = (next: unknown): void => {
    if (commitValue !== undefined) commitValue(next);
    else dispatchSeries(ctx, index, { [key]: next });
  };
  // treemap.fill is a 2D palette and sankey.fill is a keyed palette.  Keep
  // every legal structured shape lossless; JSON Apply is a real terminal
  // setChartSeries gesture and the kernel remains the final command gate.
  // Sankey is deliberately keyed by node name, so a node named "type" must
  // never be mistaken for a gradient object merely because that key exists.
  const fillJson = seriesFillRequiresJsonEditor(series, key, value);
  if (fillJson) {
    const jsonValue = value === undefined || value === null ? "#4E79A7" : value;
    fillJsonEditor(
      host,
      key,
      jsonValue,
      commit,
      capability,
      "setChartSeries",
      (parsed) => key === "fill"
        ? isChartSeriesFillValue(series.type, parsed)
        : isChartSeriesFillAtom(parsed),
    );
    // Arrays/keyed palettes and gradients with an authored angle or more
    // than two stops have no safe scalar shortcut.  Their JSON editor is the
    // complete owning surface; do not expose controls that could compress it.
    const currentFill = loose(value);
    const complexGradient = currentFill.type === "gradient" &&
      !isSimpleSeriesGradient(value);
    const keyedPalette = key === "fill" && series.type === "sankey" &&
      value !== null && typeof value === "object" && !Array.isArray(value) && currentFill.type !== "gradient";
    if (complexGradient) {
      if (currentFill.gradientType === "linear") host.appendChild(chartRow(`${key} angle`, optionalNumber(currentFill.angle, (angle) => {
        const latestValue = liveSeriesFieldValue(ctx, index, key);
        if (!isChartSeriesFillAtom(latestValue)) return;
        const latest = loose(latestValue);
        if (latest.type !== "gradient" || latest.gradientType !== "linear") return;
        commit({ ...latest, angle } as unknown as BentoSeriesFillV4);
      }, "setChartSeries", { min: 0, max: 360, maxExclusive: true, step: 1 }, () => {
        const latestValue = liveSeriesFieldValue(ctx, index, key);
        if (!isChartSeriesFillAtom(latestValue)) return;
        const latest = loose(latestValue);
        if (latest.type !== "gradient" || latest.gradientType !== "linear") return;
        const next = { ...latest };
        delete next.angle;
        commit(next as unknown as BentoSeriesFillV4);
      }), capability));
      return;
    }
    if (Array.isArray(value) || keyedPalette) return;
  }
  const list = fillList(value);
  list.forEach((fill, fillIndex) => {
    const current = loose(fill);
    const mode = typeof fill === "string" ? "solid" : str(current.gradientType, "solid");
    const modeControl = selectValue(
      [{ value: "solid", label: "solid" }, { value: "linear", label: "linear" }, { value: "radial", label: "radial" }],
      mode,
      (nextMode) => {
        const latestValue = liveSeriesFieldValue(ctx, index, key);
        const latestList = fillList(latestValue);
        const latestFill = latestList[fillIndex];
        if (latestFill === undefined) return;
        const latest = loose(latestFill);
        const next = [...latestList];
        next[fillIndex] = seriesFillModeValue(latestFill, nextMode, colorValue(latestFill), colorValue(latest.stops && Array.isArray(latest.stops) ? latest.stops[1] : undefined, "#F28E2B"), finite(latest.angle));
        commit(Array.isArray(latestValue) ? next : next[0]);
      },
      "setChartSeries",
    );
    host.appendChild(chartRow(`${key} ${fillIndex + 1} type`, modeControl, capability));
    host.appendChild(chartRow(`${key} ${fillIndex + 1}`, colorInput(colorValue(fill), (color) => {
      const latestValue = liveSeriesFieldValue(ctx, index, key);
      const latestList = fillList(latestValue);
      const latestFill = latestList[fillIndex];
      if (latestFill === undefined) return;
      const latest = loose(latestFill);
      const latestMode = typeof latestFill === "string" ? "solid" : str(latest.gradientType, "solid");
      const next = [...latestList];
      next[fillIndex] = seriesFillModeValue(latestFill, latestMode, color, colorValue(latest.stops && Array.isArray(latest.stops) ? latest.stops[1] : undefined, "#F28E2B"), finite(latest.angle), true);
      commit(Array.isArray(latestValue) ? next : next[0]);
    }, "setChartSeries"), capability));
    if (mode !== "solid") {
      host.appendChild(chartRow(`${key} ${fillIndex + 1} end`, colorInput(colorValue(current.stops && Array.isArray(current.stops) ? current.stops[1] : undefined, "#F28E2B"), (color) => {
        const latestValue = liveSeriesFieldValue(ctx, index, key);
        const latestList = fillList(latestValue);
        const latestFill = latestList[fillIndex];
        if (latestFill === undefined) return;
        const latest = loose(latestFill);
        const latestMode = typeof latestFill === "string" ? "solid" : str(latest.gradientType, "solid");
        const next = [...latestList];
        next[fillIndex] = seriesFillModeValue(latestFill, latestMode, colorValue(latestFill), color, finite(latest.angle), true);
        commit(Array.isArray(latestValue) ? next : next[0]);
      }, "setChartSeries"), capability));
      if (mode === "linear") {
        host.appendChild(chartRow(`${key} ${fillIndex + 1} angle`, optionalNumber(current.angle, (angle) => {
          const latestValue = liveSeriesFieldValue(ctx, index, key);
          const latestList = fillList(latestValue);
          const latestFill = latestList[fillIndex];
          if (!latestFill || !isChartSeriesFillAtom(latestFill)) return;
          const latest = loose(latestFill);
          if (latest.type !== "gradient" || latest.gradientType !== "linear") return;
          const next = [...latestList];
          next[fillIndex] = { ...latest, angle } as BentoSeriesFillV4;
          commit(Array.isArray(latestValue) ? next : next[0]);
        }, "setChartSeries", { min: 0, max: 360, maxExclusive: true, step: 1 }, () => {
          const latestValue = liveSeriesFieldValue(ctx, index, key);
          const latestList = fillList(latestValue);
          const latestFill = latestList[fillIndex];
          if (!latestFill || !isChartSeriesFillAtom(latestFill)) return;
          const latest = loose(latestFill);
          if (latest.type !== "gradient" || latest.gradientType !== "linear") return;
          const nextFill = { ...latest };
          delete nextFill.angle;
          const next = [...latestList];
          next[fillIndex] = nextFill as unknown as BentoSeriesFillV4;
          commit(Array.isArray(latestValue) ? next : next[0]);
        }), capability));
      }
    }
  });
  if (Array.isArray(value)) {
    const strip = document.createElement("div");
    strip.className = "c2a-strip";
    strip.appendChild(button(`+ ${key}`, () => {
      const latestValue = liveSeriesFieldValue(ctx, index, key);
      const latestList = fillList(latestValue);
      commit([...latestList, "#4E79A7"]);
    }, "setChartSeries"));
    if (list.length > 1) strip.appendChild(button(`− ${key}`, () => {
      const latestValue = liveSeriesFieldValue(ctx, index, key);
      const latestList = fillList(latestValue);
      if (latestList.length > 1) commit(latestList.slice(0, -1));
    }, "setChartSeries"));
    host.appendChild(strip);
  }
}

function chartFillEditor(host: HTMLElement, ctx: PanelContext, chart: Chart): void {
  const value = chart.fill;
  const current = loose(value);
  const commitFill = (fill: BentoFillV4): void => {
    dispatchChart(ctx, chartOptionCommands(ctx.element.id, { fill }));
  };
  const mode = typeof value === "string" ? "solid" : str(current.type, "solid") === "image" ? "image" : str(current.gradientType, "solid");
  host.appendChild(chartRow("Chart fill type", selectValue(
    [{ value: "solid", label: "solid" }, { value: "linear", label: "linear" }, { value: "radial", label: "radial" }, { value: "image", label: "image" }],
    mode,
    (nextMode) => {
      const liveChart = currentChart(ctx);
      if (liveChart === null) return;
      const liveValue = liveChart.fill;
      const liveCurrent = loose(liveValue);
      if (nextMode === "image") {
        const existing = str(liveCurrent.src);
        if (validAssetSource(existing)) {
          // A mode change must not throw away already-authored crop/opacity.
          // Keep only image fields when changing from another fill kind so no
          // gradient-only keys can leak into the image union.
          const next: Loose = { type: "image", src: existing, fit: str(liveCurrent.fit, "cover") };
          if (validCrop(liveCurrent.crop)) next.crop = [...liveCurrent.crop];
          if (finite(liveCurrent.opacity) !== undefined) next.opacity = liveCurrent.opacity;
          commitIfChanged(() => currentChart(ctx)?.fill, commitFill, next as unknown as BentoFillV4);
        } else {
          // Image fills are content-addressed assets. Choosing the mode alone
          // never writes an empty/remote src; the picker registers bytes first.
          pickImageFile((assetKey) => {
            const latest = loose(currentChart(ctx)?.fill);
            const next: Loose = { type: "image", src: `asset:${assetKey}`, fit: str(latest.fit, "cover") };
            if (validCrop(latest.crop)) next.crop = [...latest.crop];
            if (finite(latest.opacity) !== undefined) next.opacity = latest.opacity;
            commitIfChanged(() => currentChart(ctx)?.fill, commitFill, next as unknown as BentoFillV4);
          });
        }
      } else {
        const next = chartFillModeValue(liveValue, nextMode, colorValue(liveValue, "#FFFFFF"), colorValue(liveCurrent.stops && Array.isArray(liveCurrent.stops) ? liveCurrent.stops[1] : undefined, "#E5E7EB"), finite(liveCurrent.angle));
        commitIfChanged(() => currentChart(ctx)?.fill, commitFill, next);
      }
    },
    "setChartOption",
  ), "fill.solid"));
  // Structured chart fills always have a lossless owning JSON surface.  It is
  // intentionally strict: image JSON may only retain a registered asset key,
  // so the picker remains the sole path that changes image bytes/source.
  if (isChartFillValue(value)) {
    fillJsonEditor(host, "Chart fill", value, (next) => {
      if (!isChartFillValue(next)) return;
      const live = currentChart(ctx)?.fill;
      const liveObject = loose(live);
      if (next && typeof next === "object" && loose(next).type === "image" &&
          (liveObject.type !== "image" || !validAssetSource(liveObject.src) ||
            !validAssetSource(loose(next).src) || loose(next).src !== liveObject.src)) return;
      commitIfChanged(() => currentChart(ctx)?.fill, commitFill, next);
    }, chartFillCapability(value), "setChartOption", (next) => {
      if (!isChartFillValue(next)) return false;
      const live = currentChart(ctx)?.fill;
      const liveObject = loose(live);
      return loose(next).type !== "image" ||
        (liveObject.type === "image" && validAssetSource(liveObject.src) &&
          validAssetSource(loose(next).src) && loose(next).src === liveObject.src);
    });
  } else {
    // A missing fill is still editable through a valid, lossless default.
    const validateMissingFill = (next: unknown): next is BentoFillV4 => {
      if (!isChartFillValue(next)) return false;
      const live = loose(currentChart(ctx)?.fill);
      const record = loose(next);
      return record.type !== "image" ||
        (live.type === "image" && validAssetSource(live.src) && validAssetSource(record.src) && record.src === live.src);
    };
    fillJsonEditor(host, "Chart fill", { type: "solid", color: "#FFFFFF" }, (next) => {
      if (validateMissingFill(next)) {
        commitIfChanged(() => currentChart(ctx)?.fill, commitFill, next);
      }
    }, "fill.solid", "setChartOption", validateMissingFill);
  }
  if (mode === "image") {
    const assetSrc = validAssetSource(current.src) ? str(current.src) : null;
    const choose = button("Choose chart image…", () => pickImageFile((assetKey) => {
      const liveCurrent = loose(currentChart(ctx)?.fill);
      const next: Loose = { type: "image", src: `asset:${assetKey}`, fit: str(liveCurrent.fit, "cover") };
      if (validCrop(liveCurrent.crop)) next.crop = [...liveCurrent.crop];
      if (finite(liveCurrent.opacity) !== undefined) next.opacity = liveCurrent.opacity;
      commitIfChanged(() => currentChart(ctx)?.fill, commitFill, next as unknown as BentoFillV4);
    }), "setChartOption");
    host.appendChild(chartRow("Chart image", choose, "fill.image"));
    if (assetSrc === null) {
      const missing = textInput("Choose an image file to continue", () => {
        // Asset picker is the only writable path; arbitrary URLs never enter canonical.
      }, "setChartOption");
      missing.disabled = true;
      host.appendChild(chartRow("Chart image", missing, "fill.image"));
    }
    const fitControl = selectValue(
      [{ value: "fill", label: "fill" }, { value: "contain", label: "contain" }, { value: "cover", label: "cover" }],
      str(current.fit, "cover"),
      (fit) => {
        const liveCurrent = loose(currentChart(ctx)?.fill);
        const liveAsset = validAssetSource(liveCurrent.src) ? str(liveCurrent.src) : null;
        if (liveAsset === null) return;
        const next: Loose = { ...liveCurrent, type: "image", src: liveAsset, fit };
        commitIfChanged(() => currentChart(ctx)?.fill, commitFill, next as unknown as BentoFillV4);
      },
      "setChartOption",
    );
    fitControl.disabled = assetSrc === null;
    host.appendChild(chartRow("Chart image fit", fitControl, "fill.image"));

    const cropInitial = validCrop(current.crop) ? [...current.crop] as [number, number, number, number] : undefined;
    // Crop is one owning composite: inputs stage values until Apply.
    const cropInputs = stagedCropInputs(cropInitial, { step: 0.05, command: "setChartOption" });
    (["left", "top", "right", "bottom"] as const).forEach((edge, index) => {
      host.appendChild(chartRow(`Chart image crop ${edge}`, cropInputs[index]!, "fill.image"));
    });
    host.appendChild(button("Apply chart image crop", () => {
      const liveCurrent = loose(currentChart(ctx)?.fill);
      if (!validAssetSource(liveCurrent.src)) return;
      const rawCrop = cropInputs.map((input) => parseNumberInputValue(input.value));
      // Blank optional crop fields preserve the live omission; a partial draft
      // is invalid rather than silently turning into an all-zero crop.
      if (rawCrop.every((part) => part === undefined)) return;
      if (rawCrop.some((part) => part === undefined)) return;
      const crop = rawCrop as [number, number, number, number];
      if (!validCrop(crop)) return;
      const next = { ...liveCurrent, type: "image", src: liveCurrent.src, crop } as unknown as BentoFillV4;
      commitIfChanged(() => currentChart(ctx)?.fill, commitFill, next);
    }, "setChartOption"));
    host.appendChild(button("Reset chart image crop", () => {
      const liveCurrent = loose(currentChart(ctx)?.fill);
      if (!validAssetSource(liveCurrent.src)) return;
      if (!Object.prototype.hasOwnProperty.call(liveCurrent, "crop")) return;
      const next = { ...liveCurrent };
      delete next.crop;
      commitIfChanged(() => currentChart(ctx)?.fill, commitFill, next as unknown as BentoFillV4);
    }, "setChartOption"));
    host.appendChild(chartRow("Chart image opacity", optionalNumber(current.opacity, (opacity) => {
      const liveCurrent = loose(currentChart(ctx)?.fill);
      if (!validAssetSource(liveCurrent.src)) return;
      const next = { ...liveCurrent, type: "image", src: liveCurrent.src, opacity } as unknown as BentoFillV4;
      commitIfChanged(() => currentChart(ctx)?.fill, commitFill, next);
    }, "setChartOption", { min: 0, max: 1, step: 0.05 }, () => {
      const liveCurrent = loose(currentChart(ctx)?.fill);
      if (!validAssetSource(liveCurrent.src)) return;
      if (!Object.prototype.hasOwnProperty.call(liveCurrent, "opacity")) return;
      const next = { ...liveCurrent };
      delete next.opacity;
      commitIfChanged(() => currentChart(ctx)?.fill, commitFill, next as unknown as BentoFillV4);
    }), "fill.image"));
  } else {
    if (mode === "linear") chartGradientAngleEditor(host, ctx, current);
    const complexGradient = current.type === "gradient" &&
      !isSimpleSeriesGradient(value);
    if (complexGradient) return;
    host.appendChild(chartRow("Chart fill", colorInput(colorValue(value, "#FFFFFF"), (color) => {
      const liveValue = currentChart(ctx)?.fill;
      const liveCurrent = loose(liveValue);
      const liveMode = typeof liveValue === "string" ? "solid" : str(liveCurrent.type, "solid") === "image" ? "image" : str(liveCurrent.gradientType, "solid");
      if (liveMode === "image") return;
      const next = chartFillModeValue(liveValue, liveMode, color, colorValue(liveCurrent.stops && Array.isArray(liveCurrent.stops) ? liveCurrent.stops[1] : undefined, "#E5E7EB"), finite(liveCurrent.angle), true);
      commitIfChanged(() => currentChart(ctx)?.fill, commitFill, next);
    }, "setChartOption"), "fill.solid"));
    if (mode !== "solid") host.appendChild(chartRow("Chart fill end", colorInput(colorValue(current.stops && Array.isArray(current.stops) ? current.stops[1] : undefined, "#E5E7EB"), (color) => {
      const liveValue = currentChart(ctx)?.fill;
      const liveCurrent = loose(liveValue);
      const liveMode = typeof liveValue === "string" ? "solid" : str(liveCurrent.type, "solid") === "image" ? "image" : str(liveCurrent.gradientType, "solid");
      if (liveMode === "solid" || liveMode === "image") return;
      const next = chartFillModeValue(liveValue, liveMode, colorValue(liveValue, "#FFFFFF"), color, finite(liveCurrent.angle), true);
      commitIfChanged(() => currentChart(ctx)?.fill, commitFill, next);
    }, "setChartOption"), mode === "linear" ? "fill.gradientLinear" : "fill.gradientRadial"));
  }
}

/** Lossless JSON composite for structured chart fields with closed unions. */
function seriesJsonEditor(
  host: HTMLElement,
  label: string,
  value: unknown,
  commit: (value: unknown) => void,
  capability: string,
  validate: (value: unknown) => boolean = (candidate) => candidate === null || (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)),
): void {
  const input = document.createElement("textarea");
  input.value = JSON.stringify(value ?? null);
  input.rows = 2;
  input.dataset.c2aCommand = "setChartSeries";
  const apply = button(`${label} Apply`, () => {
    try {
      const parsed: unknown = JSON.parse(input.value);
      if (!validate(parsed)) return;
      commit(parsed);
    } catch {
      // Invalid JSON is a no-op; kernel remains the final schema validator.
    }
  }, "setChartSeries");
  host.appendChild(chartRow(label, input, capability));
  host.appendChild(chartRow(label, apply, capability));
}

function borderEditor(
  host: HTMLElement,
  label: string,
  border: unknown,
  commit: (next: BentoBorder | null) => void,
  capability: string,
  command: string,
  readCurrent: () => unknown = () => border,
): void {
  const current = loose(border);
  const commitBorder = (next: BentoBorder | null): void => {
    const live = readCurrent();
    if (semanticEqual(live ?? null, next)) return;
    commit(next);
  };
  host.appendChild(chartRow(`${label} style`, selectValue(
    [{ value: "", label: "— none —" }, ...LINE_STYLES],
    str(current.style),
    (style) => {
      if (style === "") { commitBorder(null); return; }
      const live = mergedObject(readCurrent(), {});
      const next: BentoBorder = { style: style as "solid" | "dash" | "dot" };
      if (finite(live.width) !== undefined) next.width = finite(live.width);
      if (typeof live.color === "string") next.color = live.color;
      commitBorder(next);
    },
    command,
  ), capability));
  if (str(current.style) !== "") {
    host.appendChild(chartRow(`${label} width`, optionalNumber(current.width, (width) => {
      const live = mergedObject(readCurrent(), {});
      const next: BentoBorder = { width };
      if (typeof live.style === "string") next.style = live.style as "solid" | "dash" | "dot";
      if (typeof live.color === "string") next.color = live.color;
      commitBorder(next);
    }, command, { min: 0, minExclusive: true, step: 0.5 }, () => {
      const next = mergedObject(readCurrent(), { width: null });
      commitBorder(Object.keys(next).length === 0 ? null : next as BentoBorder);
    }), capability));
    host.appendChild(chartRow(`${label} color`, colorInput(colorValue(current.color, "#1A1D24"), (color) => {
      const live = mergedObject(readCurrent(), {});
      const next: BentoBorder = { color };
      if (typeof live.style === "string") next.style = live.style as "solid" | "dash" | "dot";
      if (finite(live.width) !== undefined) next.width = finite(live.width);
      commitBorder(next);
    }, command), capability));
  }
}

function textStyleEditor(
  host: HTMLElement,
  prefix: string,
  value: unknown,
  commit: (patch: Loose) => void,
  capability: string,
  command: string,
  readCurrent: () => unknown = () => value,
): void {
  const current = loose(value) as BentoChartTextStyleV4;
  host.appendChild(chartRow(`${prefix} color`, colorInput(colorValue(current.color, "#1A1D24"), (color) => commit({ color }), command), capability));
  host.appendChild(chartRow(`${prefix} size`, optionalNumber(current.fontSize, (fontSize) => commit({ fontSize }), command, { min: 0, minExclusive: true, step: 1 }, () => commit({ fontSize: null })), capability));
  fontFamilyEditor(host, prefix, current.fontFamily, (fontFamily) => commit({ fontFamily }), capability, command, () => loose(readCurrent()).fontFamily);
}

function dataLabelsEditor(
  host: HTMLElement,
  prefix: string,
  value: unknown,
  commit: (patch: Loose) => void,
  capability: string,
  command: string,
  readCurrent: () => unknown = () => value,
): void {
  const current = loose(value) as BentoChartDataLabelV4;
  const commitPatch = (patch: Loose): void => commit(mergedObject(readCurrent(), patch));
  host.appendChild(chartRow(`${prefix} show`, optionalBoolean(current.show, (show) => commitPatch({ show }), command), capability));
  host.appendChild(chartRow(`${prefix} content`, selectValue(
    [{ value: "value", label: "value" }, { value: "percentage", label: "percentage" }, { value: "category", label: "category" }],
    current.content ?? "value",
    (content) => commitPatch({ content }),
    command,
  ), capability));
  host.appendChild(chartRow(`${prefix} format`, selectValue(NUMBER_FORMATS, current.numberFormat ?? "", (numberFormat) => commitPatch({ numberFormat: numberFormat === "" ? null : numberFormat }), command), capability));
  textStyleEditor(host, prefix, current, commitPatch, capability, command, readCurrent);
}

function markerEditor(
  host: HTMLElement,
  ctx: PanelContext,
  index: number,
  series: BentoChartSeriesV4,
  key: string,
  capability: string,
  allowNone: boolean,
): void {
  const value = (series as unknown as Loose)[key];
  const current = value === false ? {} : loose(value);
  const mode = value === false ? "none" : str(current.shape, "circle");
  host.appendChild(chartRow(`${key} shape`, selectValue(
    (allowNone ? [{ value: "none", label: "— none —" }, ...MARKER_SHAPES] : MARKER_SHAPES),
    allowNone && mode === "none" ? "none" : mode,
    (shape) => {
      const live = currentSeries(ctx, index);
      if (live === null) return;
      const liveMarker = loose((live as unknown as Loose)[key]);
      if (shape === "none" && allowNone) dispatchSeries(ctx, index, { [key]: false });
      else dispatchSeries(ctx, index, { [key]: { ...liveMarker, shape } });
    },
    "setChartSeries",
  ), capability));
  if (mode !== "none") {
    host.appendChild(chartRow(`${key} size`, optionalNumber(current.size, (size) => dispatchSeriesNested(ctx, index, key, "size", size), "setChartSeries", { min: 0, minExclusive: true, step: 1 }, () => dispatchSeriesNested(ctx, index, key, "size", null)), capability));
    // Marker fill is nested; the fill editor's explicit commit callback keeps
    // the generated patch at marker.fill instead of inventing series.fill.
    seriesFillEditor(host, ctx, index, series, "marker.fill", capability, (fill) => {
      dispatchSeriesNested(ctx, index, key, "fill", fill);
    }, current.fill);
    borderEditor(host, `${key} border`, current.border, (border) => dispatchSeriesNested(ctx, index, key, "border", border), capability, "setChartSeries", () => loose((currentSeries(ctx, index) as unknown as Loose | null)?.[key]).border);
  }
}

function lineSeriesEditor(host: HTMLElement, ctx: PanelContext, index: number, series: BentoChartSeriesV4, capability: string, area: boolean): void {
  const rec = series as unknown as Loose;
  host.appendChild(chartRow("Smooth", optionalBoolean(rec.smooth, (smooth) => dispatchSeries(ctx, index, { smooth }), "setChartSeries"), capability));
  host.appendChild(chartRow("Line style", selectValue(LINE_STYLES, str(rec.lineStyle, "solid"), (lineStyle) => dispatchSeries(ctx, index, { lineStyle }), "setChartSeries"), capability));
  host.appendChild(chartRow("Line width", optionalNumber(rec.width, (width) => dispatchSeries(ctx, index, { width }), "setChartSeries", { min: 0, minExclusive: true, step: 0.5 }, () => dispatchSeries(ctx, index, { width: null })), capability));
  host.appendChild(chartRow("Null handling", selectValue(
    [{ value: "zero", label: "zero" }, { value: "gap", label: "gap" }, { value: "connect", label: "connect" }],
    str(rec.nullHandling, "gap"),
    (nullHandling) => dispatchSeries(ctx, index, { nullHandling }),
    "setChartSeries",
  ), capability));
  seriesFillEditor(host, ctx, index, series, "lineColor", capability);
  markerEditor(host, ctx, index, series, "marker", capability, true);
  if (area) {
    host.appendChild(chartRow("Area stack", selectValue(
      [{ value: "", label: "— none —" }, { value: "value", label: "value" }, { value: "percent", label: "percent" }, { value: "stream", label: "stream" }],
      str(rec.stack),
      (stack) => dispatchSeries(ctx, index, { stack: stack === "" ? null : stack }),
      "setChartSeries",
    ), capability));
    seriesFillEditor(host, ctx, index, series, "areaColor", capability);
  }
}

function filterEditor(host: HTMLElement, ctx: PanelContext, index: number, series: BentoChartSeriesV4, chart: Chart, capability: string): void {
  const filter = loose((series as unknown as Loose).dataFilter);
  host.appendChild(chartRow("Filter column", selectValue(
    [{ value: "", label: "— none —" }, ...chart.data.cols.map((value) => ({ value, label: value }))],
    str(filter.col),
    (col) => {
      const live = currentSeries(ctx, index);
      if (live === null) return;
      const liveFilter = loose((live as unknown as Loose).dataFilter);
      if (col === "") dispatchSeries(ctx, index, { dataFilter: null });
      else dispatchSeries(ctx, index, { dataFilter: { col, value: str(liveFilter.value) } });
    },
    "setChartSeries",
  ), capability));
  if (str(filter.col) !== "") host.appendChild(chartRow("Filter value", optionalText(filter.value, (value) => {
    const live = currentSeries(ctx, index);
    if (live === null) return;
    const liveFilter = loose((live as unknown as Loose).dataFilter);
    dispatchSeries(ctx, index, { dataFilter: { col: str(liveFilter.col, str(filter.col)), value } });
  }, "setChartSeries"), capability));
}

function barEditor(host: HTMLElement, ctx: PanelContext, index: number, series: BentoChartSeriesV4, capability: string): void {
  const rec = series as unknown as Loose;
  host.appendChild(chartRow("Bar stack", selectValue(
    [{ value: "", label: "— none —" }, { value: "value", label: "value" }, { value: "percent", label: "percent" }],
    str(rec.stack),
    (stack) => dispatchSeries(ctx, index, { stack: stack === "" ? null : stack }),
    "setChartSeries",
  ), capability));
  seriesFillEditor(host, ctx, index, series, "fill", capability);
  borderEditor(host, "Bar border", rec.border, (border) => dispatchSeries(ctx, index, { border }), capability, "setChartSeries", () => (currentSeries(ctx, index) as unknown as Loose | null)?.border);
  seriesJsonEditor(
    host,
    `Bar symbol JSON (${STATIC_V1_SHAPE_NAMES.join("/")})`,
    rec.symbol,
    (symbol) => dispatchSeries(ctx, index, { symbol }),
    capability,
    (symbol) => symbol === null || isStaticV1Symbol(symbol),
  );
}

function scatterEditor(host: HTMLElement, ctx: PanelContext, index: number, series: BentoChartSeriesV4, chart: Chart, capability: string): void {
  const rec = series as unknown as Loose;
  filterEditor(host, ctx, index, series, chart, capability);
  markerEditor(host, ctx, index, series, "marker", capability, false);
  seriesFillEditor(host, ctx, index, series, "fill", capability);
  borderEditor(host, "Scatter border", rec.border, (border) => dispatchSeries(ctx, index, { border }), capability, "setChartSeries", () => (currentSeries(ctx, index) as unknown as Loose | null)?.border);
}

function bubbleEditor(host: HTMLElement, ctx: PanelContext, index: number, series: BentoChartSeriesV4, chart: Chart, capability: string): void {
  const rec = series as unknown as Loose;
  filterEditor(host, ctx, index, series, chart, capability);
  host.appendChild(chartRow("Size scale", selectValue(
    [{ value: "linear", label: "linear" }, { value: "sqrt", label: "sqrt" }, { value: "log", label: "log" }],
    str(rec.sizeScale, "linear"),
    (sizeScale) => dispatchSeries(ctx, index, { sizeScale }),
    "setChartSeries",
  ), capability));
  const range = Array.isArray(rec.sizeRange) ? rec.sizeRange as unknown[] : [];
  host.appendChild(chartRow("Size min", optionalNumber(range[0], (size) => {
    const live = currentSeries(ctx, index);
    if (live === null) return;
    const latest = (live as unknown as Loose).sizeRange;
    const latestRange = Array.isArray(latest) ? latest as unknown[] : [];
    dispatchSeries(ctx, index, { sizeRange: [size, finite(latestRange[1]) ?? size + 1] });
  }, "setChartSeries", { step: 1 }, () => dispatchSeries(ctx, index, { sizeRange: null })), capability));
  host.appendChild(chartRow("Size max", optionalNumber(range[1], (size) => {
    const live = currentSeries(ctx, index);
    if (live === null) return;
    const latest = (live as unknown as Loose).sizeRange;
    const latestRange = Array.isArray(latest) ? latest as unknown[] : [];
    dispatchSeries(ctx, index, { sizeRange: [finite(latestRange[0]) ?? 0, size] });
  }, "setChartSeries", { step: 1 }, () => dispatchSeries(ctx, index, { sizeRange: null })), capability));
  seriesFillEditor(host, ctx, index, series, "fill", capability);
  borderEditor(host, "Bubble border", rec.border, (border) => dispatchSeries(ctx, index, { border }), capability, "setChartSeries", () => (currentSeries(ctx, index) as unknown as Loose | null)?.border);
}

function candleEditor(host: HTMLElement, ctx: PanelContext, index: number, series: BentoChartSeriesV4, capability: string): void {
  const rec = series as unknown as Loose;
  for (const [key, label, fallback] of [["upBars", "Up bars", "#2E9F5B"], ["downBars", "Down bars", "#D64545"]] as const) {
    const bars = loose(rec[key]);
    host.appendChild(chartRow(`${label} fill`, colorInput(colorValue(bars.fill, fallback), (fill) => dispatchSeriesNested(ctx, index, key, "fill", fill), "setChartSeries"), capability));
    borderEditor(host, label, bars.border, (border) => dispatchSeriesNested(ctx, index, key, "border", border), capability, "setChartSeries", () => loose((currentSeries(ctx, index) as unknown as Loose | null)?.[key]).border);
  }
  borderEditor(host, "Wick", rec.wickStyle, (border) => dispatchSeries(ctx, index, { wickStyle: border }), capability, "setChartSeries", () => (currentSeries(ctx, index) as unknown as Loose | null)?.wickStyle);
}

function pieEditor(host: HTMLElement, ctx: PanelContext, index: number, series: BentoChartSeriesV4, capability: string): void {
  const rec = series as unknown as Loose;
  host.appendChild(chartRow("Inner radius", optionalNumber(rec.innerRadius, (innerRadius) => dispatchSeries(ctx, index, { innerRadius }), "setChartSeries", { min: 0, max: 1, step: 0.05 }, () => dispatchSeries(ctx, index, { innerRadius: null })), capability));
  host.appendChild(chartRow("Start angle", optionalNumber(rec.startAngle, (startAngle) => dispatchSeries(ctx, index, { startAngle }), "setChartSeries", { step: 1 }, () => dispatchSeries(ctx, index, { startAngle: null })), capability));
  seriesFillEditor(host, ctx, index, series, "fill", capability);
  borderEditor(host, "Pie border", rec.border, (border) => dispatchSeries(ctx, index, { border }), capability, "setChartSeries", () => (currentSeries(ctx, index) as unknown as Loose | null)?.border);
}

function radarEditor(host: HTMLElement, ctx: PanelContext, index: number, series: BentoChartSeriesV4, capability: string): void {
  lineSeriesEditor(host, ctx, index, series, capability, false);
  seriesFillEditor(host, ctx, index, series, "areaColor", capability);
}

function waterfallEditor(host: HTMLElement, ctx: PanelContext, index: number, series: BentoChartSeriesV4, capability: string): void {
  const rec = series as unknown as Loose;
  for (const [key, label, fallback] of [["totalBars", "Total bars", "#4E79A7"], ["increaseBars", "Increase bars", "#2E9F5B"], ["decreaseBars", "Decrease bars", "#D64545"]] as const) {
    const bars = loose(rec[key]);
    host.appendChild(chartRow(`${label} fill`, colorInput(colorValue(bars.fill, fallback), (fill) => dispatchSeriesNested(ctx, index, key, "fill", fill), "setChartSeries"), capability));
    borderEditor(host, label, bars.border, (border) => dispatchSeriesNested(ctx, index, key, "border", border), capability, "setChartSeries", () => loose((currentSeries(ctx, index) as unknown as Loose | null)?.[key]).border);
  }
}

function heatmapEditor(host: HTMLElement, ctx: PanelContext, index: number, series: BentoChartSeriesV4, capability: string): void {
  const rec = series as unknown as Loose;
  const scheme = Array.isArray(rec.colorScheme) ? rec.colorScheme.filter((color): color is string => typeof color === "string") : ["#2166AC", "#F7F7F7", "#B2182B"];
  const liveScheme = (): string[] => {
    const live = currentSeries(ctx, index);
    const value = live === null ? undefined : (live as unknown as Loose).colorScheme;
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value as string[]] : ["#2166AC", "#F7F7F7", "#B2182B"];
  };
  scheme.forEach((color, colorIndex) => host.appendChild(chartRow(`Color ${colorIndex + 1}`, colorInput(color, (nextColor) => {
    const next = liveScheme();
    if (next[colorIndex] === undefined) return;
    next[colorIndex] = nextColor;
    dispatchSeries(ctx, index, { colorScheme: next });
  }, "setChartSeries"), capability)));
  const strip = document.createElement("div"); strip.className = "c2a-strip";
  strip.appendChild(button("+ Scheme", () => dispatchSeries(ctx, index, { colorScheme: [...liveScheme(), "#4E79A7"] }), "setChartSeries"));
  if (scheme.length > 2) strip.appendChild(button("− Scheme", () => {
    const next = liveScheme();
    if (next.length > 2) dispatchSeries(ctx, index, { colorScheme: next.slice(0, -1) });
  }, "setChartSeries"));
  host.appendChild(strip);
  const scale = loose(rec.colorScale);
  const liveScale = (): Loose => {
    const live = currentSeries(ctx, index);
    return live === null ? {} : loose((live as unknown as Loose).colorScale);
  };
  host.appendChild(chartRow("Color scale", selectValue([{ value: "linear", label: "linear" }, { value: "diverging", label: "diverging" }], str(scale.type, "linear"), (type) => {
    const latest = liveScale();
    dispatchSeries(ctx, index, { colorScale: { ...latest, type } });
  }, "setChartSeries"), capability));
  const domain = Array.isArray(scale.domain) ? scale.domain as unknown[] : [];
  host.appendChild(chartRow("Scale min", optionalNumber(domain[0], (min) => {
    const latest = liveScale();
    const latestDomain = Array.isArray(latest.domain) ? latest.domain as unknown[] : [];
    dispatchSeries(ctx, index, { colorScale: { ...latest, domain: [min, finite(latestDomain[1]) ?? min + 1] } });
  }, "setChartSeries", { step: 0.1 }, () => {
    const next = mergedObject(liveScale(), { domain: null });
    dispatchSeries(ctx, index, { colorScale: Object.keys(next).length === 0 ? null : next });
  }), capability));
  host.appendChild(chartRow("Scale max", optionalNumber(domain[1], (max) => {
    const latest = liveScale();
    const latestDomain = Array.isArray(latest.domain) ? latest.domain as unknown[] : [];
    dispatchSeries(ctx, index, { colorScale: { ...latest, domain: [finite(latestDomain[0]) ?? 0, max] } });
  }, "setChartSeries", { step: 0.1 }, () => {
    const next = mergedObject(liveScale(), { domain: null });
    dispatchSeries(ctx, index, { colorScale: Object.keys(next).length === 0 ? null : next });
  }), capability));
  const colorbar = rec.colorbar;
  const colorbarIsObject = typeof colorbar === "object" && colorbar !== null && !Array.isArray(colorbar);
  // A boolean colorbar is a valid shorthand.  Keep its show representation
  // until a style/position control is edited, but expose the full owning
  // composite so a user can materialize BentoChartLegendV4 without losing the
  // current visibility.
  const colorbarObject = colorbarIsObject ? colorbar as Loose : { show: colorbar === true };
  host.appendChild(chartRow("Colorbar", optionalBoolean(colorbarObject.show, (show) => {
    const live = currentSeries(ctx, index);
    if (live === null) return;
    const latest = (live as unknown as Loose).colorbar;
    if (typeof latest === "object" && latest !== null && !Array.isArray(latest)) dispatchSeriesNested(ctx, index, "colorbar", "show", show);
    else dispatchSeries(ctx, index, { colorbar: show });
  }, "setChartSeries"), capability));
  {
    host.appendChild(chartRow("Colorbar position", selectValue(
      [{ value: "top", label: "top" }, { value: "bottom", label: "bottom" }, { value: "left", label: "left" }, { value: "right", label: "right" }],
      str(colorbarObject.position, "right"),
      (position) => {
        const live = currentSeries(ctx, index);
        if (live === null) return;
        const latest = (live as unknown as Loose).colorbar;
        const latestObject = typeof latest === "object" && latest !== null && !Array.isArray(latest)
          ? latest as Loose
          : { show: latest === true };
        dispatchSeries(ctx, index, { colorbar: { ...latestObject, position } });
      },
      "setChartSeries",
    ), capability));
    textStyleEditor(host, "Colorbar", colorbarObject, (patch) => {
      const live = currentSeries(ctx, index);
      if (live === null) return;
      const latest = (live as unknown as Loose).colorbar;
      const latestObject = typeof latest === "object" && latest !== null && !Array.isArray(latest)
        ? latest as Loose
        : { show: latest === true };
      dispatchSeries(ctx, index, { colorbar: mergedObject(latestObject, patch) });
    }, capability, "setChartSeries", () => {
      const latest = (currentSeries(ctx, index) as unknown as Loose | null)?.colorbar;
      return typeof latest === "object" && latest !== null && !Array.isArray(latest) ? latest : { show: latest === true };
    });
  }
}

function hierarchyEditor(host: HTMLElement, ctx: PanelContext, index: number, series: BentoChartSeriesV4, capability: string, sankey = false): void {
  const rec = series as unknown as Loose;
  if (!sankey) host.appendChild(chartRow("Levels", optionalNumber(rec.levels, (levels) => dispatchSeries(ctx, index, { levels }), "setChartSeries", { min: 1, step: 1 }, () => dispatchSeries(ctx, index, { levels: null })), capability));
  if (sankey) host.appendChild(chartRow("Node align", selectValue([{ value: "left", label: "left" }, { value: "right", label: "right" }, { value: "justify", label: "justify" }], str(rec.nodeAlign, "justify"), (nodeAlign) => dispatchSeries(ctx, index, { nodeAlign }), "setChartSeries"), capability));
  seriesFillEditor(host, ctx, index, series, "fill", capability);
  borderEditor(host, sankey ? "Sankey border" : "Hierarchy border", rec.border, (border) => dispatchSeries(ctx, index, { border }), capability, "setChartSeries", () => (currentSeries(ctx, index) as unknown as Loose | null)?.border);
}

function typeSpecificEditor(host: HTMLElement, ctx: PanelContext, index: number, series: BentoChartSeriesV4, chart: Chart): void {
  const capability = `chart.${series.type}`;
  if (series.type === "bar") barEditor(host, ctx, index, series, capability);
  else if (series.type === "line") lineSeriesEditor(host, ctx, index, series, capability, false);
  else if (series.type === "area") lineSeriesEditor(host, ctx, index, series, capability, true);
  else if (series.type === "scatter") scatterEditor(host, ctx, index, series, chart, capability);
  else if (series.type === "bubble") bubbleEditor(host, ctx, index, series, chart, capability);
  else if (series.type === "candlestick") candleEditor(host, ctx, index, series, capability);
  else if (series.type === "pie") pieEditor(host, ctx, index, series, capability);
  else if (series.type === "radar") radarEditor(host, ctx, index, series, capability);
  else if (series.type === "waterfall") waterfallEditor(host, ctx, index, series, capability);
  else if (series.type === "heatmap") heatmapEditor(host, ctx, index, series, capability);
  else if (series.type === "treemap") hierarchyEditor(host, ctx, index, series, capability);
  else if (series.type === "sunburst") hierarchyEditor(host, ctx, index, series, capability);
  else hierarchyEditor(host, ctx, index, series, capability, true);
  // dataLabels is optional in canonical data, but an optional field is still
  // an authoring surface.  Candlestick is the only series type without this
  // field; all other series (including waterfall) get an empty composite when
  // absent.
  if (series.type !== "candlestick") {
    const labels = loose((series as unknown as Loose).dataLabels);
    dataLabelsEditor(host, `${series.type} labels`, labels, (patch) => {
      const live = currentSeries(ctx, index);
      if (live === null) return;
      dispatchSeries(ctx, index, { dataLabels: mergedObject((live as unknown as Loose).dataLabels, patch) });
    }, capability, "setChartSeries", () => (currentSeries(ctx, index) as unknown as Loose | null)?.dataLabels);
  }
}

function encodeEditor(host: HTMLElement, ctx: PanelContext, index: number, series: BentoChartSeriesV4, chart: Chart): void {
  const rec = series as unknown as Loose;
  const encode = loose(rec.encode);
  const keys = chartSeriesEncodeKeys[series.type];
  keys.forEach((key) => {
    const optional = key === "open" || key === "parent" || key === "isTotal";
    const options = optional
      ? [{ value: "", label: "— none —" }, ...chart.data.cols.map((value) => ({ value, label: value }))]
      : chart.data.cols.map((value) => ({ value, label: value }));
    host.appendChild(chartRow(`Encode ${key}`, selectValue(options, str(encode[key]), (value) => {
      const liveChart = currentChart(ctx);
      const liveSeries = currentSeries(ctx, index);
      if (liveChart === null || liveSeries === null) return;
      const next = { ...loose((liveSeries as unknown as Loose).encode) };
      if (value === "" && optional) delete next[key];
      else if (value === "") return;
      else next[key] = value;
      dispatchSeries(ctx, index, { encode: next });
    }, "setChartSeries"), "chart.encode"));
  });
}

function seriesEditor(host: HTMLElement, ctx: PanelContext, chart: Chart): void {
  host.appendChild(section("Series (13 types / encode / styles)"));
  const seriesList = document.createElement("div");
  seriesList.className = "c2a-chart-series-list";
  chart.series.forEach((series, index) => {
    const seriesHost = document.createElement("div");
    seriesHost.className = "c2a-chart-series";
    seriesHost.dataset.c2aSeriesIndex = String(index);
    seriesList.appendChild(seriesHost);
    seriesHost.appendChild(chartRow(`Series ${index + 1} name`, textInput(series.name ?? "", (value) => dispatchSeries(ctx, index, { name: value.trim() === "" ? null : value.trim() }), "setChartSeries"), "chart.typeMixing"));
    seriesHost.appendChild(chartRow(`Series ${index + 1} type`, selectValue(SERIES_TYPES, series.type, (type) => {
      const liveChart = currentChart(ctx);
      const liveSeries = liveChart?.series[index];
      if (liveChart === null || liveChart === undefined || liveSeries === undefined) return;
      const next = retypeSeries(liveSeries, type as SeriesType, liveChart.data.cols);
      if (next === null) return;
      dispatchChart(ctx, chartSeriesCommands(ctx.element.id, index, next));
    }, "setChartSeries"), "chart.typeMixing"));
    const yAxisValue = series.yAxisIndex === undefined ? "" : String(series.yAxisIndex);
    const yAxisControl = selectValue(
      [
        { value: "", label: "primary (unset)" },
        { value: "0", label: "primary (0)" },
        { value: "1", label: "secondary (1)" },
      ],
      yAxisValue,
      (value) => {
        const liveChart = currentChart(ctx);
        const liveSeries = currentSeries(ctx, index);
        if (liveChart === null || liveSeries === null) return;
        if (value === "1" && !hasSecondaryYAxis(liveChart)) return;
        if (value !== "" && value !== "0" && value !== "1") return;
        dispatchSeries(ctx, index, { yAxisIndex: value === "" ? null : Number(value) });
      },
      "setChartSeries",
    );
    const secondaryOption = yAxisControl.querySelector<HTMLOptionElement>('option[value="1"]');
    if (secondaryOption !== null && !hasSecondaryYAxis(chart)) secondaryOption.disabled = true;
    seriesHost.appendChild(chartRow(`Series ${index + 1} y axis`, yAxisControl, "chart.axisSecondary"));
    encodeEditor(seriesHost, ctx, index, series, chart);
    typeSpecificEditor(seriesHost, ctx, index, series, chart);
  });
  host.appendChild(seriesList);
  const strip = document.createElement("div"); strip.className = "c2a-strip";
  strip.appendChild(button("+ Series", () => {
    const liveChart = currentChart(ctx);
    if (liveChart === null) return;
    if (liveChart.data.cols.length < 2) return;
    const next = retypeSeries({ type: "bar", name: `Series ${liveChart.series.length + 1}`, encode: { x: liveChart.data.cols[0]!, y: liveChart.data.cols[1]! } }, "bar", liveChart.data.cols);
    if (next === null) return;
    dispatchChart(ctx, chartSeriesCommands(ctx.element.id, liveChart.series.length, next));
  }, "setChartSeries"));
  if (chart.series.length > 1) strip.appendChild(button("Remove last", () => {
    const liveChart = currentChart(ctx);
    if (liveChart !== null && liveChart.series.length > 1) dispatchChart(ctx, chartSeriesCommands(ctx.element.id, liveChart.series.length - 1, null));
  }, "setChartSeries"));
  host.appendChild(strip);
}

/** Data table editor: grid changes remain local until the Apply gesture. */
function dataEditor(host: HTMLElement, ctx: PanelContext, chart: Chart): void {
  const dataEditorHost = document.createElement("div");
  dataEditorHost.className = "c2a-chart-data-editor";
  dataEditorHost.dataset.c2aChartDataEditor = ctx.element.id;
  dataEditorHost.dataset.c2aDraftPending = "false";
  host.appendChild(dataEditorHost);
  const markDraftPending = (): void => { dataEditorHost.dataset.c2aDraftPending = "true"; };
  dataEditorHost.appendChild(section("Data"));
  // Keep the mounted composite snapshot separate from the live chart.  The
  // grid can stay open while another control (or another history operation)
  // edits a sibling field; Apply must merge only the cells/columns the user
  // actually changed and fail closed on a same-field or shape conflict.
  // `dataEditor` stays mounted across terminal Apply gestures.  Keep the
  // last accepted canonical data as the merge base instead of freezing the
  // first render's `chart.data`; otherwise a second local row/column edit is
  // compared with a stale shape and is rejected (or can clobber a sibling).
  let committedData = structuredClone(chart.data);
  const state: { cols: string[]; rows: (number | string | null)[][] } = {
    cols: [...chart.data.cols],
    rows: chart.data.rows.map((rowOf) => [...rowOf]),
  };
  // The panel re-renders on a 200ms poll, but a history operation (the
  // undo/redo proof cycle) can land and revert inside one poll window while
  // this editor stays mounted with a stale merge base; merging a structural
  // draft against that base is a phantom shape conflict that would silently
  // drop the Apply.  Rebase an UNTOUCHED draft onto the live canonical before
  // any structural gesture or Apply; a pending draft keeps the three-way
  // merge below so a real concurrent edit still fails closed.
  const conflictNote = compositeConflictNote(
    "c2aChartDataConflict",
    "Chart data changed underneath this draft; the conflicting edit was discarded and the grid reset to the current data.",
  );
  const rebaseToLive = (liveChart: Chart): void => {
    committedData = structuredClone(liveChart.data);
    state.cols = [...liveChart.data.cols];
    state.rows = liveChart.data.rows.map((rowOf) => [...rowOf]);
    // Releasing draft-pending is the wedge recovery: the mount.ts poll guard
    // may re-render again, so a conflicted editor never needs reselection.
    dataEditorHost.dataset.c2aDraftPending = "false";
    conflictNote.hidden = true;
    buildGrid();
  };
  const rebaseIfUntouched = (): boolean => {
    const liveChart = currentChart(ctx);
    if (liveChart === null) return false;
    // Chart-only untouched rebase (inlined one-caller predicate): an untouched
    // draft whose base went stale inside a poll window has nothing
    // user-authored to merge, so adopt the live canonical instead of failing
    // closed on a phantom shape conflict. A pending draft keeps the
    // reconciliation below so a real concurrent edit still fails closed.
    if (dataEditorHost.dataset.c2aDraftPending === "true") return false;
    if (semanticEqual(committedData, liveChart.data)) return false;
    rebaseToLive(liveChart);
    return true;
  };
  const gridHost = document.createElement("div"); gridHost.className = "c2a-gridwrap"; dataEditorHost.appendChild(gridHost);
  const buildGrid = (): void => {
    gridHost.replaceChildren();
    const columnInputs: HTMLInputElement[] = [];
    const cellDrafts: Array<Array<{ input: HTMLInputElement; kind: HTMLSelectElement }>> = [];
    const grid = document.createElement("table"); grid.className = "c2a-grid";
    const header = document.createElement("tr");
    state.cols.forEach((col, index) => {
      const input = document.createElement("input"); input.type = "text"; input.value = col; input.dataset.c2aCommand = "setChartData"; input.dataset.c2aCapability = "chart.data"; input.className = "c2a-gridcell c2a-gridheader";
      columnInputs.push(input);
      input.addEventListener("change", () => {
        markDraftPending();
        const value = input.value.trim();
        if (value !== "") state.cols[index] = value;
      });
      const td = document.createElement("td"); td.appendChild(input); header.appendChild(td);
    });
    grid.appendChild(header);
    state.rows.forEach((rowOf, rowIndex) => {
      const tr = document.createElement("tr");
      const rowDrafts: Array<{ input: HTMLInputElement; kind: HTMLSelectElement }> = [];
      rowOf.forEach((value, colIndex) => {
        const input = document.createElement("input");
        input.type = "text";
        input.value = value === null ? "" : String(value);
        input.dataset.c2aCommand = "setChartData";
        input.dataset.c2aCapability = "chart.data";
        input.className = "c2a-gridcell";
        const initialKind: ChartDataCellKind = value === null ? "null" : typeof value === "number" ? "number" : "string";
        const kind = select(
          [
            { value: "number", label: "number" },
            { value: "string", label: "string" },
            { value: "null", label: "null" },
          ],
          initialKind,
          (rawKind) => {
            markDraftPending();
            const nextKind = rawKind as ChartDataCellKind;
            if (nextKind === "null") {
              input.value = "";
              input.disabled = true;
              state.rows[rowIndex]![colIndex] = null;
              return;
            }
            input.disabled = false;
            const parsed = parseChartDataCell(nextKind, input.value);
            if (parsed !== undefined) state.rows[rowIndex]![colIndex] = parsed;
          },
          "setChartData",
        );
        kind.className = "c2a-gridcell-kind";
        kind.dataset.c2aCapability = "chart.data";
        input.disabled = initialKind === "null";
        input.addEventListener("change", () => {
          markDraftPending();
          const parsed = parseChartDataCell(kind.value as ChartDataCellKind, input.value);
          if (parsed !== undefined) state.rows[rowIndex]![colIndex] = parsed;
        });
        const draft = { input, kind };
        rowDrafts.push(draft);
        const td = document.createElement("td"); td.append(input, kind); tr.appendChild(td);
      });
      cellDrafts.push(rowDrafts);
      grid.appendChild(tr);
    });
    gridHost.appendChild(grid);
    const applyDataButton = button("Apply data", () => {
      // An untouched draft whose base went stale inside a poll window has
      // nothing user-authored to merge; rebase it and dispatch nothing.
      conflictNote.hidden = true;
      if (rebaseIfUntouched()) return;
      let invalid = false;
      const rows = state.rows.map((rowOf, rowIndex) => rowOf.map((fallback, colIndex) => {
        const draft = cellDrafts[rowIndex]?.[colIndex];
        if (draft === undefined) return fallback;
        const parsed = parseChartDataCell(draft.kind.value as ChartDataCellKind, draft.input.value);
        if (parsed === undefined) {
          invalid = true;
          return fallback;
        }
        return parsed;
      }));
      if (invalid) return;
      const next = { cols: columnInputs.map((input) => input.value.trim()), rows };
      const liveChart = currentChart(ctx);
      if (liveChart === null) return;
      const decision = reconcileStructuredEdit(
        committedData,
        liveChart.data,
        dataEditorHost.dataset.c2aDraftPending === "true"
          ? { kind: "replace", value: next }
          : { kind: "unchanged" },
      );
      if (decision.kind === "conflict") {
        // A genuine concurrent-edit conflict fails closed (no dispatch), but
        // it must not wedge the panel behind draft-pending: surface the
        // conflict and rebase onto the live canonical so the next gesture
        // starts from a provable base without reselecting the element.
        rebaseToLive(liveChart);
        conflictNote.hidden = false;
        return;
      }
      if (decision.kind === "noop") return;
      // Chart data has no absent spelling: an apply always carries the merged
      // table. (An absent latest can only reconcile to noop or conflict.)
      const merged = decision.value;
      if (merged === undefined) return;
      const commands = chartDataWithSeriesCommands(ctx.element.id, liveChart.data, merged, liveChart.series);
      if (commands !== null) {
        dispatchChart(ctx, commands);
        // Dispatch is the only write path.  Re-read the committed snapshot so
        // a rejected batch never advances this base, while an accepted batch
        // becomes the base for the next Apply without waiting for a poll.
        const committed = currentChart(ctx);
        if (committed !== null && semanticEqual(committed.data, merged)) {
          committedData = structuredClone(committed.data);
          dataEditorHost.dataset.c2aDraftPending = "false";
          conflictNote.hidden = true;
        }
      }
    }, "setChartData");
    gridHost.appendChild(applyDataButton);
  };
  buildGrid();
  const strip = document.createElement("div"); strip.className = "c2a-strip";
  strip.appendChild(button("+ Row", () => { rebaseIfUntouched(); markDraftPending(); state.rows.push(Array.from({ length: state.cols.length }, () => null)); buildGrid(); }, "setChartData"));
  strip.appendChild(button("+ Col", () => { rebaseIfUntouched(); markDraftPending(); state.cols.push(`Series ${state.cols.length}`); state.rows.forEach((rowOf) => rowOf.push(null)); buildGrid(); }, "setChartData"));
  strip.appendChild(button("− Row", () => { rebaseIfUntouched(); markDraftPending(); if (state.rows.length > 1) state.rows.pop(); buildGrid(); }, "setChartData"));
  strip.appendChild(button("− Col", () => { rebaseIfUntouched(); markDraftPending(); if (state.cols.length > 2) { state.cols.pop(); state.rows.forEach((rowOf) => rowOf.pop()); } buildGrid(); }, "setChartData"));
  dataEditorHost.appendChild(strip);
  dataEditorHost.appendChild(conflictNote);
}

function axisValue(raw: Chart["xAxis"] | Chart["yAxis"], index: number): BentoChartAxisV4 {
  if (Array.isArray(raw)) return structuredClone(raw[index] ?? { type: "value" });
  return structuredClone(raw ?? { type: index === 0 ? "category" : "value" });
}

function hasSecondaryYAxis(chart: Chart): boolean {
  return Array.isArray(chart.yAxis) && chart.yAxis.length > 1;
}

function setAxis(chart: Chart, key: "xAxis" | "yAxis", index: number, next: BentoChartAxisV4): BentoChartAxisV4 | BentoChartAxisV4[] {
  const raw = chart[key];
  if (Array.isArray(raw) || (key === "yAxis" && index > 0)) {
    const values = Array.isArray(raw) ? structuredClone(raw) : [axisValue(raw, 0)];
    values[index] = next;
    return values;
  }
  return next;
}

function currentAxis(ctx: PanelContext, key: "xAxis" | "yAxis", index: number): BentoChartAxisV4 | null {
  const chart = currentChart(ctx);
  return chart === null ? null : axisValue(chart[key], index);
}

function currentAxisObject(ctx: PanelContext, key: "xAxis" | "yAxis", index: number, field: string): Loose {
  const axis = currentAxis(ctx, key, index);
  const value = axis === null ? undefined : (axis as unknown as Loose)[field];
  return value !== null && typeof value === "object" && !Array.isArray(value) ? structuredClone(value) as Loose : {};
}

function currentSpokeAxis(ctx: PanelContext): BentoChartSpokeAxisV4 {
  return structuredClone(currentChart(ctx)?.spokeAxis ?? {}) as BentoChartSpokeAxisV4;
}

function currentSpokeObject(ctx: PanelContext, field: string): Loose {
  const axis = currentSpokeAxis(ctx);
  const value = (axis as unknown as Loose)[field];
  return value !== null && typeof value === "object" && !Array.isArray(value) ? structuredClone(value) as Loose : {};
}

/**
 * Shared axis line/gridLine control block (show + style + width + color),
 * used by both the cartesian axisEditor and spokeAxisEditor.  The mounted
 * snapshot only seeds control values; every terminal gesture re-reads the
 * live object through readObject before patching.
 */
function axisLineGridEditor(
  host: HTMLElement,
  label: string,
  capability: string,
  field: "axisLine" | "gridLine",
  mounted: unknown,
  colorFallback: string,
  readObject: (field: "axisLine" | "gridLine") => Loose,
  commit: (patch: Loose) => void,
): void {
  const line = typeof mounted === "object" ? mounted : {};
  host.appendChild(chartRow(label, optionalBoolean(mounted === true || typeof mounted === "object", (show) => {
    const liveLine = readObject(field);
    commit({ [field]: show ? { ...liveLine } : false });
  }, "setChartOption"), capability));
  host.appendChild(chartRow(`${label} style`, selectValue(LINE_STYLES, str((line as Loose).style, "solid"), (style) => {
    const liveLine = readObject(field);
    commit({ [field]: { ...liveLine, style } });
  }, "setChartOption"), capability));
  host.appendChild(chartRow(`${label} width`, optionalNumber((line as Loose).width, (width) => commit({ [field]: { ...readObject(field), width } }), "setChartOption", { min: 0, minExclusive: true, step: 0.5 }, () => {
    const next = mergedObject(readObject(field), { width: null });
    commit({ [field]: Object.keys(next).length === 0 ? null : next });
  }), capability));
  host.appendChild(chartRow(`${label} color`, colorInput(colorValue((line as Loose).color, colorFallback), (color) => commit({ [field]: { ...readObject(field), color } }), "setChartOption"), capability));
}

function axisEditor(host: HTMLElement, ctx: PanelContext, chart: Chart, key: "xAxis" | "yAxis"): void {
  const capability = key === "yAxis" ? "chart.axisSecondary" : "chart.axisBasic";
  const count = Array.isArray(chart[key]) ? chart[key]!.length : 1;
  for (let index = 0; index < count; index += 1) {
    const prefix = `${key} ${index + 1}`;
    const axis = axisValue(chart[key], index);
    const commit = (patch: Loose): void => {
      const liveChart = currentChart(ctx);
      if (liveChart === null) return;
      const liveAxis = axisValue(liveChart[key], index);
      const next = structuredClone(liveAxis) as unknown as Loose;
      for (const [field, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === "") delete next[field]; else next[field] = structuredClone(value);
      }
      dispatchChart(ctx, chartOptionCommands(ctx.element.id, { [key]: setAxis(liveChart, key, index, next as BentoChartAxisV4) }));
    };
    host.appendChild(chartRow(`${prefix} show`, optionalBoolean(axis.show, (show) => commit({ show }), "setChartOption"), capability));
    host.appendChild(chartRow(`${prefix} type`, selectValue(AXIS_TYPES, axis.type ?? (key === "xAxis" ? "category" : "value"), (type) => commit({ type }), "setChartOption"), capability));
    host.appendChild(chartRow(`${prefix} min`, optionalNumber(axis.min, (min) => commit({ min }), "setChartOption", { step: 0.1 }, () => commit({ min: null })), capability));
    host.appendChild(chartRow(`${prefix} max`, optionalNumber(axis.max, (max) => commit({ max }), "setChartOption", { step: 0.1 }, () => commit({ max: null })), capability));
    host.appendChild(chartRow(`${prefix} reverse`, optionalBoolean(axis.reverse, (reverse) => commit({ reverse }), "setChartOption"), capability));
    const title = typeof axis.title === "string" ? { text: axis.title } : axis.title;
    host.appendChild(chartRow(`${prefix} title`, optionalText(title?.text, (text) => {
      const nextText = text.trim();
      const liveAxis = currentAxis(ctx, key, index);
      const liveTitle = liveAxis === null ? title : typeof liveAxis.title === "string" ? { text: liveAxis.title } : liveAxis.title;
      commit({ title: nextText === "" ? null : { ...(liveTitle ?? {}), text: nextText } });
    }, "setChartOption"), capability));
    textStyleEditor(host, `${prefix} title`, title, (patch) => {
      const liveAxis = currentAxis(ctx, key, index);
      const liveTitle = liveAxis === null ? title : typeof liveAxis.title === "string" ? { text: liveAxis.title } : liveAxis.title;
      commit({ title: { ...mergedObject(liveTitle ?? { text: "Title" }, patch), text: liveTitle?.text ?? "Title" } });
    }, capability, "setChartOption", () => {
      const liveAxis = currentAxis(ctx, key, index);
      return liveAxis === null ? title : typeof liveAxis.title === "string" ? { text: liveAxis.title } : liveAxis.title;
    });
    const label = typeof axis.label === "object" ? axis.label : {};
    host.appendChild(chartRow(`${prefix} labels`, optionalBoolean(axis.label === true || typeof axis.label === "object", (show) => {
      const liveAxis = currentAxis(ctx, key, index);
      const liveLabel = liveAxis !== null && typeof liveAxis.label === "object" ? liveAxis.label : {};
      commit({ label: show ? { ...liveLabel } : false });
    }, "setChartOption"), "chart.axisLabel"));
    host.appendChild(chartRow(`${prefix} format`, selectValue(NUMBER_FORMATS, str((label as Loose).numberFormat), (numberFormat) => {
      const liveLabel = currentAxisObject(ctx, key, index, "label");
      commit({ label: mergedObject(liveLabel, { numberFormat: numberFormat === "" ? null : numberFormat }) });
    }, "setChartOption"), "chart.axisLabel"));
    textStyleEditor(host, `${prefix} label`, label, (patch) => {
      const liveLabel = currentAxisObject(ctx, key, index, "label");
      commit({ label: mergedObject(liveLabel, patch) });
    }, "chart.axisLabel", "setChartOption", () => currentAxisObject(ctx, key, index, "label"));
    const axisLine = typeof axis.axisLine === "object" ? axis.axisLine : {};
    const readAxisObject = (field: "axisLine" | "gridLine"): Loose => currentAxisObject(ctx, key, index, field);
    axisLineGridEditor(host, `${prefix} line`, "chart.axisLineGrid", "axisLine", axis.axisLine, "#1A1D24", readAxisObject, commit);
    const arrowRaw = (axisLine as Loose).arrow;
    const arrowValue = arrowRaw === true ? "true" : typeof arrowRaw === "string" ? arrowRaw : "false";
    host.appendChild(chartRow(`${prefix} line arrow`, selectValue([{ value: "false", label: "none" }, { value: "true", label: "true" }, { value: "start", label: "start" }, { value: "end", label: "end" }, { value: "both", label: "both" }], arrowValue, (arrow) => commit({ axisLine: { ...currentAxisObject(ctx, key, index, "axisLine"), arrow: arrow === "false" ? false : arrow === "true" ? true : arrow } }), "setChartOption"), "chart.axisLineGrid"));
    axisLineGridEditor(host, `${prefix} grid`, "chart.axisLineGrid", "gridLine", axis.gridLine, "#D8DDE3", readAxisObject, commit);
  }
  const strip = document.createElement("div"); strip.className = "c2a-strip";
  if (key === "yAxis" && count < 2) strip.appendChild(button("+ secondary y", () => {
    const liveChart = currentChart(ctx);
    if (liveChart !== null && !hasSecondaryYAxis(liveChart)) {
      dispatchChart(ctx, chartOptionCommands(ctx.element.id, { yAxis: [axisValue(liveChart.yAxis, 0), { type: "value" }] }));
    }
  }, "setChartOption"));
  if (key === "yAxis" && count > 1) {
    const removeSecondary = button("− secondary y", () => {
      const liveChart = currentChart(ctx);
      if (liveChart === null || !hasSecondaryYAxis(liveChart)) return;
      const commands = removeSecondaryYAxisCommands(ctx.element.id, liveChart);
      if (commands !== null) dispatchChart(ctx, commands);
    }, "setChartOption");
    strip.appendChild(removeSecondary);
  }
  host.appendChild(strip);
}

function spokeAxisEditor(host: HTMLElement, ctx: PanelContext, chart: Chart): void {
  const axis = chart.spokeAxis ?? {};
  const commit = (patch: Loose): void => {
    const next = currentSpokeAxis(ctx) as unknown as Loose;
    for (const [key, value] of Object.entries(patch)) { if (value === null || value === undefined || value === "") delete next[key]; else next[key] = structuredClone(value); }
    dispatchChart(ctx, chartOptionCommands(ctx.element.id, { spokeAxis: Object.keys(next).length === 0 ? null : next as BentoChartSpokeAxisV4 }));
  };
  host.appendChild(chartRow("Spoke show", optionalBoolean(axis.show, (show) => commit({ show }), "setChartOption"), "chart.spokeAxis"));
  host.appendChild(chartRow("Spoke min", optionalNumber(axis.min, (min) => commit({ min }), "setChartOption", { step: 0.1 }, () => commit({ min: null })), "chart.spokeAxis"));
  host.appendChild(chartRow("Spoke max", optionalNumber(axis.max, (max) => commit({ max }), "setChartOption", { step: 0.1 }, () => commit({ max: null })), "chart.spokeAxis"));
  const label = typeof axis.label === "object" ? axis.label : {};
  host.appendChild(chartRow("Spoke labels", optionalBoolean(axis.label === true || typeof axis.label === "object", (show) => {
    commit({ label: show ? currentSpokeObject(ctx, "label") : false });
  }, "setChartOption"), "chart.spokeAxis"));
  host.appendChild(chartRow("Spoke format", selectValue(NUMBER_FORMATS, str((label as Loose).numberFormat), (numberFormat) => {
    commit({ label: mergedObject(currentSpokeObject(ctx, "label"), { numberFormat: numberFormat === "" ? null : numberFormat }) });
  }, "setChartOption"), "chart.spokeAxis"));
  textStyleEditor(host, "Spoke label", label, (patch) => commit({ label: mergedObject(currentSpokeObject(ctx, "label"), patch) }), "chart.spokeAxis", "setChartOption", () => currentSpokeObject(ctx, "label"));
  const readSpokeObject = (field: "axisLine" | "gridLine"): Loose => currentSpokeObject(ctx, field);
  axisLineGridEditor(host, "Spoke line", "chart.spokeAxis", "axisLine", axis.axisLine, "#1A1D24", readSpokeObject, commit);
  axisLineGridEditor(host, "Spoke grid", "chart.spokeAxis", "gridLine", axis.gridLine, "#D8DDE3", readSpokeObject, commit);
}

function optionEditor(host: HTMLElement, ctx: PanelContext, chart: Chart): void {
  host.appendChild(section("Options (title / legend / axes / styles)"));
  const title = typeof chart.title === "string" ? { text: chart.title } : chart.title;
  const readLiveTitle = (): Loose => {
    const live = currentChart(ctx)?.title;
    return loose(typeof live === "string" ? { text: live } : live);
  };
  host.appendChild(chartRow("Title", textInput(title?.text ?? "", (text) => {
    const liveTitle = readLiveTitle();
    const nextText = text.trim();
    dispatchChart(ctx, chartOptionCommands(ctx.element.id, { title: nextText === "" ? null : { ...liveTitle, text: nextText } }));
  }, "setChartOption"), "chart.title"));
  textStyleEditor(host, "Title", title, (patch) => {
    const liveTitle = readLiveTitle();
    dispatchChart(ctx, chartOptionCommands(ctx.element.id, { title: { ...mergedObject(liveTitle, patch), text: str(liveTitle.text, "Title") } }));
  }, "chart.title", "setChartOption", readLiveTitle);
  const legend = chart.legend;
  const legendObject = typeof legend === "object" ? legend : {};
  host.appendChild(chartRow("Legend", optionalBoolean(typeof legend === "boolean" ? legend : legendObject.show !== false, (show) => {
    const liveLegend = currentChart(ctx)?.legend;
    if (typeof liveLegend === "object" && liveLegend !== null) dispatchChart(ctx, chartOptionCommands(ctx.element.id, { legend: { ...liveLegend, show } }));
    else dispatchChart(ctx, chartOptionCommands(ctx.element.id, { legend: show }));
  }, "setChartOption"), "chart.legend"));
  host.appendChild(chartRow("Legend position", selectValue(["top", "bottom", "left", "right"].map((value) => ({ value, label: value })), str(legendObject.position, "bottom"), (position) => {
    const liveLegend = currentChart(ctx)?.legend;
    const liveObject = typeof liveLegend === "object" && liveLegend !== null
      ? liveLegend
      : { show: liveLegend !== false };
    dispatchChart(ctx, chartOptionCommands(ctx.element.id, { legend: { ...liveObject, position: position as "top" | "bottom" | "left" | "right" } }));
  }, "setChartOption"), "chart.legend"));
  const readLiveLegend = (): Loose => {
    const liveLegend = currentChart(ctx)?.legend;
    return typeof liveLegend === "object" && liveLegend !== null ? liveLegend as unknown as Loose : { show: liveLegend !== false };
  };
  textStyleEditor(host, "Legend", legendObject, (patch) => {
    const liveLegend = readLiveLegend();
    dispatchChart(ctx, chartOptionCommands(ctx.element.id, { legend: { ...mergedObject(liveLegend, patch), show: liveLegend.show === false ? false : true } }));
  }, "chart.legend", "setChartOption", readLiveLegend);
  dataLabelsEditor(host, "Data labels", chart.dataLabels, (patch) => {
    const liveChart = currentChart(ctx);
    if (liveChart === null) return;
    dispatchChart(ctx, chartOptionCommands(ctx.element.id, { dataLabels: mergedObject(liveChart.dataLabels, patch) }));
  }, "chart.dataLabels", "setChartOption", () => currentChart(ctx)?.dataLabels);
  axisEditor(host, ctx, chart, "xAxis");
  axisEditor(host, ctx, chart, "yAxis");
  spokeAxisEditor(host, ctx, chart);
  host.appendChild(chartRow("Bar width", optionalNumber(chart.barWidth, (barWidth) => {
    if (currentChart(ctx) !== null) dispatchChart(ctx, chartOptionCommands(ctx.element.id, { barWidth }));
  }, "setChartOption", { min: 0, max: 1, minExclusive: true, step: 0.05 }, () => {
    if (currentChart(ctx) !== null) dispatchChart(ctx, chartOptionCommands(ctx.element.id, { barWidth: null }));
  }), "chart.barLayout"));
  host.appendChild(chartRow("Bar gap", optionalNumber(chart.barGap, (barGap) => {
    if (currentChart(ctx) !== null) dispatchChart(ctx, chartOptionCommands(ctx.element.id, { barGap }));
  }, "setChartOption", { min: 0, max: 1, maxExclusive: true, step: 0.01 }, () => {
    if (currentChart(ctx) !== null) dispatchChart(ctx, chartOptionCommands(ctx.element.id, { barGap: null }));
  }), "chart.barLayout"));
  host.appendChild(chartRow("Category gap", optionalNumber(chart.categoryGap, (categoryGap) => {
    if (currentChart(ctx) !== null) dispatchChart(ctx, chartOptionCommands(ctx.element.id, { categoryGap }));
  }, "setChartOption", { min: 0, max: 1, maxExclusive: true, step: 0.01 }, () => {
    if (currentChart(ctx) !== null) dispatchChart(ctx, chartOptionCommands(ctx.element.id, { categoryGap: null }));
  }), "chart.barLayout"));
  fontFamilyEditor(host, "Chart", chart.fontFamily, (fontFamily) => dispatchChart(ctx, chartOptionCommands(ctx.element.id, { fontFamily: fontFamily as BentoFontFamilyV4 | null })), "font.familyUniform", "setChartOption", () => currentChart(ctx)?.fontFamily);
  chartFillEditor(host, ctx, chart);
  borderEditor(host, "Chart border", ctx.element.kind === "chart" ? (ctx.element as BentoChartElementV4).border : undefined, (border) => dispatchChart(ctx, [{ type: "setBorder", targetId: ctx.element.id, border }]), "common.border", "setBorder", () => (currentElement(ctx) as BentoChartElementV4 | null)?.border);
}

function paletteEditor(host: HTMLElement, ctx: PanelContext, chart: Chart): void {
  host.appendChild(section("Palette"));
  const palette = [...(chart.palette ?? [])];
  palette.forEach((color, index) => host.appendChild(chartRow(`Color ${index + 1}`, colorInput(color, (nextColor) => {
    const livePalette = [...(currentChart(ctx)?.palette ?? [])];
    if (livePalette[index] === undefined) return;
    livePalette[index] = nextColor;
    dispatchChart(ctx, chartPaletteCommands(ctx.element.id, livePalette));
  }, "setChartPalette"), "chart.palette")));
  const strip = document.createElement("div"); strip.className = "c2a-strip";
  strip.appendChild(button("+ Color", () => {
    const livePalette = [...(currentChart(ctx)?.palette ?? [])];
    dispatchChart(ctx, chartPaletteCommands(ctx.element.id, [...livePalette, "#4E79A7"]));
  }, "setChartPalette"));
  strip.appendChild(button("Clear", () => {
    if (currentChart(ctx)?.palette === undefined) return;
    dispatchChart(ctx, chartPaletteCommands(ctx.element.id, null));
  }, "setChartPalette"));
  host.appendChild(strip);
}

export function renderChartPanel(host: HTMLElement, ctx: PanelContext): void {
  const chart = chartOf(ctx.element);
  if (chart === null) return;
  host.appendChild(section("Chart"));
  dataEditor(host, ctx, chart);
  seriesEditor(host, ctx, chart);
  optionEditor(host, ctx, chart);
  paletteEditor(host, ctx, chart);
}
