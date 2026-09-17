/**
 * text family projection/decorator (GD-4c C1 ticket #8/#21).
 *
 * Native Bento owns the element frame and the basic text node. This module is
 * the single text-semantics resolver for both text elements and table-cell
 * rich text: adapter fields are carried in `textLayout`/`richStyles` and are
 * replayed after native sanitization. Keeping the resolver here matters for
 * cells in particular; a cell must not quietly acquire different defaults,
 * font fallback, alignment, or wrapping rules from an identical text element.
 *
 * Latex remains a native-host concern. The projector emits a safe `$...$`
 * marker and the pinned host's `resolveMath` converts it to MathML after
 * sanitization. Rich decorators run after that conversion, so a formula can
 * carry the same color/font/background/layout style as any other run.
 *
 * Node-safe: pure html/payload builders have no DOM side effects. DOM work is
 * inside the decorator and is consumed only by the sealed Chromium shell.
 */
import type { FrameHostElement, FrameHostRenderContext } from "../boot/frame-host.ts";
import {
  resolveStaticV1TextStyle,
  staticV1FontFamilyCss,
  STATIC_V1_LATEX_ERROR_CODE,
  isStaticV1LatexSource,
  STATIC_V1_EAST_ASIAN_UNICODE_RANGE,
  STATIC_V1_LATIN_UNICODE_RANGE,
} from "contracts";
import { escapeHtml, fmt, pptdAngleToCss } from "./fill.ts";

export type TextFontFamily = string | { latin: string; ea: string };
export type TextFontScript = "latin" | "ea";
export type TextHorizontalAlign = "left" | "center" | "right" | "justify" | "distributed";
export type TextVerticalAlign = "top" | "middle" | "bottom";
export type TextDirection = "horizontal" | "vertical";

/** Frozen C6 projection slices. They are deliberately disjoint: a face
 * registered for one script cannot claim glyph selection for the other. */
export const LATIN_UNICODE_RANGE =
  STATIC_V1_LATIN_UNICODE_RANGE;
export const EAST_ASIAN_UNICODE_RANGE =
  STATIC_V1_EAST_ASIAN_UNICODE_RANGE;

/** list/list-item structure mirror (contracts' BentoParagraphListV4). */
export interface TextList {
  ordered?: boolean;
  marker?: string;
  indent?: number;
  style?: {
    align?: TextHorizontalAlign;
    lineHeight?: number | `${number}px`;
    letterSpacing?: number;
    marginTop?: number;
    marginLeft?: number;
    marker?: string;
  };
}

export interface TextRun {
  text: string;
  color?: string;
  fontSize?: number;
  fontFamily?: TextFontFamily;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  baselineShift?: "sup" | "sub";
  href?: string;
  latex?: string;
}

export interface TextParagraph {
  runs: TextRun[];
  align?: TextHorizontalAlign;
  lineHeight?: number | `${number}px`;
  margin?: { top?: number; left?: number; right?: number };
  list?: TextList;
}

/** Stable fail-closed error for canonical latex values that cannot form a
 * host marker. The pinned Temml seam remains responsible for non-empty TeX
 * syntax; this guard only enforces the shared static-v1 value grammar. */
export class StaticV1LatexValueError extends Error {
  readonly code = STATIC_V1_LATEX_ERROR_CODE;

  constructor(path = "text.latex") {
    super(`${STATIC_V1_LATEX_ERROR_CODE}: ${path} must be a non-empty string without leading or trailing whitespace`);
    this.name = STATIC_V1_LATEX_ERROR_CODE;
  }
}

/** Validate direct canonical projector input once before native projection.
 * The per-run compiler repeats the same contract at its public pure seam so
 * callers that bypass projectText cannot create a raw `$$` marker either. */
export function assertStaticV1TextLatex(
  paragraphs: readonly TextParagraphInput[],
  owner = "text",
): void {
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    for (const [runIndex, run] of paragraph.runs.entries()) {
      if (run.latex !== undefined && !isStaticV1LatexSource(run.latex)) {
        throw new StaticV1LatexValueError(`${owner}.paragraphs[${paragraphIndex}].runs[${runIndex}].latex`);
      }
    }
  }
}

/** Read-only input accepted by pure HTML compilers (tests and table cells may
 * hand the compiler immutable canonical snapshots). */
export type TextParagraphInput = Omit<TextParagraph, "runs"> & { runs: readonly TextRun[] };

export interface NormalizedTextParagraphPlan {
  kind: "paragraph" | "list";
  paragraphIndexes: number[];
  items: NormalizedTextParagraphPlanItem[];
  list?: TextList;
  ordered?: boolean;
  listContainer?: NormalizedTextListContainerStyle;
}

