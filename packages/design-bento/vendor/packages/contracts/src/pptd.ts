/**
 * PPTD 输入面 = Active Profile v1（packages/contracts/capability-matrix/v1.json，
 * sha256 a96c9959…2dfd48，GD-4b Wave B2，docs/gd-4-acceptance.md §3.2）。
 *
 * 字段集即白名单：此处未声明的字段一律具名拒绝（fail closed；上游 pptd.md 的
 * pageType/notes/animations 属 excluded 行，输入 E011 具名拒绝，不入类型）。
 * 各 interface 的字段集即白名单声明；其运行时真值在 authoring/src/validate.ts 的
 * *_FIELDS 常量（fail-closed 未知字段检查），任一侧改动必须同步对侧。
 * 语义权威 = 冻结 matrix（每行 pptdPath/importContract/failureCode）；语法参照 =
 * skills/graphic-design/references/pptd.md（证据，非合同权威；customFonts.src 的
 * 本地 media/ 收紧与 Google Fonts URL 偏差由 E004 注记，冻结裁决 D3）。
 * 与 BentoDoc v4（bentodoc-v4.ts）保持独立：PPTD 是 authoring artifact，$ref 与
 * 缺省在 import 期解析，本文件不投影 canonical 词表。本文件只含类型；modeled
 * geometry types come from static-v1.ts.
 */

import type { StaticV1CropShape, StaticV1ShapeName } from "./static-v1.ts";

/** 颜色：HEX6/HEX8 或 `$` theme.colors 引用（如 "$primary"）；其他色彩函数不在子集。 */
export type PptdColor = string;

export type PptdFontFamily = string | { latin: string; ea: string };

/** [x, y, width, height]，px，画布左上原点。 */
export type PptdBounds = [number, number, number, number];

export type PptdHorizontalAlign = "left" | "center" | "right" | "justify" | "distributed";
export type PptdVerticalAlign = "top" | "middle" | "bottom";
export type PptdAlignment = [PptdHorizontalAlign, PptdVerticalAlign];

// ---- 主入口（.pptd manifest） ----

export interface PptdManifest {
  version: "v2";
  title?: string;
  /** font.registration 行：本地字体登记（D3 收紧：src 必须是 media/ 下本地路径）。 */
  customFonts?: PptdCustomFont[];
  /** [width, height]；必须为正有限整数对（E002）。 */
  size: [number, number];
  theme?: PptdTheme;
  /** 页面文件相对路径列表（相对 .pptd 所在目录），与 PptdProject.pages 同序；单画布产品仅 1 页（E011）。 */
  pages: string[];
}

/** font.registration 行（上游 src 为 Google Fonts CSS URL；本地子集收紧为 media/ 路径，E004 注记偏差）。 */
export interface PptdCustomFont {
  /** fontFamily 字段可引用的 family 名。 */
  family: string;
  /** media/ 下相对路径；远程 URL = E004。 */
  src: string;
  /** 多字重 = 多条目（native 模型 weight?/style? 兼容）。 */
  weight?: string;
  style?: string;
}

export interface PptdTheme {
  colors?: Record<string, PptdColor>;
  textStyles?: Record<string, PptdTextStyle>;
  /** common.theme / table.styleRef 行：Table.style "$key" 引用的具名表样式（C24 import 期解析）。 */
  tableStyles?: Record<string, PptdTableStyle>;
}

/** theme.textStyles 样式（上游 TextStyleConfig 全集；layout 字段 align/wrap 不进入 theme）。 */
export interface PptdTextStyle {
  color?: PptdColor;
  fontSize?: number;
  fontFamily?: PptdFontFamily;
  bold?: boolean;
  italic?: boolean;
  backgroundColor?: PptdColor;
  /** 倍数；与 lineHeightPx 互斥（E013）。 */
  lineHeight?: number;
  /** 固定 px，优先于 lineHeight（C1）。 */
  lineHeightPx?: number;
  letterSpacing?: number;
  marginTop?: number;
}

