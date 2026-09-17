/**
 * semantic BentoDocV4 → Bento native 文档投影（docs/a1a-2-acceptance.md §3：
 * editor-bento 独占 semantic→native 投影；永不反向回写）。GD-4b B2 类型 ripple；
 * GD-4c Wave C1 ticket #8：各 family 投影逻辑委托给 renderers/* 模块
 * （text/line/fill/icon/crop-shape/transform），project.ts 保持薄分发面。
 *
 * 输出结构对齐 vendor/bento/slides/src/model.ts。返回 unknown：native schema
 * 不是本包合同，调用方（Bento patch 宿主）直接消费 JSON。
 *
 * C1-C 投影边界（D5：新能力要么投影、要么具名拒绝，不静默近似）——按矩阵行
 * implementation 归属逐条内联（细目在 renderers/* 头注）：
 * - text.runs 与 paragraph 行（adapter）：frameDecorators["text.rich"] + richStyles
 *   载荷，decorator 在 native 渲染后重放（matrix renderContract 原文）；列表、
 *   固定像素行距、字距、换行、方向和东亚/西文字体栈也在同一 shared resolver
 *   / decorator 路径闭合；
 *   bold/italic/underline/strikethrough（native）以 b/i/u/s 进 native html；
 *   linear gradient（hybrid "linear 原生"）→ colorGradient；radial → text.rich
 *   装饰器（background-clip CSS 面，同 native 的 clip 机制）；latex 保持 native
 *   HTML seam，并由 host resolveMath 在渲染期物化。
 * - line（hybrid/adapter）：2 点直线+arrow/null → native line（lineedit atan2 框
 *   几何 + vendor marker 词表）；≥3 点 sharp/smooth 无箭头 → native path 编译 d；
 *   round 连接与 stealth/diamond/oval/曲线箭头 → frame 'line.arrow' 自绘
 *   （端点切线多边形/椭圆，尺寸锚定 vendor marker 5.5×sw）。
 * - image.crop/image.pipeline（adapter）：crop → fit → cropShape → frame border
 *   在项目自有 SVG 载具中按固定顺序编译；正值 inset、负值 outset 都由载荷决定。
 *   仅 cropShape 没有 crop/border 时保留既有 image.crop-shape decorator 面。
 * - common.flip（adapter frame 层）：flip 字段 + frameDecorators["transform.flip"]，
 *   decorator 在 applyElementFrame 后追加 scale(±1,±1)（spike 裁决）。
 * - common.group（hybrid，渲染无差异）：groupId 直投 native groupId 字段。
 * - fill.gradientRadial（hybrid svg 载具 C5）：shape 宿主 → svg 载具 markup
 *   （native svg 元素渲染）；icon 宿主 → 真实 FA path 内嵌 defs。
 * - fill.image（adapter C26/#23）：canvas/shape/table/cell/chart 共用
 *   image.ts 的 intrinsic-aware crop→fit placement，经 image-fill.ts 薄宿主适配；
 *   icon 不在 fill.image 行宿主表 → 保持具名拒绝。
 * - custom path（shape.customPath，hybrid）：native path 投影（pathBox+d），
 *   弧规范化由 import 期完成（裁决 C7）。
 * - table（12 行 hole：C9 冻结裁决 group model + 真合并渲染，native 无
 *   rowSpan/colSpan/rowHeights）：整个 table 元素 → frameRenderer 'table.grid'
 *   + renderers/table.ts 编译 payload（稀疏落位/槽位解析/富文本/边框/fill 全在
 *   投影期，DOM 侧只装配；hybrid 行 native 子集以输入兼容层复现，uniform adapter
 *   路径，两路 DOM 源不共存）。
 *
 * 投影假设逐条内联注释（ponytail: 显示层有损处都标注）：
 * 1. align 二元组 [h, v] → align/valign；justify/distributed → native CSS justify，
 *    distributed 的语义另存 textLayout 并由 decorator 设置 text-align-last，canonical
 *    不丢且不降级为 left。
 * 2. text 省略值由 contracts/static-v1 的共享 resolver 派生为 18px / MiSans /
 *    #000000 / lineHeight 1，不写回 canonical；fontFamily {latin, ea} 经 shared
 *    resolver 拼为有序 CSS fallback stack。run 级富样式/段落级覆盖投影为 richStyles
 *    载荷（C1-C），显示由 decorator 重放；latex run 保持 native `$...$` seam，host
 *    resolveMath 负责 render/export 期解析。
 * 3. linear gradient angle 做 PPTD→CSS +90° 换算（pptdAngleToCss：先归一化到
 *    [0,360) 再 (angle+90)%360；PPTD 0=左→右顺时针 vs CSS 0=底→顶，spike fill E1
 *    实测）。旧假设“两惯例同向、角度直传”已由 GD-4 #6 回归测试钉死为错误。
 * 4. roundRect radius = adjustments[0]/100000*min(w,h)（PPTD 调整值惯例，万分比）。
 * 5. line 元素路由见 renderers/line.ts（2 点直线=过点精确的 atan2 盒；native line
 *    有 2px strokeWidth 下限，属 vendor 渲染面，matrix line.points 行已冻结）。
 * 6. icon → 项目自有、官方 Font Awesome Free 7.3.1 离线货架的真实 SVG path
 *    （fas/far/fab + aliases；缺 style/name fail-closed），glyph 填充支持
 *    solid/linear/radial defs。
 * 7. text/shape/line 的 shadow/border 按各自宿主投影；text shadow 直投 native
 *    frame，shape/line 走既有面，image/icon 走项目自有载具。
 *    （shape 走 stroke/strokeWidth；line 的颜色落 fill 字段——vendor render.ts
 *    line 分支从 el.fill 取色；line 的 border.style dash/dot → strokeStyle 词表
 *    dashed/dotted）；image/icon border 与外框 opacity/shadow 由 frame 保留。
 * 8. doc.fonts（font.registration 行）投影为 native fonts[] + font 资产 data URI
 *    （vendor boot injectFonts → @font-face，family 在显示/测量层命中）。
 * 9. image.crop 四边显示面已在 image.crop-pipeline SVG 载具中闭合；asset 仅从
 *    native doc.assets 的 data URI 解析，生产显示/导出不触网。
 */

