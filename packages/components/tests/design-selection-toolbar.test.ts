// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
function queryByRole(
  root: HTMLElement,
  role: string,
  options?: { name?: string; exact?: boolean }
): HTMLElement | null {
  const selector =
    role === 'button' ? 'button' : role === 'spinbutton' ? 'input[type=number]' : `[role=${role}]`;
  return (
    [...root.querySelectorAll<HTMLElement>(selector)].find(
      (node) =>
        !node.closest('[hidden]') &&
        (!options?.name ||
          node.getAttribute('aria-label') === options.name ||
          node.textContent === options.name)
    ) ?? null
  );
}
function getByRole(
  root: HTMLElement,
  role: string,
  options?: { name?: string; exact?: boolean }
): HTMLElement {
  const node = queryByRole(root, role, options);
  if (!node) throw Error(`Missing ${role}: ${options?.name ?? ''}`);
  return node;
}
const fireEvent = {
  click: (node: HTMLElement) => node.click(),
  blur: (node: HTMLElement) => node.dispatchEvent(new FocusEvent('blur')),
  input(node: HTMLElement, init: { target: { value: string } }) {
    (node as HTMLInputElement).value = init.target.value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
  },
};
import type {
  DesignSelectedElement,
  DesignToolbarRequest,
} from '@molly/shared/design-selection-commands';
import { createSelectionToolbar, placeToolbar } from '../../design-bento/src/selection-toolbar';

