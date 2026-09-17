/**
 * VisualCommand v4 扩展（GD-4b Wave B1，docs/gd-4-acceptance.md §3.2 步骤 4：
 * 扩展 VisualCommand 到 Active Profile 的持久编辑字段）。
 *
 * 每个命令/补丁字段由 capability matrix 的 editContract 派生（backing 表
 * VISUAL_COMMAND_V4_BACKING 唯一事实源，test/derivation-consistency.test.ts 对账：
 * backing capabilityId 必须存在于 matrix 且 active）。命令面覆盖元素级/文档级
 * 持久编辑；B3 起 Active Profile 每行 editContract 均有具名命令（table cell/merge/
 * grid、chart data/series/option/palette、shape/line/image/icon/group/font）。
 *
 * 与 v3 命令面的边界：kernel/editor-bento 在 B2 前仍消费 v3 VisualCommand
 * （contracts/src/commands.ts 原样保留）；VisualCommandV4 用 v4 语义替换
 * setStyle（patch 扩展）、setImageCrop（v2 归一化矩形 → v4 四边比例，image.crop
 * 行"取代 v2"裁决）与 setText（B2 payload 扩宽，用户裁决 D2：富文本内容的
 * inverse 必须可表达，否则 undo 丢 runs），其余 v3 命令原样并入。
 * B2 增补（kernel/editor-bento 类型 ripple 的公共面）：CommandBatchV4/
 * ApplySuccessV4/VisualTreeV4/VisualDocumentKernelV4 镜像 commands.ts v3 形态。
 * 本文件只含类型与常量表，零行为、零依赖。
 */

import type { BentoBorder, BentoColor, BentoShadow } from "./bentodoc.ts";
import type {
  BentoAlignmentV4,
  BentoArrowheadV4,
  BentoCellBorderV4,
  BentoCropShapeDefV4,
  BentoChartAxisV4,
  BentoChartDataLabelV4,
  BentoChartDataV4,
  BentoChartLegendV4,
  BentoChartSeriesV4,
  BentoChartSpokeAxisV4,
  BentoChartTitleV4,
  BentoElementV4,
  BentoFillV4,
  BentoFontFamilyV4,
  BentoFontRegistrationV4,
  BentoGradientFillV4,
  BentoImageFitModeV4,
  BentoTableStyleV4,
  BentoTextContentV4,
} from "./bentodoc-v4.ts";
import type { ApplyFailure, ElementId, SetAssetCommand, SetBoundsCommand, SetZOrderCommand, VisualDocumentSnapshot } from "./commands.ts";
import type { StaticV1ShapeName } from "./static-v1.ts";

// ---- 文档级（canvas.* 行） ----

/** canvas.size 行：正有限整数约束由 kernel/importer 保证（E002）。 */
export interface SetCanvasSizeCommand {
  type: "setCanvasSize";
  width: number;
  height: number;
}

/** canvas.background 行：携带完整 fill 使 inverse 永远合法（缺省态 = 白色 solid）。 */
export interface SetBackgroundCommand {
  type: "setBackground";
  background: BentoFillV4;
}

// ---- 元素级具名命令（common.* / image.fit 行 editContract 具名新增） ----

/** common.rotation 行：度/顺时针；null = 清除。 */
export interface SetRotationCommand {
  type: "setRotation";
  targetId: ElementId;
  rotation: number | null;
}

/** common.flip 行：[水平, 垂直]；null = 清除。 */
export interface SetFlipCommand {
  type: "setFlip";
  targetId: ElementId;
  flip: [boolean, boolean] | null;
}

/** common.shadow + text.shadow 行：多层阴影 = 数组；null = 清除。 */
export interface SetShadowCommand {
  type: "setShadow";
  targetId: ElementId;
  shadow: BentoShadow | BentoShadow[] | null;
}

/** common.border 行：null = 清除。 */
export interface SetBorderCommand {
  type: "setBorder";
  targetId: ElementId;
  border: BentoBorder | null;
}

/** image.fit 行（a1a2 patch 已卸原生下拉，无对应命令）。 */
export interface SetImageFitCommand {
  type: "setImageFit";
  targetId: ElementId;
  fit: BentoImageFitModeV4;
}