import type {
  BentoBounds,
  BentoColorStop,
  BentoDocV4,
  BentoElementV4,
  BentoFillV4,
  BentoShadow,
  BentoImageElementV4,
  BentoLineElementV4,
  BentoShapeElementV4,
  BentoTableElementV4,
  BentoTextElementV4,
  BentoChartElementV4,
} from "contracts";
import {
  bentoChartRenderInvariantError,
  STATIC_V1_TEXT_DEFAULTS,
  resolveStaticV1Icon,
  sniffStaticV1FontMime,
  staticV1FontRegistrationFamilyError,
  staticV1FontPlan,
  staticV1ProjectedFontFaces,
  staticV1UnregisteredFontFamilies,
} from "contracts";
import type { StaticV1FontAliasMap } from "contracts";
import {
  gradientId,
  linearDefsMarkup,
  pptdAngleToCss,
  radialDefsMarkup,
  shapeCarrierMarkup,
} from "./renderers/fill.ts";
import { iconMarkup } from "./renderers/icon.ts";
import { STATIC_V1_ICON_SHELF } from "./icon-shelf.ts";
import { compileImagePipeline, imageIntrinsicSize } from "./renderers/image.ts";
import {
  nativeTextHtml,
  nativeShadow,
  needsRichDecorator,
  assertStaticV1TextLatex,
  normalizedTextParagraphPlan,
  resolveTextLayout,
  richStylesFor,
} from "./renderers/text.ts";
import { routeLine } from "./renderers/line.ts";
import { assertStaticV1CropShapeGeometry } from "./renderers/crop-shape.ts";
import { compileTableGrid } from "./renderers/table.ts";
import { compileChart, type ChartLike } from "./renderers/chart.ts";
import { compileStaticV1ShapeGeometry } from "./renderers/geometry.ts";
import { compileImageFillV4, imageFillBackgroundCss } from "./renderers/image-fill.ts";
export interface ProjectOptions {
  /** semantic 资产引用（"asset:<sha256>" 或 "media/..."）→ data: URI。 */
  resolveAsset: (ref: string) => string;
  /** 文档标题，缺省 "Design document"。 */
  title?: string;
}

