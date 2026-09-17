/**
 * BentoDoc v1 最小语义 schema（验收合同 §6）。
 *
 * import 的确定性产出：theme `$` 引用全部解析为具体值（解析发生在 import，
 * 一个含义一个地方）；z-order 由数组序显式化为 zIndex；image crop 丢弃并记入
 * diagnostics（PPTD-D101）。未设置的字段不物化默认值，保持缺省。
 * 本文件除 BENTO_DOC_V2_FIELDS（DOC-UNKNOWN-FIELD 词表白名单，文件尾部）外
 * 只含类型，零行为、零依赖。
 */

import type { Diagnostic } from "./diagnostics.ts";

/** 已解析颜色：HEX，不含 `$` 引用。 */
export type BentoColor = string;

export type BentoBounds = [number, number, number, number];

export interface BentoDocV1 {
  schemaVersion: 1;
  canvas: {
    width: number;
    height: number;
    /** 历史 v1/v2 画布 preset 字段；v3 已删除该许可概念。 */
    preset: string;
  };
  background: BentoFill;
  /** z-order = 数组序；zIndex 已显式化。 */
  elements: BentoElement[];
  /** import 期 D 级降级记录，随文档携带。 */
  diagnostics: Diagnostic[];
}

// ---- 已解析填充 / 装饰 ----

export type BentoFill = BentoSolidFill | BentoLinearGradientFill;

export interface BentoSolidFill {
  type: "solid";
  color: BentoColor;
}

export interface BentoColorStop {
  position: number;
  color: BentoColor;
}

export interface BentoLinearGradientFill {
  type: "gradient";
  gradientType: "linear";
  stops: BentoColorStop[];
  angle?: number;
}

export interface BentoShadow {
  blur: number;
  color: BentoColor;
  offset?: [number, number];
}

export interface BentoBorder {
  style?: "solid" | "dash" | "dot";
  width?: number;
  color?: BentoColor;
}

// ---- 元素 ----

export interface BentoElementBase {
  /** 来自 PPTD elementId。 */
  id: string;
  bounds: BentoBounds;
  /** 由 PPTD 数组序推导，显式化。 */
  zIndex: number;
}

/** text 字段平铺在元素上（golden 形态，验收合同 §7.5 机械锚）。 */
export interface BentoTextElement extends BentoElementBase {
  kind: "text";
  text: string;
  color?: BentoColor;
  fontSize?: number;
  fontFamily?: string | { latin: string; ea: string };
  bold?: boolean;
  italic?: boolean;
  align?: [
    "left" | "center" | "right" | "justify" | "distributed",
    "top" | "middle" | "bottom",
  ];
  wrap?: boolean;
  lineHeight?: number;
}

export interface BentoShapeElement extends BentoElementBase {
  kind: "shape";
  shapeName: string;
  adjustments?: number[];
  fill?: BentoFill;
  opacity?: number;
  shadow?: BentoShadow;
  border?: BentoBorder;
}

export interface BentoLineElement extends BentoElementBase {
  kind: "line";
  viewBox: [number, number];
  points: string;
  curve?: "sharp" | "round" | "smooth";
  border?: BentoBorder;
  opacity?: number;
  shadow?: BentoShadow;
}

export interface BentoImageElement extends BentoElementBase {
  kind: "image";
  src: string;
  fit?: { mode: "contain" | "cover" };
  opacity?: number;
  shadow?: BentoShadow;
  border?: BentoBorder;
  // crop 有意缺席：v1 不建模，import 时丢弃并记录 PPTD-D101。
}

export interface BentoIconElement extends BentoElementBase {
  kind: "icon";
  iconName: string;
  fill?: BentoFill;
  opacity?: number;
  shadow?: BentoShadow;
  border?: BentoBorder;
}

export type BentoElement =
  | BentoTextElement
  | BentoShapeElement
  | BentoLineElement
  | BentoImageElement
  | BentoIconElement;

// ---- v2（A1a-2 合同 §2）：编辑期 crop 建模 ----

