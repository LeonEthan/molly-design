// @vitest-environment jsdom

import React, { act, type HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore, useSetAtom } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type NavigationState = {
  __TSR_key?: string;
  focusComposerSessionId?: string;
  focusDesignCanvasSessionId?: string;
  unrelated?: string;
};

const navigation = vi.hoisted(() => {
  const initialState: NavigationState = { __TSR_key: 'entry-0' };
  const state = {
    rendered: initialState,
    history: initialState,
    href: '/local/sessions/design-session',
    sequence: 0,
    listeners: new Set<() => void>(),
  };
  return {
    state,
    router: {
      history: {
        get location() {
          return { href: state.href, state: state.history };
        },
        replace(href: string, next: NavigationState) {
          state.href = href;
          state.history = { ...next, __TSR_key: `entry-${++state.sequence}` };
          state.rendered = state.history;
          for (const listener of state.listeners) listener();
        },
      },
    },
    translate: (key: string, fallback?: string) => fallback ?? key,
    navigate: async () => {},
  };
});

vi.mock('@tanstack/react-router', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useRouter: () => navigation.router,
    useRouterState: <Value,>({
      select,
    }: {
      select: (state: { location: { state: NavigationState } }) => Value;
    }) => {
      const state = useSyncExternalStore(
        (listener) => {
          navigation.state.listeners.add(listener);
          return () => navigation.state.listeners.delete(listener);
        },
        () => navigation.state.rendered
      );
      return select({ location: { state } });
    },
    useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
      select({ pathname: '/local/sessions/design-session' }),
    useNavigate: () => navigation.navigate,
    useBlocker: () => {},
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: navigation.translate }),
}));