/** 内容寻址 key：剥离 "asset:" 前缀（与 editor-bento/assets.ts 的浏览器/Node 两侧
 *  同一 key 约定；非 asset: 引用（如 "media/..."）原样保留）。 */
const assetKeyOf = (ref: string): string =>
  ref.startsWith("asset:") ? ref.slice("asset:".length) : ref;

function assertStaticV1FontDataUri(dataUri: string, family: string): void {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUri);
  if (match === null) {
    const error = new Error(`PPTD-E013: font ${JSON.stringify(family)} did not resolve to a base64 data URI`);
    error.name = "PPTD-E013";
    throw error;
  }
  try {
    const binary = atob(match[2]!);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const actual = sniffStaticV1FontMime(bytes);
    if (actual === null || match[1] !== actual) throw new Error("font MIME/bytes mismatch");
  } catch {
    const error = new Error(`PPTD-E013: font ${JSON.stringify(family)} resolved to invalid or mismatched static-v1 bytes`);
    error.name = "PPTD-E013";
    throw error;
  }
}

/** Bento native shadow shape is {blur,color,x,y}; canonical stores offset tuple. */
function shadowToNative(shadow: BentoShadow | BentoShadow[] | undefined): object {
  if (shadow === undefined) return {};
  const map = (layer: BentoShadow) => ({
    blur: layer.blur,
    color: layer.color,
    x: layer.offset?.[0] ?? 0,
    y: layer.offset?.[1] ?? 0,
  });
  return { shadow: Array.isArray(shadow) ? shadow.map(map) : map(shadow) };
}

function fillToCss(fill: { type: "solid"; color: string } | { type: "gradient"; gradientType: "linear"; angle?: number; stops: BentoColorStop[] }): {
  fill: string;
  fillGradient?: object;
} {
  if (fill.type === "solid") return { fill: fill.color };
  const stops = (fill.stops as BentoColorStop[]).map((stop) => ({
    at: stop.position,
    color: stop.color,
  }));
  return { fill: fill.stops[0]?.color ?? "#FFFFFF", fillGradient: { angle: pptdAngleToCss(fill.angle ?? 90), stops } };
}

function backgroundToCss(
  background: BentoFillV4,
  resolveAsset: (ref: string) => string,
  canvas: readonly [number, number],
): string {
  if (background.type === "solid") return background.color;
  if (background.type === "image") {
    // C26/#23：background 仍走实测可行的 CSS 串载具，但图片先由全 host
    // 共用 compiler 固化 crop→fit→opacity，再内联 SVG data URI。
    const dataUri = resolveAsset(background.src);
    const compiled = compileImageFillV4(background, {
      width: canvas[0],
      height: canvas[1],
      source: imageIntrinsicSize(dataUri),
    });
    return imageFillBackgroundCss(compiled, dataUri);
  }
  const stops = background.stops.map((stop) => `${stop.color} ${stop.position * 100}%`).join(", ");
  if (background.gradientType === "radial") {
    // C26/C5：background 宿主候选 radial-gradient() CSS 串。
    return `radial-gradient(circle, ${stops})`;
  }
  return `linear-gradient(${pptdAngleToCss(background.angle ?? 90)}deg, ${stops})`;
}

