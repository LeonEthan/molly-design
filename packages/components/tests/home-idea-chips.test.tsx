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

  it('shows every suggestion at once and picks the prompt behind the clicked label', async () => {
    const picked: string[] = [];
    await act(async () =>
      root?.render(
        <HomeIdeaChips
          label="Try"
          ideas={ideas}
          disabled={false}
          onPick={(prompt) => picked.push(prompt)}
        />
      )
    );
    expect(container.querySelector('button[aria-expanded]')).toBeNull();
    expect(container.textContent).toContain('Try');
    expect(container.textContent).toContain('Poster');
    expect(container.textContent).toContain('Logo');
    const logo = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Logo'
    );
    await act(async () => logo?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(picked).toEqual(['Design a logo']);
  });
});