// ---- 填充 / 装饰（fill.* 行：solid / linear / radial / image 全开） ----

export type PptdFill = PptdSolidFill | PptdGradientFill | PptdImageFill;

export interface PptdSolidFill {
  type: "solid";
  color: PptdColor;
}

export interface PptdColorStop {
  position: number; // [0, 1]
  color: PptdColor;
}

export interface PptdGradientFill {
  type: "gradient";
  gradientType: "linear" | "radial";
  stops: PptdColorStop[]; // 至少 2 个
  angle?: number; // [0, 360)，default 0；仅 linear 生效（左→右，顺时针）
}

/** fill.image 行（C26 全宿主）：src 为 media/ 路径或远程 URL（远程 = E004）。 */
export interface PptdImageFill {
  type: "image";
  src: string;
  fit?: PptdImageFit; // default {mode: "cover"}
  crop?: PptdImageCrop; // 恒先于 fit 应用
  opacity?: number; // [0, 1]，default 1
}

export interface PptdShadow {
  blur: number;
  color: PptdColor;
  offset?: [number, number]; // default [0, 0]
}

export type PptdLineStyle = "solid" | "dash" | "dot";

export interface PptdBorder {
  style?: PptdLineStyle; // default "solid"
  width?: number; // default 1
  color?: PptdColor; // default "#000000"
}

/** Cell/CellStyle 的数组式边框（table.cellBorder 行）：单边/两边/四边与 null 清除。 */
export type PptdBorderSpec =
  | null
  | PptdBorder
  | [PptdBorder | null, PptdBorder | null]
  | [PptdBorder | null, PptdBorder | null, PptdBorder | null, PptdBorder | null];

// ---- 页面（.page） ----

/**
 * 上游 Page.pageType/notes/animations 属 excluded 能力（common.pageType/
 * common.speakerNotes/common.animations 行）——类型面即不收；输入出现即 E011
 * 具名拒绝（capabilityId 进 message）。
 */
export interface PptdPage {
  background?: PptdFill; // default 白色 solid
  /** z-order = 数组序，越靠后层越高。 */
  elements: PptdElement[];
}

// ---- 元素 ----

export interface PptdElementBase {
  /** 页面内唯一（common.elementId 行：重复/缺失 E014）。 */
  elementId: string;
  /** 显式必填，且全在画布内（E006）。 */
  bounds: PptdBounds;
  /**
   * 度，顺时针（common.rotation 行）。宿主集 = text/shape/line/image/icon；
   * table/chart 出现即 E013（上游 PowerPoint 限制，matrix 宿主列）。
   */
  rotation?: number;
  /** [水平, 垂直]（common.flip 行）；宿主集同 rotation，table/chart 即 E013。 */
  flip?: [boolean, boolean];
}

export interface PptdTextElement extends PptdElementBase {
  elementType: "text";
  opacity?: number; // [0, 1]，default 1
  content: PptdTextContent;
}

export interface PptdTextContent {
  /**
   * 富文本（上游 Rich Text Rules 词表：<p>/<br/>/<span>/<strong>/<b>/<em>/<i>/<u>/
   * <s>/<sup>/<sub>/<a href>/<ul>/<ol>/<li> + \(...\) LaTeX）；语法由 authoring
   * richtext.ts 单点解析（一个含义一个地方），非法结构 E013。
   */
  text: string;
  /** "$key" → theme.textStyles（E008 悬空引用）。 */
  style?: string;
  color?: PptdColor;
  fontSize?: number;
  fontFamily?: PptdFontFamily;
  bold?: boolean;
  italic?: boolean;
  backgroundColor?: PptdColor;
  lineHeight?: number; // 倍数；与 lineHeightPx 互斥
  lineHeightPx?: number; // 固定 px，优先于 lineHeight（C1）
  letterSpacing?: number;
  marginTop?: number;
  textDirection?: "horizontal" | "vertical";
  wrap?: boolean; // default true
  align?: PptdAlignment;
  /** 文字渐变（text.gradient 行；linear 原生，radial 随 svg 载具；不含 image）。 */
  gradient?: PptdGradientFill;
  /** 文字阴影（text.shadow 行；提为 canonical 元素 base）。 */
  shadow?: PptdShadow;
}