function projectText(element: BentoTextElementV4, geometry: object, fontAliases: StaticV1FontAliasMap): object {
  const content = element.text;
  assertStaticV1TextLatex(content.paragraphs, `element ${element.id}.text`);
  const layout = resolveTextLayout(content, fontAliases);
  const paragraphPlan = normalizedTextParagraphPlan(content.paragraphs);
  // 段落结构保真（text.paragraphs 行）；run 级 native 样式（b/i/u/s）进 html，
  // 其余 adapter 样式走 richStyles 装饰器载荷（头注 C1-C 分工）。
  const html = nativeTextHtml(content.paragraphs, paragraphPlan);
  const base = {
    id: element.id,
    type: "text",
    ...geometry,
    html,
    fontSize: layout.fontSize,
    fontFamily: layout.fontFamily,
    fontWeight: layout.bold === true ? 700 : 400,
    color: layout.color,
    // Native Bento accepts these CSS values at runtime. `distributed` is
    // normalized only to its CSS equivalent; the canonical value is retained
    // in textLayout and the decorator re-applies text-align-last.
    align: layout.align === "distributed" ? "justify" : layout.align,
    valign: layout.valign,
    lineHeight: layout.lineHeight,
    textLayout: layout,
    ...(element.shadow !== undefined ? { shadow: nativeShadow(element.shadow) } : {}),
  };
  const gradient = content.gradient;
  if (needsRichDecorator(content)) {
    // adapter 行（runs 与 paragraph/radial/backgroundColor 各字段）：decorator 载荷。
    return {
      ...base,
      frameDecorators: ["text.rich"],
      richStyles: richStylesFor(content.paragraphs, fontAliases),
      paragraphPlan,
      ...(gradient !== undefined ? { gradient } : {}),
      ...(content.backgroundColor !== undefined ? { elementBackground: content.backgroundColor } : {}),
    };
  }
  if (gradient?.gradientType === "linear") {
    // text.gradient 行 "linear 原生"：colorGradient 直投（角度仍是 PPTD→CSS）。
    return {
      ...base,
      colorGradient: {
        angle: pptdAngleToCss(gradient.angle ?? 90),
        stops: gradient.stops.map((stop) => ({ at: stop.position, color: stop.color })),
      },
    };
  }
  return base;
}

function projectShape(
  element: BentoShapeElementV4,
  geometry: object,
  opts: ProjectOptions,
  nativeAssets: Record<string, string>,
): object {
  const compiledGeometry = compileStaticV1ShapeGeometry({
    shapeName: element.shapeName,
    ...(element.adjustments !== undefined ? { adjustments: element.adjustments } : {}),
    ...(element.viewBox !== undefined ? { viewBox: element.viewBox } : {}),
    ...(element.path !== undefined ? { path: element.path } : {}),
    bounds: [element.bounds[2], element.bounds[3]],
    id: element.id,
  });
  const border = element.border;
  const base = {
    id: element.id,
    type: "shape",
    ...geometry,
    stroke: border?.color ?? "none",
    strokeWidth: border?.width ?? 0,
  };
  // fill.image → frame hook 'shape.image-fill'（fill.image 行 shape 宿主，C26）：
  // 内容由 renderers/image-fill.ts 在 .bento-el frame 内以共享 SVG compiler
  // 渲染（crop→fit→opacity + 全 static-v1 geometry + border）。
  if (element.fill?.type === "image") {
    const dataUri = opts.resolveAsset(element.fill.src);
    const key = assetKeyOf(element.fill.src);
    nativeAssets[key] = dataUri;
    const imageFill = compileImageFillV4(
      { ...element.fill, src: `asset:${key}` },
      {
        width: element.bounds[2],
        height: element.bounds[3],
        source: imageIntrinsicSize(dataUri),
      },
      {
        clip: compiledGeometry.body,
        clipId: gradientId("image-fill", element.id),
        ...(border !== undefined ? { border: { color: border.color ?? "#000000", width: border.width ?? 1, style: border.style ?? "solid" } } : {}),
      },
    );
    return {
      ...base,
      fill: "transparent",
      ...compiledGeometry.native,
      // 投影私有 frame hook marker（永不进 canonical；render.ts 分派点 + frame-host
      // 注册表消费）。
      frameRenderer: "shape.image-fill",
      imageFill,
    };
  }
  // fill.gradientRadial（hybrid svg 载具，C5）：shape 宿主 → native svg 载具。
  if (element.fill?.type === "gradient" && element.fill.gradientType === "radial") {
    const id = gradientId("bg", element.id);
    const stops = (element.fill.stops as BentoColorStop[]).map((stop) => ({
      position: stop.position,
      color: stop.color,
    }));
    return {
      id: element.id,
      type: "svg",
      ...geometry,
      markup: shapeCarrierMarkup({
        id,
        defs: radialDefsMarkup(id, stops),
        body: compiledGeometry.body,
        ...(border ? { border } : {}),
        viewBox: [element.bounds[2], element.bounds[3]],
      }),
    };
  }
  return {
    ...base,
    ...(element.fill !== undefined ? fillToCss(element.fill as Parameters<typeof fillToCss>[0]) : { fill: "none" }),
    ...compiledGeometry.native,
  };
}

