/**
 * Skill script tests: run the materialized scripts (finalize, render-preview,
 * reference-pack) against synthetic fixtures. The scripts import the esbuild
 * bundle under skills/graphic-design/scripts/lib, which `pnpm test` rebuilds
 * first via scripts/build.mjs.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';

const skillDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
  'graphic-design'
);

function pngDims(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

type Rgba = [number, number, number, number];

function syntheticPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  return encodeTestPng(width, height, 3, () => [...rgb, 255]);
}

function rgbaPng(width: number, height: number, pixel: (x: number, y: number) => Rgba): Buffer {
  return encodeTestPng(width, height, 4, pixel);
}

/** Decodes the helper's own output: 8-bit, non-interlaced, filter 0 only. */
function decodeTestPng(bytes: Buffer): {
  width: number;
  height: number;
  pixel: (x: number, y: number) => number[];
} {
  const { width, height } = pngDims(bytes);
  const channels = bytes[25] === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels + 1;
  return {
    width,
    height,
    pixel: (x, y) => {
      expect(raw[y * stride]).toBe(0);
      const start = y * stride + 1 + x * channels;
      return [...raw.subarray(start, start + channels)];
    },
  };
}

function encodeTestPng(
  width: number,
  height: number,
  channels: 3 | 4,
  pixel: (x: number, y: number) => Rgba
): Buffer {
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const d = y * (stride + 1) + 1 + x * channels;
      pixel(x, y)
        .slice(0, channels)
        .forEach((value, channel) => {
          raw[d + channel] = value;
        });
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function run(script: string, args: string[]) {
  return spawnSync(process.execPath, [path.join(skillDir, 'scripts', script), ...args], {
    encoding: 'utf8',
  });
}

describe('font-prepare.mjs', () => {
  it('exposes isolated setup and complete-font conversion without installing on help', () => {
    const result = run('font-prepare.mjs', ['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('setup <environment-dir>');
    expect(result.stdout).toContain('including all glyphs');
  });

  it.each([
    ['woff', 'source.ttc', 'output.woff', '--python', 'missing-python'],
    ['woff', 'source.ttc', 'output.woff', '--face', '-1', '--python', 'missing-python'],
    ['faces', 'source.ttc', '--face', '1', '--python', 'missing-python'],
    ['setup', 'environment', '--user'],
  ])(
    'rejects unsupported or ambiguous preparation arguments before running Python: %j',
    (...args) => {
      const result = run('font-prepare.mjs', args);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/font-prepare|Select a face/);
      expect(result.stderr).not.toContain('ENOENT');
    }
  );
});

const workdirs: string[] = [];
function workdir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'molly-skill-test-'));
  workdirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true });
});

function writeProject(dir: string, page: string): void {
  mkdirSync(path.join(dir, 'media'), { recursive: true });
  writeFileSync(
    path.join(dir, 'design.yaml.tmp'),
    'format: molly-canvas/1\ntitle: Test\nsize: [320, 200]\n' + page
  );
  writeFileSync(path.join(dir, 'media', 'pic.png'), syntheticPng(8, 8, [200, 30, 30]));
}

const VALID_PAGE = `background:
  type: solid
  color: "#FFFFFF"
elements:
  - id: photo
    kind: image
    bounds: [10, 10, 64, 64]
    src: media/pic.png
    fit: cover
`;

