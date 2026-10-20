// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DESIGN_NOTES_MAX,
  type DesignToolbarRequest,
} from '@molly/shared/design-selection-commands';
import type { HighlightGroup } from '../../design-bento/src/element-highlight';
import { createNotePins } from '../../design-bento/src/note-pins';

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
    '<div class="ed-stage-scale"><div data-el-id="title"><span>Hi</span></div><div data-el-id="photo"></div></div>';
  for (const node of document.querySelectorAll('[data-el-id]'))
    Object.defineProperty(node, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 200, right: 500, bottom: 400, width: 400, height: 200 }),
    });
  requests = [];
  highlights = [];
  selected = [];
  present = ['title', 'photo'];
  pins = createNotePins({
    request: async (input) => {
      requests.push(input);
      return { ok: true };
    },
    selectedIds: () => selected,
    elementIds: () => present,
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

it('drops a numbered pin on Cmd/Ctrl-click and reads its note', () => {
  press(element('title').querySelector('span')!, { metaKey: true });
  expect(button('Note 1: ').textContent).toBe('1');
  type('Warmer headline');
  button('Save note').click();
  press(element('photo'), { ctrlKey: true });
  type('Crop tighter');
  button('Save note').click();
  expect(tray().hidden).toBe(false);
  expect(tray().textContent).toContain('2 comments');
  expect(pins.read().notes).toEqual([
    { elementIds: ['title'], prompt: 'Warmer headline' },
    { elementIds: ['photo'], prompt: 'Crop tighter' },
  ]);
});

it('pins the whole selection when the click lands inside it', () => {
  selected = ['title', 'photo'];
  press(element('photo'), { metaKey: true });
  type('Align these');
  button('Save note').click();
  expect(pins.read().notes).toEqual([{ elementIds: ['title', 'photo'], prompt: 'Align these' }]);
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
  pins.setCommenting(true);
  expect(document.body.dataset.commenting).toBe('true');
  press(element('photo'));
  type('Crop tighter');
  button('Save note').click();
  expect(pins.read().notes).toEqual([{ elementIds: ['photo'], prompt: 'Crop tighter' }]);
  pins.setCommenting(false);
  expect(document.body.dataset.commenting).toBe('false');
  press(element('title'));
  expect(document.querySelector('.molly-note-editor')).toBeNull();
});

it('never enters the comment tool while read-only and drops it when the canvas locks', () => {
  pins.setCommenting(true);
  pins.setReadonly(true);
  expect(pins.commenting()).toBe(false);
  pins.setCommenting(true);
  expect(pins.commenting()).toBe(false);
  press(element('title'));
  expect(document.querySelector('.molly-note-editor')).toBeNull();
  expect(pins.read().notes).toEqual([]);
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
    elementIds: () => present,
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