function projectLine(element: BentoLineElementV4, geometry: object): object {
  const route = routeLine(element);
  if (route.route === "native") {
    // matrix line.points/arrow 行：2 点直线 + arrow/null → native line + marker；
    // 过点精确的 atan2 盒（box 内 segment 端点 = viewBox 点列缩放进 bounds）。
    return {
      id: element.id,
      type: "shape",
      shape: "line",
      ...geometry,
      x: route.box.x,
      y: route.box.y,
      w: route.box.w,
      h: route.box.h,
      rotation: route.box.rotation,
      // 颜色落在 vendor 消费点：render.ts line 分支读 el.fill 取色（该分支提前
      // return，尾部通用 stroke 块对 line 不可达，stroke 是死字段）。
      fill: route.color,
      strokeWidth: route.width,
      radius: 0,
      lineStart: route.lineStart,
      lineEnd: route.lineEnd,
      ...(route.dashStyle !== undefined ? { strokeStyle: route.dashStyle } : {}),
    };
  }
  if (route.route === "path") {
    // matrix line.points/curve 行：项目编译 d，native path renderer 画。
    return {
      id: element.id,
      type: "shape",
      ...geometry,
      shape: "path",
      d: route.d,
      pathBox: [0, 0, element.viewBox[0], element.viewBox[1]],
      fill: "none",
      stroke: route.color,
      strokeWidth: route.width,
      radius: 0,
      ...(route.dashStyle !== undefined ? { strokeStyle: route.dashStyle } : {}),
    };
  }
  // round 连接 / 非原生箭头词表 / 曲线箭头 → frame 渲染器自绘（line.arrow）。
  return {
    id: element.id,
    type: "shape",
    ...geometry,
    shape: "path",
    radius: 0,
    frameRenderer: "line.arrow",
    lineCompiled: route.compiled,
  };
}

function projectIcon(element: BentoElementV4 & { kind: "icon" }, geometry: object): object {
  const resolved = resolveStaticV1Icon(element.iconName, STATIC_V1_ICON_SHELF);
  const iconName = resolved.iconName;
  const glyph = resolved.glyph;
  const frame = {
    width: (geometry as { w: number }).w,
    height: (geometry as { h: number }).h,
  };
  const fill = element.fill;
  if (fill?.type === "image") {
    // fill.image 行宿主表 = Page.background/Shape/Table/Cell/Chart——icon 不在
    // 宿主表，image fill 无 canonical 落点语义 → 具名拒绝（不擅自扩张宿主表）。
    throw new Error(
      `element ${element.id}: icon image-fill 投影拒绝（fill.image 行宿主表 Page.background/Shape/Table/Cell/Chart，icon 不在宿主表）`,
    );
  }
  let markup: string;
  if (fill === undefined || fill.type === "solid") {
    const color = fill?.type === "solid" ? fill.color : STATIC_V1_TEXT_DEFAULTS.color;
    markup = iconMarkup({
      iconName,
      glyph: { width: glyph.width, height: glyph.height, path: glyph.path, color },
      frame,
      ...(element.border !== undefined ? { border: element.border } : {}),
    });
  } else {
    // icon 宿主 gradient（fill.gradientLinear/gradientRadial）：真实 FA path
    // 内嵌 defs，glyph 填充 url(#id)。
    const id = gradientId("icon-grad", element.id);
    const stops = (fill.stops as BentoColorStop[]).map((stop) => ({ position: stop.position, color: stop.color }));
    const defs = fill.gradientType === "linear"
      ? linearDefsMarkup(id, pptdAngleToCss(fill.angle ?? 90), stops)
      : radialDefsMarkup(id, stops);
    markup = iconMarkup({
      iconName,
      glyph: { width: glyph.width, height: glyph.height, path: glyph.path, ref: id },
      frame,
      defs,
      ...(element.border !== undefined ? { border: element.border } : {}),
    });
  }
  return { id: element.id, type: "svg", ...geometry, markup };
}