export interface NormalizedTextParagraphStyle {
  /** Explicit UA reset is part of the normalized fact, not an encoder detail. */
  marginReset: "0";
  align?: TextHorizontalAlign;
  alignCss?: string;
  alignLast?: "justify";
  lineHeight?: string;
  margin?: { top?: number; left?: number; right?: number };
}

export interface NormalizedTextListItemStyle {
  align?: TextHorizontalAlign;
  alignCss?: string;
  alignLast?: "justify";
  lineHeight?: string;
  letterSpacing?: number;
  marginTop?: number;
  marginLeft?: number;
  marker?: string;
}

export interface NormalizedTextListContainerStyle {
  marginReset: "0";
  ordered: boolean;
  marker: string;
  indent?: number;
}

export interface NormalizedTextParagraphPlanItem {
  paragraphIndex: number;
  paragraphStyle: NormalizedTextParagraphStyle;
  listItemStyle?: NormalizedTextListItemStyle;
}

interface NormalizedTextStyleDeclaration {
  property: string;
  value: string;
}

function normalizedParagraphStyle(paragraph: Pick<TextParagraph, "align" | "lineHeight" | "margin">): NormalizedTextParagraphStyle {
  const style: NormalizedTextParagraphStyle = { marginReset: "0" };
  if (paragraph.align !== undefined) {
    style.align = paragraph.align;
    style.alignCss = horizontalAlignCss(paragraph.align);
    if (paragraph.align === "distributed") style.alignLast = "justify";
  }
  const lineHeight = lineHeightCss(paragraph.lineHeight, undefined);
  if (lineHeight !== undefined) style.lineHeight = lineHeight;
  if (paragraph.margin !== undefined) style.margin = { ...paragraph.margin };
  return style;
}

function normalizedListItemStyle(list: TextList): NormalizedTextListItemStyle {
  const style: NormalizedTextListItemStyle = {};
  if (list.style?.align !== undefined) {
    style.align = list.style.align;
    style.alignCss = horizontalAlignCss(list.style.align);
    if (list.style.align === "distributed") style.alignLast = "justify";
  }
  const lineHeight = lineHeightCss(list.style?.lineHeight, undefined);
  if (lineHeight !== undefined) style.lineHeight = lineHeight;
  if (list.style?.letterSpacing !== undefined) style.letterSpacing = list.style.letterSpacing;
  if (list.style?.marginTop !== undefined) style.marginTop = list.style.marginTop;
  if (list.style?.marginLeft !== undefined) style.marginLeft = list.style.marginLeft;
  const marker = list.style?.marker ?? list.marker;
  if (marker !== undefined) style.marker = marker;
  return style;
}

function normalizedListContainerStyle(list: TextList): NormalizedTextListContainerStyle {
  const ordered = list.ordered === true;
  return {
    marginReset: "0",
    ordered,
    marker: list.marker ?? (ordered ? "decimal" : "disc"),
    ...(list.indent !== undefined ? { indent: list.indent } : {}),
  };
}

function sameListContainer(
  left: NormalizedTextListContainerStyle,
  right: NormalizedTextListContainerStyle,
): boolean {
  return left.ordered === right.ordered
    && left.marker === right.marker
    && left.indent === right.indent;
}

/**
 * Normalize paragraph structure once for every text host. A list block is a
 * contiguous run of paragraphs with the same effective container facts
 * (ordered/marker/indent); the paragraph and list-item style layers remain
 * attached to each source index. A later indent or marker therefore starts a
 * new list container instead of silently inheriting the first item's values.
 * Native decoration and inline table HTML only choose different DOM encodings
 * after this plan is built, so grouping and precedence cannot drift.
 */
export function normalizedTextParagraphPlan(
  paragraphs: readonly Pick<TextParagraph, "align" | "lineHeight" | "margin" | "list">[],
): NormalizedTextParagraphPlan[] {
  const plan: NormalizedTextParagraphPlan[] = [];
  let index = 0;
  while (index < paragraphs.length) {
    const paragraph = paragraphs[index]!;
    if (paragraph.list === undefined) {
      plan.push({
        kind: "paragraph",
        paragraphIndexes: [index],
        items: [{ paragraphIndex: index, paragraphStyle: normalizedParagraphStyle(paragraph) }],
      });
      index += 1;
      continue;
    }
    const listContainer = normalizedListContainerStyle(paragraph.list);
    const paragraphIndexes: number[] = [];
    let next = index;
    while (next < paragraphs.length) {
      const item = paragraphs[next]!;
      if (item.list === undefined || !sameListContainer(listContainer, normalizedListContainerStyle(item.list))) break;
      paragraphIndexes.push(next);
      next += 1;
    }
    const items = paragraphIndexes.map((paragraphIndex) => {
      const item = paragraphs[paragraphIndex]!;
      return {
        paragraphIndex,
        paragraphStyle: normalizedParagraphStyle(item),
        listItemStyle: normalizedListItemStyle(item.list!),
      };
    });
    plan.push({
      kind: "list",
      paragraphIndexes,
      items,
      list: paragraph.list,
      ordered: listContainer.ordered,
      listContainer,
    });
    index = next;
  }
  return plan;
}

