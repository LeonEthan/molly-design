// @vitest-environment jsdom
import { act } from 'react';
import { createConversationViewFromHistory } from '../src/lib/conversation-view';
import type { SessionId, SessionHistory } from '@molly/shared';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  history: [] as { designOutcome?: unknown }[],
  synced: false,
  previewVisible: false,
  processing: false,
  sync: vi.fn<() => Promise<void>>(),
  /** Records [method, firstArg] for artwork-scoped design service calls. */
  calls: [] as [string, string][],
  /** The session id handed to useSessionDoc (conversation ownership). */
  docSessionId: '' as string,
}));
vi.mock('../src/atoms/runtime', () => ({ activeWorkspaceRuntimeAtom: 'runtime' }));
vi.mock('../src/atoms/local-probe', () => ({ localProbeResultAtom: 'machine' }));
vi.mock('../src/atoms', () => ({ userAtom: 'user', currentWorkspaceIdAtom: 'workspace' }));
vi.mock('jotai', async (original) => ({
  ...(await original<typeof import('jotai')>()),
  useAtomValue: (atom: string) =>
    atom === 'machine' ? { machineId: 'machine' } : atom === 'workspace' ? 'workspace' : null,
}));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => {}, useNavigate: () => () => {} }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_: string, fallback: string) => fallback }),
}));
vi.mock('../src/lib/session-draft-tabs', () => ({ writeStoredLastActiveTabState: () => {} }));
vi.mock('../src/hooks/use-session-doc', () => ({
  useSessionDoc: (sessionId: string) => {
    state.docSessionId = sessionId;
    return {
      doc: {},
      synced: state.synced,
      history: createConversationViewFromHistory({
        sessionId: 'artwork' as SessionId,
        getHistory: () =>
          state.history.map((entry, index) => ({
            id: `turn-${index}`,
            role: 'user',
            timestamp: '2026-09-17T00:00:00Z',
            ...entry,
          })) as SessionHistory[],
        subscribe: () => () => {},
      }),
    };
  },
}));
vi.mock('../src/lib/electron-ipc-client', () => ({
  onIpcEvent: () => () => {},
  getIpcServices: () => ({
    design: {
      versions: async (id: string) => (state.calls.push(['versions', id]), []),
      state: async (id: string) => (
        state.calls.push(['state', id]),
        {
          readonly: state.processing,
          turnId: state.processing ? 'active' : undefined,
          changed: true,
        }
      ),
      presentToolbar: async () => {},
      syncFromStore: () => state.sync(),
      hide: async () => {},
      hidePreview: async () => {
        state.previewVisible = false;
      },
      closePreview: async () => {
        state.previewVisible = false;
      },
      attach: async (id: string) => {
        state.calls.push(['attach', id]);
      },
      attachPreview: async () => {
        state.previewVisible = true;
      },
      refreshPreview: async () => ({ status: 'ready', source: 'design.yaml' }),
      selectionSummary: async () => null,
    },
  }),
}));
import { DesignCanvas } from '../src/components/sessions/design-canvas';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const receipt = (turnId: string, revisionId = 'a'.repeat(64), status = 'committed', artworkId = 'artwork') => ({
  designOutcome: {
    version: 1,
    artworkId,
    turnId,
    revisionId,
    status,
    timestamp: '2026-09-11T00:00:00.000Z',
  },
});
const render = (props?: { sessionId?: string; artworkId?: string }) =>
  act(async () => {
    root.render(
      <DesignCanvas
        sessionId={props?.sessionId ?? 'artwork'}
        artworkId={props?.artworkId ?? 'artwork'}
        active
        workspaceSlug="local"
        name="Artwork"
      />
    );
  });
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  state.history = [];
  state.synced = false;
  state.previewVisible = false;
  state.processing = false;
  state.calls = [];
  state.docSessionId = '';
  state.sync.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('reconciles hydrated committed receipts only after history synchronization', async () => {
  state.history = [receipt('old')];
  state.sync.mockRejectedValue(Error('Synchronization reached'));
  await render();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  state.synced = true;
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Synchronization reached'
  );
});
it('a committed receipt cannot release the authoritative processing lock', async () => {
  state.processing = true;
  state.synced = true;
  await render();
  let finish!: () => void;
  state.sync.mockImplementation(
    () =>
      new Promise((done) => {
        finish = done;
      })
  );
  state.history = [receipt('new')];
  await render();
  const save = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Save version')
  )!;
  expect(save.disabled).toBe(true);
  await act(async () => finish());
  expect(save.disabled).toBe(true);
});
it('reports a guarded reload failure without discarding unsaved edits', async () => {
  state.synced = true;
  state.sync.mockRejectedValue(Error('Canvas has unsaved edits'));
  state.history = [receipt('new')];
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('unsaved edits');
});
it('failure receipts do not request canonical replacement', async () => {
  state.synced = true;
  state.history = [receipt('failed', 'a'.repeat(64), 'invalid')];
  state.sync.mockRejectedValue(Error('Must not replace'));
  await render();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

// Issue #49 regression: a continuation session edits the SOURCE artwork, so
// sessionId !== artworkId. Artwork-scoped design channel calls (versions,
// state, attach, sync-from-store) must route by artwork id, while the
// conversation document stays owned by the session id.
it('routes artwork operations by artwork id while the conversation stays session-owned', async () => {
  state.synced = true;
  state.history = [receipt('turn-1', 'b'.repeat(64), 'committed', 'artwork-y')];
  await render({ sessionId: 'session-continuation', artworkId: 'artwork-y' });
  expect(state.docSessionId).toBe('session-continuation');
  expect(state.calls.filter(([method]) => method === 'versions').map(([, id]) => id)).toContain(
    'artwork-y'
  );
  expect(state.calls.filter(([method]) => method === 'state').map(([, id]) => id)).toContain(
    'artwork-y'
  );
  expect(state.calls.map(([, id]) => id)).not.toContain('session-continuation');
  // The committed receipt for artwork-y must trigger a store sync of artwork-y.
  expect(state.sync).toHaveBeenCalled();
});
