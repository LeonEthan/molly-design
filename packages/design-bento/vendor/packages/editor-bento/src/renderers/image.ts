/**
 * Image crop/fit carrier (GD-4 #22, image.crop/image.pipeline).
 *
 * The carrier is deliberately project-owned and has one ordered path:
 * crop → fit → cropShape → frame border. Positive crop values inset the
 * source rectangle; negative values create transparent outset around it. The
 * compiler computes source placement before DOM construction, so the browser
 * renderer cannot accidentally let CSS object-fit reorder the operations.
 *
 * Node-safe pure compilation lives beside the browser renderer. The latter
 * only assembles the already-computed SVG and resolves an asset:<key> from the
 * document's local asset table. No URL, CDN, or second image renderer exists.
 */

import { sniffStaticV1ImageMime, type BentoImageFitModeV4 } from "contracts";
import type { FrameHostElement, FrameHostRenderContext } from "../boot/frame-host.ts";
import {
  assertStaticV1CropShapeGeometry,
  clipElement,
  type ClipElement,
  type CropShapeDef,
} from "./crop-shape.ts";
import { dashArrayOf } from "./line.ts";
import { roundRectRadius } from "./fill.ts";

export interface ImageSourceSize {
  readonly width: number;
  readonly height: number;
}

export interface ImagePipelineBorder {
  readonly style?: "solid" | "dash" | "dot";
  readonly width?: number;
  readonly color?: string;
}

export interface ImagePlacementInput {
  readonly width: number;
  readonly height: number;
  readonly source: ImageSourceSize;
  readonly fit: BentoImageFitModeV4;
  readonly crop?: readonly number[];
}

export interface ImagePipelineInput extends ImagePlacementInput {
  readonly src: string;
  readonly cropShape?: CropShapeDef;
  readonly border?: ImagePipelineBorder;
}

export interface ImagePlacementCompiled {
  readonly fit: BentoImageFitModeV4;
  readonly crop: readonly [number, number, number, number];
  readonly source: ImageSourceSize;
  readonly image: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface ImagePipelineCompiled extends ImagePlacementCompiled {
  readonly src: string;
  /** Explicit crop viewport; the SVG root is an additional frame clip. */
  readonly cropClip?: { readonly x: 0; readonly y: 0; readonly width: number; readonly height: number };
  readonly cropShape?: CropShapeDef;
  readonly border?: ImagePipelineBorder;
}

const ZERO_CROP: readonly [number, number, number, number] = [0, 0, 0, 0];

const round2 = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`image pipeline ${name} must be a positive finite number`);
}

function normalizeCrop(crop: ImagePlacementInput["crop"]): readonly [number, number, number, number] {
  const value = crop ?? ZERO_CROP;
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(Number.isFinite) ||
    value[0] + value[2] >= 1 ||
    value[1] + value[3] >= 1
  ) {
    throw new Error("image pipeline crop must be four finite values with left+right and top+bottom below 1");
  }
  return [value[0], value[1], value[2], value[3]];
}

function cloneCropShape(cropShape: CropShapeDef | undefined): CropShapeDef | undefined {
  if (cropShape === undefined) return undefined;
  return {
    shapeName: cropShape.shapeName,
    ...(cropShape.adjustments !== undefined ? { adjustments: [...cropShape.adjustments] } : {}),
    ...(cropShape.viewBox !== undefined ? { viewBox: [...cropShape.viewBox] as [number, number] } : {}),
    ...(cropShape.path !== undefined ? { path: cropShape.path } : {}),
  };
}

function cloneBorder(border: ImagePipelineBorder | undefined): ImagePipelineBorder | undefined {
  if (border === undefined) return undefined;
  return {
    ...(border.style !== undefined ? { style: border.style } : {}),
    ...(border.width !== undefined ? { width: border.width } : {}),
    ...(border.color !== undefined ? { color: border.color } : {}),
  };
}

/**
 * Compile the ordered image operations in frame user units.
 *
 * The crop rectangle is a virtual source rectangle. For contain/cover its
 * aspect ratio is fitted first, then the original image is translated so the
 * virtual rectangle lands at that fitted position. For fill the fitted crop
 * rectangle exactly spans the frame. This is the project-owned equivalent of
 * the positive-crop oracle, extended to negative outset values.
 */
