// @vitest-environment jsdom

import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

import { getDefaultStore } from 'jotai';

import { designElementFocusAtom } from '../src/atoms/design-element-focus';
import { MessageTextWithChips } from '../src/components/mentions/message-text-chips';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('MessageTextWithChips', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it('keeps a ZWJ emoji together with the mention prefix', () => {
    const label = '@👨‍👩‍👧‍👦-reviewer';
    const text = `See ${label}`;

    flushSync(() => {
      root.render(
        <MessageTextWithChips
          text={text}
          spans={[
            {
              start: 4,
              end: 4 + label.length,
              kind: 'file',
              label,
              target: '👨‍👩‍👧‍👦-reviewer',
            },
          ]}
        />
      );
    });

    expect(container.textContent).toBe(text);
    expect(container.querySelector('.whitespace-nowrap')?.textContent).toBe(
      '@👨‍👩‍👧‍👦-r'
    );
  });

  it('focuses the elements a design element chip cites on click or Enter, and ignores a stale one', () => {
    const reference = {
      artworkId: 'art-1',
      baselineRevisionId: 'a'.repeat(64),
      elementIds: ['title'],
    };
    const label = '@Selected elements (1)';
    const text = `Fix ${label}`;
    const span = (target: string) => ({
      start: 4,
      end: 4 + label.length,
      kind: 'design_element' as const,
      label,
      target,
    });
    const store = getDefaultStore();

    flushSync(() => root.render(<MessageTextWithChips text={text} spans={[span(JSON.stringify(reference))]} />));
    container.querySelector<HTMLElement>('[role="button"]')!.click();
    expect(store.get(designElementFocusAtom)).toEqual(reference);

    store.set(designElementFocusAtom, null);
    container
      .querySelector<HTMLElement>('[role="button"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(store.get(designElementFocusAtom)).toEqual(reference);

    flushSync(() => root.render(<MessageTextWithChips text={text} spans={[span('not json')]} />));
    store.set(designElementFocusAtom, null);
    container.querySelector<HTMLElement>('[role="button"]')!.click();
    expect(store.get(designElementFocusAtom)).toBeNull();
  });
});
