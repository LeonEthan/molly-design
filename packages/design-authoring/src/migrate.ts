/**
 * BentoDoc schema 版本 codec（docs/a1a-2-acceptance.md §2；GD-2a 增补 v3 loader；
 * GD-3a：legacy loadBentoDoc/migrateV1toV2 删除，gd-3-acceptance.md §2.7；
 * GD-4b Wave B2：loadBentoDocV4 是唯一 load 入口，v1/v2/v3 → v4 显式迁移链
 * 钉死（docs/gd-4-acceptance.md §3.2 步骤 2：先按旧词表校验，再迁移，再按 v4
 * closed-world 校验——防迁移洗掉未知字段）。
 *
 * 钉死迁移链：
 *   schemaVersion 1/2 → ① legacy 词表（BENTO_DOC_V2_FIELDS）校验字节
 *                     → ② migrateToV3（丢弃 canvas.preset）
 *                     → ③ v3 closed-world 校验（BENTO_DOC_V3_FIELDS）
 *                     → ④ migrateToV4（机械无损：text 平铺字段重组为 paragraphs/
 *                       runs 结构化、image fit {mode} → 平铺串、crop 归一化矩形
 *                       → [l,t,r,b] 四边比例、schemaVersion 翻 4）
 *                     → ⑤ v4 closed-world 校验（BENTO_DOC_V4_FIELDS）。
 *   schemaVersion 3   → ③④⑤（v3 无 preset 可弃）。
 *   schemaVersion 4   → ⑤。
 *   其余 → UnsupportedSchemaVersionError。
 *
 * 迁移只发生在加载旧字节时；不静默改写已提交 revision（存量字节只读，读出即 v4
 * 内存形态，冻结裁决 D1）。v3 文档不可能含 table/chart 元素（旧 importer 降级产出
 * shapes/text，B-5 §2.3）；声称含有的字节在 ③ 即被 v3 词表具名拒绝。v3 元素的
 * opacity/shadow 已在元素顶层（v3 词表 common），v4 同位承接，无字段搬家。
 */

import {
  BENTO_DOC_V2_FIELDS,
  BENTO_DOC_V3_FIELDS,
  BENTO_DOC_V4_FIELDS,
  type BentoDocV1,
  type BentoDocV2,
  type BentoDocV3,
  type BentoDocV4,
  type BentoElementV2,
  type BentoElementV4,
  resolveStaticV1IconMembership,
} from "./contracts.ts";

export class UnsupportedSchemaVersionError extends Error {
  readonly code = "UNSUPPORTED_SCHEMA_VERSION";

  constructor(actualVersion: unknown) {
    super(`unsupported BentoDoc schemaVersion: ${String(actualVersion)}`);
    this.name = "UnsupportedSchemaVersionError";
  }
}

export class BentoDocUnknownFieldError extends Error {
  readonly code = "BENTO_DOC_UNKNOWN_FIELD";

  constructor(path: string) {
    super(`BentoDoc unknown field: ${path}`);
    this.name = "BentoDocUnknownFieldError";
  }
}

// ---- 词表校验（迁移链 ①③⑤ 共用机制） ----

interface FieldTable {
  doc: readonly string[];
  elements: { common: readonly string[] } & Record<string, readonly string[]>;
}

/** 词表校验：文档级 + 元素级顶层字段白名单（嵌套对象不设子表，同 v2/v3/v4 词表纪律）。 */
function assertKnownFields(value: object, fields: FieldTable): void {
  const doc = value as Record<string, unknown>;
  for (const key of Object.keys(doc)) {
    if (!fields.doc.includes(key)) throw new BentoDocUnknownFieldError(key);
  }
  if (!Array.isArray(doc.elements)) return;
  for (const [index, element] of doc.elements.entries()) {
    if (element === null || typeof element !== "object" || Array.isArray(element)) continue;
    const rec = element as Record<string, unknown>;
    // Object.hasOwn 防原型链键（如 "toString"）被当作已登记 kind 展开。
    const specific =
      typeof rec.kind === "string" && Object.hasOwn(fields.elements, rec.kind)
        ? fields.elements[rec.kind]
        : undefined;
    const allowed = new Set([...fields.elements.common, ...(specific ?? [])]);
    for (const key of Object.keys(rec)) {
      if (!allowed.has(key)) throw new BentoDocUnknownFieldError(`elements[${index}].${key}`);
    }
  }
}

// ---- ② v3 迁移（raw migrator 私有：公开入口必须带 ① 前置校验与 ③ 后置校验） ----

/** 丢弃 canvas.preset，schemaVersion 翻 3，其余逐字段不变。不修改输入。 */
function migrateToV3(doc: BentoDocV1 | BentoDocV2): BentoDocV3 {
  const clone = structuredClone(doc);
  return {
    schemaVersion: 3,
    canvas: { width: clone.canvas.width, height: clone.canvas.height },
    background: clone.background,
    elements: clone.elements,
    diagnostics: clone.diagnostics,
  };
}

/** ③ canonical v3 词表校验（迁移产出与直读 v3 字节共用唯一校验点）。 */
function assertCanonicalV3(doc: BentoDocV3): BentoDocV3 {
  assertKnownFields(doc, BENTO_DOC_V3_FIELDS);
  return doc;
}

