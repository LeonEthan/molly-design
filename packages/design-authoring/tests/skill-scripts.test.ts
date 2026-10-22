/**
 * Skill script tests: run the materialized scripts (finalize, render-preview,
 * format, reference-pack, font-prepare) against synthetic fixtures. Validator
 * scripts import the esbuild bundle under each skill's scripts/lib, which
 * `pnpm test` rebuilds first via scripts/build.mjs.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
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

const replicationSkillDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
  'design-replication'
);

const textSkillDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
  'design-text'
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

function run(script: string, args: string[], fromSkillDir = skillDir) {
  return spawnSync(process.execPath, [path.join(fromSkillDir, 'scripts', script), ...args], {
    encoding: 'utf8',
  });
}

describe('font-prepare.mjs', () => {
  it('exposes isolated setup and complete-font conversion without installing on help', () => {
    const result = run('font-prepare.mjs', ['--help'], textSkillDir);
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
      const result = run('font-prepare.mjs', args, textSkillDir);
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
    const result = run('reference-pack.mjs', ['pack', ref, out], replicationSkillDir);
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
    const result = run('reference-pack.mjs', ['crop', ref, '4,8,16,24', out], replicationSkillDir);
    expect(result.status).toBe(0);
    expect(pngDims(readFileSync(out))).toEqual({ width: 16, height: 24 });
  });

  it('crop refuses out-of-bounds boxes', () => {
    const dir = workdir();
    const ref = path.join(dir, 'ref.png');
    writeFileSync(ref, syntheticPng(64, 64, [1, 2, 3]));
    const result = run(
      'reference-pack.mjs',
      ['crop', ref, '60,60,16,16', path.join(dir, 'out.png')],
      replicationSkillDir
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('outside image');
  });
});

describe('font-catalog.mjs', () => {
  // The committed OFL fixture (scripts/fixtures/MollyTestSerif-Regular.ttf) is
  // copied into an isolated dir per run; sibling faces are derived in-memory.
  // The catalog cache is redirected per run so tests stay hermetic.
  const fixtureDir = path.join(textSkillDir, 'scripts', 'fixtures');
  const fixtureFont = path.join(fixtureDir, 'MollyTestSerif-Regular.ttf');
  let catalogSeq = 0;

  function setupFontDir(): { dir: string; cacheEnv: NodeJS.ProcessEnv } {
    const dir = path.join(workdir(), `fonts-${catalogSeq++}`);
    mkdirSync(dir, { recursive: true });
    const cache = path.join(dir, 'cache.json');
    const env = { ...process.env, MOLLY_FONT_CACHE: cache };
    return { dir, cacheEnv: env };
  }

  function copyFixture(dir: string, name = 'MollyTestSerif-Regular.ttf'): string {
    const dest = path.join(dir, name);
    writeFileSync(dest, readFileSync(fixtureFont));
    // A pinned mtime keeps the directory fingerprint stable across the calls
    // in one test, so the second call exercises the cache.
    utimesSync(dest, new Date('2020-01-01'), new Date('2020-01-01'));
    return dest;
  }

  function runCatalog(
    args: string[],
    env: NodeJS.ProcessEnv
  ): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(
      process.execPath,
      [path.join(textSkillDir, 'scripts', 'font-catalog.mjs'), ...args],
      { encoding: 'utf8', env }
    );
    return {
      status: result.status,
      stdout: result.stdout as string,
      stderr: result.stderr as string,
    };
  }

  it('lists the fixture face with parsed metrics', () => {
    const { dir, cacheEnv } = setupFontDir();
    const fontPath = copyFixture(dir);
    const result = runCatalog(['list', '--dirs', dir], cacheEnv);
    expect(result.status, result.stderr).toBe(0);
    const prefix = `Molly Test Serif | Regular | 400 | 5 | x/cap 0.71 | `;
    const suffix = `#0 | face "Molly Test Serif"`;
    expect(result.stdout.trim()).toBe(prefix + realpathSync(fontPath) + suffix);
  });

  it('ranks a Regular-exact match first and predicts fontSize and spacing', () => {
    const { dir, cacheEnv } = setupFontDir();
    const fontPath = copyFixture(dir);
    // MOLLY advances sum to 2328 upem; at cap 100 the font size is
    // 100 / 0.72 = 138.9 and the predicted width is 2328 * 138.9 / 1000 = 323.3,
    // so a measured width of 367 fits with letterSpacing 4.7.
    const result = runCatalog(
      ['match', '--text', 'MOLLY', '--width', '367', '--cap', '100', '--dirs', dir],
      cacheEnv
    );
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      `1. Molly Test Serif | fontSize 138.9 | letterSpacing 4.7 | score 0.052 | ` +
        `${realpathSync(fontPath)}#0`
    );
    expect(lines[1]).toContain('Next: molly_view_image { fonts: [top rows], text');
  });

  it('skips faces without cap height and filters uncovered text', () => {
    const { dir, cacheEnv } = setupFontDir();
    // NoCap: OS/2 version 1 drops sxHeight/sCapHeight; the H yMax fallback
    // supplies cap height (720) so the face stays matchable.
    const source = readFileSync(fixtureFont);
    const noCap = Buffer.from(source);
    const numTables = noCap.readUInt16BE(4);
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (noCap.toString('ascii', rec, rec + 4) === 'OS/2') {
        const offset = noCap.readUInt32BE(rec + 8);
        noCap.writeUInt16BE(1, offset);
      }
    }
    writeFileSync(path.join(dir, 'NoCap.ttf'), noCap);
    utimesSync(path.join(dir, 'NoCap.ttf'), new Date('2020-01-01'), new Date('2020-01-01'));
    const listed = runCatalog(['list', '--dirs', dir], cacheEnv);
    expect(listed.status).toBe(0);
    // The fallback found the H glyph: cap height is known, x-height is not.
    expect(listed.stdout).toContain('NoCap.ttf#0 | face "Molly Test Serif"');
    expect(listed.stdout).toContain('x/cap ? |');
    // A glyph the face does not cover excludes it from match.
    const uncovered = runCatalog(
      ['match', '--text', 'MOLLYé', '--width', '300', '--cap', '100', '--dirs', dir],
      cacheEnv
    );
    expect(uncovered.status).toBe(0);
    expect(uncovered.stdout.trim()).toHaveLength(
      'Next: molly_view_image { fonts: [top rows], text, path: <reference>, region: <text box> }, pick one, render once.'
        .length
    );
  });

  it('parses TTC collections with per-face indexes', () => {
    const { dir, cacheEnv } = setupFontDir();
    // Minimal TTC: header + two copies of the fixture, table offsets rebased.
    const face = readFileSync(fixtureFont);
    const header = Buffer.alloc(12 + 8);
    header.write('ttcf', 0, 'ascii');
    header.writeUInt32BE(0x00010000, 4);
    header.writeUInt32BE(2, 8);
    header.writeUInt32BE(20, 12);
    header.writeUInt32BE(20 + face.length, 16);
    const rebase = (buf: Buffer, delta: number): Buffer => {
      const out = Buffer.from(buf);
      const numTables = out.readUInt16BE(4);
      for (let i = 0; i < numTables; i++) {
        const rec = 12 + i * 16;
        out.writeUInt32BE(out.readUInt32BE(rec + 8) + delta, rec + 8);
      }
      return out;
    };
    const ttc = Buffer.concat([header, rebase(face, 20), rebase(face, 20 + face.length)]);
    writeFileSync(path.join(dir, 'Pair.ttc'), ttc);
    utimesSync(path.join(dir, 'Pair.ttc'), new Date('2020-01-01'), new Date('2020-01-01'));
    const result = runCatalog(['list', '--dirs', dir], cacheEnv);
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Pair.ttc#0');
    expect(lines[1]).toContain('Pair.ttc#1');
  });

  it('rejects invalid arguments with a clear error', () => {
    const { dir, cacheEnv } = setupFontDir();
    const missing = runCatalog(['match', '--text', 'MOLLY', '--cap', '100', '--dirs', dir], cacheEnv);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('match needs --width');
    const badWeight = runCatalog(
      ['match', '--text', 'MOLLY', '--width', '100', '--cap', '100', '--weight', '50', '--dirs', dir],
      cacheEnv
    );
    expect(badWeight.status).toBe(1);
    expect(badWeight.stderr).toContain('--weight');
    const usage = runCatalog(['bogus'], cacheEnv);
    expect(usage.status).toBe(2);
    expect(usage.stderr).toContain('usage:');
  });
});

describe('reference-pack.mjs measure', () => {
  // 120x90 cream. One mixed-case line: x-band rows 16..29 spanning the full
  // ink width (x-height 14), caps and ascenders rows 4..15, descender band
  // rows 30..34 (5). A second all-caps line at rows 55..74, stroke 3px.
  const measurePng = (): Buffer =>
    encodeTestPng(120, 90, 3, (x, y) => {
      const stems = (t: number, b: number, w: number, gap: number, x0: number, x1: number) =>
        y >= t && y <= b && x >= x0 && x <= x1 && (x - x0) % gap < w;
      const ink =
        stems(16, 29, 2, 4, 20, 79) ||
        stems(10, 15, 2, 16, 20, 49) ||
        stems(4, 9, 2, 16, 20, 49) ||
        stems(30, 34, 2, 4, 20, 35) ||
        stems(55, 74, 3, 6, 10, 109);
      return ink ? [29, 29, 27, 255] : [244, 239, 230, 255];
    });

  it('reports ink box, baseline, heights, stroke and colors per line', () => {
    const dir = workdir();
    const ref = path.join(dir, 'ref.png');
    writeFileSync(ref, measurePng());
    const result = run('reference-pack.mjs', ['measure', ref, '0,0,120,90'], replicationSkillDir);
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(
      'line 1: ink 20,4 58x31 | baseline 29 | xHeight 14 | capOrAscender 26 | ' +
        'descender 5 | stroke 2 | ink #1d1d1b on #f4efe6'
    );
    expect(lines[1]).toBe('  ratios: x/cap 0.54  stroke/cap 0.08');
    expect(lines[2]).toContain('line 2: ink 10,55 99x20 | baseline 74 | xHeight ?');
    expect(lines[2]).toContain('capOrAscender 20 | descender 0 | stroke 3');
    expect(lines[3]).toBe('  ratios: stroke/cap 0.15');
  });

  it('measures a sub-region in original image coordinates', () => {
    const dir = workdir();
    const ref = path.join(dir, 'ref.png');
    writeFileSync(ref, measurePng());
    const result = run('reference-pack.mjs', ['measure', ref, '5,50,110,30'], replicationSkillDir);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('line 1: ink 10,55 99x20 | baseline 74');
  });

  it('rejects malformed and out-of-bounds regions and non-PNG input', () => {
    const dir = workdir();
    const ref = path.join(dir, 'ref.png');
    writeFileSync(ref, measurePng());
    const bad = run('reference-pack.mjs', ['measure', ref, '9,9,120,90'], replicationSkillDir);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('outside image');
    const malformed = run('reference-pack.mjs', ['measure', ref, 'bad'], replicationSkillDir);
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain('x,y,w,h');
    const notPng = path.join(dir, 'ref.txt');
    writeFileSync(notPng, 'not an image');
    const wrong = run('reference-pack.mjs', ['measure', notPng, '0,0,4,4'], replicationSkillDir);
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain('needs a PNG');
  });

  it('fails when the region holds no ink', () => {
    const dir = workdir();
    const ref = path.join(dir, 'blank.png');
    writeFileSync(ref, syntheticPng(32, 32, [200, 200, 200]));
    const result = run('reference-pack.mjs', ['measure', ref, '0,0,32,32'], replicationSkillDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no ink pixels');
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
    const plain = run('reference-pack.mjs', ['alpha', file], replicationSkillDir);
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
      run('reference-pack.mjs', ['alpha', file, '--threshold', '128'], replicationSkillDir).stdout
    );
    expect(threshold.thresholdBounds).toEqual({ x: 5, y: 3, width: 6, height: 4 });
  });

  it('trim removes only fully transparent padding by default and keeps every pixel', () => {
    const dir = workdir();
    const { file, bytes } = writeLayer(dir);
    const out = path.join(dir, 'trimmed.png');
    const result = run('reference-pack.mjs', ['trim', file, out], replicationSkillDir);
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
    const result = run(
      'reference-pack.mjs',
      ['trim', file, out, '--alpha-above', '128', '--margin', '1'],
      replicationSkillDir
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ x: 4, y: 2, width: 8, height: 6 });
    const guarded = decodeTestPng(readFileSync(out));
    expect(guarded.pixel(1, 1)).toEqual([255, 0, 0, 255]);
    expect(guarded.pixel(0, 0)).toEqual([0, 0, 255, 20]);
  });

  it('trim refuses to overwrite its source, orphan options and empty layers', () => {
    const dir = workdir();
    const { file, bytes } = writeLayer(dir);
    const overwrite = run('reference-pack.mjs', ['trim', file, file], replicationSkillDir);
    expect(overwrite.status).toBe(1);
    expect(overwrite.stderr).toContain('must not overwrite');
    expect(readFileSync(file)).toEqual(bytes);
    const orphan = run(
      'reference-pack.mjs',
      ['trim', file, path.join(dir, 'o.png'), '--margin', '2'],
      replicationSkillDir
    );
    expect(orphan.status).toBe(1);
    expect(orphan.stderr).toContain('--margin applies only with --alpha-above');
    const empty = path.join(dir, 'empty.png');
    writeFileSync(
      empty,
      rgbaPng(4, 4, () => [0, 0, 0, 0])
    );
    const nothing = run(
      'reference-pack.mjs',
      ['trim', empty, path.join(dir, 'e.png')],
      replicationSkillDir
    );
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
    const result = run('reference-pack.mjs', ['compare', file, other, out], replicationSkillDir);
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
    const mismatch = run(
      'reference-pack.mjs',
      ['compare', file, small, path.join(dir, 'x')],
      replicationSkillDir
    );
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain('same-size');
  });
});
