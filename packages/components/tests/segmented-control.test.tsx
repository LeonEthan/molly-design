// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SegmentedControl } from '../src/components/shared/segmented-control';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Tab = 'models' | 'system' | 'tools';

function Harness() {
  const [value, setValue] = useState<Tab>('models');
  return (
    <SegmentedControl<Tab>
      value={value}
      onChange={setValue}
      ariaLabel="Section"
      options={[
        { value: 'models', label: 'Models' },
        { value: 'system', label: 'System', disabled: true },
        { value: 'tools', label: 'Tools' },
      ]}
    />
  );
}

describe('SegmentedControl keyboard', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const radio = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (button) => button.textContent === name
    )!;
  const press = (key: string) =>
    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });

  it('keeps only the selected segment in the tab order', () => {
    expect(radio('Models').tabIndex).toBe(0);
    expect(radio('Tools').tabIndex).toBe(-1);
  });

  it('moves focus and selection with arrow keys, skipping disabled segments', () => {
    act(() => radio('Models').focus());
    press('ArrowRight');
    expect(radio('Tools').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radio('Tools'));

    press('ArrowRight');
    expect(radio('Models').getAttribute('aria-checked')).toBe('true');

    press('End');
    expect(radio('Tools').getAttribute('aria-checked')).toBe('true');
    press('Home');
    expect(document.activeElement).toBe(radio('Models'));
  });
});
