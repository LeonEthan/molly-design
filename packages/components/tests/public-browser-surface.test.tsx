// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ElectronPublicBrowserState } from '@molly/shared';
import { PublicBrowserSurface } from '../src/components/sessions/public-browser-surface';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

let root: Root;
let container: HTMLDivElement;
let resolveBounds: ((value: unknown) => void) | undefined;
const visibility: boolean[] = [];
const state: ElectronPublicBrowserState = {
  browserId: 'surface-test',
  phase: 'ready',
  url: 'https://example.com/',
  canGoBack: false,
  canGoForward: false,
};

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.__MOLLY_ELECTRON__ = true;
  visibility.length = 0;
  resolveBounds = undefined;
  window.ipc = {
    invoke: async (channel, ...args) => {
      if (channel === 'publicBrowser.setBounds') {
        return new Promise((resolve) => {
          resolveBounds = resolve;
        });
      }
      if (channel === 'publicBrowser.setVisible') {
        visibility.push((args[0] as { visible: boolean }).visible);
      }
      return { ok: true, state: { ...state } };
    },
    on: () => () => {},
    send: () => {},
  };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 800, 600)
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.ipc;
  delete window.__MOLLY_ELECTRON__;
  vi.restoreAllMocks();
});

it('keeps the native page visible across state-driven renders and hides it on detach', async () => {
  const onStateChange = () => {};
  const render = (active: boolean) =>
    root.render(
      createElement(PublicBrowserSurface, {
        browserId: state.browserId,
        url: state.url!,
        navigationRequestId: null,
        active,
        onStateChange,
      })
    );
  await act(async () => render(true));
  expect(visibility).toContain(true);
  expect(visibility).not.toContain(false);
  await act(async () => render(true));
  expect(visibility).not.toContain(false);
  await act(async () => render(false));
  await act(async () => resolveBounds?.({ ok: true, state: { ...state } }));
  expect(visibility.at(-1)).toBe(false);
});