describe('format.mjs', () => {
  it('prints an overview with format, root fields, kinds, and notes', () => {
    const result = run('format.mjs', []);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('molly-canvas/1');
    expect(result.stdout).toContain('root fields:');
    expect(result.stdout).toContain('elements');
    for (const kind of ['text', 'shape', 'line', 'image', 'icon', 'table', 'chart'])
      expect(result.stdout).toContain(kind);
    expect(result.stdout).toContain('exclusions:');
  });

  it('lists admitted fields for a kind without presenting excluded constructs as writable', () => {
    const result = run('format.mjs', ['kind', 'chart']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('kind: chart');
    expect(result.stdout).toContain('chart');
    expect(result.stdout).not.toMatch(/^  seriesDefaults$/m);
    expect(result.stdout).toContain('chart.seriesDefaults');
  });

  it('rejects an unknown kind with the admitted vocabulary', () => {
    const result = run('format.mjs', ['kind', 'video']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown kind');
  });

  it('lists explicit exclusions with reasons, including theme', () => {
    const result = run('format.mjs', ['excluded']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('theme');
    expect(result.stdout).toContain('seriesDefaults');
    expect(result.stdout).toContain('MOLLY-E-PPTD');
  });

  it('fails with usage on an unknown subcommand', () => {
    const result = run('format.mjs', ['bogus']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
  });
});

describe('finalize.mjs', () => {
  it('rejects an oversized referenced asset without promoting the draft', () => {
    const dir = workdir();
    writeProject(dir, VALID_PAGE);
    const bytes = Buffer.alloc(16_777_217);
    syntheticPng(8, 8, [200, 30, 30]).copy(bytes);
    writeFileSync(path.join(dir, 'media', 'pic.png'), bytes);
    const result = run('finalize.mjs', [path.join(dir, 'design.yaml.tmp')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('media/pic.png');
    expect(result.stderr).toContain('16777217');
    expect(result.stderr).toContain('16777216');
    expect(existsSync(path.join(dir, 'design.yaml'))).toBe(false);
    expect(existsSync(path.join(dir, 'design.yaml.tmp'))).toBe(true);
  });

  it('accepts the editable text example published in the format guide', () => {
    const guide = readFileSync(path.join(skillDir, 'references', 'artwork-format.md'), 'utf8');
    const example = [...guide.matchAll(/```yaml\n([\s\S]*?)```/g)]
      .map((match) => match[1])
      .find((block) => block?.trimStart().startsWith('- id:'));
    expect(example).toBeDefined();
    const dir = workdir();
    writeProject(
      dir,
      'elements:\n' +
        example!
          .split('\n')
          .map((line) => '  ' + line)
          .join('\n')
    );
    const result = run('finalize.mjs', [path.join(dir, 'design.yaml.tmp')]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it('promotes a clean draft to design.yaml', () => {
    const dir = workdir();
    writeProject(dir, VALID_PAGE);
    const result = run('finalize.mjs', [path.join(dir, 'design.yaml.tmp')]);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(dir, 'design.yaml'))).toBe(true);
    expect(existsSync(path.join(dir, 'design.yaml.tmp'))).toBe(false);
  });

  it('prints one line per diagnostic and leaves a broken draft in place', () => {
    const dir = workdir();
    writeProject(dir, VALID_PAGE.replace('media/pic.png', 'media/missing.png'));
    const result = run('finalize.mjs', [path.join(dir, 'design.yaml.tmp')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MOLLY-E005');
    expect(existsSync(path.join(dir, 'design.yaml'))).toBe(false);
    expect(existsSync(path.join(dir, 'design.yaml.tmp'))).toBe(true);
  });
});

describe('render-preview.mjs', () => {
  it('passes intake on a valid project and points at the MCP render tool', () => {
    const dir = workdir();
    writeProject(dir, VALID_PAGE);
    const finalize = run('finalize.mjs', [path.join(dir, 'design.yaml.tmp')]);
    expect(finalize.status).toBe(0);
    const result = run('render-preview.mjs', [path.join(dir, 'design.yaml')]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('intake OK');
    expect(result.stdout).toContain('molly_render_preview');
  });

  it('fails intake on an invalid project', () => {
    const dir = workdir();
    writeProject(dir, VALID_PAGE.replace('media/pic.png', 'media/missing.png'));
    writeFileSync(path.join(dir, 'design.yaml'), readFileSync(path.join(dir, 'design.yaml.tmp')));
    const result = run('render-preview.mjs', [path.join(dir, 'design.yaml')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MOLLY-E005');
  });

  it('reports the size failure before claiming local intake succeeds', () => {
    const dir = workdir();
    writeProject(dir, VALID_PAGE);
    writeFileSync(path.join(dir, 'design.yaml'), readFileSync(path.join(dir, 'design.yaml.tmp')));
    const bytes = Buffer.alloc(16_777_217);
    syntheticPng(8, 8, [200, 30, 30]).copy(bytes);
    writeFileSync(path.join(dir, 'media', 'pic.png'), bytes);
    const result = run('render-preview.mjs', [path.join(dir, 'design.yaml')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('media/pic.png');
    expect(result.stderr).toContain('16777217');
    expect(result.stderr).toContain('16777216');
    expect(result.stdout).not.toContain('intake OK');
  });
});

describe('reference-pack.mjs', () => {
  it('pack writes meta.json plus grid/bands/palette PNGs with expected geometry', () => {
    const dir = workdir();
    const ref = path.join(dir, 'ref.png');
    writeFileSync(ref, syntheticPng(120, 240, [10, 20, 30]));
    const out = path.join(dir, 'inspect');
    const result = run('reference-pack.mjs', ['pack', ref, out]);
    expect(result.status).toBe(0);

    const meta = JSON.parse(readFileSync(path.join(out, 'meta.json'), 'utf8')) as {
      width: number;
      height: number;
      format: string;
      palette: string[];
    };
    expect(meta).toEqual({
      file: ref,
      width: 120,
      height: 240,
      format: 'PNG',
      palette: ['#0A141E'],
    });
    // grid fits the original (scale 1 at <=900px wide)
    expect(pngDims(readFileSync(path.join(out, 'grid.png')))).toEqual({ width: 120, height: 240 });
    // one band enlarged to the 1400px target height plus the 24px label strip
    expect(pngDims(readFileSync(path.join(out, 'bands.png')))).toEqual({
      width: 700,
      height: 1424,
    });
    expect(pngDims(readFileSync(path.join(out, 'palette.png')))).toEqual({
      width: 120,
      height: 60,
    });
  });

  it('crop re-encodes a bounded region', () => {
    const dir = workdir();
    const ref = path.join(dir, 'ref.png');
    writeFileSync(ref, syntheticPng(64, 64, [1, 2, 3]));
    const out = path.join(dir, 'out.png');
    const result = run('reference-pack.mjs', ['crop', ref, '4,8,16,24', out]);
    expect(result.status).toBe(0);
    expect(pngDims(readFileSync(out))).toEqual({ width: 16, height: 24 });
  });

  it('crop refuses out-of-bounds boxes', () => {
    const dir = workdir();
    const ref = path.join(dir, 'ref.png');
    writeFileSync(ref, syntheticPng(64, 64, [1, 2, 3]));
    const result = run('reference-pack.mjs', [
      'crop',
      ref,
      '60,60,16,16',
      path.join(dir, 'out.png'),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('outside image');
  });
});

describe('reference-pack.mjs layer helpers', () => {
  // 20x12 layer: opaque red 6x4 block at (5,3), faint halo alpha 20 at (2,1)..(14,9).
  const layerPixel = (x: number, y: number): Rgba => {
    if (x >= 5 && x < 11 && y >= 3 && y < 7) return [255, 0, 0, 255];
    if (x >= 2 && x <= 14 && y >= 1 && y <= 9) return [0, 0, 255, 20];
    return [0, 0, 0, 0];
  };
  const writeLayer = (dir: string): { file: string; bytes: Buffer } => {
    const file = path.join(dir, 'layer.png');
    const bytes = rgbaPng(20, 12, layerPixel);
    writeFileSync(file, bytes);
    return { file, bytes };
  };

  it('alpha reports counts and bounds, with threshold bounds only on request', () => {
    const { file } = writeLayer(workdir());
    const plain = run('reference-pack.mjs', ['alpha', file]);
    expect(plain.status).toBe(0);
    const report = JSON.parse(plain.stdout);
    expect(report).toMatchObject({
      width: 20,
      height: 12,
      pixels: 240,
      opaque: 24,
      partial: 13 * 9 - 24,
      transparent: 240 - 13 * 9,
      bounds: { x: 2, y: 1, width: 13, height: 9 },
    });
    expect(report).not.toHaveProperty('thresholdBounds');
    const threshold = JSON.parse(
      run('reference-pack.mjs', ['alpha', file, '--threshold', '128']).stdout
    );
    expect(threshold.thresholdBounds).toEqual({ x: 5, y: 3, width: 6, height: 4 });
  });

  it('trim removes only fully transparent padding by default and keeps every pixel', () => {
    const dir = workdir();
    const { file, bytes } = writeLayer(dir);
    const out = path.join(dir, 'trimmed.png');
    const result = run('reference-pack.mjs', ['trim', file, out]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      sourceWidth: 20,
      sourceHeight: 12,
      x: 2,
      y: 1,
      width: 13,
      height: 9,
    });
    const trimmed = decodeTestPng(readFileSync(out));
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 13; x++) expect(trimmed.pixel(x, y)).toEqual(layerPixel(x + 2, y + 1));
    expect(readFileSync(file)).toEqual(bytes);
  });

  it('trim keeps only the region above an explicit alpha plus margin', () => {
    const dir = workdir();
    const { file } = writeLayer(dir);
    const out = path.join(dir, 'guarded.png');
    const result = run('reference-pack.mjs', [
      'trim',
      file,
      out,
      '--alpha-above',
      '128',
      '--margin',
      '1',
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ x: 4, y: 2, width: 8, height: 6 });
    const guarded = decodeTestPng(readFileSync(out));
    expect(guarded.pixel(1, 1)).toEqual([255, 0, 0, 255]);
    expect(guarded.pixel(0, 0)).toEqual([0, 0, 255, 20]);
  });

  it('trim refuses to overwrite its source, orphan options and empty layers', () => {
    const dir = workdir();
    const { file, bytes } = writeLayer(dir);
    const overwrite = run('reference-pack.mjs', ['trim', file, file]);
    expect(overwrite.status).toBe(1);
    expect(overwrite.stderr).toContain('must not overwrite');
    expect(readFileSync(file)).toEqual(bytes);
    const orphan = run('reference-pack.mjs', [
      'trim',
      file,
      path.join(dir, 'o.png'),
      '--margin',
      '2',
    ]);
    expect(orphan.status).toBe(1);
    expect(orphan.stderr).toContain('--margin applies only with --alpha-above');
    const empty = path.join(dir, 'empty.png');
    writeFileSync(
      empty,
      rgbaPng(4, 4, () => [0, 0, 0, 0])
    );
    const nothing = run('reference-pack.mjs', ['trim', empty, path.join(dir, 'e.png')]);
    expect(nothing.status).toBe(1);
    expect(nothing.stderr).toContain('nothing to keep');
  });

  it('compare writes side-by-side, overlay and light/dark sheets for same-size images', () => {
    const dir = workdir();
    const { file } = writeLayer(dir);
    const other = path.join(dir, 'other.png');
    writeFileSync(
      other,
      rgbaPng(20, 12, () => [0, 255, 0, 255])
    );
    const out = path.join(dir, 'compare');
    const result = run('reference-pack.mjs', ['compare', file, other, out]);
    expect(result.status).toBe(0);
    expect(pngDims(readFileSync(path.join(out, 'side-by-side.png')))).toEqual({
      width: 48,
      height: 28,
    });
    const overlay = decodeTestPng(readFileSync(path.join(out, 'overlay.png')));
    expect(overlay.pixel(6, 4)).toEqual([128, 128, 0]);
    const lightDark = decodeTestPng(readFileSync(path.join(out, 'light-dark.png')));
    expect({ width: lightDark.width, height: lightDark.height }).toEqual({ width: 48, height: 32 });
    expect(lightDark.pixel(0, 0)).toEqual([255, 255, 255]);
    expect(lightDark.pixel(28, 0)).toEqual([0, 0, 0]);
    expect(lightDark.pixel(6, 4)).toEqual([255, 0, 0]);

    const small = path.join(dir, 'small.png');
    writeFileSync(
      small,
      rgbaPng(4, 4, () => [0, 0, 0, 255])
    );
    const mismatch = run('reference-pack.mjs', ['compare', file, small, path.join(dir, 'x')]);
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('same-size');
  });
});
