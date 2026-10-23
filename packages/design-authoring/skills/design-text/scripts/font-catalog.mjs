#!/usr/bin/env node
// font-catalog.mjs — list installed font faces with their metrics, and rank
// them for one measured line of copy. Dependency-free Node 22+: sfnt/TTC
// headers and the name/head/OS-2/cmap/hhea/hmtx (plus glyf/loca fallback)
// tables are parsed directly.
//
//   list [--family <substr>] [--cjk] [--dirs <dir,dir,...>]
//       One face per line:
//       family | style | weight | width | x/cap | file#index | face "<Pango description>"
//
//   match --text "<copy as shown>" --width <px> --cap <px>
//         [--stroke <px>] [--glyphs <n> --glyph-ink <px>] [--x <px>]
//         [--weight <100-900>] [--family <substr>] [--cjk] [--top 5] [--dirs <dir,dir,...>]
//       Ranks faces that cover every character of --text and prints fontSize,
//       letterSpacing and score for the closest one per family (all faces of
//       one family with --family). --glyphs/--glyph-ink come from
//       reference-pack.mjs measure and compare summed glyph ink widths, so
//       tracking does not affect the ranking; --stroke estimates the weight.
//
// Only the known system font directories are scanned (macOS, Windows, Linux),
// never arbitrary paths; --dirs exists for fixtures and tests. Results cache
// in $TMPDIR/molly-font-catalog-v4.json (MOLLY_FONT_CACHE overrides the
// location), invalidated by directory mtimes.

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const SCAN_DEPTH = 3;
const CACHE_NAME = 'molly-font-catalog-v4.json';
const INK_RANGE_END = 0x24f;
const CFF_INK_PER_ADVANCE = 0.88;
const STROKE_WEIGHTS = [
  [0.08, 300],
  [0.12, 400],
  [0.15, 500],
  [0.18, 600],
  [0.21, 700],
  [0.25, 800],
  [0.3, 900],
];
const CJK_RANGES = [
  [0x2e80, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
  [0x20000, 0x2a6df],
];

function fail(message) {
  console.error(`font-catalog: ${message}`);
  process.exit(1);
}

// ---- known font directories ----

function knownFontDirs() {
  const home = homedir();
  if (process.platform === 'darwin') {
    return [
      '/System/Library/Fonts',
      '/System/Library/Fonts/Supplemental',
      '/Library/Fonts',
      path.join(home, 'Library/Fonts'),
    ];
  }
  if (process.platform === 'win32') {
    const windir = process.env.WINDIR ?? 'C:\\Windows';
    const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    return [path.join(windir, 'Fonts'), path.join(localAppData, 'Microsoft', 'Windows', 'Fonts')];
  }
  return [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    path.join(home, '.local', 'share', 'fonts'),
    path.join(home, '.fonts'),
  ];
}

function cachePath() {
  // Tests and fixtures isolate the cache with MOLLY_FONT_CACHE.
  return process.env.MOLLY_FONT_CACHE ?? path.join(tmpdir(), CACHE_NAME);
}

function knownDirsLabel() {
  if (process.platform === 'darwin') {
    return '/System/Library/Fonts, /Library/Fonts, ~/Library/Fonts';
  }
  if (process.platform === 'win32') {
    return '%WINDIR%\\Fonts, %LOCALAPPDATA%\\Microsoft\\Windows\\Fonts';
  }
  return '/usr/share/fonts, /usr/local/share/fonts, ~/.local/share/fonts, ~/.fonts';
}

function scanFontFiles(rootDirs) {
  const files = [];
  const visited = new Set();
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= SCAN_DEPTH) continue;
        // One pass per real directory: a nested known root (macOS
        // Supplemental) is not scanned twice.
        let real;
        try {
          real = realpathSync(full);
        } catch {
          continue;
        }
        if (visited.has(real)) continue;
        visited.add(real);
        walk(full, depth + 1);
      } else if (entry.isFile() && /\.(ttf|otf|ttc)$/i.test(entry.name)) {
        files.push(full);
      }
    }
  };
  for (const root of rootDirs) {
    let real;
    try {
      real = realpathSync(root);
    } catch {
      continue;
    }
    if (visited.has(real)) continue;
    visited.add(real);
    walk(root, 1);
  }
  return files.sort();
}

