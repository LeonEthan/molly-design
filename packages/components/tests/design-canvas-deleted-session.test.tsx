// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const main = vi.hoisted(() => ({
  records: new Set<string>(),
}));

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { location: { href: '/', state: {} }, replace() {} } }),
  useRouterState: ({ select }: { select: (state: { location: { state: object } }) => unknown }) =>
    select({ location: { state: {} } }),
  useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
    select({ pathname: '/local/sessions/design-session' }),
  useNavigate: () => async () => {},
  useBlocker: () => {},
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

vi.mock('../src/atoms', async () => {
  const { atom } = await import('jotai');
  return {
    ...(await import('../src/atoms/layout-state')),
    ...(await import('../src/atoms/sidebar-state')),
    userAtom: atom(null),
    getAllAgentConfigAtom: atom([]),
    currentWorkspaceIdAtom: atom('workspace'),
    WORKSPACE_FOCUS_SCOPES: { content: 'content' },
  };
});

vi.mock('../src/atoms/runtime', async () => ({
  activeWorkspaceRuntimeAtom: (await import('jotai')).atom(null),
}));

vi.mock('../src/atoms/local-probe', async () => ({
  localProbeResultAtom: (await import('jotai')).atom({ machineId: 'machine' }),
}));

vi.mock('../src/hooks/use-session-doc', () => ({
  useSessionDoc: () => ({ history: null, synced: false }),
}));

vi.mock('../src/lib/electron-ipc-client', () => ({
  onIpcEvent: () => () => {},
  getIpcServices: () => ({
    design: {
      attach: async (artworkId: string) => {
        main.records.add(artworkId);
      },
      leave: async () => true,
      close: async (artworkId: string) => {
        main.records.delete(artworkId);
        return true;
      },
      hide: async () => {},
      cover: async () => null,
      presentToolbar: async () => {},
      highlight: async () => {},
      compareAvailable: async () => false,
      compareHold: async () => false,
      hidePreview: async () => {},
      closePreview: async () => {},
      selectionSummary: async () => null,
      versions: async () => [],
      state: async () => ({ readonly: false, changed: false }),
    },
  }),
}));

import { DesignCanvas } from '../src/components/sessions/design-canvas';
import { closeSessionCanvases, isDesignCanvasRetired } from '../src/lib/design-canvas-close';

let SESSION_ID = 'design-session';
let sequence = 0;
let root: Root | undefined;
let container: HTMLDivElement;

async function settle() {
  await act(async () => {
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  SESSION_ID = `design-session-${++sequence}`;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 300,
    width: 400,
    height: 300,
    toJSON: () => ({}),
  });
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  main.records.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('permanent deletion of a mounted canvas', () => {
  it('does not reopen the deleted artwork when the confirm dialog closes afterwards', async () => {
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <Provider store={createStore()}>
          <DesignCanvas sessionId={SESSION_ID} active workspaceSlug="local" name="Synthetic" />
        </Provider>
      );
    });
    await settle();
    expect([...main.records]).toEqual([SESSION_ID]);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    await act(async () => document.body.append(dialog));
    await settle();

    const lifecycle = await closeSessionCanvases([SESSION_ID as never]);
    lifecycle.deleted(SESSION_ID as never);
    expect([...main.records]).toEqual([]);

    await act(async () => dialog.remove());
    await settle();

    expect([...main.records]).toEqual([]);
  });

  it('opens the canvas again when the deletion that retired it fails', async () => {
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <Provider store={createStore()}>
          <DesignCanvas sessionId={SESSION_ID} active workspaceSlug="local" name="Synthetic" />
        </Provider>
      );
    });
    await settle();

    const lifecycle = await closeSessionCanvases([SESSION_ID as never]);
    expect([...main.records]).toEqual([]);

    await act(async () => lifecycle.release());
    await settle();

    expect([...main.records]).toEqual([SESSION_ID]);
  });

  it('keeps a deleted artwork closed across a canvas replacement during the operation', async () => {
    const render = async () => {
      root = createRoot(container);
      await act(async () => {
        root?.render(
          <Provider store={createStore()}>
            <DesignCanvas sessionId={SESSION_ID} active workspaceSlug="local" name="Synthetic" />
          </Provider>
        );
      });
      await settle();
    };
    await render();
    const lifecycle = await closeSessionCanvases([SESSION_ID as never]);
    lifecycle.deleted(SESSION_ID as never);
    expect([...main.records]).toEqual([]);

    await act(async () => root?.unmount());
    root = createRoot(container);
    await render();
    lifecycle.release();

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    await act(async () => document.body.append(dialog));
    await settle();
    await act(async () => dialog.remove());
    await settle();

    expect(isDesignCanvasRetired(SESSION_ID)).toBe(true);
    expect([...main.records]).toEqual([]);

    await act(async () => root?.unmount());
    expect(isDesignCanvasRetired(SESSION_ID)).toBe(false);
  });
});
