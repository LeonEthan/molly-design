// @vitest-environment jsdom
import React, { act } from 'react';
import { createConversationViewFromHistory } from '../src/lib/conversation-view';
import type { SessionId } from '@molly/shared';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({
  hostId: '',
  refreshCalls: 0,
  events: new Map<string, (payload: unknown) => void>(),
  history: [] as Array<{ role: 'assistant'; id: string; finished: boolean; endedAt: number }>,
  canvasState: {
    readonly: false,
    turnId: undefined as string | undefined,
    preparing: false,
    changed: true,
  },
  visible: false,
  previewVisible: false,
  attachPreviewCalls: 0,
  refresh: async (): Promise<unknown> => ({ status: 'ready', source: '/synthetic/design.yaml' }),
  attach: async () => {},
}));
vi.mock('jotai', async (original) => ({
  ...(await original<typeof import('jotai')>()),
  useAtomValue: (key: string) =>
    key === 'machine'
      ? { machineId: 'machine' }
      : key === 'workspace'
        ? 'workspace'
        : key === 'live'
          ? state.canvasState
          : null,
}));
vi.mock('../src/atoms', () => ({ userAtom: 'user', currentWorkspaceIdAtom: 'workspace' }));
vi.mock('../src/atoms/runtime', () => ({ activeWorkspaceRuntimeAtom: 'runtime' }));
vi.mock('../src/atoms/local-probe', () => ({ localProbeResultAtom: 'machine' }));
vi.mock('../src/atoms/presence', () => ({ sessionLiveStatusAtomFamily: () => 'live' }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => {}, useBlocker: () => {} }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('../src/hooks/use-session-doc', () => ({
  useSessionDoc: () => ({
    doc: {},
    history: createConversationViewFromHistory({
      sessionId: 'artwork' as SessionId,
      getHistory: () =>
        state.history.map((entry) => ({ ...entry, timestamp: '2026-09-17T00:00:00Z' })),
      subscribe: () => () => {},
    }),
  }),
}));
vi.mock('../src/lib/electron-ipc-client', () => ({
  onIpcEvent: (channel: string, listener: (payload: unknown) => void) => {
    state.events.set(channel, listener);
    return () => {
      state.events.delete(channel);
    };
  },
  getIpcServices: () => ({
    design: {
      presentToolbar: async () => {},
      attach: async () => {
        await state.attach();
        state.visible = true;
        if (!state.canvasState.turnId) state.previewVisible = false;
      },
      hide: async () => {
        state.visible = false;
      },
      refreshPreview: (_session: string, host: string) => {
        state.hostId = host;
        state.refreshCalls += 1;
        return state.refresh();
      },
      attachPreview: async () => {
        state.attachPreviewCalls += 1;
        state.previewVisible = true;
        state.visible = false;
      },
      hidePreview: async () => {
        state.previewVisible = false;
      },
      closePreview: async () => {
        state.previewVisible = false;
      },
      selectionSummary: async () => null,
      versions: async () => [],
      state: async () => ({ ...state.canvasState }),
    },
  }),
}));
import { DesignCanvas } from '../src/components/sessions/design-canvas';
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  state.events.clear();
  state.history = [];
  state.canvasState = { readonly: false, turnId: undefined, preparing: false, changed: true };
  state.visible = false;
  state.previewVisible = false;
  state.refreshCalls = 0;
  state.attachPreviewCalls = 0;
  state.attach = async () => {};
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
    width: 400,
    height: 300,
    top: 0,
    bottom: 300,
    left: 0,
    right: 400,
    toJSON() {
      return this;
    },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const mount = () =>
  act(async () =>
    root.render(
      <DesignCanvas
        sessionId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        active
        workspaceSlug="local"
        name="Synthetic"
      />
    )
  );
const artworkId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const execution = (turnId?: string, preparing = false) =>
  act(async () => {
    state.canvasState = { readonly: !!turnId, turnId, preparing, changed: true };
    state.events.get('design.state')?.({ artworkId });
  });
const publish = (result: unknown) => act(async () => state.events.get('design.preview')?.(result));

test('one canvas keeps canonical until a valid live snapshot and locks actions through processing', async () => {
  state.refresh = async () => ({ status: 'waiting', source: '', error: '' });
  await mount();
  expect(state.visible).toBe(true);
  await execution('turn-1', true);
  expect(state.visible).toBe(true);
  const save = [...container.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === 'Save version'
  )!;
  expect(save.disabled).toBe(true);
  await execution('turn-1');
  expect(state.visible).toBe(true);
  expect(state.previewVisible).toBe(false);
  await publish({ hostId: artworkId, status: 'ready', sourceIdentity: 'step-1' });
  expect(state.visible).toBe(false);
  expect(state.previewVisible).toBe(true);
  await publish({ hostId: artworkId, status: 'waiting', retained: true, error: 'Incomplete YAML' });
  expect(state.previewVisible).toBe(true);
  expect(container.textContent).toContain('Incomplete YAML');
  expect(container.querySelector('details')?.open).toBe(false);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  // An assistant message ending is not the authoritative release signal.
  state.history = [{ role: 'assistant', id: 'turn', finished: true, endedAt: 1 }];
  state.refresh = async () => ({ status: 'waiting', retained: true });
  await mount();
  expect(save.disabled).toBe(true);
  await execution();
  expect(state.visible).toBe(true);
  expect(state.previewVisible).toBe(false);
  expect(save.disabled).toBe(false);
  expect(container.textContent).not.toContain('Incomplete YAML');
});

test('late output from a previous turn cannot replace the new canonical fallback', async () => {
  let finish!: (result: unknown) => void;
  state.refresh = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await mount();
  await execution('old');
  await execution();
  await act(async () => finish({ status: 'ready', sourceIdentity: 'stale' }));
  expect(state.previewVisible).toBe(false);
  expect(state.visible).toBe(true);
});

test('continuous valid states replace the same canvas and recovery clears errors', async () => {
  state.refresh = async () => ({ status: 'ready', sourceIdentity: 'step-1' });
  await mount();
  await execution('active');
  await publish({
    hostId: artworkId,
    status: 'waiting',
    retained: true,
    error: 'Missing referenced file',
    automaticError: 'Native watch failed',
  });
  expect(state.previewVisible).toBe(true);
  expect(container.textContent).toContain('Native watch failed');
  await publish({ hostId: artworkId, status: 'ready', sourceIdentity: 'step-2' });
  expect(state.previewVisible).toBe(true);
  expect(container.textContent).not.toContain('Native watch failed');
  const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
  expect(labels).not.toContain('Preview');
  expect(labels).not.toContain('Artwork');
  expect(labels).not.toContain('Refresh preview');
});

test('turn completion keeps the final preview until the editor handoff finishes', async () => {
  state.refresh = async () => ({ status: 'ready', sourceIdentity: 'final-frame' });
  await mount();
  await execution('active');
  expect(state.previewVisible).toBe(true);
  let finish!: () => void;
  state.attach = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  await execution();
  expect(state.previewVisible).toBe(true);
  expect(state.visible).toBe(false);
  await act(async () => finish());
  expect(state.visible).toBe(true);
  expect(state.previewVisible).toBe(false);
});