export interface TextGradient {
  type: "gradient";
  gradientType: "linear" | "radial";
  angle?: number;
  stops: ReadonlyArray<{ position: number; color: string }>;
}

export interface TextContent {
  paragraphs: TextParagraph[];
  color?: string;
  fontSize?: number;
  fontFamily?: TextFontFamily;
  bold?: boolean;
  italic?: boolean;
  backgroundColor?: string;
  lineHeight?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  marginTop?: number;
  textDirection?: TextDirection;
  wrap?: boolean;
  align?: readonly [TextHorizontalAlign, TextVerticalAlign];
  gradient?: TextGradient;
}

/** Resolved element/cell layout. Optional fields mean explicit author input;
 * required fields are deterministic static-v1 facts. */
export interface TextLayout {
  fontSize: number;
  fontFamily: string;
  color: string;
  lineHeight: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  marginTop?: number;
  textDirection: TextDirection;
  wrap: boolean;
  align: TextHorizontalAlign;
  valign: TextVerticalAlign;
  bold?: boolean;
  italic?: boolean;
  backgroundColor?: string;
}

/** Canonical shadows use an `offset: [x, y]` tuple; Bento's native frame
 * consumes the same values as `x`/`y`. Keep this conversion in the shared text
 * renderer so text shadows cannot silently become the native 0,0 default. */
export interface TextShadowLike {
  blur: number;
  color: string;
  offset?: readonly [number, number];
}

export interface NativeTextShadowLike {
  blur: number;
  color: string;
  x?: number;
  y?: number;
}

export function nativeShadow(
  shadow: TextShadowLike | readonly TextShadowLike[] | undefined,
): NativeTextShadowLike | NativeTextShadowLike[] | undefined {
  if (shadow === undefined) return undefined;
  const convert = (value: TextShadowLike): NativeTextShadowLike => ({
    blur: value.blur,
    color: value.color,
    ...(value.offset !== undefined ? { x: value.offset[0], y: value.offset[1] } : {}),
  });
  if ("blur" in shadow) return convert(shadow);
  return shadow.map(convert);
}

/** CSS family projection shared by text, table-cell, and chart hosts. String
 * stacks stay intact; object faces use the same stable role aliases as native
 * @font-face registration. */
export function fontFamilyCss(
  family: TextFontFamily | undefined,
  fontAliases?: ReadonlyMap<string, string>,
): string {
  return staticV1FontFamilyCss(family, fontAliases);
}

/** One resolver consumed by project.ts, text.rich, and table.ts. */
export function resolveTextLayout(
  content: TextContent,
  fontAliases?: ReadonlyMap<string, string>,
): TextLayout {
  const [align = "left", valign = "middle"] = content.align ?? [];
  const resolved = resolveStaticV1TextStyle(content);
  const layout: TextLayout = {
    fontSize: resolved.fontSize,
    fontFamily: fontFamilyCss(resolved.fontFamily, fontAliases),
    color: resolved.color,
    lineHeight: resolved.lineHeight,
    textDirection: content.textDirection ?? "horizontal",
    wrap: content.wrap ?? true,
    align,
    valign,
  };
  if (content.lineHeightPx !== undefined) layout.lineHeightPx = content.lineHeightPx;
  if (content.letterSpacing !== undefined) layout.letterSpacing = content.letterSpacing;
  if (content.marginTop !== undefined) layout.marginTop = content.marginTop;
  if (content.bold !== undefined) layout.bold = content.bold;
  if (content.italic !== undefined) layout.italic = content.italic;
  if (content.backgroundColor !== undefined) layout.backgroundColor = content.backgroundColor;
  return layout;
}

/** CSS has no reliably implemented `distributed`; justify + text-align-last
 * is its observable equivalent. Never use left as a fallback. */
export function horizontalAlignCss(value: string): string {
  return value === "justify" || value === "distributed" ? "justify" : value;
}

export function lineHeightCss(
  lineHeight: number | `${number}px` | undefined,
  lineHeightPx?: number,
): string | undefined {
  if (lineHeightPx !== undefined) return `${fmt(lineHeightPx)}px`;
  if (lineHeight === undefined) return undefined;
  return typeof lineHeight === "number" ? fmt(lineHeight) : lineHeight;
}

