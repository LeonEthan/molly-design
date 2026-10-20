// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DESIGN_NOTES_MAX,
  DESIGN_STROKE_POINTS_MAX,
  type DesignToolbarRequest,
} from '@molly/shared/design-selection-commands';
import type { HighlightGroup } from '../../design-bento/src/element-highlight';
import { createNotePins } from '../../design-bento/src/note-pins';

vi.mock('../../design-bento/src/image-regions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../design-bento/src/image-regions')>();
  return {
    ...actual,
    imageGeometry: (elementId: string) => {
      const node = document.querySelector<HTMLElement>(`[data-el-id="${elementId}"]`);
      return node
        ? {
            node,
            source: 'asset.png',
            matrix: { a: 400, b: 0, c: 0, d: 200, e: 100, f: 200 },
          }
        : undefined;
    },
  };
});

let pins: ReturnType<typeof createNotePins>;
let requests: DesignToolbarRequest[];
let highlights: HighlightGroup[][];
let selected: string[];
let present: string[];

function element(id: string) {
  return document.querySelector<HTMLElement>(`[data-el-id="${id}"]`)!;
}
function press(target: HTMLElement, init: MouseEventInit = {}) {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, ...init }));
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ...init }));
}
function drag(target: HTMLElement, [fromX, fromY]: number[], [toX, toY]: number[]) {
  const at = (clientX: number, clientY: number) => ({
    bubbles: true,
    button: 0,
    clientX,
    clientY,
  });
  target.dispatchEvent(new MouseEvent('pointerdown', at(fromX, fromY)));
  target.dispatchEvent(new MouseEvent('pointermove', at(toX, toY)));
  target.dispatchEvent(new MouseEvent('pointerup', at(toX, toY)));
}
/** Presses at the first client point, moves through the rest and releases on the last one. */
function stroke(target: HTMLElement, points: number[][]) {
  const at = ([clientX, clientY]: number[]) => ({ bubbles: true, button: 0, clientX, clientY });
  const [first, ...rest] = points;
  target.dispatchEvent(new MouseEvent('pointerdown', at(first)));
  for (const point of rest) target.dispatchEvent(new MouseEvent('pointermove', at(point)));
  target.dispatchEvent(new MouseEvent('pointerup', at(points.at(-1)!)));
}
function button(name: string) {
  const node = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => !item.closest('[hidden]') && !item.hidden && item.getAttribute('aria-label') === name
  );
  if (!node) throw Error(`Missing button: ${name}`);
  return node;
}
function type(text: string) {
  const field = document.querySelector<HTMLTextAreaElement>('.molly-note-editor textarea')!;
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  return field;
}
function escape(field: HTMLElement, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  field.dispatchEvent(event);
  return event;
}
function enter(field: HTMLElement, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  field.dispatchEvent(event);
  return event;
}
function tray() {
  return document.querySelector<HTMLElement>('.molly-note-tray')!;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  document.body.innerHTML =
    '<div class="ed-stage-scale"><div data-el-id="title"><span>Hi</span></div><div data-el-id="photo"></div><div data-el-id="poster"></div></div>';
  for (const node of document.querySelectorAll('[data-el-id]'))
    Object.defineProperty(node, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 200, right: 500, bottom: 400, width: 400, height: 200 }),
    });
  requests = [];
  highlights = [];
  selected = [];
  present = ['title', 'photo', 'poster'];
  pins = createNotePins({
    request: async (input) => {
      requests.push(input);
      return { ok: true };
    },
    selectedIds: () => selected,
    elements: () => present.map((id) => ({ id, kind: id === 'title' ? 'text' : 'image' })),
    highlight: { show: (groups) => highlights.push([...groups]) },
  });
  pins.present({ dark: false, actionsEnabled: true, labels: {} });
  pins.setReadonly(false);
});

