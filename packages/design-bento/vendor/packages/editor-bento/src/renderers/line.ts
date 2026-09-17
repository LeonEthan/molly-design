/**
 * line 家族编译/路由面（GD-4c Wave C1 ticket #8；matrix line.points/line.curve/
 * line.arrow 行 + spikes/bento-static-closure/shape-path-line/notes.md）。
 * Node-safe：纯几何编译 + 端点切线箭头几何；DOM 面只在 renderLineArrow 内，
 * sealed shell 的 Chromium 消费。投影路由（冻结矩阵边界，逐条内联注释）：
 *
 * - route "native"：2 点直线 + 两端头 ∈ {null, arrow} → 原生 shape:line +
 *   vendor marker（matrix line.points "2 点直线：native line renderer" +
 *   line.arrow "直线 arrow/null：native line + SVG marker"）。viewport 点列先
 *   缩放进 bounds（viewBox 独立拉伸惯例），再按 lineedit atan2 惯例（vendor
 *   lineedit.ts:44-53）算 box/rotation，端点逐点精确。
 * - route "path"：≥3 点 sharp/smooth 且无箭头 → 项目编译 d + pathBox，native
 *   path renderer 画（matrix line.points "≥3 点：native path renderer 绘制
 *   项目编译的 d" / line.curve "adapter 编译 + native 像素"）。smooth 按 PPTD
 *   惯例 (N-1)%3==0，即 1 起点的 C 三段（控制点恰为中间点）；越界点数契约未
 *   定义 → 具名拒绝（不静默补 L）。path 路由保持 authoring viewBox 坐标 +
 *   pathBox（native 的 preserveAspectRatio:none 拉伸语义）。
 * - route "frame"：其余组合（round 连接——无 stroke-linejoin 的 native path
 *   画不了圆角；stealth/diamond/oval 词表——vendor 无对应 marker；曲线/折线
 *   上的任意箭头——vendor marker 只挂在 line 分支）→ 投影带 frameRenderer
 *   'line.arrow' + lineCompiled 载荷，frame 渲染器自绘 svg（body path +
 *   stroke-linejoin:round + 端点切线箭头多边形/椭圆）。frame 路由把点列先缩放
 *   进 bounds 并平移到 bounds-local 坐标（0..w × 0..h），d/箭头几何在显示像素
 *   空间编译（箭头尺寸 5.5×sw 是像素语义，泛化 viewBox 下不被拉伸扭曲）；
 *   lineCompiled.vb = bounds 尺寸。精确化之前的路由在 viewBox 单位下编译箭头
 *   （viewBox≠bounds 时箭头被拉伸）是错误，已改。
 *
 * 箭头尺寸按 vendor marker 实测尺度：marker 框 5.5×strokeWidth
 * （render.ts markerRef markerWidth/Height=5.5，notes.md "marker size 5.5×sw"）
 * ——L=0.95S（tip 距）、H=0.45S（半宽，沿用 8 单位 viewBox 内 0.4–7.6 的三角
 * 比例），不做自创尺寸公式。oval = 以切线为长轴的真椭圆（非多边形近似）。
 */
import type { FrameHostElement, FrameHostRenderContext } from "../boot/frame-host.ts";
import { fmt } from "./fill.ts";

// 结构镜像（Node/browser 双侧自包含，不依赖 "contracts" 包——sealed shell 的
// nested src 文件不做包级 import rewrite；见 image-fill.ts 同款约定）。
export type ArrowheadKind = "arrow" | "stealth" | "diamond" | "oval";
export interface LineBorder {
  style?: string;
  width?: number;
  color?: string;
}
/** routeLine 消费的 line 元素面（canonical BentoLineElementV4 的结构子集）。 */
export interface LineElementLike {
  id: string;
  bounds: [number, number, number, number];
  viewBox: readonly [number, number];
  points: string;
  curve?: "sharp" | "round" | "smooth";
  arrow?: readonly [ArrowheadKind | null, ArrowheadKind | null];
  border?: LineBorder;
  rotation?: number;
}

export interface LinePoint {
  x: number;
  y: number;
}

/** PPTD points 串 → 点列（validate 已把关格；投影侧 fail-closed 于畸形值）。 */
export function parsePointsString(points: string): LinePoint[] {
  return points
    .trim()
    .split(/\s+/)
    .map((token) => {
      const [x, y] = token.split(",");
      const nx = Number(x);
      const ny = Number(y);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
        throw new Error(`malformed line point: ${token}`);
      }
      return { x: nx, y: ny };
    });
}

