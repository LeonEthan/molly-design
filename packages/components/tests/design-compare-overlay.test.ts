// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createCompareOverlay } from '../../design-bento/src/compare-overlay';

function slide(left: number, top: number, width: number, height: number) {
  const scale = document.createElement('div');
  scale.className = 'ed-stage-scale';
  const node = document.createElement('div');
  node.className = 'bento-slide';
  Object.defineProperty(node, 'getBoundingClientRect', {
    value: () => ({ left, top, right: left + width, bottom: top + height, width, height }),
  });
  scale.append(node);
  document.body.append(scale);
}

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

it('shows the frame exactly over the stage and hides it again', () => {
  slide(10, 20, 800, 400);
  const overlay = createCompareOverlay();
  overlay.show('data:image/png;base64,AAAA');
  const layer = document.querySelector<HTMLElement>('.molly-compare')!;
  const image = layer.querySelector('img')!;
  expect(layer.hidden).toBe(false);
  expect(image.src).toContain('data:image/png');
  expect(image.style.left).toBe('10px');
  expect(image.style.top).toBe('20px');
  expect(image.style.width).toBe('800px');
  expect(image.style.height).toBe('400px');
  expect(image.style.visibility).toBe('visible');
  overlay.hide();
  expect(layer.hidden).toBe(true);
  overlay.dispose();
});

it('stays invisible while the stage is gone and blocks pointer input on the artwork', () => {
  const overlay = createCompareOverlay();
  overlay.show('data:image/png;base64,AAAA');
  const layer = document.querySelector<HTMLElement>('.molly-compare')!;
  const image = layer.querySelector('img')!;
  expect(layer.hidden).toBe(false);
  expect(image.style.visibility).toBe('hidden');
  expect(getComputedStyle(image).pointerEvents).toBe('auto');
  overlay.dispose();
  expect(document.querySelector('.molly-compare')).toBeNull();
});
