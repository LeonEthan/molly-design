import { expect, test } from 'vitest';
import { intakeAuthoring } from '../src/index.ts';

const snapshot = (count: number, curve = 'smooth') =>
  new Map([
    [
      'design.yaml',
      new TextEncoder().encode(
        JSON.stringify({
          format: 'molly-canvas/1',
          size: [800, 600],
          elements: [
            {
              id: 'synthetic-stroke',
              kind: 'line',
              bounds: [10, 10, 100, 100],
              viewBox: [100, 100],
              curve,
              points: Array.from({ length: count }, (_, i) => `${i * 10},${i * 5}`).join(' '),
            },
          ],
        })
      ),
    ],
  ]);

test.each([3, 5, 6, 8])(
  'rejects smooth line with %i points before producing a canonical document',
  (count) => {
    const result = intakeAuthoring('design.yaml', snapshot(count));
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.diagnostics.some((d) => /synthetic-stroke.*smooth/.test(d.message))).toBe(true);
    }
  }
);

test.each([2, 4, 7, 10])('preserves renderer-supported smooth line with %i points', (count) => {
  expect(intakeAuthoring('design.yaml', snapshot(count)).status).toBe('ok');
});

test.each(['sharp', 'round'])('allows three-point %s lines', (curve) => {
  expect(intakeAuthoring('design.yaml', snapshot(3, curve)).status).toBe('ok');
});