export interface PptdShapeElement extends PptdElementBase {
  elementType: "shape";
  shapeName: StaticV1ShapeName;
  adjustments?: number[];
  /** 仅 shapeName="custom"（shape.customPath 行）；非 custom 出现即 E013（canonical 不承载惰性字段）。 */
  viewBox?: [number, number];
  path?: string;
  fill?: PptdFill;
  opacity?: number;
  shadow?: PptdShadow;
  border?: PptdBorder;
}

export type PptdArrowhead = "arrow" | "stealth" | "diamond" | "oval";

export interface PptdLineElement extends PptdElementBase {
  elementType: "line";
  viewBox: [number, number];
  /** bezier 路径点 "x1,y1 x2,y2 ..."，至少 2 点，坐标在 viewBox 内（违规 E014）。 */
  points: string;
  curve?: "sharp" | "round" | "smooth"; // default "round"
  /** [起, 终]；null = 无箭头（line.arrow 行）。 */
  arrow?: [PptdArrowhead | null, PptdArrowhead | null];
  border?: PptdBorder;
  opacity?: number;
  shadow?: PptdShadow;
}

export interface PptdImageFit {
  mode: "fill" | "contain" | "cover"; // image.fit 行：与原生词表 1:1（v1 收窄已放开）
}

export interface PptdImageCrop {
  left?: number; // default 0；正=内裁，负=外扩
  top?: number;
  right?: number;
  bottom?: number;
}

/** 遮罩 ShapeDef（image.cropShape 行）；字段与 Shape 元素一一对应。 */
export interface PptdShapeDef {
  shapeName: StaticV1ShapeName;
  adjustments?: number[];
  viewBox?: [number, number];
  path?: string;
}

export interface PptdCropShapeDef extends Omit<PptdShapeDef, "shapeName"> {
  shapeName: StaticV1CropShape;
}

export interface PptdImageElement extends PptdElementBase {
  elementType: "image";
  /** media/ 下相对路径（远程 URL = E004）；import 期经 AssetIndex 固化为 asset 引用（E005）。 */
  src: string;
  cropShape?: PptdCropShapeDef;
  fit?: PptdImageFit;
  crop?: PptdImageCrop; // image.crop 行（C8）：v4 四边比例建模，不再丢弃
  opacity?: number;
  shadow?: PptdShadow;
  border?: PptdBorder;
}

export interface PptdIconElement extends PptdElementBase {
  elementType: "icon";
  /** "style:name"，如 "fas:lightbulb"。 */
  iconName: string;
  fill?: PptdFill;
  opacity?: number;
  shadow?: PptdShadow;
  border?: PptdBorder;
}

// ---- table（table.* 行：上游 pptd.md §Table 形态，2-D rows + 合并省略） ----

export interface PptdTableCell {
  /** 富文本（table.cellText 行；规则同 TextContent.text，richtext.ts 单点解析）。 */
  text?: string;
  /** "$key" → theme.textStyles（table.cellTextStyleRef 行；仅文本字段，E008 悬空）。 */
  textStyle?: string;
  // —— 内联文本字段（table.cellTextProps 行） ——
  color?: PptdColor;
  fontSize?: number;
  fontFamily?: PptdFontFamily;
  bold?: boolean;
  italic?: boolean;
  backgroundColor?: PptdColor;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  marginTop?: number;
  // —— 单元格样式 ——
  fill?: PptdFill; // solid/gradient/image（table.cellFill 行）
  border?: PptdBorderSpec; // table.cellBorder 行
  align?: PptdAlignment; // table.cellAlign 行
  // —— 合并（table.merge 行）：正整数；被覆盖格从 rows 省略；越界/重叠/覆盖不全 E014 ——
  rowSpan?: number;
  colSpan?: number;
}

