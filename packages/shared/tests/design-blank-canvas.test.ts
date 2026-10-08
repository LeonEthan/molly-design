import { expect, it } from 'vitest';
import { isBlankCanvas } from '../src/design-blank-canvas';

const white = { type: 'solid', color: '#FFFFFF' };

it('treats an untouched canvas as blank', () => {
  expect(isBlankCanvas({ elements: [], background: white })).toBe(true);
});

it('does not treat a canvas with elements as blank', () => {
  expect(isBlankCanvas({ elements: [{ id: 'a' }], background: white })).toBe(false);
});

it('does not treat a changed background as blank', () => {
  expect(isBlankCanvas({ elements: [], background: { type: 'solid', color: '#101820' } })).toBe(
    false
  );
  expect(
    isBlankCanvas({ elements: [], background: { type: 'gradient', stops: [] } })
  ).toBe(false);
  expect(isBlankCanvas({ elements: [], background: { type: 'image' } })).toBe(false);
});