let toolbar: ReturnType<typeof createSelectionToolbar>;
let requests: DesignToolbarRequest[];
let finish: ((value: { ok: boolean; error?: string }) => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  document.body.innerHTML =
    '<div class="ed-stage-scale"><div data-el-id="one"></div><div data-el-id="two"></div></div>';
  for (const node of document.querySelectorAll('[data-el-id]'))
    Object.defineProperty(node, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 200, right: 500, bottom: 400 }),
    });
  requests = [];
  toolbar = createSelectionToolbar({
    request: async (input) => {
      requests.push(input);
      return finish ? await new Promise((resolve) => (finish = resolve)) : { ok: true };
    },
  });
  toolbar.present({ dark: false, actionsEnabled: true, labels: {} });
  toolbar.setReadonly(false);
});
afterEach(() => {
  toolbar.dispose();
  finish = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const select = (
  kind: DesignSelectedElement['kind'],
  fields: Partial<DesignSelectedElement> = {},
  epoch = 1,
  id = 'one'
) => {
  toolbar.update(
    {
      count: 1,
      kinds: [kind],
      fonts: ['Inter'],
      elements: [{ id, kind, x: 10, y: 20, width: 100, height: 80, ...fields }],
    },
    [id],
    epoch
  );
  vi.advanceTimersByTime(20);
};
const click = (name: string) =>
  fireEvent.click(getByRole(document.body, 'button', { name, exact: true }));
const input = (name: string, value: string) => {
  const el = getByRole(document.body, 'spinbutton', { name });
  fireEvent.input(el, { target: { value } });
  fireEvent.blur(el);
};

it('anchors above, flips below, clamps edges, and hides wholly offscreen selections', () => {
  expect(
    placeToolbar({ left: 100, right: 300, top: 200, bottom: 300 }, 200, 40, {
      width: 800,
      height: 600,
    })
  ).toEqual({ left: 100, top: 148 });
  expect(
    placeToolbar({ left: -50, right: 30, top: 0, bottom: 60 }, 200, 40, { width: 800, height: 600 })
  ).toEqual({ left: 8, top: 72 });
  expect(
    placeToolbar({ left: 790, right: 850, top: 560, bottom: 630 }, 200, 40, {
      width: 800,
      height: 600,
    })
  ).toEqual({ left: 592, top: 508 });
  expect(
    placeToolbar({ left: 900, right: 950, top: 40, bottom: 60 }, 200, 40, {
      width: 800,
      height: 600,
    })
  ).toBeNull();
});
it.each(['text', 'image', 'shape', 'line', 'icon', 'table', 'chart'] as const)(
  'exposes the existing controls for %s',
  (kind) => {
    select(kind, { fontFamily: 'Inter', fontSize: 24, fit: 'cover' });
    expect(getByRole(document.body, 'toolbar')).toBeTruthy();
    expect(
      getByRole(document.body, 'button', { name: 'Reference selected elements' })
    ).toBeTruthy();
    const expected = {
      text: 'Bold',
      image: 'Crop',
      shape: 'Fill',
      line: 'Arrowheads',
      icon: 'Fill',
      table: 'Regenerate selection',
      chart: 'Regenerate selection',
    }[kind];
    expect(getByRole(document.body, 'button', { name: expected, exact: true })).toBeTruthy();
  }
);
it('sends a text edit with its selection epoch and disables pending controls', async () => {
  select('text', { bold: false });
  finish = () => {};
  click('Bold');
  expect(requests).toEqual([
    { type: 'command', selectionEpoch: 1, command: { verb: 'text-style', bold: true } },
  ]);
  expect(getByRole(document.body, 'button', { name: 'Bold' }).hasAttribute('disabled')).toBe(true);
  finish({ ok: true });
  await Promise.resolve();
  await Promise.resolve();
});
it('keeps property input focus and draft during same-selection updates', () => {
  select('text', { fontSize: 24 });
  const field = getByRole(document.body, 'spinbutton', { name: 'Font size' }) as HTMLInputElement;
  field.focus();
  field.value = '32';
  select('text', { fontSize: 24, color: '#ffffff' });
  expect(document.activeElement).toBe(field);
  expect(field.value).toBe('32');
  field.blur();
  expect(requests[0]).toMatchObject({ command: { verb: 'text-style', fontSize: 32 } });
});
it('retires a pending request and popup when the selected identity changes', async () => {
  select('shape');
  finish = () => {};
  click('Fill');
  click('#ef4444');
  select('text', { bold: false }, 2, 'two');
  finish({ ok: false, error: 'Old error' });
  await Promise.resolve();
  await Promise.resolve();
  expect(queryByRole(document.body, 'dialog')).toBeNull();
  expect(queryByRole(document.body, 'alert')).toBeNull();
  expect(getByRole(document.body, 'toolbar').getAttribute('aria-busy')).toBe('false');
  expect(getByRole(document.body, 'button', { name: 'Bold' }).hasAttribute('disabled')).toBe(false);
});
it('sends position, size, color, fit and arrow changes through the command port', async () => {
  select('shape');
  input('Position X', '44');
  await Promise.resolve();
  await Promise.resolve();
  select('shape', {}, 2);
  input('Width', '144');
  await Promise.resolve();
  await Promise.resolve();
  select('icon', {}, 3);
  click('Fill');
  click('#ef4444');
  await Promise.resolve();
  await Promise.resolve();
  select('image', { fit: 'cover' }, 4);
  click('Image fit');
  click('contain');
  await Promise.resolve();
  await Promise.resolve();
  select('line', {}, 5);
  click('Arrowheads');
  click('Both ends');
  expect(requests.map((r) => r.type === 'command' && r.command)).toEqual([
    { verb: 'position', x: 44, y: 20 },
    { verb: 'size', width: 144, height: 80 },
    { verb: 'fill', fill: '#ef4444' },
    { verb: 'image-fit', fit: 'contain' },
    { verb: 'line-arrow', preset: 'both' },
  ]);
});
it('validates the crop draft before submitting a single edit', () => {
  select('image');
  click('Crop');
  fireEvent.input(getByRole(document.body, 'spinbutton', { name: 'Left' }), {
    target: { value: '0.7' },
  });
  fireEvent.input(getByRole(document.body, 'spinbutton', { name: 'Right' }), {
    target: { value: '0.7' },
  });
  expect(getByRole(document.body, 'button', { name: 'Apply' }).hasAttribute('disabled')).toBe(true);
  fireEvent.input(getByRole(document.body, 'spinbutton', { name: 'Right' }), {
    target: { value: '0.1' },
  });
  click('Apply');
  expect(requests[0]).toMatchObject({ command: { verb: 'image-crop', crop: [0.7, 0, 0.1, 0] } });
});
it('opens the font popup with its effective family and sends the text-style command', () => {
  select('text', { fontFamily: 'Inter', fontSize: 20 });
  const trigger = getByRole(document.body, 'button', { name: 'Font', exact: true });
  expect(trigger.textContent).toContain('Inter');
  click('Font');
  expect(getByRole(document.body, 'dialog')).toBeTruthy();
  click('Inter');
  expect(requests).toEqual([
    { type: 'command', selectionEpoch: 1, command: { verb: 'text-style', fontFamily: 'Inter' } },
  ]);
});
it('disables the font trigger without font choices and opens no popup', () => {
  // Zero choices is a producer-side error state (the summary normally injects
  // the pinned default family): the trigger must be disabled rather than open
  // an empty popup — the original user-reported bug.
  toolbar.update(
    {
      count: 1,
      kinds: ['text'],
      fonts: [],
      elements: [{ id: 'one', kind: 'text', fontSize: 20 }],
    },
    ['one'],
    1
  );
  vi.advanceTimersByTime(20);
  const trigger = getByRole(document.body, 'button', { name: 'Font', exact: true });
  expect(trigger.hasAttribute('disabled')).toBe(true);
  fireEvent.click(trigger);
  expect(queryByRole(document.body, 'dialog')).toBeNull();
});

it('uses generic actions for mixed and oversized selections and hides on readonly/empty', () => {  toolbar.update({ count: 9, kinds: ['text'] }, ['one'], 1);
  vi.advanceTimersByTime(20);
  expect(queryByRole(document.body, 'button', { name: 'Bold' })).toBeNull();
  click('Regenerate selection');
  expect(requests[0]).toEqual({ type: 'action', action: 'regenerate', selectionEpoch: 1 });
  toolbar.setReadonly(true);
  vi.advanceTimersByTime(20);
  expect(queryByRole(document.body, 'toolbar')).toBeNull();
  toolbar.setReadonly(false);
  toolbar.update({ count: 0, kinds: [] }, [], 2);
  vi.advanceTimersByTime(20);
  expect(queryByRole(document.body, 'toolbar')).toBeNull();
});

it('updates the theme without losing a focused draft or closing its popup', () => {
  select('text', { fontSize: 24 });
  const field = getByRole(document.body, 'spinbutton', { name: 'Font size' }) as HTMLInputElement;
  field.focus();
  field.value = '32';
  toolbar.present({ dark: true, actionsEnabled: true, labels: {} });
  expect(getByRole(document.body, 'toolbar').dataset.dark).toBe('true');
  expect(document.activeElement).toBe(field);
  expect(field.value).toBe('32');
  field.value = '24';
  field.blur();
  click('Text color');
  toolbar.present({ dark: false, actionsEnabled: true, labels: {} });
  expect(getByRole(document.body, 'dialog').dataset.dark).toBe('false');
});