afterEach(() => {
  pins.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('drops a numbered pin at the clicked point on Cmd/Ctrl-click and reads its note', () => {
  press(element('title').querySelector('span')!, { metaKey: true, clientX: 150, clientY: 300 });
  expect(button('Note 1: ').textContent).toBe('1');
  type('Warmer headline');
  button('Save note').click();
  press(element('photo'), { ctrlKey: true, clientX: 500, clientY: 400 });
  type('Crop tighter');
  button('Save note').click();
  expect(tray().hidden).toBe(false);
  expect(tray().textContent).toContain('2 comments');
  expect(pins.read().notes).toEqual([
    { elementIds: ['title'], prompt: 'Warmer headline', pin: { elementId: 'title', at: [0.125, 0.5] } },
    { elementIds: ['photo'], prompt: 'Crop tighter', pin: { elementId: 'photo', at: [1, 1] } },
  ]);
});

it('pins the whole selection when the click lands inside it', () => {
  selected = ['title', 'photo'];
  press(element('photo'), { metaKey: true, clientX: 300, clientY: 300 });
  type('Align these');
  button('Save note').click();
  expect(pins.read().notes).toEqual([
    {
      elementIds: ['title', 'photo'],
      prompt: 'Align these',
      pin: { elementId: 'photo', at: [0.5, 0.5] },
    },
  ]);
  expect(tray().textContent).toContain('1 comment');
  expect(tray().textContent).not.toContain('1 comments');
});

it('ignores plain clicks, drags and read-only canvases', () => {
  press(element('title'));
  element('title').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 0 }));
  element('title').dispatchEvent(
    new MouseEvent('click', { bubbles: true, metaKey: true, clientX: 40 })
  );
  pins.setReadonly(true);
  press(element('title'), { metaKey: true });
  expect(document.querySelector('.molly-note-editor')).toBeNull();
  expect(pins.read().notes).toEqual([]);
});

it('turns plain clicks into pins only while the comment tool is on', () => {
  press(element('title'));
  expect(document.querySelector('.molly-note-editor')).toBeNull();
  pins.setTool('comment');
  expect(document.body.dataset.commenting).toBe('true');
  press(element('photo'), { clientX: 300, clientY: 300 });
  type('Crop tighter');
  button('Save note').click();
  expect(pins.read().notes).toEqual([
    { elementIds: ['photo'], prompt: 'Crop tighter', pin: { elementId: 'photo', at: [0.5, 0.5] } },
  ]);
  pins.setTool('select');
  expect(document.body.dataset.commenting).toBe('false');
  press(element('title'));
  expect(document.querySelector('.molly-note-editor')).toBeNull();
});

it('draws a region on an image in comment mode and reads it as that note', () => {
  pins.setTool('comment');
  drag(element('photo'), [200, 250], [300, 350]);
  type('Brighter');
  button('Save note').click();
  expect(pins.read().notes).toEqual([
    {
      elementIds: ['photo'],
      prompt: 'Brighter',
      region: { kind: 'box', from: [0.25, 0.25], to: [0.5, 0.75] },
    },
  ]);
  expect(pins.snapshot()).toEqual(pins.read().notes);
});

it('ignores drags on text, tiny moves, and drags outside comment mode', () => {
  drag(element('photo'), [200, 250], [300, 350]);
  expect(document.querySelector('.molly-note-editor')).toBeNull();
  pins.setTool('comment');
  drag(element('title'), [200, 250], [300, 350]);
  drag(element('photo'), [200, 250], [201, 251]);
  expect(document.querySelector('.molly-note-editor')).toBeNull();
  expect(pins.read().notes).toEqual([]);
});

it('keeps regions on one image and says so when a second image is marked', () => {
  pins.setTool('comment');
  drag(element('photo'), [200, 250], [300, 350]);
  type('Brighter');
  button('Save note').click();
  drag(element('poster'), [200, 250], [300, 350]);
  expect(pins.read().notes).toHaveLength(1);
  expect(tray().querySelector('[role=alert]')?.textContent).toBe(
    'Mark regions on one image at a time'
  );
});