/**
 * v2 image：字段同 v1，另加规范化 crop（归一化 [x, y, w, h]，0–1，相对原图）。
 * crop 只在编辑期经 setImageCrop 写入；v1 import 仍丢弃并记 PPTD-D101。
 */
export interface BentoImageElementV2 extends BentoImageElement {
  crop?: [number, number, number, number];
}

export type BentoElementV2 =
  | BentoTextElement
  | BentoShapeElement
  | BentoLineElement
  | BentoImageElementV2
  | BentoIconElement;

export interface BentoDocV2 {
  schemaVersion: 2;
  canvas: {
    width: number;
    height: number;
    /** 历史 v1/v2 画布 preset 字段；v3 已删除该许可概念。 */
    preset: string;
  };
  background: BentoFill;
  /** z-order = 数组序；zIndex 已显式化。 */
  elements: BentoElementV2[];
  /** import 期 D 级降级记录，随文档携带。 */
  diagnostics: Diagnostic[];
}

export type BentoDoc = BentoDocV1 | BentoDocV2 | BentoDocV3;

// ---- v3（GD-2a，gd-2-acceptance.md §2.1）：删 canvas.preset ----

/**
 * v3 canonical：schemaVersion 3，canvas 仅 { width, height }（preset 许可概念删除，
 * 由 v1/v2→v3 显式迁移丢弃，migrate.ts）。元素模型不变（= BentoElementV2）。
 * V1/V2 类型仅作迁移输入形态保留。
 */
export interface BentoDocV3 {
  schemaVersion: 3;
  canvas: {
    width: number;
    height: number;
  };
  background: BentoFill;
  /** z-order = 数组序；zIndex 已显式化。 */
  elements: BentoElementV2[];
  /** import 期 D 级降级记录，随文档携带。 */
  diagnostics: Diagnostic[];
}

// ---- DOC-UNKNOWN-FIELD runtime allowlist（A1a-3 合同 §2） ----

/**
 * BentoDoc v2 词表白名单（checker DOC-UNKNOWN-FIELD 的真值源，A1a-3 合同 §2）。
 * 覆盖文档级与元素级顶层字段（合同触发条件的字面条约）；嵌套对象（fill/shadow/
 * border 等）不设子表——投影层逐字段白名单挑取、未知键根本到不了 renderer，
 * 出现真实失败再按证据补嵌套检查（AGENTS.md：指认不出真实失败即删）。
 * 同步纪律：改本文件任何 v2 类型（增删字段）必须同步改本表——运行时表与静态类型
 * 是同一含义的两处表达，由 check.test.ts 的合法/违规文档双方夹住漂移。
 */
export const BENTO_DOC_V2_FIELDS = {
  /** 文档级字段。 */
  doc: ["schemaVersion", "canvas", "background", "elements", "diagnostics"],
  /** 各 kind 元素字段 = 公共字段 + kind 专属。 */
  elements: {
    common: ["id", "kind", "bounds", "zIndex", "opacity", "shadow", "border"],
    text: ["text", "color", "fontSize", "fontFamily", "bold", "italic", "align", "wrap", "lineHeight"],
    shape: ["shapeName", "adjustments", "fill"],
    line: ["viewBox", "points", "curve"],
    image: ["src", "fit", "crop"],
    icon: ["iconName", "fill"],
  },
} as const;

/**
 * BentoDoc v3 canonical 词表（GD-2a §2.1）：v3 checker DOC-UNKNOWN-FIELD 唯一词表。
 * 文档级字段按 v3 实际 canonical 顶层字段列出；元素字段表自 v2 平移（元素模型未变，
 * 同一含义一处表达，直接引用 v2 表）。"preset" 是 canvas 嵌套键、从未在词表，
 * 无条目可删；preset 消除由 V3 类型与迁移丢弃承载。
 * V1/V2 词表仅服务迁移输入（migrate.ts legacy 校验），不参与 v3 校验。
 */
export const BENTO_DOC_V3_FIELDS = {
  /** 文档级字段。 */
  doc: ["schemaVersion", "canvas", "background", "elements", "diagnostics"],
  /** 元素字段表自 v2 平移。 */
  elements: BENTO_DOC_V2_FIELDS.elements,
} as const;
