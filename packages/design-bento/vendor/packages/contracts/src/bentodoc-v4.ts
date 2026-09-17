/**
 * BentoDoc v4（GD-4b Wave B1，docs/gd-4-acceptance.md §3.2 步骤 1）。
 *
 * v4 是 Active Profile v1（packages/contracts/capability-matrix/v1.json，
 * sha256 a96c9959…2dfd48）的 additive canonical 扩展，冻结输入不重开裁决：
 *   - 元素词表 7 型（common.elementType）：text/shape/line/image/icon/table/chart；
 *   - text 内容结构化为 paragraphs[].runs[]（text.plain/paragraphs/runs.* 行）；
 *   - ElementBase 增 rotation/flip/groupId，opacity/shadow 提为 base（common.* 行）；
 *   - BentoFill 扩 radial/image（fill.gradientRadial/fill.image 行）；
 *   - 文档级 fonts[]（font.registration 行）；derived 行不持久化（canonicalPath
 *     记 derived: 的 6 行不入 schema）。
 * 词表封闭：BENTO_DOC_V4_FIELDS 是 v4 closed-world 校验词表（v2/v3 词表原样保留在
 * bentodoc.ts，仅作迁移输入）。chart/table 的逐类型语义校验（混排矩阵、数据完整
 * 性、merge 越界等）属 validator（authoring，B2），按 matrix 行 failureCode 具名
 * 拒绝；本 schema 只封闭字段面。嵌套对象（paragraphs/runs/rows/series）不设子表，
 * 沿用 v2/v3 纪律：投影层逐字段挑取，出现真实失败再按证据补嵌套检查。
 * 本文件只含类型与常量表，零行为、零依赖。
 */

import type { BentoBounds, BentoBorder, BentoColor, BentoColorStop, BentoLinearGradientFill, BentoShadow, BentoSolidFill } from "./bentodoc.ts";
import type { Diagnostic } from "./diagnostics.ts";
import type { StaticV1CropShape, StaticV1ShapeName } from "./static-v1.ts";

// ---- v4 词表（matrix 派生，test/derivation-consistency.test.ts 对账钉死） ----

/** v4 元素词表（common.elementType 行：7 型）。 */
export const BENTO_ELEMENT_KINDS_V4 = [
  "text",
  "shape",
  "line",
  "image",
  "icon",
  "table",
  "chart",
] as const;

export type BentoElementKindV4 = (typeof BENTO_ELEMENT_KINDS_V4)[number];

export type BentoHorizontalAlignV4 = "left" | "center" | "right" | "justify" | "distributed";
export type BentoVerticalAlignV4 = "top" | "middle" | "bottom";
/** [水平, 垂直]（text.align 行；justify/distributed 由 adapter 显式设置，冻结裁决 C2）。 */
export type BentoAlignmentV4 = [BentoHorizontalAlignV4, BentoVerticalAlignV4];

/** 字体族：栈串（含 fallback 列表）或 {latin, ea} 对象（font.familyUniform/familyLatinEa 行）。 */
export type BentoFontFamilyV4 = string | { latin: string; ea: string };

// ---- v4 填充（fill.* 行：solid/linear 沿用 v3 形态，扩 radial/image） ----

export type BentoFillV4 = BentoSolidFill | BentoLinearGradientFill | BentoRadialGradientFillV4 | BentoImageFillV4;

/** radial 渐变（fill.gradientRadial 行：v4 扩展；投影走 svg 载具，冻结裁决 C5）。 */
export interface BentoRadialGradientFillV4 {
  type: "gradient";
  gradientType: "radial";
  stops: BentoColorStop[];
}

/** 图片填充（fill.image 行：src 为 asset 引用，import 期固化；全宿主，冻结裁决 C26）。 */
export interface BentoImageFillV4 {
  type: "image";
  /** "asset:<sha256>"（内容寻址）；字节由 revision/workspace 资产表持有。 */
  src: string;
  fit?: BentoImageFitModeV4;
  /** 四边比例 [left, top, right, bottom]，正=inset 负=outset（语义同 image.crop 行）。 */
  crop?: [number, number, number, number];
  opacity?: number;
}