it('reads no marked copy without regions and rejects a stale one', async () => {
  pins.add(['title'], 'Warmer');
  await expect(pins.marked(pins.read().epoch)).resolves.toBeNull();
  await expect(pins.marked(pins.read().epoch - 1)).rejects.toThrow('Notes changed');
});

it('never enters the comment or brush tool while read-only and drops it when the canvas locks', () => {
  pins.setTool('comment');
  pins.setReadonly(true);
  expect(pins.tool()).toBe('select');
  pins.setTool('comment');
  expect(pins.tool()).toBe('select');
  pins.setTool('brush');
  expect(pins.tool()).toBe('select');
  expect(document.body.dataset.brushing).toBe('false');
  press(element('title'));
  expect(document.querySelector('.molly-note-editor')).toBeNull();
  expect(pins.read().notes).toEqual([]);
});

it('keeps the brush and comment tools mutually exclusive', () => {
  pins.setTool('brush');
  expect(pins.tool()).toBe('brush');
  expect(document.body.dataset.brushing).toBe('true');
  expect(document.body.dataset.commenting).toBe('false');
  pins.setTool('comment');
  expect(pins.tool()).toBe('comment');
  expect(document.body.dataset.brushing).toBe('false');
  expect(document.body.dataset.commenting).toBe('true');
  pins.setTool('select');
  expect(pins.tool()).toBe('select');
  expect(document.body.dataset.brushing).toBe('false');
  expect(document.body.dataset.commenting).toBe('false');
});

it('draws a freehand stroke on an image in brush mode and reads it as that note', () => {
  pins.setTool('brush');
  stroke(element('photo'), [
    [200, 250],
    [250, 300],
    [300, 350],
  ]);
  type('Lighter here');
  button('Save note').click();
  expect(pins.read().notes).toEqual([
    {
      elementIds: ['photo'],
      prompt: 'Lighter here',
      region: {
        kind: 'stroke',
        points: [
          [0.25, 0.25],
          [0.375, 0.5],
          [0.5, 0.75],
        ],
      },
    },
  ]);
  expect(pins.snapshot()).toEqual(pins.read().notes);
});

it('caps a dense stroke to the schema point limit and ends it within one thinning step of release', () => {
  pins.setTool('brush');
  const dense = Array.from({ length: 1000 }, (_, index) => [100 + (400 * index) / 999, 300]);
  stroke(element('photo'), dense);
  type('Along the edge');
  button('Save note').click();
  const note = pins.read().notes[0];
  expect(note?.region?.kind).toBe('stroke');
  const points = note?.region?.kind === 'stroke' ? note.region.points : [];
  expect(points).toHaveLength(DESIGN_STROKE_POINTS_MAX);
  expect(points[0]).toEqual([0, 0.5]);
  expect(points.at(-1)?.[0]).toBeCloseTo(1, 2);
});

it('ignores a brush press that never moves and strokes off any image', () => {
  pins.setTool('brush');
  stroke(element('photo'), [[200, 250]]);
  stroke(element('title'), [
    [200, 250],
    [300, 350],
  ]);
  stroke(document.body, [
    [200, 250],
    [300, 350],
  ]);
  expect(document.querySelector('.molly-note-editor')).toBeNull();
  expect(pins.read().notes).toEqual([]);
  expect(regionShading()).toHaveLength(0);
});

it('drops a pin whose note is left empty', () => {
  press(element('title'), { metaKey: true });
  type('   ');
  button('Save note').click();
  expect(pins.read().notes).toEqual([]);
  expect(tray().hidden).toBe(true);
});