function projectImage(
  element: BentoImageElementV4,
  geometry: object,
  opts: ProjectOptions,
  nativeAssets: Record<string, string>,
): object {
  const cropShape = element.cropShape;
  if (cropShape !== undefined) assertStaticV1CropShapeGeometry(cropShape);
  const dataUri = opts.resolveAsset(element.src);
  const key = assetKeyOf(element.src);
  nativeAssets[key] = dataUri;
  // crop and image border share one project-owned SVG carrier. cropShape alone
  // retains the established post-native clip decorator for compatibility; as
  // soon as crop or border is present the entire ordered pipeline is atomic.
  if (element.crop !== undefined || element.border !== undefined) {
    const compiled = compileImagePipeline({
      src: `asset:${key}`,
      width: element.bounds[2],
      height: element.bounds[3],
      source: imageIntrinsicSize(dataUri),
      fit: element.fit ?? "contain",
      ...(element.crop !== undefined ? { crop: element.crop } : {}),
      ...(cropShape !== undefined ? { cropShape } : {}),
      ...(element.border !== undefined ? { border: element.border } : {}),
    });
    return {
      id: element.id,
      type: "image",
      ...geometry,
      frameRenderer: "image.crop-pipeline",
      imagePipeline: compiled,
    };
  }
  return {
    id: element.id,
    type: "image",
    ...geometry,
    src: `asset:${key}`,
    // v4 fit 三词表（fill/contain/cover，image.fit 行）直传 native object-fit。
    fit: element.fit ?? "contain",
    radius: 0,
    // image.cropShape（adapter，C8 后 svg clip-path 载具）：native img 渲染面
    // 不动，decorator 在 frame 上挂 clipPath。
    ...(cropShape !== undefined
      ? { frameDecorators: ["image.crop-shape"], cropShape: { shapeName: cropShape.shapeName, ...(cropShape.adjustments ? { adjustments: [...cropShape.adjustments] } : {}), ...(cropShape.viewBox ? { viewBox: [...cropShape.viewBox] } : {}), ...(cropShape.path ? { path: cropShape.path } : {}) } }
      : {}),
    // crop/border absent means the native image path remains the minimal shape;
    // the full crop carrier is selected above whenever either field is present.
  };
}

function projectTable(
  element: BentoTableElementV4,
  geometry: { x: number; y: number; w: number; h: number; rotation: number; opacity: number },
  opts: ProjectOptions,
  nativeAssets: Record<string, string>,
  fontAliases: StaticV1FontAliasMap,
): object {
  // matrix table.* 12 行：C9 冻结裁决 ⇒ 整表 adapter frame（renderTableGrid 在
  // .bento-el frame 内渲染真实 <table>；native 只拥有 frame/transform/export）。
  // 编译全在投影期（renderers/table.ts），DOM 侧只装配 payload；image fill 资产
  // 登记进 native doc.assets，renderer 经 assetSrcLocal 解析。
  const compiled = compileTableGrid({
    table: element.table,
    width: geometry.w,
    height: geometry.h,
    ...(element.border !== undefined ? { elementBorder: element.border } : {}),
    ...(element.fill !== undefined ? { elementFill: element.fill } : {}),
    resolveAsset: opts.resolveAsset,
    fontAliases,
  });
  for (const [key, dataUri] of Object.entries(compiled.assets)) nativeAssets[key] = dataUri;
  return {
    id: element.id,
    type: "table",
    ...geometry,
    frameRenderer: "table.grid",
    tableGrid: compiled.grid,
    // 投影私有（永不进 canonical）：native 表模型安全面——整表由 adapter 格网
    // 渲染（C9），留给表的 native 面（updateTableHandles 列拖拽 + panels.ts
    // buildTableProps 行列 stepper/Preset 等行）没有 adapter 语义。三字段全零/
    // 空值让 vendor 在选择时不再抛 “undefined.length”（Test 4 实测崩溃点，
    // 异常从 selection emit 冒泡会杀死 selecto 后续点选）；这些 native 控件对
    // 投影副本的变更会在下一次 kernel refresh（replaceViewDoc）被覆盖——零
    // canonical/persistence 逃逸（save 只读 kernel.snapshot()）。列宽/行列步进
    // 的 VisualCommand 桥接注册在 matrix table.grid 行“需桥接”项。
    columns: [],
    rows: [],
    style: {},
  };
}