/** series 级 fill（pptd §5 通用规则：不支持 ImageFill）。 */
export type BentoSeriesFillV4 = BentoColor | BentoLinearGradientFill | BentoRadialGradientFillV4;

/** 文字渐变（text.gradient 行：linear 原生，radial 随 svg 载具；不含 image）。 */
export type BentoGradientFillV4 = BentoLinearGradientFill | BentoRadialGradientFillV4;

// ---- v4 文档级 ----

export interface BentoFontRegistrationV4 {
  /** font.familyUniform 宿主可引用的 family 名。 */
  family: string;
  /** font.registration 行：family+src asset 登记；"asset:<sha256>" 内容寻址引用。 */
  src: string;
  /** 多字重 = 多条目（native 模型 weight?/style? 兼容）。 */
  weight?: string;
  style?: string;
}

export interface BentoDocV4 {
  schemaVersion: 4;
  canvas: { width: number; height: number };
  background: BentoFillV4;
  /** font.registration 行（v4 文档级新增）：登记字体表。 */
  fonts?: BentoFontRegistrationV4[];
  elements: BentoElementV4[];
  /** import 期诊断随文档携带；v4 零静默损失 ⇒ Active Profile 输入成功时为空。 */
  diagnostics: Diagnostic[];
}

// ---- v4 元素 ----

/**
 * v4 元素公共字段。rotation/flip/groupId 为 v4 新增（common.rotation/flip/group 行），
 * opacity/shadow 自 v3 各 kind 提升为 base（common.opacity/shadow 行，shadow 含 text
 * 宿主；多层阴影 = 数组，common.shadow 行）。border 不入 base：宿主限
 * shape/line/image/icon/table/chart（common.border 行），text 无 border。
 */
export interface BentoElementBaseV4 {
  id: string;
  kind: BentoElementKindV4;
  bounds: BentoBounds;
  /** z-order = 数组序显式化（common.zOrder 行，沿用 v3）。 */
  zIndex: number;
  /** 度，顺时针，与 PPTD 同向零换算（common.rotation 行）。 */
  rotation?: number;
  /** [水平, 垂直]（common.flip 行；adapter frame 层渲染）。 */
  flip?: [boolean, boolean];
  /** 仅扁平 group，嵌套具名拒绝（common.group 行，冻结裁决 C22）。 */
  groupId?: string;
  opacity?: number;
  shadow?: BentoShadow | BentoShadow[];
}

export interface BentoBorderSpecV4 {
  style?: "solid" | "dash" | "dot";
  width?: number;
  color?: BentoColor;
}

/** 单边/两边/四边/null 显式清除（table.cellBorder 行，pptd BorderSpec 形态）。 */
export type BentoCellBorderV4 =
  | null
  | BentoBorderSpecV4
  | [BentoBorderSpecV4 | null, BentoBorderSpecV4 | null]
  | [BentoBorderSpecV4 | null, BentoBorderSpecV4 | null, BentoBorderSpecV4 | null, BentoBorderSpecV4 | null];

// ---- text：结构化内容（text.* 行） ----

export interface BentoTextRunV4 {
  /** 纯文本；段内换行随文本（text.plain/text.lineBreak 行）。 */
  text: string;
  color?: BentoColor;
  fontSize?: number;
  fontFamily?: BentoFontFamilyV4;
  backgroundColor?: BentoColor;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  /** 上标/下标（text.superscript/text.subscript 行）。 */
  baselineShift?: "sup" | "sub";
  /** https/http/mailto（text.hyperlink 行；词表由 validator 把关）。 */
  href?: string;
  /** TeX 源码（text.latex 行：\(...\) 分隔符已在 import 期映射）。 */
  latex?: string;
}

