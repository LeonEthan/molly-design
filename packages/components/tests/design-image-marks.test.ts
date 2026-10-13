// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DesignToolbarRequest } from '@molly/shared/design-selection-commands';
import {
  createImageMarks,
  drawImageMarks,
  type ImageMark,
} from '../../design-bento/src/image-marks';

let marks: ReturnType<typeof createImageMarks>;
let requests: DesignToolbarRequest[];
let reply: { ok: boolean; error?: string };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  document.body.innerHTML =
    '<div class="ed-stage-scale"><div data-el-id="photo"><div><img src="data:image/png;base64,AA=="></div></div></div>';
  Object.defineProperty(document.querySelector('[data-el-id]'), 'getBoundingClientRect', {
    value: () => ({ left: 100, top: 200, right: 500, bottom: 400, width: 400, height: 200 }),
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return this.tagName === 'IMG' ? 400 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return this.tagName === 'IMG' ? 200 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const left = 100 + (Number.parseFloat(this.style.left) || 0);
    const top = 200 + (Number.parseFloat(this.style.top) || 0);
    return { left, top, right: left, bottom: top, width: 0, height: 0 } as DOMRect;
  });
  requests = [];
  reply = { ok: true };
  marks = createImageMarks({
    request: async (input) => {
      requests.push(input);
      return reply;
    },
  });
  marks.present({ dark: false, actionsEnabled: true, labels: {} });
  marks.setReadonly(false);
});
afterEach(() => {
  marks.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const capture = () => document.querySelector<HTMLElement>('.molly-mark-capture')!;
const panel = () => document.querySelector<HTMLElement>('.molly-mark-panel')!;
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === name)!;
const pointer = (type: string, x: number, y: number) =>
  capture().dispatchEvent(
    new MouseEvent(`pointer${type}`, { clientX: x, clientY: y, button: 0, bubbles: true })
  );
const drag = (from: [number, number], to: [number, number]) => {
  pointer('down', ...from);
  pointer('move', ...to);
  pointer('up', ...to);
};
const describe = (value: string) => {
  const field = panel().querySelector('textarea')!;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
};
const badges = () =>
  [...document.querySelectorAll('.molly-mark-overlay text')].map((node) => [
    node.textContent,
    node.getAttribute('x'),
    node.getAttribute('y'),
  ]);

it('drops numbered boxes and points in image space and sends them by epoch', async () => {
  marks.open('photo', 3);
  expect(panel().hidden).toBe(false);
  drag([300, 250], [140, 380]);
  pointer('down', 400, 300);
  pointer('up', 401, 301);
  expect(badges()).toEqual([
    ['1', '140', '250'],
    ['2', '400', '300'],
  ]);
  expect(button('Send').disabled).toBe(true);
  describe('Make this blue');
  button('Send').click();
  await vi.waitFor(() => expect(panel().hidden).toBe(true));
  expect(requests).toEqual([
    {
      type: 'marks',
      selectionEpoch: 3,
      marksEpoch: expect.any(Number),
      prompt: 'Make this blue',
      send: true,
    },
  ]);
  expect(marks.isOpen()).toBe(false);
});

it('keeps marks and shows the error when the request is refused', async () => {
  reply = { ok: false, error: 'Selection changed' };
  marks.open('photo', 1);
  drag([150, 220], [250, 300]);
  describe('Remove');
  button('Add to chat').click();
  await vi.waitFor(() =>
    expect(panel().querySelector('[role=alert]')?.textContent).toBe('Selection changed')
  );
  expect(requests[0]).toMatchObject({ type: 'marks', send: false });
  expect(badges()).toHaveLength(1);
});

it('caps marks per request and undoes the last one', () => {
  marks.open('photo', 1);
  for (let index = 0; index < 11; index++) {
    pointer('down', 110 + index * 10, 210);
    pointer('up', 110 + index * 10, 210);
  }
  expect(badges()).toHaveLength(10);
  expect(panel().querySelector('[role=alert]')?.textContent).toBe('Up to 10 marks per request');
  button('Undo mark').click();
  expect(badges()).toHaveLength(9);
});

it('closes on Escape, on a different selection, and when the canvas turns readonly', () => {
  marks.open('photo', 1);
  capture().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(marks.isOpen()).toBe(false);
  marks.open('photo', 1);
  marks.select(['photo'], 2);
  expect(marks.isOpen()).toBe(true);
  marks.select(['photo', 'other'], 3);
  expect(marks.isOpen()).toBe(false);
  marks.open('photo', 4);
  marks.setReadonly(true);
  expect(marks.isOpen()).toBe(false);
  expect(panel().hidden).toBe(true);
});

it('reads a marked copy for the current epoch only', async () => {
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      naturalWidth = 3200;
      naturalHeight = 1600;
      decode = async () => undefined;
    }
  );
  const sizes: number[][] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement
  ) {
    sizes.push([this.width, this.height]);
    return new Proxy({}, { get: () => () => undefined, set: () => true }) as never;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,iVBORw0KGgo='
  );
  reply = { ok: false, error: 'Selection changed' };
  marks.open('photo', 1);
  pointer('down', 200, 300);
  pointer('up', 200, 300);
  describe('Fix');
  button('Send').click();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  const [request] = requests;
  if (request?.type !== 'marks') throw Error('Expected a marks request');
  await expect(marks.read(request.marksEpoch + 1)).rejects.toThrow('Marks changed');
  await expect(marks.read(request.marksEpoch)).resolves.toEqual({
    elementId: 'photo',
    count: 1,
    mimeType: 'image/png',
    data: 'iVBORw0KGgo=',
  });
  expect(sizes).toEqual([[1600, 800]]);
  button('Undo mark').click();
  await expect(marks.read(request.marksEpoch)).rejects.toThrow('Marks changed');
});

it('draws each mark with a haloed outline and a numbered badge in order', () => {
  const calls: string[] = [];
  const context = new Proxy(
    {},
    {
      get:
        (_, name: string) =>
        (...args: unknown[]) =>
          calls.push(`${name}(${args.join(',')})`),
      set: () => true,
    }
  );
  const drawn: ImageMark[] = [
    { kind: 'box', from: [0.5, 0.5], to: [0.25, 0.75] },
    { kind: 'point', at: [0.1, 0.2] },
  ];
  drawImageMarks(context as never, drawn, 1000, 400);
  expect(calls.filter((call) => call.startsWith('fillText'))).toEqual([
    'fillText(1,250,200)',
    'fillText(2,100,80)',
  ]);
  expect(calls.filter((call) => call.startsWith('stroke('))).toHaveLength(4);
});