export interface PptdTableElement extends PptdElementBase {
  elementType: "table";
  /** [0,1] 比例，各项和为 1（table.grid 行；违规 E009）。 */
  columnWidths: number[];
  rowHeights: number[];
  /** 2-D 格网；合并区被覆盖格省略（table.merge 行）。 */
  rows: PptdTableCell[][];
  /** "$key" → theme.tableStyles 或内联（table.styleRef 行；C24 import 期解析为内联）。 */
  style?: string | PptdTableStyle;
  /** 表级填充（可被 cell fill 覆盖）。 */
  fill?: PptdFill;
  /** 表级外框（common.border 行；由 table renderer 持有）。 */
  border?: PptdBorder;
  shadow?: PptdShadow;
}

/** 上游 TableStyleConfig（table.styleSlots/bodyStylesCycle/rowOverColumn 行）。 */
export interface PptdTableStyle {
  cellStyle?: PptdCellStyle;
  firstRowStyle?: PptdCellStyle;
  lastRowStyle?: PptdCellStyle;
  firstColumnStyle?: PptdCellStyle;
  lastColumnStyle?: PptdCellStyle;
  /** 数据行循环样式（table.bodyStylesCycle 行）。 */
  bodyStyles?: PptdCellStyle[];
  /** 行/列类别冲突时行是否胜，default true（table.rowOverColumn 行）。 */
  rowOverColumn?: boolean;
}

export interface PptdCellStyle extends PptdTextStyle {
  fill?: PptdFill;
  border?: PptdBorderSpec;
  align?: PptdAlignment;
}

// ---- chart（chart.* 行：上游 pptd.md §5 形态，13 series 平铺；$ref-able 样式值） ----

export interface PptdChartElement extends PptdElementBase {
  elementType: "chart";
  data: PptdChartData;
  /** 长度 ≥ 1；§5.4 混排矩阵违规 E014。 */
  series: PptdChartSeries[];
  /** 一层深合并缺省（chart.seriesDefaults 行；import 期物化到各 series）。 */
  seriesDefaults?: PptdSeriesDefaults;
  xAxis?: PptdChartAxis | PptdChartAxis[];
  yAxis?: PptdChartAxis | PptdChartAxis[];
  /** 柱槽布局参数（chart.barLayout 行）。 */
  barWidth?: number;
  barGap?: number;
  categoryGap?: number;
  /** radar 专用（chart.spokeAxis 行）。 */
  spokeAxis?: PptdChartSpokeAxis;
  title?: string | PptdChartTitle;
  legend?: boolean | PptdChartLegend;
  dataLabels?: PptdChartDataLabel;
  fontFamily?: PptdFontFamily;
  /** chart 外框填充（fill.* 行宿主）。 */
  fill?: PptdFill;
  border?: PptdBorder;
  shadow?: PptdShadow;
}

export interface PptdChartData {
  /** 列名，唯一非空（chart.data 行；违规 E014）。 */
  cols: string[];
  /** 每行长度 = cols.length（rectangular，E014）。 */
  /** Waterfall `encode.isTotal` uses booleans; other channels retain the
   * number/string/null domain and are checked by the validator. */
  rows: (number | string | boolean | null)[][];
}

export type PptdSeriesFill = PptdColor | PptdGradientFill;

export interface PptdChartTextStyle {
  color?: PptdColor;
  fontSize?: number;
  fontFamily?: PptdFontFamily;
}

export interface PptdChartTitle extends PptdChartTextStyle {
  text: string;
}

export interface PptdChartLegend extends PptdChartTextStyle {
  show?: boolean;
  position?: "top" | "bottom" | "left" | "right";
}