// ---- 元素 create/delete（common.createDelete 行，冻结裁决 C23：GD-4c 接管全部原生入口） ----

/** 携带完整 v4 元素（含 id）使 delete 的 inverse（createElement）永远合法。 */
export interface CreateElementCommand {
  type: "createElement";
  element: BentoElementV4;
}

export interface DeleteElementCommand {
  type: "deleteElement";
  targetId: ElementId;
}

// ---- setStyle v4：Active Profile 持久样式字段（各行 editContract："接 VisualCommand"） ----

/**
 * v4 样式补丁。null = 删除字段（inverse 表达旧缺省）；语义校验（[0,1]、词表、
 * 互斥 lineHeight/lineHeightPx 等）属 kernel（B2 ripple），按各行 failureCode 拒绝。
 * fill 覆盖 shape/icon/table/chart 宿主（fill.* 行）；gradient 为 text 宿主
 * （text.gradient 行）；fontFamily 为 text/table/chart 宿主（font.familyUniform/
 * familyLatinEa 行，{latin,ea} 对象形态一并支持）。
 */
export interface VisualStylePatchV4 {
  /** common.opacity 行（v4 提为 base，含 text）。 */
  opacity?: number | null;
  /** text.color 行。 */
  color?: string | null;
  fontFamily?: BentoFontFamilyV4 | null;
  fontSize?: number | null;
  bold?: boolean | null;
  italic?: boolean | null;
  lineHeight?: number | null;
  lineHeightPx?: number | null;
  letterSpacing?: number | null;
  marginTop?: number | null;
  align?: BentoAlignmentV4 | null;
  wrap?: boolean | null;
  textDirection?: "horizontal" | "vertical" | null;
  backgroundColor?: string | null;
  gradient?: BentoGradientFillV4 | null;
  fill?: BentoFillV4 | null;
}

export interface SetStyleCommandV4 {
  type: "setStyle";
  targetId: ElementId;
  patch: VisualStylePatchV4;
}

// ---- setText v4（B2 payload 扩宽，用户裁决 D2） ----

/**
 * v4 语义替换 v3 setText：payload 扩宽为 `string | BentoTextContentV4`。string =
 * text.plain 行 plain-text 简写（kernel 归一化为单段单 run，"\n" 切多段，元素级
 * 样式字段保留）；完整 content 供 inverse 携带旧值（undo/redo 往返不丢 runs）与
 * GD-4c 富文本编辑面使用。文本内容仍以纯文本承载，不含 html。
 */
export interface SetTextCommandV4 {
  type: "setText";
  targetId: ElementId;
  text: string | BentoTextContentV4;
}

// ---- v4 命令面 ----

/**
 * v4 用 V4 语义替换 v3 的 setText（payload 扩宽）、setStyle（patch 词表扩展）与
 * setImageCrop（crop 几何 v2 [x,y,w,h] 归一化矩形 → v4 [l,t,r,b] 四边比例，
 * image.crop 行"取代 v2"裁决），其余 v3 命令（setBounds/setAsset/setZOrder）原样并入。
 */
export interface SetImageCropCommandV4 {
  type: "setImageCrop";
  targetId: ElementId;
  /** [left, top, right, bottom] 四边比例；left+right<1 且 top+bottom<1（E013）。 */
  crop: [number, number, number, number] | null;
}

// ---- 命令面补齐（GD-4b Wave B3，docs/gd-4-acceptance.md §3.2 步骤 4 审计：
// Active Profile 每个 editContract 由具名 VisualCommandV4 承载，拒绝以 createElement /
// 宽 setStyle 冒名；chart.seriesDefaults 行 import 期一层深合并物化后不随文档携带
// （可推导状态不重复持久化），无命令——见 authoring/src/import.ts mapChartSeries） ----

/** shape.preset/adjustments/customPath 行：几何整写；shapeName="custom" 必带 path。 */
export interface SetShapeGeometryCommand {
  type: "setShapeGeometry";
  targetId: ElementId;
  shapeName: StaticV1ShapeName;
  adjustments?: number[];
  viewBox?: [number, number];
  path?: string;
}