it('saves the note on Enter without sending, and keeps Shift+Enter as a newline', () => {
  pins.add(['title'], 'Warmer headline');
  button('Note 1: Warmer headline').click();
  const field = document.querySelector<HTMLTextAreaElement>('.molly-note-editor textarea')!;
  expect(enter(field, { shiftKey: true }).defaultPrevented).toBe(false);
  expect(document.querySelector('.molly-note-editor')).not.toBeNull();
  expect(enter(field).defaultPrevented).toBe(true);
  expect(document.querySelector('.molly-note-editor')).toBeNull();
  expect(pins.read().notes).toEqual([{ elementIds: ['title'], prompt: 'Warmer headline' }]);
  expect(requests).toEqual([]);
});

it('one Escape closes the editor, keeps a written note, and returns to Select', () => {
  pins.setTool('comment');
  pins.add(['title'], 'Warmer headline');
  button('Note 1: Warmer headline').click();
  const field = document.querySelector<HTMLTextAreaElement>('.molly-note-editor textarea')!;
  expect(escape(field).defaultPrevented).toBe(true);
  expect(document.querySelector('.molly-note-editor')).toBeNull();
  expect(pins.tool()).toBe('select');
  expect(pins.read().notes).toEqual([{ elementIds: ['title'], prompt: 'Warmer headline' }]);
});

it('one Escape in Brush drops the empty note being written and returns to Select', () => {
  pins.setTool('brush');
  stroke(element('photo'), [
    [200, 250],
    [300, 350],
  ]);
  const field = document.querySelector<HTMLTextAreaElement>('.molly-note-editor textarea')!;
  escape(field);
  expect(document.querySelector('.molly-note-editor')).toBeNull();
  expect(pins.tool()).toBe('select');
  expect(pins.read().notes).toEqual([]);
  expect(regionShading()).toHaveLength(0);
});

it('keeps the editor and the tool for an Escape that confirms an IME composition', () => {
  pins.setTool('comment');
  pins.add(['title'], 'Warmer');
  button('Note 1: Warmer').click();
  const field = document.querySelector<HTMLTextAreaElement>('.molly-note-editor textarea')!;
  expect(escape(field, { isComposing: true, keyCode: 229 }).defaultPrevented).toBe(false);
  expect(document.querySelector('.molly-note-editor')).not.toBeNull();
  expect(pins.tool()).toBe('comment');
});

it('one Escape from the canvas closes an editor that lost focus and returns to Select', () => {
  pins.setTool('comment');
  pins.add(['title'], 'Warmer');
  button('Note 1: Warmer').click();
  expect(pins.escape()).toBe(true);
  expect(document.querySelector('.molly-note-editor')).toBeNull();
  expect(pins.tool()).toBe('select');
  expect(pins.escape()).toBe(false);
});

it('sends every note on Cmd/Ctrl+Enter from the editor', async () => {
  pins.add(['title'], 'Warmer headline');
  pins.add(['photo'], 'Crop tighter');
  button('Note 1: Warmer headline').click();
  const field = document.querySelector<HTMLTextAreaElement>('.molly-note-editor textarea')!;
  enter(field, { metaKey: true });
  expect(document.querySelector('.molly-note-editor')).toBeNull();
  const { epoch } = pins.read();
  await vi.waitFor(() => expect(requests).toEqual([{ type: 'notes', notesEpoch: epoch }]));
});

it('keeps the editor open for an Enter that confirms an IME candidate', () => {
  pins.add(['title'], 'Warmer');
  button('Note 1: Warmer').click();
  const field = document.querySelector<HTMLTextAreaElement>('.molly-note-editor textarea')!;
  expect(enter(field, { isComposing: true, keyCode: 229 }).defaultPrevented).toBe(false);
  expect(document.querySelector('.molly-note-editor')).not.toBeNull();
  expect(requests).toEqual([]);
});

it('lifts the pin while its editor is open', () => {
  pins.add(['title'], 'Warmer headline');
  const marker = button('Note 1: Warmer headline');
  expect(marker.getAttribute('aria-expanded')).toBe('false');
  marker.click();
  expect(button('Note 1: Warmer headline').getAttribute('aria-expanded')).toBe('true');
  button('Save note').click();
  expect(button('Note 1: Warmer headline').getAttribute('aria-expanded')).toBe('false');
});

