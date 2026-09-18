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
  liveStatus: null as null | { type: 'running' },
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
          ? state.liveStatus
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
      },
      hidePreview: async () => {
        state.previewVisible = false;
      },
      closePreview: async () => {
        state.previewVisible = false;
      },
      selectionSummary: async () => null,
      versions: async () => [],
    },
  }),
}));
import { DesignCanvas } from '../src/components/sessions/design-canvas';
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  state.events.clear();
  state.history = [];
  state.liveStatus = null;
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
const click = (label: string) =>
  act(async () =>
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent === label)!
      .click()
  );
test('reselecting source during refresh keeps the pending response consumable', async () => {
  let complete!: (result: unknown) => void;
  state.refresh = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  await mount();
  await click('Preview');
  await click('Preview');
  const attachedBefore = state.attachPreviewCalls;
  await act(async () => complete({ status: 'ready', source: '/synthetic/design.yaml' }));
  expect(state.attachPreviewCalls).toBeGreaterThan(attachedBefore);
});
test('shows valid intermediate authoring snapshots while an Agent turn is active', async () => {
  state.refresh = async () => ({
    status: 'ready',
    source: '/synthetic/intermediate-1/design.yaml',
    sourceIdentity: 'intermediate-1',
  });
  await mount();
  expect(state.visible).toBe(true);
  expect(state.previewVisible).toBe(false);
  state.liveStatus = { type: 'running' };
  await mount();
  expect(state.hostId).not.toBe('');
  expect(state.previewVisible).toBe(true);
  expect(state.visible).toBe(false);
  await act(async () =>
    state.events.get('design.preview')?.({
      hostId: state.hostId,
      source: '/synthetic/intermediate-2/design.yaml',
      sourceIdentity: 'intermediate-2',
      status: 'ready',
    })
  );
  expect(state.previewVisible).toBe(true);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  await click('Artwork');
  expect(state.visible).toBe(true);
  expect(state.previewVisible).toBe(false);
  await mount();
  expect(state.previewVisible).toBe(false);
});
test('old attachment cleanup cannot hide the current artwork after a rapid switch', async () => {
  let finishAttach!: () => void;
  const delayed = new Promise<void>((resolve) => {
    finishAttach = resolve;
  });
  state.attach = () => delayed;
  state.refresh = async () => ({ status: 'ready', source: '/synthetic/design.yaml' });
  await mount();
  await click('Preview');
  await click('Artwork');
  await act(async () => finishAttach());
  expect(state.visible).toBe(true);
  expect(state.previewVisible).toBe(false);
});

test('push status, reconnect and finalized history reconcile only an open preview', async () => {
  state.refresh = async () => ({ status: 'ready', source: '/synthetic/first/design.yaml' });
  await mount();
  await click('Preview');
  await act(async () =>
    state.events.get('design.preview')?.({
      hostId: state.hostId,
      source: '/synthetic/first/design.yaml',
      status: 'waiting',
      error: 'Missing referenced file',
      automaticError: 'Native watch failed',
    })
  );
  expect(container.textContent).toContain('Missing referenced file');
  expect(container.textContent).toContain('Automatic preview updates unavailable.');
  const beforeReconnect = state.refreshCalls;
  await act(async () => state.events.get('loro.status')?.(true));
  expect(state.refreshCalls).toBeGreaterThan(beforeReconnect);
  expect(container.textContent).not.toContain('Missing referenced file');
  expect(container.textContent).not.toContain('Native watch failed');
  state.history = [{ role: 'assistant', id: 'turn', finished: true, endedAt: 1 }];
  const beforeFinalized = state.refreshCalls;
  await mount();
  expect(state.refreshCalls).toBeGreaterThan(beforeFinalized);
  await click('Artwork');
  expect(state.events.has('design.preview')).toBe(false);
  expect(state.events.has('loro.status')).toBe(false);
});

test('preview errors hide with the preview and clear after successful reconciliation', async () => {
  state.refresh = async () => ({ status: 'ready', source: '/synthetic/design.yaml' });
  await mount();
  await click('Preview');
  await act(async () =>
    state.events.get('design.preview')?.({
      hostId: state.hostId,
      source: '/synthetic/design.yaml',
      status: 'waiting',
      error: 'Missing referenced file',
      automaticError: 'Native watch failed',
    })
  );
  expect(container.textContent).toContain('Missing referenced file');
  expect(container.textContent).toContain('Native watch failed');
  await click('Artwork');
  expect(container.textContent).not.toContain('Missing referenced file');
  expect(container.textContent).not.toContain('Native watch failed');
  await click('Preview');
  expect(container.textContent).not.toContain('Missing referenced file');
  expect(container.textContent).not.toContain('Native watch failed');
});

test('preview exposes no manual refresh, import action or information banner', async () => {
  state.refresh = async () => ({
    status: 'ready',
    source: '/synthetic/design.yaml',
    sourceIdentity: 'shown',
  });
  await mount();
  await click('Preview');
  const labels = [...container.querySelectorAll('button')].map((button) => button.textContent);
  expect(labels).not.toContain('Refresh preview');
  expect(labels).not.toContain('Import as current artwork');
  expect(container.textContent).not.toContain('Read-only authoring files');
  expect(container.textContent).not.toContain('/synthetic/design.yaml');
});
