// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HomeIdeaChips } from '../src/components/chat/home-idea-chips';

const ideas = [
  { label: 'Poster', prompt: 'Design a poster' },
  { label: 'Logo', prompt: 'Design a logo' },
];

describe('HomeIdeaChips', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    root = null;
  });

  it('hides suggestion chips until the expand control is clicked', async () => {
    await act(async () =>
      root?.render(
        <HomeIdeaChips
          label="Try"
          expandLabel="Suggestions"
          ideas={ideas}
          disabled={false}
          onPick={() => undefined}
        />
      )
    );
    const toggle = container.querySelector('button[aria-expanded]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('Poster');
    await act(async () => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Poster');
    expect(container.textContent).toContain('Logo');
  });
});
