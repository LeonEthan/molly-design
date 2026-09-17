/**
 * Static-v1 shape geometry compiler. This is the single projector/render seam for
 * the modeled OOXML subset: native shape projection and adapter clipping consume
 * the same validated body instead of interpreting adjustments per host.
 */

import {
  isStaticV1ShapeName,
  isStaticV1ViewBox,
  staticV1ShapeAdjustmentsError,
  staticV1SvgPathSyntaxError,
  type StaticV1ShapeName,
} from "contracts";
import { escapeHtml, fmt, roundRectRadius } from "./fill.ts";

export type StaticV1GeometryBody =
  | { kind: "rect"; w: number; h: number; radius: number }
  | { kind: "ellipse"; w: number; h: number }
  | {
      kind: "path";
      d: string;
      /** Authored custom-path coordinates → final element frame coordinates. */
      frameScale?: readonly [number, number];
    };

export interface CompiledStaticV1ShapeGeometry {
  shapeName: StaticV1ShapeName;
  viewBox: readonly [number, number];
  body: StaticV1GeometryBody;
  native:
    | { shape: "rect" | "ellipse" | "triangle" | "arrow"; radius: number }
    | { shape: "path"; radius: 0; pathBox: readonly [0, 0, number, number]; d: string };
}

export interface StaticV1ShapeGeometryInput {
  shapeName: unknown;
  adjustments?: readonly number[];
  viewBox?: readonly number[];
  path?: string;
  bounds: readonly [number, number];
  id?: string;
}

const labelOf = (input: StaticV1ShapeGeometryInput): string =>
  input.id === undefined ? "shape" : `element ${input.id}`;

export function compileStaticV1ShapeGeometry(input: StaticV1ShapeGeometryInput): CompiledStaticV1ShapeGeometry {
  const label = labelOf(input);
  if (!isStaticV1ShapeName(input.shapeName)) {
    throw new Error(`${label}: shape geometry is outside static-v1: unknown shapeName "${String(input.shapeName)}"`);
  }
  const adjustmentError = staticV1ShapeAdjustmentsError(input.shapeName, input.adjustments);
  if (adjustmentError !== null) {
    throw new Error(`${label}: shape geometry is outside static-v1: ${adjustmentError}`);
  }
  const [w, h] = input.bounds;
  if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)) {
    throw new Error(`${label}: shape geometry is outside static-v1: bounds must be positive finite numbers`);
  }

  if (input.shapeName === "custom") {
    const pathError = typeof input.path === "string" ? staticV1SvgPathSyntaxError(input.path) : "path is missing";
    if (!isStaticV1ViewBox(input.viewBox) || pathError !== null) {
      throw new Error(
        `${label}: shape geometry is outside static-v1: custom requires a positive viewBox and valid path${pathError === null ? "" : ` (${pathError})`}`,
      );
    }
    const viewBox = [input.viewBox[0], input.viewBox[1]] as const;
    const frameScale = [w / viewBox[0], h / viewBox[1]] as const;
    return {
      shapeName: input.shapeName,
      viewBox,
      body: {
        kind: "path",
        d: input.path!,
        ...(frameScale[0] !== 1 || frameScale[1] !== 1 ? { frameScale } : {}),
      },
      native: { shape: "path", radius: 0, pathBox: [0, 0, viewBox[0], viewBox[1]], d: input.path! },
    };
  }
  if (input.viewBox !== undefined || input.path !== undefined) {
    throw new Error(`${label}: shape geometry is outside static-v1: presets forbid viewBox/path`);
  }

  const viewBox = [w, h] as const;
  switch (input.shapeName) {
    case "rect":
      return { shapeName: input.shapeName, viewBox, body: { kind: "rect", w, h, radius: 0 }, native: { shape: "rect", radius: 0 } };
    case "roundRect": {
      const radius = roundRectRadius(input.adjustments, w, h);
      return { shapeName: input.shapeName, viewBox, body: { kind: "rect", w, h, radius }, native: { shape: "rect", radius } };
    }
    case "ellipse":
    case "oval":
      return { shapeName: input.shapeName, viewBox, body: { kind: "ellipse", w, h }, native: { shape: "ellipse", radius: 0 } };
    case "triangle":
      return {
        shapeName: input.shapeName,
        viewBox,
        body: { kind: "path", d: `M ${fmt(w / 2)} 0 L ${fmt(w)} ${fmt(h)} L 0 ${fmt(h)} Z` },
        native: { shape: "triangle", radius: 0 },
      };
    case "arrow":
      return {
        shapeName: input.shapeName,
        viewBox,
        body: {
          kind: "path",
          d: `M 0 ${fmt(h * 0.25)} L ${fmt(w * 0.6)} ${fmt(h * 0.25)} L ${fmt(w * 0.6)} 0 L ${fmt(w)} ${fmt(h * 0.5)} L ${fmt(w * 0.6)} ${fmt(h)} L ${fmt(w * 0.6)} ${fmt(h * 0.75)} L 0 ${fmt(h * 0.75)} Z`,
        },
        native: { shape: "arrow", radius: 0 },
      };
  }
}

/** Deterministic SVG shape element used by both clipPath and border emission. */
export function staticV1GeometryMarkup(body: StaticV1GeometryBody, attributes = ""): string {
  const attrs = attributes === "" ? "" : ` ${attributes}`;
  if (body.kind === "rect") {
    return `<rect x="0" y="0" width="${fmt(body.w)}" height="${fmt(body.h)}" rx="${fmt(body.radius)}"${attrs}/>`;
  }
  if (body.kind === "ellipse") {
    return `<ellipse cx="${fmt(body.w / 2)}" cy="${fmt(body.h / 2)}" rx="${fmt(body.w / 2)}" ry="${fmt(body.h / 2)}"${attrs}/>`;
  }
  const transform = body.frameScale === undefined
    ? ""
    : ` transform="scale(${fmt(body.frameScale[0])} ${fmt(body.frameScale[1])})"`;
  return `<path d="${escapeHtml(body.d)}"${transform}${attrs}/>`;
}