export function textDirectionCss(direction: TextDirection): string {
  return direction === "vertical" ? "vertical-rl" : "horizontal-tb";
}

const tag = (name: string, inner: string): string => `<${name}>${inner}</${name}>`;

/** Run source markup shared by native and inline adapter compilation. */
function textRunSourceHtml(run: TextRun): string {
  // Formula delimiters are part of the host contract. Escape the source before
  // wrapping it so direct canonical input cannot inject markup into the native
  // sanitizer/Temml path.
  if (run.latex !== undefined && !isStaticV1LatexSource(run.latex)) {
    throw new StaticV1LatexValueError("text.run.latex");
  }
  return run.latex !== undefined
    ? `$${escapeHtml(run.latex)}$${escapeHtml(run.text).replace(/\n/g, "<br>")}`
    : escapeHtml(run.text).replace(/\n/g, "<br>");
}

const ALLOWED_HREF_SCHEMES = new Set(["https", "http", "mailto"]);
const INLINE_LINK_COLOR = "#3564e6";

function assertAllowedHref(href: string): void {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  if (scheme === undefined || !ALLOWED_HREF_SCHEMES.has(scheme)) {
    throw new Error(`text hyperlink scheme 不在白名单（https/http/mailto）：${href}`);
  }
}

/** Run-level native styles retained by the pinned sanitizer. */
function nativeStyledText(run: TextRun): string {
  let out = textRunSourceHtml(run);
  if (run.strikethrough) out = tag("s", out);
  if (run.underline) out = tag("u", out);
  if (run.italic) out = tag("i", out);
  if (run.bold) out = tag("b", out);
  // Native rendering keeps the canonical run span, while the adapter's
  // decorator below repairs the anchor if a host sanitizer drops it.  Emit it
  // here as well so the pure projection and the production DOM path share the
  // same safe-link contract.
  if (run.href !== undefined) {
    assertAllowedHref(run.href);
    out = `<a href="${escapeHtml(run.href)}">${out}</a>`;
  }
  return out;
}

function gradientBackgroundCss(gradient: TextGradient | undefined): string | undefined {
  if (gradient === undefined || gradient.stops.length === 0) return undefined;
  const stops = gradient.stops.map((stop) => `${stop.color} ${fmt(stop.position * 100)}%`).join(", ");
  return gradient.gradientType === "radial"
    ? `radial-gradient(circle, ${stops})`
    : `linear-gradient(${pptdAngleToCss(gradient.angle ?? 90)}deg, ${stops})`;
}

function gradientTextStyle(gradient: TextGradient | undefined): string {
  const background = gradientBackgroundCss(gradient);
  if (background === undefined) return "";
  return `background-image:${background};-webkit-background-clip:text;background-clip:text;color:transparent`;
}

export interface TextHtmlCompileOptions {
  /** native keeps p/span anchors for the pinned sanitizer; inline emits the
   * complete adapter-owned p/list/run style surface (used by table cells). */
  mode: "native" | "inline";
  gradient?: TextGradient;
  /** Projection-owned role aliases; inline/table and text decorators share it. */
  fontAliases?: ReadonlyMap<string, string>;
  /** One normalized paragraph/list plan shared by both DOM encoders. */
  paragraphPlan?: readonly NormalizedTextParagraphPlan[];
}

/** Compile one canonical run at either of the two renderer seams. Keeping the
 * source/escaping and style vocabulary here prevents table/chart hosts from
 * growing a second rich-text interpreter. */
export function textRunHtml(run: TextRun, options: TextHtmlCompileOptions): string {
  if (options.mode === "native") return nativeStyledText(run);
  const parts: string[] = [];
  if (run.color !== undefined) parts.push(`color:${run.color}`);
  if (run.backgroundColor !== undefined) parts.push(`background-color:${run.backgroundColor}`);
  if (run.fontSize !== undefined) parts.push(`font-size:${fmt(run.fontSize)}px`);
  if (run.fontFamily !== undefined) parts.push(`font-family:${fontFamilyCss(run.fontFamily, options.fontAliases)}`);
  if (run.bold) parts.push("font-weight:700");
  if (run.italic) parts.push("font-style:italic");
  if (run.underline && run.strikethrough) parts.push("text-decoration:underline line-through");
  else if (run.underline) parts.push("text-decoration:underline");
  else if (run.strikethrough) parts.push("text-decoration:line-through");
  if (run.baselineShift !== undefined) parts.push(`vertical-align:${run.baselineShift === "sup" ? "super" : "sub"}`);
  const gradientStyle = gradientTextStyle(options.gradient);
  if (gradientStyle) parts.push(gradientStyle);

  let body = textRunSourceHtml(run);
  if (run.href !== undefined) {
    assertAllowedHref(run.href);
    const hrefParts: string[] = ["text-decoration:underline"];
    if (run.color === undefined) hrefParts.unshift(`color:${INLINE_LINK_COLOR}`);
    body = `<a href="${escapeHtml(run.href)}" style="${hrefParts.join(";")}">${body}</a>`;
  }
  return parts.length > 0 ? `<span style="${parts.join(";")}">${body}</span>` : `<span>${body}</span>`;
}