/** 列表结构保真（text.lists + text.listItemStyles 行，冻结裁决 C3：不降格 glyph 行）。 */
export interface BentoParagraphListV4 {
  ordered?: boolean;
  /** list-style-type（如 disc/decimal/square）。 */
  marker?: string;
  indent?: number;
  /** li 级样式覆盖（text-align/line-height/letter-spacing/margin-top/margin-left/list-style-*）。 */
  style?: {
    align?: BentoHorizontalAlignV4;
    lineHeight?: number | `${number}px`;
    letterSpacing?: number;
    marginTop?: number;
    marginLeft?: number;
    marker?: string;
  };
}

export interface BentoTextParagraphV4 {
  runs: BentoTextRunV4[];
  /** 段级水平对齐覆盖（text.paragraphAlign 行）。 */
  align?: BentoHorizontalAlignV4;
  /** 段级行距覆盖，倍数或固定 px（text.paragraphLineHeight 行）。 */
  lineHeight?: number | `${number}px`;
  /** 段级边距（text.paragraphMargin 行；adapter 渲染时需规范化 UA 1em 段距）。 */
  margin?: { top?: number; left?: number; right?: number };
  list?: BentoParagraphListV4;
}

/**
 * text 元素内容（text.* 行的结构化落点）。显式 style/$ref 继承在 import 期
 * 解析为字面值；static-v1 的 18px/MiSans/#000000/lineHeight 1 仍可推导，省略时
 * 不冗余持久化，由 shared resolver 在投影与 UI 显示面解析。
 */
export interface BentoTextContentV4 {
  paragraphs: BentoTextParagraphV4[];
  color?: BentoColor;
  /** 1px=1pt（text.fontSize 行）。 */
  fontSize?: number;
  fontFamily?: BentoFontFamilyV4;
  bold?: boolean;
  italic?: boolean;
  /** 文本高亮（text.backgroundColor 行）。 */
  backgroundColor?: BentoColor;
  /** 倍数；与 lineHeightPx 互斥（text.lineHeight 行）。 */
  lineHeight?: number;
  /** 固定 px，优先于 lineHeight（text.lineHeightPx 行，冻结裁决 C1）。 */
  lineHeightPx?: number;
  /** px，±1000（text.letterSpacing 行）。 */
  letterSpacing?: number;
  /** 段前距（text.marginTop 行）。 */
  marginTop?: number;
  /** horizontal/vertical（text.textDirection 行；竖排 = adapter writing-mode）。 */
  textDirection?: "horizontal" | "vertical";
  /** false = 不换行溢出（text.wrap 行）。 */
  wrap?: boolean;
  align?: BentoAlignmentV4;
  /** 文字渐变（text.gradient 行）。 */
  gradient?: BentoGradientFillV4;
}

export interface BentoTextElementV4 extends BentoElementBaseV4 {
  kind: "text";
  text: BentoTextContentV4;
}

// ---- shape / line / image / icon ----

export interface BentoShapeElementV4 extends BentoElementBaseV4 {
  kind: "shape";
  /** 预设词表子集（OOXML 几何表已建模）或 "custom"（shape.preset/customPath 行）。 */
  shapeName: StaticV1ShapeName;
  /** OOXML 万分比参数（shape.adjustments 行）。 */
  adjustments?: number[];
  /** 仅 shapeName="custom"（shape.customPath 行）。 */
  viewBox?: [number, number];
  path?: string;
  fill?: BentoFillV4;
  border?: BentoBorder;
}

export type BentoArrowheadV4 = "arrow" | "stealth" | "diamond" | "oval";

export interface BentoLineElementV4 extends BentoElementBaseV4 {
  kind: "line";
  /** points 坐标系 [w, h]（line.points 行）。 */
  viewBox: [number, number];
  /** "x1,y1 x2,y2 ..."，≥2 点，首尾为过点（line.points 行）。 */
  points: string;
  /** 缺省 round（line.curve 行；round 连接圆角烘焙进编译 d）。 */
  curve?: "sharp" | "round" | "smooth";
  /** [起, 终]；null = 无箭头（line.arrow 行；PPTD null → canonical null）。 */
  arrow?: [BentoArrowheadV4 | null, BentoArrowheadV4 | null];
  border?: BentoBorder;
}

