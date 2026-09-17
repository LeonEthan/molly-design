/**
 * chart 家族 adapter 渲染器（GD-4c Wave C1 ticket #10；matrix chart.* 27 行 +
 * spikes/bento-static-closure/chart/notes.md）。矩阵裁决：chart 元素整体
 * adapter——native charts-lite 在 13 型中仅 bar/line/area/scatter 实测有渲染、
 * pie 独占短路，其余 8 型静默忽略（notes.md §0、§4 风险 2：未知 type 既不报错
 * 也不渲染），且 barWidth/startAngle/stack 等键 renderer 不读。冻结裁决
 * C10/C20/C21：adapter 对 13 型全集自渲染 deterministic inline SVG，经 frame
 * hook 'chart.svg' 挂进 .bento-el frame（render.ts 分派点 consult frameHost
 * registry；Bento 拥有 frame/selection/transform/export 生命周期，两路 DOM 源
 * 绝不共存）。NO silent ignore：每个 type 要么渲染、要么具名拒绝（各 throw 内联
 * 注明矩阵行；显式拒绝集在文件尾 CHART_REJECTED_CONDITIONS）。
 *
 * Node-safe：compileChart 是纯字符串/结构编译（Node 断言层直调）；DOM 装配
 * （renderChartSvg）只在 sealed shell 的 Chromium 消费。类型为结构镜像（不
 * import "contracts"——nested src 不做包级 import rewrite；见 image-fill.ts
 * 同款约定）。全部数值经 fmt（2 位小数四舍五入，确定性）。
 *
 * 渲染契约与几何裁决（沿 matrix renderContract/importContract + pptd §5）：
 * - 数据（chart.data/encode 行）：encode 通道按列名 resolve；数值通道统一
 *   Number 解析，不可解析即具名拒绝（NonNumericValue 类）；缺失列具名拒绝。
 *   null = 缺值（line/area/radar 依 nullHandling，其余跳过该行）。seriesDefaults
 *   已在 import 期一层深合并物化，canonical 不重复合并（chart.seriesDefaults）。
 * - 混排（chart.typeMixing 行 §5.4 adapter 全集）：bar/line/area/scatter/bubble
 *   自由混；candlestick 只混 bar/line/area；pie/radar/waterfall/heatmap/treemap/
 *   sunburst/sankey 独占（pie 单 series）。跨词表组合具名拒绝——validator 已拦，
 *   renderer 防御性再兜（Bento 兜底是静默丢，绝不复用）。
 * - 类目坐标系（bar/line/area/candlestick/waterfall）：类目表取首个
 *   value-cartesian series 的 encode.x 列值（row 序、去 null），其它该类 series
 *   必须共享相同类目，否则具名拒绝（wide-table null padding 只适用 scatter/
 *   bubble 数值坐标系）。scatter/bubble 混入类目图按数据行序对齐类目槽
 *   （ECharts category-axis 同款：类目轴上数据索引定位）。纯 scatter/bubble 图
 *   用双侧数值刻度（chart.scatter 行）。
 * - 刻度（chart.axisBasic 行）：value 轴 nice ticks（{1,2,2.5,5}×10^k 步长、
 *   目标 5 刻度），确定性；min/max 显式覆盖；reverse 反转方向；category 轴类目
 *   均布（categoryGap 槽距比）。xAxis.min/max 用于 category 轴 = 具名拒绝
 *   （pptd "仅 value axes 有效"——不当静默忽略）。
 * - 轴（chart.axisBasic/axisLabel/axisLineGrid/axisSecondary 行）：show=false 抑
 *   制轴线与刻度标签；gridLine 画在 y 主刻度（style/color/width/dash）；axisLine
 *   画值零基线（0 在域内时）/槽底，arrow 在终点画小三角标头；yAxis 数组 ≤2
 *   （副 y 轴右侧自绘刻度，series.yAxisIndex 归属，副轴域独立）；numberFormat
 *   词表 {0,0.0,0%,0.0%,#,##0,0.0E+00} 越界具名拒绝；轴 title 画 y 轴名（旋转
 *   -90°）。
 * - bar 布局（chart.barLayout/bar 行，C10 adapter）：槽宽 slotW=plotW/nCats；
 *   categoryGap 留白 → contentW=slotW*(1-categoryGap)；barW=slotW*barWidth
 *   （缺省 contentW*0.8）；组内柱间 barGap；non-stack 并排、stack 一列堆叠
 *   （value 直接求和、percent 归一 ±1 域），负值向下；域含累计和。symbol 象形柱
 *   （ShapeDef）经 shared static-v1 shape geometry carrier 渲染。
 * - line/area（chart.line/area 行）：smooth 中点切线三次贝塞尔；dash/dot →
 *   stroke-dasharray；nullHandling gap=断段、connect=剔 null 连段、zero=置 0
 *   （多 series 首个非空生效，同 pptd）；marker 形状 circle/rect/diamond/
 *   triangle + marker.fill 优先（marker=false 抑制，缺省恒画）；areaColor 缺省
 *   =lineColor opacity 0.25；area stack value/percent/stream（stream=value 归一
 *   + 中央基线对称）。
 * - 数值点图（chart.scatter/bubble 行）：scatter 统一点径（marker 恒画，PPTD
 *   marker 不可 false）；bubble 逐点半径 sizeScale linear/sqrt/log + sizeRange
 *   （缺省 [4, min(plotW,plotH)*0.12]，负 size=0）；dataFilter 投影期过滤。
 * - pie（chart.pie 行，C20）：单 series 独占；startAngle 缺省 0=12 点、顺时针；
 *   innerRadius∈[0,1] donut；fill 数组按片循环；值 <0 或 total=0 具名拒绝；
 *   dataLabels value/percentage/category（{b}/{c}/{d} 语义）。
 * - candlestick（chart.candlestick 行）：open 有无定 OHLC/HLC；up=close>open 实
 *   心体+影线（upBars/downBars 双色缺省常量），HLC=竖线+收盘点；日期字符串按行
 *   序类目化（chart.axisBasic 类目推断）。
 * - radar（chart.radar/spokeAxis 行）：共享 spoke（encode.category 同列），
 *   spokeAxis min 缺省 0/max 数据适配，4 环网格 + spoke 轴线 + 类目标签；多
 *   series 多边形，areaColor 缺省 lineColor 0.25；null：zero 置 0、gap/connect
 *   省略顶点（闭多边形无"断段"概念，两种等价）。
 * - waterfall（chart.waterfall 行）：isTotal "true"/"false" 串列；total 柱绝对
 *   值、浮柱随 running 累计涨落；totalBars/increaseBars/decreaseBars 三色映射
 *   （缺省常量）；float 柱不依赖 native stack（其 stack 死证 notes.md §4）。
 * - heatmap（chart.heatmap 行）：x/y 类目一现序网格、缺失 (x,y) 透明、重复
 *   (x,y) 后者覆盖；colorScheme 端点插值 + colorScale linear/diverging
 *   （diverging 缺省 [-max|v|,+max|v|] 零中）；colorbar 替代 legend（v1 仅
 *   right 位，其它位具名拒绝）；colorbar:false 关。
 * - treemap/sunburst/sankey（chart.treemap/sunburst/sankey 行）：parent 层级
 *   （treemap squarified 布局 + fill 逐级 HSL.L-10% 派生/2-D 直给；sunburst 多层
 *   弧 fill 按顶层节点循环；sankey DAG 拓扑序分层 + 流带贝塞尔 + nodeAlign 列块
 *   垂直对齐 justify/left/right + fill 数组/按名映射）。梯度入 treemap/sunburst
 *   fill（逐层派生/循环只对 solid 色基有意义）具名拒绝。
 * - 全局：title 画顶（chart.title 行）；legend 按型缺省显示表（chart.legend 行：
 *   bar/line/area/scatter/bubble/candlestick/pie/radar true；waterfall false；
 *   treemap/sunburst/sankey false——名字已上画；heatmap 由 colorbar 替代），
 *   left/right 位横向占边；fontFamily 经 #21 shared text resolver/alias plan
 *   尊重注册字体；
 *   chart.fill 外框 solid/linear/radial → wrap CSS，image → #23 共用
 *   crop→fit→opacity SVG 图层；palette 物化数组循环（chart.palette 行）。
 * 数据标签（chart.dataLabels 行）：全局缺省与 series 覆盖浅合并（投影期物化）；
 *   content 按型词表校验（越界具名拒绝）——bar/line/area/scatter/bubble/radar/
 *   heatmap/sankey 仅 value、pie value/percentage/category、waterfall value/
 *   category、treemap/sunburst value/category（缺省 category）；candlestick 本
 *   体无 dataLabels（overlay series 有）。
 */

import type { FrameHostElement, FrameHostRenderContext } from "../boot/frame-host.ts";
import { bentoChartLayoutViewport, STATIC_V1_TEXT_DEFAULTS } from "contracts";
import { escapeHtml, fmt, gradientId, linearDefsMarkup, pptdAngleToCss, radialDefsMarkup, xml } from "./fill.ts";
import { compileImageFillV4, renderImageFillLayer, type CompiledImageFillV4 } from "./image-fill.ts";
import { imageIntrinsicSize } from "./image.ts";
import { fontFamilyCss, type TextFontFamily } from "./text.ts";
import { compileStaticV1ShapeGeometry, staticV1GeometryMarkup } from "./geometry.ts";

// ---------------------------------------------------------------------------
// 结构镜像保持 Node/browser 双侧自包含；仅从 contracts 消费 static-v1
// 语义事实，不复刻 canonical 类型或默认值。
// ---------------------------------------------------------------------------

export type ChartFontFamily = string | { latin: string; ea: string };

export interface ChartGradientStopLike {
  position: number;
  color: string;
}

/** series 级填充：solid 字面色 | linear/radial 渐变（fill.* 行 series 宿主）。 */
export type ChartSeriesFillLike =
  | string
  | { type: "gradient"; gradientType: "linear" | "radial"; angle?: number; stops: readonly ChartGradientStopLike[] };

export type ChartFillLike =
  | { type: "solid"; color: string }
  | {
      type: "gradient";
      gradientType: "linear" | "radial";
      angle?: number;
      stops: readonly ChartGradientStopLike[];
    }
  | { type: "image"; src: string; fit?: string; crop?: readonly number[]; opacity?: number };

export interface ChartBorderLike {
  style?: string;
  width?: number;
  color?: string;
}

export interface ChartTextStyleLike {
  color?: string;
  fontSize?: number;
  fontFamily?: ChartFontFamily;
}

export interface ChartTitleLike extends ChartTextStyleLike {
  text: string;
}

export interface ChartLegendLike extends ChartTextStyleLike {
  show?: boolean;
  position?: "top" | "bottom" | "left" | "right";
}

export interface ChartDataLabelLike extends ChartTextStyleLike {
  show?: boolean;
  content?: "value" | "percentage" | "category";
  numberFormat?: string;
}

export interface ChartLineStyleLike {
  style?: "solid" | "dash" | "dot";
  color?: string;
  width?: number;
}

export interface ChartAxisLike {
  show?: boolean;
  type?: "category" | "value";
  min?: number;
  max?: number;
  reverse?: boolean;
  title?: string | ChartTitleLike;
  label?: boolean | (ChartTextStyleLike & { numberFormat?: string });
  axisLine?: boolean | (ChartLineStyleLike & { arrow?: boolean | "start" | "end" | "both" });
  gridLine?: boolean | ChartLineStyleLike;
}

export interface ChartSpokeAxisLike {
  show?: boolean;
  min?: number;
  max?: number;
  label?: boolean | (ChartTextStyleLike & { numberFormat?: string });
  axisLine?: boolean | ChartLineStyleLike;
  gridLine?: boolean | ChartLineStyleLike;
}

export interface ChartMarkerLike {
  shape?: "circle" | "rect" | "diamond" | "triangle";
  fill?: ChartSeriesFillLike;
  border?: ChartBorderLike;
  size?: number;
}

export interface ChartDataLike {
  cols: string[];
  rows: (number | string | null)[][];
}

export interface ChartBarStyleLike {
  fill?: string;
  border?: ChartBorderLike;
}

export interface ChartSeriesLike {
  type: string;
  name?: string;
  encode: Record<string, string>;
  xAxisIndex?: number;
  yAxisIndex?: number;
  dataLabels?: ChartDataLabelLike;
  // bar
  stack?: "value" | "percent" | "stream";
  symbol?: unknown;
  fill?: ChartSeriesFillLike | readonly ChartSeriesFillLike[] | readonly (readonly ChartSeriesFillLike[])[] | Record<string, ChartSeriesFillLike>;
  border?: ChartBorderLike;
  // line/area/radar（LinearSeriesBase）
  smooth?: boolean;
  lineStyle?: "solid" | "dash" | "dot";
  width?: number;
  marker?: false | ChartMarkerLike;
  nullHandling?: "zero" | "gap" | "connect";
  lineColor?: ChartSeriesFillLike;
  areaColor?: ChartSeriesFillLike;
  // scatter/bubble
  dataFilter?: { col: string; value: string | number };
  sizeScale?: "linear" | "sqrt" | "log";
  sizeRange?: [number, number];
  // candlestick
  upBars?: { fill?: string; border?: ChartBorderLike };
  downBars?: { fill?: string; border?: ChartBorderLike };
  wickStyle?: ChartBorderLike;
  // pie
  innerRadius?: number;
  startAngle?: number;
  // waterfall
  totalBars?: ChartBarStyleLike;
  increaseBars?: ChartBarStyleLike;
  decreaseBars?: ChartBarStyleLike;
  // heatmap
  colorScheme?: string[];
  colorScale?: { type?: "linear" | "diverging"; domain?: [number, number] };
  colorbar?: boolean | ChartLegendLike;
  // treemap/sunburst
  levels?: number;
  // sankey
  nodeAlign?: "left" | "right" | "justify";
}

export interface ChartLike {
  data: ChartDataLike;
  series: ChartSeriesLike[];
  xAxis?: ChartAxisLike | ChartAxisLike[];
  yAxis?: ChartAxisLike | ChartAxisLike[];
  barWidth?: number;
  barGap?: number;
  categoryGap?: number;
  spokeAxis?: ChartSpokeAxisLike;
  title?: string | ChartTitleLike;
  legend?: boolean | ChartLegendLike;
  dataLabels?: ChartDataLabelLike;
  fontFamily?: ChartFontFamily;
  palette?: string[];
  fill?: ChartFillLike;
  border?: ChartBorderLike;
}

// ---------------------------------------------------------------------------
// 确定性常量
// ---------------------------------------------------------------------------

/** chart.palette 缺省兜底（chart.palette 行：物化数组缺失时固定常量）。 */
export const CHART_DEFAULT_PALETTE: readonly string[] = [
  "#4E79A7", "#F28E2B", "#E15759", "#76B7B2",
  "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7",
];

const TEXT_COLOR_DEFAULT = STATIC_V1_TEXT_DEFAULTS.color;
const AXIS_LABEL_COLOR_DEFAULT = "#6B7280";
const AXIS_LINE_COLOR_DEFAULT = "#8A97A8";
const GRID_LINE_COLOR_DEFAULT = "#E5E9F0";
// Chart subcomponents keep their frozen auto-layout sizes; the static-v1 text
// default applies only where the chart contract exposes the common text fields.
const TITLE_FONT_SIZE_DEFAULT = 16;
const LABEL_FONT_SIZE_DEFAULT = 10;
const AXIS_TITLE_FONT_SIZE_DEFAULT = 12;
const LEGEND_FONT_SIZE_DEFAULT = 10;
/** 文本宽度近似：无测量、确定性（0.62×fontSize/字符）。 */
const CHAR_WIDTH_RATIO = 0.62;
const LEGEND_SWATCH = 14;
const LEGEND_GAP = 8;
const CANDLE_UP_DEFAULT = "#E8442E";
const CANDLE_DOWN_DEFAULT = "#2E9E5B";
const CANDLE_WICK_DEFAULT = "#8A97A8";
const WATERFALL_TOTAL_DEFAULT = "#8A97A8";
const WATERFALL_UP_DEFAULT = "#2E9E5B";
const WATERFALL_DOWN_DEFAULT = "#E8442E";
const HEATMAP_DEFAULT_SCHEME: readonly string[] = ["#FFFFFF", "#E8442E"];
const HEATMAP_DIVERGING_DEFAULT: readonly string[] = ["#2E6BE6", "#F2F2F2", "#E8442E"];

export const CHART_TYPES: readonly string[] = [
  "bar", "line", "area", "scatter", "bubble", "candlestick", "pie", "radar",
  "waterfall", "heatmap", "treemap", "sunburst", "sankey",
];
const VALUE_CARTESIAN_TYPES = new Set(["bar", "line", "area", "candlestick"]);
const NUMERIC_TYPES = new Set(["scatter", "bubble"]);
const CARTESIAN_TYPES = new Set([...VALUE_CARTESIAN_TYPES, ...NUMERIC_TYPES]);

// ---------------------------------------------------------------------------
// 共享小工具
// ---------------------------------------------------------------------------

const fontFamilyOf = (
  f: ChartFontFamily | undefined,
  fontAliases?: ReadonlyMap<string, string>,
): string => fontFamilyCss(f as TextFontFamily | undefined, fontAliases);

const approxTextWidth = (text: string, fontSize: number): number =>
  Math.max(fontSize, text.length * CHAR_WIDTH_RATIO * fontSize);

const colIndexOf = (data: ChartDataLike, name: string, where: string): number => {
  const i = data.cols.indexOf(name);
  if (i < 0) throw new Error(`${where}: encode 通道引用未知列 "${name}"（chart.encode 行）`);
  return i;
};