// ---- sfnt / TTC parsing ----

function u16(buf, off) {
  return buf.readUInt16BE(off);
}
function i16(buf, off) {
  return buf.readInt16BE(off);
}
function u32(buf, off) {
  return buf.readUInt32BE(off);
}

function sfntOffsets(buf) {
  if (buf.length < 12) return [];
  if (buf.toString('ascii', 0, 4) === 'ttcf') {
    const count = u32(buf, 8);
    const offsets = [];
    for (let i = 0; i < count; i++) {
      const off = u32(buf, 12 + i * 4);
      if (off + 12 <= buf.length) offsets.push(off);
    }
    return offsets;
  }
  return [0];
}

function tableMap(buf, sfntOffset) {
  const numTables = u16(buf, sfntOffset + 4);
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const rec = sfntOffset + 12 + i * 16;
    if (rec + 16 > buf.length) break;
    const tag = buf.toString('ascii', rec, rec + 4);
    tables.set(tag, { offset: u32(buf, rec + 8), length: u32(buf, rec + 12) });
  }
  return tables;
}

function utf16be(raw) {
  const units = [];
  for (let i = 0; i + 1 < raw.length; i += 2) units.push(raw.readUInt16BE(i));
  return String.fromCharCode(...units);
}

function nameStrings(buf, table) {
  const names = new Map();
  if (table === undefined || table.offset + 6 > buf.length) return names;
  const count = u16(buf, table.offset + 2);
  const storage = table.offset + u16(buf, table.offset + 4);
  for (let i = 0; i < count; i++) {
    const rec = table.offset + 6 + i * 12;
    if (rec + 12 > buf.length) break;
    const platform = u16(buf, rec);
    const nameId = u16(buf, rec + 6);
    if (![1, 2, 16, 17].includes(nameId)) continue;
    const length = u16(buf, rec + 8);
    const start = storage + u16(buf, rec + 10);
    if (start + length > buf.length) continue;
    const raw = buf.subarray(start, start + length);
    const value = platform === 0 || platform === 3 ? utf16be(raw) : raw.toString('latin1');
    if (!names.has(nameId)) names.set(nameId, value);
  }
  return names;
}

/** One codepoint → glyph id through one cmap subtable. */
function subtableLookup(buf, offset, codepoint) {
  if (offset + 2 > buf.length) return 0;
  const format = u16(buf, offset);
  if (format === 12) {
    let lo = 0;
    let hi = Math.min(u32(buf, offset + 12), Math.floor((buf.length - offset - 16) / 12)) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const rec = offset + 16 + mid * 12;
      const startChar = u32(buf, rec);
      const endChar = u32(buf, rec + 4);
      if (codepoint < startChar) hi = mid - 1;
      else if (codepoint > endChar) lo = mid + 1;
      else return u32(buf, rec + 8) + (codepoint - startChar);
    }
    return 0;
  }
  if (format === 4 && codepoint <= 0xffff) {
    const segCount = u16(buf, offset + 6) / 2;
    const endBase = offset + 14;
    const startBase = endBase + 2 * segCount + 2;
    const deltaBase = startBase + 2 * segCount;
    const rangeBase = deltaBase + 2 * segCount;
    for (let i = 0; i < segCount; i++) {
      if (rangeBase + 2 * i + 2 > buf.length) break;
      const endCode = u16(buf, endBase + 2 * i);
      const startCode = u16(buf, startBase + 2 * i);
      if (codepoint < startCode || codepoint > endCode) continue;
      if (startCode === 0xffff && endCode === 0xffff) return 0;
      const delta = i16(buf, deltaBase + 2 * i);
      const rangeOffset = u16(buf, rangeBase + 2 * i);
      if (rangeOffset === 0) return (codepoint + delta) & 0xffff;
      const glyphOffset = rangeBase + 2 * i + rangeOffset + 2 * (codepoint - startCode);
      if (glyphOffset + 2 > buf.length) return 0;
      const raw = u16(buf, glyphOffset);
      return raw === 0 ? 0 : (raw + delta) & 0xffff;
    }
  }
  return 0;
}