export interface PptdChartDataLabel extends PptdChartTextStyle {
  show?: boolean;
  content?: "value" | "percentage" | "category";
  numberFormat?: string;
}

export interface PptdChartMarker {
  shape?: "circle" | "rect" | "diamond" | "triangle";
  fill?: PptdSeriesFill;
  border?: PptdBorder;
  size?: number;
}

export interface PptdChartLineStyle {
  style?: PptdLineStyle;
  color?: PptdColor;
  width?: number;
}

export interface PptdChartAxis {
  show?: boolean;
  type?: "category" | "value";
  min?: number;
  max?: number;
  reverse?: boolean;
  title?: string | PptdChartTitle;
  label?: boolean | (PptdChartTextStyle & { numberFormat?: string });
  axisLine?: boolean | (PptdChartLineStyle & { arrow?: boolean | "start" | "end" | "both" });
  gridLine?: boolean | PptdChartLineStyle;
}

export interface PptdChartSpokeAxis {
  show?: boolean;
  min?: number;
  max?: number;
  label?: boolean | (PptdChartTextStyle & { numberFormat?: string });
  axisLine?: boolean | PptdChartLineStyle;
  gridLine?: boolean | PptdChartLineStyle;
}

/** series 级公共字段（mirror BentoChartSeriesCommonV4）。 */
interface PptdChartSeriesCommon {
  name?: string;
  xAxisIndex?: number;
  yAxisIndex?: number;
}

/** 曲线类公共字段（pptd.md LinearSeriesBase：line/area/radar 共享）。 */
export interface PptdLinearSeriesBase {
  smooth?: boolean;
  lineStyle?: PptdLineStyle;
  width?: number;
  marker?: false | PptdChartMarker;
  nullHandling?: "zero" | "gap" | "connect";
  lineColor?: PptdSeriesFill;
}

export interface PptdBarSeries extends PptdChartSeriesCommon {
  type: "bar";
  encode: { x: string; y: string };
  stack?: "value" | "percent";
  symbol?: PptdShapeDef;
  fill?: PptdSeriesFill;
  border?: PptdBorder;
  dataLabels?: PptdChartDataLabel;
}

export interface PptdLineSeries extends PptdLinearSeriesBase, PptdChartSeriesCommon {
  type: "line";
  encode: { x: string; y: string };
  dataLabels?: PptdChartDataLabel;
}

export interface PptdAreaSeries extends PptdLinearSeriesBase, PptdChartSeriesCommon {
  type: "area";
  encode: { x: string; y: string };
  stack?: "value" | "percent" | "stream";
  areaColor?: PptdSeriesFill;
  dataLabels?: PptdChartDataLabel;
}

export interface PptdScatterSeries extends PptdChartSeriesCommon {
  type: "scatter";
  encode: { x: string; y: string };
  dataFilter?: { col: string; value: string | number };
  marker?: PptdChartMarker; // 上游约束：不可为 false
  fill?: PptdSeriesFill;
  border?: PptdBorder;
  dataLabels?: PptdChartDataLabel;
}

export interface PptdBubbleSeries extends PptdChartSeriesCommon {
  type: "bubble";
  encode: { x: string; y: string; size: string };
  dataFilter?: { col: string; value: string | number };
  sizeScale?: "linear" | "sqrt" | "log";
  sizeRange?: [number, number];
  fill?: PptdSeriesFill;
  border?: PptdBorder;
  dataLabels?: PptdChartDataLabel;
}

export interface PptdCandlestickSeries extends PptdChartSeriesCommon {
  type: "candlestick";
  /** open 缺省 = HLC 模式。 */
  encode: { x: string; high: string; low: string; close: string; open?: string };
  upBars?: { fill?: PptdColor; border?: PptdBorder };
  downBars?: { fill?: PptdColor; border?: PptdBorder };
  wickStyle?: PptdBorder;
}

