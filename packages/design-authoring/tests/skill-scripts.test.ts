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
import { deflateSync } from 'node:zlib';
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

function syntheticPng(width: number, height: number, rgb: [number, number, number]): Buffer {
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
  ihdr[9] = 2;
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const d = y * (stride + 1) + 1 + x * 3;
      raw[d] = rgb[0];
      raw[d + 1] = rgb[1];
      raw[d + 2] = rgb[2];
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
  it('accepts the editable text example published in the format guide', () => {
    const guide = readFileSync(path.join(skillDir, 'references', 'artwork-format.md'), 'utf8');
    const example = guide.match(/```yaml\n([\s\S]*?)```/)?.[1];
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