/** Preferred format-12/format-4 subtable offsets of a cmap, best first. */
function cmapSubtables(buf, cmapTable) {
  const subtables = [];
  if (cmapTable === undefined) return subtables;
  const count = u16(buf, cmapTable.offset + 2);
  for (let i = 0; i < count; i++) {
    const rec = cmapTable.offset + 4 + i * 8;
    if (rec + 8 > cmapTable.offset + cmapTable.length) break;
    const platform = u16(buf, rec);
    const encoding = u16(buf, rec + 2);
    const offset = cmapTable.offset + u32(buf, rec + 4);
    if (offset + 2 > buf.length) continue;
    const format = u16(buf, offset);
    if (format === 12) subtables.push({ rank: platform === 3 && encoding === 10 ? 0 : 1, offset });
    if (format === 4) subtables.push({ rank: platform === 3 && encoding === 1 ? 2 : 3, offset });
  }
  subtables.sort((a, b) => a.rank - b.rank);
  const seen = new Set();
  return subtables.filter((s) => !seen.has(s.offset) && seen.add(s.offset)).map((s) => s.offset);
}

/** One codepoint → glyph id through a face's cmap. */
function cmapLookup(buf, cmapTable, codepoint) {
  for (const offset of cmapSubtables(buf, cmapTable)) {
    const glyph = subtableLookup(buf, offset, codepoint);
    if (glyph !== 0) return glyph;
  }
  return 0;
}

/** Coverage of a cmap as sorted ranges [[start, end], ...]. */
function cmapRanges(buf, cmapTable) {
  const points = new Set();
  for (const offset of cmapSubtables(buf, cmapTable)) {
    const format = u16(buf, offset);
    if (format === 12) {
      const numGroups = u32(buf, offset + 12);
      for (let i = 0; i < numGroups; i++) {
        const rec = offset + 16 + i * 12;
        if (rec + 12 > buf.length) break;
        const startChar = u32(buf, rec);
        const endChar = u32(buf, rec + 4);
        for (let code = startChar; code <= endChar; code++) points.add(code);
      }
    } else {
      const segCount = u16(buf, offset + 6) / 2;
      const endBase = offset + 14;
      const startBase = endBase + 2 * segCount + 2;
      for (let i = 0; i < segCount; i++) {
        if (startBase + 2 * i + 2 > buf.length) break;
        const endCode = u16(buf, endBase + 2 * i);
        const startCode = u16(buf, startBase + 2 * i);
        if (startCode === 0xffff && endCode === 0xffff) continue;
        for (let code = startCode; code <= endCode && code < 0xffff; code++) {
          if (subtableLookup(buf, offset, code) !== 0) points.add(code);
        }
      }
    }
  }
  const sorted = [...points].sort((a, b) => a - b);
  const ranges = [];
  let lastEnd = -1;
  for (const code of sorted) {
    if (ranges.length > 0 && code === lastEnd + 1) {
      ranges[ranges.length - 1][1] = code;
    } else {
      ranges.push([code, code]);
    }
    lastEnd = code;
  }
  return ranges;
}

