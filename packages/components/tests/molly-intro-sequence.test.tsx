// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { initI18n } from '../src/i18n';
import { IntroSequence } from '../src/components/onboarding/ceremony/intro-sequence';

it('keeps each graphic-design scene paired with its copy and holds the final invitation', async () => {
  await initI18n('en');
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<IntroSequence onStart={() => {}} />);
    });
    const scenes = [
      ['Make an impression.', 'molly-poster-v3.png'],
      ['Give every page a rhythm.', 'molly-editorial-v3.png'],
      ['Create a visual language.', 'molly-brand-v3.png'],
      ['Show what makes it special.', 'molly-commerce-v3.png'],
    ];
    for (const [index, [title, image]] of scenes.entries()) {
      if (index > 0)
        await act(async () => {
          vi.advanceTimersByTime(5000);
        });
      expect(container.querySelector('h1')?.textContent).toBe(title);
      expect(container.querySelector('main img')?.getAttribute('src')).toContain(image);
    }
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    expect(container.querySelector('h1')?.textContent).toBe(scenes[3][0]);
    expect(container.textContent).toContain('Configure Molly');
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
});
