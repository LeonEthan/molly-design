/**
 * Intake tests: synthetic YAML artwork fixtures only (no captured content).
 */

import { deflateSync } from 'node:zlib';
import { copyFileSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { intakeAuthoring } from '../src/intake.ts';
import { AUTHORING_DEFAULT_FONT_FAMILY } from '../src/canvas-format.ts';
import {
  loadBentoDocV4,
  BentoDocUnknownFieldError,
  UnsupportedSchemaVersionError,
} from '../src/migrate.ts';
import {
  collectAuthoring,
  assertAuthoringEntry,
  isAuthoringRelPath,
  AuthoringSnapshotError,
} from '../src/collect-authoring.ts';

/** Minimal valid 8-bit RGB PNG encoder for synthetic fixtures. */
function syntheticPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
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
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ])
  );
}

const enc = new TextEncoder();

const VALID_PAGE = `format: molly-canvas/1
size: [320, 200]
background:
  type: solid
  color: "#FFFFFF"
elements:
  - id: title
    kind: text
    bounds: [10, 10, 200, 40]
    text:
      paragraphs:
        - runs:
            - text: "Hello"
              fontSize: 24
              bold: true
  - id: band
    kind: shape
    bounds: [10, 60, 100, 100]
    shapeName: rect
    fill:
      type: solid
      color: "#1F6B8A"
  - id: photo
    kind: image
    bounds: [120, 60, 64, 64]
    src: media/pic.png
    fit: cover
`;

function snapshotWith(overrides: Record<string, Uint8Array | undefined>): Map<string, Uint8Array> {
  const snapshot = new Map<string, Uint8Array>([
    ['design.yaml', enc.encode(VALID_PAGE)],
    ['media/pic.png', syntheticPng(8, 8, [31, 107, 138])],
  ]);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) snapshot.delete(key);
    else snapshot.set(key, value);
  }
  return snapshot;
}

describe('intakeAuthoring', () => {
  it('imports a minimal valid YAML project (text, shape, image) into BentoDoc v4', () => {
    const result = intakeAuthoring('design.yaml', snapshotWith({}));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.document.schemaVersion).toBe(4);
    expect(result.document.canvas).toEqual({ width: 320, height: 200 });
    expect(result.document.elements.map((el) => el.kind)).toEqual(['text', 'shape', 'image']);
    expect(result.document.elements.map((el) => el.id)).toEqual(['title', 'band', 'photo']);
    expect(result.assets.size).toBe(1);
    const [hash] = result.assets.keys();
    const image = result.document.elements[2];
    expect(image?.kind === 'image' && image.src).toBe(`asset:${hash}`);
    expect(result.profileVersion).toBe('v1');
    expect(result.sourceMap).toEqual({
      title: ['title'],
      band: ['band'],
      photo: ['photo'],
    });
  });

  it('does not default omitted fontFamily to MiSans', () => {
    const result = intakeAuthoring('design.yaml', snapshotWith({}));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const title = result.document.elements[0];
    expect(title?.kind).toBe('text');
    expect(JSON.stringify(result.document)).not.toMatch(/MiSans/);
    if (title?.kind !== 'text') return;
    expect(
      title.text.fontFamily === undefined || title.text.fontFamily === AUTHORING_DEFAULT_FONT_FAMILY
    ).toBe(true);
    expect(AUTHORING_DEFAULT_FONT_FAMILY).toBe('Inter');
  });

  it('rejects a missing media reference with MOLLY-E005', () => {
    const result = intakeAuthoring('design.yaml', snapshotWith({ 'media/pic.png': undefined }));
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(
      result.diagnostics.some((d) => d.code === 'MOLLY-E005' && d.message.includes('media/pic.png'))
    ).toBe(true);
  });

  it('rejects a remote image URL with MOLLY-E004', () => {
    const result = intakeAuthoring(
      'design.yaml',
      snapshotWith({
        'design.yaml': enc.encode(VALID_PAGE.replace('media/pic.png', 'https://example.com/x.png')),
      })
    );
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.diagnostics.some((d) => d.code === 'MOLLY-E004')).toBe(true);
  });

  it('rejects an out-of-vocabulary kind with MOLLY-E003', () => {
    const result = intakeAuthoring(
      'design.yaml',
      snapshotWith({
        'design.yaml': enc.encode(VALID_PAGE.replace('kind: shape', 'kind: widget')),
      })
    );
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.diagnostics.some((d) => d.code === 'MOLLY-E003')).toBe(true);
  });

  it('rejects unknown fields with MOLLY-E001', () => {
    const result = intakeAuthoring(
      'design.yaml',
      snapshotWith({
        'design.yaml': enc.encode(
          VALID_PAGE.replace('shapeName: rect', 'shapeName: rect\n    bogus: 1')
        ),
      })
    );
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(
      result.diagnostics.some((d) => d.code === 'MOLLY-E001' && d.path.includes('bogus'))
    ).toBe(true);
  });

  it('rejects extra pages with the matrix-derived excluded capability code', () => {
    const result = intakeAuthoring(
      'design.yaml',
      snapshotWith({
        'design.yaml': enc.encode(
          'size: [320, 200]\npages:\n  - pages/canvas.yaml\n  - pages/second.yaml\n'
        ),
      })
    );
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(
      result.diagnostics.some((d) => d.code === 'MOLLY-E011' && d.message.includes('multiPage'))
    ).toBe(true);
  });

  it('rejects a media reference escaping media/ with MOLLY-E005', () => {
    const result = intakeAuthoring(
      'design.yaml',
      snapshotWith({
        'design.yaml': enc.encode(VALID_PAGE.replace('media/pic.png', '../escape.png')),
      })
    );
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.diagnostics.some((d) => d.code === 'MOLLY-E005')).toBe(true);
  });
});

