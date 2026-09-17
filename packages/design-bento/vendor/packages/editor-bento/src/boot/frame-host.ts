/**
 * Generic frame hook（GD-4c Wave C1 ticket #7 C1-B；docs/gd-4-acceptance.md §2.2
 * bound 2 "generic frame hook"）。Node-safe 纯契约模块：零 DOM、零 vendor import，
 * 因此可拷入 pinned-shell（vendor 树内 slides/src/a1a2/packages/）由 render.ts
 * 分派点消费，也可在 Node 单测（test/frame-host.test.ts）里以 fake renderer 直接测。
 *
 * 挂载模型：projector（packages/editor-bento/src/project.ts）对 matrix
 * adapter/hybrid 行的元素，投影出带投影私有 marker `frameRenderer` 的 native
 * 元素（marker 永不进 canonical）；renderElement 在 native switch 之前 consult
 * 本 registry——已登记 renderer 产出的 DOM 落进 .bento-el frame，inherit 原生
 * 选择/变换/层级生命周期。未登记 marker 是项目侧 bug：registry resolve 返回
 * undefined，vendor render.ts 硬 throw（绝不回落 native 静默近似）。
 *
 * renderers/ 里的具体 renderer 是浏览器侧 DOM 模块（#8-10 逐个入住）；本模块
 * 只持契约与 registry，bootFrameHost() 做项目侧登记（幂等，防双 boot）。
 */

/** 投影进入 frame hook 的 native 元素面（结构合同，替代 vendor SlideElement 类型）。 */
export interface FrameHostElement {
  /** 稳定元素 id（frame data-el-id/selection）。 */
  id: string;
  /** native 元素类型（text/shape/line/image/icon/...）。 */
  type: string;
  /** frame hook marker：元素内容由 adapter renderer 渲染；缺席 = native 处理。 */
  frameRenderer?: string;
  /** post-native 装饰器 marker 列表（C1-C）：vendor renderElement 在 native switch
   *  之后逐项调用已登记 decorator（adapter 行在原生渲染后的重放面）。 */
  frameDecorators?: string[];
  /** renderer 专属负载：projector 把 adapter 语义原样放这（#8-10 各 renderer 挑取）。 */
  [key: string]: unknown;
}

/** 渲染 opts（vendor RenderOpts 的结构投影；thumbnails svgAsImage 等）。 */
export interface FrameHostRenderOptions {
  svgAsImage?: boolean;
  hidePlaceholders?: boolean;
  liveMedia?: boolean;
}

/** renderer 上下文：文档资产表（解析 asset:<sha256> → data URI）+ opts。 */
export interface FrameHostRenderContext {
  /** native 文档的资产表（projector 把引用字节登记进 doc.assets）。 */
  doc: { assets?: Record<string, string> } | null;
  opts: FrameHostRenderOptions;
  /**
   * Optional host-owned math resolver. The pinned shell owns Temml and runs
   * this after sanitization; adapter renderers (notably table cells) use the
   * same callback instead of inventing a second TeX implementation.
   */
  resolveMath?: (html: string) => string;
}

/**
 * 已登记 per-kind adapter renderer：接收投影元素与上下文，产出挂在 frame 内的
 * DOM 节点（HTMLElement/SVG 等）。契约返回 unknown 以保持 Node-safe——DOM 判定
 * （instanceof Node）在 vendor render.ts 分派点进行。
 */
export type FrameHostRenderer = (
  element: FrameHostElement,
  ctx: FrameHostRenderContext,
) => unknown;

/** per-kind 注册表（renderer/decorator 同一 fail-closed 语义）：单一登记点，防双 boot 静默覆盖。 */
export class FrameRegistry<T> {
  private readonly entries = new Map<string, T>();

  /** 登记 kind；重复登记抛错（已验证项不得被静默替换）。 */
  register(kind: string, entry: T): void {
    if (this.entries.has(kind)) {
      throw new Error(`frame entry "${kind}" already registered`);
    }
    this.entries.set(kind, entry);
  }

  /** 未登记 kind → undefined（fail-closed 信号；vendor 分派点据此硬 throw）。 */
  resolve(kind: string): T | undefined {
    return this.entries.get(kind);
  }

  registeredKinds(): readonly string[] {
    return [...this.entries.keys()];
  }
}

/** post-native 装饰器：native（或 frameRenderer）内容渲染后，在 frame 节点上重放 adapter 样式/变换。 */
export type FrameHostDecorator = (
  element: FrameHostElement,
  frameNode: HTMLElement,
  ctx: FrameHostRenderContext,
) => void;

/** 单例注册表：vendor render.ts 分派点与项目侧登记共用的同一实例。 */
export const frameHost = new FrameRegistry<FrameHostRenderer>();

export const frameDecoratorHost = new FrameRegistry<FrameHostDecorator>();

// ---- 项目侧 composition（renderers/ 入住，幂等） ----

import { renderShapeImageFill } from "../renderers/image-fill.ts";
import { renderImagePipeline } from "../renderers/image.ts";
import { renderLineArrow } from "../renderers/line.ts";
import { renderTableGrid } from "../renderers/table.ts";
import { renderChartSvg } from "../renderers/chart.ts";
import { renderTextRichDecorator } from "../renderers/text.ts";
import { renderCropShapeDecorator } from "../renderers/crop-shape.ts";
import { renderFlipDecorator } from "../renderers/transform.ts";

let booted = false;

/**
 * 登记本项目全部 frame renderer/decorator（#8 入住 text/line/crop/flip）。
 * 幂等：重复调用不重复登记（bootFrameHost 二次调用是 no-op，不得抛错）。
 * 由 patch 的 main.ts host wiring 在 ?ws= 路径前调用。
 */
export function bootFrameHost(): void {
  if (booted) return;
  frameHost.register("shape.image-fill", renderShapeImageFill);
  frameHost.register("image.crop-pipeline", renderImagePipeline);
  frameHost.register("line.arrow", renderLineArrow);
  frameHost.register("table.grid", renderTableGrid);
  frameHost.register("chart.svg", renderChartSvg);
  frameDecoratorHost.register("text.rich", renderTextRichDecorator);
  frameDecoratorHost.register("image.crop-shape", renderCropShapeDecorator);
  frameDecoratorHost.register("transform.flip", renderFlipDecorator);
  booted = true;
}