function normalizedParagraphDeclarations(
  paragraph: NormalizedTextParagraphStyle,
): NormalizedTextStyleDeclaration[] {
  const declarations: NormalizedTextStyleDeclaration[] = [
    { property: "margin", value: paragraph.marginReset },
  ];
  if (paragraph.alignCss !== undefined) declarations.push({ property: "text-align", value: paragraph.alignCss });
  if (paragraph.alignLast !== undefined) declarations.push({ property: "text-align-last", value: paragraph.alignLast });
  if (paragraph.lineHeight !== undefined) declarations.push({ property: "line-height", value: paragraph.lineHeight });
  if (paragraph.margin?.top !== undefined) declarations.push({ property: "margin-top", value: `${fmt(paragraph.margin.top)}px` });
  if (paragraph.margin?.left !== undefined) declarations.push({ property: "margin-left", value: `${fmt(paragraph.margin.left)}px` });
  if (paragraph.margin?.right !== undefined) declarations.push({ property: "margin-right", value: `${fmt(paragraph.margin.right)}px` });
  return declarations;
}

/**
 * This is the only paragraph → list-item precedence table. Both the inline
 * encoder and the native DOM decorator consume these already ordered facts;
 * neither host reinterprets list.style or invents a UA default.
 */
function normalizedListItemDeclarations(
  item: NormalizedTextParagraphPlanItem,
): NormalizedTextStyleDeclaration[] {
  const declarations = normalizedParagraphDeclarations(item.paragraphStyle);
  const style = item.listItemStyle;
  if (style?.alignCss !== undefined) declarations.push({ property: "text-align", value: style.alignCss });
  if (style?.alignLast !== undefined) declarations.push({ property: "text-align-last", value: style.alignLast });
  if (style?.lineHeight !== undefined) declarations.push({ property: "line-height", value: style.lineHeight });
  if (style?.letterSpacing !== undefined) declarations.push({ property: "letter-spacing", value: `${fmt(style.letterSpacing)}px` });
  if (style?.marginTop !== undefined) declarations.push({ property: "margin-top", value: `${fmt(style.marginTop)}px` });
  if (style?.marginLeft !== undefined) declarations.push({ property: "margin-left", value: `${fmt(style.marginLeft)}px` });
  if (style?.marker !== undefined) declarations.push({ property: "list-style-type", value: style.marker });
  return declarations;
}

function declarationsCss(declarations: readonly NormalizedTextStyleDeclaration[]): string {
  return declarations.map(({ property, value }) => `${property}:${value}`).join(";") + ";";
}

/** Paragraph style compiler. `margin:0` is deliberate: table cells do not pass
 * through the text decorator's scoped UA reset, so omitting it would make an
 * unstyled p acquire browser 1em margins. */
export function textParagraphStyleCss(paragraph: NormalizedTextParagraphStyle): string {
  return declarationsCss(normalizedParagraphDeclarations(paragraph));
}

export function textListStyleCss(list: NormalizedTextListContainerStyle): string {
  const parts = [`margin:${list.marginReset}`, `list-style-type:${list.marker}`];
  if (list.indent !== undefined) parts.push(`padding-left:${fmt(list.indent)}px`);
  return parts.join(";") + ";";
}

/** Paragraph styles are emitted first and list-item overrides second. The
 * duplicate declarations are intentional: CSS's last declaration is the
 * frozen list-item precedence, while the ordered source keeps the two semantic
 * layers auditable in the payload. */
export function textListItemStyleCss(item: NormalizedTextParagraphPlanItem): string {
  return declarationsCss(normalizedListItemDeclarations(item));
}

/** Shared paragraph/list structure compiler. Native text deliberately keeps p
 * anchors for its post-sanitization decorator; inline mode is the complete
 * structure used by table cells. */
