// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingDesignConfigChips } from '../src/components/chat/landing-design-config-chips';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe('LandingDesignConfigChips', () => {
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

  it('renders collapsed chips and expands on click', async () => {
    await act(async () =>
      root?.render(<LandingDesignConfigChips agentLabel="Molly" imageModelId="gpt-image-1" />)
    );
    const buttons = container.querySelectorAll('button[aria-expanded]');
    expect(buttons.length).toBe(2);
    expect(buttons[0]?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(buttons[1]?.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('gpt-image-1');
  });
});
