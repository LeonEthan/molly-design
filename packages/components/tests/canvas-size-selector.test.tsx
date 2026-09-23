// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasSizeSelector } from '../src/components/chat/canvas-size-selector';
import { buildCanvasSubmission } from '../src/components/chat/canvas-submission';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
type Size = { mode: 'auto' | 'custom'; width: number; height: number };
let size: Size;
let root: Root;

async function flush(action: () => void) {
  await act(action);
  await act(() => {
    vi.runOnlyPendingTimers();
  });
}
function button(label: string) {
  const element = [...document.querySelectorAll('button')].find(
    (node) => node.getAttribute('aria-label') === label || node.textContent === label
  );
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}
const click = (label: string) => flush(() => button(label).click());
const triggerLabel = () =>
  `Canvas size: ${size.mode === 'auto' ? 'Auto size' : `${size.width} × ${size.height}`}`;
const openCustom = async () => {
  await click(triggerLabel());
  await click('Custom size');
};
async function fill(dimension: 'Width' | 'Height', value: string) {
  const input = [...document.querySelectorAll('input')].find((node) =>
    node.closest('label')?.textContent?.startsWith(dimension)
  );
  if (!input) throw new Error(`Missing ${dimension}`);
  await flush(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  size = { mode: 'auto', width: 800, height: 600 };
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.body.innerHTML = '';
});
async function render(disabled = false) {
  function Harness() {
    const [value, setValue] = useState(size);
    return (
      <>
        <textarea data-keyboard-nav="composer" />
        <CanvasSizeSelector
          {...value}
          disabled={disabled}
          onChange={(next) => {
            size = next;
            setValue(next);
          }}
        />
      </>
    );
  }
  await flush(() => root.render(<Harness />));
}

describe('canvas size selection', () => {
  it('uses a preset in the same creation / durable input snapshot and can return to Auto', async () => {
    await render();
    await click(triggerLabel());
    await click('Portrait1080 × 1350');
    expect(size).toEqual({ mode: 'custom', width: 1080, height: 1350 });
    const instruction = ({ width, height }: { width: number; height: number }) =>
      `${width} × ${height} px`;
    expect(buildCanvasSubmission([], size, instruction)).toEqual({
      dimensions: { width: 1080, height: 1350 },
      inputBlocks: [{ type: 'text', text: '1080 × 1350 px' }],
    });
    expect(document.activeElement?.matches('textarea')).toBe(true);
    await click(triggerLabel());
    expect(button('Portrait1080 × 1350').getAttribute('aria-pressed')).toBe('true');
    await click('Auto sizeNo fixed dimensions');
    expect(buildCanvasSubmission([], size, instruction)).toEqual({
      inputBlocks: [],
      dimensions: undefined,
    });
  });

  it('dismisses unapplied edits and applies a valid width / height together', async () => {
    await render();
    await openCustom();
    await fill('Width', '1200');
    await fill('Height', '628');
    expect(size).toEqual({ mode: 'auto', width: 800, height: 600 });
    await flush(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.matches('textarea')).toBe(true);
    await openCustom();
    expect([...document.querySelectorAll('input')].map((input) => input.value)).toEqual([
      '800',
      '600',
    ]);
    await fill('Width', '1200');
    await fill('Height', '628');
    await click('Apply size');
    expect(size).toEqual({ mode: 'custom', width: 1200, height: 628 });
  });

  it.each(['', '0', '4097', '1.5'])(
    'does not accept an invalid custom dimension: %s',
    async (value) => {
      await render();
      await openCustom();
      await fill('Width', value);
      expect(button('Apply size').disabled).toBe(true);
      await flush(() =>
        document
          .querySelector('form')
          ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      );
      expect(size).toEqual({ mode: 'auto', width: 800, height: 600 });
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    }
  );

  it('keeps the size locked after the draft can no longer change', async () => {
    await render(true);
    expect(button(triggerLabel()).disabled).toBe(true);
    await click(triggerLabel());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