export function textParagraphsHtml(
  paragraphs: readonly TextParagraphInput[],
  options: TextHtmlCompileOptions,
): string {
  const plan = options.paragraphPlan ?? normalizedTextParagraphPlan(paragraphs);
  if (options.mode === "native") {
    return plan
      .flatMap((block) => block.paragraphIndexes)
      .map((index) => paragraphs[index]!)
      .map((paragraph) => `<p>${paragraph.runs.map((run) => `<span>${textRunHtml(run, options)}</span>`).join("")}</p>`)
      .join("");
  }
  const out: string[] = [];
  for (const block of plan) {
    const index = block.paragraphIndexes[0]!;
    const paragraph = paragraphs[index]!;
    if (block.kind === "paragraph") {
      const paragraphPlan = block.items[0]!;
      out.push(
        `<p style="${textParagraphStyleCss(paragraphPlan.paragraphStyle)}">`
          + `${paragraph.runs.map((run) => textRunHtml(run, options)).join("")}</p>`,
      );
      continue;
    }
    const ordered = block.ordered === true;
    const items = block.paragraphIndexes.map((itemIndex) => {
      const item = paragraphs[itemIndex]!;
      const itemPlan = block.items.find((candidate) => candidate.paragraphIndex === itemIndex)!;
      const itemStyle = textListItemStyleCss(itemPlan);
      return (
        `<li style="${itemStyle}">`
          + `${item.runs.map((run) => textRunHtml(run, options)).join("")}</li>`
      );
    });
    const listTag = ordered ? "ol" : "ul";
    out.push(`<${listTag} style="${textListStyleCss(block.listContainer!)}">${items.join("")}</${listTag}>`);
  }
  return out.join("");
}

/** Native structure anchor: one span per canonical run and one p per paragraph. */
export function nativeTextHtml(
  paragraphs: readonly TextParagraphInput[],
  paragraphPlan?: readonly NormalizedTextParagraphPlan[],
): string {
  return textParagraphsHtml(paragraphs, { mode: "native", paragraphPlan });
}

export interface RunAdapterStyle {
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  backgroundColor?: string;
  baselineShift?: "sup" | "sub";
  href?: string;
}

export interface ParagraphAdapterStyle {
  align?: TextHorizontalAlign;
  lineHeight?: number | `${number}px`;
  margin?: { top?: number; left?: number; right?: number };
  list?: TextList;
}

export interface RichTextStyle {
  p?: ParagraphAdapterStyle;
  runs: RunAdapterStyle[];
}

/** Adapter payload preserves the canonical p/run index, including list data. */
export function richStylesFor(
  paragraphs: readonly TextParagraph[],
  fontAliases?: ReadonlyMap<string, string>,
): RichTextStyle[] {
  return paragraphs.map((paragraph) => {
    const p: ParagraphAdapterStyle = {};
    if (paragraph.align !== undefined) p.align = paragraph.align;
    if (paragraph.lineHeight !== undefined) p.lineHeight = paragraph.lineHeight;
    if (paragraph.margin !== undefined) p.margin = { ...paragraph.margin };
    if (paragraph.list !== undefined) {
      p.list = {
        ...paragraph.list,
        ...(paragraph.list.style !== undefined ? { style: { ...paragraph.list.style } } : {}),
      };
    }
    return {
      ...(Object.keys(p).length > 0 ? { p } : {}),
      runs: paragraph.runs.map((run) => {
        const r: RunAdapterStyle = {};
        if (run.color !== undefined) r.color = run.color;
        if (run.fontSize !== undefined) r.fontSize = run.fontSize;
        if (run.fontFamily !== undefined) r.fontFamily = fontFamilyCss(run.fontFamily, fontAliases);
        if (run.backgroundColor !== undefined) r.backgroundColor = run.backgroundColor;
        if (run.baselineShift !== undefined) r.baselineShift = run.baselineShift;
        if (run.href !== undefined) r.href = run.href;
        return r;
      }),
    };
  });
}

/** Determine whether a post-native decorator is necessary. */
export function needsRichDecorator(content: TextContent): boolean {
  const adapterRun = content.paragraphs.some((p) =>
    p.runs.some(
      (run) =>
        run.color !== undefined ||
        run.fontSize !== undefined ||
        run.fontFamily !== undefined ||
        run.backgroundColor !== undefined ||
        run.baselineShift !== undefined ||
        run.href !== undefined,
    ),
  );
  const paragraphOverride = content.paragraphs.some(
    (p) => p.align !== undefined || p.lineHeight !== undefined || p.margin !== undefined || p.list !== undefined,
  );
  const radialGradient = content.gradient?.gradientType === "radial";
  // The vendor has no native fields for these rows. Explicit values are
  // replayed on the inner node even when their current CSS default is similar;
  // omission and an explicit author value must not become indistinguishable.
  const elementLayout =
    content.lineHeightPx !== undefined ||
    content.letterSpacing !== undefined ||
    content.marginTop !== undefined ||
    content.textDirection === "vertical" ||
    content.wrap === false ||
    content.align?.[0] === "justify" ||
    content.align?.[0] === "distributed" ||
    content.italic !== undefined;
  return adapterRun || paragraphOverride || radialGradient || content.backgroundColor !== undefined || elementLayout;
}

