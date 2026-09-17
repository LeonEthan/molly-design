// @vitest-environment jsdom

import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore, type Store } from 'jotai';

import { SettingsCategoryList } from '../src/components/settings/settings-category-list';
import { initI18n } from '../src/i18n';
import { TestCloudPlatformProvider } from './test-platform';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('SettingsCategoryList', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let store: Store | undefined;

  beforeEach(async () => {
    await initI18n('en');
    navigateMock.mockClear();
    Object.defineProperty(HTMLElement.prototype, 'checkVisibility', {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    Reflect.deleteProperty(window, '__MOLLY_NATIVE__');
    Reflect.deleteProperty(window, 'Capacitor');
    store = createStore();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    root = undefined;
    container?.remove();
    container = undefined;
    store = undefined;
    vi.restoreAllMocks();
  });

  async function renderList() {
    if (!store) throw new Error('Missing test store');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          TestCloudPlatformProvider,
          null,
          createElement(
            Provider,
            { store },
            createElement(SettingsCategoryList, { workspaceName: 'acme' })
          )
        )
      );
    });
  }

  it('omits hosted bug-report submission', async () => {
    await renderList();
    expect(container?.textContent).not.toContain('Send a report with optional machine logs');
  });

  it('keeps settings category rows navigating normally', async () => {
    await renderList();

    expect(container?.textContent).not.toContain('My Machines');
    expect(container?.textContent).not.toContain('People');

    await act(async () => {
      getButton('Preferences').click();
    });

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/$workspaceName/settings/preferences',
      params: { workspaceName: 'acme' },
      search: expect.any(Function),
    });
  });

  it('omits hosted account, people, and billing entries even with a cloud-shaped test port', async () => {
    await renderList();
    expect(container?.textContent).not.toContain('General');
    expect(container?.textContent).not.toContain('People');
    expect(container?.textContent).not.toContain('Billing');
  });

  it('navigates to the appearance category', async () => {
    await renderList();

    await act(async () => {
      getButton('Appearance').click();
    });

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/$workspaceName/settings/appearance',
      params: { workspaceName: 'acme' },
      search: expect.any(Function),
    });
  });

  it('opens the category reached by keyboard navigation', async () => {
    await renderList();
    const preferences = getButton('Preferences');

    await act(async () => preferences.focus());
    await act(async () => {
      preferences.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' })
      );
    });

    expect(document.activeElement).toBe(getButton('Appearance'));
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/$workspaceName/settings/appearance',
      params: { workspaceName: 'acme' },
      search: expect.any(Function),
    });
  });

  function getButton(name: string): HTMLButtonElement {
    const button = Array.from(container?.querySelectorAll('button') ?? []).find((node) =>
      node.textContent?.includes(name)
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Could not find button: ${name}`);
    }
    return button;
  }
});