const cellAt = (data: ChartDataLike, row: number, ci: number): number | string | null =>
  data.rows[row]?.[ci] ?? null;

const numOf = (cell: number | string | null, where: string): number | null => {
  if (cell === null || cell === "") return null;
  const n = typeof cell === "number" ? cell : Number(cell);
  if (!Number.isFinite(n)) {
    throw new Error(`${where}: 数值通道值不可解析为数字 ${JSON.stringify(cell)}（chart.data NonNumericValue 类）`);
  }
  return n;
};

const catOf = (cell: number | string | null): string | null => (cell === null ? null : String(cell));

const domainOf = (lo: number, hi: number): [number, number] => {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new Error("数值域必须有限（无可用数值数据）");
  }
  if (lo === hi) {
    const pad = Math.abs(lo) || 1;
    return [lo - pad, lo + pad];
  }
  return [lo, hi];
};

const niceStep = (span: number, target: number): number => {
  const raw = span / Math.max(target, 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
};

const ticksOf = (min: number, max: number, target = 5): number[] => {
  const [lo, hi] = domainOf(min, max);
  const step = niceStep(hi - lo, target);
  const first = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = first; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
};

interface Scale {
  lo: number;
  hi: number;
  outLo: number;
  outHi: number;
  reverse: boolean;
}

const scaleValue = (s: Scale, v: number): number => {
  const t = (v - s.lo) / (s.hi - s.lo);
  const tt = s.reverse ? 1 - t : t;
  return s.outLo + tt * (s.outHi - s.outLo);
};

function formatNumber(value: number, nf: string | undefined): string {
  if (nf === undefined || nf === "") return fmt(value);
  switch (nf) {
    case "0": return String(Math.round(value));
    case "0.0": return value.toFixed(1);
    case "0%": return `${String(Math.round(value * 100))}%`;
    case "0.0%": return `${(value * 100).toFixed(1)}%`;
    case "#,##0": return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    case "0.0E+00": return value.toExponential(1);
    default:
      throw new Error(`numberFormat "${nf}" 不在 v1 词表（chart.axisLabel/dataLabels 行：0/0.0/0%/0.0%/#,##0/0.0E+00）`);
  }
}

const hexToRgb = (hex: string): [number, number, number] => {
  const full = hex.startsWith("#") ? hex.slice(1) : hex;
  // BentoColor is HEX6/HEX8.  HSL derivation intentionally ignores alpha,
  // while heatmap interpolation below carries it through the RGBA path.
  const six = full.length === 3 ? full.split("").map((c) => c + c).join("") : full.length === 8 ? full.slice(0, 6) : full;
  if (six.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(six)) throw new Error(`非法颜色值 "${hex}"`);
  const n = parseInt(six, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const hexToRgba = (hex: string): [number, number, number, number] => {
  const full = hex.startsWith("#") ? hex.slice(1) : hex;
  const six = full.length === 3 ? full.split("").map((c) => c + c).join("") : full.length === 8 ? full.slice(0, 6) : full;
  if (six.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(six)) throw new Error(`非法颜色值 "${hex}"`);
  const n = parseInt(six, 16);
  const alpha = full.length === 8 ? parseInt(full.slice(6), 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
};

const lerpColor = (c0: string, c1: string, t: number): string => {
  const a = hexToRgba(c0);
  const b = hexToRgba(c1);
  const mix = (i: number): number => Math.round(a[i] + (b[i] - a[i]) * t);
  const rgb = [mix(0), mix(1), mix(2)].map((n) => n.toString(16).padStart(2, "0")).join("");
  // Keep the common color editor's authored alpha semantics at the renderer
  // seam: HEX6 stays HEX6, while any HEX8 endpoint (including a mixed alpha)
  // produces an interpolated HEX8 color instead of silently dropping alpha.
  const hasAlpha = c0.replace(/^#/, "").length === 8 || c1.replace(/^#/, "").length === 8 || mix(3) !== 255;
  return `#${rgb}${hasAlpha ? mix(3).toString(16).padStart(2, "0") : ""}`;
};

const hexToHsl = (hex: string): [number, number, number] => {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
};

const hslToHex = (h: number, s: number, l: number): string => {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const to = (v: number): string => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${to(hue(h / 360 + 1 / 3))}${to(hue(h / 360))}${to(hue(h / 360 - 1 / 3))}`;
};

const darkenLightness = (hex: string, steps: number): string => {
  if (steps === 0) return hex;
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s, Math.max(0, l - 0.1 * steps));
};

function seriesPaint(
  fill: ChartSeriesFillLike | undefined,
  defs: string[],
  elementId: string,
  suffix: string,
  paletteColor: string,
): string {
  if (fill === undefined) return paletteColor;
  if (typeof fill === "string") return fill;
  const id = gradientId(`chart-${suffix}`, elementId);
  const stops = fill.stops.map((st) => ({ position: st.position, color: st.color }));
  if (fill.gradientType === "linear") defs.push(linearDefsMarkup(id, pptdAngleToCss(fill.angle ?? 90), stops));
  else defs.push(radialDefsMarkup(id, stops));
  return `url(#${id})`;
}

const paletteOf = (chart: ChartLike): readonly string[] =>
  chart.palette !== undefined && chart.palette.length > 0 ? chart.palette : CHART_DEFAULT_PALETTE;

const seriesColorOf = (chart: ChartLike, index: number): string => paletteOf(chart)[index % paletteOf(chart).length];

const CHART_FONT_ALIASES = Symbol("static-v1 chart font aliases");
type ChartCompileContext = ChartLike & { [CHART_FONT_ALIASES]?: ReadonlyMap<string, string> };

function chartFontCss(chart: ChartLike, style: unknown): string | undefined {
  if (typeof style !== "object" || style === null || !("fontFamily" in style)) return undefined;
  const family = (style as { fontFamily?: ChartFontFamily }).fontFamily;
  return family === undefined
    ? undefined
    : fontFamilyOf(family, (chart as ChartCompileContext)[CHART_FONT_ALIASES]);
}

const textEl = (
  text: string,
  x: number,
  y: number,
  style: { color?: string; fontSize?: number; anchor?: string; fontFamilyCss?: string },
): string => {
  const parts = [
    `<text${xml("x", fmt(x))}${xml("y", fmt(y))}`,
    style.anchor !== undefined ? xml("text-anchor", style.anchor) : "",
    style.color !== undefined ? xml("fill", style.color) : "",
    style.fontFamilyCss !== undefined ? xml("font-family", style.fontFamilyCss) : "",
    xml("font-size", style.fontSize ?? LABEL_FONT_SIZE_DEFAULT),
    `>${escapeHtml(text)}</text>`,
  ];
  return parts.join("");
};

// ---------------------------------------------------------------------------
// 数据解析与类目/锚点
// ---------------------------------------------------------------------------

function sharedCategoryValues(chart: ChartLike, seriesList: ChartSeriesLike[], channel: string): string[] {
  const first = seriesList[0];
  const ci = colIndexOf(chart.data, first.encode[channel], `series ${first.type}`);
  const out = chart.data.rows
    .map((_, r) => catOf(cellAt(chart.data, r, ci)))
    .filter((c): c is string => c !== null);
  if (out.length === 0) throw new Error(`类目列 ${channel} 为空（无可用类目行）`);
  for (const s of seriesList.slice(1)) {
    const sci = colIndexOf(chart.data, s.encode[channel], `series ${s.type}`);
    const theirs = chart.data.rows
      .map((_, r) => catOf(cellAt(chart.data, r, sci)))
      .filter((c): c is string => c !== null);
    if (theirs.join("\u0000") !== out.join("\u0000")) {
      throw new Error(
        `series ${s.type} 的 encode.${channel} 列值与首 series 不一致（adapter 共享类目/维度列要求；chart.typeMixing 行，wide-table null padding 仅限 scatter/bubble）`,
      );
    }
  }
  return out;
}

const sharedCategories = (chart: ChartLike, seriesList: ChartSeriesLike[]): string[] =>
  sharedCategoryValues(chart, seriesList, "x");

interface CatPoint {
  slot: number;
  value: number | null;
}

function catPoints(chart: ChartLike, series: ChartSeriesLike, cats: string[]): CatPoint[] {
  const ci = colIndexOf(chart.data, series.encode.y, `series ${series.type}`);
  const xci = colIndexOf(chart.data, series.encode.x, `series ${series.type}`);
  return cats.map((cat, slot) => {
    const r = chart.data.rows.findIndex((_row, ri) => catOf(cellAt(chart.data, ri, xci)) === cat);
    if (r < 0) return { slot, value: null };
    return { slot, value: numOf(cellAt(chart.data, r, ci), `series ${series.type} 第 ${r} 行 y`) };
  });
}

interface NumPoint {
  x: number | null;
  y: number | null;
  size: number | null;
}

function numericPoints(chart: ChartLike, series: ChartSeriesLike): NumPoint[] {
  const xci = colIndexOf(chart.data, series.encode.x, `series ${series.type}`);
  const yci = colIndexOf(chart.data, series.encode.y, `series ${series.type}`);
  const sci = series.type === "bubble"
    ? colIndexOf(chart.data, (series as unknown as { encode: { size: string } }).encode.size, `series ${series.type}`)
    : -1;
  const rows: number[] = [];
  chart.data.rows.forEach((_row, r) => {
    if (series.dataFilter !== undefined) {
      const fci = colIndexOf(chart.data, series.dataFilter.col, `series ${series.type} dataFilter`);
      if (String(cellAt(chart.data, r, fci)) !== String(series.dataFilter.value)) return;
    }
    rows.push(r);
  });
  return rows.map((r) => ({
    x: numOf(cellAt(chart.data, r, xci), `series ${series.type} 第 ${r} 行 x`),
    y: numOf(cellAt(chart.data, r, yci), `series ${series.type} 第 ${r} 行 y`),
    size: sci >= 0 ? numOf(cellAt(chart.data, r, sci), `series ${series.type} 第 ${r} 行 size`) : null,
  }));
}

// ---------------------------------------------------------------------------
// 标题/图例布局（无文本测量、确定性）
// ---------------------------------------------------------------------------

interface LegendItem {
  label: string;
  color: string;
}

interface LegendLayout {
  items: LegendItem[];
  position: "top" | "bottom" | "left" | "right";
  fontSize: number;
  color: string;
  fontFamilyCss?: string;
  rows: number;
  itemW: number;
  rowH: number;
  perRow: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function legendDefaultTypeShown(type: string): boolean {
  switch (type) {
    case "waterfall":
    case "treemap":
    case "sunburst":
    case "sankey":
      return false;
    default:
      return true;
  }
}

function legendLayout(chart: ChartLike, items: LegendItem[], availableW: number): LegendLayout | null {
  if (items.length === 0 || chart.legend === false) return null;
  const anyDefault = chart.series.some((s) => legendDefaultTypeShown(s.type));
  const cfg = typeof chart.legend === "object" && chart.legend !== null ? chart.legend : {};
  const show = chart.legend === true ? true : (cfg.show ?? anyDefault);
  if (!show) return null;
  const fs = cfg.fontSize ?? LEGEND_FONT_SIZE_DEFAULT;
  const color = cfg.color ?? TEXT_COLOR_DEFAULT;
  const position = (cfg.position ?? "bottom") as LegendLayout["position"];
  if (!["top", "bottom", "left", "right"].includes(position)) {
    throw new Error(`legend.position "${position}" 非法（chart.legend 行 top/bottom/left/right）`);
  }
  const itemW = Math.max(0, ...items.map((it) => LEGEND_SWATCH + LEGEND_GAP + approxTextWidth(it.label, fs) + LEGEND_GAP));
  const rowH = fs + 4;
  if (position === "left" || position === "right") {
    const w = itemW + 6;
    return {
      items, position, fontSize: fs, color, ...(chartFontCss(chart, cfg) !== undefined ? { fontFamilyCss: chartFontCss(chart, cfg) } : {}), rows: items.length, itemW, rowH, perRow: 1,
      top: 0, right: position === "right" ? w : 0, bottom: 0, left: position === "left" ? w : 0,
    };
  }
  const perRow = Math.max(1, Math.floor(Math.max(availableW, 1) / itemW));
  const rows = Math.ceil(items.length / perRow);
  const h = rows * rowH + 4;
  return {
    items, position, fontSize: fs, color, ...(chartFontCss(chart, cfg) !== undefined ? { fontFamilyCss: chartFontCss(chart, cfg) } : {}), rows, itemW, rowH, perRow,
    top: position === "top" ? h : 0,
    right: 0,
    bottom: position === "bottom" ? h : 0,
    left: 0,
  };
}

function legendMarkup(layout: LegendLayout, plot: PlotBox, w: number, h: number): string {
  const { items, fontSize, color, fontFamilyCss, position, itemW, rowH, perRow } = layout;
  const parts: string[] = [];
  const swatchH = Math.min(fontSize, 12);
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    let px: number;
    let py: number;
    if (position === "left" || position === "right") {
      px = position === "left" ? 2 : w - itemW - 2;
      py = plot.y + 2 + i * rowH;
    } else {
      const row = Math.floor(i / perRow);
      const inRow = i % perRow;
      const nInRow = Math.min(perRow, items.length - row * perRow);
      const startX = plot.x + (plot.w - nInRow * itemW) / 2;
      px = startX + inRow * itemW;
      py = position === "top" ? 2 + row * rowH : h - (layout.rows * rowH + 4) + 2 + row * rowH;
    }
    parts.push(
      `<rect${xml("x", fmt(px))}${xml("y", fmt(py + (fontSize - swatchH) / 2))}${xml("width", fmt(LEGEND_SWATCH))}${xml("height", fmt(swatchH))}${xml("fill", item.color)}/>`,
      textEl(item.label, px + LEGEND_SWATCH + LEGEND_GAP, py + fontSize, { color, fontSize, anchor: "start", ...(fontFamilyCss !== undefined ? { fontFamilyCss } : {}) }),
    );
  }
  return parts.join("");
}

interface TitleInfo {
  text: string;
  color?: string;
  fontSize: number;
  y: number;
  fontFamilyCss?: string;
}

const titleInfo = (chart: ChartLike): TitleInfo | null => {
  if (chart.title === undefined) return null;
  const t = typeof chart.title === "string" ? { text: chart.title } : chart.title;
  const fs = t.fontSize ?? TITLE_FONT_SIZE_DEFAULT;
  return { text: t.text, color: t.color, fontSize: fs, y: 8 + fs, ...(chartFontCss(chart, t) !== undefined ? { fontFamilyCss: chartFontCss(chart, t) } : {}) };
};

const titleMarkup = (t: TitleInfo, w: number): string =>
  textEl(t.text, w / 2, t.y, { color: t.color, fontSize: t.fontSize, anchor: "middle", ...(t.fontFamilyCss !== undefined ? { fontFamilyCss: t.fontFamilyCss } : {}) });

// ---------------------------------------------------------------------------
// 坐标系（类目/数值）+ 轴
// ---------------------------------------------------------------------------

interface PlotBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function axisLabelOpts(axis: ChartAxisLike | undefined, chart?: ChartLike): { fontSize: number; color: string; numberFormat?: string; fontFamilyCss?: string } {
  const label = axis?.label;
  const cfg = typeof label === "object" && label !== null ? label : {};
  return {
    fontSize: cfg.fontSize ?? LABEL_FONT_SIZE_DEFAULT,
    color: cfg.color ?? AXIS_LABEL_COLOR_DEFAULT,
    numberFormat: typeof label === "object" && label !== null ? label.numberFormat : undefined,
    ...(chart !== undefined && chartFontCss(chart, cfg) !== undefined ? { fontFamilyCss: chartFontCss(chart, cfg) } : {}),
  };
}

const axisTitleOf = (axis: ChartAxisLike | undefined): ChartTitleLike | null => {
  if (axis?.title === undefined) return null;
  return typeof axis.title === "string" ? { text: axis.title } : axis.title;
};

const axisTitleAdded = (axis: ChartAxisLike | undefined): number => {
  const t = axisTitleOf(axis);
  return t === null ? 0 : (t.fontSize ?? AXIS_TITLE_FONT_SIZE_DEFAULT) + 6;
};

const valueTickGutter = (axis: ChartAxisLike | undefined, ticks: number[]): number => {
  const opts = axisLabelOpts(axis);
  const w = ticks.reduce((m, t) => Math.max(m, approxTextWidth(formatNumber(t, opts.numberFormat), opts.fontSize)), 0);
  return Math.max(10, w) + 8;
};

const dashArrayOf = (style: "solid" | "dash" | "dot" | undefined): string | undefined => {
  switch (style) {
    case "dash": return "5,3";
    case "dot": return "2,3";
    default: return undefined;
  }
};

const strokeAttrs = (
  style: { color?: string; width?: number; style?: "solid" | "dash" | "dot" } | undefined,
  fallbackColor: string,
  fallbackWidth: number,
): string => {
  const dash = dashArrayOf(style?.style);
  const color = style?.color ?? fallbackColor;
  const width = style?.width ?? fallbackWidth;
  return `${xml("stroke", color)}${xml("stroke-width", fmt(width))}${dash !== undefined ? xml("stroke-dasharray", dash) : ""}`;
};

const axisLineConfig = (axis: ChartAxisLike | undefined): { color: string; width: number; arrow: "start" | "end" | "both" | false } => {
  const al = axis?.axisLine;
  if (al === false) return { color: "none", width: 0, arrow: false };
  const cfg = typeof al === "object" && al !== null ? al : {};
  const arrowRaw = cfg.arrow;
  const arrow = arrowRaw === undefined || arrowRaw === false ? false : arrowRaw === true ? "end" : arrowRaw;
  return { color: cfg.color ?? AXIS_LINE_COLOR_DEFAULT, width: cfg.width ?? 1, arrow };
};

const gridLineConfig = (axis: ChartAxisLike | undefined): { color: string; width: number; style?: "solid" | "dash" | "dot" } | null => {
  const gl = axis?.gridLine;
  if (gl === false) return null;
  const cfg = typeof gl === "object" && gl !== null ? gl : {};
  return { color: cfg.color ?? GRID_LINE_COLOR_DEFAULT, width: cfg.width ?? 1, style: cfg.style };
};

interface CartAxis {
  index: number;
  axis: ChartAxisLike | undefined;
  scale: Scale;
  ticks: number[];
}

function valueDomainCartesian(chart: ChartLike, bound: ChartSeriesLike[], cats: string[] | null): [number, number] {
  const values: number[] = [];
  const barStack = bound.filter((s) => s.type === "bar" && s.stack !== undefined);
  const areaStack = bound.filter((s) => s.type === "area" && s.stack !== undefined);
  for (const s of barStack) {
    if (s.stack === "stream") throw new Error(`chart.bar 行：stack="stream" 仅 area 支持（bar 只 value/percent）`);
  }
  if (barStack.some((s) => s.stack === "percent") || areaStack.some((s) => s.stack === "percent")) return [-1, 1];
  const streamAreas = areaStack.filter((s) => s.stack === "stream");
  const stackable = barStack.concat(areaStack.filter((s) => s.stack !== "stream"));
  if (stackable.length > 0 || streamAreas.length > 0) {
    const slotCount = cats?.length ?? 0;
    for (let slot = 0; slot < slotCount; slot += 1) {
      let pos = 0;
      let neg = 0;
      for (const s of stackable) {
        const v = catPoints(chart, s, cats ?? [])[slot]?.value ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
        values.push(pos, neg);
      }
      if (streamAreas.length > 0) {
        const total = streamAreas.reduce((acc, s) => acc + (catPoints(chart, s, cats ?? [])[slot]?.value ?? 0), 0);
        let cum = 0;
        for (const s of streamAreas) {
          cum += catPoints(chart, s, cats ?? [])[slot]?.value ?? 0;
          values.push(cum - total / 2, total / 2 - cum);
        }
      }
    }
  }
  for (const s of bound) {
    if (s.type === "candlestick") {
      const ciH = colIndexOf(chart.data, s.encode.high, `series ${s.type}`);
      const ciL = colIndexOf(chart.data, s.encode.low, `series ${s.type}`);
      const ciC = colIndexOf(chart.data, s.encode.close, `series ${s.type}`);
      const ciO = s.encode.open === undefined ? -1 : colIndexOf(chart.data, s.encode.open!, `series ${s.type}`);
      for (const [r] of chart.data.rows.entries()) {
        for (const [ci, name] of [[ciH, "high"], [ciL, "low"], [ciC, "close"], [ciO, "open"]] as const) {
          if (ci < 0) continue;
          const v = numOf(cellAt(chart.data, r, ci), `series ${s.type} 第 ${r} 行 ${name}`);
          if (v !== null) values.push(v);
        }
      }
    } else if (NUMERIC_TYPES.has(s.type)) {
      for (const p of numericPoints(chart, s)) {
        if (p.y !== null) values.push(p.y);
      }
    } else if ((s.type === "bar" || s.type === "area") && s.stack !== undefined) {
      // 已计入累计和（percent 已提前返回 [-1,1]）
    } else {
      const ci = colIndexOf(chart.data, s.encode.y, `series ${s.type}`);
      for (const [r] of chart.data.rows.entries()) {
        const v = numOf(cellAt(chart.data, r, ci), `series ${s.type} 第 ${r} 行 y`);
        if (v !== null) values.push(v);
      }
    }
  }
  if (values.length === 0) throw new Error("y 轴无数值数据（空 series/全 null）");
  return domainOf(Math.min(0, ...values), Math.max(0, ...values));
}

const numericXDomain = (chart: ChartLike, bound: ChartSeriesLike[]): [number, number] => {
  const values: number[] = [];
  for (const s of bound) {
    for (const p of numericPoints(chart, s)) {
      if (p.x !== null) values.push(p.x);
    }
  }
  if (values.length === 0) throw new Error("x 轴无数值数据（scatter/bubble 全 null）");
  return domainOf(Math.min(...values), Math.max(...values));
};

const makeCartAxis = (index: number, axis: ChartAxisLike | undefined, lo: number, hi: number): CartAxis => {
  const d0 = axis?.min ?? lo;
  const d1 = axis?.max ?? hi;
  if (axis?.min !== undefined && axis?.max !== undefined && axis.min >= axis.max) {
    throw new Error(`轴 ${index} min>=max（chart.axisBasic 行）`);
  }
  const [slo, shi] = domainOf(d0, d1);
  return { index, axis, scale: { lo: slo, hi: shi, outLo: 0, outHi: 0, reverse: axis?.reverse === true }, ticks: ticksOf(slo, shi) };
};

const chartYAxes = (chart: ChartLike): ChartAxisLike[] => {
  const raw = chart.yAxis;
  if (raw === undefined) return [];
  const arr = Array.isArray(raw) ? [...raw] : [raw];
  if (arr.length > 2) throw new Error("yAxis 数组长度 >2（chart.axisSecondary 行：v1 仅副 y 轴 1 根）");
  return arr;
};

const chartXAxis = (chart: ChartLike): ChartAxisLike | undefined => {
  const raw = chart.xAxis;
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) throw new Error("xAxis 数组（副 x 轴）不在 v1 承诺（chart.axisSecondary 行）");
  return raw;
};

interface CartLayout {
  plot: PlotBox;
  yAxes: CartAxis[];
  legend: LegendLayout | null;
  title: TitleInfo | null;
}

function cartesianLayout(
  chart: ChartLike,
  w: number,
  h: number,
  legendItems: LegendItem[],
  isNumeric: boolean,
  cats: string[] | null,
  yAxesIn: CartAxis[],
): CartLayout {
  const xAxis = chartXAxis(chart);
  let left = 8;
  let right = 0;
  let bottom = 0;
  if (yAxesIn.length > 0) {
    left = valueTickGutter(yAxesIn[0].axis, yAxesIn[0].ticks) + axisTitleAdded(yAxesIn[0].axis);
    if (yAxesIn.length > 1) right = valueTickGutter(yAxesIn[1].axis, yAxesIn[1].ticks) + axisTitleAdded(yAxesIn[1].axis);
  }
  if (isNumeric) {
    const [xlo, xhi] = xAxis?.min !== undefined || xAxis?.max !== undefined
      ? domainOf(xAxis.min ?? 0, xAxis.max ?? 1)
      : [0, 10];
    bottom = valueTickGutter(xAxis, ticksOf(xlo, xhi)) + axisTitleAdded(xAxis);
  } else if (cats !== null) {
    bottom = LABEL_FONT_SIZE_DEFAULT + 14 + axisTitleAdded(xAxis);
  }
  if (xAxis !== undefined && !isNumeric && (xAxis.min !== undefined || xAxis.max !== undefined)) {
    throw new Error("xAxis.min/max 仅对 value 轴有效（category 轴给 min/max = 具名拒绝；chart.axisBasic 行）");
  }
  const legend = legendItems.length > 0 ? legendLayout(chart, legendItems, Math.max(1, w - left - right)) : null;
  const title = titleInfo(chart);
  const top = (title !== null ? title.fontSize + 12 : 0) + (legend?.top ?? 0);
  const plot: PlotBox = {
    x: left + (legend?.left ?? 0),
    y: top,
    w: w - left - right - (legend?.left ?? 0) - (legend?.right ?? 0),
    h: h - top - bottom - (legend?.bottom ?? 0),
  };
  if (plot.w <= 0 || plot.h <= 0) throw new Error("plot 尺寸非正（元素过小或边距过大；chart 无渲染面）");
  for (const ya of yAxesIn) {
    ya.scale.outLo = plot.y + plot.h;
    ya.scale.outHi = plot.y;
  }
  return { plot, yAxes: yAxesIn, legend, title };
}

const axisTicksMarkup = (
  ya: CartAxis,
  plot: PlotBox,
  side: "left" | "right",
  labelColor: string,
  labelFontSize: number,
  numberFormat: string | undefined,
  fontFamilyCss?: string,
): string => {
  const parts: string[] = [];
  for (const t of ya.ticks) {
    const y = scaleValue(ya.scale, t);
    if (y < plot.y - 0.5 || y > plot.y + plot.h + 0.5) continue;
    const x = side === "left" ? plot.x - 6 : plot.x + plot.w + 6;
    parts.push(textEl(formatNumber(t, numberFormat), x, y + labelFontSize / 3, { color: labelColor, fontSize: labelFontSize, anchor: side === "left" ? "end" : "start", ...(fontFamilyCss !== undefined ? { fontFamilyCss } : {}) }));
  }
  return parts.join("");
};

const axisTitleMarkup = (ya: CartAxis, plot: PlotBox, side: "left" | "right", chart: ChartLike): string => {
  const t = axisTitleOf(ya.axis);
  if (t === null) return "";
  const fs = t.fontSize ?? AXIS_TITLE_FONT_SIZE_DEFAULT;
  const x = side === "left" ? 10 : plot.x + plot.w + valueTickGutter(ya.axis, ya.ticks) + 10;
  const cy = plot.y + plot.h / 2;
  const fontFamilyCss = chartFontCss(chart, t);
  return `<text${xml("transform", `rotate(-90 ${fmt(x)} ${fmt(cy)})`)}${xml("x", fmt(x))}${xml("y", fmt(cy))}${xml("text-anchor", "middle")}${xml("fill", t.color ?? AXIS_LABEL_COLOR_DEFAULT)}${xml("font-size", fmt(fs))}${fontFamilyCss !== undefined ? xml("font-family", fontFamilyCss) : ""}>${escapeHtml(t.text)}</text>`;
};

const drawDataLabels = (
  labels: Array<{ text: string; x: number; y: number }>,
  dl: ChartDataLabelLike,
  chart: ChartLike,
): string => {
  if (!dl.show) return "";
  const fs = dl.fontSize ?? LABEL_FONT_SIZE_DEFAULT;
  const color = dl.color ?? TEXT_COLOR_DEFAULT;
  const fontFamilyCss = chartFontCss(chart, dl);
  return labels.map((l) => textEl(l.text, l.x, l.y, { color, fontSize: fs, anchor: "middle", ...(fontFamilyCss !== undefined ? { fontFamilyCss } : {}) })).join("");
};

// ---------------------------------------------------------------------------
// 类目 plot 内容
// ---------------------------------------------------------------------------

function renderCartesian(chart: ChartLike, w: number, h: number, elementId: string, defs: string[]): string {
  const series = chart.series;
  assertMixLegal(series);
  const valueCart = series.filter((s) => VALUE_CARTESIAN_TYPES.has(s.type));
  const numeric = series.filter((s) => NUMERIC_TYPES.has(s.type));
  const isNumeric = valueCart.length === 0;
  const cats = isNumeric ? null : sharedCategories(chart, valueCart);
  const yAxes = chartYAxes(chart);
  const axesCount = Math.max(yAxes.length, 1);
  for (const s of series) {
    const idx = s.yAxisIndex ?? 0;
    if (idx >= axesCount) throw new Error(`series ${s.type} yAxisIndex=${idx} 超出 yAxis 数组（chart.axisSecondary 行）`);
  }
  const boundByAxis = (idx: number): ChartSeriesLike[] => series.filter((s) => (s.yAxisIndex ?? 0) === idx);
  const cartAxes: CartAxis[] = [];
  for (let i = 0; i < axesCount; i += 1) {
    const bound = boundByAxis(i);
    cartAxes.push(makeCartAxis(i, yAxes[i], ...valueDomainCartesian(chart, bound, cats)));
  }
  const legendItems: LegendItem[] = series.map((s, i) => {
    const raw = (s.type === "line" || s.type === "area" || s.type === "radar" ? s.lineColor : s.fill) as ChartSeriesFillLike | undefined;
    const color = typeof raw === "string" ? raw : seriesColorOf(chart, i);
    return { label: s.name ?? (s.encode.y ?? s.encode.value ?? s.encode.close ?? s.encode.x), color };
  });
  const layout = cartesianLayout(chart, w, h, legendItems, isNumeric, cats, cartAxes);
  const plot = layout.plot;
  const parts: string[] = [];

  // 网格
  for (const ya of layout.yAxes) {
    const gl = gridLineConfig(ya.axis);
    if (gl !== null) {
      for (const t of ya.ticks) {
        const y = scaleValue(ya.scale, t);
        if (y < plot.y - 0.5 || y > plot.y + plot.h + 0.5) continue;
        parts.push(`<line${xml("x1", fmt(plot.x))}${xml("y1", fmt(y))}${xml("x2", fmt(plot.x + plot.w))}${xml("y2", fmt(y))}${strokeAttrs(gl, GRID_LINE_COLOR_DEFAULT, 1)}/>`);
      }
    }
  }
  // y 刻度/轴名
  const y0 = layout.yAxes[0]!;
  if (y0.axis?.show !== false) {
    const opts0 = axisLabelOpts(y0.axis, chart);
    parts.push(axisTicksMarkup(y0, plot, "left", opts0.color, opts0.fontSize, opts0.numberFormat, opts0.fontFamilyCss));
    parts.push(axisTitleMarkup(y0, plot, "left", chart));
  }
  if (layout.yAxes.length > 1 && layout.yAxes[1]!.axis?.show !== false) {
    const ya1 = layout.yAxes[1]!;
    const opts1 = axisLabelOpts(ya1.axis, chart);
    parts.push(axisTicksMarkup(ya1, plot, "right", opts1.color, opts1.fontSize, opts1.numberFormat, opts1.fontFamilyCss));
    parts.push(axisTitleMarkup(ya1, plot, "right", chart));
  }
  // x 类目/数值刻度
  const xAxis = chartXAxis(chart);
  const optsX = axisLabelOpts(xAxis, chart);
  if (xAxis?.show !== false) {
    if (isNumeric) {
      const xd = numericXDomain(chart, numeric);
      const xlo = xAxis?.min ?? xd[0];
      const xhi = xAxis?.max ?? xd[1];
      const xScale: Scale = { lo: xlo, hi: xhi, outLo: plot.x, outHi: plot.x + plot.w, reverse: xAxis?.reverse === true };
      for (const t of ticksOf(xlo, xhi)) {
        const x = scaleValue(xScale, t);
        parts.push(textEl(formatNumber(t, optsX.numberFormat), x, plot.y + plot.h + LABEL_FONT_SIZE_DEFAULT + 4, { color: optsX.color, fontSize: optsX.fontSize, anchor: "middle", ...(optsX.fontFamilyCss !== undefined ? { fontFamilyCss: optsX.fontFamilyCss } : {}) }));
      }
    } else if (cats !== null) {
      const n = cats.length;
      const slotW = plot.w / n;
      for (let i = 0; i < n; i += 1) {
        parts.push(textEl(cats[i], plot.x + (i + 0.5) * slotW, plot.y + plot.h + LABEL_FONT_SIZE_DEFAULT + 4, { color: optsX.color, fontSize: optsX.fontSize, anchor: "middle", ...(optsX.fontFamilyCss !== undefined ? { fontFamilyCss: optsX.fontFamilyCss } : {}) }));
      }
    }
  }
  // x 轴线（值零基线或槽底）
  const xAxisConf = axisLineConfig(xAxis);
  if (xAxisConf.color !== "none" && y0.axis?.show !== false) {
    const zeroY = y0.scale.lo <= 0 && y0.scale.hi >= 0 ? scaleValue(y0.scale, 0) : plot.y + plot.h;
    parts.push(`<line${xml("x1", fmt(plot.x))}${xml("y1", fmt(zeroY))}${xml("x2", fmt(plot.x + plot.w))}${xml("y2", fmt(zeroY))}${xml("stroke", xAxisConf.color)}${xml("stroke-width", fmt(xAxisConf.width))}/>`);
    if (xAxisConf.arrow !== false) {
      const atStart = xAxisConf.arrow === "start" || xAxisConf.arrow === "both";
      const dirSign = atStart ? -1 : 1;
      const tx = atStart ? plot.x : plot.x + plot.w;
      parts.push(`<path${xml("d", `M ${fmt(tx + dirSign * 6)} ${fmt(zeroY - 3)} L ${fmt(tx)} ${fmt(zeroY)} L ${fmt(tx + dirSign * 6)} ${fmt(zeroY + 3)} Z`)}${xml("fill", xAxisConf.color)}/>`);
    }
  }

  // 确定性 z 序：area 底 → bar → candlestick → line → 数值点顶
  const areaSeries = series.filter((s) => s.type === "area");
  const barSeries = series.filter((s) => s.type === "bar");
  const candleSeries = series.filter((s) => s.type === "candlestick");
  const lineSeries = series.filter((s) => s.type === "line");
  if (areaSeries.length > 0) parts.push(drawAreas(chart, areaSeries, cats, plot, layout.yAxes, elementId, defs));
  if (barSeries.length > 0) parts.push(drawBars(chart, barSeries, cats, plot, layout.yAxes, elementId, defs));
  if (candleSeries.length > 0) parts.push(drawCandlesticks(chart, candleSeries, cats, plot, layout.yAxes, elementId, defs));
  if (lineSeries.length > 0) parts.push(drawLines(chart, lineSeries, cats, plot, layout.yAxes, elementId, defs));
  if (numeric.length > 0) parts.push(drawNumeric(chart, numeric, cats, plot, layout.yAxes, elementId, defs));

  if (layout.title !== null) parts.push(titleMarkup(layout.title, w));
  if (layout.legend !== null) parts.push(legendMarkup(layout.legend, plot, w, h));
  return parts.join("");
}

const barStroke = (border: ChartBorderLike | undefined): string =>
  borderStroke(border);

/** 元素描边属性（rect/path/circle 共用；common.border 行）。 */
const borderStroke = (border: ChartBorderLike | undefined): string => {
  if (border?.color === undefined) return "";
  return `${xml("stroke", border.color)}${xml("stroke-width", fmt(border.width ?? 1))}`;
};

function barShapeMarkup(
  series: ChartSeriesLike,
  x: number,
  y: number,
  width: number,
  height: number,
  paint: string,
  elementId: string,
  seriesIndex: number,
): string {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height < 0) {
    if (series.symbol !== undefined) {
      throw new Error(`bar symbol bounds must be positive finite numbers（barLayout；chart.bar 行）`);
    }
    return "";
  }
  // A zero-value bar is an intentional empty segment.  Keep the historical
  // no-op for it, while ensuring no zero/negative bounds can reach geometry.
  if (height === 0) return "";
  const attrs = `${xml("fill", paint)}${barStroke(series.border)}`.trimStart();
  if (series.symbol === undefined) {
    return `<rect${xml("x", fmt(x))}${xml("y", fmt(y))}${xml("width", fmt(width))}${xml("height", fmt(height))}${xml("fill", paint)}${barStroke(series.border)}/>`;
  }
  const symbol = series.symbol as Record<string, unknown>;
  const geometry = compileStaticV1ShapeGeometry({
    shapeName: symbol.shapeName,
    ...(symbol.adjustments !== undefined ? { adjustments: symbol.adjustments as readonly number[] } : {}),
    ...(symbol.viewBox !== undefined ? { viewBox: symbol.viewBox as readonly number[] } : {}),
    ...(symbol.path !== undefined ? { path: symbol.path as string } : {}),
    bounds: [width, height],
    id: `${elementId}:bar-${seriesIndex}`,
  });
  return `<g${xml("transform", `translate(${fmt(x)} ${fmt(y)})`)}>${staticV1GeometryMarkup(geometry.body, attrs)}</g>`;
}

interface BarColumn {
  x: number;
  barW: number;
  series: ChartSeriesLike | null;
  group: ChartSeriesLike[] | null;
}

function barColumns(chart: ChartLike, barSeries: ChartSeriesLike[], plot: PlotBox, cats: string[]): BarColumn[][] {
  const stacked = barSeries.filter((s) => s.stack !== undefined);
  const modes = new Set(stacked.map((s) => s.stack as string));
  if (modes.size > 1) throw new Error("chart.bar 行：同图 stack 模式必须一致（StackModeMismatch：全部 value 或全部 percent）");
  const plain = barSeries.filter((s) => s.stack === undefined);
  const n = cats.length;
  const slotW = plot.w / n;
  const contentW = slotW * (1 - (chart.categoryGap ?? 0.2));
  const desiredBarW = chart.barWidth !== undefined ? slotW * chart.barWidth : contentW * 0.8;
  const gapW = slotW * (chart.barGap ?? 0);
  const colCount = plain.length + (stacked.length > 0 ? 1 : 0);
  // 组内收缩：默认 barW 按列数均摊到 content 内（显式 barWidth 亦受槽约束）；
  // 仍放不下（参数失衡）才具名拒绝。
  const maxBarW = (contentW - Math.max(colCount - 1, 0) * gapW) / Math.max(colCount, 1);
  const barW = Math.min(desiredBarW, maxBarW);
  if (!Number.isFinite(maxBarW) || maxBarW <= 0 || !Number.isFinite(barW) || barW <= 0) {
    throw new Error(`bar 柱组无法布局：maxBarWidth=${fmt(maxBarW)} / barWidth=${fmt(barW)} 必须为正（barLayout；chart.barLayout 行）`);
  }
  const totalW = colCount * barW + Math.max(colCount - 1, 0) * gapW;
  if (totalW > contentW + 1e-9) {
    throw new Error(`bar 柱组过宽 ${fmt(totalW)} > 槽内容 ${fmt(contentW)}（barLayout 参数失衡；chart.barLayout 行）`);
  }
  return cats.map((_cat, i) => {
    const startX = plot.x + i * slotW + (contentW - totalW) / 2;
    const cols: BarColumn[] = [];
    plain.forEach((s, j) => cols.push({ x: startX + j * (barW + gapW), barW, series: s, group: null }));
    if (stacked.length > 0) cols.push({ x: startX + plain.length * (barW + gapW), barW, series: null, group: stacked });
    return cols;
  });
}

function drawBars(
  chart: ChartLike,
  barSeries: ChartSeriesLike[],
  cats: string[] | null,
  plot: PlotBox,
  yAxes: CartAxis[],
  elementId: string,
  defs: string[],
): string {
  if (cats === null) return "";
  const columns = barColumns(chart, barSeries, plot, cats);
  const parts: string[] = [];
  for (let slot = 0; slot < cats.length; slot += 1) {
    for (const col of columns[slot]) {
      if (col.series !== null) {
        const s = col.series;
        const v = catPoints(chart, s, cats)[slot]?.value;
        if (v === null || v === undefined || v === 0) continue;
        const ya = yAxes[s.yAxisIndex ?? 0]!;
        const y0v = scaleValue(ya.scale, 0);
        const y1v = scaleValue(ya.scale, v);
        const top = Math.min(y0v, y1v);
        const bh = Math.abs(y1v - y0v);
        const si = chart.series.indexOf(s);
        const paint = seriesPaint(s.fill as ChartSeriesFillLike | undefined, defs, elementId, `bar-${si}`, seriesColorOf(chart, si));
        parts.push(barShapeMarkup(s, col.x, top, col.barW, bh, paint, elementId, si));
        const dl = effectiveDataLabels(chart, s);
        if (dl.show) {
          parts.push(drawDataLabels([{ text: formatNumber(v, dl.numberFormat), x: col.x + col.barW / 2, y: top - 2 }], dl, chart));
        }
      } else if (col.group !== null) {
        const stackMode = col.group[0]!.stack as "value" | "percent";
        const ya = yAxes[col.group[0]!.yAxisIndex ?? 0]!;
        const segs = col.group.map((s) => ({ s, v: catPoints(chart, s, cats)[slot]?.value ?? 0 }));
        if (stackMode === "percent") {
          const pos = segs.reduce((acc, k) => acc + Math.max(k.v, 0), 0);
          const neg = segs.reduce((acc, k) => acc + Math.max(-k.v, 0), 0);
          let positiveBase = 0;
          let negativeBase = 0;
          for (const k of segs) {
            const norm = k.v >= 0 ? (pos > 0 ? k.v / pos : 0) : (neg > 0 ? k.v / neg : 0);
            const start = k.v >= 0 ? positiveBase : negativeBase;
            // `norm` keeps the sign of the authored value.  Both bases move
            // by that signed amount; only the base chosen for the segment is
            // updated, so negative segments extend below the zero line.
            const end = start + norm;
            if (k.v >= 0) positiveBase = end;
            else negativeBase = end;
            const y0v = scaleValue(ya.scale, start);
            const y1v = scaleValue(ya.scale, end);
            const top = Math.min(y0v, y1v);
            const bh = Math.abs(y1v - y0v);
            if (bh <= 0) continue;
            const si = chart.series.indexOf(k.s);
            parts.push(barShapeMarkup(k.s, col.x, top, col.barW, bh, seriesPaint(k.s.fill as ChartSeriesFillLike | undefined, defs, elementId, `bar-${si}`, seriesColorOf(chart, si)), elementId, si));
          }
        } else {
          let positiveBase = 0;
          let negativeBase = 0;
          for (const k of segs) {
            const start = k.v >= 0 ? positiveBase : negativeBase;
            const end = start + k.v;
            if (k.v >= 0) positiveBase = end;
            else negativeBase = end;
            const y0v = scaleValue(ya.scale, start);
            const y1v = scaleValue(ya.scale, end);
            const top = Math.min(y0v, y1v);
            const bh = Math.abs(y1v - y0v);
            if (bh <= 0) continue;
            const si = chart.series.indexOf(k.s);
            parts.push(barShapeMarkup(k.s, col.x, top, col.barW, bh, seriesPaint(k.s.fill as ChartSeriesFillLike | undefined, defs, elementId, `bar-${si}`, seriesColorOf(chart, si)), elementId, si));
          }
        }
      }
    }
  }
  return parts.join("");
}

const lineDashOf = (s: ChartSeriesLike): string | undefined =>
  dashArrayOf((s.lineStyle as "solid" | "dash" | "dot" | undefined) ?? "solid");

const nullHandlingOf = (_chart: ChartLike, seriesList: ChartSeriesLike[]): "zero" | "gap" | "connect" => {
  for (const s of seriesList) {
    if (s.nullHandling !== undefined) return s.nullHandling;
  }
  return "gap";
};

const lineSegments = (points: CatPoint[], nulling: "zero" | "gap" | "connect"): CatPoint[][] => {
  const segs: CatPoint[][] = [];
  let cur: CatPoint[] = [];
  for (const p of points) {
    const v = p.value === null && nulling === "zero" ? 0 : p.value;
    if (v === null) {
      if (nulling === "gap") {
        if (cur.length > 0) {
          segs.push(cur);
          cur = [];
        }
      }
      continue;
    }
    cur.push({ ...p, value: v });
  }
  if (cur.length > 0) segs.push(cur);
  return segs;
};

const smoothPath = (pts: Array<{ x: number; y: number }>): string => {
  if (pts.length === 1) return `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 1; i < pts.length; i += 1) {
    const mx = (pts[i - 1].x + pts[i].x) / 2;
    d += ` C ${fmt(mx)} ${fmt(pts[i - 1].y)}, ${fmt(mx)} ${fmt(pts[i].y)}, ${fmt(pts[i].x)} ${fmt(pts[i].y)}`;
  }
  return d;
};

const catToXY = (points: CatPoint[], plot: PlotBox, cats: string[], ya: CartAxis): Array<{ x: number; y: number }> => {
  const slotW = plot.w / cats.length;
  return points.map((p) => ({ x: plot.x + (p.slot + 0.5) * slotW, y: scaleValue(ya.scale, p.value as number) }));
};

const markerMarkup = (
  shape: "circle" | "rect" | "diamond" | "triangle",
  cx: number,
  cy: number,
  size: number,
  fill: string,
  border: ChartBorderLike | undefined,
): string => {
  const stroke = barStroke(border);
  switch (shape) {
    case "circle": {
      const r = size / 2;
      return `<circle${xml("cx", fmt(cx))}${xml("cy", fmt(cy))}${xml("r", fmt(r))}${xml("fill", fill)}${stroke}/>`;
    }
    case "rect":
      return `<rect${xml("x", fmt(cx - size / 2))}${xml("y", fmt(cy - size / 2))}${xml("width", fmt(size))}${xml("height", fmt(size))}${xml("fill", fill)}${stroke}/>`;
    case "diamond":
      return `<path${xml("d", `M ${fmt(cx)} ${fmt(cy - size / 2)} L ${fmt(cx + size / 2)} ${fmt(cy)} L ${fmt(cx)} ${fmt(cy + size / 2)} L ${fmt(cx - size / 2)} ${fmt(cy)} Z`)}${xml("fill", fill)}${stroke}/>`;
    case "triangle":
      return `<path${xml("d", `M ${fmt(cx)} ${fmt(cy - size / 2)} L ${fmt(cx + size / 2)} ${fmt(cy + size / 2)} L ${fmt(cx - size / 2)} ${fmt(cy + size / 2)} Z`)}${xml("fill", fill)}${stroke}/>`;
  }
};

const markerShapeOf = (s: ChartSeriesLike): "circle" | "rect" | "diamond" | "triangle" => {
  const m = s.marker;
  return (typeof m === "object" && m !== null && m.shape !== undefined ? m.shape : "circle");
};

function drawLines(
  chart: ChartLike,
  lineSeries: ChartSeriesLike[],
  cats: string[] | null,
  plot: PlotBox,
  yAxes: CartAxis[],
  elementId: string,
  defs: string[],
): string {
  if (cats === null) return "";
  const nulling = nullHandlingOf(chart, lineSeries);
  const parts: string[] = [];
  lineSeries.forEach((s, si) => {
    const ya = yAxes[s.yAxisIndex ?? 0]!;
    const pts = catPoints(chart, s, cats);
    const segs = lineSegments(pts, nulling);
    const color = seriesPaint(s.lineColor as ChartSeriesFillLike | undefined, defs, elementId, `line-${si}`, seriesColorOf(chart, si));
    const width = s.width ?? 2;
    const dash = lineDashOf(s);
    const attrs = `${xml("stroke", color)}${xml("stroke-width", fmt(width))}${dash !== undefined ? xml("stroke-dasharray", dash) : ""}${xml("fill", "none")}`;
    for (const seg of segs) {
      const xy = catToXY(seg, plot, cats, ya);
      const d = s.smooth === true && xy.length > 1 ? smoothPath(xy) : xy.map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p.x)} ${fmt(p.y)}`).join(" ");
      parts.push(`<path${xml("d", d)}${attrs}/>`);
    }
    const marker = s.marker;
    if (marker !== false) {
      const shape = markerShapeOf(s);
      const size = typeof marker === "object" && marker?.size !== undefined ? marker.size : 6;
      for (const seg of segs) {
        for (const p of seg) {
          const xy = catToXY([p], plot, cats, ya)[0]!;
          const fill = typeof marker === "object" && marker?.fill !== undefined
            ? seriesPaint(marker.fill as ChartSeriesFillLike, defs, elementId, `line-mk-${si}`, color)
            : color;
          parts.push(markerMarkup(shape, xy.x, xy.y, size, fill, typeof marker === "object" ? marker.border : undefined));
        }
      }
    }
    const dl = effectiveDataLabels(chart, s);
    if (dl.show) {
      const labels = segs.flatMap((seg) => catToXY(seg, plot, cats, ya).map((xy, k) => ({ text: formatNumber(seg[k]!.value as number, dl.numberFormat), x: xy.x, y: xy.y - 6 })));
      parts.push(drawDataLabels(labels, dl, chart));
    }
  });
  return parts.join("");
}