/** viewBox 坐标缩放进 bounds 盒（独立拉伸惯例；0 维度防除零）。 */
export function scalePointsToBounds(
  points: readonly LinePoint[],
  bounds: [number, number, number, number],
  viewBox: readonly [number, number],
): LinePoint[] {
  const [, , w, h] = bounds;
  const [vbw, vbh] = viewBox;
  const sx = vbw > 0 ? w / vbw : 1;
  const sy = vbh > 0 ? h / vbh : 1;
  return points.map((p) => ({ x: bounds[0] + p.x * sx, y: bounds[1] + p.y * sy }));
}

/** 2 点直线框几何：先把缩放后的两端点绕原始 bounds 中心按元素 rotation 旋转
 *  （PPTD 语义：整框连同内容绕框中心旋），再对显示端点取 lineedit atan2 惯例
 *  （vendor lineedit.ts:44-53）。中点与角度都来自旋转后的端点——平移线段
 *  （中点≠框中心）带 rotation 时才是精确的。 */
export function straightLineBox(
  p0: LinePoint,
  p1: LinePoint,
  bounds: [number, number, number, number],
  baseRotation: number,
): { x: number; y: number; w: number; h: number; rotation: number } {
  const [bx, by, bw, bh] = bounds;
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const rad = (baseRotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotate = (p: LinePoint): LinePoint => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };
  const r0 = rotate(p0);
  const r1 = rotate(p1);
  const dx = r1.x - r0.x;
  const dy = r1.y - r0.y;
  const len = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const w = Math.max(len, 1);
  const h = Math.max(bh, 1);
  const midX = (r0.x + r1.x) / 2;
  const midY = (r0.y + r1.y) / 2;
  const r2 = (n: number): number => Math.round(n * 100) / 100;
  return { x: r2(midX - w / 2), y: r2(midY - h / 2), w: r2(w), h: r2(h), rotation: r2(angle) };
}

const normalize = (v: LinePoint): LinePoint => {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-9) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
};

export type CurveKind = "sharp" | "round" | "smooth";

export interface CompiledArrowV4 {
  kind: ArrowheadKind;
  start: boolean;
  /** arrow/stealth/diamond：形点串（viewBox 单位，fmt 两位）。 */
  points?: string;
  /** oval：以切线为长轴的椭圆。 */
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  rotation?: number;
}

export interface CompiledLineV4 {
  d: string;
  join: CurveKind;
  stroke: string;
  strokeWidth: number;
  /** stroke-dasharray 值（border.style dash/dot，vendor dashArray 同式）。 */
  dash?: string;
  vb: readonly [number, number];
  arrows: readonly CompiledArrowV4[];
}

/** 编译 d 与端点外切向（smooth 用控制点、折线用端段方向；返回值都是朝外的单位向量）。 */
export function compileBody(
  curve: CurveKind,
  points: readonly LinePoint[],
): { d: string; start: LinePoint; end: LinePoint } {
  const n = points.length;
  if (curve === "smooth") {
    // PPTD：middle 点是 bezier 控制点，C 段三参一组；(N-1)%3 由路由侧把关。
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < n; i += 3) {
      d += ` C ${points[i].x} ${points[i].y} ${points[i + 1].x} ${points[i + 1].y} ${points[i + 2].x} ${points[i + 2].y}`;
    }
    const start = normalize({ x: points[0].x - points[1].x, y: points[0].y - points[1].y });
    const end = normalize({ x: points[n - 1].x - points[n - 2].x, y: points[n - 1].y - points[n - 2].y });
    return { d, start, end };
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (const p of points.slice(1)) d += ` L ${p.x} ${p.y}`;
  const start = normalize({ x: points[0].x - points[1].x, y: points[0].y - points[1].y });
  const end = normalize({ x: points[n - 1].x - points[n - 2].x, y: points[n - 1].y - points[n - 2].y });
  return { d, start, end };
}

/** vendor marker 尺度：5.5×strokeWidth；三角 8 单位框内 0.4–7.6 身材比例。 */
const ARROW_ENVELOPE = 5.5;