function inRanges(ranges, codepoint) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (codepoint < ranges[mid][0]) hi = mid - 1;
    else if (codepoint > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

function parseFace(buf, sfntOffset, file, index) {
  const tables = tableMap(buf, sfntOffset);
  const head = tables.get('head');
  const hhea = tables.get('hhea');
  const maxp = tables.get('maxp');
  if (head === undefined || hhea === undefined || maxp === undefined) return null;
  const unitsPerEm = u16(buf, head.offset + 18);
  if (unitsPerEm === 0) return null;
  const numGlyphs = u16(buf, maxp.offset + 4);
  const numHMetrics = u16(buf, hhea.offset + 34);
  const os2 = tables.get('OS/2');
  let weight = 400;
  let widthClass = 5;
  let sxHeight = null;
  let sCapHeight = null;
  if (os2 !== undefined && os2.offset + 8 <= buf.length) {
    weight = u16(buf, os2.offset + 4);
    widthClass = u16(buf, os2.offset + 6);
    const version = u16(buf, os2.offset);
    if (version >= 2 && os2.offset + 90 <= buf.length) {
      const sx = i16(buf, os2.offset + 86);
      const sc = i16(buf, os2.offset + 88);
      if (sx > 0) sxHeight = sx;
      if (sc > 0) sCapHeight = sc;
    }
  }
  const cmap = tables.get('cmap');
  const glyphBox = glyphBoxReader(buf, tables, head, numGlyphs);
  if (sCapHeight === null && glyphBox !== null && cmap !== undefined) {
    // Faces without sCapHeight fall back to the H glyph's yMax.
    const box = glyphBox(cmapLookup(buf, cmap, 0x48));
    if (box !== null && box.yMax > 0) sCapHeight = box.yMax;
  }
  const coverage = cmapRanges(buf, cmap);
  // Ink widths (xMax - xMin) for Latin letters and digits; CFF faces have none.
  const inks = [];
  if (glyphBox !== null && cmap !== undefined) {
    for (let code = 0x21; code <= INK_RANGE_END; code++) {
      if (!inRanges(coverage, code)) continue;
      const box = glyphBox(cmapLookup(buf, cmap, code));
      if (box !== null) inks.push([code, box.xMax - box.xMin]);
    }
  }
  const advances = [];
  const hmtx = tables.get('hmtx');
  if (hmtx !== undefined && cmap !== undefined) {
    for (const [start, end] of coverage) {
      for (let code = Math.max(0x20, start); code <= Math.min(0x10ffff, end); code++) {
        const glyph = cmapLookup(buf, cmap, code);
        const metric = Math.min(glyph, numHMetrics - 1);
        const off = hmtx.offset + 4 * metric;
        if (off + 2 > buf.length) break;
        advances.push([code, u16(buf, off)]);
      }
    }
  }
  const names = nameStrings(buf, tables.get('name'));
  const family = names.get(16) ?? names.get(1);
  const style = names.get(17) ?? names.get(2) ?? 'Regular';
  if (family === undefined || family === '') return null;
  return {
    file,
    index,
    family,
    style,
    face: style === 'Regular' ? family : `${family} ${style}`,
    weight,
    widthClass,
    unitsPerEm,
    sxHeight,
    sCapHeight,
    coverage,
    advances,
    inks,
  };
}

function glyphBoxReader(buf, tables, head, numGlyphs) {
  const glyf = tables.get('glyf');
  const loca = tables.get('loca');
  if (glyf === undefined || loca === undefined) return null;
  const longOffsets = i16(buf, head.offset + 50) !== 0;
  const entry = (glyph) =>
    longOffsets ? u32(buf, loca.offset + 4 * glyph) : u16(buf, loca.offset + 2 * glyph) * 2;
  return (glyph) => {
    if (glyph <= 0 || glyph >= numGlyphs) return null;
    if (loca.offset + (longOffsets ? 4 : 2) * (glyph + 2) > buf.length) return null;
    const start = entry(glyph);
    if (entry(glyph + 1) === start) return { xMin: 0, xMax: 0, yMax: 0 };
    const at = glyf.offset + start;
    if (at + 10 > buf.length) return null;
    return { xMin: i16(buf, at + 2), xMax: i16(buf, at + 6), yMax: i16(buf, at + 8) };
  };
}

// ---- catalog build, cache, load ----

function dirFingerprint(rootDirs) {
  const parts = [];
  for (const root of rootDirs) {
    let real;
    try {
      real = realpathSync(root);
    } catch {
      continue;
    }
    const walk = (dir, depth) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      let newest = 0;
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth < SCAN_DEPTH) walk(full, depth + 1);
        } else if (entry.isFile() && /\.(ttf|otf|ttc)$/i.test(entry.name)) {
          try {
            const st = statSync(full);
            if (st.mtimeMs > newest) newest = st.mtimeMs;
            parts.push(`${full}:${st.size}`);
          } catch {
            // Unreadable files are skipped from the fingerprint.
          }
        }
      }
      parts.push(`${dir}@${newest}`);
    };
    walk(real, 1);
  }
  return createHash('sha256').update(parts.sort().join('\n')).digest('hex');
}

