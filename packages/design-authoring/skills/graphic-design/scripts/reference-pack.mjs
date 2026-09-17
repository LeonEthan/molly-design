#!/usr/bin/env node
// reference-pack.mjs — one inspection pass over a reference image, as files.
// Dependency-free Node 22+ port of the upstream Pillow-based
// reference-pack.py (see skills source manifest).
//
// Subcommands:
//
//   pack <image> <out-dir>
//       Writes into <out-dir>:
//         meta.json         width/height/format + palette hex list
//         grid.png          overview with a 100px (original-coordinate) grid
//         bands.png         contact sheet of enlarged vertical bands, each
//                           labeled with its original y-range
//         palette.png       sampled representative colors as a swatch strip
//
//   crop <image> <x,y,w,h> <out.png>
//       One metadata-free crop (fully re-encoded). Bounds are validated
//       against the image.
//
// Format support: PNG (8-bit gray/RGB/RGBA/palette, non-interlaced) is fully
// decoded; JPEG/GIF/BMP/WEBP report dimensions in meta.json but raster
// artifacts (grid/bands/palette/crop) require PNG — convert first if needed.
// All coordinates are original-image pixels.

import { inflateSync, deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const GRID_STEP = 100;
const GRID_MAX_WIDTH = 900;
const BAND_TARGET_HEIGHT = 1400;
const BAND_MAX = 6;
const PALETTE_COLORS = 8;

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function fail(message) {
  console.error(`reference-pack: ${message}`);
  process.exit(1);
}

// ---- image header sniffing ----

function sniffImage(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return { format: 'PNG' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { format: 'JPEG' };
  if (buf.length >= 10 && buf.toString('ascii', 0, 4) === 'GIF8') {
    return { format: 'GIF', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.length >= 26 && buf.toString('ascii', 0, 2) === 'BM') {
    return { format: 'BMP', width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
  }
  if (
    buf.length >= 30 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') {
      return {
        format: 'WEBP',
        width: 1 + buf.readUIntLE(24, 3),
        height: 1 + buf.readUIntLE(27, 3),
      };
    }
    if (kind === 'VP8 ' && buf.length >= 30) {
      // Lossy bitstream: 3-byte frame tag, 9d 01 2a start code, then 14-bit dims.
      const base = 20;
      if (buf[base + 3] === 0x9d && buf[base + 4] === 0x01 && buf[base + 5] === 0x2a) {
        return {
          format: 'WEBP',
          width: buf.readUInt16LE(base + 6) & 0x3fff,
          height: buf.readUInt16LE(base + 8) & 0x3fff,
        };
      }
    }
    if (kind === 'VP8L' && buf.length >= 25) {
      const b = 20;
      if (buf[b] === 0x2f) {
        const bits = buf.readUInt32LE(b + 1);
        return { format: 'WEBP', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
    return { format: 'WEBP' };
  }
  return { format: 'unknown' };
}

function jpegDims(buf) {
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) {
      off += 1;
      continue;
    }
    const marker = buf[off + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      off += 2;
      continue;
    }
    off += 2 + buf.readUInt16BE(off + 2);
  }
  return null;
}

// ---- PNG decode (8-bit, non-interlaced) ----

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) fail('not a PNG file');
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let plte = null;
  const idat = [];
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      plte = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (width === 0 || height === 0) fail('PNG missing IHDR');
  if (bitDepth !== 8) fail(`unsupported PNG bit depth ${bitDepth} (8-bit only)`);
  if (interlace !== 0) fail('interlaced (Adam7) PNG is not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) fail(`unsupported PNG color type ${colorType}`);
  if (colorType === 3 && plte === null) fail('palette PNG missing PLTE');

  const stride = width * channels;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch (error) {
    fail(`PNG inflate failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw.length < height * (stride + 1)) fail('PNG pixel data truncated');

  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev !== null ? prev[x] : 0;
      const c = prev !== null && x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) fail(`unsupported PNG filter ${filter}`);
      cur[x] = v;
    }
  }

  // Convert to RGB, dropping alpha (matches the upstream convert("RGB")).
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const d = i * 3;
    if (colorType === 2 || colorType === 6) {
      rgb[d] = px[s];
      rgb[d + 1] = px[s + 1];
      rgb[d + 2] = px[s + 2];
    } else if (colorType === 0 || colorType === 4) {
      rgb[d] = rgb[d + 1] = rgb[d + 2] = px[s];
    } else {
      const p = px[s] * 3;
      if (p + 2 >= plte.length) fail('palette index out of range');
      rgb[d] = plte[p];
      rgb[d + 1] = plte[p + 1];
      rgb[d + 2] = plte[p + 2];
    }
  }
  return { width, height, rgb };
}

// ---- PNG encode (8-bit RGB, filter 0) ----

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- raster ops ----

function resizeBilinear(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 3);
  const xRatio = sw / dw;
  const yRatio = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(Math.max((y + 0.5) * yRatio - 0.5, 0), sh - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, sh - 1);
    const wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(Math.max((x + 0.5) * xRatio - 0.5, 0), sw - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, sw - 1);
      const wx = fx - x0;
      const d = (y * dw + x) * 3;
      for (let c = 0; c < 3; c++) {
        const p00 = src[(y0 * sw + x0) * 3 + c];
        const p01 = src[(y0 * sw + x1) * 3 + c];
        const p10 = src[(y1 * sw + x0) * 3 + c];
        const p11 = src[(y1 * sw + x1) * 3 + c];
        dst[d + c] = Math.round(
          p00 * (1 - wx) * (1 - wy) + p01 * wx * (1 - wy) + p10 * (1 - wx) * wy + p11 * wx * wy
        );
      }
    }
  }
  return dst;
}

function cropRgb(rgb, w, x, y, cw, ch) {
  const out = Buffer.alloc(cw * ch * 3);
  for (let row = 0; row < ch; row++) {
    rgb.copy(out, row * cw * 3, ((y + row) * w + x) * 3, ((y + row) * w + x + cw) * 3);
  }
  return out;
}

// ---- 5x7 bitmap labels (digits, hex, and the band-label letters) ----

const GLYPH_ROWS = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  b: ['10000', '10000', '10110', '11001', '10001', '10001', '11110'],
  a: ['00000', '00000', '01110', '00001', '01111', '10001', '01111'],
  n: ['00000', '00000', '10110', '11001', '10001', '10001', '10001'],
  d: ['00001', '00001', '01101', '10011', '10001', '10001', '01111'],
  y: ['00000', '00000', '10001', '10001', '01111', '00001', '01110'],
  ':': ['00000', '00100', '00000', '00000', '00000', '00100', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00110', '00110'],
  '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function drawText(rgb, w, h, x0, y0, text, color) {
  for (let i = 0; i < text.length; i++) {
    const glyph = GLYPH_ROWS[text[i]] ?? GLYPH_ROWS[' '];
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] !== '1') continue;
        const x = x0 + i * 6 + gx;
        const y = y0 + gy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const d = (y * w + x) * 3;
        rgb[d] = color[0];
        rgb[d + 1] = color[1];
        rgb[d + 2] = color[2];
      }
    }
  }
}

function drawVLine(rgb, w, h, x, color) {
  if (x < 0 || x >= w) return;
  for (let y = 0; y < h; y++) {
    const d = (y * w + x) * 3;
    rgb[d] = color[0];
    rgb[d + 1] = color[1];
    rgb[d + 2] = color[2];
  }
}

function drawHLine(rgb, w, h, y, color) {
  if (y < 0 || y >= h) return;
  for (let x = 0; x < w; x++) {
    const d = (y * w + x) * 3;
    rgb[d] = color[0];
    rgb[d + 1] = color[1];
    rgb[d + 2] = color[2];
  }
}

function fillRect(rgb, w, x, y, rw, rh, color) {
  for (let yy = y; yy < y + rh; yy++) {
    for (let xx = x; xx < x + rw; xx++) {
      const d = (yy * w + xx) * 3;
      rgb[d] = color[0];
      rgb[d + 1] = color[1];
      rgb[d + 2] = color[2];
    }
  }
}

function hexOf(rgb, i) {
  return `#${[rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]
    .map((v) => v.toString(16).padStart(2, '0').toUpperCase())
    .join('')}`;
}

// ---- pack ----

function pack(imagePath, outDir) {
  const buf = readFileSync(imagePath);
  const sniffed = sniffImage(buf);
  mkdirSync(outDir, { recursive: true });

  let decoded = null;
  if (sniffed.format === 'PNG') {
    decoded = decodePng(buf);
  } else if (sniffed.format === 'JPEG') {
    const dims = jpegDims(buf);
    if (dims !== null) {
      sniffed.width = dims.width;
      sniffed.height = dims.height;
    }
  }
  const width = decoded?.width ?? sniffed.width;
  const height = decoded?.height ?? sniffed.height;
  if (width === undefined || height === undefined) {
    fail(`unsupported or unreadable image format: ${imagePath} (${sniffed.format})`);
  }

  let hexes = [];
  if (decoded !== null) {
    // Palette: deterministic grid sample of a small thumbnail, deduped.
    const tw = Math.min(160, width);
    const th = Math.max(1, Math.round((height * tw) / width));
    const small = resizeBilinear(decoded.rgb, width, height, tw, th);
    const sx = Math.max(1, Math.floor(tw / 4));
    const sy = Math.max(1, Math.floor(th / 2));
    for (let y = 0; y < th && hexes.length < PALETTE_COLORS; y += sy) {
      for (let x = 0; x < tw && hexes.length < PALETTE_COLORS; x += sx) {
        const hex = hexOf(small, y * tw + x);
        if (!hexes.includes(hex)) hexes.push(hex);
      }
    }
  }

  writeFileSync(
    path.join(outDir, 'meta.json'),
    `${JSON.stringify(
      { file: String(imagePath), width, height, format: sniffed.format, palette: hexes },
      null,
      2
    )}\n`
  );

  if (decoded === null) {
    fail(
      `raster artifacts need a PNG reference (got ${sniffed.format}); meta.json written, ` +
        'convert the reference to PNG and rerun for grid/bands/palette/crop'
    );
  }

  const RED = [255, 0, 0];

  // Grid overview: fit width, label in original coordinates.
  const scale = Math.min(1, GRID_MAX_WIDTH / width);
  const gw = Math.max(1, Math.round(width * scale));
  const gh = Math.max(1, Math.round(height * scale));
  const grid = resizeBilinear(decoded.rgb, width, height, gw, gh);
  const step = Math.max(1, Math.round(GRID_STEP * scale));
  for (let x = 0; x < gw; x += step) {
    drawVLine(grid, gw, gh, x, RED);
    drawText(grid, gw, gh, x + 2, 2, String(Math.round(x / scale)), RED);
  }
  for (let y = 0; y < gh; y += step) {
    drawHLine(grid, gw, gh, y, RED);
    drawText(grid, gw, gh, 2, y + 2, String(Math.round(y / scale)), RED);
  }
  writeFileSync(path.join(outDir, 'grid.png'), encodePng(gw, gh, grid));

  // Contact sheet: vertical bands enlarged to a readable height.
  const n = Math.min(BAND_MAX, Math.max(1, Math.floor(height / BAND_TARGET_HEIGHT) + 1));
  const bandH = Math.floor(height / n);
  const bands = [];
  for (let i = 0; i < n; i++) {
    const y0 = i * bandH;
    const y1 = i === n - 1 ? height : (i + 1) * bandH;
    const bandRgb = cropRgb(decoded.rgb, width, 0, y0, width, y1 - y0);
    const bscale = BAND_TARGET_HEIGHT / (y1 - y0);
    const bw = Math.max(1, Math.round(width * bscale));
    const resized = resizeBilinear(bandRgb, width, y1 - y0, bw, BAND_TARGET_HEIGHT);
    const label = Buffer.alloc(bw * 24 * 3);
    drawText(label, bw, 24, 4, 4, `band ${i}: y ${y0}..${y1}`, [255, 255, 0]);
    const stack = Buffer.alloc(bw * (BAND_TARGET_HEIGHT + 24) * 3);
    label.copy(stack, 0);
    resized.copy(stack, bw * 24 * 3);
    bands.push({ width: bw, rgb: stack });
  }
  const gap = 8;
  const sheetW = bands.reduce((sum, b) => sum + b.width, 0) + gap * (n - 1);
  const sheetH = BAND_TARGET_HEIGHT + 24;
  const sheet = Buffer.alloc(sheetW * sheetH * 3);
  fillRect(sheet, sheetW, 0, 0, sheetW, sheetH, [32, 32, 32]);
  let bx = 0;
  for (const band of bands) {
    for (let row = 0; row < sheetH; row++) {
      band.rgb.copy(
        sheet,
        (row * sheetW + bx) * 3,
        row * band.width * 3,
        (row + 1) * band.width * 3
      );
    }
    bx += band.width + gap;
  }
  writeFileSync(path.join(outDir, 'bands.png'), encodePng(sheetW, sheetH, sheet));

  // Palette swatch strip.
  const sw = Buffer.alloc(120 * hexes.length * 60 * 3, 0xff);
  for (const [i, hex] of hexes.entries()) {
    const color = [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16));
    fillRect(sw, 120 * hexes.length, i * 120, 0, 120, 40, color);
    drawText(sw, 120 * hexes.length, 60, i * 120 + 4, 44, hex, [0, 0, 0]);
  }
  writeFileSync(path.join(outDir, 'palette.png'), encodePng(120 * hexes.length, 60, sw));

  console.log(
    `pack: ${outDir}/meta.json grid.png bands.png palette.png (${width}x${height}, ${n} band(s))`
  );
}

// ---- crop ----

function crop(imagePath, boxArg, outPath) {
  const buf = readFileSync(imagePath);
  const sniffed = sniffImage(buf);
  if (sniffed.format !== 'PNG') {
    fail(`crop needs a PNG reference (got ${sniffed.format}); convert to PNG first`);
  }
  const decoded = decodePng(buf);
  const parts = boxArg.split(',').map((v) => Number.parseInt(v, 10));
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
    fail('crop: box must be x,y,w,h integers');
  }
  const [x, y, w, h] = parts;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > decoded.width || y + h > decoded.height) {
    fail(`crop: [${x},${y},${w},${h}] outside image ${decoded.width}x${decoded.height}`);
  }
  mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  // Full re-encode: no metadata survives.
  writeFileSync(outPath, encodePng(w, h, cropRgb(decoded.rgb, decoded.width, x, y, w, h)));
  console.log(`crop: ${outPath} (${w}x${h})`);
}

// ---- entry ----

const args = process.argv.slice(2);
if (args[0] === 'pack' && args.length === 3) {
  pack(args[1], args[2]);
} else if (args[0] === 'crop' && args.length === 4) {
  crop(args[1], args[2], args[3]);
} else {
  console.error(
    'usage:\n  node reference-pack.mjs pack <image> <out-dir>\n  node reference-pack.mjs crop <image> <x,y,w,h> <out.png>'
  );
  process.exit(2);
}
