/** Shared fill.image compiler/renderer for every frozen host. The #22
 * intrinsic-aware compileImagePlacement module is the sole crop→fit math source;
 * this file owns only ImageFill's cover/opacity defaults and host DOM adaptation. */

import type { FrameHostElement, FrameHostRenderContext } from "../boot/frame-host.ts";
import { escapeHtml, fmt } from "./fill.ts";
import { staticV1GeometryMarkup, type StaticV1GeometryBody } from "./geometry.ts";
import {
  compileImagePlacement,
  type ImagePlacementCompiled,
  type ImageSourceSize,
} from "./image.ts";

export type ImageFillFitV4 = "fill" | "contain" | "cover";
export interface ImageFillLikeV4 {
  src: string;
  fit?: ImageFillFitV4 | string;
  crop?: readonly number[];
  opacity?: number;
}

export interface ImageFillFrameV4 {
  width: number;
  height: number;
  source: ImageSourceSize;
}

export interface CompiledImageFillV4 extends ImagePlacementCompiled {
  src: string;
  opacity: number;
  viewBox: readonly [number, number];
  clip?: StaticV1GeometryBody;
  clipId?: string;
  border?: { color: string; width: number; style: "solid" | "dash" | "dot" };
}

/** PPTD ImageFill's single static-v1 default set; all hosts call this compiler. */
export const STATIC_V1_IMAGE_FILL_DEFAULTS = Object.freeze({
  fit: "cover" as const,
  crop: [0, 0, 0, 0] as const,
  opacity: 1,
});

export function compileImageFillV4(
  fill: ImageFillLikeV4,
  frame: ImageFillFrameV4,
  options: { clip?: StaticV1GeometryBody; clipId?: string; border?: { color: string; width: number; style: "solid" | "dash" | "dot" } } = {},
): CompiledImageFillV4 {
  if (typeof fill.src !== "string" || fill.src.length === 0) throw new Error("image fill src must be non-empty");
  const fit = fill.fit ?? STATIC_V1_IMAGE_FILL_DEFAULTS.fit;
  const opacity = fill.opacity ?? STATIC_V1_IMAGE_FILL_DEFAULTS.opacity;
  if (!(Number.isFinite(opacity) && opacity >= 0 && opacity <= 1)) {
    throw new Error("image fill opacity must be a finite number in [0,1]");
  }
  if (options.clip !== undefined && (typeof options.clipId !== "string" || options.clipId.length === 0)) {
    throw new Error("image fill clipped geometry requires a unique clipId");
  }
  const placement = compileImagePlacement({
    width: frame.width,
    height: frame.height,
    source: frame.source,
    fit: fit as ImageFillFitV4,
    crop: fill.crop ?? STATIC_V1_IMAGE_FILL_DEFAULTS.crop,
  });
  return {
    src: fill.src,
    opacity,
    viewBox: [frame.width, frame.height],
    ...placement,
    ...(options.clip !== undefined ? { clip: options.clip } : {}),
    ...(options.clipId !== undefined ? { clipId: options.clipId } : {}),
    ...(options.border !== undefined ? { border: options.border } : {}),
  };
}

/** native 形状面（projector 投影的 rect/ellipse + radius）。 */
interface ShapeFrameElement extends FrameHostElement {
  imageFill?: CompiledImageFillV4;
}

/** asset:<sha256> → data URI（vendor assetSrc 的本地最小投影；stripRemoteRefs
 *  在 renderElement 分派点兜底剥离远端引用，离线台账同原生路径）。 */
function assetSrcLocal(doc: { assets?: Record<string, string> } | null, ref: string): string {
  if (!doc?.assets || !ref.startsWith("asset:")) return "";
  return doc.assets[ref.slice("asset:".length)] ?? "";
}

function imageBorderAttributes(border: NonNullable<CompiledImageFillV4["border"]>): string {
  const parts = [
    'fill="none"',
    `stroke="${escapeHtml(border.color)}"`,
    `stroke-width="${fmt(border.width)}"`,
  ];
  if (border.style === "dash") parts.push(`stroke-dasharray="${fmt(border.width * 4)} ${fmt(border.width * 2)}"`);
  if (border.style === "dot") {
    parts.push(`stroke-dasharray="${fmt(border.width)} ${fmt(border.width * 2)}"`, 'stroke-linecap="round"');
  }
  parts.push('vector-effect="non-scaling-stroke"');
  return parts.join(" ");
}

export function imageFillSvgMarkup(fill: CompiledImageFillV4, resolvedSrc: string): string {
  const [vw, vh] = fill.viewBox;
  const { x, y, width: w, height: h } = fill.image;
  const clipId = fill.clipId;
  const clip = fill.clip === undefined
    ? ""
    : `<defs><clipPath id="${escapeHtml(clipId!)}">${staticV1GeometryMarkup(fill.clip)}</clipPath></defs>`;
  const clipAttr = fill.clip === undefined ? "" : ` clip-path="url(#${escapeHtml(clipId!)})"`;
  const image = `<image href="${escapeHtml(resolvedSrc)}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" preserveAspectRatio="none" opacity="${fmt(fill.opacity)}"${clipAttr}/>`;
  const border = fill.clip === undefined || fill.border === undefined || !(fill.border.width > 0)
    ? ""
    : staticV1GeometryMarkup(
      fill.clip,
      imageBorderAttributes(fill.border),
    );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(vw)} ${fmt(vh)}" preserveAspectRatio="none" width="100%" height="100%">${clip}${image}${border}</svg>`;
}

export function imageFillBackgroundCss(fill: CompiledImageFillV4, resolvedSrc: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(imageFillSvgMarkup(fill, resolvedSrc))}") center / 100% 100% no-repeat`;
}

export function renderImageFillLayer(fill: CompiledImageFillV4, ctx: FrameHostRenderContext): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;";
  const resolved = assetSrcLocal(ctx.doc, fill.src);
  if (!resolved) throw new Error(`image fill asset is not available offline: ${fill.src}`);
  wrap.innerHTML = imageFillSvgMarkup(fill, resolved);
  return wrap;
}

export function renderShapeImageFill(element: FrameHostElement, ctx: FrameHostRenderContext): HTMLElement {
  const shape = element as ShapeFrameElement;
  const fill = shape.imageFill;
  if (!fill?.src) {
    throw new Error("shape.image-fill requires an imageFill.src payload from the projector");
  }

  const wrap = renderImageFillLayer(fill, ctx);
  wrap.style.position = "relative";
  return wrap;
}