function buildCatalog(rootDirs) {
  const faces = [];
  const seenFaces = new Set();
  for (const file of scanFontFiles(rootDirs)) {
    let buf;
    try {
      buf = readFileSync(file);
    } catch {
      continue;
    }
    let realFile = file;
    try {
      realFile = realpathSync(file);
    } catch {
      // Keep the scanned path when realpath fails.
    }
    for (const [index, offset] of sfntOffsets(buf).entries()) {
      // One catalog entry per face, whatever path reached it.
      const key = `${realFile}#${index}`;
      if (seenFaces.has(key)) continue;
      seenFaces.add(key);
      let face;
      try {
        face = parseFace(buf, offset, realFile, index);
      } catch {
        continue;
      }
      // Families starting with "." are OS-private UI faces, not design choices.
      if (face !== null && !face.family.startsWith('.')) faces.push(face);
    }
  }
  faces.sort(
    (a, b) =>
      a.family.localeCompare(b.family) ||
      a.style.localeCompare(b.style) ||
      a.file.localeCompare(b.file) ||
      a.index - b.index
  );
  return { version: 4, fingerprint: dirFingerprint(rootDirs), faces };
}

function loadCatalog(rootDirs) {
  const fingerprint = dirFingerprint(rootDirs);
  let catalog = null;
  try {
    const cached = JSON.parse(readFileSync(cachePath(), 'utf8'));
    if (
      cached !== null &&
      typeof cached === 'object' &&
      cached.version === 4 &&
      cached.fingerprint === fingerprint &&
      Array.isArray(cached.faces)
    ) {
      catalog = cached;
    }
  } catch {
    // A missing or corrupt cache rebuilds below.
  }
  if (catalog === null) {
    catalog = buildCatalog(rootDirs);
    try {
      const cache = cachePath();
      mkdirSync(path.dirname(cache), { recursive: true });
      writeFileSync(cache, JSON.stringify(catalog));
    } catch {
      // Caching is advisory; output still works without a writable $TMPDIR.
    }
  }
  // Families starting with "." are OS-private UI faces, not design choices;
  // the filter applies to cached catalogs from any source as well.
  catalog.faces = catalog.faces.filter(
    (face) => typeof face.family === 'string' && !face.family.startsWith('.')
  );
  return catalog;
}

// ---- filters and output ----

function coversText(face, text) {
  for (const ch of text) {
    if (/\s/u.test(ch)) continue;
    if (!inRanges(face.coverage, ch.codePointAt(0))) return false;
  }
  return true;
}

function coversCjk(face) {
  return CJK_RANGES.some(([lo, hi]) =>
    face.coverage.some(([start, end]) => start <= hi && end >= lo)
  );
}

function listLine(face) {
  const metrics =
    face.sCapHeight === null || face.sCapHeight === 0
      ? 'cap ?'
      : face.sxHeight === null
        ? 'x/cap ?'
        : `x/cap ${(face.sxHeight / face.sCapHeight).toFixed(2)}`;
  return (
    `${face.family} | ${face.style} | ${face.weight} | ${face.widthClass} | ` +
    `${metrics} | ${face.file}#${face.index} | face "${face.face}"`
  );
}

function parseCli(argv, flags = []) {
  const args = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (flags.includes(name)) {
        args[name] = true;
        continue;
      }
      const value = argv[i + 1];
      if (value === undefined) fail(`option ${arg} needs a value`);
      args[name] = value;
      i += 1;
    } else {
      args.positional.push(arg);
    }
  }
  return args;
}

function dirsFromCli(args) {
  if (args.dirs === undefined) return knownFontDirs();
  return args.dirs.split(',').map((d) => path.resolve(d));
}