/** 端点外切向 t̂ 上的箭头几何（尺寸锚定 vendor marker 尺度，显示像素语义）。 */
function arrowAt(
  kind: ArrowheadKind,
  end: LinePoint,
  tHat: LinePoint,
  strokeWidth: number,
): CompiledArrowV4 {
  const s = ARROW_ENVELOPE * strokeWidth;
  const l = 0.95 * s;
  const half = 0.45 * s;
  const nHat = { x: -tHat.y, y: tHat.x };
  const points = (list: readonly LinePoint[]): string =>
    list.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ");
  const withPts = (list: readonly LinePoint[]): CompiledArrowV4 => ({ kind, start: false, points: points(list) });
  switch (kind) {
    case "arrow": {
      const tip = { x: end.x + l * tHat.x, y: end.y + l * tHat.y };
      return withPts([tip, { x: end.x + half * nHat.x, y: end.y + half * nHat.y }, { x: end.x - half * nHat.x, y: end.y - half * nHat.y }]);
    }
    case "stealth": {
      // 凹口：base 向后 0.25S（在 tip→base 方向中间留凹角）。
      const tip = { x: end.x + l * tHat.x, y: end.y + l * tHat.y };
      return withPts([tip, { x: end.x + half * nHat.x, y: end.y + half * nHat.y }, { x: end.x - 0.25 * s * tHat.x, y: end.y - 0.25 * s * tHat.y }, { x: end.x - half * nHat.x, y: end.y - half * nHat.y }]);
    }
    case "diamond": {
      const tip = { x: end.x + l * tHat.x, y: end.y + l * tHat.y };
      const back = { x: end.x - l * tHat.x, y: end.y - l * tHat.y };
      return withPts([tip, { x: end.x + half * nHat.x, y: end.y + half * nHat.y }, back, { x: end.x - half * nHat.x, y: end.y - half * nHat.y }]);
    }
    case "oval":
      // 真椭圆：长轴沿切线；rotation = 切线角（度）。
      return {
        kind,
        start: false,
        cx: Math.round(end.x * 100) / 100,
        cy: Math.round(end.y * 100) / 100,
        rx: Math.round(l * 100) / 100,
        ry: Math.round(half * 100) / 100,
        rotation: Math.round((Math.atan2(tHat.y, tHat.x) * 180) / Math.PI * 100) / 100,
      };
  }
}

/** border.style → vendor dashArray（native line/path 与 frame svg 同式）。 */
export function dashArrayOf(style: string | undefined, strokeWidth: number): string | undefined {
  const sw = Math.max(strokeWidth, 1);
  switch (style) {
    case "dash":
      return `${fmt(Math.max(sw * 2.4, 7))} ${fmt(Math.max(sw * 1.8, 5))}`;
    case "dot":
      return `0.1 ${fmt(Math.max(sw * 2.2, 5))}`;
    default:
      return undefined;
  }
}

export type LineRoute =
  | {
      route: "native";
      box: { x: number; y: number; w: number; h: number; rotation: number };
      lineStart: string;
      lineEnd: string;
      color: string;
      width: number;
      dashStyle?: "dashed" | "dotted";
    }
  | {
      route: "path";
      d: string;
      color: string;
      width: number;
      dashStyle?: "dashed" | "dotted";
    }
  | { route: "frame"; compiled: CompiledLineV4 };

const nativeEnding = (a: ArrowheadKind | null): string => (a === "arrow" ? "arrow" : "none");
const isNativeHead = (a: ArrowheadKind | null): boolean => a === null || a === "arrow";

/**
 * 三态路由（冻结矩阵边界）。border.width 缺省 1（PPTD line 无 fill，色即描边色）。
 */