export function compileImagePlacement(input: ImagePlacementInput): ImagePlacementCompiled {
  assertPositiveFinite("width", input.width);
  assertPositiveFinite("height", input.height);
  assertPositiveFinite("source.width", input.source.width);
  assertPositiveFinite("source.height", input.source.height);
  if (input.fit !== "fill" && input.fit !== "contain" && input.fit !== "cover") {
    throw new Error(`image pipeline fit mode is unsupported: ${String(input.fit)}`);
  }
  const crop = normalizeCrop(input.crop);
  const [left, top, right, bottom] = crop;
  const cropSourceWidth = input.source.width * (1 - left - right);
  const cropSourceHeight = input.source.height * (1 - top - bottom);
  const fillXScale = input.width / cropSourceWidth;
  const fillYScale = input.height / cropSourceHeight;

  let imageWidth: number;
  let imageHeight: number;
  let imageX: number;
  let imageY: number;
  if (input.fit === "fill") {
    // The cropped virtual source fills the frame exactly.
    imageWidth = input.source.width * fillXScale;
    imageHeight = input.source.height * fillYScale;
    imageX = -left * imageWidth;
    imageY = -top * imageHeight;
  } else {
    const scale = input.fit === "cover" ? Math.max(fillXScale, fillYScale) : Math.min(fillXScale, fillYScale);
    const fittedCropWidth = cropSourceWidth * scale;
    const fittedCropHeight = cropSourceHeight * scale;
    const fittedX = (input.width - fittedCropWidth) / 2;
    const fittedY = (input.height - fittedCropHeight) / 2;
    imageWidth = input.source.width * scale;
    imageHeight = input.source.height * scale;
    imageX = fittedX - left * imageWidth;
    imageY = fittedY - top * imageHeight;
  }

  return {
    fit: input.fit,
    crop,
    source: { width: input.source.width, height: input.source.height },
    image: { x: round2(imageX), y: round2(imageY), width: round2(imageWidth), height: round2(imageHeight) },
  };
}

export function compileImagePipeline(input: ImagePipelineInput): ImagePipelineCompiled {
  const placement = compileImagePlacement(input);
  const compiled: ImagePipelineCompiled = {
    src: input.src,
    ...placement,
    ...(input.crop !== undefined ? { cropClip: { x: 0 as const, y: 0 as const, width: input.width, height: input.height } } : {}),
    ...(input.cropShape !== undefined ? { cropShape: cloneCropShape(input.cropShape) } : {}),
    ...(input.border !== undefined ? { border: cloneBorder(input.border) } : {}),
  };
  if (compiled.cropShape !== undefined) clipElement(compiled.cropShape, input.width, input.height);
  return compiled;
}

// ---- source dimension parser ------------------------------------------------

function dataUriBytes(uri: string): Uint8Array {
  if (!uri.startsWith("data:image/")) throw new Error("image pipeline requires a local data:image source");
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("image pipeline source data URI is malformed");
  const metadata = uri.slice(0, comma).toLowerCase();
  const body = uri.slice(comma + 1);
  if (metadata.includes(";base64")) {
    if (typeof atob !== "function") throw new Error("image pipeline cannot decode base64 in this runtime");
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  const text = decodeURIComponent(body);
  return new TextEncoder().encode(text);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function checkedSourceSize(width: number, height: number, format: string): ImageSourceSize {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(`image pipeline ${format} source has no positive intrinsic dimensions`);
  }
  return { width, height };
}

/** Read intrinsic dimensions without loading an image or touching the network. */
export function imageIntrinsicSize(uri: string): ImageSourceSize {
  const bytes = dataUriBytes(uri);
  const mime = sniffStaticV1ImageMime(bytes);
  if (mime === "image/png" && bytes.length >= 24 && ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") {
    return checkedSourceSize(u32be(bytes, 16), u32be(bytes, 20), "PNG");
  }
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > bytes.length) break;
      const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      const isFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (isFrame && offset + 7 < bytes.length) {
        return checkedSourceSize(
          (bytes[offset + 5] << 8) | bytes[offset + 6],
          (bytes[offset + 3] << 8) | bytes[offset + 4],
          "JPEG",
        );
      }
      offset += segmentLength;
    }
  }
  if (mime === "image/gif" && bytes.length >= 10) {
    return checkedSourceSize(
      bytes[6] | (bytes[7] << 8),
      bytes[8] | (bytes[9] << 8),
      "GIF",
    );
  }
  throw new Error("image pipeline source format is unsupported or has no intrinsic dimensions");
}

