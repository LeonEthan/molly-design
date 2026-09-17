/**
 * icon 家族投影面（GD-4 #22）。icon.name 行是 hybrid：adapter 从项目自有
 * Font Awesome Free 7.3.1 货架取出真实 path/viewBox 字节，native svg 元素经
 * sanitizeSvg 渲染 markup。fill 的 solid/linear/radial 只改变 path 的 paint；
 * border 画在同一个 SVG 载具的最终 frame 上，避免旧的占位 glyph 或第二套
 * 图标渲染真相。fill.image 不在 fill.image 行宿主表（project.ts 具名拒绝）。
 *
 * Node-safe：纯字符串构建；markup 词表全在 sanitizeSvg allowlist。
 */

import { escapeHtml, fmt } from "./fill.ts";

export interface IconMarkupOptions {
  /** iconName（fas:battery 形态）进注释供人工核对。 */
  iconName: string;
  /** 官方货架的 viewBox 尺寸与真实 SVG path 数据。 */
  glyph: {
    width: number;
    height: number;
    path: string | readonly string[];
    color?: string;
    ref?: string;
  };
  /** 渐变 defs markup（renderers/fill.ts 的 linear/radialDefsMarkup 产物）。 */
  defs?: string;
  /** Final element frame in user units; glyph is centered with aspect preserved. */
  frame?: { width: number; height: number };
  /** icon frame border；描边与 glyph 共用最终 SVG viewport。 */
  border?: { style?: "solid" | "dash" | "dot"; width?: number; color?: string };
}

const borderDash = (style: "solid" | "dash" | "dot" | undefined): string | undefined => {
  if (style === "dash") return "4,4";
  if (style === "dot") return "2,2";
  return undefined;
};

const assertPositiveFinite = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`icon ${name} must be a positive finite number`);
};

/** 真实 FA path 的 SVG 载具；不会生成可误认的占位几何。 */
export function iconMarkup(opts: IconMarkupOptions): string {
  if (opts.glyph.color === undefined && opts.glyph.ref === undefined) {
    throw new Error(`icon ${opts.iconName}: glyph paint is missing`);
  }
  const paint = opts.glyph.color !== undefined ? opts.glyph.color : `url(#${opts.glyph.ref})`;
  assertPositiveFinite("glyph width", opts.glyph.width);
  assertPositiveFinite("glyph height", opts.glyph.height);
  const frameWidth = opts.frame?.width ?? opts.glyph.width;
  const frameHeight = opts.frame?.height ?? opts.glyph.height;
  assertPositiveFinite("frame width", frameWidth);
  assertPositiveFinite("frame height", frameHeight);
  // The outer SVG is the final frame. The nested group is fitted independently
  // so a wide/tall FA viewBox never gets stretched to fill a non-square frame.
  const scale = Math.min(frameWidth / opts.glyph.width, frameHeight / opts.glyph.height);
  const glyphWidth = opts.glyph.width * scale;
  const glyphHeight = opts.glyph.height * scale;
  const glyphX = (frameWidth - glyphWidth) / 2;
  const glyphY = (frameHeight - glyphHeight) / 2;
  const defs = opts.defs ?? "";
  const paths = Array.isArray(opts.glyph.path) ? opts.glyph.path : [opts.glyph.path];
  const glyphBody = paths
    .map((path) => `<path d="${escapeHtml(path)}" fill="${escapeHtml(paint)}"/>`)
    .join("");
  const body = `<g transform="translate(${fmt(glyphX)} ${fmt(glyphY)}) scale(${fmt(scale)})">${glyphBody}</g>`;
  const border = opts.border;
  const strokeWidth = Number(border?.width ?? 0);
  const hasBorder = strokeWidth > 0 && border?.color !== undefined && border.color !== "none";
  const borderMarkup = hasBorder
    ? `<rect x="${fmt(strokeWidth / 2)}" y="${fmt(strokeWidth / 2)}" width="${fmt(Math.max(frameWidth - strokeWidth, 0))}" height="${fmt(Math.max(frameHeight - strokeWidth, 0))}" fill="none" stroke="${escapeHtml(border!.color!)}" stroke-width="${fmt(strokeWidth)}"${borderDash(border!.style) ? ` stroke-dasharray="${borderDash(border!.style)}"` : ""}/>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(frameWidth)} ${fmt(frameHeight)}" preserveAspectRatio="none">` +
    (defs ? `<defs>${defs}</defs>` : "") +
    `<!-- icon: ${escapeHtml(opts.iconName)} -->` +
    body +
    borderMarkup +
    `</svg>`
  );
}
