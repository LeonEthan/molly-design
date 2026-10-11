// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createElementHighlight,
  HIGHLIGHT_HOLD_MS,
} from '../../design-bento/src/element-highlight';

let highlight: ReturnType<typeof createElementHighlight>;
const boxes = (tone?: string) =>
  [...document.querySelectorAll<HTMLElement>('.molly-highlight')].filter(
    (node) => !tone || node.dataset.tone === tone
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  document.body.innerHTML =
    '<div class="ed-stage-scale"><div data-el-id="title"></div><div data-el-id="leaf"></div></div>';
  for (const node of document.querySelectorAll('[data-el-id]'))
    Object.defineProperty(node, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 200, right: 300, bottom: 260, width: 200, height: 60 }),
    });
  highlight = createElementHighlight();
});
afterEach(() => {
  highlight.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('outlines elements in screen pixels without intercepting input', () => {
  highlight.show([{ tone: 'changed', elementIds: ['title', 'missing'] }]);
  const [box, absent] = boxes('changed');
  expect(box.hidden).toBe(false);
  expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual([
    '97px',
    '197px',
    '206px',
    '66px',
  ]);
  expect(absent.hidden).toBe(true);
  expect(document.querySelector('.molly-highlight-layer')?.getAttribute('aria-hidden')).toBe(
    'true'
  );
});

it('fades settled outlines and keeps the working outline until cleared', () => {
  highlight.show([{ tone: 'working', elementIds: ['title'] }]);
  highlight.show([
    { tone: 'changed', elementIds: ['title'] },
    { tone: 'outside', elementIds: ['leaf'] },
  ]);
  expect(boxes('working')).toHaveLength(1);
  vi.advanceTimersByTime(HIGHLIGHT_HOLD_MS.changed!);
  expect(boxes('changed')[0].dataset.fading).toBe('true');
  vi.advanceTimersByTime(600);
  expect(boxes('changed')).toHaveLength(0);
  expect(boxes('outside')).toHaveLength(1);
  vi.advanceTimersByTime(HIGHLIGHT_HOLD_MS.outside!);
  expect(boxes('outside')).toHaveLength(0);
  expect(boxes('working')).toHaveLength(1);
  highlight.show([{ tone: 'working', elementIds: [] }]);
  expect(boxes()).toHaveLength(0);
});

it('clears every tone for an empty list and removes its layer on dispose', () => {
  highlight.show([
    { tone: 'working', elementIds: ['title'] },
    { tone: 'outside', elementIds: ['leaf'] },
  ]);
  highlight.show([]);
  expect(boxes()).toHaveLength(0);
  highlight.dispose();
  expect(document.querySelector('.molly-highlight-layer')).toBeNull();
  highlight = createElementHighlight();
});
