/** Molly's lossless YAML artwork projection. No embedded canonical document or edit log. */
import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import {
  BENTO_DOC_V4_FIELDS,
  BENTO_ELEMENT_KINDS_V4,
  createVisualDocumentKernel,
  DIAGNOSTIC_CODES,
  sniffStaticV1FontMime,
  sniffStaticV1ImageMime,
  staticV1UnregisteredFontFamilies,
  type AssetIndex,
  type BentoDocV4,
  type BentoElementV4,
  type FrozenAuthoringValidationResult,
  type FrozenDiagnostic,
  type ImportResult,
} from './contracts.ts';

/** Bundled licensed default for omitted fontFamily (OFL Inter via @fontsource/inter). */
export const AUTHORING_DEFAULT_FONT_FAMILY = 'Inter';

export const ARTWORK_ENTRY = 'design.yaml';
export const ARTWORK_FORMAT = 'molly-canvas/1';

/** Root-level admitted fields, shared by validateYaml and describeAuthoringFormat. */
export const ARTWORK_ROOT_FIELDS = [
  'format',
  'title',
  'size',
  'customFonts',
  'background',
  'elements',
  'diagnostics',
] as const;

export interface CanvasSource {
  format: typeof ARTWORK_FORMAT;
  title?: string;
  size: [number, number];
  customFonts?: BentoDocV4['fonts'];
  background?: BentoDocV4['background'];
  elements: BentoElementV4[];
  diagnostics?: BentoDocV4['diagnostics'];
}

type Raw = Record<string, unknown>;
const record = (v: unknown): v is Raw => v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const mediaPath = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^media\/[^/\\]+$/.test(v) &&
  !v.split('').some((character) => character.charCodeAt(0) < 32) &&
  !['media/.', 'media/..'].includes(v);

/** Transform only asset-bearing schema fields; text, URLs and chart data are not assets. */
export function mapArtworkAssets<T>(
  value: T,
  map: (src: string, kind: 'image' | 'font', path: string) => string
): T {
  const out = structuredClone(value) as T & Raw;
  const originalSources = new WeakMap<object, string>();
  const source = (v: Raw, kind: 'image' | 'font', at: string) => {
    if (!originalSources.has(v)) originalSources.set(v, v.src as string);
    v.src = map(originalSources.get(v)!, kind, at);
  };
  const fill = (v: unknown, at: string) => {
    if (record(v) && v.type === 'image') source(v, 'image', `${at}.src`);
  };
  const style = (v: unknown, at: string) => {
    if (record(v)) fill(v.fill, `${at}.fill`);
  };
  const fonts = out.customFonts;
  if (Array.isArray(fonts))
    fonts.forEach((font, i) => {
      if (record(font)) source(font, 'font', `${ARTWORK_ENTRY}#customFonts[${i}].src`);
    });
  const at = `${ARTWORK_ENTRY}#`;
  fill(out.background, `${at}background`);
  if (!Array.isArray(out.elements)) return out;
  out.elements.forEach((element, i) => {
    if (!record(element)) return;
    const elAt = `${at}elements[${i}]`;
    if (element.kind === 'image') source(element, 'image', `${elAt}.src`);
    fill(element.fill, `${elAt}.fill`);
    if (record(element.chart)) fill(element.chart.fill, `${elAt}.chart.fill`);
    if (record(element.table)) {
      const table = element.table;
      if (Array.isArray(table.rows))
        table.rows.forEach((row, r) => {
          if (Array.isArray(row))
            row.forEach((cell, c) => style(cell, `${elAt}.table.rows[${r}][${c}]`));
        });
      if (record(table.style)) {
        for (const slot of [
          'cellStyle',
          'firstRowStyle',
          'lastRowStyle',
          'firstColumnStyle',
          'lastColumnStyle',
        ])
          style(table.style[slot], `${elAt}.table.style.${slot}`);
        if (Array.isArray(table.style.bodyStyles))
          table.style.bodyStyles.forEach((s, j) =>
            style(s, `${elAt}.table.style.bodyStyles[${j}]`)
          );
      }
    }
  });
  return out;
}