function projectChart(
  element: BentoChartElementV4,
  geometry: { x: number; y: number; w: number; h: number },
  opts: ProjectOptions,
  nativeAssets: Record<string, string>,
  fontAliases: StaticV1FontAliasMap,
): object {
  // matrix chart.* 27 行（13 逐型 + data/encode/typeMixing/seriesDefaults/palette/
  // axis*/title/legend/dataLabels/barLayout/spokeAxis）：C10/C20/C21 冻结裁决 ⇒
  // 整图 adapter——renderers/chart.ts compileChart 在投影期编译 deterministic
  // inline SVG（13 型全集，无静默忽略），DOM 侧 renderChartSvg 只装配；native
  // 只拥有 frame/selection/transform/export 生命周期，两路 DOM 源绝不共存。
  // Keep the projector on the same renderer-facing seam as the command kernel:
  // a malformed chart must be rejected before compileChart can throw after a
  // canonical command has already been accepted.
  const invariantError = bentoChartRenderInvariantError(element.chart, { width: geometry.w, height: geometry.h });
  if (invariantError !== null) {
    const error = new Error(`PPTD-E014: chart render invariant failed: ${invariantError}`);
    error.name = "PPTD-E014";
    throw error;
  }
  const compiled = compileChart({
    // chart fill lives in the nested chart payload; common.border lives on the
    // element base and must be carried into the same adapter-owned frame.
    chart: {
      ...(element.chart as unknown as ChartLike),
      ...(element.border !== undefined ? { border: element.border } : {}),
    },
    width: geometry.w,
    height: geometry.h,
    elementId: element.id,
    resolveAsset: opts.resolveAsset,
    fontAliases,
  });
  for (const [key, dataUri] of Object.entries(compiled.assets)) nativeAssets[key] = dataUri;
  return {
    id: element.id,
    type: "chart",
    ...geometry,
    frameRenderer: "chart.svg",
    chartCompiled: compiled.compiled,
    // 投影私有（永不进 canonical）：native chart 模型安全面——整图由 adapter
    // 编译渲染（C10/C20/C21），vendor panels.ts buildChartProps 读 el.option/
    // el.preset 建 native 系列/数据网格；缺失会让选择时抛错（Test 4 实测，同
    // table 崩溃点）。option={} / preset 缺省让面板重建安全；其上的 native 控件
    // 对投影副本的变更被下一次 kernel refresh 覆盖——零 canonical 逃逸。
    // chart.* 行的编辑以命令面（setChartData/setChartSeries/setChartOption/
    // setChartPalette）经 c2a 面板承接，此项不掩盖任何已注册编辑权。
    option: {},
    preset: "bar",
  };
}

