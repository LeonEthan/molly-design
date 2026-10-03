// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PersonalMemorySnapshot } from '@molly/shared/personal-memory';
import { PersonalMemoryPanel } from '../src/components/settings/personal-memory-setting';
import { initI18n } from '../src/i18n';

const snapshot: PersonalMemorySnapshot = {
  enabled: true,
  revision: 'revision-1',
  entries: [
    { id: 'serif', text: 'Prefers serif headlines.' },
    { id: 'muted', text: 'Likes muted palettes.' },
  ],
};
let root: Root;
let host: HTMLDivElement;
let operations: unknown[];
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  await initI18n('en');
  operations = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(PersonalMemoryPanel, {
        request: async (operation) => {
          operations.push(operation);
          return snapshot;
        },
      })
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const inputs = () => [...host.querySelectorAll<HTMLInputElement>('input')];
const buttonLabels = () => [...host.querySelectorAll('button')].map((node) => node.textContent);
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((node) => node.textContent === label)!;

it('offers Save and Cancel only on the preference being edited', async () => {
  expect(buttonLabels()).not.toContain('Save');
  expect(buttonLabels().filter((label) => label === 'Delete')).toHaveLength(2);
  await type(inputs()[0]!, 'Prefers serif headlines and wide margins.');
  expect(buttonLabels().filter((label) => label === 'Save')).toHaveLength(1);
  expect(buttonLabels().filter((label) => label === 'Delete')).toHaveLength(1);
  await act(async () => button('Cancel').click());
  expect(inputs()[0]!.value).toBe('Prefers serif headlines.');
  expect(buttonLabels()).not.toContain('Save');
});

it('saves an edited preference with Enter against the viewed revision', async () => {
  await type(inputs()[1]!, 'Likes warm, muted palettes.');
  await act(async () =>
    inputs()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  );
  expect(operations).toEqual([
    { action: 'read' },
    { action: 'edit', id: 'muted', text: 'Likes warm, muted palettes.', revision: 'revision-1' },
  ]);
});