export function artworkToDocument(project: CanvasSource): BentoDocV4 {
  const elements = project.elements.map((element, index) => ({
    ...structuredClone(element),
    zIndex: element.zIndex ?? index,
  }));
  return {
    schemaVersion: 4,
    canvas: { width: project.size[0], height: project.size[1] },
    background: structuredClone(project.background) ?? { type: 'solid', color: '#FFFFFF' },
    ...(project.customFonts !== undefined ? { fonts: structuredClone(project.customFonts) } : {}),
    elements,
    diagnostics: structuredClone(project.diagnostics ?? []),
  };
}

/** Renderer constraint missing from the pinned kernel's line schema. Call after replay. */
export function assertRenderableLines(
  elements: ReadonlyArray<{ id: string; kind: string; curve?: unknown; points?: unknown }>
): void {
  for (const element of elements) {
    if (element.kind !== 'line' || element.curve !== 'smooth' || typeof element.points !== 'string')
      continue;
    // Matches editor-bento/renderers/line.ts routeLine: two points are a
    // straight line; longer smooth paths require complete cubic segments.
    const count = element.points.trim().split(/\s+/).length;
    if (count !== 2 && (count - 1) % 3 !== 0)
      throw Error(
        `element ${element.id}: smooth line requires 2 points or 1 + 3k Bézier points (received ${count})`
      );
  }
}

/** Same acceptance domains as manual save; replay is validation, never output repair. */
export function assertProjectionDocument(doc: BentoDocV4): void {
  // Saved BentoDoc is JSON data. Reject values YAML would silently coerce or
  // omit, while allowing shared (non-cyclic) objects produced by editor code.
  const ancestors = new Set<object>();
  const jsonData = (value: unknown, depth: number): void => {
    if (depth > 40) throw Error('Document nesting exceeds limit');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (
      typeof value !== 'object' ||
      value === null ||
      (!Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null)
    )
      throw Error('Document must contain only finite JSON values');
    if (ancestors.has(value)) throw Error('Cyclic document');
    ancestors.add(value);
    for (const child of Object.values(value)) jsonData(child, depth + 1);
    ancestors.delete(value);
  };
  jsonData(doc, 0);
  const keys = (v: unknown, allowed: readonly string[], at: string) => {
    if (!record(v) || Object.keys(v).some((k) => !allowed.includes(k)))
      throw Error(`${at}: unknown field or invalid object`);
  };
  keys(
    doc,
    ['schemaVersion', 'canvas', 'background', 'fonts', 'elements', 'diagnostics'],
    'document'
  );
  if (doc.schemaVersion !== 4) throw Error('Unsupported BentoDoc schemaVersion');
  keys(doc.canvas, ['width', 'height'], 'canvas');
  if (!Array.isArray(doc.elements) || !Array.isArray(doc.diagnostics))
    throw Error('elements and diagnostics must be arrays');
  doc.diagnostics.forEach((d) => {
    keys(d, ['code', 'path', 'message'], 'diagnostic');
    if (
      !Object.hasOwn(DIAGNOSTIC_CODES, d.code) ||
      typeof d.path !== 'string' ||
      typeof d.message !== 'string'
    )
      throw Error('Invalid diagnostic');
  });
  if (doc.fonts !== undefined && !Array.isArray(doc.fonts)) throw Error('fonts must be an array');
  (doc.fonts ?? []).forEach((font) => keys(font, ['family', 'src', 'weight', 'style'], 'font'));
  for (const element of doc.elements) {
    if (element.kind === 'chart') {
      keys(element.chart.data, ['cols', 'rows'], 'chart.data');
      // Defaults have no editor command and are resolved on v2 import. They
      // are not persisted in the projection as a second style authority.
      if (element.chart.seriesDefaults !== undefined)
        throw Error('Unresolved chart.seriesDefaults are not canonical editable state');
    }
  }
  const kernel = createVisualDocumentKernel({
    schemaVersion: 4,
    canvas: { width: 1, height: 1 },
    background: { type: 'solid', color: '#ffffff' },
    elements: [],
    diagnostics: [],
  });
  const result = kernel.apply({
    batchId: 'yaml-projection-validation',
    actor: 'authoring',
    baseRevision: 0,
    commands: [
      { type: 'setCanvasSize', ...doc.canvas },
      // The legacy top-level chart.fill key remains in the v4 field table.
      // It has no UI writer, but if present it still needs full fill validation.
      ...doc.elements.flatMap((element) => {
        const fill = (element as BentoElementV4 & { fill?: BentoDocV4['background'] }).fill;
        return element.kind === 'chart' && fill !== undefined
          ? [{ type: 'setBackground' as const, background: fill }]
          : [];
      }),
      { type: 'setBackground', background: doc.background },
      ...(doc.fonts ?? []).map((font) => ({ type: 'addFontRegistration' as const, font })),
      ...doc.elements.map((element) => ({ type: 'createElement' as const, element })),
    ],
  });
  if (!result.ok) {
    const { targetId, message } = result.error;
    throw Error(
      targetId === undefined ? message : `Element ${JSON.stringify(targetId)}: ${message}`
    );
  }
  assertRenderableLines(doc.elements);
  const missing = staticV1UnregisteredFontFamilies(doc.elements, [
    ...(doc.fonts ?? []).map((f) => f.family),
    AUTHORING_DEFAULT_FONT_FAMILY,
  ]).filter((family) => family !== AUTHORING_DEFAULT_FONT_FAMILY);
  if (missing.length) throw Error(`Unregistered fonts: ${missing.join(', ')}`);
}

