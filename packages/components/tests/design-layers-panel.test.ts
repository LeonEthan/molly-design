// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import type { DesignToolbarRequest } from '@molly/shared/design-selection-commands';
import { createLayersPanel, type LayerElement } from '../../design-bento/src/layers-panel';

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

const elements: LayerElement[] = [
  { id: 'bg', kind: 'shape', bounds: [0, 0, 1080, 1350] },
  {
    id: 'title',
    kind: 'text',
    bounds: [80, 120, 920, 150],
    opacity: 0.5,
    text: { paragraphs: [{ runs: [{ text: 'URBAN ' }, { text: 'BLOOM' }] }], lineHeight: 1.2 },
  },
];

function setup() {
  const requests: DesignToolbarRequest[] = [];
  const selections: string[][] = [];
  const panel = createLayersPanel({
    request: async (input) => {
      requests.push(input);
      return { ok: true };
    },
    elements: () => elements,
    select: (ids) => selections.push(ids),
    onToggle: () => {},
  });
  panel.toggle();
  return { panel, requests, selections };
}

it('lists layers top-most first and selects by id, adding with shift', () => {
  const { panel, selections } = setup();
  const rows = [...document.querySelectorAll<HTMLButtonElement>('.molly-layers li button')];
  expect(rows.map((row) => row.textContent)).toEqual(['URBAN BLOOM', 'Shape']);
  rows[1]!.click();
  panel.update(['bg'], 1);
  const updated = [...document.querySelectorAll<HTMLButtonElement>('.molly-layers li button')];
  expect(updated.map((row) => row.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
  updated[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  expect(selections).toEqual([['bg'], ['bg', 'title']]);
});

it('sends property and arrange commands bound to the selection epoch', async () => {
  const { panel, requests } = setup();
  panel.setReadonly(false);
  panel.update(['title'], 7);
  const field = (name: string) =>
    [...document.querySelectorAll('.molly-layers label')]
      .find((label) => label.textContent === name)!
      .querySelector('input')!;
  expect(field('Opacity %').value).toBe('50');
  expect(field('Line height').value).toBe('1.2');
  field('Rotation °').value = '15';
  field('Rotation °').dispatchEvent(new Event('change'));
  field('Letter spacing').value = '2';
  field('Letter spacing').dispatchEvent(new Event('change'));
  field('Opacity %').value = '150';
  field('Opacity %').dispatchEvent(new Event('change'));
  [...document.querySelectorAll<HTMLButtonElement>('.molly-layers .arrange button')]
    .find((button) => button.textContent === 'Bring to front')!
    .click();
  await panel.idle();
  expect(requests).toEqual([
    { type: 'command', selectionEpoch: 7, command: { verb: 'transform', rotation: 15 } },
    { type: 'command', selectionEpoch: 7, command: { verb: 'text-style', letterSpacing: 2 } },
    { type: 'command', selectionEpoch: 7, command: { verb: 'arrange', to: 'front' } },
  ]);
});

it('keeps the list browsable but disables edits while read-only', () => {
  const { panel } = setup();
  panel.update(['title'], 1);
  const controls = [
    ...document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      '.molly-layers .props input, .molly-layers .arrange button'
    ),
  ];
  expect(controls.length).toBeGreaterThan(0);
  expect(controls.every((control) => control.disabled)).toBe(true);
  expect(
    [...document.querySelectorAll<HTMLButtonElement>('.molly-layers li button')].every(
      (row) => !row.disabled
    )
  ).toBe(true);
});

it('builds each queued bounds edit from the result of the one before', async () => {
  const live: LayerElement[] = [{ id: 'box', kind: 'shape', bounds: [80, 120, 200, 100] }];
  const panel = createLayersPanel({
    request: async ({ command }) => {
      await Promise.resolve();
      const [x, y, width, height] = live[0]!.bounds;
      if (command.verb === 'position')
        live[0] = { ...live[0]!, bounds: [command.x, command.y, width!, height!] };
      if (command.verb === 'size')
        live[0] = { ...live[0]!, bounds: [x!, y!, command.width, command.height] };
      return { ok: true };
    },
    elements: () => live,
    select: () => {},
    onToggle: () => {},
  });
  panel.toggle();
  panel.setReadonly(false);
  panel.update(['box'], 1);
  const edit = (name: string, value: number) => {
    const input = [...document.querySelectorAll('.molly-layers label')]
      .find((label) => label.textContent === name)!
      .querySelector('input')!;
    input.value = String(value);
    input.dispatchEvent(new Event('change'));
  };
  edit('X', 100);
  edit('Y', 140);
  edit('Width', 300);
  edit('Height', 50);
  await panel.idle();
  expect(live[0]!.bounds).toEqual([100, 140, 300, 50]);
});

it('keeps the selection epoch of each queued edit when the selection changes', async () => {
  const epochs: number[] = [];
  let release: () => void = () => {};
  let started: () => void = () => {};
  const firstStarted = new Promise<void>((resolve) => (started = resolve));
  const panel = createLayersPanel({
    request: async (input) => {
      epochs.push(input.selectionEpoch);
      if (epochs.length === 1) {
        const held = new Promise<void>((resolve) => (release = resolve));
        started();
        await held;
      }
      return { ok: true };
    },
    elements: () => elements,
    select: () => {},
    onToggle: () => {},
  });
  panel.toggle();
  panel.setReadonly(false);
  panel.update(['title'], 1);
  const input = (name: string) =>
    [...document.querySelectorAll('.molly-layers label')]
      .find((label) => label.textContent === name)!
      .querySelector('input')!;
  input('X').value = '100';
  input('X').dispatchEvent(new Event('change'));
  input('Y').value = '140';
  input('Y').dispatchEvent(new Event('change'));
  await firstStarted;
  panel.update(['bg'], 2);
  release();
  await panel.idle();
  expect(epochs).toEqual([1, 1]);
});