export interface PptdPieSeries extends PptdChartSeriesCommon {
  type: "pie";
  encode: { category: string; value: string };
  innerRadius?: number;
  startAngle?: number;
  fill?: PptdSeriesFill | PptdSeriesFill[];
  border?: PptdBorder;
  dataLabels?: PptdChartDataLabel;
}

export interface PptdRadarSeries extends PptdLinearSeriesBase, PptdChartSeriesCommon {
  type: "radar";
  encode: { category: string; y: string };
  areaColor?: PptdSeriesFill;
  dataLabels?: PptdChartDataLabel;
}

export interface PptdWaterfallSeries extends PptdChartSeriesCommon {
  type: "waterfall";
  encode: { x: string; y: string; isTotal?: string };
  totalBars?: { fill?: PptdColor; border?: PptdBorder };
  increaseBars?: { fill?: PptdColor; border?: PptdBorder };
  decreaseBars?: { fill?: PptdColor; border?: PptdBorder };
  dataLabels?: PptdChartDataLabel;
}

export interface PptdHeatmapSeries extends PptdChartSeriesCommon {
  type: "heatmap";
  encode: { x: string; y: string; value: string };
  colorScheme?: PptdColor[];
  colorScale?: { type?: "linear" | "diverging"; domain?: [number, number] };
  colorbar?: boolean | PptdChartLegend;
  dataLabels?: PptdChartDataLabel;
}

export interface PptdTreemapSeries extends PptdChartSeriesCommon {
  type: "treemap";
  encode: { category: string; value: string; parent?: string };
  levels?: number;
  fill?: PptdSeriesFill | PptdSeriesFill[] | PptdSeriesFill[][];
  border?: PptdBorder;
  dataLabels?: PptdChartDataLabel;
}

export interface PptdSunburstSeries extends PptdChartSeriesCommon {
  type: "sunburst";
  encode: { category: string; value: string; parent?: string };
  levels?: number;
  fill?: PptdSeriesFill | PptdSeriesFill[];
  border?: PptdBorder;
  dataLabels?: PptdChartDataLabel;
}

export interface PptdSankeySeries extends PptdChartSeriesCommon {
  type: "sankey";
  encode: { source: string; target: string; flow: string };
  nodeAlign?: "left" | "right" | "justify";
  fill?: PptdSeriesFill | PptdSeriesFill[] | Record<string, PptdSeriesFill>;
  border?: PptdBorder;
  dataLabels?: PptdChartDataLabel;
}

export type PptdChartSeries =
  | PptdBarSeries
  | PptdLineSeries
  | PptdAreaSeries
  | PptdScatterSeries
  | PptdBubbleSeries
  | PptdCandlestickSeries
  | PptdPieSeries
  | PptdRadarSeries
  | PptdWaterfallSeries
  | PptdHeatmapSeries
  | PptdTreemapSeries
  | PptdSunburstSeries
  | PptdSankeySeries;

/** 一层深合并缺省（仅多 series 类型支持，pptd.md §3.4）。 */
export interface PptdSeriesDefaults {
  bar?: Partial<Omit<PptdBarSeries, "type" | "encode">>;
  line?: Partial<Omit<PptdLineSeries, "type" | "encode">>;
  area?: Partial<Omit<PptdAreaSeries, "type" | "encode">>;
  scatter?: Partial<Omit<PptdScatterSeries, "type" | "encode">>;
  bubble?: Partial<Omit<PptdBubbleSeries, "type" | "encode">>;
  candlestick?: Partial<Omit<PptdCandlestickSeries, "type" | "encode">>;
  radar?: Partial<Omit<PptdRadarSeries, "type" | "encode">>;
}

export type PptdElement =
  | PptdTextElement
  | PptdShapeElement
  | PptdLineElement
  | PptdImageElement
  | PptdIconElement
  | PptdTableElement
  | PptdChartElement;