export type BentoImageFitModeV4 = "fill" | "contain" | "cover";

export interface BentoShapeDefV4 {
  shapeName: StaticV1ShapeName;
  adjustments?: number[];
  viewBox?: [number, number];
  path?: string;
}

export interface BentoCropShapeDefV4 extends Omit<BentoShapeDefV4, "shapeName"> {
  shapeName: StaticV1CropShape;
}

export interface BentoImageElementV4 extends BentoElementBaseV4 {
  kind: "image";
  /** import 期固化的 asset 引用（image.src 行）。 */
  src: string;
  /** v4 打开 fill（image.fit 行；import 一律显式写，不依赖默认值分歧）。 */
  fit?: BentoImageFitModeV4;
  /** 四边比例 [left, top, right, bottom]，正=inset 负=outset；取代 v2 归一化矩形与 D101 丢弃（image.crop 行，冻结裁决 C8）。 */
  crop?: [number, number, number, number];
  /** 遮罩 ShapeDef（image.cropShape 行；svg clip-path/mask 承载）。 */
  cropShape?: BentoCropShapeDefV4;
  border?: BentoBorder;
}

export interface BentoIconElementV4 extends BentoElementBaseV4 {
  kind: "icon";
  /** "style:name"（icon.name 行；FA 货架解析为 svg 承载）。 */
  iconName: string;
  fill?: BentoFillV4;
  border?: BentoBorder;
}

// ---- table（v4 新增元素类型，table.* 行） ----

export interface BentoTableCellStyleV4 {
  color?: BentoColor;
  fontSize?: number;
  fontFamily?: BentoFontFamilyV4;
  bold?: boolean;
  italic?: boolean;
  backgroundColor?: BentoColor;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  marginTop?: number;
  fill?: BentoFillV4;
  border?: BentoCellBorderV4;
  align?: BentoAlignmentV4;
}

export interface BentoTableCellV4 extends BentoTableCellStyleV4 {
  /** 结构化富文本（table.cellText 行，同 text 元素 paragraphs/runs 模型）。 */
  text?: BentoTextContentV4;
  /** 合并跨度，缺省 1（table.merge 行；adapter 格网模型 + 真合并渲染）。 */
  rowSpan?: number;
  colSpan?: number;
}

export interface BentoTableStyleV4 {
  /** $ref 已在 import 期解析为内联字面值（table.styleRef 行，冻结裁决 C24）。 */
  cellStyle?: BentoTableCellStyleV4;
  firstRowStyle?: BentoTableCellStyleV4;
  lastRowStyle?: BentoTableCellStyleV4;
  firstColumnStyle?: BentoTableCellStyleV4;
  lastColumnStyle?: BentoTableCellStyleV4;
  /** 数据行循环样式（table.bodyStylesCycle 行）。 */
  bodyStyles?: BentoTableCellStyleV4[];
  /** 行/列类别同时命中时行样式是否胜，缺省 true（table.rowOverColumn 行）。 */
  rowOverColumn?: boolean;
}

export interface BentoTableV4 {
  /** [0,1] 比例，各项和为 1（table.grid 行）。 */
  columnWidths: number[];
  rowHeights: number[];
  /** 二维格网；合并占位跳过（table.merge 行）。 */
  rows: BentoTableCellV4[][];
  style?: BentoTableStyleV4;
}

export interface BentoTableElementV4 extends BentoElementBaseV4 {
  kind: "table";
  table: BentoTableV4;
  fill?: BentoFillV4;
  border?: BentoBorder;
}

// ---- chart（v4 新增元素类型，chart.* 行；形态 = pptd §5，$ref 已解析） ----