/** 归一化浮点表示噪声（1-x-w 类运算）：确定性两位口径不受影响，canonical 不带长尾。 */
function normalizeFloat(value: number): number {
  return Number(value.toFixed(10));
}

// ---- ④ v4 迁移（raw migrator 私有：公开入口必须带 ③ 前置与 ⑤ 后置校验） ----

/**
 * 机械无损迁移（不修改输入）：schemaVersion → 4；
 * - text：平铺字段 {text, color, fontSize, fontFamily, bold, italic, align, wrap,
 *   lineHeight} → {text: {paragraphs, color?, …}}（text 按 "\n" 切段，每段单 run；
 *   空串 = 单空 run 段；仅携带已设置字段）；
 * - image：fit {mode} → 平铺 fit 串；crop 归一化 [x,y,w,h] → 四边比例 [l,t,r,b]
 *   （l=x、t=y、r=1-x-w、b=1-y-h；absent 则省略）；
 * - 其余 1:1（v3 元素的 opacity/shadow 已在元素顶层，v4 同位承接）。
 */
function migrateToV4(doc: BentoDocV3): BentoDocV4 {
  const clone = structuredClone(doc);
  return {
    schemaVersion: 4,
    canvas: clone.canvas,
    background: clone.background,
    elements: clone.elements.map(migrateElementToV4),
    diagnostics: clone.diagnostics,
  };
}

function migrateElementToV4(element: BentoElementV2): BentoElementV4 {
  if (element.kind === "text") {
    // 平铺字段重组为结构化 content（仅携带已设置字段）；其余（base/opacity/shadow）原样保留。
    const { text, color, fontSize, fontFamily, bold, italic, align, wrap, lineHeight, ...base } =
      element as BentoElementV2 & Record<string, unknown>;
    const content: Record<string, unknown> = {
      paragraphs: String(text)
        .split("\n")
        .map((para) => ({ runs: [{ text: para }] })),
    };
    if (color !== undefined) content.color = color;
    if (fontSize !== undefined) content.fontSize = fontSize;
    if (fontFamily !== undefined) content.fontFamily = fontFamily;
    if (bold !== undefined) content.bold = bold;
    if (italic !== undefined) content.italic = italic;
    if (align !== undefined) content.align = align;
    if (wrap !== undefined) content.wrap = wrap;
    if (lineHeight !== undefined) content.lineHeight = lineHeight;
    return { ...base, text: content } as unknown as BentoElementV4;
  }
  if (element.kind === "image") {
    const image = element as BentoElementV2 & { fit?: { mode: string }; crop?: [number, number, number, number] };
    const out: Record<string, unknown> = { ...image };
    if (image.fit !== undefined) out.fit = image.fit.mode;
    if (image.crop !== undefined) {
      const [x, y, w, h] = image.crop;
      out.crop = [normalizeFloat(x), normalizeFloat(y), normalizeFloat(1 - x - w), normalizeFloat(1 - y - h)];
    }
    return out as unknown as BentoElementV4;
  }
  // shape/line/icon：opacity/shadow 已在元素顶层（v3 common 词表），1:1 承接。
  return element as unknown as BentoElementV4;
}

/** ⑤ canonical v4 词表校验 + legacy icon aliases 的纯内存规范化。 */
function assertCanonicalV4(doc: BentoDocV4): BentoDocV4 {
  assertKnownFields(doc, BENTO_DOC_V4_FIELDS);
  const canonical = structuredClone(doc);
  for (const element of canonical.elements) {
    if (element.kind === "icon") {
      element.iconName = resolveStaticV1IconMembership(element.iconName).iconName;
    }
  }
  return canonical;
}

/**
 * v4 canonical load 入口（revision store / workspace 唯一 load 入口）：
 * v1/v2/v3 旧字节按钉死顺序显式迁移为 v4；历史 v4 icon 长 alias 仅在
 * 内存中规范化为 fas/far/fab，存量 revision 字节不回写；其余 fail closed。
 * 只做内存形态转换；调用方不得回写存量字节（D1：不静默改写已提交 revision）。
 */
export function loadBentoDocV4(value: unknown): BentoDocV4 {
  const version =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>).schemaVersion
      : undefined;
  if (version === 1 || version === 2) {
    // ① legacy 词表校验 → ② 弃 preset → ③ v3 词表校验 → ④ v4 迁移 → ⑤ v4 词表校验。
    assertKnownFields(value as object, BENTO_DOC_V2_FIELDS);
    return assertCanonicalV4(migrateToV4(assertCanonicalV3(migrateToV3(value as BentoDocV1 | BentoDocV2))));
  }
  if (version === 3) {
    // ③ v3 词表校验 → ④ v4 迁移 → ⑤ v4 词表校验。
    return assertCanonicalV4(migrateToV4(assertCanonicalV3(value as BentoDocV3)));
  }
  if (version === 4) {
    return assertCanonicalV4(value as BentoDocV4);
  }
  throw new UnsupportedSchemaVersionError(version);
}