vi.mock('../src/atoms', async () => {
  const { atom } = await import('jotai');
  return {
    ...(await import('../src/atoms/layout-state')),
    ...(await import('../src/atoms/sidebar-state')),
    userAtom: atom(null),
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

vi.mock('../src/hooks/use-conversation-view', () => ({
  useConversationIndexRows: () => [],
}));

vi.mock('../src/hooks/use-keyboard-navigation', () => ({ useKeyboardNavigation: () => {} }));

vi.mock('../src/components/loro-app-sidebar', () => ({
  LoroAppSidebar: () => <aside data-testid="navigation-sidebar">Navigation</aside>,
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: HTMLAttributes<HTMLDivElement> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => <div {...props} />,
  },
  useReducedMotion: () => true,
}));

vi.mock('../src/lib/electron-ipc-client', () => ({
  onIpcEvent: () => () => {},
  getIpcServices: () => ({
    design: {
      attach: async () => {},
      hide: async () => {},
      presentToolbar: async () => {},
      hidePreview: async () => {},
      closePreview: async () => {},
      selectionSummary: async () => null,
      versions: async () => [],
      state: async () => ({ readonly: false, changed: false }),
    },
  }),
}));

import { DesignCanvas } from '../src/components/sessions/design-canvas';
import { WebWorkspaceLayout } from '../src/components/web-workspace-layout';
import { getSessionCreationNavigation } from '../src/components/chat/submission/use-composer-navigation-focus';
import {
  designCanvasFocusAtom,
  navigationSidebarHiddenAtom,
  showNavigationSidebarAtom,
} from '../src/atoms/layout-state';
import { sidebarCollapsedAtom } from '../src/atoms/sidebar-state';

const SESSION_ID = 'design-session';
let store = createStore();
let root: Root | undefined;
let container: HTMLDivElement;

function Workspace({ active }: { active: boolean }) {
  const showNavigation = useSetAtom(showNavigationSidebarAtom);
  return (
    <WebWorkspaceLayout>
      <div data-testid="chat">Conversation</div>
      <button onClick={() => showNavigation()}>Show navigation</button>
      <DesignCanvas sessionId={SESSION_ID} active={active} workspaceSlug="local" name="Synthetic" />
    </WebWorkspaceLayout>
  );
}

function setNavigationState(state: NavigationState) {
  navigation.state.history = state;
  navigation.state.rendered = state;
}

async function mount(active = true) {
  root ??= createRoot(container);
  await act(async () => {
    root?.render(
      <Provider store={store}>
        <Workspace active={active} />
      </Provider>
    );
  });
}

async function unmount() {
  await act(async () => root?.unmount());
  root = undefined;
}

function navigationVisible() {
  return container.querySelector('[data-testid="navigation-sidebar"]') !== null;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  store = createStore();
  store.set(sidebarCollapsedAtom, false);
  navigation.state.sequence = 0;
  navigation.state.listeners.clear();
  setNavigationState({ __TSR_key: 'entry-0' });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(async () => {
  await unmount();
  container.remove();
  vi.unstubAllGlobals();
});

describe('design canvas creation navigation', () => {
  it('requests canvas focus only when explicitly enabled', () => {
    const ordinary = getSessionCreationNavigation('local', SESSION_ID, false);
    expect(ordinary.state.focusDesignCanvasSessionId).toBeUndefined();
    expect(ordinary.state.focusComposerSessionId).toBe(SESSION_ID);

    const design = getSessionCreationNavigation('local', SESSION_ID, false, {
      focusDesignCanvas: true,
    });
    expect(design.state.focusDesignCanvasSessionId).toBe(SESSION_ID);
    expect(design.state.focusComposerSessionId).toBe(SESSION_ID);
  });

  it('consumes the request once and keeps conversation and canvas visible after history changes', async () => {
    setNavigationState({
      __TSR_key: 'entry-0',
      focusDesignCanvasSessionId: SESSION_ID,
      focusComposerSessionId: SESSION_ID,
      unrelated: 'preserved',
    });

    await mount();

    expect(navigationVisible()).toBe(false);
    expect(container.querySelector('[data-testid="chat"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Design canvas"]')).not.toBeNull();
    expect(store.get(designCanvasFocusAtom)).toBe(true);
    expect(store.get(sidebarCollapsedAtom)).toBe(false);
    expect(navigation.state.history).toMatchObject({
      focusDesignCanvasSessionId: undefined,
      focusComposerSessionId: SESSION_ID,
      unrelated: 'preserved',
    });
    expect(navigation.state.history.__TSR_key).not.toBe('entry-0');

    await act(async () => {
      const button = [...container.querySelectorAll('button')].find(
        (entry) => entry.textContent === 'Show navigation'
      );
      button?.click();
    });
    await mount();

    expect(navigationVisible()).toBe(true);
    expect(store.get(designCanvasFocusAtom)).toBe(false);
  });

  it.each([undefined, 'another-session'])(
    'keeps ordinary visits and another target visible (%s)',
    async (target) => {
      setNavigationState({ __TSR_key: 'entry-0', focusDesignCanvasSessionId: target });

      await mount();

      expect(navigationVisible()).toBe(true);
      expect(store.get(designCanvasFocusAtom)).toBe(false);
      expect(navigation.state.history.focusDesignCanvasSessionId).toBe(target);
    }
  );

  it('rejects a claim from a superseded history entry', async () => {
    setNavigationState({ __TSR_key: 'entry-0', focusDesignCanvasSessionId: SESSION_ID });
    navigation.state.history = {
      __TSR_key: 'newer-entry',
      focusDesignCanvasSessionId: SESSION_ID,
    };

    await mount();

    expect(navigationVisible()).toBe(true);
    expect(store.get(designCanvasFocusAtom)).toBe(false);
    expect(navigation.state.history.focusDesignCanvasSessionId).toBe(SESSION_ID);
  });

  it('waits for the target canvas to become active before consuming the request', async () => {
    setNavigationState({ __TSR_key: 'entry-0', focusDesignCanvasSessionId: SESSION_ID });
    await mount(false);
    expect(navigationVisible()).toBe(true);
    expect(navigation.state.history.focusDesignCanvasSessionId).toBe(SESSION_ID);

    await mount(true);

    expect(navigationVisible()).toBe(false);
    expect(navigation.state.history.focusDesignCanvasSessionId).toBeUndefined();
  });

  it.each([false, true])(
    'restores the saved collapsed=%s preference on leaving',
    async (collapsed) => {
      store.set(sidebarCollapsedAtom, collapsed);
      setNavigationState({ __TSR_key: 'entry-0', focusDesignCanvasSessionId: SESSION_ID });
      await mount();
      expect(store.get(designCanvasFocusAtom)).toBe(true);
      expect(store.get(sidebarCollapsedAtom)).toBe(collapsed);

      await mount(false);

      expect(store.get(designCanvasFocusAtom)).toBe(false);
      expect(store.get(navigationSidebarHiddenAtom)).toBe(collapsed);
      expect(store.get(sidebarCollapsedAtom)).toBe(collapsed);
      expect(navigationVisible()).toBe(!collapsed);
    }
  );

  it('does not replay a consumed request after remount, Back, or reload', async () => {
    setNavigationState({ __TSR_key: 'entry-0', focusDesignCanvasSessionId: SESSION_ID });
    await mount();
    expect(navigationVisible()).toBe(false);
    const consumedState = { ...navigation.state.history };
    await unmount();
    expect(store.get(designCanvasFocusAtom)).toBe(false);

    await mount();
    expect(navigationVisible()).toBe(true);
    await unmount();

    setNavigationState({ ...consumedState, __TSR_key: 'back-entry' });
    await mount();
    expect(navigationVisible()).toBe(true);
    await unmount();

    store = createStore();
    setNavigationState({ ...consumedState, __TSR_key: 'reload-entry' });
    await mount();
    expect(navigationVisible()).toBe(true);
    expect(store.get(designCanvasFocusAtom)).toBe(false);
  });
});