export interface BentoChartTextStyleV4 {
  color?: BentoColor;
  fontSize?: number;
  fontFamily?: BentoFontFamilyV4;
}

export interface BentoChartTitleV4 extends BentoChartTextStyleV4 {
  text: string;
}

export interface BentoChartLegendV4 extends BentoChartTextStyleV4 {
  show?: boolean;
  position?: "top" | "bottom" | "left" | "right";
}

export interface BentoChartDataLabelV4 extends BentoChartTextStyleV4 {
  show?: boolean;
  content?: "value" | "percentage" | "category";
  numberFormat?: string;
}

export interface BentoChartMarkerV4 {
  shape?: "circle" | "rect" | "diamond" | "triangle";
  fill?: BentoSeriesFillV4;
  border?: BentoBorder;
  size?: number;
}

export interface BentoChartLineStyleV4 {
  style?: "solid" | "dash" | "dot";
  color?: BentoColor;
  width?: number;
}

export interface BentoChartAxisV4 {
  show?: boolean;
  type?: "category" | "value";
  min?: number;
  max?: number;
  reverse?: boolean;
  title?: string | BentoChartTitleV4;
  label?: boolean | (BentoChartTextStyleV4 & { numberFormat?: string });
  axisLine?: boolean | (BentoChartLineStyleV4 & { arrow?: boolean | "start" | "end" | "both" });
  gridLine?: boolean | BentoChartLineStyleV4;
}

export interface BentoChartSpokeAxisV4 {
  show?: boolean;
  min?: number;
  max?: number;
  label?: boolean | (BentoChartTextStyleV4 & { numberFormat?: string });
  axisLine?: boolean | BentoChartLineStyleV4;
  gridLine?: boolean | BentoChartLineStyleV4;
}

export interface BentoChartDataV4 {
  /** 列名，唯一非空（chart.data 行五类完整性校验属 validator）。 */
  cols: string[];
  rows: (number | string | null)[][];
}

interface BentoChartSeriesCommonV4 {
  /** 图例展示名；缺省 encode.y/encode.value 列名。 */
  name?: string;
  xAxisIndex?: number;
  yAxisIndex?: number;
}

/** bar/line/area/scatter/bubble（chart.encode 行：import 期按列名校验后存列名引用）。 */
export interface BentoBarSeriesV4 extends BentoChartSeriesCommonV4 {
  type: "bar";
  encode: { x: string; y: string };
  stack?: "value" | "percent";
  symbol?: BentoShapeDefV4;
  fill?: BentoSeriesFillV4;
  border?: BentoBorder;
  dataLabels?: BentoChartDataLabelV4;
}

/** line/area/radar 共享曲线字段（pptd LinearSeriesBase）。 */
export interface BentoLinearSeriesBaseV4 {
  smooth?: boolean;
  lineStyle?: "solid" | "dash" | "dot";
  width?: number;
  marker?: false | BentoChartMarkerV4;
  nullHandling?: "zero" | "gap" | "connect";
  lineColor?: BentoSeriesFillV4;
}

export interface BentoLineSeriesV4 extends BentoLinearSeriesBaseV4, BentoChartSeriesCommonV4 {
  type: "line";
  encode: { x: string; y: string };
  dataLabels?: BentoChartDataLabelV4;
}

export interface BentoAreaSeriesV4 extends BentoLinearSeriesBaseV4, BentoChartSeriesCommonV4 {
  type: "area";
  encode: { x: string; y: string };
  stack?: "value" | "percent" | "stream";
  areaColor?: BentoSeriesFillV4;
  dataLabels?: BentoChartDataLabelV4;
}

export interface BentoScatterSeriesV4 extends BentoChartSeriesCommonV4 {
  type: "scatter";
  encode: { x: string; y: string };
  dataFilter?: { col: string; value: string | number };
  marker?: BentoChartMarkerV4;
  fill?: BentoSeriesFillV4;
  border?: BentoBorder;
  dataLabels?: BentoChartDataLabelV4;
}