const REMOTE_URL_RE = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/;
const KIND_SET = new Set<string>(BENTO_ELEMENT_KINDS_V4);
const PPTD_PAGE_FIELDS = new Set(['notes', 'animations', 'pageType']);

export type ArtworkExclusionScope = 'root' | 'element' | 'chart' | 'assets';

export interface ArtworkFormatExclusion {
  /** Where the exclusion applies, in design.yaml terms. */
  scope: ArtworkExclusionScope;
  /** The field or construct name. */
  name: string;
  /** Why the validator rejects it. */
  reason: string;
}

export interface ArtworkKindDescription {
  kind: string;
  /** Admitted element fields: v4 common fields plus kind-specific fields. */
  fields: string[];
}

export interface ArtworkFormatDescription {
  format: string;
  entry: string;
  rootFields: string[];
  kinds: ArtworkKindDescription[];
  exclusions: ArtworkFormatExclusion[];
  /** Value-level constraints and legacy status; pointers, not restated rules. */
  notes: string[];
}

/**
 * Explicit rejections enforced by validateYaml, mirrored for agent queries.
 * The format-description test injects each one into a fixture and asserts the
 * validator fails, so this table cannot silently drift from actual admission.
 */
export const ARTWORK_EXCLUSIONS: readonly ArtworkFormatExclusion[] = [
  {
    scope: 'root',
    name: 'pptd manifest / version v2|v3',
    reason: 'Leftover PPTD is not admitted (MOLLY-E-PPTD); writes use molly-canvas/1',
  },
  {
    scope: 'root',
    name: 'theme',
    reason: 'PPTD theme/$ref is not admitted (MOLLY-E-PPTD); use resolved literal styles',
  },
  {
    scope: 'root',
    name: 'pages',
    reason:
      'pages are not admitted: common.multiPage is excluded; migrate old two-file YAML explicitly',
  },
  ...[...PPTD_PAGE_FIELDS].map((name) => ({
    scope: 'root' as const,
    name,
    reason: `PPTD page field "${name}" is not admitted (MOLLY-E-PPTD)`,
  })),
  ...(['elementId', 'elementType', 'content'] as const).map((name) => ({
    scope: 'element' as const,
    name,
    reason: 'PPTD element identity/HTML content is not admitted (MOLLY-E-PPTD); Bento uses id/kind',
  })),
  {
    scope: 'chart',
    name: 'chart.seriesDefaults',
    reason:
      'PPTD seriesDefaults is not admitted (MOLLY-E-PPTD); write resolved per-series literal styles',
  },
  {
    scope: 'assets',
    name: 'remote asset URLs',
    reason:
      'Remote URLs are not admitted; assets must be local media/<name> paths with sniffed bytes',
  },
];

const ARTWORK_NOTES: readonly string[] = [
  'smooth lines use 1 + 3k Bézier control points; two points render as a straight line.',
  'Legacy geon-canvas/1 bytes remain readable with identical validation; every write uses molly-canvas/1.',
  'size must be a positive integer pair; see artwork-format.md for the admitted pixel range.',
  'bounds are [x, y, w, h] with x, y >= 0, w, h > 0 and the element inside the canvas; see artwork-format.md.',
  'Unknown fields are rejected, not relocated; omitted fontFamily uses the bundled Inter default family.',
  'chart top-level fill remains in the v4 field table as a legacy key with no UI writer; Molly does not produce it.',
];