/** area 共享基线与 extent 计算：mode=null → 零基线；value/percent/stream → 累计。 */
function areaBaselineOf(
  chart: ChartLike,
  group: ChartSeriesLike[],
  mode: "value" | "percent" | "stream" | null,
  cats: string[],
  slot: number,
  seriesIdx: number,
): { start: number; extent: number } {
  const values = group.map((s) => catPoints(chart, s, cats)[slot]?.value ?? 0);
  if (mode === null) {
    return { start: 0, extent: values[seriesIdx] ?? 0 };
  }
  if (mode === "percent") {
    const pos = values.reduce((a, v) => a + Math.max(v, 0), 0);
    const neg = values.reduce((a, v) => a + Math.max(-v, 0), 0);
    let cum = 0;
    for (let i = 0; i < seriesIdx; i += 1) {
      const v = values[i]!;
      cum += v >= 0 ? (pos > 0 ? v / pos : 0) : (neg > 0 ? v / neg : 0);
    }
    const v = values[seriesIdx]!;
    const norm = v >= 0 ? (pos > 0 ? v / pos : 0) : (neg > 0 ? v / neg : 0);
    return { start: cum, extent: norm };
  }
  if (mode === "stream") {
    const total = values.reduce((a, v) => a + v, 0);
    let cum = 0;
    for (let i = 0; i < seriesIdx; i += 1) cum += values[i]!;
    const v = values[seriesIdx]!;
    return { start: cum - total / 2, extent: v };
  }
  let cum = 0;
  for (let i = 0; i < seriesIdx; i += 1) cum += values[i]!;
  return { start: cum, extent: values[seriesIdx] ?? 0 };
}

