// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DESIGN_NOTES_MAX,
  type DesignToolbarRequest,
} from '@molly/shared/design-selection-commands';
import { createNotePins } from '../../design-bento/src/note-pins';

let pins: ReturnType<typeof createNotePins>;
let requests: DesignToolbarRequest[];
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
  selected = [];
  present = ['title', 'photo'];
  pins = createNotePins({
    request: async (input) => {
      requests.push(input);
      return { ok: true };
    },
    selectedIds: () => selected,
    elementIds: () => present,
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
  button('Done').click();
  press(element('photo'), { ctrlKey: true });
  type('Crop tighter');
  button('Done').click();
  expect(tray().hidden).toBe(false);
  expect(tray().textContent).toContain('Notes · 2');
  expect(pins.read().notes).toEqual([
    { elementIds: ['title'], prompt: 'Warmer headline' },
    { elementIds: ['photo'], prompt: 'Crop tighter' },
  ]);
});

it('pins the whole selection when the click lands inside it', () => {
  selected = ['title', 'photo'];
  press(element('photo'), { metaKey: true });
  type('Align these');
  button('Done').click();
  expect(pins.read().notes).toEqual([{ elementIds: ['title', 'photo'], prompt: 'Align these' }]);
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

it('drops a pin whose note is left empty', () => {
  press(element('title'), { metaKey: true });
  type('   ');
  button('Done').click();
  expect(pins.read().notes).toEqual([]);
  expect(tray().hidden).toBe(true);
});

it('sends by epoch and rejects a read after the notes changed', async () => {
  pins.add(['title'], 'Warmer headline');
  const { epoch } = pins.read();
  button('Send to Molly').click();
  await vi.waitFor(() => expect(requests).toEqual([{ type: 'notes', notesEpoch: epoch }]));
  pins.add(['photo'], 'Crop tighter');
  expect(() => pins.read(epoch)).toThrow('Notes changed');
  expect(pins.clear(epoch)).toBe(false);
  expect(pins.read().notes).toHaveLength(2);
  expect(pins.clear(pins.read().epoch)).toBe(true);
  expect(pins.read().notes).toEqual([]);
});

it('shows a failed send in the tray and keeps the notes', async () => {
  pins.dispose();
  pins = createNotePins({
    request: async () => ({ ok: false, error: 'Select the current elements again' }),
    selectedIds: () => selected,
    elementIds: () => present,
  });
  pins.present({ dark: false, actionsEnabled: true, labels: {} });
  pins.setReadonly(false);
  pins.add(['title'], 'Warmer headline');
  button('Send to Molly').click();
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
  pins.clear(pins.read().epoch);
  for (const id of present) pins.add([id], id);
  expect(pins.read().notes).toHaveLength(DESIGN_NOTES_MAX);
  expect(tray().querySelector('[role=alert]')?.textContent).toContain(String(DESIGN_NOTES_MAX));
});