// ---- DOM decorator (browser only) -----------------------------------------

const PARAGRAPH_NORMALIZATION_STYLE_ID = "a1a2-text-p-margin-normalization";
export const TEXT_PARAGRAPH_UA_RESET_CSS = ".bento-text-inner p { margin: 0; }";

/** Normalize UA paragraph margins once; explicit paragraph margins are replayed
 * below. Node paths are side-effect free. */
export function injectTextParagraphNormalizationCss(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(PARAGRAPH_NORMALIZATION_STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = PARAGRAPH_NORMALIZATION_STYLE_ID;
  style.textContent = TEXT_PARAGRAPH_UA_RESET_CSS;
  document.head.appendChild(style);
}

interface RichTextFrameElement extends FrameHostElement {
  richStyles?: RichTextStyle[];
  paragraphPlan?: readonly NormalizedTextParagraphPlan[];
  textLayout?: TextLayout;
  gradient?: TextGradient;
  elementBackground?: string;
}

function applyRunStyle(span: HTMLElement, run: RunAdapterStyle): void {
  if (run.color !== undefined) span.style.color = run.color;
  if (run.fontSize !== undefined) span.style.fontSize = `${fmt(run.fontSize)}px`;
  if (run.fontFamily !== undefined) span.style.fontFamily = run.fontFamily;
  if (run.backgroundColor !== undefined) span.style.backgroundColor = run.backgroundColor;
  if (run.baselineShift !== undefined) span.style.verticalAlign = run.baselineShift === "sup" ? "super" : "sub";
  if (run.href !== undefined) {
    assertAllowedHref(run.href);
    // The pinned native sanitizer has historically differed across host
    // versions: some retain the emitted <a>, while others retain only the
    // run's span/text. Materialize the link at the decorator seam so the
    // production render path never reports hyperlink support from canonical
    // data alone. Keep the span as the run boundary and move its existing
    // children under one direct anchor, making this operation idempotent.
    const anchor = span.querySelector<HTMLAnchorElement>(":scope > a") ?? document.createElement("a");
    if (anchor.parentElement !== span) {
      while (span.firstChild !== null) anchor.appendChild(span.firstChild);
      span.appendChild(anchor);
    }
    anchor.setAttribute("href", run.href);
    if (run.color === undefined) span.style.color = "#3564e6";
    span.style.textDecoration = "underline";
    if (run.color === undefined) anchor.style.color = "#3564e6";
    anchor.style.textDecoration = "underline";
  }
}

function applyAlignment(node: HTMLElement, value: TextHorizontalAlign | string): void {
  node.style.textAlign = horizontalAlignCss(value);
  if (value === "distributed") node.style.textAlignLast = "justify";
}

function applyNormalizedDeclarations(
  node: HTMLElement,
  declarations: readonly NormalizedTextStyleDeclaration[],
): void {
  for (const declaration of declarations) node.style.setProperty(declaration.property, declaration.value);
}

function applyParagraphStyle(node: HTMLElement, style: NormalizedTextParagraphStyle): void {
  // Both native paragraphs and table-cell paragraphs enter here after the
  // browser's UA stylesheet. Resetting the whole margin first makes an absent
  // canonical margin deterministic; explicit top/left/right values below then
  // remain the only authored displacement.
  applyNormalizedDeclarations(node, normalizedParagraphDeclarations(style));
  if (style.align !== undefined) node.dataset.textAlign = style.align;
}

function applyRuns(node: HTMLElement, runs: readonly RunAdapterStyle[]): void {
  const spans = Array.from(node.querySelectorAll<HTMLElement>(":scope > span"));
  for (let i = 0; i < spans.length && i < runs.length; i += 1) applyRunStyle(spans[i]!, runs[i]!);
}

function applyListStyle(node: HTMLElement, item: NormalizedTextParagraphPlanItem): void {
  // The ordered declarations are the same facts serialized by
  // textListItemStyleCss; the DOM path only applies them mechanically.
  applyNormalizedDeclarations(node, normalizedListItemDeclarations(item));
  const style = item.listItemStyle;
  if (style?.align !== undefined) node.dataset.textAlign = style.align;
  node.dataset.listMarker = style?.marker ?? "";
}

function applyElementLayout(inner: HTMLElement, frameNode: HTMLElement, layout: TextLayout): void {
  inner.style.fontSize = `${fmt(layout.fontSize)}px`;
  inner.style.fontFamily = layout.fontFamily;
  inner.style.fontWeight = layout.bold === true ? "700" : "400";
  if (layout.italic !== undefined) inner.style.fontStyle = layout.italic ? "italic" : "normal";
  inner.style.color = layout.color;
  applyAlignment(inner, layout.align);
  inner.dataset.textAlign = layout.align;
  if (layout.lineHeightPx !== undefined) inner.style.lineHeight = `${fmt(layout.lineHeightPx)}px`;
  else inner.style.lineHeight = fmt(layout.lineHeight);
  if (layout.letterSpacing !== undefined) inner.style.letterSpacing = `${fmt(layout.letterSpacing)}px`;
  if (layout.marginTop !== undefined) inner.style.marginTop = `${fmt(layout.marginTop)}px`;
  inner.style.writingMode = textDirectionCss(layout.textDirection);
  inner.style.textOrientation = "mixed";
  inner.style.whiteSpace = layout.wrap ? "normal" : "nowrap";
  inner.style.overflowWrap = layout.wrap ? "break-word" : "normal";
  inner.style.wordBreak = layout.wrap ? "break-word" : "normal";
  // A nowrap text box is allowed to overflow its frame; clipping here would
  // make wrap=false look like truncation and would lose authored content.
  if (!layout.wrap) frameNode.style.overflow = "visible";
}

function applyTextGradient(inner: HTMLElement, gradient: TextGradient | undefined): void {
  const background = gradientBackgroundCss(gradient);
  if (background === undefined) return;
  inner.style.backgroundImage = background;
  inner.style.setProperty("-webkit-background-clip", "text");
  inner.style.setProperty("background-clip", "text");
  inner.style.color = "transparent";
}

/** Rebuild list paragraphs into real ul/ol/li nodes after native sanitizer. */
function decorateParagraphs(
  inner: HTMLElement,
  styles: readonly RichTextStyle[],
  paragraphPlan?: readonly NormalizedTextParagraphPlan[],
): void {
  const paragraphs = Array.from(inner.children).filter((el) => (el as HTMLElement).tagName === "P") as HTMLElement[];
  const plan = paragraphPlan ?? normalizedTextParagraphPlan(styles.map((style) => ({
    align: style.p?.align,
    lineHeight: style.p?.lineHeight,
    margin: style.p?.margin,
    list: style.p?.list,
  })));
  const rebuilt: HTMLElement[] = [];
  for (const block of plan) {
    const i = block.paragraphIndexes[0]!;
    if (block.kind === "list") {
      const listContainer = block.listContainer!;
      const ordered = listContainer.ordered;
      const listEl = document.createElement(ordered ? "ol" : "ul");
      listEl.style.margin = listContainer.marginReset;
      listEl.style.listStyleType = listContainer.marker;
      if (listContainer.indent !== undefined) listEl.style.paddingLeft = `${fmt(listContainer.indent)}px`;
      for (const j of block.paragraphIndexes) {
        const style = styles[j]!;
        const itemPlan = block.items.find((item) => item.paragraphIndex === j)!;
        const p = paragraphs[j]!;
        const li = document.createElement("li");
        while (p.firstChild) li.appendChild(p.firstChild);
        applyListStyle(li, itemPlan);
        applyRuns(li, style.runs);
        listEl.appendChild(li);
      }
      rebuilt.push(listEl);
      continue;
    }
    const p = paragraphs[i]!;
    const style = styles[i]!;
    applyParagraphStyle(p, block.items[0]!.paragraphStyle);
    applyRuns(p, style.runs);
    rebuilt.push(p);
  }
  // A stale projected view must not discard unindexed native paragraphs. The
  // canonical path is validated; this only protects the host boundary.
  for (let i = styles.length; i < paragraphs.length; i += 1) rebuilt.push(paragraphs[i]!);
  inner.replaceChildren(...rebuilt);
}

/** text.rich decorator: native DOM first, canonical adapter semantics second. */
export function renderTextRichDecorator(
  element: FrameHostElement,
  frameNode: HTMLElement,
  _ctx: FrameHostRenderContext,
): void {
  const inner = frameNode.querySelector<HTMLElement>(".bento-text-inner");
  if (!inner) return;
  const e = element as RichTextFrameElement;
  if (e.textLayout !== undefined) applyElementLayout(inner, frameNode, e.textLayout);
  applyTextGradient(inner, e.gradient);
  if (e.elementBackground !== undefined) inner.style.backgroundColor = e.elementBackground;
  if (e.richStyles !== undefined) decorateParagraphs(inner, e.richStyles, e.paragraphPlan);
}
