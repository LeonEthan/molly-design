import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export interface CropCase {
  name: string;
  left: number;
  top: number;
  scale: number;
  softEdge?: boolean;
  fit?: 'fill' | 'contain' | 'cover';
  rotation?: number;
  shadow?: boolean;
}

export const cropCases: CropCase[] = [
  { name: 'original', left: 17, top: 21, scale: 0.75 },
  { name: 'repeat', left: 17, top: 21, scale: 0.75 },
  { name: 'aligned', left: 16, top: 20, scale: 0.75 },
  { name: 'half', left: 17, top: 21, scale: 0.5 },
  { name: 'soft-edge', left: 17, top: 21, scale: 0.75, softEdge: true },
  { name: 'soft-edge-aligned', left: 16, top: 20, scale: 0.75, softEdge: true },
];
export const acceptanceCases: CropCase[] = [
  'contain',
  'cover',
  'shadow',
  'rotate-15',
  'rotate-360',
].flatMap((variant) =>
  [17, 16].map((left) => ({
    name: `${variant}-${left}`,
    left,
    top: left + 4,
    scale: 0.75,
    softEdge: variant === 'shadow',
    ...(variant === 'contain' || variant === 'cover' ? { fit: variant } : {}),
    ...(variant === 'shadow' ? { shadow: true } : {}),
    ...(variant.startsWith('rotate-') ? { rotation: Number(variant.slice(7)) } : {}),
  }))
);

export const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');

export function patternBitmap(left = 0, top = 0, width = 128, height = 128, softEdge = false) {
  const bytes = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x + left - 19;
      const v = y + top - 23;
      if (u < 0 || u >= 90 || v < 0 || v >= 80) continue;
      const i = (y * width + x) * 4;
      bytes[i] = (5 * u + 17 * v) % 256;
      bytes[i + 1] = (19 * u + 7 * v) % 256;
      bytes[i + 2] = (Math.floor(u / 2) + Math.floor(v / 2)) % 2 ? 220 : 30;
      bytes[i + 3] = softEdge ? Math.min(255, 1 + Math.min(u, v, 89 - u, 79 - v) * 64) : 255;
    }
  }
  return { width, height, bitmap: bytes.toString('base64') };
}

export function cropFixture(spec: CropCase, pngs: string[]) {
  assert.equal(pngs.length, 2);
  const hashes = pngs.map((uri) => sha256(Buffer.from(uri.split(',')[1]!, 'base64')));
  const rows = [
    { scale: 1, x: 32, y: 40 },
    { scale: spec.scale, x: 32, y: 248 },
    { scale: 623 / 858, x: 32.87995337995335, y: 456.07925407925404 },
  ];
  const elements = rows.flatMap(({ scale, x, y }, row) => {
    const angle = ((spec.rotation ?? 0) * Math.PI) / 180;
    const dx = (spec.left + 47 - 64) * scale;
    const dy = (spec.top + 42 - 64) * scale;
    const cropX = x + 256 + 64 * scale + dx * Math.cos(angle) - dy * Math.sin(angle) - 47 * scale;
    const cropY = y + 64 * scale + dx * Math.sin(angle) + dy * Math.cos(angle) - 42 * scale;
    const effects = {
      ...(spec.rotation === undefined ? {} : { rotation: spec.rotation }),
      ...(spec.shadow ? { shadow: { blur: 3, offset: [4, 5], color: '#00000066' } } : {}),
    };
    return [
      {
        id: `full-${row}`,
        kind: 'image' as const,
        bounds: [x, y, 128 * scale, 128 * scale] as [number, number, number, number],
        src: `asset:${hashes[0]}`,
        fit: spec.fit ?? 'fill',
        ...effects,
        zIndex: row * 2,
      },
      {
        id: `crop-${row}`,
        kind: 'image' as const,
        bounds: [
          spec.rotation === undefined ? x + 256 + spec.left * scale : cropX,
          spec.rotation === undefined ? y + spec.top * scale : cropY,
          94 * scale,
          84 * scale,
        ] as [number, number, number, number],
        src: `asset:${hashes[1]}`,
        fit: spec.fit ?? 'fill',
        ...effects,
        zIndex: row * 2 + 1,
      },
    ];
  });
  return {
    doc: {
      schemaVersion: 4 as const,
      canvas: { width: 512, height: 624 },
      background: { type: 'solid', color: '#F4F1E8' },
      fonts: [],
      diagnostics: [],
      elements,
    },
    assets: Object.fromEntries(hashes.map((hash, i) => [hash, pngs[i]!])),
  };
}

export function compareColumns(bitmap: Uint8Array, width: number, height: number) {
  assert.equal(width, 512, 'Export width changed');
  assert.equal(height, 624, 'Export height changed');
  assert.equal(bitmap.length, width * height * 4);
  return [0, 1, 2].map((row) => {
    let differingPixels = 0;
    let maxChannelDifference = 0;
    for (let y = row * 208; y < (row + 1) * 208; y++) {
      for (let x = 0; x < 256; x++) {
        const a = (y * width + x) * 4;
        const b = (y * width + x + 256) * 4;
        let delta = 0;
        for (let channel = 0; channel < 4; channel++) {
          delta = Math.max(delta, Math.abs(bitmap[a + channel]! - bitmap[b + channel]!));
        }
        if (delta) differingPixels++;
        maxChannelDifference = Math.max(maxChannelDifference, delta);
      }
    }
    return { row, differingPixels, maxChannelDifference };
  });
}