export interface BentoBubbleSeriesV4 extends BentoChartSeriesCommonV4 {
  type: "bubble";
  encode: { x: string; y: string; size: string };
  dataFilter?: { col: string; value: string | number };
  sizeScale?: "linear" | "sqrt" | "log";
  sizeRange?: [number, number];
  fill?: BentoSeriesFillV4;
  border?: BentoBorder;
  dataLabels?: BentoChartDataLabelV4;
}

export interface BentoCandlestickSeriesV4 extends BentoChartSeriesCommonV4 {
  type: "candlestick";
  /** open 缺省 = HLC 模式（pptd §5 candlestick）。 */
  encode: { x: string; high: string; low: string; close: string; open?: string };
  upBars?: { fill?: BentoColor; border?: BentoBorder };
  downBars?: { fill?: BentoColor; border?: BentoBorder };
  wickStyle?: BentoBorder;
}

export interface BentoPieSeriesV4 extends BentoChartSeriesCommonV4 {
  type: "pie";
  encode: { category: string; value: string };
  innerRadius?: number;
  startAngle?: number;
  fill?: BentoSeriesFillV4 | BentoSeriesFillV4[];
  border?: BentoBorder;
  dataLabels?: BentoChartDataLabelV4;
}

export interface BentoRadarSeriesV4 extends BentoLinearSeriesBaseV4, BentoChartSeriesCommonV4 {
  type: "radar";
  encode: { category: string; y: string };
  areaColor?: BentoSeriesFillV4;
  dataLabels?: BentoChartDataLabelV4;
}

export interface BentoWaterfallSeriesV4 extends BentoChartSeriesCommonV4 {
  type: "waterfall";
  encode: { x: string; y: string; isTotal?: string };
  totalBars?: { fill?: BentoColor; border?: BentoBorder };
  increaseBars?: { fill?: BentoColor; border?: BentoBorder };
  decreaseBars?: { fill?: BentoColor; border?: BentoBorder };
  dataLabels?: BentoChartDataLabelV4;
}

export interface BentoHeatmapSeriesV4 extends BentoChartSeriesCommonV4 {
  type: "heatmap";
  encode: { x: string; y: string; value: string };
  colorScheme?: BentoColor[];
  colorScale?: { type?: "linear" | "diverging"; domain?: [number, number] };
  colorbar?: boolean | BentoChartLegendV4;
  dataLabels?: BentoChartDataLabelV4;
}

export interface BentoTreemapSeriesV4 extends BentoChartSeriesCommonV4 {
  type: "treemap";
  encode: { category: string; value: string; parent?: string };
  levels?: number;
  fill?: BentoSeriesFillV4 | BentoSeriesFillV4[] | BentoSeriesFillV4[][];
  border?: BentoBorder;
  dataLabels?: BentoChartDataLabelV4;
}

export interface BentoSunburstSeriesV4 extends BentoChartSeriesCommonV4 {
  type: "sunburst";
  encode: { category: string; value: string; parent?: string };
  levels?: number;
  fill?: BentoSeriesFillV4 | BentoSeriesFillV4[];
  border?: BentoBorder;
  dataLabels?: BentoChartDataLabelV4;
}

export interface BentoSankeySeriesV4 extends BentoChartSeriesCommonV4 {
  type: "sankey";
  encode: { source: string; target: string; flow: string };
  nodeAlign?: "left" | "right" | "justify";
  fill?: BentoSeriesFillV4 | BentoSeriesFillV4[] | Record<string, BentoSeriesFillV4>;
  border?: BentoBorder;
  dataLabels?: BentoChartDataLabelV4;
}

export type BentoChartSeriesV4 =
  | BentoBarSeriesV4
  | BentoLineSeriesV4
  | BentoAreaSeriesV4
  | BentoScatterSeriesV4
  | BentoBubbleSeriesV4
  | BentoCandlestickSeriesV4
  | BentoPieSeriesV4
  | BentoRadarSeriesV4
  | BentoWaterfallSeriesV4
  | BentoHeatmapSeriesV4
  | BentoTreemapSeriesV4
  | BentoSunburstSeriesV4
  | BentoSankeySeriesV4;