function drawAreas(
  chart: ChartLike,
  areaSeries: ChartSeriesLike[],
  cats: string[] | null,
  plot: PlotBox,
  yAxes: CartAxis[],
  elementId: string,
  defs: string[],
): string {
  if (cats === null) return "";
  const parts: string[] = [];
  const stacked = areaSeries.filter((s) => s.stack !== undefined);
  const modes = new Set(stacked.map((s) => s.stack as string));
  if (modes.size > 1) throw new Error("chart.area 行：同图 stack 模式必须一致（StackModeMismatch）");
  const mode = stacked.length > 0 ? ([...modes][0] as "value" | "percent" | "stream") : null;
  const group = mode !== null ? stacked : areaSeries;

  const drawOne = (s: ChartSeriesLike, seriesIdx: number): void => {
    const nulling = nullHandlingOf(chart, areaSeries);
    const pts = catPoints(chart, s, cats);
    const segs = lineSegments(pts, nulling);
    const ya = yAxes[s.yAxisIndex ?? 0]!;
    const lineColor = seriesPaint(s.lineColor as ChartSeriesFillLike | undefined, defs, elementId, `area-line-${seriesIdx}`, seriesColorOf(chart, seriesIdx));
    const areaCfg = s.areaColor as ChartSeriesFillLike | undefined;
    const areaColor = areaCfg !== undefined ? seriesPaint(areaCfg, defs, elementId, `area-fill-${seriesIdx}`, lineColor) : lineColor;
    const opacity = areaCfg === undefined ? 0.25 : 1;
    const width = s.width ?? 2;
    const dash = lineDashOf(s);
    const lineAttrs = `${xml("stroke", lineColor)}${xml("stroke-width", fmt(width))}${dash !== undefined ? xml("stroke-dasharray", dash) : ""}${xml("fill", "none")}`;
    const slotW = plot.w / cats.length;
    const xy = (seg: CatPoint[]): Array<{ x: number; y: number }> =>
      seg.map((p) => ({ x: plot.x + (p.slot + 0.5) * slotW, y: scaleValue(ya.scale, p.value as number) }));
    for (const seg of segs) {
      const pts2 = xy(seg);
      const baseYs = seg.map((p) => scaleValue(ya.scale, areaBaselineOf(chart, group, mode, cats, p.slot, seriesIdx).start));
      const pathTop = s.smooth === true && pts2.length > 1 ? smoothPath(pts2) : pts2.map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p.x)} ${fmt(p.y)}`).join(" ");
      parts.push(`<path${xml("d", `${pathTop} L ${fmt(pts2[pts2.length - 1].x)} ${fmt(baseYs[baseYs.length - 1])} L ${fmt(pts2[0].x)} ${fmt(baseYs[0])} Z`)}${xml("fill", areaColor)}${xml("fill-opacity", fmt(opacity))}${xml("stroke", "none")}/>`);
      parts.push(`<path${xml("d", pathTop)}${lineAttrs}/>`);
    }
    const marker = s.marker;
    if (marker !== false) {
      const shape = markerShapeOf(s);
      const size = typeof marker === "object" && marker?.size !== undefined ? marker.size : 6;
      for (const seg of segs) {
        for (const p of seg) {
          const pt2 = xy([p])[0]!;
          const fill = typeof marker === "object" && marker?.fill !== undefined ? seriesPaint(marker.fill as ChartSeriesFillLike, defs, elementId, `area-mk-${seriesIdx}`, lineColor) : lineColor;
          parts.push(markerMarkup(shape, pt2.x, pt2.y, size, fill, typeof marker === "object" ? marker.border : undefined));
        }
      }
    }
    const dl = effectiveDataLabels(chart, s);
    if (dl.show) {
      const labels: Array<{ text: string; x: number; y: number }> = [];
      for (const seg of segs) {
        const pts2 = xy(seg);
        pts2.forEach((p, k) => labels.push({ text: formatNumber(seg[k]!.value as number, dl.numberFormat), x: p.x, y: p.y - 6 }));
      }
      parts.push(drawDataLabels(labels, dl, chart));
    }
  };
  group.forEach((s, i) => drawOne(s, i));
  return parts.join("");
}

function drawCandlesticks(
  chart: ChartLike,
  candleSeries: ChartSeriesLike[],
  cats: string[] | null,
  plot: PlotBox,
  yAxes: CartAxis[],
  _elementId: string,
  _defs: string[],
): string {
  if (cats === null) return "";
  const parts: string[] = [];
  const slotW = plot.w / cats.length;
  const contentW = slotW * (1 - (chart.categoryGap ?? 0.2));
  const bodyW = chart.barWidth !== undefined ? slotW * chart.barWidth : contentW * 0.5;
  for (const s of candleSeries) {
    const ya = yAxes[s.yAxisIndex ?? 0]!;
    const ciH = colIndexOf(chart.data, s.encode.high, `series ${s.type}`);
    const ciL = colIndexOf(chart.data, s.encode.low, `series ${s.type}`);
    const ciC = colIndexOf(chart.data, s.encode.close, `series ${s.type}`);
    const ciO = s.encode.open === undefined ? -1 : colIndexOf(chart.data, s.encode.open!, `series ${s.type}`);
    const wickAttrs = `${xml("stroke", s.wickStyle?.color ?? CANDLE_WICK_DEFAULT)}${xml("stroke-width", fmt(s.wickStyle?.width ?? 1))}`;
    for (let slot = 0; slot < cats.length; slot += 1) {
      const cx = plot.x + (slot + 0.5) * slotW;
      const high = numOf(cellAt(chart.data, slot, ciH), `series ${s.type} 第 ${slot} 行 high`);
      const low = numOf(cellAt(chart.data, slot, ciL), `series ${s.type} 第 ${slot} 行 low`);
      const close = numOf(cellAt(chart.data, slot, ciC), `series ${s.type} 第 ${slot} 行 close`);
      if (high === null || low === null || close === null) continue;
      const yHigh = scaleValue(ya.scale, high);
      const yLow = scaleValue(ya.scale, low);
      parts.push(`<line${xml("x1", fmt(cx))}${xml("y1", fmt(yHigh))}${xml("x2", fmt(cx))}${xml("y2", fmt(yLow))}${wickAttrs}/>`);
      if (ciO >= 0) {
        const open = numOf(cellAt(chart.data, slot, ciO), `series ${s.type} 第 ${slot} 行 open`);
        if (open === null) continue;
        const up = close > open;
        const fill = up ? (s.upBars?.fill ?? CANDLE_UP_DEFAULT) : (s.downBars?.fill ?? CANDLE_DOWN_DEFAULT);
        const border = up ? s.upBars?.border : s.downBars?.border;
        const yO = scaleValue(ya.scale, open);
        const yC = scaleValue(ya.scale, close);
        const top = Math.min(yO, yC);
        const bh = Math.max(Math.abs(yO - yC), 1);
        parts.push(`<rect${xml("x", fmt(cx - bodyW / 2))}${xml("y", fmt(top))}${xml("width", fmt(bodyW))}${xml("height", fmt(bh))}${xml("fill", fill)}${barStroke(border)}/>`);
      } else {
        const yC = scaleValue(ya.scale, close);
        parts.push(`<circle${xml("cx", fmt(cx))}${xml("cy", fmt(yC))}${xml("r", fmt(2.5))}${xml("fill", s.wickStyle?.color ?? CANDLE_WICK_DEFAULT)}/>`);
      }
    }
  }
  return parts.join("");
}

function bubbleRadiusOf(_chart: ChartLike, s: ChartSeriesLike, pts: NumPoint[], plot: PlotBox): number[] {
  const scaleKind = s.sizeScale ?? "sqrt";
  const [rMin, rMax] = s.sizeRange ?? [4, Math.max(6, Math.min(plot.w, plot.h) * 0.12)];
  const transform = (v: number): number => {
    const safe = Math.max(v, 0);
    if (scaleKind === "linear") return safe;
    if (scaleKind === "log") return Math.log1p(safe);
    return Math.sqrt(safe);
  };
  const ts = pts.map((p) => (p.size === null ? null : transform(p.size)));
  const valid = ts.filter((t): t is number => t !== null);
  if (valid.length === 0) return pts.map(() => 0);
  const tMin = Math.min(...valid);
  const tMax = Math.max(...valid);
  return ts.map((t) => {
    if (t === null) return 0;
    const norm = tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin);
    return rMin + norm * (rMax - rMin);
  });
}

function drawNumeric(
  chart: ChartLike,
  numeric: ChartSeriesLike[],
  cats: string[] | null,
  plot: PlotBox,
  yAxes: CartAxis[],
  elementId: string,
  defs: string[],
): string {
  const parts: string[] = [];
  const slotW = plot.w / Math.max(cats?.length ?? 1, 1);
  const xd = cats === null ? numericXDomain(chart, numeric) : null;
  const xlo = xd !== null ? (chartXAxis(chart)?.min ?? xd[0]) : 0;
  const xhi = xd !== null ? (chartXAxis(chart)?.max ?? xd[1]) : 1;
  const xScale: Scale = xd !== null ? { lo: xlo, hi: xhi, outLo: plot.x, outHi: plot.x + plot.w, reverse: chartXAxis(chart)?.reverse === true } : { lo: 0, hi: 1, outLo: plot.x, outHi: plot.x + plot.w, reverse: false };
  for (const s of numeric) {
    const si = chart.series.indexOf(s);
    const pts = numericPoints(chart, s);
    const ya = yAxes[s.yAxisIndex ?? 0]!;
    const usable = pts.filter((p): p is { x: number; y: number; size: number | null } => p.x !== null && p.y !== null);
    if (usable.length === 0) continue;
    const radii = s.type === "bubble" ? bubbleRadiusOf(chart, s, pts, plot) : null;
    const paint = seriesPaint(s.fill as ChartSeriesFillLike | undefined, defs, elementId, `num-${si}`, seriesColorOf(chart, si));
    usable.forEach((p, k) => {
      let px: number;
      if (cats === null) {
        px = scaleValue(xScale, p.x);
      } else {
        const r = pts.indexOf(p);
        if (r >= cats.length) throw new Error("scatter/bubble 数据行数超出类目槽（chart.typeMixing 行混排；wide-table 行数须与类目对齐）");
        px = plot.x + (r + 0.5) * slotW;
      }
      const py = scaleValue(ya.scale, p.y);
      const r = s.type === "bubble" ? radii![k] : ((typeof s.marker === "object" && s.marker?.size !== undefined ? s.marker.size : 6) / 2);
      const shape = s.type === "scatter" ? markerShapeOf(s) : "circle";
      const markerFill = s.type === "scatter" && typeof s.marker === "object" && s.marker?.fill !== undefined
        ? seriesPaint(s.marker.fill as ChartSeriesFillLike, defs, elementId, `scatter-mk-${si}`, paint)
        : paint;
      const border = s.type === "scatter" && typeof s.marker === "object" ? s.marker.border : undefined;
      parts.push(markerMarkup(shape, px, py, Math.max(r * 2, 1), markerFill, border));
    });
    const dl = effectiveDataLabels(chart, s);
    if (dl.show) {
      const labels = usable.map((p, k) => {
        const px2 = cats === null ? scaleValue(xScale, p.x) : plot.x + (pts.indexOf(p) + 0.5) * slotW;
        const py2 = scaleValue(ya.scale, p.y);
        const rr = s.type === "bubble" ? radii![k] : 3;
        return { text: formatNumber(p.y, dl.numberFormat), x: px2, y: py2 - rr - 4 };
      });
      parts.push(drawDataLabels(labels, dl, chart));
    }
  }
  return parts.join("");
}

// ---------------------------------------------------------------------------
// pie
// ---------------------------------------------------------------------------

/** pie 逐片填充：solid 直写；gradient 走 defs（fill.* 行 series 宿主）；数组按片循环。 */
const pieSlicePaint = (
  fill: ChartSeriesLike["fill"] | undefined,
  index: number,
  fallback: string,
  defs: string[],
  elementId: string,
  suffix: string,
): string => {
  if (fill === undefined) return fallback;
  if (typeof fill === "string") return fill;
  if (Array.isArray(fill)) {
    const f = fill[index % fill.length];
    if (f === undefined) return fallback;
    return pieSlicePaint(f, 0, fallback, defs, elementId, `${suffix}-${index}`);
  }
  if (typeof fill === "object" && "type" in fill && (fill as { type: string }).type === "gradient") {
    return seriesPaint(fill as ChartSeriesFillLike, defs, elementId, suffix, fallback);
  }
  throw new Error(`pie fill 形态非法（须 solid/gradient/数组；chart.pie 行）`);
};

function renderPie(chart: ChartLike, w: number, h: number, elementId: string, defs: string[]): string {
  const s = chart.series[0]!;
  assertMixLegal(chart.series);
  if (s.innerRadius !== undefined && (s.innerRadius < 0 || s.innerRadius > 1)) {
    throw new Error(`pie innerRadius=${s.innerRadius} 越界 [0,1]（chart.pie 行）`);
  }
  const ci = colIndexOf(chart.data, s.encode.category, "series pie");
  const vi = colIndexOf(chart.data, s.encode.value, "series pie");
  const slices: Array<{ category: string | null; value: number }> = [];
  for (const [r] of chart.data.rows.entries()) {
    const v = numOf(cellAt(chart.data, r, vi), `series pie 第 ${r} 行 value`);
    if (v === null) continue;
    if (v < 0) throw new Error(`pie value < 0（第 ${r} 行 ${v}；chart.pie 行）`);
    slices.push({ category: catOf(cellAt(chart.data, r, ci)), value: v });
  }
  if (slices.length === 0) throw new Error("pie 无有效数据行");
  const total = slices.reduce((acc, k) => acc + k.value, 0);
  if (total <= 0) throw new Error("pie 总值为 0（chart.pie 行：无渲染弧度）");
  const palette = paletteOf(chart);
  const legendItems: LegendItem[] = slices.map((k, i) => ({
    label: k.category ?? `slice ${i}`,
    color: pieSlicePaint(s.fill, i, palette[i % palette.length], defs, elementId, "pie"),
  }));
  const layout = nonCartLayout(chart, w, h, legendItems);
  const plot = layout.plot;
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const dl = effectiveDataLabels(chart, s);
  const labelExtra = dl.show ? 16 : 0;
  const r = Math.max(Math.min(plot.w, plot.h) / 2 - labelExtra, 4);
  const inner = (s.innerRadius ?? 0) * r;
  const start = ((s.startAngle ?? 0) % 360 + 360) % 360;
  const pt = (a: number, radius: number): { x: number; y: number } => {
    const rad = (a * Math.PI) / 180;
    return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
  };
  const parts: string[] = [];
  let angle = start;
  for (let i = 0; i < slices.length; i += 1) {
    const k = slices[i]!;
    const color = pieSlicePaint(s.fill, i, palette[i % palette.length], defs, elementId, "pie");
    const sweep = (k.value / total) * 360;
    const angleEnd = angle + sweep;
    const large = sweep > 180 ? 1 : 0;
    if (sweep >= 359.999) {
      parts.push(`<circle${xml("cx", fmt(cx))}${xml("cy", fmt(cy))}${xml("r", fmt(r))}${xml("fill", color)}${pieBorder(s.border)}/>`);
      if (inner > 0) parts.push(`<circle${xml("cx", fmt(cx))}${xml("cy", fmt(cy))}${xml("r", fmt(inner))}${xml("fill", "transparent")}${pieBorder(s.border)}/>`);
    } else {
      const p0 = pt(angle, r);
      const p1 = pt(angleEnd, r);
      let d: string;
      if (inner > 0) {
        const q0 = pt(angleEnd, inner);
        const q1 = pt(angle, inner);
        d = `M ${fmt(p0.x)} ${fmt(p0.y)} A ${fmt(r)} ${fmt(r)} 0 ${large} 1 ${fmt(p1.x)} ${fmt(p1.y)} L ${fmt(q0.x)} ${fmt(q0.y)} A ${fmt(inner)} ${fmt(inner)} 0 ${large} 0 ${fmt(q1.x)} ${fmt(q1.y)} Z`;
      } else {
        d = `M ${fmt(p0.x)} ${fmt(p0.y)} A ${fmt(r)} ${fmt(r)} 0 ${large} 1 ${fmt(p1.x)} ${fmt(p1.y)} L ${fmt(cx)} ${fmt(cy)} Z`;
      }
      parts.push(`<path${xml("d", d)}${xml("fill", color)}${pieBorder(s.border)}/>`);
    }
    angle = angleEnd;
  }
  if (dl.show) {
    const labels: Array<{ text: string; x: number; y: number }> = [];
    let a = start;
    for (let i = 0; i < slices.length; i += 1) {
      const k = slices[i]!;
      const sweep = (k.value / total) * 360;
      let text: string;
      if (dl.content === "percentage") text = formatNumber((k.value / total) * 100, dl.numberFormat) + "%";
      else if (dl.content === "category") text = k.category ?? String(i);
      else text = formatNumber(k.value, dl.numberFormat);
      const lp = pt(a + sweep / 2, r + 10);
      labels.push({ text, x: lp.x, y: lp.y });
      a += sweep;
    }
    parts.push(drawDataLabels(labels, dl, chart));
  }
  if (layout.title !== null) parts.push(titleMarkup(layout.title, w));
  if (layout.legend !== null) parts.push(legendMarkup(layout.legend, plot, w, h));
  return parts.join("");
}

const pieBorder = (border: ChartBorderLike | undefined): string =>
  borderStroke(border);

// ---------------------------------------------------------------------------
// 非坐标系共享布局
// ---------------------------------------------------------------------------

function nonCartLayout(
  chart: ChartLike,
  w: number,
  h: number,
  legendItems: LegendItem[],
  extraRight = 0,
  extraLeft = 0,
  extraBottom = 0,
): { plot: PlotBox; legend: LegendLayout | null; title: TitleInfo | null } {
  const legend = legendItems.length > 0 ? legendLayout(chart, legendItems, Math.max(1, w - extraRight - extraLeft)) : null;
  const title = titleInfo(chart);
  const top = (title !== null ? title.fontSize + 12 : 0) + (legend?.top ?? 0);
  const plot: PlotBox = {
    x: extraLeft + (legend?.left ?? 0),
    y: top,
    w: w - extraLeft - extraRight - (legend?.left ?? 0) - (legend?.right ?? 0),
    h: h - top - extraBottom - (legend?.bottom ?? 0),
  };
  if (plot.w <= 0 || plot.h <= 0) throw new Error("plot 尺寸非正（chart 无渲染面）");
  return { plot, legend, title };
}

// ---------------------------------------------------------------------------
// radar
// ---------------------------------------------------------------------------

function renderRadar(chart: ChartLike, w: number, h: number, elementId: string, defs: string[]): string {
  const series = chart.series;
  assertMixLegal(series);
  if (!series.every((s) => s.type === "radar")) throw new Error("chart.radar 行：radar 独占（PPTD §5.4）");
  const catCols = new Set(series.map((s) => s.encode.category));
  if (catCols.size > 1) throw new Error("chart.radar 行：所有 radar series encode.category 必须同列（共享 spoke）");
  const cats = sharedCategoryValues(chart, series, "category");
  const nulling = nullHandlingOf(chart, series);
  const spoke = chart.spokeAxis;
  const values: number[] = [];
  for (const s of series) {
    const ci = colIndexOf(chart.data, s.encode.y, `series ${s.type}`);
    for (const [r] of chart.data.rows.entries()) {
      const v = numOf(cellAt(chart.data, r, ci), `series ${s.type} 第 ${r} 行 y`);
      if (v !== null) values.push(v);
    }
  }
  if (values.length === 0) throw new Error("radar 无数值数据");
  const d0 = spoke?.min ?? 0;
  const d1 = spoke?.max ?? Math.max(...values);
  const legendItems: LegendItem[] = series.map((s, i) => ({
    label: s.name ?? s.encode.y,
    color: typeof s.lineColor === "string" ? s.lineColor : seriesColorOf(chart, i),
  }));
  const layout = nonCartLayout(chart, w, h, legendItems);
  const plot = layout.plot;
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const maxR = Math.min(plot.w, plot.h) / 2 - 18;
  const scale: Scale = { lo: d0, hi: d1, outLo: 0, outHi: maxR, reverse: false };
  const n = cats.length;
  const angleOf = (i: number): number => -90 + (i * 360) / n;
  const ptAt = (i: number, radius: number): { x: number; y: number } => {
    const rad = (angleOf(i) * Math.PI) / 180;
    return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
  };
  const parts: string[] = [];
  if (spoke?.show !== false) {
    const grid = gridLineConfig(spoke as never as ChartAxisLike | undefined);
    for (let ring = 1; ring <= 4; ring += 1) {
      const rr = (maxR * ring) / 4;
      const ringPts = cats.map((_c, i) => ptAt(i, rr));
      const d = `${ringPts.map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p.x)} ${fmt(p.y)}`).join(" ")} Z`;
      parts.push(`<path${xml("d", d)}${xml("fill", "none")}${strokeAttrs(grid ?? undefined, GRID_LINE_COLOR_DEFAULT, 1)}/>`);
    }
    const spokeConf = spoke?.axisLine;
    const spokeCfg = typeof spokeConf === "object" && spokeConf !== null ? spokeConf : undefined;
    const spokeAttrs = spokeConf === false ? `stroke="none"` : strokeAttrs(spokeCfg, AXIS_LINE_COLOR_DEFAULT, 1);
    for (let i = 0; i < n; i += 1) {
      const p = ptAt(i, maxR);
      parts.push(`<line${xml("x1", fmt(cx))}${xml("y1", fmt(cy))}${xml("x2", fmt(p.x))}${xml("y2", fmt(p.y))}${spokeAttrs}/>`);
    }
    const labelCfg = spoke?.label;
    if (labelCfg !== false) {
      const opts = typeof labelCfg === "object" && labelCfg !== null ? labelCfg : {};
      const fs = opts.fontSize ?? LABEL_FONT_SIZE_DEFAULT;
      const color = opts.color ?? AXIS_LABEL_COLOR_DEFAULT;
      for (let i = 0; i < n; i += 1) {
        const p = ptAt(i, maxR + 12);
        const anchor = p.x < cx - 1 ? "end" : p.x > cx + 1 ? "start" : "middle";
        const fontFamilyCss = chartFontCss(chart, opts);
        parts.push(textEl(cats[i], p.x, p.y + fs / 3, { color, fontSize: fs, anchor, ...(fontFamilyCss !== undefined ? { fontFamilyCss } : {}) }));
      }
    }
    for (let ring = 1; ring <= 4; ring += 1) {
      const val = d0 + ((d1 - d0) * ring) / 4;
      const p = ptAt(0, (maxR * ring) / 4);
      parts.push(textEl(formatNumber(val, undefined), p.x, p.y - 4, { color: AXIS_LABEL_COLOR_DEFAULT, fontSize: LABEL_FONT_SIZE_DEFAULT, anchor: "middle" }));
    }
  }
  series.forEach((s, si) => {
    const lineColor = seriesPaint(s.lineColor as ChartSeriesFillLike | undefined, defs, elementId, `radar-line-${si}`, seriesColorOf(chart, si));
    const areaCfg = s.areaColor as ChartSeriesFillLike | undefined;
    const areaColor = areaCfg !== undefined ? seriesPaint(areaCfg, defs, elementId, `radar-fill-${si}`, lineColor) : lineColor;
    const opacity = areaCfg === undefined ? 0.25 : 1;
    const ci = colIndexOf(chart.data, s.encode.y, `series ${s.type}`);
    const catCi = colIndexOf(chart.data, s.encode.category, "series radar");
    const labelPts: Array<{ text: string; x: number; y: number }> = [];
    const verts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < n; i += 1) {
      const r = chart.data.rows.findIndex((_row, ri) => catOf(cellAt(chart.data, ri, catCi)) === cats[i]);
      if (r < 0) continue;
      let v = numOf(cellAt(chart.data, r, ci), `series ${s.type} 第 ${r} 行 y`);
      if (v === null) {
        if (nulling === "zero") v = 0;
        else continue;
      }
      const rr = scaleValue(scale, v);
      verts.push(ptAt(i, rr));
      labelPts.push({ text: formatNumber(v, undefined), x: ptAt(i, rr).x, y: ptAt(i, rr).y - 4 });
    }
    if (verts.length === 0) return;
    const d = `${verts.map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p.x)} ${fmt(p.y)}`).join(" ")} Z`;
    parts.push(`<path${xml("d", d)}${xml("fill", areaColor)}${xml("fill-opacity", fmt(opacity))}${xml("stroke", "none")}/>`);
    const width = s.width ?? 2;
    const dash = lineDashOf(s);
    parts.push(`<path${xml("d", d)}${xml("fill", "none")}${xml("stroke", lineColor)}${xml("stroke-width", fmt(width))}${dash !== undefined ? xml("stroke-dasharray", dash) : ""}/>`);
    const dl = effectiveDataLabels(chart, s);
    if (dl.show) parts.push(drawDataLabels(labelPts, dl, chart));
    const marker = s.marker;
    if (marker !== false) {
      for (const p of verts) parts.push(markerMarkup(markerShapeOf(s), p.x, p.y, typeof s.marker === "object" && s.marker?.size !== undefined ? s.marker.size : 3, lineColor, undefined));
    }
  });
  if (layout.title !== null) parts.push(titleMarkup(layout.title, w));
  if (layout.legend !== null) parts.push(legendMarkup(layout.legend, plot, w, h));
  return parts.join("");
}

// ---------------------------------------------------------------------------
// waterfall
// ---------------------------------------------------------------------------

function renderWaterfall(chart: ChartLike, w: number, h: number, _elementId: string, _defs: string[]): string {
  const s = chart.series[0]!;
  assertMixLegal(chart.series);
  if (chart.series.length !== 1 || s.type !== "waterfall") throw new Error("chart.waterfall 行：waterfall 独占单 series（PPTD §5.4）");
  const cats = sharedCategories(chart, [s]);
  const xci = colIndexOf(chart.data, s.encode.x, "series waterfall");
  const yci = colIndexOf(chart.data, s.encode.y, "series waterfall");
  const tci = s.encode.isTotal === undefined ? -1 : colIndexOf(chart.data, s.encode.isTotal, "series waterfall");
  const rows: Array<{ slot: number; cat: string; y: number | null; isTotal: boolean }> = [];
  for (let slot = 0; slot < cats.length; slot += 1) {
    const r = chart.data.rows.findIndex((_row, ri) => catOf(cellAt(chart.data, ri, xci)) === cats[slot]);
    if (r < 0) continue;
    const y = numOf(cellAt(chart.data, r, yci), `series waterfall 第 ${r} 行 y`);
    const tCell = tci >= 0 ? cellAt(chart.data, r, tci) : null;
    rows.push({ slot, cat: cats[slot], y, isTotal: tci >= 0 && (tCell === "true" || tCell === 1) });
  }
  if (rows.length === 0) throw new Error("waterfall 无可用行");
  const starts: number[] = [];
  const ends: number[] = [];
  let running = 0;
  for (const row of rows) {
    starts.push(running);
    const end = row.isTotal ? (row.y ?? 0) : running + (row.y ?? 0);
    ends.push(end);
    running = end;
  }
  const allVals = rows.flatMap((row, i) => (row.isTotal ? [0, ends[i]!] : [starts[i]!, ends[i]!]));
  const [d0, d1] = domainOf(Math.min(0, ...allVals), Math.max(0, ...allVals));
  const ya = makeCartAxis(0, undefined, d0, d1);
  const layout = cartesianLayout(chart, w, h, [], false, cats, [ya]);
  const plot = layout.plot;
  const slotW = plot.w / cats.length;
  const contentW = slotW * (1 - (chart.categoryGap ?? 0.2));
  const barW = chart.barWidth !== undefined ? slotW * chart.barWidth : contentW * 0.8;
  const parts: string[] = [];
  for (const gl0 of [gridLineConfig(undefined)]) {
    if (gl0 !== null) {
      for (const t of ya.ticks) {
        const y = scaleValue(ya.scale, t);
        if (y < plot.y - 0.5 || y > plot.y + plot.h + 0.5) continue;
        parts.push(`<line${xml("x1", fmt(plot.x))}${xml("y1", fmt(y))}${xml("x2", fmt(plot.x + plot.w))}${xml("y2", fmt(y))}${strokeAttrs(gl0, GRID_LINE_COLOR_DEFAULT, 1)}/>`);
      }
    }
  }
  const yyOpts = axisLabelOpts(undefined);
  parts.push(axisTicksMarkup(ya, plot, "left", yyOpts.color, yyOpts.fontSize, undefined));
  const xOpts = axisLabelOpts(chartXAxis(chart), chart);
  for (let i = 0; i < cats.length; i += 1) {
    parts.push(textEl(cats[i], plot.x + (i + 0.5) * slotW, plot.y + plot.h + LABEL_FONT_SIZE_DEFAULT + 4, { color: xOpts.color, fontSize: xOpts.fontSize, anchor: "middle", ...(xOpts.fontFamilyCss !== undefined ? { fontFamilyCss: xOpts.fontFamilyCss } : {}) }));
  }
  const zeroY = scaleValue(ya.scale, 0);
  const axisConf = axisLineConfig(chartXAxis(chart));
  if (axisConf.color !== "none") {
    parts.push(`<line${xml("x1", fmt(plot.x))}${xml("y1", fmt(zeroY))}${xml("x2", fmt(plot.x + plot.w))}${xml("y2", fmt(zeroY))}${xml("stroke", axisConf.color)}${xml("stroke-width", fmt(axisConf.width))}/>`);
  }
  rows.forEach((row, i) => {
    const start = starts[i]!;
    const end = ends[i]!;
    const yAbs = row.y ?? 0;
    const color = row.isTotal
      ? (s.totalBars?.fill ?? WATERFALL_TOTAL_DEFAULT)
      : yAbs > 0
        ? (s.increaseBars?.fill ?? WATERFALL_UP_DEFAULT)
        : yAbs < 0
          ? (s.decreaseBars?.fill ?? WATERFALL_DOWN_DEFAULT)
          : WATERFALL_TOTAL_DEFAULT;
    const border = row.isTotal ? s.totalBars?.border : yAbs > 0 ? s.increaseBars?.border : yAbs < 0 ? s.decreaseBars?.border : undefined;
    // total 柱绝对值：从值零基线到 y 画满（total 不浮动）；浮柱从 running start 到 end。
    const yStart = row.isTotal ? scaleValue(ya.scale, 0) : scaleValue(ya.scale, start);
    const yEnd = scaleValue(ya.scale, end);
    const top = Math.min(yStart, yEnd);
    const bh = Math.abs(yStart - yEnd);
    if (bh <= 0) return;
    const x = plot.x + row.slot * slotW + (contentW - barW) / 2;
    parts.push(`<rect${xml("x", fmt(x))}${xml("y", fmt(top))}${xml("width", fmt(barW))}${xml("height", fmt(bh))}${xml("fill", color)}${barStroke(border)}/>`);
    const dl = effectiveDataLabels(chart, s);
    if (dl.show) {
      const text = dl.content === "category" ? row.cat : formatNumber(yAbs, dl.numberFormat);
      const fontFamilyCss = chartFontCss(chart, dl);
      parts.push(textEl(text, x + barW / 2, dl.content === "category" ? top + bh / 2 + LABEL_FONT_SIZE_DEFAULT / 3 : top - 2, { color: dl.color ?? TEXT_COLOR_DEFAULT, fontSize: dl.fontSize ?? LABEL_FONT_SIZE_DEFAULT, anchor: "middle", ...(fontFamilyCss !== undefined ? { fontFamilyCss } : {}) }));
    }
  });
  if (layout.title !== null) parts.push(titleMarkup(layout.title, w));
  if (layout.legend !== null) parts.push(legendMarkup(layout.legend, plot, w, h));
  return parts.join("");
}

// ---------------------------------------------------------------------------
// heatmap
// ---------------------------------------------------------------------------

function renderHeatmap(chart: ChartLike, w: number, h: number, elementId: string, defs: string[]): string {
  const s = chart.series[0]!;
  assertMixLegal(chart.series);
  if (chart.series.length !== 1 || s.type !== "heatmap") throw new Error("chart.heatmap 行：heatmap 独占单 series（PPTD §5.4）");
  const xci = colIndexOf(chart.data, s.encode.x, "series heatmap");
  const yci = colIndexOf(chart.data, s.encode.y, "series heatmap");
  const vci = colIndexOf(chart.data, s.encode.value, "series heatmap");
  const xCats: string[] = [];
  const yCats: string[] = [];
  const cells = new Map<string, number>();
  for (const [r] of chart.data.rows.entries()) {
    const x = catOf(cellAt(chart.data, r, xci));
    const y = catOf(cellAt(chart.data, r, yci));
    const v = numOf(cellAt(chart.data, r, vci), `series heatmap 第 ${r} 行 value`);
    if (x === null || y === null || v === null) continue;
    if (!xCats.includes(x)) xCats.push(x);
    if (!yCats.includes(y)) yCats.push(y);
    cells.set(`${x}\u0000${y}`, v);
  }
  if (xCats.length === 0 || yCats.length === 0) throw new Error("heatmap 无有效格");
  const values = [...cells.values()];
  const vMin = Math.min(...values);
  const vMax = Math.max(...values);
  const scaleType = s.colorScale?.type ?? "linear";
  const maxAbs = Math.max(Math.abs(vMin), Math.abs(vMax));
  const domain: [number, number] = s.colorScale?.domain
    ?? (scaleType === "diverging" ? [-maxAbs, maxAbs] : [vMin, vMax]);
  const scheme = s.colorScheme ?? (scaleType === "diverging" ? HEATMAP_DIVERGING_DEFAULT : HEATMAP_DEFAULT_SCHEME);
  if (scaleType === "diverging" && scheme.length !== 3) {
    throw new Error(`heatmap colorScale=diverging 需 colorScheme 长度 3（当前 ${scheme.length}；chart.heatmap 行）`);
  }
  if (scheme.length < 2) throw new Error(`heatmap colorScheme 长度 <2（chart.heatmap 行：线性插值需端点）`);
  const colorAt = (v: number): string => {
    const [lo, hi] = domain;
    if (scaleType === "diverging") {
      const tBase = v >= 0 ? 0.5 + 0.5 * (v / hi) : 0.5 - 0.5 * (Math.abs(v) / Math.abs(lo));
      const t = Math.max(0, Math.min(1, tBase));
      const mid = t < 0.5 ? lerpColor(scheme[0]!, scheme[1]!, t * 2) : lerpColor(scheme[1]!, scheme[2]!, (t - 0.5) * 2);
      return mid;
    }
    const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
    const seg = Math.min(scheme.length - 2, Math.floor(t * (scheme.length - 1)));
    const local = t * (scheme.length - 1) - seg;
    return lerpColor(scheme[seg]!, scheme[seg + 1]!, local);
  };

  let colorbarW = 0;
  if (s.colorbar !== false) {
    const pos = typeof s.colorbar === "object" && s.colorbar !== null ? s.colorbar.position : "right";
    if (pos !== "right") throw new Error(`heatmap colorbar.position "${pos}" 不在 v1 承诺（仅 right；chart.heatmap 行）`);
    colorbarW = 30;
  }
  const yGutter = valueTickGutter(chartYAxes(chart)[0], ticksOf(...domain));
  const layout = nonCartLayout(chart, w, h, [], colorbarW, yGutter, LABEL_FONT_SIZE_DEFAULT + 14);
  const plot = layout.plot;
  const cellW = plot.w / xCats.length;
  const cellH = plot.h / yCats.length;
  const parts: string[] = [];
  xCats.forEach((xc, xi) => {
    yCats.forEach((yc, yi) => {
      const v = cells.get(`${xc}\u0000${yc}`);
      if (v === undefined) return; // 缺失格透明（pptd：background 色）
      parts.push(`<rect${xml("x", fmt(plot.x + xi * cellW))}${xml("y", fmt(plot.y + yi * cellH))}${xml("width", fmt(cellW))}${xml("height", fmt(cellH))}${xml("fill", colorAt(v))}/>`);
    });
  });
  const optsX = axisLabelOpts(chartXAxis(chart), chart);
  xCats.forEach((xc, xi) => {
    parts.push(textEl(xc, plot.x + (xi + 0.5) * cellW, plot.y + plot.h + LABEL_FONT_SIZE_DEFAULT + 4, { color: optsX.color, fontSize: optsX.fontSize, anchor: "middle", ...(optsX.fontFamilyCss !== undefined ? { fontFamilyCss: optsX.fontFamilyCss } : {}) }));
  });
  const optsY = axisLabelOpts(chartYAxes(chart)[0], chart);
  yCats.forEach((yc, yi) => {
    parts.push(textEl(yc, plot.x - 6, plot.y + (yi + 0.5) * cellH + LABEL_FONT_SIZE_DEFAULT / 3, { color: optsY.color, fontSize: optsY.fontSize, anchor: "end", ...(optsY.fontFamilyCss !== undefined ? { fontFamilyCss: optsY.fontFamilyCss } : {}) }));
  });
  const dl = effectiveDataLabels(chart, s);
  if (dl.show) {
    for (const [key, v] of cells) {
      const [xc, yc] = key.split("\u0000");
      const xi = xCats.indexOf(xc);
      const yi = yCats.indexOf(yc);
      const fontFamilyCss = chartFontCss(chart, dl);
      parts.push(textEl(formatNumber(v, dl.numberFormat), plot.x + (xi + 0.5) * cellW, plot.y + (yi + 0.5) * cellH + LABEL_FONT_SIZE_DEFAULT / 3, { color: dl.color ?? TEXT_COLOR_DEFAULT, fontSize: dl.fontSize ?? LABEL_FONT_SIZE_DEFAULT, anchor: "middle", ...(fontFamilyCss !== undefined ? { fontFamilyCss } : {}) }));
    }
  }
  if (colorbarW > 0) {
    const cbX = plot.x + plot.w + 8;
    const gradId = gradientId("heat-cb", elementId);
    defs.push(`<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">${scheme.map((c, i) => `<stop offset="${fmt(i / (scheme.length - 1))}" stop-color="${c}"/>`).join("")}</linearGradient>`);
    parts.push(`<rect${xml("x", fmt(cbX))}${xml("y", fmt(plot.y))}${xml("width", fmt(12))}${xml("height", fmt(plot.h))}${xml("fill", `url(#${gradId})`)}/>`);
    const [lo, hi] = domain;
    for (const v of scaleType === "diverging" ? [lo, 0, hi] : [lo, hi]) {
      const t = (v - lo) / (hi - lo || 1);
      const y = plot.y + plot.h * (1 - t);
      const colorbar = typeof s.colorbar === "object" && s.colorbar !== null ? s.colorbar : undefined;
      const fontFamilyCss = chartFontCss(chart, colorbar);
      parts.push(textEl(formatNumber(v, undefined), cbX + 16, y + LABEL_FONT_SIZE_DEFAULT / 3, { color: colorbar?.color ?? AXIS_LABEL_COLOR_DEFAULT, fontSize: colorbar?.fontSize ?? LABEL_FONT_SIZE_DEFAULT, anchor: "start", ...(fontFamilyCss !== undefined ? { fontFamilyCss } : {}) }));
    }
  }
  if (layout.title !== null) parts.push(titleMarkup(layout.title, w));
  if (layout.legend !== null) parts.push(legendMarkup(layout.legend, plot, w, h));
  return parts.join("");
}

