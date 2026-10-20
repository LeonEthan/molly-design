// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronUpdaterState } from '@molly/shared';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { updaterState } = vi.hoisted(() => ({
  updaterState: { current: null as ElectronUpdaterState | null },
}));

vi.mock('@/hooks/use-electron-updater-state', () => ({
  useElectronUpdaterState: () => updaterState.current,
}));
vi.mock('../src/hooks/use-electron-updater-state', () => ({
  useElectronUpdaterState: () => updaterState.current,
}));

import { AboutSettingsComponent } from '../src/components/settings/about-setting';
import { SidebarUpdateBanner } from '../src/components/sidebar-update-banner';
import { initI18n } from '../src/i18n';

function state(overrides: Partial<ElectronUpdaterState>): ElectronUpdaterState {
  return { phase: 'idle', currentVersion: '0.1.1', ...overrides };
}

describe('About update action', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(async () => {
    updaterState.current = null;
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

  async function render(): Promise<void> {
    await act(async () => {
      root?.render(createElement(AboutSettingsComponent));
    });
  }

  function buttonWith(text: string): HTMLButtonElement | undefined {
    return [...(container?.querySelectorAll('button') ?? [])].find((node) =>
      node.textContent?.includes(text)
    );
  }

  it('shows each update state on the button', async () => {
    updaterState.current = state({ phase: 'checking' });
    await render();
    expect(buttonWith('Checking…')?.hasAttribute('disabled')).toBe(true);

    updaterState.current = state({ phase: 'up_to_date' });
    await render();
    expect(container?.textContent).toContain("You're up to date");

    updaterState.current = state({
      phase: 'downloading',
      percent: 42.2,
      availableVersion: '0.1.2',
    });
    await render();
    expect(container?.textContent).toContain('Downloading 42%');

    updaterState.current = state({ phase: 'downloaded', downloadedVersion: '0.1.2' });
    await render();
    expect(buttonWith('Ready — Install and Relaunch')?.hasAttribute('disabled')).toBe(false);
  });

  it('shows a readable failure and leaves the check button usable', async () => {
    updaterState.current = state({ phase: 'error', error: 'update_check_unanswered' });
    await render();
    expect(container?.textContent).toContain(
      'The update check did not respond. Check your connection and try again.'
    );
    expect(buttonWith('Check for Updates')?.hasAttribute('disabled')).toBe(false);
  });

  it('prompts to install and relaunch when a download is ready', async () => {
    await act(async () => {
      root?.render(
        createElement(SidebarUpdateBanner, {
          stage: 'downloaded',
          version: '0.1.2',
          percent: null,
          isRestarting: false,
          onViewChangelog: () => undefined,
          onRestart: () => undefined,
          onLater: () => undefined,
        })
      );
    });
    expect(buttonWith('Ready — Install and Relaunch')).toBeTruthy();
    expect(buttonWith('Later')).toBeTruthy();
  });
});
