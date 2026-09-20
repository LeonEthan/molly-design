import { expect, test } from 'vitest';
import { intakeAuthoring } from '../src/index.ts';

const snapshot = (count: number, curve = 'smooth', viewBox: unknown = [100, 100]) =>
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
              viewBox,
              curve,
              points: Array.from({ length: count }, (_, i) => `${i * 10},${i * 5}`).join(' '),
            },
          ],
        })
      ),
    ],
  ]);

test('identifies the rejected element when line viewBox uses SVG string syntax', () => {
  const result = intakeAuthoring('design.yaml', snapshot(2, 'sharp', '0 0 100 100'));
  expect(result.status).toBe('invalid');
  if (result.status === 'invalid') {
    expect(result.diagnostics).toContainEqual({
      code: 'MOLLY-E013',
      path: 'design.yaml#',
      message:
        'Element "synthetic-stroke": createElement nested fields are outside the validated v4 domains',
    });
  }
  expect(intakeAuthoring('design.yaml', snapshot(2, 'sharp', [100, 100])).status).toBe('ok');
});

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