// ---------------------------------------------------------------------------
// treemap / sunburst / sankey
// ---------------------------------------------------------------------------

interface TNode {
  category: string;
  value: number;
  children: TNode[];
  depth: number;
  rootIndex: number;
  /** 子树值和（assign 自底向上一次算好；求和顺序与递归版 subtreeValue 逐字节一致）。 */
  total: number;
}

function buildTree(chart: ChartLike, s: ChartSeriesLike): TNode[] {
  const ci = colIndexOf(chart.data, s.encode.category, `series ${s.type}`);
  const vi = colIndexOf(chart.data, s.encode.value, `series ${s.type}`);
  const pi = s.encode.parent === undefined ? -1 : colIndexOf(chart.data, s.encode.parent!, `series ${s.type}`);
  const nodeByCat = new Map<string, TNode>();
  for (const [r] of chart.data.rows.entries()) {
    const cat = catOf(cellAt(chart.data, r, ci));
    const v = numOf(cellAt(chart.data, r, vi), `series ${s.type} 第 ${r} 行 value`);
    if (cat === null) continue;
    nodeByCat.set(cat, { category: cat, value: v ?? 0, children: [], depth: 0, rootIndex: -1, total: 0 });
  }
  const roots: TNode[] = [];
  const childMap = new Map<string, TNode[]>();
  for (const [r] of chart.data.rows.entries()) {
    const cat = catOf(cellAt(chart.data, r, ci));
    if (cat === null) continue;
    const node = nodeByCat.get(cat)!;
    const parent = pi >= 0 ? catOf(cellAt(chart.data, r, pi)) : null;
    if (parent === null || parent === "" || !nodeByCat.has(parent)) {
      roots.push(node);
    } else {
      const list = childMap.get(parent) ?? [];
      list.push(node);
      childMap.set(parent, list);
    }
  }
  if (roots.length === 0) throw new Error(`${s.type} 无根节点（parent 层级非法；chart.${s.type} 行）`);
  const assign = (node: TNode, depth: number, rootIndex: number): void => {
    node.depth = depth;
    node.rootIndex = rootIndex;
    node.children = childMap.get(node.category) ?? [];
    for (const child of node.children) assign(child, depth + 1, rootIndex);
    // 与旧递归 subtreeValue 相同的浮点求和顺序：value + 左fold 子值。
    node.total = node.value + node.children.reduce((acc, c) => acc + c.total, 0);
  };
  roots.forEach((root, i) => assign(root, 0, i));
  return roots;
}