export function projectToBentoNative(doc: BentoDocV4, opts: ProjectOptions): unknown {
  const nativeAssets: Record<string, string> = {};
  const registeredFamilies = doc.fonts?.map((font) => font.family) ?? [];
  for (const font of doc.fonts ?? []) {
    const error = staticV1FontRegistrationFamilyError(font.family);
    if (error !== null) {
      const cause = new Error(`PPTD-E013: invalid font registration family ${JSON.stringify(font.family)}: ${error}`);
      cause.name = "PPTD-E013";
      throw cause;
    }
  }
  const missingFamilies = staticV1UnregisteredFontFamilies(doc.elements, registeredFamilies);
  if (missingFamilies.length > 0) {
    const error = new Error(`PPTD-E012: unregistered font family ${JSON.stringify(missingFamilies[0])}`);
    error.name = "PPTD-E012";
    throw error;
  }
  const projectedFontFaces = staticV1ProjectedFontFaces(doc.elements, doc.fonts ?? []);
  const fontAliases = staticV1FontPlan(doc.elements, registeredFamilies).aliases;
  // font.registration 行：doc.fonts 投影为 native fonts[]（family/asset/weight/style），
  // 字体字节经 resolveAsset 进 assets 表——vendor boot editorMode 的 injectFonts 直接
  // 消费同表生成 @font-face（REPORT.md §3.9：不投影 = 登记 family 只回落不命中）。
  // C6 object family is a registration contract, not a presentation-only CSS
  // stack: emit one face per script role with disjoint unicode-range slices.
  const nativeFonts = projectedFontFaces.map((font) => {
    let dataUri: string;
    try {
      dataUri = opts.resolveAsset(font.sourceRef);
    } catch {
      const error = new Error(`PPTD-E012: registered font source is missing for ${JSON.stringify(font.sourceFamily)}`);
      error.name = "PPTD-E012";
      throw error;
    }
    assertStaticV1FontDataUri(dataUri, font.sourceFamily);
    const key = assetKeyOf(font.sourceRef);
    nativeAssets[key] = dataUri;
    return {
      family: font.family,
      asset: key,
      ...(font.weight !== undefined ? { weight: font.weight } : {}),
      ...(font.style !== undefined ? { style: font.style } : {}),
      ...(font.unicodeRange !== undefined ? { unicodeRange: font.unicodeRange } : {}),
    };
  });
  const nativeElements = doc.elements.map((element) => {
    const [x, y, w, h] = element.bounds as BentoBounds;
    const frameGeometry = {
      x,
      y,
      w,
      h,
      rotation: element.rotation ?? 0,
      opacity: element.opacity ?? 1,
      // common.flip（adapter frame 层）：decorator 消费；common.group（hybrid）：
      // 保留 native editor 的 groupId，并同步其 presentation-facing group
      // marker so the real render frame exposes data-group="grp-*". The
      // canonical source remains groupId; group is projection-only.
      ...(element.flip !== undefined ? { flip: element.flip } : {}),
      ...(element.groupId !== undefined ? { group: element.groupId } : {}),
      ...(element.groupId !== undefined ? { groupId: element.groupId } : {}),
    };
    // #21 owns the text-specific resolver/measurement merge. Every other
    // common.shadow host shares this one frame projection now; native Bento
    // applies the resulting drop-shadow after the host renderer has assembled
    // its shape/image/table/chart content.
    const geometry = element.kind === "text"
      ? frameGeometry
      : { ...frameGeometry, ...shadowToNative(element.shadow) };
    const projected: Record<string, unknown> = ((): Record<string, unknown> => {
      switch (element.kind) {
        case "text":
          return projectText(element, geometry, fontAliases) as Record<string, unknown>;
        case "shape":
          return projectShape(element, geometry, opts, nativeAssets) as Record<string, unknown>;
        case "line":
          return projectLine(element, geometry) as Record<string, unknown>;
        case "icon":
          return projectIcon(element, geometry) as Record<string, unknown>;
        case "image":
          return projectImage(element, geometry, opts, nativeAssets) as Record<string, unknown>;
        case "table":
          return projectTable(element, geometry, opts, nativeAssets, fontAliases) as Record<string, unknown>;
        case "chart":
          return projectChart(element, geometry as { x: number; y: number; w: number; h: number }, opts, nativeAssets, fontAliases) as Record<string, unknown>;
        default:
          return {} as Record<string, unknown>;
      }
    })();
    // transform.flip 装饰器最后追加（内容面装饰器在前，顺序确定）。
    if (element.flip !== undefined && (element.flip[0] || element.flip[1])) {
      projected.frameDecorators = [...(projected.frameDecorators as string[] | undefined ?? []), "transform.flip"];
    }
    return projected;
  });

  return {
    format: "bento/slides",
    version: 1,
    // GD-2b：通用 document 身份（preset/module 许可命名已删除）。
    docId: "design-document",
    title: opts.title ?? "Design document",
    size: { width: doc.canvas.width, height: doc.canvas.height },
    theme: {
      background: "#FFFFFF",
      color: STATIC_V1_TEXT_DEFAULTS.color,
      accent: "#E8442E",
      fontFamily: STATIC_V1_TEXT_DEFAULTS.fontFamily,
    },
    slides: [
      {
        id: "a1a2-s1",
        background: backgroundToCss(doc.background, opts.resolveAsset, [doc.canvas.width, doc.canvas.height]),
        transition: "none",
        notes: "",
        elements: nativeElements,
      },
    ],
    ...(nativeFonts.length > 0 ? { fonts: nativeFonts } : {}),
    ...(Object.keys(nativeAssets).length > 0 ? { assets: nativeAssets } : {}),
  };
}
