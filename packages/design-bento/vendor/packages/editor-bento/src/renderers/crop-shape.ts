/**
 * image.cropShape 家族（GD-4c Wave C1 ticket #8；matrix image.cropShape 行
 * adapter，冻结裁决 (a) svg clip-path 载具 (b) CSS clip-path 到 frame 内容器）。
 * 投影把 cropShape 载荷放进 native image 元素（native src/fit/渲染面不动），
 * vendor renderElement 在 native switch 之后交给 frame-host 装饰器：在 frame 内
 * 挂一个零尺寸 <svg><defs><clipPath>，并给原生 <img> 加 CSS clip-path: url(#id)。
 *
 * 闭合几何子集（其余 OOXML 预设几何表未建 → 投影期具名拒绝，不静默近似）：
 * rect / roundRect（adjustments[0] 万分比圆角，假设 4 同源）/ ellipse·oval /
 * triangle（顶点居中）/ custom（viewBox 独立拉伸，与 shape.customPath 同语义）。
 * 尺寸语义：clipPath 默认 userSpaceOnUse，user units = 元素盒 w×h（img 100% 盒）。
 *
 * Node-safe：纯几何在 clipElement；DOM 只在 renderCropShapeDecorator 内。
 */
import type { FrameHostElement, FrameHostRenderContext } from "../boot/frame-host.ts";
import { fmt, roundRectRadius } from "./fill.ts";
import {
  assertStaticV1ShapeAdjustments,
  isStaticV1CropShape,
  isStaticV1ViewBox,
  staticV1SvgPathSyntaxError,
} from "contracts";

// 结构镜像（Node/browser 双侧自包含；见 text.ts 头注）。
export interface CropShapeDef {
  shapeName: string;
  adjustments?: number[];
  viewBox?: [number, number];
  path?: string;
}

/** roundRect adjustments[0] 万分比圆角：与 shape 投影共享实现（fill.ts 假设 4）。 */
const RECT_LIKE = new Set(["rect", "roundRect"]);
const ROUND_NAMES = new Set(["ellipse", "oval"]);

/** 投影期可闭合的 cropShape 预设子集（其余具名拒绝）。 */
export function isModeledCropShape(shapeName: string): boolean {
  return isStaticV1CropShape(shapeName);
}

/** Fail closed on malformed canonical, including direct renderer callers. */
export function assertStaticV1CropShapeGeometry(cropShape: CropShapeDef): void {
  if (!isStaticV1CropShape(cropShape.shapeName)) {
    throw new Error(`cropShape geometry is outside static-v1: unknown shapeName "${String(cropShape.shapeName)}"`);
  }
  try {
    assertStaticV1ShapeAdjustments(cropShape.shapeName, cropShape.adjustments);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cropShape geometry is outside static-v1: ${reason}`);
  }
  if (cropShape.shapeName === "custom") {
    const pathError = typeof cropShape.path === "string"
      ? staticV1SvgPathSyntaxError(cropShape.path)
      : "path is missing";
    if (!isStaticV1ViewBox(cropShape.viewBox) || pathError !== null) {
      throw new Error(
        `cropShape geometry is outside static-v1: custom requires a positive viewBox and valid path${pathError === null ? "" : ` (${pathError})`}`,
      );
    }
  } else if (cropShape.viewBox !== undefined || cropShape.path !== undefined) {
    throw new Error("cropShape geometry is outside static-v1: presets forbid viewBox/path");
  }
}

export interface ClipElement {
  tag: "rect" | "ellipse" | "polygon" | "path";
  attrs: Record<string, string>;
}

/** cropShape → clipPath 内容元素（user units = 元素盒 w×h）。 */
export function clipElement(cropShape: CropShapeDef, w: number, h: number): ClipElement {
  assertStaticV1CropShapeGeometry(cropShape);
  const { shapeName } = cropShape;
  if (RECT_LIKE.has(shapeName)) {
    const attrs: Record<string, string> = {
      x: "0",
      y: "0",
      width: fmt(w),
      height: fmt(h),
    };
    if (shapeName === "roundRect") attrs.rx = fmt(roundRectRadius(cropShape.adjustments, w, h));
    return { tag: "rect", attrs };
  }
  if (ROUND_NAMES.has(shapeName)) {
    return {
      tag: "ellipse",
      attrs: {
        cx: fmt(w / 2),
        cy: fmt(h / 2),
        rx: fmt(w / 2),
        ry: fmt(h / 2),
      },
    };
  }
  if (shapeName === "triangle") {
    return { tag: "polygon", attrs: { points: `0,${fmt(h)} ${fmt(w / 2)},0 ${fmt(w)},${fmt(h)}` } };
  }
  if (shapeName === "custom") {
    // viewBox 独立拉伸（preserveAspectRatio:none 同 native custom path 惯例）。
    const vbw = cropShape.viewBox![0];
    const vbh = cropShape.viewBox![1];
    return {
      tag: "path",
      attrs: {
        d: cropShape.path!,
        transform: `scale(${fmt(w / vbw)} ${fmt(h / vbh)})`,
      },
    };
  }
  throw new Error(`cropShape 预设 "${shapeName}" 未模型化（image.cropShape 行；仅 rect/roundRect/ellipse/oval/triangle/custom 闭合）`);
}

// ---- DOM 装饰器（browser only） ----

interface CropShapeFrameElement extends FrameHostElement {
  cropShape?: CropShapeDef;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const safeId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "_");

/** image.crop-shape 装饰器：原生 <img> 上挂 svg clipPath（src/fit/渲染面不动）。 */
export function renderCropShapeDecorator(
  element: FrameHostElement,
  frameNode: HTMLElement,
  _ctx: FrameHostRenderContext,
): void {
  const cropShape = (element as CropShapeFrameElement).cropShape;
  const img = frameNode.querySelector<HTMLImageElement>("img");
  if (!cropShape || !img) return;
  const w = Number(element.w ?? 0);
  const h = Number(element.h ?? 0);
  const clip = clipElement(cropShape, w, h);
  const id = `crop-${safeId(element.id)}`;

  const wrap = document.createElementNS(SVG_NS, "svg");
  wrap.setAttribute("width", "0");
  wrap.setAttribute("height", "0");
  wrap.style.cssText = "position:absolute;width:0;height:0";
  const defs = document.createElementNS(SVG_NS, "defs");
  const clipPath = document.createElementNS(SVG_NS, "clipPath");
  clipPath.setAttribute("id", id);
  const shape = document.createElementNS(SVG_NS, clip.tag);
  for (const [name, value] of Object.entries(clip.attrs)) shape.setAttribute(name, value);
  clipPath.appendChild(shape);
  defs.appendChild(clipPath);
  wrap.appendChild(defs);
  frameNode.appendChild(wrap);
  img.style.clipPath = `url(#${id})`;
}