function parseNumber(args, name, { integer = false, min = -Infinity, max = Infinity } = {}) {
  if (args[name] === undefined) return undefined;
  const value = Number(args[name]);
  if (
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value)) ||
    value < min ||
    value > max
  ) {
    fail(`--${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  }
  return value;
}

function runList(argv) {
  const args = parseCli(argv, ['cjk']);
  const catalog = loadCatalog(dirsFromCli(args));
  const familyFilter = args.family?.toLowerCase();
  const lines = [];
  for (const face of catalog.faces) {
    if (familyFilter !== undefined && !face.family.toLowerCase().includes(familyFilter)) continue;
    if (args.cjk !== undefined && !coversCjk(face)) continue;
    lines.push(listLine(face));
  }
  console.log(lines.join('\n'));
}

function weightFromStroke(ratio) {
  if (ratio <= STROKE_WEIGHTS[0][0]) return STROKE_WEIGHTS[0][1];
  for (let i = 1; i < STROKE_WEIGHTS.length; i++) {
    const [r1, w1] = STROKE_WEIGHTS[i];
    if (ratio <= r1) {
      const [r0, w0] = STROKE_WEIGHTS[i - 1];
      return w0 + ((ratio - r0) / (r1 - r0)) * (w1 - w0);
    }
  }
  return STROKE_WEIGHTS[STROKE_WEIGHTS.length - 1][1];
}

function runMatch(argv) {
  const args = parseCli(argv, ['cjk']);
  if (args.text === undefined || args.text === '') fail('match needs --text "<copy as shown>"');
  const width = parseNumber(args, 'width', { min: 1 });
  const cap = parseNumber(args, 'cap', { min: 1 });
  if (width === undefined || cap === undefined) fail('match needs --width <px> and --cap <px>');
  const x = parseNumber(args, 'x', { min: 1 });
  const weight = parseNumber(args, 'weight', { integer: true, min: 100, max: 900 });
  const stroke = parseNumber(args, 'stroke', { min: 1 });
  const glyphs = parseNumber(args, 'glyphs', { integer: true, min: 1 });
  const glyphInk = parseNumber(args, 'glyph-ink', { min: 1 });
  const top = parseNumber(args, 'top', { integer: true, min: 1, max: 20 }) ?? 5;
  const familyFilter = args.family?.toLowerCase();
  const catalog = loadCatalog(dirsFromCli(args));
  const needCjk = args.cjk !== undefined;
  const letters = [...args.text].filter((ch) => !/\s/u.test(ch));
  const chars = letters.length;
  const xHeightOnly = /^[aceimnorsuvwxz]+$/.test(letters.join(''));
  const notes = [];
  if (xHeightOnly) notes.push('note: --cap interpreted as x-height for x-height-only Latin copy');
  let useGlyphs = false;
  if (glyphs !== undefined && glyphInk !== undefined) {
    if (glyphs === chars) {
      useGlyphs = true;
    } else {
      notes.push(
        `note: measure found ${glyphs} glyphs for ${chars} letters; ranking by line width`
      );
    }
  }
  const targetWeight =
    weight ?? (stroke === undefined ? undefined : weightFromStroke(stroke / cap));

  const rows = [];
  for (const face of catalog.faces) {
    const height = xHeightOnly ? face.sxHeight : face.sCapHeight;
    if (height === null || height <= 0) continue;
    if (familyFilter !== undefined && !face.family.toLowerCase().includes(familyFilter)) continue;
    if (!coversText(face, args.text)) continue;
    if (needCjk && !coversCjk(face)) continue;
    const advances = new Map(face.advances);
    const inks = new Map(face.inks ?? []);
    const letterAdvances = [];
    const letterInks = [];
    let covered = true;
    for (const ch of letters) {
      const code = ch.codePointAt(0);
      const advance = advances.get(code);
      if (typeof advance !== 'number') {
        covered = false;
        break;
      }
      const ink = inks.get(code);
      letterAdvances.push(advance);
      letterInks.push(typeof ink === 'number' ? ink : advance * CFF_INK_PER_ADVANCE);
    }
    const letterAdvanceSum = letterAdvances.reduce((sum, v) => sum + v, 0);
    if (!covered || letterAdvanceSum <= 0) continue;
    const inkSum = letterInks.reduce((sum, v) => sum + v, 0);
    let advanceSum = 0;
    for (const ch of args.text) {
      const advance = advances.get(ch.codePointAt(0));
      if (typeof advance === 'number') advanceSum += advance;
    }
    // The measured width runs ink to ink: drop the outer side bearings,
    // assumed even on both sides of the first and last letter.
    const outerBearings =
      (letterAdvances[0] - letterInks[0]) / 2 +
      (letterAdvances[chars - 1] - letterInks[chars - 1]) / 2;
    const scale = cap / height;
    const fontSize = face.unitsPerEm * scale;
    const predicted = (advanceSum - outerBearings) * scale;
    const gaps = [...args.text].length - 1;
    const letterSpacing = gaps > 0 ? (width - predicted) / gaps : 0;
    let score = useGlyphs
      ? Math.abs(Math.log((inkSum * scale) / glyphInk))
      : Math.abs(Math.log((letterAdvanceSum * scale) / width));
    if (x !== undefined && face.sxHeight !== null && face.sxHeight > 0) {
      const fontX = face.sxHeight * scale;
      score += Math.abs(Math.log(fontX / x));
    }
    if (targetWeight !== undefined) {
      score += 0.3 * (Math.abs(face.weight - targetWeight) / 100);
    }
    rows.push({ face, fontSize, letterSpacing, score });
  }
  rows.sort(
    (a, b) =>
      a.score - b.score ||
      Math.abs(a.face.weight - (targetWeight ?? 400)) -
        Math.abs(b.face.weight - (targetWeight ?? 400)) ||
      a.face.file.localeCompare(b.face.file) ||
      a.face.index - b.face.index
  );
  let shown = rows.slice(0, top);
  const also = new Map();
  if (familyFilter === undefined) {
    shown = [];
    for (const row of rows) {
      const others = also.get(row.face.family);
      if (others === undefined) {
        if (shown.length >= top) continue;
        shown.push(row);
        also.set(row.face.family, []);
      } else if (others.length < 3 && !others.includes(row.face.style)) {
        others.push(row.face.style);
      }
    }
  }
  const lines = shown.map((row, i) => {
    const others = also.get(row.face.family) ?? [];
    return (
      `${i + 1}. ${row.face.face} | fontSize ${row.fontSize.toFixed(1)} | ` +
      `letterSpacing ${row.letterSpacing.toFixed(1)} | score ${row.score.toFixed(3)} | ` +
      `${row.face.file}#${row.face.index}` +
      (others.length > 0 ? ` | also: ${others.join(', ')}` : '')
    );
  });
  lines.push(...notes);
  lines.push(
    familyFilter === undefined
      ? 'Next: molly_view_image { fonts: [these rows], text, path: <reference>, region: <line box> }; ' +
          'pick a family by letter shapes, then match --family "<family>" for its weight. Render once.'
      : "Next: use the first row's fontSize and letterSpacing unless the sheet showed another weight. Render once."
  );
  console.log(lines.join('\n'));
}

const args = process.argv.slice(2);
if (args[0] === 'list') {
  runList(args.slice(1));
} else if (args[0] === 'match') {
  runMatch(args.slice(1));
} else {
  console.error(
    [
      'usage:',
      '  node font-catalog.mjs list [--family <substr>] [--cjk] [--dirs <dir,...>]',
      '  node font-catalog.mjs match --text "<copy>" --width <px> --cap <px>' +
        ' [--stroke <px>] [--glyphs <n> --glyph-ink <px>] [--x <px>] [--weight <100-900>]' +
        ' [--family <substr>] [--cjk] [--top 5] [--dirs <dir,...>]',
      `scans only the known font directories: ${knownDirsLabel()}`,
    ].join('\n')
  );
  process.exit(2);
}
