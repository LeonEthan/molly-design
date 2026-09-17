// @vitest-environment jsdom
import React, { act } from 'react';
import { createConversationViewFromHistory } from '../src/lib/conversation-view';
import type { SessionId } from '@molly/shared';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({
  hostId: '',
  events: new Map<string, (payload: unknown) => void>(),
  history: [] as Array<{ role: 'assistant'; id: string; finished: boolean; endedAt: number }>,
  liveStatus: null as null | { type: 'running' },
  visible: false,
  previewVisible: false,
  refresh: async (): Promise<unknown> => ({ status: 'ready', source: '/synthetic/design.yaml' }),
  attach: async () => {},
  importPreview: async (
    _session: string,
    _host: string,
    _identity: string
  ): Promise<{ revisionId: string; reloadError?: string }> => ({ revisionId: 'saved' }),
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
      importPreview: (session: string, host: string, identity: string) =>
        state.importPreview(session, host, identity),
      hide: async () => {
        state.visible = false;
      },
      refreshPreview: (_session: string, host: string) => {
        state.hostId = host;
        return state.refresh();
      },
      attachPreview: async () => {
        state.previewVisible = true;
      },
      hidePreview: async () => {
        state.previewVisible = false;
      },
      closePreview: async () => {
        state.previewVisible = false;
      },
      selectionSummary: async () => null,
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
  await act(async () => complete({ status: 'ready', source: '/synthetic/design.yaml' }));
  expect(container.textContent).toContain('Showing the observed document and assets.');
  expect(
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Refresh preview'
    )!.disabled
  ).toBe(false);
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
  expect(container.textContent).toContain('/synthetic/intermediate-1/design.yaml');
  await act(async () =>
    state.events.get('design.preview')?.({
      hostId: state.hostId,
      source: '/synthetic/intermediate-2/design.yaml',
      sourceIdentity: 'intermediate-2',
      status: 'ready',
    })
  );
  expect(container.textContent).toContain('/synthetic/intermediate-2/design.yaml');
  expect(state.previewVisible).toBe(true);
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
  let path = '/synthetic/first/design.yaml';
  state.refresh = async () => ({ status: 'ready', source: path });
  await mount();
  await click('Preview');
  await act(async () =>
    state.events.get('design.preview')?.({
      hostId: state.hostId,
      source: path,
      status: 'waiting',
      error: 'Missing referenced file',
      automaticError: 'Native watch failed',
    })
  );
  expect(container.textContent).toContain('Missing referenced file');
  expect(container.textContent).toContain('Automatic updates unavailable');
  path = '/synthetic/reconnected/design.yaml';
  await act(async () => state.events.get('loro.status')?.(true));
  expect(container.textContent).toContain(path);
  expect(container.textContent).not.toContain('Native watch failed');
  path = '/synthetic/finalized/design.yaml';
  state.history = [{ role: 'assistant', id: 'turn', finished: true, endedAt: 1 }];
  await mount();
  expect(container.textContent).toContain(path);
  await click('Artwork');
  expect(state.events.has('design.preview')).toBe(false);
  expect(state.events.has('loro.status')).toBe(false);
});

test('import names the displayed snapshot, retains preview on failure and opens canonical only after save', async () => {
  state.refresh = async () => ({
    status: 'ready',
    source: '/synthetic/design.yaml',
    sourceIdentity: 'shown',
  });
  let requested: unknown;
  state.importPreview = async (...args) => {
    requested = args;
    throw Error('DESIGN_CONFLICT');
  };
  await mount();
  await click('Preview');
  await click('Import as current artwork');
  expect(requested).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', state.hostId, 'shown']);
  expect(container.textContent).toContain('DESIGN_CONFLICT');
  expect(state.previewVisible).toBe(true);
  state.importPreview = async () => ({ revisionId: 'saved', reloadError: 'dirty editor' });
  await click('Import as current artwork');
  expect(container.textContent).toContain('Imported and saved, but the canvas could not reload');
  expect(state.previewVisible).toBe(true);
  state.importPreview = async () => ({ revisionId: 'saved' });
  await click('Import as current artwork');
  expect(state.previewVisible).toBe(false);
  expect(state.visible).toBe(true);
});