it('previews the note text and outlines its targets on hover', () => {
  pins.add(['title'], 'Warmer headline');
  const marker = button('Note 1: Warmer headline');
  marker.dispatchEvent(new Event('pointerenter'));
  const tooltip = document.querySelector<HTMLElement>('.molly-note-tooltip')!;
  expect(tooltip.hidden).toBe(false);
  expect(tooltip.textContent).toBe('Warmer headline');
  expect(highlights).toEqual([[{ tone: 'hover', elementIds: ['title'] }]]);
  marker.dispatchEvent(new Event('pointerleave'));
  expect(tooltip.hidden).toBe(true);
  expect(getComputedStyle(tooltip).display).toBe('none');
  expect(highlights.at(-1)).toEqual([{ tone: 'hover', elementIds: [] }]);
});

it('sends by epoch and rejects a read after the notes changed', async () => {
  pins.add(['title'], 'Warmer headline');
  const { epoch } = pins.read();
  button('Send').click();
  await vi.waitFor(() => expect(requests).toEqual([{ type: 'notes', notesEpoch: epoch }]));
  button('Send').click();
  pins.add(['photo'], 'Crop tighter');
  expect(requests).toHaveLength(1);
  expect(button('Send').disabled).toBe(true);
  expect(pins.settle(epoch, false)).toBe(false);
  expect(button('Send').disabled).toBe(false);
  pins.add(['photo'], 'Crop tighter');
  expect(() => pins.read(epoch)).toThrow('Notes changed');
  expect(pins.settle(epoch, true)).toBe(false);
  expect(pins.read().notes).toHaveLength(2);
  expect(pins.settle(pins.read().epoch, true)).toBe(true);
  expect(pins.read().notes).toEqual([]);
});

it('clears every note from the tray × button', () => {
  pins.add(['title'], 'Warmer headline');
  pins.add(['photo'], 'Crop tighter');
  button('Clear all notes').click();
  expect(pins.read().notes).toEqual([]);
  expect(tray().hidden).toBe(true);
});

it('shows a failed send in the tray and keeps the notes', async () => {
  pins.dispose();
  pins = createNotePins({
    request: async () => ({ ok: false, error: 'Select the current elements again' }),
    selectedIds: () => selected,
    elements: () => present.map((id) => ({ id, kind: 'text' })),
    highlight: { show: (groups) => highlights.push([...groups]) },
  });
  pins.present({ dark: false, actionsEnabled: true, labels: {} });
  pins.setReadonly(false);
  pins.add(['title'], 'Warmer headline');
  button('Send').click();
  await vi.waitFor(() =>
    expect(tray().querySelector('[role=alert]')?.textContent).toBe(
      'Select the current elements again'
    )
  );
  expect(pins.read().notes).toHaveLength(1);
});

it('drops targets that left the artwork', () => {
  pins.add(['title', 'photo'], 'Align these');
  pins.add(['photo'], 'Crop tighter');
  const before = pins.read().epoch;
  present = ['title'];
  const after = pins.read();
  expect(after.notes).toEqual([{ elementIds: ['title'], prompt: 'Align these' }]);
  expect(after.epoch).not.toBe(before);
});

it('merges a note into an existing pin on the same targets and caps the count', () => {
  pins.add(['title'], 'Warmer');
  pins.add(['title'], 'Bigger');
  expect(pins.read().notes).toEqual([{ elementIds: ['title'], prompt: 'Warmer\nBigger' }]);
  present = Array.from({ length: DESIGN_NOTES_MAX + 1 }, (_, index) => `e${index}`);
  pins.settle(pins.read().epoch, true);
  for (const id of present) pins.add([id], id);
  expect(pins.read().notes).toHaveLength(DESIGN_NOTES_MAX);
  expect(tray().querySelector('[role=alert]')?.textContent).toContain(String(DESIGN_NOTES_MAX));
});