/** 一层深合并缺省（chart.seriesDefaults 行：import 期物化到各 series）。 */
export interface BentoSeriesDefaultsV4 {
  bar?: Partial<Omit<BentoBarSeriesV4, "type" | "encode">>;
  line?: Partial<Omit<BentoLineSeriesV4, "type" | "encode">>;
  area?: Partial<Omit<BentoAreaSeriesV4, "type" | "encode">>;
  scatter?: Partial<Omit<BentoScatterSeriesV4, "type" | "encode">>;
  bubble?: Partial<Omit<BentoBubbleSeriesV4, "type" | "encode">>;
  candlestick?: Partial<Omit<BentoCandlestickSeriesV4, "type" | "encode">>;
  radar?: Partial<Omit<BentoRadarSeriesV4, "type" | "encode">>;
}

export interface BentoChartV4 {
  data: BentoChartDataV4;
  /** 长度 ≥ 1；混排矩阵约束（chart.typeMixing 行 §5.4）属 validator。 */
  series: BentoChartSeriesV4[];
  seriesDefaults?: BentoSeriesDefaultsV4;
  xAxis?: BentoChartAxisV4 | BentoChartAxisV4[];
  yAxis?: BentoChartAxisV4 | BentoChartAxisV4[];
  barWidth?: number;
  barGap?: number;
  categoryGap?: number;
  spokeAxis?: BentoChartSpokeAxisV4;
  title?: string | BentoChartTitleV4;
  legend?: boolean | BentoChartLegendV4;
  dataLabels?: BentoChartDataLabelV4;
  fontFamily?: BentoFontFamilyV4;
  /** chart.palette 行：import 期 theme.colors 解析后的颜色循环字面值数组（B3 起声明，此前为运行时键）。 */
  palette?: BentoColor[];
  /** chart 外框填充（fill.* 行宿主"chart 外框"）。 */
  fill?: BentoFillV4;
}

export interface BentoChartElementV4 extends BentoElementBaseV4 {
  kind: "chart";
  chart: BentoChartV4;
  border?: BentoBorder;
}

export type BentoElementV4 =
  | BentoTextElementV4
  | BentoShapeElementV4
  | BentoLineElementV4
  | BentoImageElementV4
  | BentoIconElementV4
  | BentoTableElementV4
  | BentoChartElementV4;

// ---- v4 closed-world 词表（checker DOC-UNKNOWN-FIELD 真值源，B2 接入） ----

/**
 * BentoDoc v4 词表。文档级含 fonts（font.registration 行）；元素公共字段含
 * rotation/flip/groupId/opacity/shadow（v4 提升为 base），border 按宿主列入各 kind
 * （text 无 border，common.border 行）；text 元素顶层仅 text 内容对象（结构化
 * paragraphs/runs 在其内，嵌套不设子表——见文件头纪律）。
 * 同步纪律：改本表任何 v4 类型必须同步改本表，由 test/derivation-consistency.test.ts
 * 与 frozen matrix 对账夹住漂移。
 */
export const BENTO_DOC_V4_FIELDS = {
  doc: ["schemaVersion", "canvas", "background", "fonts", "elements", "diagnostics"],
  elements: {
    common: ["id", "kind", "bounds", "zIndex", "rotation", "flip", "groupId", "opacity", "shadow"],
    text: ["text"],
    shape: ["shapeName", "adjustments", "viewBox", "path", "fill", "border"],
    line: ["viewBox", "points", "curve", "arrow", "border"],
    image: ["src", "fit", "crop", "cropShape", "border"],
    icon: ["iconName", "fill", "border"],
    table: ["table", "fill", "border"],
    chart: ["chart", "fill", "border"],
  },
} as const;