/**
 * Agent-queryable description of the molly-canvas/1 admission grammar,
 * derived from the same constants and rules validateYaml enforces. Pure
 * projection of validator knowledge; adding or removing a rule must change
 * this output, and the format-description tests hold both sides together.
 */
export function describeAuthoringFormat(): ArtworkFormatDescription {
  return {
    format: ARTWORK_FORMAT,
    entry: ARTWORK_ENTRY,
    rootFields: [...ARTWORK_ROOT_FIELDS],
    kinds: BENTO_ELEMENT_KINDS_V4.map((kind) => ({
      kind,
      fields: [
        ...new Set<string>([
          ...BENTO_DOC_V4_FIELDS.elements.common,
          ...BENTO_DOC_V4_FIELDS.elements[kind],
        ]),
      ],
    })),
    exclusions: ARTWORK_EXCLUSIONS.map((exclusion) => ({ ...exclusion })),
    notes: [...ARTWORK_NOTES],
  };
}

export function validateYaml(
  canvas: Raw,
  entryFile: string,
  readMedia: (rel: string) => Uint8Array | undefined
): FrozenAuthoringValidationResult {
  const diagnostics: FrozenDiagnostic[] = [];
  const fail = (at: string, message: string, code: FrozenDiagnostic['code'] = 'PPTD-E001') =>
    diagnostics.push({ code, path: at, message });
  if (entryFile.endsWith('.pptd') || canvas.version === 'v2' || canvas.version === 'v3') {
    fail(`${entryFile}#`, 'leftover PPTD is not admitted (MOLLY-E-PPTD)', 'PPTD-E001');
    return { ok: false, diagnostics };
  }
  if (canvas.theme !== undefined) {
    fail(`${entryFile}#theme`, 'PPTD theme/$ref is not admitted (MOLLY-E-PPTD)');
    return { ok: false, diagnostics };
  }
  const exact = (v: Raw, keys: string[], at: string) =>
    Object.keys(v).forEach((k) => {
      if (!keys.includes(k)) fail(`${at}.${k}`, `Unknown artwork field: ${k}`);
    });
  exact(canvas, [...ARTWORK_ROOT_FIELDS], `${entryFile}#`);
  // Legacy artwork bytes remain readable; every export uses ARTWORK_FORMAT.
  if (canvas.format !== ARTWORK_FORMAT && canvas.format !== 'geon-canvas/1')
    fail(`${entryFile}#format`, `Expected format: ${ARTWORK_FORMAT}`);
  if ('pages' in canvas)
    fail(
      `${entryFile}#pages`,
      'pages are not admitted: common.multiPage is excluded; migrate old two-file YAML explicitly',
      'PPTD-E011'
    );
  if (canvas.title !== undefined && typeof canvas.title !== 'string')
    fail(`${entryFile}#title`, 'title must be a string');
  if (
    !Array.isArray(canvas.size) ||
    canvas.size.length !== 2 ||
    !canvas.size.every((v) => typeof v === 'number' && Number.isInteger(v) && v > 0)
  )
    fail(`${entryFile}#size`, 'size must be a positive integer pair', 'PPTD-E002');
  for (const key of Object.keys(canvas)) {
    if (PPTD_PAGE_FIELDS.has(key))
      fail(
        `${entryFile}#${key}`,
        `PPTD page field "${key}" is not admitted (MOLLY-E-PPTD)`,
        'PPTD-E011'
      );
  }
  if (!Array.isArray(canvas.elements)) fail(`${entryFile}#elements`, 'elements must be an array');
  else
    canvas.elements.forEach((element, index) => {
      const at = `${entryFile}#elements[${index}]`;
      if (!record(element)) {
        fail(at, 'Element must be a mapping');
        return;
      }
      if ('elementId' in element || 'elementType' in element || 'content' in element) {
        fail(at, 'PPTD elementId/elementType/HTML content is not admitted (MOLLY-E-PPTD)');
        return;
      }
      if (typeof element.id !== 'string' || typeof element.kind !== 'string') {
        fail(at, 'Expected Bento id/kind');
        return;
      }
      if (!KIND_SET.has(element.kind))
        fail(at, `kind "${element.kind}" is not in the element vocabulary`, 'PPTD-E003');
      else {
        const allowed = new Set<string>([
          ...BENTO_DOC_V4_FIELDS.elements.common,
          ...BENTO_DOC_V4_FIELDS.elements[
            element.kind as keyof typeof BENTO_DOC_V4_FIELDS.elements
          ],
        ]);
        for (const key of Object.keys(element)) {
          if (!allowed.has(key)) fail(`${at}.${key}`, `Unknown artwork field: ${key}`);
        }
      }
      if (record(element.chart) && element.chart.seriesDefaults !== undefined)
        fail(`${at}.chart.seriesDefaults`, 'PPTD seriesDefaults is not admitted (MOLLY-E-PPTD)');
    });
  if (diagnostics.length) return { ok: false, diagnostics };
  const project = canvas as unknown as CanvasSource;
  try {
    const bound = mapArtworkAssets(project, (src, kind, at) => {
      if (REMOTE_URL_RE.test(src)) {
        fail(at, `Remote ${kind} URL is not admitted: ${src}`, 'PPTD-E004');
        return src;
      }
      if (!mediaPath(src)) {
        fail(at, 'Asset must be a local media/<name> path', 'PPTD-E005');
        return src;
      }
      const bytes = readMedia(src);
      if (!bytes) {
        fail(at, `Missing asset: ${src}`, 'PPTD-E005');
        return src;
      }
      if ((kind === 'font' ? sniffStaticV1FontMime(bytes) : sniffStaticV1ImageMime(bytes)) === null)
        fail(at, `Invalid ${kind} bytes: ${src}`, 'PPTD-E005');
      return `asset:${hash(bytes)}`;
    });
    assertProjectionDocument(artworkToDocument(bound));
  } catch (error) {
    fail(`${entryFile}#`, error instanceof Error ? error.message : String(error), 'PPTD-E013');
  }
  return diagnostics.length
    ? { ok: false, diagnostics }
    : { ok: true, document: project, diagnostics: [] };
}

