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

  it('always shows full agent and image model labels without a collapse control', async () => {
    await act(async () =>
      root?.render(<LandingDesignConfigChips agentLabel="Molly" imageModelId="gpt-image-1" />)
    );
    expect(container.querySelectorAll('button').length).toBe(0);
    expect(container.textContent).toContain('Molly');
    expect(container.textContent).toContain('gpt-image-1');
  });
});