// ---- browser renderer -------------------------------------------------------

interface ImagePipelineFrameElement extends FrameHostElement {
  imagePipeline?: ImagePipelineCompiled;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const safeId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "_");
const attrNumber = (value: number): string => String(Math.round(value * 100) / 100);

/**
 * Compile the frame border in the final element coordinate system. A stroke
 * centered on a full-size cropShape is clipped by the root viewBox; inset the
 * geometry by half the stroke first so the visible stroke remains exactly the
 * canonical width. This seam is shared by the browser renderer and unit proof.
 */
export function compileImageBorder(
  border: ImagePipelineBorder | undefined,
  cropShape: CropShapeDef | undefined,
  width: number,
  height: number,
): ClipElement | undefined {
  const strokeWidth = Number(border?.width ?? 0);
  if (
    border === undefined ||
    !border.color ||
    border.color === "none" ||
    !Number.isFinite(strokeWidth) ||
    strokeWidth <= 0
  ) return undefined;
  assertPositiveFinite("border frame width", width);
  assertPositiveFinite("border frame height", height);
  if (cropShape !== undefined) assertStaticV1CropShapeGeometry(cropShape);

  const inset = strokeWidth / 2;
  const innerWidth = Math.max(width - strokeWidth, 0);
  const innerHeight = Math.max(height - strokeWidth, 0);
  if (cropShape === undefined || cropShape.shapeName === "rect" || cropShape.shapeName === "roundRect") {
    return {
      tag: "rect",
      attrs: {
        x: attrNumber(inset),
        y: attrNumber(inset),
        width: attrNumber(innerWidth),
        height: attrNumber(innerHeight),
        ...(cropShape?.shapeName === "roundRect"
          ? { rx: attrNumber(roundRectRadius(cropShape.adjustments, innerWidth, innerHeight)) }
          : {}),
      },
    };
  }
  if (cropShape.shapeName === "ellipse" || cropShape.shapeName === "oval") {
    return {
      tag: "ellipse",
      attrs: {
        cx: attrNumber(width / 2),
        cy: attrNumber(height / 2),
        rx: attrNumber(innerWidth / 2),
        ry: attrNumber(innerHeight / 2),
      },
    };
  }
  if (cropShape.shapeName === "triangle") {
    return {
      tag: "polygon",
      attrs: {
        points: `${attrNumber(inset)},${attrNumber(height - inset)} ${attrNumber(width / 2)},${attrNumber(inset)} ${attrNumber(width - inset)},${attrNumber(height - inset)}`,
        // A miter can extend past an acute vertex by an arbitrary amount and
        // escape the inset frame. Round joins/caps keep every valid triangle
        // boundary inside the frame while retaining the canonical stroke px.
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      },
    };
  }
  // custom path: preserve authored viewBox geometry while translating/scaling
  // into the inset frame; no raw glyph/viewBox units leak into border width.
  return {
    tag: "path",
    attrs: {
      d: cropShape.path!,
      // The authored path is mapped into frame space after insetting. Keep
      // the canonical stroke width in CSS/frame pixels under the root SVG's
      // non-uniform transform; otherwise a wide/tall frame scales the border
      // differently on each axis and clips its outer half.
      "vector-effect": "non-scaling-stroke",
      // Never let an authored acute corner grow a miter outside the inset
      // frame. The same explicit join/cap semantics apply to triangle above.
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
      transform: `translate(${attrNumber(inset)} ${attrNumber(inset)}) scale(${attrNumber(innerWidth / cropShape.viewBox![0])} ${attrNumber(innerHeight / cropShape.viewBox![1])})`,
    },
  };
}

function assetSrcLocal(doc: { assets?: Record<string, string> } | null, ref: string): string {
  // The carrier is fed from the projector's content-addressed document asset
  // table only. Never let a direct data/HTTP URL become a second unpinned path.
  return ref.startsWith("asset:") ? doc?.assets?.[ref.slice("asset:".length)] ?? "" : "";
}

