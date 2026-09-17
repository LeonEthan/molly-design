// @vitest-environment jsdom
import { act } from 'react';
import { createConversationViewFromHistory } from '../src/lib/conversation-view';
import type { SessionId, SessionHistory } from '@molly/shared';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  history: [] as { designOutcome?: unknown }[],
  synced: false,
  sync: vi.fn<() => Promise<void>>(),
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
  useSessionDoc: () => ({
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
  }),
}));
vi.mock('../src/lib/electron-ipc-client', () => ({
  onIpcEvent: () => () => {},
  getIpcServices: () => ({
    design: {
      versions: async () => [],
      syncFromStore: () => state.sync(),
      hide: async () => {},
      hidePreview: async () => {},
      closePreview: async () => {},
      attach: async () => {},
      attachPreview: async () => {},
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
const receipt = (turnId: string, revisionId = 'a'.repeat(64), status = 'committed') => ({
  designOutcome: {
    version: 1,
    artworkId: 'artwork',
    turnId,
    revisionId,
    status,
    timestamp: '2026-09-11T00:00:00.000Z',
  },
});
const render = () =>
  act(async () => {
    root.render(<DesignCanvas sessionId="artwork" active workspaceSlug="local" name="Artwork" />);
  });
const click = async (name: string) =>
  act(async () => {
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === name
    );
    expect(button).toBeDefined();
    button!.click();
  });
const isPreview = () => container.textContent!.includes('Read-only authoring files');
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

it('seeds hydrated historical receipts without changing the chosen source', async () => {
  await render();
  await click('Preview');
  state.history = [receipt('old')];
  state.synced = true;
  await render();
  expect(isPreview()).toBe(true);
});
it('shows canonical only after a new successful receipt finishes guarded synchronization', async () => {
  state.synced = true;
  await render();
  await click('Preview');
  let resolve!: () => void;
  state.sync.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      })
  );
  state.history = [receipt('new')];
  await render();
  expect(isPreview()).toBe(true);
  await act(async () => resolve());
  expect(isPreview()).toBe(false);
});
it('preserves preview and shows a failed canonical reload instead of masking unsaved edits', async () => {
  state.synced = true;
  await render();
  await click('Preview');
  state.sync.mockRejectedValue(Error('Canvas has unsaved edits'));
  state.history = [receipt('new')];
  await render();
  expect(isPreview()).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('unsaved edits');
});
it('does not override a newer explicit source choice with delayed completion', async () => {
  state.synced = true;
  await render();
  await click('Preview');
  let resolve!: () => void;
  state.sync.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      })
  );
  state.history = [receipt('new')];
  await render();
  await click('Artwork');
  await click('Preview');
  await act(async () => resolve());
  expect(isPreview()).toBe(true);
});
it('ignores failure receipts and recognizes a new successful turn at the same revision', async () => {
  state.synced = true;
  state.history = [receipt('old')];
  await render();
  await click('Preview');
  state.history.push(receipt('failed', 'a'.repeat(64), 'invalid'));
  await render();
  expect(isPreview()).toBe(true);
  state.history.push(receipt('new'));
  await render();
  expect(isPreview()).toBe(false);
});

it('retains a pending new receipt across synchronization interruption', async () => {
  state.synced = true;
  await render();
  await click('Preview');
  let resolve!: () => void;
  state.sync.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      })
  );
  state.history = [receipt('new')];
  await render();
  const oldResolve = resolve;
  state.synced = false;
  await render();
  await act(async () => oldResolve());
  expect(isPreview()).toBe(true);
  state.synced = true;
  await render();
  await act(async () => resolve());
  expect(isPreview()).toBe(false);
});