const subtreeValue = (node: TNode): number => node.total;

const maxDepthOf = (node: TNode): number =>
  node.children.length === 0 ? 1 : 1 + Math.max(...node.children.map(maxDepthOf));

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** squarified treemap（Bruls et al.；确定性，值降序）。 */
function squarify(areas: number[], x: number, y: number, w: number, h: number): Rect[] {
  const total = areas.reduce((a, b) => a + b, 0);
  const out: Rect[] = [];
  if (total <= 0 || areas.length === 0) return out;
  const scaled = areas.map((v) => (v / total) * w * h);
  let cx = x;
  let cy = y;
  let cw = w;
  let ch = h;
  let i = 0;
  while (i < scaled.length) {
    const stripLen = cw >= ch ? cw : ch;
    const row: number[] = [];
    let rowSum = 0;
    let lastWorst = Infinity;
    while (i < scaled.length) {
      const next = scaled[i]!;
      const test = [...row, next];
      const s = test.reduce((a, b) => a + b, 0);
      const thickness = s / stripLen;
      let worst = 0;
      for (const a of test) {
        const itemLen = (a * stripLen) / s;
        const ratio = Math.max(itemLen, thickness) / Math.min(itemLen, thickness);
        worst = Math.max(worst, ratio);
      }
      if (row.length > 0 && worst > lastWorst) break;
      row.push(next);
      rowSum = s;
      lastWorst = worst;
      i += 1;
    }
    if (cw >= ch) {
      const t = rowSum / cw;
      let px = cx;
      for (const a of row) {
        const len = a / t;
        out.push({ x: px, y: cy, w: len, h: t });
        px += len;
      }
      cy += t;
      ch -= t;
    } else {
      const t = rowSum / ch;
      let py = cy;
      for (const a of row) {
        const len = a / t;
        out.push({ x: cx, y: py, w: t, h: len });
        py += len;
      }
      cx += t;
      cw -= t;
    }
  }
  return out;
}