function makeClipShape(clip: ClipElement, id: string): SVGClipPathElement {
  const clipPath = document.createElementNS(SVG_NS, "clipPath");
  clipPath.setAttribute("id", id);
  clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");
  const shape = document.createElementNS(SVG_NS, clip.tag);
  for (const [name, value] of Object.entries(clip.attrs)) shape.setAttribute(name, value);
  clipPath.appendChild(shape);
  return clipPath;
}

function shapeNode(clip: ClipElement): SVGElement {
  const shape = document.createElementNS(SVG_NS, clip.tag);
  for (const [name, value] of Object.entries(clip.attrs)) shape.setAttribute(name, value);
  return shape;
}

function renderBorder(svg: SVGSVGElement, pipeline: ImagePipelineCompiled, width: number, height: number): void {
  const border = pipeline.border;
  const strokeWidth = Number(border?.width ?? 0);
  const color = border?.color;
  const clip = compileImageBorder(border, pipeline.cropShape, width, height);
  if (clip === undefined || !color) return;
  const shape = shapeNode(clip);
  shape.setAttribute("fill", "none");
  shape.setAttribute("stroke", color);
  shape.setAttribute("stroke-width", attrNumber(strokeWidth));
  const dash = dashArrayOf(border.style, strokeWidth);
  if (dash !== undefined) shape.setAttribute("stroke-dasharray", dash);
  svg.appendChild(shape);
}

/** Render the compiled carrier inside Bento's native element frame. */
export function renderImagePipeline(element: FrameHostElement, ctx: FrameHostRenderContext): HTMLElement {
  const pipeline = (element as ImagePipelineFrameElement).imagePipeline;
  if (!pipeline) throw new Error("image.crop-pipeline requires an imagePipeline payload from the projector");
  const width = Number(element.w ?? 0);
  const height = Number(element.h ?? 0);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) throw new Error("image.crop-pipeline requires positive frame bounds");
  const src = assetSrcLocal(ctx.doc, pipeline.src);
  if (!src) throw new Error(`image.crop-pipeline asset is not available offline: ${pipeline.src}`);

  const wrap = document.createElement("div");
  wrap.style.cssText = "width:100%;height:100%;overflow:hidden;";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `0 0 ${attrNumber(width)} ${attrNumber(height)}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.style.display = "block";

  const defs = document.createElementNS(SVG_NS, "defs");
  const prefix = safeId(element.id);
  const cropId = `image-crop-${prefix}`;
  const shapeId = `image-shape-${prefix}`;
  if (pipeline.cropClip !== undefined) {
    defs.appendChild(makeClipShape({ tag: "rect", attrs: { x: "0", y: "0", width: attrNumber(width), height: attrNumber(height) } }, cropId));
  }
  if (pipeline.cropShape !== undefined) defs.appendChild(makeClipShape(clipElement(pipeline.cropShape, width, height), shapeId));
  if (defs.childNodes.length > 0) svg.appendChild(defs);

  let parent: SVGElement = svg;
  if (pipeline.cropClip !== undefined) {
    const cropGroup = document.createElementNS(SVG_NS, "g");
    cropGroup.setAttribute("clip-path", `url(#${cropId})`);
    svg.appendChild(cropGroup);
    parent = cropGroup;
  }
  if (pipeline.cropShape !== undefined) {
    const shapeGroup = document.createElementNS(SVG_NS, "g");
    shapeGroup.setAttribute("clip-path", `url(#${shapeId})`);
    parent.appendChild(shapeGroup);
    parent = shapeGroup;
  }
  const image = document.createElementNS(SVG_NS, "image");
  image.setAttribute("href", src);
  image.setAttribute("x", attrNumber(pipeline.image.x));
  image.setAttribute("y", attrNumber(pipeline.image.y));
  image.setAttribute("width", attrNumber(pipeline.image.width));
  image.setAttribute("height", attrNumber(pipeline.image.height));
  image.setAttribute("preserveAspectRatio", "none");
  parent.appendChild(image);
  renderBorder(svg, pipeline, width, height);
  wrap.appendChild(svg);
  return wrap;
}
