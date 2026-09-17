/**
 * fill 家族纯编译面（GD-4c Wave C1 ticket #8；matrix fill.gradientRadial 行 svg
 * 载具 C5 + fill.image 行 C26 CSS 路线同源）。Node-safe：零 DOM、零 vendor import
 * （会进 sealed shell，浏览器侧 native svg 元素直接消费返回的 markup 字符串）。
 *
 * 管理三件事：
 * 1. 共享数值/角度换算与 id 派生（pptdAngleToCss、fmt、gradientId）——fill、
 *    text（colorGradient/radial）、icon 载具共用同一约定，测试逐字节锚定；
 * 2. svg markup 构建：radial/linear <defs> 与 shape 宿主载具
 *    （rect/ellipse/custom path 三态 body + border stroke），全部在
 *    sanitizeSvg 词表内（radialgradient/stop/rect/ellipse/path/id/stop-color/
 *    offset/viewbox/preserveaspectratio，render.ts:551-620）；
 * 3. 同一元素在画布/侧栏/演示叠层多次渲染：id 以 elementId 派生，同元素多实例
 *    内容相同，document 级 url(#id) 撞车视觉无害（写入后续注释）。
 *
 * 角度约定（spike fill E1 实测）：PPTD 0=左→右顺时针 vs CSS 0=底→顶，差 +90°，
 * 先在 [0,360) 归一化再移位。
 */

import { staticV1GeometryMarkup, type StaticV1GeometryBody } from "./geometry.ts";

/** Shared deterministic geometry number formatting (round to 2dp). */
export const fmt = (n: number): string => String(Math.round(n * 100) / 100);

export const roundRectRadius = (
  adjustments: readonly number[] | undefined,
  w: number,
  h: number,
): number => ((adjustments?.[0] ?? 0) / 100000) * Math.min(w, h);

/** Single markup escape helper (text and attribute bytes: &, <, >, "). */
export const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Shared ` name="value"` attribute one-liner（value 经 escapeHtml）。 */
export const xml = (name: string, value: unknown): string => ` ${name}="${escapeHtml(String(value))}"`;

/** PPTD 渐变角度（0=左→右顺时针，[0,360)）→ CSS 角度（0=底→顶），+90° 等差。 */
export const pptdAngleToCss = (pptdAngle: number): number =>
  (((pptdAngle % 360) + 360) % 360 + 90) % 360;

/** 元素级渐变/载具 id：前缀+净化过的 elementId（同元素多实例内容相同，撞车无害）。 */
export function gradientId(prefix: string, elementId: string): string {
  return `${prefix}-${elementId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export interface GradientStopInput {
  position: number;
  color: string;
}

/** <stop> 序列；offset 用 fmt 输出 0/0.5/1 形态（sanitize 词表 stop/offset/stop-color）。 */
export function stopsMarkup(stops: readonly GradientStopInput[]): string {
  return stops.map((stop) => `<stop offset="${fmt(stop.position)}" stop-color="${escapeHtml(stop.color)}"/>`).join("");
}

/** linear <defs>：方向按 gradientLineCoords（vendor render.ts:216-222 同式，CSS 惯例角度直传）。 */
export function linearDefsMarkup(
  id: string,
  cssAngle: number,
  stops: readonly GradientStopInput[],
): string {
  const rad = (cssAngle * Math.PI) / 180;
  const dx = Math.sin(rad) / 2;
  const dy = -Math.cos(rad) / 2;
  const x1 = 0.5 - dx;
  const y1 = 0.5 - dy;
  const x2 = 0.5 + dx;
  const y2 = 0.5 + dy;
  return `<linearGradient id="${id}" x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}">${stopsMarkup(stops)}</linearGradient>`;
}

/** radial <defs>：objectBoundingBox 默认，圆心 50% 50%（sanitize 词表 radialgradient）。 */
export function radialDefsMarkup(id: string, stops: readonly GradientStopInput[]): string {
  return `<radialGradient id="${id}">${stopsMarkup(stops)}</radialGradient>`;
}

export interface ShapeCarrierOptions {
  /** 载具 id（svg 内 <defs> 与 body fill 共用）。 */
  id: string;
  /** defs markup（radialDefsMarkup/linearDefsMarkup 产物）。 */
  defs: string;
  /** Shared compiled geometry body; radial/image/native paths never re-derive
   * the modeled preset/custom vocabulary. */
  body: StaticV1GeometryBody;
  /** common.border 宿主：描边画进载具（svg 词表 stroke/stroke-width）。 */
  border?: { color?: string; width?: number };
  /** 画布坐标空间（无 border 时的矩形/椭圆载具 viewBox）。 */
  viewBox: readonly [number, number];
}

/** shape 宿主渐变 → 独立 svg 载具 markup（原生 svg 元素渲染；C5 冻结裁决）。 */
export function shapeCarrierMarkup(opts: ShapeCarrierOptions): string {
  const sw = opts.border?.width ?? 0;
  const hasStroke = sw > 0 && opts.border?.color !== undefined && opts.border.color !== "none";
  const fillBody = staticV1GeometryMarkup(opts.body, `fill="url(#${escapeHtml(opts.id)})"`);
  const w = opts.viewBox[0];
  const h = opts.viewBox[1];
  const innerX = Math.max(w - sw, 0) / w;
  const innerY = Math.max(h - sw, 0) / h;
  const borderBody = hasStroke
    ? `<g transform="translate(${fmt(sw / 2)} ${fmt(sw / 2)}) scale(${fmt(innerX)} ${fmt(innerY)})">${staticV1GeometryMarkup(opts.body, `fill="none"${xml("stroke", opts.border!.color)}${xml("stroke-width", fmt(sw))} vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"`)}</g>`
    : "";
  const box = `viewBox="0 0 ${fmt(opts.viewBox[0])} ${fmt(opts.viewBox[1])}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" ${box} preserveAspectRatio="none"><defs>${opts.defs}</defs>${fillBody}${borderBody}</svg>`;
}
