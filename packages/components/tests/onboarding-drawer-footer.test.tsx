// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformContext } from '@molly/platform/react';
import type { PlatformProvider } from '@molly/platform';

import { OnboardingShell } from '../src/components/onboarding/onboarding-shell';
import { initI18n } from '../src/i18n';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const localPlatform = { kind: 'local' } as PlatformProvider;

describe('setup drawer footer', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(async () => {
    await initI18n('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = undefined;
    }
    container?.remove();
    container = undefined;
  });

  it('fills the aside instead of centering a drawer that can scroll its footer away', async () => {
    await act(async () => {
      root?.render(
        createElement(
          PlatformContext.Provider,
          { value: localPlatform },
          createElement(
            OnboardingShell,
            {
              stepKey: 'providers',
              title: 'Connect your models',
              asideOpen: true,
              aside: createElement('p', null, 'Drawer body'),
            },
            createElement('p', null, 'Rows') as ReactNode
          )
        )
      );
    });
    const aside = container?.querySelector('[data-onboarding-aside]');
    expect(aside).not.toBeNull();
    expect(aside?.className).toContain('overflow-hidden');
    expect(aside?.className).not.toContain('my-auto');
    expect(aside?.querySelector('.my-auto')).toBeNull();
    expect(aside?.textContent).toContain('Drawer body');
  });
});