function treemapFillColor(series: ChartSeriesLike, rootIndex: number, depth: number, chart: ChartLike): string {
  const palette = paletteOf(chart);
  const raw = series.fill;
  const solidOf = (f: ChartSeriesFillLike): string => {
    if (typeof f !== "string") throw new Error("treemap fill 只支持 solid 字面色（逐级 HSL.L-10% 派生只对色基有意义；gradient 具名拒绝，chart.treemap 行）");
    return f;
  };
  if (raw === undefined) return darkenLightness(palette[rootIndex % palette.length], depth);
  if (typeof raw === "string") return darkenLightness(raw, depth);
  if (Array.isArray(raw)) {
    const oneDimensional = raw.length > 0 && raw.every((item) => typeof item === "string");
    const twoDimensional = raw.length > 0 && raw.every((item) =>
      Array.isArray(item) && item.length > 0 && item.every((color) => typeof color === "string"));
    if (!oneDimensional && !twoDimensional) {
      throw new Error("treemap fill 形态非法（须非空的一维 solid 数组或非空二维 solid 数组；chart.treemap 行）");
    }
    if (twoDimensional) {
      const inner = raw[rootIndex % raw.length] as readonly ChartSeriesFillLike[];
      const direct = inner[depth];
      return direct !== undefined ? solidOf(direct) : darkenLightness(solidOf(inner[0]!), depth);
    }
    const rootColor = solidOf(raw[rootIndex % raw.length] as ChartSeriesFillLike);
    return darkenLightness(rootColor, depth);
  }
  throw new Error("treemap fill 形态非法（须 solid/数组/二维数组；chart.treemap 行）");
}

function renderTreemap(chart: ChartLike, w: number, h: number, _elementId: string, _defs: string[]): string {
  const s = chart.series[0]!;
  const dl = effectiveDataLabels(chart, s);
  assertMixLegal(chart.series);
  if (chart.series.length !== 1 || s.type !== "treemap") throw new Error("chart.treemap 行：treemap 独占单 series（PPTD §5.4）");
  const roots = buildTree(chart, s);
  const maxLevel = s.levels ?? Infinity;
  const layout = nonCartLayout(chart, w, h, []);
  const plot = layout.plot;
  const parts: string[] = [];
  // 值标签与旧 addValue 第二遍同一 pre-order 顺序、同一尺寸门槛；集中到布局完后
  // 统一落 parts，保持 SVG 元素序（值标签压在所有 rect/类目标签之上）逐字节不变。
  const valueLabels: string[] = [];
  const valueLabel = (node: TNode, rect: Rect): void => {
    if (dl.show && rect.w >= 30 && rect.h >= LABEL_FONT_SIZE_DEFAULT * 2 + 4) {
      const fontFamilyCss = chartFontCss(chart, dl);
      valueLabels.push(textEl(formatNumber(node.value, dl.numberFormat), rect.x + 4, rect.y + LABEL_FONT_SIZE_DEFAULT * 2, { fontSize: dl.fontSize ?? LABEL_FONT_SIZE_DEFAULT, anchor: "start", ...(fontFamilyCss !== undefined ? { fontFamilyCss } : {}) }));
    }
  };
  const labelNode = (node: TNode, rect: Rect): void => {
    const color = treemapFillColor(s, node.rootIndex, node.depth, chart);
    parts.push(`<rect${xml("x", fmt(rect.x))}${xml("y", fmt(rect.y))}${xml("width", fmt(rect.w))}${xml("height", fmt(rect.h))}${xml("fill", color)}${barStroke(s.border)}/>`);
    if (rect.w >= 30 && rect.h >= LABEL_FONT_SIZE_DEFAULT + 4) {
      const fontFamilyCss = chartFontCss(chart, dl);
      parts.push(textEl(node.category, rect.x + 4, rect.y + LABEL_FONT_SIZE_DEFAULT, { fontSize: dl.fontSize ?? LABEL_FONT_SIZE_DEFAULT, color: dl.color, anchor: "start", ...(fontFamilyCss !== undefined ? { fontFamilyCss } : {}) }));
    }
  };
  const layoutChildren = (node: TNode, rect: Rect, level: number): void => {
    if (node.children.length === 0) return;
    const areas = node.children.map((c) => subtreeValue(c));
    const rects = squarify(areas, rect.x, rect.y, rect.w, rect.h);
    node.children.forEach((child, i) => {
      const r = rects[i];
      if (r === undefined) return;
      // rect/类目标签受 levels 预算约束；值标签与旧 addValue 一样覆盖全部深度。
      if (level <= maxLevel) labelNode(child, r);
      valueLabel(child, r);
      layoutChildren(child, r, level + 1);
    });
  };
  const rootRect = squarify(roots.map((r0) => subtreeValue(r0)), plot.x, plot.y, plot.w, plot.h);
  roots.forEach((r0, i) => {
    const r = rootRect[i];
    if (r === undefined) return;
    labelNode(r0, r);
    valueLabel(r0, r);
    layoutChildren(r0, r, 1);
  });
  parts.push(...valueLabels);
  if (layout.title !== null) parts.push(titleMarkup(layout.title, w));
  if (layout.legend !== null) parts.push(legendMarkup(layout.legend, plot, w, h));
  return parts.join("");
}

function renderSunburst(chart: ChartLike, w: number, h: number, _elementId: string, _defs: string[]): string {
  const s = chart.series[0]!;
  const dl = effectiveDataLabels(chart, s);
  assertMixLegal(chart.series);
  if (chart.series.length !== 1 || s.type !== "sunburst") throw new Error("chart.sunburst 行：sunburst 独占单 series（PPTD §5.4）");
  const roots = buildTree(chart, s);
  const maxDepth = Math.max(...roots.map(maxDepthOf));
  const levels = Math.min(s.levels ?? maxDepth, maxDepth);
  const layout = nonCartLayout(chart, w, h, []);
  const plot = layout.plot;
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const outerR = Math.min(plot.w, plot.h) / 2;
  const ringW = outerR / Math.max(levels, 1);
  const totalRoot = roots.reduce((acc, r0) => acc + subtreeValue(r0), 0);
  if (totalRoot <= 0) throw new Error("sunburst 总值为 0（无渲染弧度）");
  const ptS = (angle: number, radius: number): { x: number; y: number } => {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
  };
  const fillFor = (node: TNode): string => {
    const palette = paletteOf(chart);
    const raw = s.fill;
    if (raw === undefined) return palette[node.rootIndex % palette.length];
    if (typeof raw === "string") return raw;
    if (Array.isArray(raw)) {
      const f = raw[node.rootIndex % raw.length];
      if (typeof f !== "string") throw new Error("sunburst fill 数组元素须为 solid 字面色（gradient 具名拒绝；chart.sunburst 行）");
      return f;
    }
    return palette[node.rootIndex % palette.length];
  };
  const arc = (a0: number, a1: number, r0: number, r1: number, fill: string): string => {
    const large = a1 - a0 > 180 ? 1 : 0;
    const p0 = ptS(a0, r1);
    const p1 = ptS(a1, r1);
    const q0 = ptS(a1, r0);
    const q1 = ptS(a0, r0);
    if (a1 - a0 >= 359.999) {
      const out = [`<circle${xml("cx", fmt(cx))}${xml("cy", fmt(cy))}${xml("r", fmt(r1))}${xml("fill", fill)}${pieBorder(s.border)}/>`];
      if (r0 > 0) out.push(`<circle${xml("cx", fmt(cx))}${xml("cy", fmt(cy))}${xml("r", fmt(r0))}${xml("fill", "transparent")}${pieBorder(s.border)}/>`);
      return out.join("");
    }
    return `<path${xml("d", `M ${fmt(p0.x)} ${fmt(p0.y)} A ${fmt(r1)} ${fmt(r1)} 0 ${large} 1 ${fmt(p1.x)} ${fmt(p1.y)} L ${fmt(q0.x)} ${fmt(q0.y)} A ${fmt(r0)} ${fmt(r0)} 0 ${large} 0 ${fmt(q1.x)} ${fmt(q1.y)} Z`)}${xml("fill", fill)}${pieBorder(s.border)}/>`;
  };
  const parts: string[] = [];
  const drawNode = (node: TNode, a0: number, a1: number, depth: number): void => {
    const r0 = depth * ringW;
    const r1 = (depth + 1) * ringW;
    if (depth < levels) {
      const span = a1 - a0;
      const childTotal = node.children.reduce((acc, c) => acc + subtreeValue(c), 0);
      let acc = a0;
      if (node.children.length > 0) {
        for (const child of node.children) {
          const frac = childTotal > 0 ? subtreeValue(child) / childTotal : 0;
          const aEnd = acc + span * frac;
          drawNode(child, acc, aEnd, depth + 1);
          acc = aEnd;
        }
      }
      parts.push(arc(a0, a1, r0, r1, fillFor(node)));
      const mid = (a0 + a1) / 2;
      if (span >= 6 && r1 - r0 >= 10) {
        const lp = ptS(mid, (r0 + r1) / 2);
        const fontFamilyCss = chartFontCss(chart, dl);
        parts.push(textEl(node.category, lp.x, lp.y + (dl.fontSize ?? LABEL_FONT_SIZE_DEFAULT) / 3, { fontSize: dl.fontSize ?? LABEL_FONT_SIZE_DEFAULT, color: dl.color, anchor: "middle", ...(fontFamilyCss !== undefined ? { fontFamilyCss } : {}) }));
      }
    }
  };
  let angle = 0;
  for (const root of roots) {
    const span = (subtreeValue(root) / totalRoot) * 360;
    drawNode(root, angle, angle + span, 0);
    angle += span;
  }
  if (layout.title !== null) parts.push(titleMarkup(layout.title, w));
  if (layout.legend !== null) parts.push(legendMarkup(layout.legend, plot, w, h));
  return parts.join("");
}

