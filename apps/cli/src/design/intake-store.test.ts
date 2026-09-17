/**
 * Intake → store integration: a synthetic YAML artwork must import through
 * @molly/design-authoring and pass the single-writer design store validation
 * (schema + kernel replay + asset integrity). Synthetic fixtures only.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { intakeAuthoring } from '@molly/design-authoring';
import { designOperation } from './store';

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

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('YAML intake → design store', () => {
  it('a synthetic YAML artwork imports and saves through designOperation validation', async () => {
    const dataRoot = mkdtempSync(path.join(tmpdir(), 'molly-intake-store-'));
    roots.push(dataRoot);

    const snapshot = new Map<string, Uint8Array>([
      [
        'design.yaml',
        enc.encode(`format: molly-canvas/1
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
`),
      ],
      ['media/pic.png', syntheticPng(8, 8, [31, 107, 138])],
    ]);

    const intake = intakeAuthoring('design.yaml', snapshot);
    expect(intake.status).toBe('ok');
    if (intake.status !== 'ok') return;

    const sessionId = crypto.randomUUID();
    const association = {
      sessionId,
      name: 'Store test',
      userId: 'user-test',
      machineId: 'machine-test',
      createdAt: new Date().toISOString(),
    };
    const created = await designOperation(dataRoot, {
      operation: 'create',
      association,
      width: intake.document.canvas.width,
      height: intake.document.canvas.height,
    });

    const assets: Record<string, string> = {};
    for (const [hash, bytes] of intake.assets) {
      assets[hash] = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
    }
    const saved = await designOperation(dataRoot, {
      operation: 'save',
      sessionId,
      baseRevisionId: created.revisionId,
      content: { doc: intake.document as unknown as Record<string, unknown>, assets },
    });
    expect(saved.doc.elements).toHaveLength(3);

    const reread = await designOperation(dataRoot, { operation: 'read', sessionId });
    expect(reread.revisionId).toBe(saved.revisionId);
    expect(reread.doc.canvas).toEqual({ width: 320, height: 200 });
  });

  it('an invalid YAML artwork never reaches the store (tri-state invalid)', () => {
    const snapshot = new Map<string, Uint8Array>([
      [
        'design.yaml',
        enc.encode(
          'format: molly-canvas/1\nsize: [320, 200]\nelements:\n  - id: x\n    kind: image\n    bounds: [0, 0, 10, 10]\n    src: media/missing.png\n'
        ),
      ],
    ]);
    const intake = intakeAuthoring('design.yaml', snapshot);
    expect(intake.status).toBe('invalid');
    if (intake.status !== 'invalid') return;
    expect(intake.diagnostics.some((d) => d.code === 'MOLLY-E005')).toBe(true);
  });
});