/** line.points/line.curve 行：points = "x1,y1 x2,y2 ..."（≥2 坐标对）；curve 缺省不动。 */
export interface SetLineGeometryCommand {
  type: "setLineGeometry";
  targetId: ElementId;
  viewBox: [number, number];
  points: string;
  curve?: "sharp" | "round" | "smooth";
}

/** line.arrow 行：[起, 终]（词表 arrow/stealth/diamond/oval）；null = 清除。 */
export interface SetLineArrowCommand {
  type: "setLineArrow";
  targetId: ElementId;
  arrow: [BentoArrowheadV4 | null, BentoArrowheadV4 | null] | null;
}

/** image.cropShape 行：ShapeDef 遮罩整写；null = 清除。 */
export interface SetImageCropShapeCommand {
  type: "setImageCropShape";
  targetId: ElementId;
  cropShape: BentoCropShapeDefV4 | null;
}

/** icon.name 行：由 static-v1 parser 规范化为 fas/far/fab:name。 */
export interface SetIconNameCommand {
  type: "setIconName";
  targetId: ElementId;
  iconName: string;
}

/** common.group 行：扁平 group 标签；null = 离组；任意元素宿主（含 text）。 */
export interface SetGroupIdCommand {
  type: "setGroupId";
  targetId: ElementId;
  groupId: string | null;
}

/** font.registration 行（文档级，无 targetId）：登记字体；identity = family+weight+style 唯一。 */
export interface AddFontRegistrationCommand {
  type: "addFontRegistration";
  font: BentoFontRegistrationV4;
}

/** font.registration 行（文档级）：identity = family+weight+style，删除该登记。 */
export interface RemoveFontRegistrationCommand {
  type: "removeFontRegistration";
  family: string;
  weight?: string;
  style?: string;
}

/** table.cellText/cellTextStyleRef 行：cell 文本（string = plain 简写）；null = 清除；logical (row, col)。 */
export interface SetTableCellTextCommand {
  type: "setTableCellText";
  targetId: ElementId;
  row: number;
  col: number;
  text: string | BentoTextContentV4 | null;
}

/** 单元格样式补丁（table.cellTextProps/cellFill/cellBorder/cellAlign 行）。each key nullable：null = 删除字段；lineHeight/lineHeightPx 互斥。 */
export interface TableCellStylePatchV4 {
  color?: BentoColor | null;
  fontSize?: number | null;
  fontFamily?: BentoFontFamilyV4 | null;
  bold?: boolean | null;
  italic?: boolean | null;
  backgroundColor?: BentoColor | null;
  lineHeight?: number | null;
  lineHeightPx?: number | null;
  letterSpacing?: number | null;
  marginTop?: number | null;
  fill?: BentoFillV4 | null;
  border?: BentoCellBorderV4 | null;
  align?: BentoAlignmentV4 | null;
}

/** table.cellTextProps/cellFill/cellBorder/cellAlign 行：cell 样式补丁；null = 删除字段。 */
export interface SetTableCellStyleCommand {
  type: "setTableCellStyle";
  targetId: ElementId;
  row: number;
  col: number;
  patch: TableCellStylePatchV4;
}