export function importYaml(project: CanvasSource, assets: AssetIndex): ImportResult {
  try {
    const bound = mapArtworkAssets(project, (src) => {
      const asset = Object.hasOwn(assets, src) ? assets[src] : undefined;
      if (typeof asset !== 'string' || !/^asset:[a-f0-9]{64}$/.test(asset))
        throw Error(`Missing or invalid asset index: ${src}`);
      return asset;
    });
    const document = artworkToDocument(bound);
    assertProjectionDocument(document);
    const sourceMap = Object.fromEntries(document.elements.map((e) => [e.id, [e.id]]));
    return { status: 'ok', document, sourceMap, profileVersion: 'v1', degradations: [] };
  } catch (error) {
    return {
      status: 'unsupported',
      issues: [
        {
          code: 'PPTD-E013',
          path: `${ARTWORK_ENTRY}#`,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

const yamlStringify = (value: unknown) =>
  new TextEncoder().encode(
    stringify(value, {
      aliasDuplicateObjects: false,
      defaultStringType: 'QUOTE_DOUBLE',
      lineWidth: 80,
    })
  );

/** Pure deterministic projection; caller owns any subsequent workspace writes. */
export function exportAuthoring(
  document: BentoDocV4,
  assets: ReadonlyMap<string, Uint8Array>
): Map<string, Uint8Array> {
  assertProjectionDocument(document);
  const project: CanvasSource = {
    format: ARTWORK_FORMAT,
    size: [document.canvas.width, document.canvas.height],
    ...(document.fonts !== undefined ? { customFonts: structuredClone(document.fonts) } : {}),
    background: structuredClone(document.background),
    diagnostics: structuredClone(document.diagnostics),
    elements: structuredClone(document.elements),
  };
  const snapshot = new Map<string, Uint8Array>();
  const projected = mapArtworkAssets(project, (src, kind) => {
    if (!/^asset:[a-f0-9]{64}$/.test(src)) throw Error(`Invalid canonical asset: ${src}`);
    const digest = src.slice(6);
    const bytes = assets.get(digest);
    if (!bytes || hash(bytes) !== digest) throw Error(`Missing or corrupt asset: ${src}`);
    if ((kind === 'font' ? sniffStaticV1FontMime(bytes) : sniffStaticV1ImageMime(bytes)) === null)
      throw Error(`Invalid ${kind} bytes: ${src}`);
    const rel = `media/${digest}`;
    snapshot.set(rel, new Uint8Array(bytes));
    return rel;
  });
  snapshot.set(ARTWORK_ENTRY, yamlStringify(projected));
  return snapshot;
}