it('restores a snapshot into a fresh canvas and drops targets that are gone', () => {
  pins.add(['title'], 'Warmer');
  pins.add(['photo'], 'Crop tighter');
  const notes = pins.snapshot();
  expect(notes).toEqual([
    { elementIds: ['title'], prompt: 'Warmer' },
    { elementIds: ['photo'], prompt: 'Crop tighter' },
  ]);
  pins.dispose();
  present = ['title'];
  const fresh = createNotePins({
    request: async () => ({ ok: true }),
    selectedIds: () => [],
    elements: () => present.map((id) => ({ id, kind: 'text' })),
  });
  fresh.present({ dark: false, actionsEnabled: true, labels: {} });
  fresh.restore(notes);
  fresh.setReadonly(false);
  expect(fresh.read().notes).toEqual([{ elementIds: ['title'], prompt: 'Warmer' }]);
  fresh.dispose();
});

it('keeps notes in a snapshot while they are being sent, so a reload cannot drop them', () => {
  pins.add(['title'], 'Warmer');
  button('Send').click();
  expect(pins.snapshot()).toEqual([{ elementIds: ['title'], prompt: 'Warmer' }]);
});

function regionShading() {
  return document.querySelectorAll('.molly-note-regions polygon, .molly-note-regions polyline');
}

function drawRegionNote() {
  pins.setTool('comment');
  drag(element('photo'), [200, 250], [300, 350]);
  type('Brighter');
  button('Save note').click();
  expect(regionShading()).toHaveLength(1);
}

function drawStrokeNote() {
  pins.setTool('brush');
  stroke(element('photo'), [
    [200, 250],
    [300, 350],
  ]);
  type('Lighter');
  button('Save note').click();
  expect(regionShading()).toHaveLength(1);
}

it('clears region shading when Clear removes every note', () => {
  drawRegionNote();
  button('Clear all notes').click();
  expect(pins.read().notes).toEqual([]);
  expect(regionShading()).toHaveLength(0);
});

it('clears region shading once an accepted send settles', async () => {
  drawRegionNote();
  const { epoch } = pins.read();
  button('Send').click();
  await vi.waitFor(() => expect(requests).toEqual([{ type: 'notes', notesEpoch: epoch }]));
  expect(pins.settle(epoch, true)).toBe(true);
  expect(pins.read().notes).toEqual([]);
  expect(regionShading()).toHaveLength(0);
});

it('clears stroke overlays when Clear removes every note', () => {
  drawStrokeNote();
  button('Clear all notes').click();
  expect(pins.read().notes).toEqual([]);
  expect(regionShading()).toHaveLength(0);
});

it('clears stroke overlays once an accepted send settles', async () => {
  drawStrokeNote();
  const { epoch } = pins.read();
  button('Send').click();
  await vi.waitFor(() => expect(requests).toEqual([{ type: 'notes', notesEpoch: epoch }]));
  expect(pins.settle(epoch, true)).toBe(true);
  expect(pins.read().notes).toEqual([]);
  expect(regionShading()).toHaveLength(0);
});

it('restores a stroke note from its snapshot into a fresh canvas', () => {
  drawStrokeNote();
  const notes = pins.snapshot();
  expect(notes).toEqual([
    {
      elementIds: ['photo'],
      prompt: 'Lighter',
      region: {
        kind: 'stroke',
        points: [
          [0.25, 0.25],
          [0.5, 0.75],
        ],
      },
    },
  ]);
  pins.dispose();
  const fresh = createNotePins({
    request: async () => ({ ok: true }),
    selectedIds: () => [],
    elements: () => present.map((id) => ({ id, kind: id === 'title' ? 'text' : 'image' })),
  });
  fresh.present({ dark: false, actionsEnabled: true, labels: {} });
  fresh.restore(notes);
  fresh.setReadonly(false);
  expect(fresh.read().notes).toEqual(notes);
  expect(regionShading()).toHaveLength(1);
  fresh.dispose();
});