describe('bundled minimal example', () => {
  it('is valid YAML artwork that intakeAuthoring accepts', () => {
    const exampleRoot = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'skills',
      'graphic-design',
      'examples',
      'minimal'
    );
    const dir = mkdtempSync(path.join(tmpdir(), 'molly-example-'));
    mkdirSync(path.join(dir, 'pages'));
    mkdirSync(path.join(dir, 'media'));
    copyFileSync(path.join(exampleRoot, 'design.yaml'), path.join(dir, 'design.yaml'));
    copyFileSync(
      path.join(exampleRoot, 'media', 'swatch.png'),
      path.join(dir, 'media', 'swatch.png')
    );
    const snapshot = collectAuthoring(dir);
    expect([...snapshot.keys()].sort()).toEqual(['design.yaml', 'media/swatch.png']);
    const manifest = new TextDecoder().decode(snapshot.get('design.yaml'));
    const page = manifest;
    expect(manifest).not.toMatch(/version:\s*v[23]/);
    expect(page).not.toMatch(/\belementId\b|\belementType\b/);
    expect(page).toMatch(/\bid:\s/);
    expect(page).toMatch(/\bkind:\s/);
    const result = intakeAuthoring('design.yaml', snapshot);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.document.elements.length).toBeGreaterThan(0);
    expect(
      result.document.elements.every(
        (el) => typeof el.id === 'string' && typeof el.kind === 'string'
      )
    ).toBe(true);
  });
});

describe('loadBentoDocV4', () => {
  it('returns a v4 document unchanged', () => {
    const result = intakeAuthoring('design.yaml', snapshotWith({}));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(loadBentoDocV4(result.document)).toEqual(result.document);
  });

  it('rejects unknown fields and unsupported schema versions', () => {
    expect(() => loadBentoDocV4({ schemaVersion: 4, bogus: true })).toThrow(
      BentoDocUnknownFieldError
    );
    expect(() => loadBentoDocV4({ schemaVersion: 99 })).toThrow(UnsupportedSchemaVersionError);
  });
});

describe('collectAuthoring', () => {
  it('collects design.yaml and media, and ignores unrelated files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'molly-collect-'));
    mkdirSync(path.join(dir, 'media'));
    writeFileSync(
      path.join(dir, 'design.yaml'),
      'format: molly-canvas/1\nsize: [320, 200]\nelements: []\n'
    );
    writeFileSync(path.join(dir, 'media', 'pic.png'), syntheticPng(8, 8, [31, 107, 138]));
    writeFileSync(path.join(dir, 'unrelated.txt'), 'ignored\n');
    expect(isAuthoringRelPath('design.yaml')).toBe(true);
    expect(isAuthoringRelPath('pages/canvas.yaml')).toBe(false);
    expect(isAuthoringRelPath('media/pic.png')).toBe(true);
    expect(isAuthoringRelPath('design.pptd')).toBe(false);
    expect(isAuthoringRelPath('pages/other.yaml')).toBe(false);
    const snapshot = collectAuthoring(dir);
    expect([...snapshot.keys()].sort()).toEqual(['design.yaml', 'media/pic.png']);
    expect(() => assertAuthoringEntry(snapshot.keys())).not.toThrow();
    expect(() => assertAuthoringEntry(['pages/canvas.yaml'])).toThrow(AuthoringSnapshotError);
  });

  it('refuses a leftover design.pptd with a named diagnostic', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'molly-collect-pptd-'));
    mkdirSync(path.join(dir, 'pages'));
    writeFileSync(
      path.join(dir, 'design.yaml'),
      'size: [320, 200]\npages:\n  - pages/canvas.yaml\n'
    );
    writeFileSync(path.join(dir, 'pages', 'canvas.yaml'), 'elements: []\n');
    writeFileSync(path.join(dir, 'design.pptd'), 'version: v2\n');
    expect(() => collectAuthoring(dir)).toThrow(/MOLLY-E-PPTD/);
  });

  it('refuses extra pages instead of collecting a second canvas', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'molly-collect-pages-'));
    mkdirSync(path.join(dir, 'pages'));
    writeFileSync(
      path.join(dir, 'design.yaml'),
      'size: [320, 200]\npages:\n  - pages/canvas.yaml\n'
    );
    writeFileSync(path.join(dir, 'pages', 'canvas.yaml'), 'elements: []\n');
    writeFileSync(path.join(dir, 'pages', 'other.yaml'), 'elements: []\n');
    expect(() => collectAuthoring(dir)).toThrow(/extra page is not admitted/);
  });

  it('refuses a missing entry and symlinked page entries', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'molly-collect-'));
    expect(() => collectAuthoring(dir)).toThrow(AuthoringSnapshotError);
    writeFileSync(
      path.join(dir, 'design.yaml'),
      'size: [320, 200]\npages:\n  - pages/canvas.yaml\n'
    );
    mkdirSync(path.join(dir, 'pages'));
    writeFileSync(path.join(dir, 'pages', 'canvas.yaml'), 'elements: []\n');
    symlinkSync('canvas.yaml', path.join(dir, 'pages', 'evil.yaml'));
    expect(() => collectAuthoring(dir)).toThrow(AuthoringSnapshotError);
  });
});
