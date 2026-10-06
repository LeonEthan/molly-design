import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { checkDesignGate } from './design-eval-gate.mjs';

const gate = {
  canvas: [800, 1000],
  requiredText: ['假期快乐！', '一起喝'],
  textInsideCanvas: true,
};
const text = (id, bounds, ...paragraphs) => ({
  id,
  kind: 'text',
  bounds,
  text: { paragraphs: paragraphs.map((value) => ({ runs: [{ text: value }] })) },
});

void test('passes when required copy is editable text inside the canvas', () => {
  const doc = {
    canvas: { width: 800, height: 1000 },
    elements: [text('headline', [40, 40, 600, 200], '假期快乐！', '一起 喝')],
  };
  assert.deepEqual(checkDesignGate(gate, doc), { status: 'passed', failures: [] });
});

void test('reports wrong canvas, missing copy and overflowing text', () => {
  const doc = {
    canvas: { width: 800, height: 900 },
    elements: [
      text('headline', [700, 40, 200, 100], '假期快乐！'),
      { id: 'photo', kind: 'image', bounds: [0, 0, 800, 900] },
    ],
  };
  assert.deepEqual(checkDesignGate(gate, doc), {
    status: 'failed',
    failures: [
      'canvas is 800x900, expected 800x1000',
      'missing editable text: 一起喝',
      'text headline extends outside the canvas',
    ],
  });
});
