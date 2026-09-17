/**
 * graphic-canvas/static-v1 semantic facts.
 *
 * This module is intentionally pure and browser-safe. It owns only values and
 * deterministic parsing; concrete icon bytes live in a separately pinned shelf.
 * Canonical BentoDoc fields may omit these defaults: consumers resolve them at
 * projection/authoring time instead of persisting a second copy.
 */

import {
  STATIC_V1_ICON_MEMBERSHIP,
  type StaticV1IconMembership,
} from "./static-v1-icon-membership.ts";

export { STATIC_V1_ICON_MEMBERSHIP } from "./static-v1-icon-membership.ts";
export type { StaticV1IconMembership } from "./static-v1-icon-membership.ts";

/**
 * Image bytes admitted by the frozen static-v1 image.src surface.  Keep the
 * byte-level admission predicate in contracts so Node asset registration,
 * browser-safe intrinsic parsing, and every future host cannot drift apart.
 * SVG/WebP are intentionally outside this contract; they must not become an
 * accidental second rendering surface merely because a browser can decode
 * them.
 */
export type StaticV1ImageMimeType = "image/png" | "image/jpeg" | "image/gif";

const STATIC_V1_PNG_SIGNATURE = Object.freeze([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const STATIC_V1_JPEG_SIGNATURE = Object.freeze([0xff, 0xd8, 0xff]);
const STATIC_V1_GIF87_SIGNATURE = Object.freeze([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
const STATIC_V1_GIF89_SIGNATURE = Object.freeze([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

/** Return the one admitted image MIME for a byte sequence, or null. */
export function sniffStaticV1ImageMime(bytes: Uint8Array): StaticV1ImageMimeType | null {
  const startsWith = (signature: readonly number[]): boolean =>
    bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
  if (startsWith(STATIC_V1_PNG_SIGNATURE)) return "image/png";
  if (startsWith(STATIC_V1_JPEG_SIGNATURE)) return "image/jpeg";
  if (startsWith(STATIC_V1_GIF87_SIGNATURE) || startsWith(STATIC_V1_GIF89_SIGNATURE)) return "image/gif";
  return null;
}

export type StaticV1FontMimeType = "font/ttf" | "font/otf" | "font/woff" | "font/woff2";

const readU16 = (bytes: Uint8Array, offset: number): number | null =>
  offset + 2 <= bytes.length ? ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0 : null;
const readU32 = (bytes: Uint8Array, offset: number): number | null =>
  offset + 4 <= bytes.length
    ? ((bytes[offset]! * 0x1000000) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!) >>> 0
    : null;
const tagAt = (bytes: Uint8Array, offset: number): string | null =>
  offset + 4 <= bytes.length
    ? String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
    : null;

const REQUIRED_SFNT_TABLES = Object.freeze(["cmap", "head", "hhea", "hmtx", "maxp", "name"] as const);

function inspectSfnt(bytes: Uint8Array, offset: number): "font/ttf" | "font/otf" | null {
  const signature = tagAt(bytes, offset);
  const mime = signature === "OTTO"
    ? "font/otf"
    : readU32(bytes, offset) === 0x00010000 || signature === "true" || signature === "typ1"
      ? "font/ttf"
      : null;
  if (mime === null) return null;
  const count = readU16(bytes, offset + 4);
  if (count === null || count === 0 || count > 4096 || offset + 12 + count * 16 > bytes.length) return null;
  const tags = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const entry = offset + 12 + index * 16;
    const tag = tagAt(bytes, entry);
    const tableOffset = readU32(bytes, entry + 8);
    const tableLength = readU32(bytes, entry + 12);
    if (tag === null || tableOffset === null || tableLength === null || tableOffset > bytes.length || tableLength > bytes.length - tableOffset) {
      return null;
    }
    tags.add(tag);
  }
  return REQUIRED_SFNT_TABLES.every((tag) => tags.has(tag)) ? mime : null;
}

function inspectWoff(bytes: Uint8Array): "font/woff" | null {
  if (tagAt(bytes, 0) !== "wOFF" || bytes.length < 44 || readU32(bytes, 8) !== bytes.length) return null;
  const count = readU16(bytes, 12);
  if (count === null || count === 0 || count > 4096 || 44 + count * 20 > bytes.length) return null;
  const tags = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const entry = 44 + index * 20;
    const tag = tagAt(bytes, entry);
    const tableOffset = readU32(bytes, entry + 4);
    const compressedLength = readU32(bytes, entry + 8);
    const originalLength = readU32(bytes, entry + 12);
    if (tag === null || tableOffset === null || compressedLength === null || originalLength === null ||
      compressedLength > originalLength || tableOffset > bytes.length || compressedLength > bytes.length - tableOffset) return null;
    tags.add(tag);
  }
  return REQUIRED_SFNT_TABLES.every((tag) => tags.has(tag)) ? "font/woff" : null;
}

function inspectWoff2(bytes: Uint8Array): "font/woff2" | null {
  if (tagAt(bytes, 0) !== "wOF2" || bytes.length < 48 || readU32(bytes, 8) !== bytes.length) return null;
  const count = readU16(bytes, 12);
  const reserved = readU16(bytes, 14);
  const totalSfntSize = readU32(bytes, 16);
  const totalCompressedSize = readU32(bytes, 20);
  return count !== null && count > 0 && count <= 4096 && reserved === 0 && totalSfntSize !== null && totalSfntSize >= 12 &&
    totalCompressedSize !== null && totalCompressedSize > 0 && totalCompressedSize <= bytes.length - 48
    ? "font/woff2"
    : null;
}

/** Byte-level admission shared by authoring, asset registration, projection,
 * and export. This is deliberately structural rather than magic-only: a fake
 * header cannot become a registered face and defer failure to Chromium. */
export function sniffStaticV1FontMime(bytes: Uint8Array): StaticV1FontMimeType | null {
  if (tagAt(bytes, 0) === "ttcf") {
    const count = readU32(bytes, 8);
    if (count === null || count === 0 || count > 4096 || 12 + count * 4 > bytes.length) return null;
    for (let index = 0; index < count; index += 1) {
      const offset = readU32(bytes, 12 + index * 4);
      if (offset === null || inspectSfnt(bytes, offset) === null) return null;
    }
    return "font/ttf";
  }
  return inspectSfnt(bytes, 0) ?? inspectWoff(bytes) ?? inspectWoff2(bytes);
}

export const STATIC_V1_TEXT_DEFAULTS = Object.freeze({
  fontSize: 18,
  fontFamily: "MiSans",
  color: "#000000",
  lineHeight: 1,
} as const);

export const STATIC_V1_FONT_STACK_MAX_LENGTH = 300;
export const STATIC_V1_FONT_VALUE_ERROR_CODE = "PPTD-E013" as const;

type ParsedStaticV1FontStack = { faces: string[]; error: null } | { faces: []; error: string };

/** Parse the vendor-compatible static-v1 font stack without locale or CSS
 * interpretation. Quoted commas and backslash escapes remain one family;
 * every serializer consumes these decoded family names instead of splicing
 * the authored stack into CSS/HTML/SVG. */
function parseStaticV1FontStack(stack: unknown): ParsedStaticV1FontStack {
  if (typeof stack !== "string") return { faces: [], error: "font stack must be a string" };
  if (stack.length === 0) return { faces: [], error: "font stack must not be empty" };
  if (stack.length > STATIC_V1_FONT_STACK_MAX_LENGTH) {
    return { faces: [], error: `font stack must be at most ${STATIC_V1_FONT_STACK_MAX_LENGTH} characters` };
  }
  if (/[<>{}]/.test(stack)) return { faces: [], error: "font stack must not contain <, >, {, or }" };
  const faces: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  const finish = (): string | null => {
    const face = current.trim();
    current = "";
    if (face.length === 0) return "font stack contains an empty family";
    faces.push(face);
    return null;
  };
  for (const character of stack) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if ((character === "'" || character === '"') && current.trim().length === 0) {
      quote = character;
      continue;
    }
    if (character === ",") {
      const error = finish();
      if (error !== null) return { faces: [], error };
      continue;
    }
    current += character;
  }
  if (escaped) return { faces: [], error: "font stack ends with an incomplete escape" };
  if (quote !== null) return { faces: [], error: "font stack contains an unterminated quote" };
  const error = finish();
  return error === null ? { faces, error: null } : { faces: [], error };
}

/** Return one stable E013 reason for an invalid string/object family value. */
export function staticV1FontFamilyError(value: unknown): string | null {
  if (typeof value === "string") return parseStaticV1FontStack(value).error;
  if (!isRecord(value)) return "fontFamily must be a stack string or {latin, ea}";
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("latin") || !keys.includes("ea")) {
    return "fontFamily object must contain only latin and ea";
  }
  const latinError = parseStaticV1FontStack(value.latin).error;
  if (latinError !== null) return `fontFamily.latin ${latinError}`;
  const eastAsianError = parseStaticV1FontStack(value.ea).error;
  return eastAsianError === null ? null : `fontFamily.ea ${eastAsianError}`;
}

/** Validate a document registration identity. Unlike a usage stack this is
 * one literal family name, so commas/apostrophes are data rather than CSS
 * syntax. Surrounding quotes are forbidden: usages quote special names and
 * decode back to this exact canonical identity. */
export function staticV1FontRegistrationFamilyError(value: unknown): string | null {
  if (typeof value !== "string") return "registered font family must be a string";
  if (value.length === 0) return "registered font family must not be empty";
  if (value.length > STATIC_V1_FONT_STACK_MAX_LENGTH) {
    return `registered font family must be at most ${STATIC_V1_FONT_STACK_MAX_LENGTH} characters`;
  }
  if (value !== value.trim()) return "registered font family must not have surrounding whitespace";
  if (/^["']|["']$/.test(value)) return "registered font family must not be wrapped in CSS quotes";
  if (/[<>{}\u0000-\u001f\u007f]/.test(value)) return "registered font family contains a forbidden character";
  return null;
}

/** Decode a validated stack to source family names. */
export function staticV1FontStackFaces(stack: string): string[] {
  const parsed = parseStaticV1FontStack(stack);
  if (parsed.error !== null) {
    const error = new Error(`${STATIC_V1_FONT_VALUE_ERROR_CODE}: ${parsed.error}`);
    error.name = STATIC_V1_FONT_VALUE_ERROR_CODE;
    throw error;
  }
  return parsed.faces;
}

/** Static-v1's only canonical LaTeX value rule. This is intentionally not a
 * TeX parser: the pinned host owns syntax validation, while every upstream
 * consumer rejects empty or padded sources that would otherwise become an
 * ambiguous/raw host marker. Emitters must not silently trim this value. */
export const STATIC_V1_LATEX_ERROR_CODE = "PPTD-E013" as const;

export function isStaticV1LatexSource(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

/** Frozen C6 script partitions for the v4 {latin,ea} font-family contract.
 * The ranges are disjoint so an embedded Latin face cannot claim East-Asian
 * code points during Chromium fallback. */
export const STATIC_V1_LATIN_UNICODE_RANGE =
  "U+0000-024F,U+1D00-1DFF,U+1E00-1EFF,U+2C60-2C7F,U+A720-A7FF";
export const STATIC_V1_EAST_ASIAN_UNICODE_RANGE =
  "U+2E80-2FFF,U+3000-303F,U+3040-30FF,U+3100-312F,U+3130-318F,U+31A0-31BF,U+3400-4DBF,U+4E00-9FFF,U+A960-A97F,U+AC00-D7FF,U+F900-FAFF,U+FE10-FE1F,U+FE30-FE6F,U+FF00-FFEF";

/** Pinned vendor injectFonts' cssValue boundary. Keep registration descriptor
 * admission here so authoring, kernel and projection cannot disagree about
 * which strings are safe to interpolate into an @font-face rule. */
export const STATIC_V1_FONT_DESCRIPTOR_MAX_LENGTH = 64;

export function staticV1FontDescriptorError(value: unknown): string | null {
  if (typeof value !== "string") return "font descriptor must be a string";
  if (value.length > STATIC_V1_FONT_DESCRIPTOR_MAX_LENGTH) {
    return `font descriptor exceeds ${STATIC_V1_FONT_DESCRIPTOR_MAX_LENGTH} characters`;
  }
  if (/["'<>{};]/.test(value)) return "font descriptor contains a CSS breakout character";
  return null;
}

export type StaticV1FontScript = "latin" | "ea";
export type StaticV1FontFamily = string | { latin: string; ea: string };
export type StaticV1FontRole = StaticV1FontScript | "uniform";
export type StaticV1FontUsageContext = "top-level" | "run" | "table" | "cell" | "chart";

/** A canonical font use before any consumer-specific projection. `family` is
 * the registered source family; `projectedFamily` is the exact CSS/native
 * family that must be loaded for this role. Keeping both here lets the
 * registration and fingerprint consumers share one traversal and alias rule. */
export interface StaticV1FontUsage {
  family: string;
  projectedFamily: string;
  role: StaticV1FontRole;
  context: StaticV1FontUsageContext;
}

export type StaticV1FontAliasMap = ReadonlyMap<string, string>;

function fontAliasKey(family: string, script: StaticV1FontScript): string {
  return `${family}\u0000${script}`;
}

const FONT_USAGE_CONTEXT_ORDER: readonly StaticV1FontUsageContext[] = [
  "top-level",
  "run",
  "table",
  "cell",
  "chart",
];

const FONT_ROLE_ORDER: readonly StaticV1FontRole[] = ["uniform", "latin", "ea"];

/** Compare strings by UTF-16 code units, independent of host locale. */
export function staticV1CodeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Stable internal family carrier for an object-role face. Hex-encoding every
 * code point avoids collisions from punctuation/whitespace normalization and
 * produces a CSS-safe, deterministic name without a crypto/runtime dependency. */
export function staticV1FontFaceAlias(family: string, script: StaticV1FontScript): string {
  const token = Array.from(family)
    .map((character) => (character.codePointAt(0) ?? 0).toString(16).padStart(4, "0"))
    .join("");
  return `__bento_v1_${script}_${token || "empty"}`;
}

/** Return the exact family carrier used by projected CSS/@font-face rules. */
export function staticV1FontProjectionFamily(
  family: string,
  script: StaticV1FontScript,
  aliases?: StaticV1FontAliasMap,
): string {
  // Built-in/system families have no doc.fonts source to alias. They remain
  // direct CSS fallbacks; registered custom faces use isolated role aliases.
  return isStaticV1FontRegistrationOptional(family)
    ? family
    : aliases?.get(fontAliasKey(family, script)) ?? staticV1FontFaceAlias(family, script);
}

/** Allocate role aliases against every source family in a document. A user is
 * allowed to choose any family string, including our readable prefix, so the
 * allocator reserves all source names and deterministically suffixes a base
 * alias on collision. */
export function staticV1FontProjectionAliases(
  usages: readonly Pick<StaticV1FontUsage, "family" | "role">[],
  occupiedFamilies: readonly string[] = [],
): Map<string, string> {
  // Registered faces are occupied even when no current element uses them:
  // native registration still emits their unsliced source family. Reserving
  // them here prevents an unused user family from colliding with a generated
  // object-role carrier later consumed by CSS/fingerprint.
  const sourceFamilies = new Set([
    ...usages.map((usage) => usage.family),
    ...occupiedFamilies,
  ]);
  const allocated = new Set(sourceFamilies);
  const aliases = new Map<string, string>();
  const roleUsages = [...new Set(
    usages
      .filter((usage): usage is Pick<StaticV1FontUsage, "family" | "role"> & { role: StaticV1FontScript } => usage.role !== "uniform")
      .map((usage) => fontAliasKey(usage.family, usage.role)),
  )].sort(staticV1CodeUnitCompare);
  for (const key of roleUsages) {
    const separator = key.lastIndexOf("\u0000");
    const family = key.slice(0, separator);
    const script = key.slice(separator + 1) as StaticV1FontScript;
    if (isStaticV1FontRegistrationOptional(family)) {
      aliases.set(key, family);
      continue;
    }
    const base = staticV1FontFaceAlias(family, script);
    let candidate = base;
    let suffix = 1;
    while (allocated.has(candidate)) candidate = `${base}_${suffix++}`;
    allocated.add(candidate);
    aliases.set(key, candidate);
  }
  return aliases;
}

/** Resolve the {latin,ea} form to the same role-isolated CSS stack used by
 * text, table-cell, and chart hosts. Uniform string stacks remain unchanged. */
export function staticV1FontFamilyCss(
  family: StaticV1FontFamily | undefined,
  aliases?: StaticV1FontAliasMap,
): string {
  const resolved = family ?? STATIC_V1_TEXT_DEFAULTS.fontFamily;
  const error = staticV1FontFamilyError(resolved);
  if (error !== null) throw new Error(`${STATIC_V1_FONT_VALUE_ERROR_CODE}: ${error}`);
  if (typeof resolved === "string") return staticV1FontStackFaces(resolved).map(cssFamilyName).join(", ");
  const latin = staticV1FontStackFaces(resolved.latin)
    .map((name) => cssFamilyName(staticV1FontProjectionFamily(name, "latin", aliases)));
  const eastAsian = staticV1FontStackFaces(resolved.ea)
    .map((name) => cssFamilyName(staticV1FontProjectionFamily(name, "ea", aliases)));
  return [...latin, ...eastAsian, "sans-serif"].join(", ");
}

/** Expand one family into the registered face names and optional C6 role. */
export function staticV1FontFamilyFaces(
  family: StaticV1FontFamily | undefined,
): Array<{ family: string; script?: StaticV1FontScript }> {
  if (family === undefined) return [];
  if (typeof family === "string") return staticV1FontStackFaces(family).map((name) => ({ family: name }));
  return [
    ...staticV1FontStackFaces(family.latin).map((name) => ({ family: name, script: "latin" as const })),
    ...staticV1FontStackFaces(family.ea).map((name) => ({ family: name, script: "ea" as const })),
  ];
}

/** CSS/system faces and the pinned profile face do not require customFonts registration. */
export const STATIC_V1_REGISTRATION_OPTIONAL_FONT_FAMILIES = Object.freeze([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "math",
  "fangsong",
  "emoji",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
] as const);

const REGISTRATION_OPTIONAL_FONT_SET = new Set<string>(
  STATIC_V1_REGISTRATION_OPTIONAL_FONT_FAMILIES,
);

const CSS_GENERIC_FONT_SET = new Set<string>(STATIC_V1_REGISTRATION_OPTIONAL_FONT_FAMILIES);

const cssFamilyName = (name: string): string => {
  const lower = name.toLowerCase();
  if (CSS_GENERIC_FONT_SET.has(lower)) return lower;
  if (/^-?[_a-zA-Z][_a-zA-Z0-9-]*(?:\s+[_a-zA-Z][_a-zA-Z0-9-]*)*$/.test(name)) return name;
  return `'${name
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replace(/[\u0000-\u001f\u007f]/g, (character) => `\\${character.codePointAt(0)!.toString(16)} `)}'`;
};

/** One predicate for validator and importer font-registration obligations. */
export function isStaticV1FontRegistrationOptional(face: string): boolean {
  const lower = face.toLowerCase();
  return face === STATIC_V1_TEXT_DEFAULTS.fontFamily ||
    REGISTRATION_OPTIONAL_FONT_SET.has(lower);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface StaticV1FontPlan {
  aliases: StaticV1FontAliasMap;
  usages: StaticV1FontUsage[];
}

export interface StaticV1FontRegistrationFace {
  family: string;
  src: string;
  weight?: string;
  style?: string;
}

/** Exact native/browser face emitted for one canonical registration. */
export interface StaticV1ProjectedFontFace {
  family: string;
  sourceFamily: string;
  sourceRef: string;
  role: StaticV1FontRole;
  weight?: string;
  style?: string;
  unicodeRange?: string;
  contexts: StaticV1FontUsageContext[];
}

export interface StaticV1FontFingerprintRequest {
  /** Exact projected family emitted by CSS/native registration. */
  family: string;
  /** Source family used to find registered bytes; aliases remain inspectable. */
  sourceFamily: string;
  sourceFamilies: string[];
  /** Exact canonical asset reference for a registered face. */
  sourceRef?: string;
  weight: string;
  style: string;
  unicodeRange: string;
  contexts: StaticV1FontUsageContext[];
  scripts: StaticV1FontRole[];
}

/**
 * Canonical text-host traversal for font registration and render fingerprint.
 * It intentionally follows the v4 host vocabulary instead of recursively
 * interpreting arbitrary `fontFamily` keys: table slots are table context,
 * cells are cell context, text runs are run context, and chart text surfaces
 * are chart context. Consumers may group these records differently, but may
 * not invent a second family/role/context walk.
 */
function collectRawStaticV1FontUsages(
  elements: readonly unknown[],
): StaticV1FontUsage[] {
  const usages = new Map<string, StaticV1FontUsage>();
  const add = (value: unknown, context: StaticV1FontUsageContext): void => {
    if (value === undefined) return;
    const error = staticV1FontFamilyError(value);
    if (error !== null) {
      const cause = new Error(`${STATIC_V1_FONT_VALUE_ERROR_CODE}: invalid ${context} fontFamily: ${error}`);
      cause.name = STATIC_V1_FONT_VALUE_ERROR_CODE;
      throw cause;
    }
    for (const face of staticV1FontFamilyFaces(value as StaticV1FontFamily)) {
      const role: StaticV1FontRole = face.script ?? "uniform";
      // Projection is deliberately deferred until the complete traversal has
      // reserved every source family.  This raw record is the single source
      // for family/role/context; staticV1FontPlan assigns the collision-safe
      // carrier once, then both registration and fingerprint consume it.
      const projectedFamily = face.family;
      const key = `${face.family}\u0000${role}\u0000${context}`;
      usages.set(key, { family: face.family, projectedFamily, role, context });
    }
  };
  const addChartFamilies = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) addChartFamilies(item);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "fontFamily") add(child, "chart");
      else addChartFamilies(child);
    }
  };
  const addTextRuns = (text: unknown): void => {
    if (!isRecord(text) || !Array.isArray(text.paragraphs)) return;
    for (const paragraph of text.paragraphs) {
      if (!isRecord(paragraph) || !Array.isArray(paragraph.runs)) continue;
      for (const run of paragraph.runs) {
        if (isRecord(run)) add(run.fontFamily, "run");
      }
    }
  };
  const addTableStyle = (style: unknown): void => {
    if (!isRecord(style)) return;
    for (const slot of [
      style.cellStyle,
      style.firstRowStyle,
      style.lastRowStyle,
      style.firstColumnStyle,
      style.lastColumnStyle,
      ...(Array.isArray(style.bodyStyles) ? style.bodyStyles : []),
    ]) {
      if (isRecord(slot)) add(slot.fontFamily, "table");
    }
  };

  for (const element of elements) {
    if (!isRecord(element)) continue;
    if (element.kind === "text") {
      const text = element.text;
      if (isRecord(text)) {
        add(text.fontFamily ?? STATIC_V1_TEXT_DEFAULTS.fontFamily, "top-level");
        addTextRuns(text);
      }
      continue;
    }
    if (element.kind === "table") {
      const table = element.table;
      if (isRecord(table)) {
        addTableStyle(table.style);
        if (Array.isArray(table.rows)) {
          for (const row of table.rows) {
            if (!Array.isArray(row)) continue;
            for (const cell of row) {
              if (!isRecord(cell)) continue;
              add(cell.fontFamily ?? STATIC_V1_TEXT_DEFAULTS.fontFamily, "cell");
              const text = cell.text;
              if (isRecord(text)) {
                add(text.fontFamily, "cell");
                addTextRuns(text);
              }
            }
          }
        }
      }
      continue;
    }
    if (element.kind === "chart") {
      const chart = element.chart;
      if (isRecord(chart)) add(chart.fontFamily ?? STATIC_V1_TEXT_DEFAULTS.fontFamily, "chart");
      addChartFamilies(chart);
    }
  }

  const contextIndex = (context: StaticV1FontUsageContext): number => FONT_USAGE_CONTEXT_ORDER.indexOf(context);
  const roleIndex = (role: StaticV1FontRole): number => FONT_ROLE_ORDER.indexOf(role);
  return [...usages.values()]
    .sort((a, b) =>
      staticV1CodeUnitCompare(a.projectedFamily, b.projectedFamily) ||
      staticV1CodeUnitCompare(a.family, b.family) ||
      roleIndex(a.role) - roleIndex(b.role) ||
      contextIndex(a.context) - contextIndex(b.context));
}

/** Build the one document-level role projection consumed by native fonts,
 * CSS emitters, and the render fingerprint. Alias allocation happens only
 * after traversal has reserved every source family, including user names that
 * happen to resemble generated carriers. */
export function staticV1FontPlan(
  elements: readonly unknown[],
  registeredFamilies: readonly string[] = [],
): StaticV1FontPlan {
  const rawUsages = collectRawStaticV1FontUsages(elements);
  const aliases = staticV1FontProjectionAliases(rawUsages, registeredFamilies);
  const contextIndex = (context: StaticV1FontUsageContext): number => FONT_USAGE_CONTEXT_ORDER.indexOf(context);
  const roleIndex = (role: StaticV1FontRole): number => FONT_ROLE_ORDER.indexOf(role);
  const usages = rawUsages
    .map((usage) => ({
      ...usage,
      projectedFamily: usage.role === "uniform"
        ? usage.family
        : staticV1FontProjectionFamily(usage.family, usage.role, aliases),
    }))
    .sort((a, b) =>
      staticV1CodeUnitCompare(a.projectedFamily, b.projectedFamily) ||
      staticV1CodeUnitCompare(a.family, b.family) ||
      roleIndex(a.role) - roleIndex(b.role) ||
      contextIndex(a.context) - contextIndex(b.context));
  return { aliases, usages };
}

/** Return every non-system family used by canonical elements but absent from
 * the document font registry. Authoring, kernel and projection consume this
 * exact obligation instead of independently splitting CSS stacks. */
export function staticV1UnregisteredFontFamilies(
  elements: readonly unknown[],
  registeredFamilies: readonly string[],
): string[] {
  const registered = new Set(registeredFamilies);
  return [...new Set(
    staticV1FontPlan(elements, registeredFamilies).usages
      .map((usage) => usage.family)
      .filter((family) => !isStaticV1FontRegistrationOptional(family) && !registered.has(family)),
  )].sort(staticV1CodeUnitCompare);
}

/** Project every canonical registration into the exact face identities emitted
 * by native @font-face rules. Unused registrations deliberately retain one
 * uniform face with no usage contexts: registration itself promises that the
 * sealed host can inject and load those bytes. */
export function staticV1ProjectedFontFaces(
  elements: readonly unknown[],
  registeredFonts: readonly StaticV1FontRegistrationFace[] = [],
): StaticV1ProjectedFontFace[] {
  const registeredFamilies = registeredFonts.map((font) => font.family);
  const plan = staticV1FontPlan(elements, registeredFamilies);
  const rolesByFamily = new Map<string, Set<StaticV1FontRole>>();
  for (const usage of plan.usages) {
    const roles = rolesByFamily.get(usage.family) ?? new Set<StaticV1FontRole>();
    roles.add(usage.role);
    rolesByFamily.set(usage.family, roles);
  }
  const rangeFor = (role: StaticV1FontRole): string | undefined => role === "latin"
    ? STATIC_V1_LATIN_UNICODE_RANGE
    : role === "ea"
      ? STATIC_V1_EAST_ASIAN_UNICODE_RANGE
      : undefined;
  return registeredFonts.flatMap((font) => {
    const familyError = staticV1FontRegistrationFamilyError(font.family);
    if (familyError !== null) {
      const cause = new Error(`${STATIC_V1_FONT_VALUE_ERROR_CODE}: invalid font registration family: ${familyError}`);
      cause.name = STATIC_V1_FONT_VALUE_ERROR_CODE;
      throw cause;
    }
    for (const [name, value] of [["weight", font.weight], ["style", font.style]] as const) {
      if (value === undefined) continue;
      const descriptorError = staticV1FontDescriptorError(value);
      if (descriptorError !== null) {
        const cause = new Error(`${STATIC_V1_FONT_VALUE_ERROR_CODE}: invalid font registration ${name}: ${descriptorError}`);
        cause.name = STATIC_V1_FONT_VALUE_ERROR_CODE;
        throw cause;
      }
    }
    const usedRoles = rolesByFamily.get(font.family);
    const roles: StaticV1FontRole[] = usedRoles === undefined || isStaticV1FontRegistrationOptional(font.family)
      ? ["uniform"]
      : FONT_ROLE_ORDER.filter((role) => usedRoles.has(role));
    return roles.map((role) => {
      const family = role === "uniform"
        ? font.family
        : staticV1FontProjectionFamily(font.family, role, plan.aliases);
      return {
        family,
        sourceFamily: font.family,
        sourceRef: font.src,
        role,
        ...(font.weight !== undefined ? { weight: font.weight } : {}),
        ...(font.style !== undefined ? { style: font.style } : {}),
        ...(rangeFor(role) !== undefined ? { unicodeRange: rangeFor(role) } : {}),
        contexts: plan.usages
          .filter((usage) => usage.family === font.family && usage.projectedFamily === family &&
            (role === usage.role || (role === "uniform" && isStaticV1FontRegistrationOptional(font.family))))
          .map((usage) => usage.context),
      };
    });
  });
}

/** Group the canonical plan into the exact family requests consumed by the
 * render fingerprint. Keeping this grouping beside alias allocation prevents
 * a collision-safe CSS/native family from drifting from its browser probe. */
export function staticV1FontFingerprintRequests(
  elements: readonly unknown[],
  registeredFonts: readonly StaticV1FontRegistrationFace[] = [],
): StaticV1FontFingerprintRequest[] {
  const projectedFaces = staticV1ProjectedFontFaces(elements, registeredFonts);
  const registeredFamilies = registeredFonts.map((font) => font.family);
  const groups = new Map<string, {
    family: string;
    sourceFamilies: Set<string>;
    contexts: Set<StaticV1FontUsageContext>;
    scripts: Set<StaticV1FontRole>;
  }>();
  for (const usage of staticV1FontPlan(elements, registeredFamilies).usages) {
    if (projectedFaces.some((face) => face.family === usage.projectedFamily && face.sourceFamily === usage.family)) {
      continue;
    }
    const group = groups.get(usage.projectedFamily) ?? {
      family: usage.projectedFamily,
      sourceFamilies: new Set<string>(),
      contexts: new Set<StaticV1FontUsageContext>(),
      scripts: new Set<StaticV1FontRole>(),
    };
    group.sourceFamilies.add(usage.family);
    group.contexts.add(usage.context);
    group.scripts.add(usage.role);
    groups.set(usage.projectedFamily, group);
  }
  const requests: StaticV1FontFingerprintRequest[] = [...groups.values()]
    .sort((a, b) => staticV1CodeUnitCompare(a.family, b.family))
    .map((group) => {
      const sourceFamilies = [...group.sourceFamilies].sort(staticV1CodeUnitCompare);
      return {
        family: group.family,
        sourceFamily: sourceFamilies[0]!,
        sourceFamilies,
        weight: "normal",
        style: "normal",
        unicodeRange: "",
        contexts: [...group.contexts].sort(staticV1CodeUnitCompare),
        scripts: [...group.scripts].sort(staticV1CodeUnitCompare),
      };
    });
  requests.push(...projectedFaces.map((face) => ({
    family: face.family,
    sourceFamily: face.sourceFamily,
    sourceFamilies: [face.sourceFamily],
    sourceRef: face.sourceRef,
    weight: face.weight ?? "normal",
    style: face.style ?? "normal",
    unicodeRange: face.unicodeRange ?? "",
    contexts: [...face.contexts].sort(staticV1CodeUnitCompare),
    scripts: [face.role],
  })));
  return requests.sort((left, right) =>
    staticV1CodeUnitCompare(left.family, right.family) ||
    staticV1CodeUnitCompare(left.weight, right.weight) ||
    staticV1CodeUnitCompare(left.style, right.style) ||
    staticV1CodeUnitCompare(left.unicodeRange, right.unicodeRange) ||
    staticV1CodeUnitCompare(left.sourceRef ?? "", right.sourceRef ?? ""));
}

export interface StaticV1TextStyleInput {
  fontSize?: number;
  fontFamily?: string | { latin: string; ea: string };
  color?: string;
  lineHeight?: number;
}

export interface ResolvedStaticV1TextStyle {
  fontSize: number;
  fontFamily: string | { latin: string; ea: string };
  color: string;
  lineHeight: number;
}

/** Resolve derivable text defaults without mutating or materializing canonical state. */
export function resolveStaticV1TextStyle(
  input: Readonly<StaticV1TextStyleInput> = {},
): ResolvedStaticV1TextStyle {
  return {
    fontSize: input.fontSize ?? STATIC_V1_TEXT_DEFAULTS.fontSize,
    fontFamily: input.fontFamily ?? STATIC_V1_TEXT_DEFAULTS.fontFamily,
    color: input.color ?? STATIC_V1_TEXT_DEFAULTS.color,
    lineHeight: input.lineHeight ?? STATIC_V1_TEXT_DEFAULTS.lineHeight,
  };
}

/** Modeled OOXML preset subset for shape elements in static-v1. */
export const STATIC_V1_SHAPE_PRESETS = Object.freeze([
  "rect",
  "roundRect",
  "ellipse",
  "oval",
  "triangle",
  "arrow",
] as const);

export type StaticV1ShapePreset = (typeof STATIC_V1_SHAPE_PRESETS)[number];
export type StaticV1ShapeName = StaticV1ShapePreset | "custom";

/** Modeled mask subset for image.cropShape in static-v1. */
export const STATIC_V1_CROP_SHAPES = Object.freeze([
  "rect",
  "roundRect",
  "ellipse",
  "oval",
  "triangle",
  "custom",
] as const);

export type StaticV1CropShape = (typeof STATIC_V1_CROP_SHAPES)[number];

const SHAPE_PRESET_SET = new Set<string>(STATIC_V1_SHAPE_PRESETS);
const CROP_SHAPE_SET = new Set<string>(STATIC_V1_CROP_SHAPES);

export function isStaticV1ShapePreset(value: unknown): value is StaticV1ShapePreset {
  return typeof value === "string" && SHAPE_PRESET_SET.has(value);
}

export function isStaticV1ShapeName(value: unknown): value is StaticV1ShapeName {
  return value === "custom" || isStaticV1ShapePreset(value);
}

/**
 * Validate the finite static-v1 adjustment vocabulary for one modeled shape.
 * `undefined` is the derivable default for every preset; an explicitly present
 * array must match the preset's exact schema so no consumer can silently ignore
 * surplus geometry parameters.
 */
export function staticV1ShapeAdjustmentsError(
  shapeName: StaticV1ShapeName,
  adjustments: readonly number[] | undefined,
): string | null {
  if (adjustments === undefined) return null;
  if (!Array.isArray(adjustments) || !adjustments.every(Number.isFinite)) {
    return `${shapeName} adjustments must contain only finite numbers`;
  }
  switch (shapeName) {
    case "rect":
    case "ellipse":
    case "oval":
    case "custom":
      return `${shapeName} forbids adjustments in static-v1`;
    case "roundRect":
      if (adjustments.length !== 1) return "roundRect adjustments must contain exactly one radius";
      return adjustments[0]! >= 0 && adjustments[0]! <= 50000
        ? null
        : "roundRect radius must be in [0, 50000]";
    case "triangle":
      return adjustments.length === 1 && adjustments[0] === 50000
        ? null
        : "triangle adjustments must be [50000] when present";
    case "arrow":
      return adjustments.length === 2 && adjustments[0] === 50000 && adjustments[1] === 50000
        ? null
        : "arrow adjustments must be [50000, 50000] when present";
  }
}

/** Fail closed at direct-canonical/render seams using the same vocabulary as validators. */
export function assertStaticV1ShapeAdjustments(
  shapeName: StaticV1ShapeName,
  adjustments: readonly number[] | undefined,
): void {
  const error = staticV1ShapeAdjustmentsError(shapeName, adjustments);
  if (error !== null) throw new Error(error);
}

export function isStaticV1CropShape(value: unknown): value is StaticV1CropShape {
  return typeof value === "string" && CROP_SHAPE_SET.has(value);
}

export function isStaticV1ViewBox(value: unknown): value is [number, number] {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === "number" && Number.isFinite(part) && part > 0);
}

const STATIC_V1_SVG_PATH_COMMANDS = new Set(["M", "L", "H", "V", "C", "S", "Q", "A", "Z"]);

/** Return null for the modeled static-v1 SVG path subset, otherwise a named reason. */
export function staticV1SvgPathSyntaxError(pathValue: string): string | null {
  if (pathValue.length === 0) return "path is empty";
  let index = 0;
  let commandCount = 0;
  let pendingNumbers = 0;
  let first = true;
  let lastCommand = "";
  while (index < pathValue.length) {
    const char = pathValue[index]!;
    if (/\s|,/.test(char)) {
      index += 1;
      continue;
    }
    if (/[a-zA-Z]/.test(char)) {
      const upper = char.toUpperCase();
      if (!STATIC_V1_SVG_PATH_COMMANDS.has(upper)) {
        return `command "${char}" is outside M/L/H/V/C/S/Q/A/Z`;
      }
      if (first && upper !== "M") return "path must begin with M";
      if (pendingNumbers > 0) return `command ${lastCommand} has too few parameters`;
      commandCount += 1;
      first = false;
      lastCommand = upper;
      pendingNumbers = upper === "Z"
        ? 0
        : upper === "M" || upper === "L"
          ? 2
          : upper === "H" || upper === "V"
            ? 1
            : upper === "C"
              ? 6
              : upper === "S" || upper === "Q"
                ? 4
                : 7;
      index += 1;
      continue;
    }
    const match = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(pathValue.slice(index));
    if (!match) return `cannot parse character "${char}"`;
    pendingNumbers -= 1;
    index += match[0].length;
  }
  if (commandCount === 0) return "path contains no command";
  if (pendingNumbers > 0) return `command ${lastCommand} has too few parameters`;
  if (pendingNumbers < 0) return `command ${lastCommand} has too many parameters`;
  return null;
}

/** Canonical FA Free styles admitted by the frozen icon.name row. */
export const STATIC_V1_ICON_STYLES = Object.freeze(["fas", "far", "fab"] as const);
export type StaticV1IconStyle = (typeof STATIC_V1_ICON_STYLES)[number];

/** Long aliases are authoring conveniences; canonical BentoDoc stores short style keys. */
export const STATIC_V1_ICON_STYLE_ALIASES = Object.freeze({
  fas: "fas",
  "fa-solid": "fas",
  far: "far",
  "fa-regular": "far",
  fab: "fab",
  "fa-brands": "fab",
} as const satisfies Readonly<Record<string, StaticV1IconStyle>>);

export interface ParsedStaticV1IconName {
  /** Canonical short style. */
  style: StaticV1IconStyle;
  name: string;
  /** Canonical persisted form. */
  iconName: `${StaticV1IconStyle}:${string}`;
}

export class StaticV1IconResolutionError extends Error {
  readonly code: "ICON_NAME_INVALID" | "ICON_STYLE_UNKNOWN" | "ICON_NOT_IN_SHELF";
  readonly iconName: unknown;

  constructor(
    code: StaticV1IconResolutionError["code"],
    iconName: unknown,
    message: string,
  ) {
    super(message);
    this.name = "StaticV1IconResolutionError";
    this.code = code;
    this.iconName = iconName;
  }
}

const ICON_NAME_PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Parse and canonicalize style:name without consulting a concrete icon shelf. */
export function parseStaticV1IconName(value: unknown): ParsedStaticV1IconName {
  if (typeof value !== "string") {
    throw new StaticV1IconResolutionError(
      "ICON_NAME_INVALID",
      value,
      'iconName must be a string in "style:name" form',
    );
  }
  const separator = value.indexOf(":");
  if (separator <= 0 || separator !== value.lastIndexOf(":")) {
    throw new StaticV1IconResolutionError(
      "ICON_NAME_INVALID",
      value,
      `iconName "${value}" must contain exactly one style separator`,
    );
  }
  const rawStyle = value.slice(0, separator);
  const name = value.slice(separator + 1);
  if (!Object.hasOwn(STATIC_V1_ICON_STYLE_ALIASES, rawStyle)) {
    throw new StaticV1IconResolutionError(
      "ICON_STYLE_UNKNOWN",
      value,
      `icon style "${rawStyle}" is outside static-v1 (fas/far/fab)`,
    );
  }
  const style = STATIC_V1_ICON_STYLE_ALIASES[
    rawStyle as keyof typeof STATIC_V1_ICON_STYLE_ALIASES
  ];
  if (!ICON_NAME_PART.test(name)) {
    throw new StaticV1IconResolutionError(
      "ICON_NAME_INVALID",
      value,
      `icon name "${name}" must use lower-case letters, digits and single hyphens`,
    );
  }
  return { style, name, iconName: `${style}:${name}` };
}

/**
 * Parse and require membership in the pinned static-v1 name manifest. This is
 * the shared validation/import/kernel seam: it carries no glyph bytes and is
 * therefore safe for the contracts bundle and browser command path.
 */
export function resolveStaticV1IconMembership(
  value: unknown,
  membership: StaticV1IconMembership = STATIC_V1_ICON_MEMBERSHIP,
): ParsedStaticV1IconName {
  const parsed = parseStaticV1IconName(value);
  const styleMembership = Object.hasOwn(membership, parsed.style)
    ? membership[parsed.style]
    : undefined;
  if (styleMembership === undefined || !Object.hasOwn(styleMembership, parsed.name)) {
    throw new StaticV1IconResolutionError(
      "ICON_NOT_IN_SHELF",
      value,
      `icon "${parsed.iconName}" is not present in the pinned offline shelf`,
    );
  }
  return parsed;
}

/**
 * Concrete shelves are data adapters supplied by the icon package (#22). Keeping
 * the shelf as plain readonly data makes resolution deterministic and browser-safe.
 */
export type StaticV1IconShelf<T> = Readonly<
  Partial<Record<StaticV1IconStyle, Readonly<Record<string, T>>>>
>;

export interface ResolvedStaticV1Icon<T> extends ParsedStaticV1IconName {
  glyph: T;
}

/** Parse style aliases and require exact membership in the supplied offline shelf. */
export function resolveStaticV1Icon<T>(
  value: unknown,
  shelf: StaticV1IconShelf<T>,
): ResolvedStaticV1Icon<T> {
  const parsed = parseStaticV1IconName(value);
  const styleShelf = Object.hasOwn(shelf, parsed.style) ? shelf[parsed.style] : undefined;
  const glyph = styleShelf !== undefined && Object.hasOwn(styleShelf, parsed.name)
    ? styleShelf[parsed.name]
    : undefined;
  if (glyph === undefined) {
    throw new StaticV1IconResolutionError(
      "ICON_NOT_IN_SHELF",
      value,
      `icon "${parsed.iconName}" is not present in the pinned offline shelf`,
    );
  }
  return { ...parsed, glyph };
}