/** table.merge 行：anchor-cell-only；region 全在 grid 内且全部为未合并 anchor；被覆盖格数据销毁（inverse 由 kernel 以 split + cell 命令重构）。 */
export interface SetTableMergeCommand {
  type: "setTableMerge";
  targetId: ElementId;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

/** table.merge 行：仅合并 anchor；复位 1x1 并复活被覆盖位为占位格。 */
export interface SetTableSplitCommand {
  type: "setTableSplit";
  targetId: ElementId;
  row: number;
  col: number;
}

/** table.grid 行：只增不减（rows>=cur、cols>=cur；收缩拒绝——inverse 需复活被毁 cell 数据）。 */
export interface SetTableShapeCommand {
  type: "setTableShape";
  targetId: ElementId;
  rows: number;
  cols: number;
}

/** table.grid 行：比例整写；至少提供一数组；长度=当前行列；值 [0,1] 且和≈1（容差 1e-6）。 */
export interface SetTableGridCommand {
  type: "setTableGrid";
  targetId: ElementId;
  columnWidths?: number[];
  rowHeights?: number[];
}

/** table.styleRef/styleSlots/bodyStylesCycle/rowOverColumn 行：样式全量替换（含 slots 校验）；null = 清除。 */
export interface SetTableStyleCommand {
  type: "setTableStyle";
  targetId: ElementId;
  style: BentoTableStyleV4 | null;
}

/** chart.data 行：cols 唯一非空；每行同长于头；cell 词表 number|string|null。 */
export interface SetChartDataCommand {
  type: "setChartData";
  targetId: ElementId;
  data: BentoChartDataV4;
}

/** chart.encode/typeMixing 及 13 逐型行：按型要求 encode 键；null = 删除（保持 ≥1 series）。 */
export interface SetChartSeriesCommand {
  type: "setChartSeries";
  targetId: ElementId;
  index: number;
  series: BentoChartSeriesV4 | null;
}

/** chart 选项补丁（chart.title/legend/dataLabels/axis·spokeAxis/barLayout + font.family·fill 线）。null = 删除字段。 */
export interface ChartOptionPatchV4 {
  title?: string | BentoChartTitleV4 | null;
  legend?: boolean | BentoChartLegendV4 | null;
  dataLabels?: BentoChartDataLabelV4 | null;
  xAxis?: BentoChartAxisV4 | BentoChartAxisV4[] | null;
  yAxis?: BentoChartAxisV4 | BentoChartAxisV4[] | null;
  spokeAxis?: BentoChartSpokeAxisV4 | null;
  barWidth?: number | null;
  barGap?: number | null;
  categoryGap?: number | null;
  fontFamily?: BentoFontFamilyV4 | null;
  fill?: BentoFillV4 | null;
}

/** chart 选项 + font.family·fill 宿主线：chart 选项补丁整写。 */
export interface SetChartOptionCommand {
  type: "setChartOption";
  targetId: ElementId;
  option: ChartOptionPatchV4;
}

/** chart.palette 行：颜色循环数组；null = 清除；存在时非空。 */
export interface SetChartPaletteCommand {
  type: "setChartPalette";
  targetId: ElementId;
  palette: BentoColor[] | null;
}

export type VisualCommandV4 =
  | SetBoundsCommand
  | SetAssetCommand
  | SetZOrderCommand
  | SetTextCommandV4
  | SetCanvasSizeCommand
  | SetBackgroundCommand
  | SetRotationCommand
  | SetFlipCommand
  | SetShadowCommand
  | SetBorderCommand
  | SetImageFitCommand
  | CreateElementCommand
  | DeleteElementCommand
  | SetStyleCommandV4
  | SetImageCropCommandV4
  | SetShapeGeometryCommand
  | SetLineGeometryCommand
  | SetLineArrowCommand
  | SetImageCropShapeCommand
  | SetIconNameCommand
  | SetGroupIdCommand
  | AddFontRegistrationCommand
  | RemoveFontRegistrationCommand
  | SetTableCellTextCommand
  | SetTableCellStyleCommand
  | SetTableMergeCommand
  | SetTableSplitCommand
  | SetTableShapeCommand
  | SetTableGridCommand
  | SetTableStyleCommand
  | SetChartDataCommand
  | SetChartSeriesCommand
  | SetChartOptionCommand
  | SetChartPaletteCommand;

/**
 * 命令面 → capability matrix 对账表（派生一致性的唯一事实源）：
 * 每个命令/补丁字段的 backing capabilityId 必须在 matrix 中存在且 active。
 * 测试见 test/derivation-consistency.test.ts；对账方向为命令 → matrix
 * （matrix → 命令的持久编辑字段全覆盖审计随 B2 kernel applyCommand 落地）。
 */
export const VISUAL_COMMAND_V4_BACKING = {
  setCanvasSize: ["canvas.size"],
  setBackground: ["canvas.background"],
  setRotation: ["common.rotation"],
  setFlip: ["common.flip"],
  setShadow: ["common.shadow", "text.shadow"],
  setBorder: ["common.border"],
  setImageFit: ["image.fit"],
  setImageCrop: ["image.crop"],
  createElement: ["common.createDelete"],
  deleteElement: ["common.createDelete"],
  "style.opacity": ["common.opacity"],
  "style.color": ["text.color"],
  "style.fontFamily": ["font.familyUniform", "font.familyLatinEa"],
  "style.fontSize": ["text.fontSize"],
  "style.bold": ["text.bold"],
  "style.italic": ["text.italic"],
  "style.lineHeight": ["text.lineHeight"],
  "style.lineHeightPx": ["text.lineHeightPx"],
  "style.letterSpacing": ["text.letterSpacing"],
  "style.marginTop": ["text.marginTop"],
  "style.align": ["text.align"],
  "style.wrap": ["text.wrap"],
  "style.textDirection": ["text.textDirection"],
  "style.backgroundColor": ["text.backgroundColor"],
  "style.gradient": ["text.gradient"],
  "style.fill": ["fill.solid", "fill.gradientLinear", "fill.gradientRadial", "fill.image"],
  setShapeGeometry: ["shape.preset", "shape.adjustments", "shape.customPath"],
  setLineGeometry: ["line.points", "line.curve"],
  setLineArrow: ["line.arrow"],
  setImageCropShape: ["image.cropShape"],
  setIconName: ["icon.name"],
  setGroupId: ["common.group"],
  addFontRegistration: ["font.registration"],
  removeFontRegistration: ["font.registration"],
  setTableCellText: ["table.cellText", "table.cellTextStyleRef"],
  setTableCellStyle: ["table.cellTextProps", "table.cellFill", "table.cellBorder", "table.cellAlign"],
  setTableMerge: ["table.merge"],
  setTableSplit: ["table.merge"],
  setTableShape: ["table.grid"],
  setTableGrid: ["table.grid"],
  setTableStyle: ["table.styleRef", "table.styleSlots", "table.bodyStylesCycle", "table.rowOverColumn"],
  setChartData: ["chart.data"],
  setChartSeries: ["chart.encode", "chart.typeMixing", "chart.bar", "chart.line", "chart.area", "chart.scatter", "chart.bubble", "chart.candlestick", "chart.pie", "chart.radar", "chart.waterfall", "chart.heatmap", "chart.treemap", "chart.sunburst", "chart.sankey"],
  setChartOption: ["chart.title", "chart.legend", "chart.dataLabels", "chart.axisBasic", "chart.axisLabel", "chart.axisLineGrid", "chart.axisSecondary", "chart.spokeAxis", "chart.barLayout", "font.familyUniform", "font.familyLatinEa", "fill.solid", "fill.gradientLinear", "fill.gradientRadial", "fill.image"],
  setChartPalette: ["chart.palette"],
} as const satisfies Record<string, readonly string[]>;

// ---- 批次与 kernel 接口（B2：镜像 commands.ts v3 形态切 v4） ----

export interface CommandBatchV4 {
  batchId: string;
  actor: string;
  baseRevision: number;
  commands: readonly VisualCommandV4[];
}

/** snapshot 沿用 v3 品牌串（canonicalJson 产物，与版本无关）。 */
export interface ApplySuccessV4 {
  ok: true;
  revision: number;
  snapshot: VisualDocumentSnapshot;
  inverseBatch: CommandBatchV4;
  changedElementIds: readonly ElementId[];
}

/** ApplyError/ApplyFailure 与 v3 同形（码表不变），直接复用。 */
export type ApplyResultV4 = ApplySuccessV4 | ApplyFailure;

export interface VisualElementV4 {
  id: ElementId;
  type: string;
  bounds: { x: number; y: number; width: number; height: number };
  zIndex: number;
  /** text 预览投影：paragraphs runs 纯文本按段拼接（"\n" 连接）。 */
  text?: string;
  assetRef?: string;
  /** v4 四边比例 [l,t,r,b]（image.crop 行语义）。 */
  crop?: [number, number, number, number];
  rotation?: number;
  flip?: [boolean, boolean];
  style?: VisualStylePatchV4;
}

export interface VisualTreeV4 {
  width: number;
  height: number;
  elements: readonly VisualElementV4[];
}

export interface VisualDocumentKernelV4 {
  readonly revision: number;
  apply(batch: CommandBatchV4): ApplyResultV4;
  undo(): ApplyResultV4;
  redo(): ApplyResultV4;
  inspect(): VisualTreeV4;
  snapshot(): VisualDocumentSnapshot;
}
