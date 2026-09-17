/**
 * C2-A edit surface — 缺省元素工厂（GD-4c Wave C2 ticket #12；docs/gd-4-progress.md
 * Wave C2 item 1 "create/delete surface——kernel 已有命令，缺 UI"）。
 *
 * Node-safe 纯模块：defaultElement(kind, id, canvas) 产出 closed-world 合法的
 * v4 缺省元素（createElement 携带完整元素使 delete 的 inverse 永远合法）——
 * 词表面（BENTO_DOC_V4_FIELDS 约束）、kernel createElement 校验、projector
 * 编译（compileTableGrid/compileChart/routeLine/iconMarkup …）三重约束都满足；
 * 任意缺省推送后 reproject 不得抛错（D5 fail-closed）。所有尺寸为确定性常量，
 * 中心定位基于画布（不越出画布必成立当画布 ≥ 缺省尺寸）。
 *
 * image 缺省必须携带 asset 引用（createElement src 白名单
 * "asset:<sha256hex>" | "media/..."）——见 create-delete.ts 的
 * imageCreateElementCommand（DOM 侧文件选择 → registerAsset → 命令）。
 */
import { parseStaticV1IconName, type BentoElementV4, type BentoImageElementV4, type BentoTextContentV4 } from "contracts";

/** 画布尺寸（canonical canvas 字段的结构形态）。 */
export interface CanvasSize {
  width: number;
  height: number;
}

/** 缺省文本内容（text.plain 行 UI 缺省；确定性常量，供面板/测试引用）。 */
export const DEFAULT_TEXT_CONTENT: BentoTextContentV4 = {
  paragraphs: [{ runs: [{ text: "Text" }] }],
};

/** 缺省形状：rect + solid fill（shape.preset/fill.solid 行；native 投影面）。 */
export const DEFAULT_SHAPE_FILL = { type: "solid" as const, color: "#E8442E" };

/** Canonical UI seed is parsed by the same style/name contract as import/kernel/projector. */
const DEFAULT_ICON_NAME = parseStaticV1IconName("fas:star").iconName;

/** 缺省表：2×2 格网，[0.5,0.5] 比例（table.grid 行 sum≈1 约束）。 */
export const DEFAULT_TABLE_GRID = {
  columnWidths: [0.5, 0.5],
  rowHeights: [0.5, 0.5],
};

/** 缺省图：bar 单 series，数据列与 encode 列名一致（chart.data/encode 行）。 */
export const DEFAULT_CHART = {
  data: {
    cols: ["Category", "Series 1"],
    rows: [
      ["A", 4],
      ["B", 6],
      ["C", 5],
    ],
  },
  series: [{ type: "bar" as const, name: "Series 1", encode: { x: "Category", y: "Series 1" } }],
};

type CanvasLike = CanvasSize;

/** 每型缺省尺寸（确定性常量；中心定位基于画布）。 */
const DEFAULT_SIZES: Record<string, { w: number; h: number }> = {
  text: { w: 200, h: 64 },
  shape: { w: 160, h: 120 },
  line: { w: 200, h: 80 },
  image: { w: 300, h: 240 },
  icon: { w: 64, h: 64 },
  table: { w: 320, h: 160 },
  chart: { w: 420, h: 300 },
};

/** 中心定位 bounds：[x, y, w, h]，按当前画布裁剪默认尺寸且保持正值。 */
function centeredBounds(kind: string, canvas: CanvasLike): [number, number, number, number] {
  const defaults = DEFAULT_SIZES[kind] ?? { w: 160, h: 120 };
  const w = Math.min(defaults.w, canvas.width);
  const h = Math.min(defaults.h, canvas.height);
  const x = Math.max(0, Math.round(canvas.width / 2 - w / 2));
  const y = Math.max(0, Math.round(canvas.height / 2 - h / 2));
  return [x, y, w, h];
}

/** 自增 id（DOM 面板创建用；跨调用唯一，前缀可分类）。 */
let sequence = 0;
export function nextElementId(prefix = "el"): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

/**
 * 型缺省元素工厂。image 必须走 create-delete.ts 的 imageCreateElementCommand
 * （携带 asset 引用）；直接 defaultElement("image", …) 以占位引用构造
 * （DOM 侧不会用——文件选择后才建），保证词表校验可过。
 */
export function defaultElement(
  kind: BentoElementV4["kind"],
  id: string,
  canvas: CanvasLike,
): BentoElementV4 {
  const bounds = centeredBounds(kind, canvas);
  const base = { id, kind, bounds, zIndex: 0 };
  switch (kind) {
    case "text":
      return { ...base, kind, text: structuredClone(DEFAULT_TEXT_CONTENT) };
    case "shape":
      return { ...base, kind, shapeName: "rect", fill: { ...DEFAULT_SHAPE_FILL } };
    case "line":
      return {
        ...base,
        kind,
        viewBox: [bounds[2], bounds[3]],
        points: `0,${Math.round(bounds[3] / 2)} ${bounds[2]},${Math.round(bounds[3] / 2)}`,
        border: { style: "solid", width: 2, color: "#1A1D24" },
      };
    case "image":
      // 占位 src（内容寻址形态）；create-delete.ts 用真实 asset 替换。
      return {
        ...base,
        kind,
        src: "asset:0000000000000000000000000000000000000000000000000000000000000000",
        fit: "contain",
      };
    case "icon":
      return { ...base, kind, iconName: DEFAULT_ICON_NAME, fill: { ...DEFAULT_SHAPE_FILL } };
    case "table":
      return {
        ...base,
        kind,
        table: {
          ...DEFAULT_TABLE_GRID,
          rows: [
            [
              { text: structuredClone(DEFAULT_TEXT_CONTENT) },
              { text: structuredClone(DEFAULT_TEXT_CONTENT) },
            ],
            [
              { text: structuredClone(DEFAULT_TEXT_CONTENT) },
              { text: structuredClone(DEFAULT_TEXT_CONTENT) },
            ],
          ],
        },
      };
    case "chart":
      return { ...base, kind, chart: structuredClone(DEFAULT_CHART) };
  }
}

/** image 缺省（DOM：文件选择 → registerAsset → imageCreateElementCommand）。 */
export function defaultImageElement(
  id: string,
  canvas: CanvasLike,
  src: string,
): BentoImageElementV4 {
  return { id, kind: "image", bounds: centeredBounds("image", canvas), zIndex: 0, src, fit: "contain" };
}
