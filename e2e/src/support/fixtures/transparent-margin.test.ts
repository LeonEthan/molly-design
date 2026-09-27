import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acceptanceCases,
  cropFixture,
  compareColumns,
  patternBitmap,
} from './transparent-margin.js';

void test('both crop origins preserve every source pixel without resampling', () => {
  const full = Buffer.from(patternBitmap().bitmap, 'base64');
  for (const [left, top] of [
    [17, 21],
    [16, 20],
  ]) {
    const crop = Buffer.from(patternBitmap(left, top, 94, 84).bitmap, 'base64');
    for (let y = 0; y < 84; y++) {
      assert.deepEqual(
        crop.subarray(y * 94 * 4, (y + 1) * 94 * 4),
        full.subarray(((y + top!) * 128 + left!) * 4, ((y + top!) * 128 + left! + 94) * 4)
      );
    }
  }
});

void test('comparison detects RGB and alpha changes in separate comparison rows', () => {
  const pixels = Buffer.alloc(512 * 624 * 4, 255);
  assert.ok(compareColumns(pixels, 512, 624).every((row) => row.differingPixels === 0));
  pixels[(40 * 512 + 32 + 256) * 4] = 180;
  pixels[(248 * 512 + 32 + 256) * 4 + 3] = 254;
  assert.deepEqual(compareColumns(pixels, 512, 624), [
    { row: 0, differingPixels: 1, maxChannelDifference: 75 },
    { row: 1, differingPixels: 1, maxChannelDifference: 1 },
    { row: 2, differingPixels: 0, maxChannelDifference: 0 },
  ]);
  assert.throws(() => compareColumns(pixels, 511, 624), /Export width changed/);
});

void test('soft-edge fixture retains alpha one and both crops preserve it', () => {
  const full = Buffer.from(patternBitmap(0, 0, 128, 128, true).bitmap, 'base64');
  assert.equal(full[(23 * 128 + 19) * 4 + 3], 1);
  for (const [left, top] of [
    [17, 21],
    [16, 20],
  ]) {
    const crop = Buffer.from(patternBitmap(left, top, 94, 84, true).bitmap, 'base64');
    for (let y = 0; y < 84; y++) {
      assert.deepEqual(
        crop.subarray(y * 94 * 4, (y + 1) * 94 * 4),
        full.subarray(((y + top!) * 128 + left!) * 4, ((y + top!) * 128 + left! + 94) * 4)
      );
    }
  }
});

void test('rotated fixtures retain the same source-to-canvas mapping', () => {
  const asset = 'data:image/png;base64,AA==';
  for (const spec of acceptanceCases.filter((item) => item.rotation !== undefined)) {
    const fixture = cropFixture(spec, [asset, asset]);
    for (let row = 0; row < 3; row++) {
      const full = fixture.doc.elements[row * 2]!;
      const crop = fixture.doc.elements[row * 2 + 1]!;
      const point = (
        element: typeof full,
        u: number,
        v: number,
        sourceWidth: number,
        sourceHeight: number
      ) => {
        const [x, y, w, h] = element.bounds;
        const angle = (element.rotation! * Math.PI) / 180;
        const dx = (u / sourceWidth - 0.5) * w,
          dy = (v / sourceHeight - 0.5) * h;
        return [
          x + w / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
          y + h / 2 + dx * Math.sin(angle) + dy * Math.cos(angle),
        ];
      };
      for (const [u, v] of [
        [19, 23],
        [64, 64],
        [108, 102],
      ]) {
        const a = point(full, u!, v!, 128, 128),
          b = point(crop, u! - spec.left, v! - spec.top, 94, 84);
        assert.ok(Math.abs(b[0]! - a[0]! - 256) < 1e-10);
        assert.ok(Math.abs(b[1]! - a[1]!) < 1e-10);
      }
    }
  }
});