export function routeLine(line: LineElementLike): LineRoute {
  const [arrowStart, arrowEnd] = line.arrow ?? [null, null];
  const color = line.border?.color ?? "#000000";
  const width = line.border?.width ?? 1;
  const borderStyle = line.border?.style;
  const dashStyle = borderStyle === "dash" ? "dashed" : borderStyle === "dot" ? "dotted" : undefined;
  const points = parsePointsString(line.points);
  const n = points.length;
  const curve: CurveKind = line.curve ?? "round";
  const straight = n === 2;

  const frameCompiled = (joint: CurveKind): LineRoute => {
    // frame 路由在 bounds-local 显示像素空间编译：点列先按 viewBox 独立拉伸
    // 惯例缩放进 bounds 再平移（箭头尺寸 5.5×sw 是像素语义，不能被泛化
    // viewBox 的拉伸扭曲）。2 点直线强制 M/L body（smooth 无控制点）。
    const scaled = scalePointsToBounds(points, line.bounds, line.viewBox);
    const local = scaled.map((p) => ({ x: p.x - line.bounds[0], y: p.y - line.bounds[1] }));
    const join: CurveKind = local.length === 2 ? "sharp" : joint;
    const { d, start, end } = compileBody(join, local);
    const arrows: CompiledArrowV4[] = [];
    if (arrowStart !== null) arrows.push({ ...arrowAt(arrowStart, local[0]!, start, width), start: true });
    if (arrowEnd !== null) arrows.push({ ...arrowAt(arrowEnd, local[local.length - 1]!, end, width), start: false });
    return {
      route: "frame",
      compiled: {
        d,
        join,
        stroke: color,
        strokeWidth: width,
        ...(dashArrayOf(borderStyle, width) !== undefined ? { dash: dashArrayOf(borderStyle, width) } : {}),
        vb: [line.bounds[2], line.bounds[3]],
        arrows,
      },
    };
  };

  // 2 点直线 + 两端头 ∈ {null, arrow} → native line + vendor marker（任一 null 即“无箭头端”）。
  if (straight && isNativeHead(arrowStart) && isNativeHead(arrowEnd)) {
    const scaled = scalePointsToBounds(points, line.bounds, line.viewBox);
    const box = straightLineBox(scaled[0]!, scaled[1]!, line.bounds, line.rotation ?? 0);
    return {
      route: "native",
      box,
      lineStart: nativeEnding(arrowStart),
      lineEnd: nativeEnding(arrowEnd),
      color,
      width,
      ...(dashStyle !== undefined ? { dashStyle } : {}),
    };
  }

  // ≥3 点 smooth 的点数契约（PPTD 惯例 1+3k 整组 C）。
  if (!straight && curve === "smooth" && (n - 1) % 3 !== 0) {
    throw new Error(
      `element ${line.id}: smooth 曲线点数与 bezier 控制点契约不匹配（line.curve 行；点数须满足 (N-1)%3==0）`,
    );
  }

  // ≥3 点无箭头：sharp/smooth → 编译 d 走 native path；round → frame（无
  // stroke-linejoin 的 native path 画不了圆角）。
  if (!straight && arrowStart === null && arrowEnd === null) {
    if (curve !== "round") {
      const { d } = compileBody(curve, points);
      return { route: "path", d, color, width, ...(dashStyle !== undefined ? { dashStyle } : {}) };
    }
    return frameCompiled("round");
  }

  // 其余组合（非原生词表箭头，或折线/曲线带箭头）→ frame 自绘。
  return frameCompiled(curve);
}

// ---- DOM 面（browser only） ----

interface LineFrameElement extends FrameHostElement {
  lineCompiled: CompiledLineV4;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** line.arrow frame 渲染器：自绘 svg（body path + 端点切线箭头）。 */
export function renderLineArrow(element: FrameHostElement, _ctx: FrameHostRenderContext): SVGSVGElement {
  const compiled = (element as LineFrameElement).lineCompiled;
  if (!compiled) throw new Error("line.arrow requires a lineCompiled payload from the projector");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${compiled.vb[0]} ${compiled.vb[1]}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;overflow:visible";

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", compiled.d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", compiled.stroke);
  path.setAttribute("stroke-width", String(compiled.strokeWidth));
  path.setAttribute("vector-effect", "non-scaling-stroke");
  if (compiled.dash) path.setAttribute("stroke-dasharray", compiled.dash);
  if (compiled.join !== "sharp") path.setAttribute("stroke-linejoin", compiled.join);
  svg.appendChild(path);

  for (const arrow of compiled.arrows) {
    if (arrow.kind === "oval") {
      const cx = arrow.cx ?? 0;
      const cy = arrow.cy ?? 0;
      const rx = arrow.rx ?? 0;
      const ry = arrow.ry ?? 0;
      const rotation = arrow.rotation ?? 0;
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("transform", `translate(${fmt(cx)} ${fmt(cy)}) rotate(${fmt(rotation)})`);
      const ellipse = document.createElementNS(SVG_NS, "ellipse");
      ellipse.setAttribute("cx", "0");
      ellipse.setAttribute("cy", "0");
      ellipse.setAttribute("rx", fmt(rx));
      ellipse.setAttribute("ry", fmt(ry));
      ellipse.setAttribute("fill", compiled.stroke);
      g.appendChild(ellipse);
      svg.appendChild(g);
    } else {
      const polygon = document.createElementNS(SVG_NS, "polygon");
      polygon.setAttribute("points", arrow.points ?? "");
      polygon.setAttribute("fill", compiled.stroke);
      svg.appendChild(polygon);
    }
  }
  return svg;
}