interface SankeyNode {
  name: string;
  layer: number;
  outSum: number;
  inSum: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function renderSankey(chart: ChartLike, w: number, h: number, _elementId: string, _defs: string[]): string {
  const s = chart.series[0]!;
  assertMixLegal(chart.series);
  if (chart.series.length !== 1 || s.type !== "sankey") throw new Error("chart.sankey 行：sankey 独占单 series（PPTD §5.4）");
  const sci = colIndexOf(chart.data, s.encode.source, "series sankey");
  const tci = colIndexOf(chart.data, s.encode.target, "series sankey");
  const fci = colIndexOf(chart.data, s.encode.flow, "series sankey");
  const nodeIdx = new Map<string, number>();
  const names: string[] = [];
  const flows: Array<{ src: number; tgt: number; flow: number }> = [];
  for (const [r] of chart.data.rows.entries()) {
    const src = catOf(cellAt(chart.data, r, sci));
    const tgt = catOf(cellAt(chart.data, r, tci));
    if (src === null || tgt === null) throw new Error(`series sankey 第 ${r} 行 source/target 为 null（DAG 边端点缺失；chart.sankey 行）`);
    const flow = numOf(cellAt(chart.data, r, fci), `series sankey 第 ${r} 行 flow`);
    if (flow === null || flow < 0) throw new Error(`series sankey flow 必须为非负（第 ${r} 行；chart.sankey 行）`);
    if (!nodeIdx.has(src)) {
      nodeIdx.set(src, names.length);
      names.push(src);
    }
    if (!nodeIdx.has(tgt)) {
      nodeIdx.set(tgt, names.length);
      names.push(tgt);
    }
    flows.push({ src: nodeIdx.get(src)!, tgt: nodeIdx.get(tgt)!, flow });
  }
  const n = names.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0) as number[];
  for (const f of flows) {
    adj[f.src].push(f.tgt);
    indeg[f.tgt] += 1;
  }
  const layer = new Array(n).fill(0) as number[];
  const queue: number[] = [];
  for (let i = 0; i < n; i += 1) if (indeg[i] === 0) queue.push(i);
  const topo: number[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    topo.push(u);
    for (const v of adj[u]) {
      layer[v] = Math.max(layer[v], layer[u] + 1);
      indeg[v] -= 1;
      if (indeg[v] === 0) queue.push(v);
    }
  }
  if (topo.length !== n) throw new Error("series sankey 边形成环（DAG 约束；chart.sankey 行 CyclicGraphError）");
  const layout = nonCartLayout(chart, w, h, []);
  const plot = layout.plot;
  const maxLayer = Math.max(0, ...layer);
  const colW = plot.w / (maxLayer + 1);
  const nodeW = Math.max(12, Math.min(90, colW * 0.55));
  const maxFlow = Math.max(0, ...flows.map((f) => f.flow));
  const sumOf = (i: number, kind: "src" | "tgt"): number =>
    flows.reduce((a, f) => (f[kind === "src" ? "src" : "tgt"] === i ? a + f.flow : a), 0);
  const maxNodeFlow = Math.max(0, ...names.map((_nm, i) => Math.max(sumOf(i, "src"), sumOf(i, "tgt"))));
  const nodes: SankeyNode[] = names.map((nm, i) => ({
    name: nm,
    layer: layer[i],
    outSum: sumOf(i, "src"),
    inSum: sumOf(i, "tgt"),
    x: 0,
    y: 0,
    w: nodeW,
    h: 0,
  }));
  const gap = 12;
  const maxNodeH = plot.h * 0.3;
  const groups = new Map<number, number[]>();
  layer.forEach((l, i) => {
    const list = groups.get(l) ?? [];
    list.push(i);
    groups.set(l, list);
  });
  for (const [l, list] of groups) {
    const rawH = (i: number): number => Math.max(6, (Math.max(nodes[i]!.outSum, nodes[i]!.inSum) / Math.max(maxNodeFlow, 1)) * maxNodeH);
    const totalH = list.reduce((acc, i) => acc + rawH(i) + gap, 0);
    const scaleH = totalH > plot.h ? plot.h / totalH : 1;
    // nodeAlign（chart.sankey 行）：同一 layer 列块的垂直对齐——justify 居中、
    // left 顶对齐、right 底对齐（列式布局中"对齐"取可观察的垂直维度，确定性）。
    const blockH = Math.min(totalH, plot.h);
    const alignTop = s.nodeAlign === "left" ? 0 : s.nodeAlign === "right" ? plot.h - blockH : (plot.h - blockH) / 2;
    let yAcc = plot.y + alignTop;
    for (const i of list) {
      const hh = rawH(i) * scaleH;
      nodes[i]!.x = plot.x + l * colW + colW / 2 - nodeW / 2;
      nodes[i]!.y = yAcc;
      nodes[i]!.h = hh;
      yAcc += hh + gap;
    }
  }
  const maxBand = plot.h * 0.18;
  const colorOfNode = (i: number): string => {
    const palette = paletteOf(chart);
    const raw = s.fill;
    if (raw === undefined || typeof raw === "string") return raw === undefined ? palette[i % palette.length] : raw;
    if (Array.isArray(raw)) {
      const f = raw[i % raw.length];
      if (typeof f !== "string") throw new Error("sankey fill 数组元素须为 solid 字面色（gradient 具名拒绝；chart.sankey 行）");
      return f;
    }
    const named = raw as Record<string, ChartSeriesFillLike>;
    const f = named[nodes[i]!.name];
    if (typeof f === "string") return f;
    return palette[i % palette.length];
  };
  const parts: string[] = [];
  const srcCum = new Map<number, number>();
  const tgtCum = new Map<number, number>();
  for (const f of flows) {
    const src = nodes[f.src]!;
    const tgt = nodes[f.tgt]!;
    const cumS = srcCum.get(f.src) ?? 0;
    const cumT = tgtCum.get(f.tgt) ?? 0;
    const bw = Math.max(1, (f.flow / Math.max(maxFlow, 1)) * maxBand);
    const y1 = src.y + (src.h - bw) * (cumS / Math.max(src.outSum, 1));
    const y2 = tgt.y + (tgt.h - bw) * (cumT / Math.max(tgt.inSum, 1));
    srcCum.set(f.src, cumS + f.flow);
    tgtCum.set(f.tgt, cumT + f.flow);
    const x1 = src.x + src.w;
    const x2 = tgt.x;
    const xm = (x1 + x2) / 2;
    parts.push(`<path${xml("d", `M ${fmt(x1)} ${fmt(y1)} C ${fmt(xm)} ${fmt(y1)}, ${fmt(xm)} ${fmt(y2)}, ${fmt(x2)} ${fmt(y2)} L ${fmt(x2)} ${fmt(y2 + bw)} C ${fmt(xm)} ${fmt(y2 + bw)}, ${fmt(xm)} ${fmt(y1 + bw)}, ${fmt(x1)} ${fmt(y1 + bw)} Z`)}${xml("fill", colorOfNode(f.src))}${xml("fill-opacity", "0.85")}/>`);
  }
  nodes.forEach((node) => {
    parts.push(`<rect${xml("x", fmt(node.x))}${xml("y", fmt(node.y))}${xml("width", fmt(node.w))}${xml("height", fmt(node.h))}${xml("fill", colorOfNode(names.indexOf(node.name)))}${barStroke(s.border)}/>`);
    const ly = node.y + node.h / 2 + LABEL_FONT_SIZE_DEFAULT / 3;
    const anchor = node.x + node.w / 2 - plot.x < plot.w / 2 ? "start" : "end";
    const lx = anchor === "start" ? node.x + node.w + 4 : node.x - 4;
    parts.push(textEl(node.name, lx, ly, { fontSize: LABEL_FONT_SIZE_DEFAULT, anchor }));
  });
  const dl = effectiveDataLabels(chart, s);
  if (dl.show) {
    for (const f of flows) {
      const src = nodes[f.src]!;
      const xm = (src.x + src.w + nodes[f.tgt]!.x) / 2;
      const fontFamilyCss = chartFontCss(chart, dl);
      parts.push(textEl(formatNumber(f.flow, dl.numberFormat), xm, src.y + 4, { fontSize: dl.fontSize ?? LABEL_FONT_SIZE_DEFAULT, color: dl.color ?? TEXT_COLOR_DEFAULT, anchor: "middle", ...(fontFamilyCss !== undefined ? { fontFamilyCss } : {}) }));
    }
  }
  if (layout.title !== null) parts.push(titleMarkup(layout.title, w));
  if (layout.legend !== null) parts.push(legendMarkup(layout.legend, plot, w, h));
  return parts.join("");
}

// ---------------------------------------------------------------------------
// 编译入口 + DOM 装配
// ---------------------------------------------------------------------------

const assetsKey = (ref: string): string => (ref.startsWith("asset:") ? ref.slice("asset:".length) : ref);

function wrapFill(
  fill: ChartFillLike | undefined,
  frame: { width: number; height: number },
  resolveAsset: (ref: string) => string,
  assets: Record<string, string>,
): { css: string; image: CompiledImageFillV4 | null } {
  if (fill === undefined) return { css: "", image: null };
  switch (fill.type) {
    case "solid":
      return { css: `background-color:${fill.color}`, image: null };
    case "gradient": {
      const stops = fill.stops.map((s) => `${s.color} ${fmt(s.position * 100)}%`).join(", ");
      const value = fill.gradientType === "radial"
        ? `radial-gradient(circle, ${stops})`
        : `linear-gradient(${pptdAngleToCss(fill.angle ?? 90)}deg, ${stops})`;
      return { css: `background:${value}`, image: null };
    }
    case "image": {
      const dataUri = resolveAsset(fill.src);
      const key = assetsKey(fill.src);
      assets[key] = dataUri;
      return {
        css: "",
        image: compileImageFillV4(
          { ...fill, src: `asset:${key}` },
          { ...frame, source: imageIntrinsicSize(dataUri) },
        ),
      };
    }
  }
}

function assertMixLegal(seriesList: ChartSeriesLike[]): void {
  for (const s of seriesList) {
    if (!CHART_TYPES.includes(s.type)) {
      throw new Error(`未知 series type "${s.type}"（chart.encode 行 13 型词表）`);
    }
  }
  const types = new Set(seriesList.map((s) => s.type));
  const exclusive = ["pie", "radar", "waterfall", "heatmap", "treemap", "sunburst", "sankey"].filter((t) => types.has(t));
  for (const t of exclusive) {
    const others = seriesList.filter((s) => s.type !== t);
    if (others.length > 0) {
      throw new Error(`chart.typeMixing 行：${t} 独占 series 数组，与 ${others.map((o) => o.type).join("/")} 混排非法`);
    }
  }
  if (types.has("pie") && seriesList.length !== 1) {
    throw new Error("chart.pie 行：pie 单 series 独占（PPTD §5.4）");
  }
  if (types.has("candlestick")) {
    const bad = seriesList.filter((s) => s.type !== "candlestick" && !VALUE_CARTESIAN_TYPES.has(s.type));
    if (bad.length > 0) {
      throw new Error(`chart.typeMixing 行：candlestick 只可混 bar/line/area，出现 ${bad.map((s) => s.type).join("/")}`);
    }
  }
}

const dataLabelVocabulary = (type: string): readonly string[] => {
  switch (type) {
    case "pie": return ["value", "percentage", "category"];
    case "waterfall":
    case "treemap":
    case "sunburst":
      return ["value", "category"];
    default: return ["value"];
  }
};

function effectiveDataLabels(chart: ChartLike, series: ChartSeriesLike): ChartDataLabelLike & { content: string; show: boolean } {
  const merged: ChartDataLabelLike = { ...(chart.dataLabels ?? {}), ...(series.dataLabels ?? {}) };
  const content = merged.content ?? (series.type === "treemap" || series.type === "sunburst" ? "category" : "value");
  const vocab = dataLabelVocabulary(series.type);
  if (!vocab.includes(content)) {
    throw new Error(`series ${series.type} dataLabels.content "${content}" 不在词表 [${vocab.join("/")}]（chart.dataLabels 行 §5.5）`);
  }
  return { ...merged, content, show: merged.show ?? false };
}

export interface ChartCompiledV4 {
  /** 外框 wrap cssText（布局 + 元素 border/fill）。 */
  wrap: string;
  /** image 外框图层（fill.image 行 chart 宿主）；否则 null。 */
  wrapImage: CompiledImageFillV4 | null;
  /** 全图确定性 inline SVG markup。 */
  markup: string;
}

export interface ChartCompileOptions {
  chart: ChartLike;
  width: number;
  height: number;
  elementId: string;
  resolveAsset: (ref: string) => string;
  /** Shared C6 role aliases allocated for this complete document projection. */
  fontAliases?: ReadonlyMap<string, string>;
}

export function compileChart(opts: ChartCompileOptions): { compiled: ChartCompiledV4; assets: Record<string, string> } {
  const { width, height, elementId } = opts;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("chart dimensions must be positive");
  }
  const viewport = bentoChartLayoutViewport(width, height);
  const chart: ChartCompileContext = {
    ...opts.chart,
    ...(opts.fontAliases !== undefined ? { [CHART_FONT_ALIASES]: opts.fontAliases } : {}),
  };
  const assets: Record<string, string> = {};
  const defs: string[] = [];
  assertMixLegal(chart.series);
  const firstType = chart.series[0]?.type;
  let markup: string;
  if (CARTESIAN_TYPES.has(firstType)) {
    markup = renderCartesian(chart, viewport.width, viewport.height, elementId, defs);
  } else {
    switch (firstType) {
      case "pie": markup = renderPie(chart, viewport.width, viewport.height, elementId, defs); break;
      case "radar": markup = renderRadar(chart, viewport.width, viewport.height, elementId, defs); break;
      case "waterfall": markup = renderWaterfall(chart, viewport.width, viewport.height, elementId, defs); break;
      case "heatmap": markup = renderHeatmap(chart, viewport.width, viewport.height, elementId, defs); break;
      case "treemap": markup = renderTreemap(chart, viewport.width, viewport.height, elementId, defs); break;
      case "sunburst": markup = renderSunburst(chart, viewport.width, viewport.height, elementId, defs); break;
      case "sankey": markup = renderSankey(chart, viewport.width, viewport.height, elementId, defs); break;
      default: throw new Error(`未知 series type "${String(firstType)}"（chart.encode 行 13 型词表）`);
    }
  }
  const family = fontFamilyOf(chart.fontFamily, opts.fontAliases);
  const components = [`<svg xmlns="http://www.w3.org/2000/svg"${xml("viewBox", `0 0 ${fmt(viewport.width)} ${fmt(viewport.height)}`)} width="100%" height="100%"${xml("font-family", family)}>`];
  if (defs.length > 0) components.push(`<defs>${defs.join("")}</defs>`);
  components.push(markup, "</svg>");
  const fillOut = wrapFill(chart.fill, { width, height }, opts.resolveAsset, assets);
  const wrapParts = ["width:100%", "height:100%", "position:relative", "overflow:hidden", "box-sizing:border-box"];
  if (fillOut.css !== "") wrapParts.push(fillOut.css);
  if (chart.border !== undefined) {
    const b = chart.border;
    const style = b.style === "dash" ? "dashed" : b.style === "dot" ? "dotted" : "solid";
    wrapParts.push(`border:${fmt(b.width ?? 1)}px ${style} ${b.color ?? "#000000"}`);
  }
  return {
    compiled: { wrap: wrapParts.join(";") + ";", wrapImage: fillOut.image, markup: components.join("") },
    assets,
  };
}

interface ChartFrameElement extends FrameHostElement {
  chartCompiled: ChartCompiledV4;
}

/** chart.svg frame 渲染器：wrap（外框 fill/图层）+ innerSVG 挂进 .bento-el frame。 */
export function renderChartSvg(element: FrameHostElement, ctx: FrameHostRenderContext): HTMLElement {
  const compiled = (element as ChartFrameElement).chartCompiled;
  if (!compiled) throw new Error("chart.svg requires a chartCompiled payload from the projector");
  const wrap = document.createElement("div");
  wrap.style.cssText = compiled.wrap;
  if (compiled.wrapImage !== null) {
    wrap.appendChild(renderImageFillLayer(compiled.wrapImage, ctx));
  }
  const holder = document.createElement("div");
  holder.style.cssText = "width:100%;height:100%;position:absolute;inset:0;";
  holder.innerHTML = compiled.markup;
  wrap.appendChild(holder);
  return wrap;
}

/** 显式拒绝集（每项映射 ACTIVE 矩阵行；projector-backing 引用 + 单测锚定）。 */
export const CHART_REJECTED_CONDITIONS: readonly { condition: string; capabilityId: string }[] = [
  { condition: "series bar symbol ShapeDef 不在 static-v1 modeled 词表或结构非法", capabilityId: "chart.bar" },
  { condition: "treemap/sunburst fill 为 gradient（派生/循环只对 solid 色基有意义）", capabilityId: "chart.treemap" },
  { condition: "图中 stack 模式不一致（StackModeMismatch）", capabilityId: "chart.bar" },
  { condition: "series 的 encode.x 列值与首 series 类目不一致（类目坐标系共享要求）", capabilityId: "chart.typeMixing" },
  { condition: "xAxis.min/max 用于 category 轴（仅 value axes 有效）", capabilityId: "chart.axisBasic" },
  { condition: "xAxis 数组（副 x 轴）/yAxis 长度 >2（v1 副 y 轴 1 根）", capabilityId: "chart.axisSecondary" },
  { condition: "numberFormat 不在 v1 词表", capabilityId: "chart.dataLabels" },
  { condition: "pie value<0 / 总值为 0 / innerRadius 越界", capabilityId: "chart.pie" },
  { condition: "数值通道不可解析 / encode 通道未知列 / 类目列为空", capabilityId: "chart.data" },
  { condition: "bar 柱组宽超槽内容（barLayout 参数失衡）", capabilityId: "chart.barLayout" },
  { condition: "轴 min>=max / 轴域无限（无数值数据）", capabilityId: "chart.axisBasic" },
  { condition: "sankey 边形成环（DAG 约束）", capabilityId: "chart.sankey" },
];
