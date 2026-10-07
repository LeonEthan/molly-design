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
  canvasVisible: false,
  cover: vi.fn<() => Promise<{ src: string; width: number; height: number } | null>>(),
  processing: false,
  versions: vi.fn<() => Promise<{ commitId: string; number: number; createdAt: string }[]>>(),
  baseVersionId: undefined as string | undefined,
  changed: true,
  sync: vi.fn<() => Promise<void>>(),
  attach: vi.fn<() => Promise<void>>(),
  saveVersion: vi.fn<() => Promise<unknown>>(),
  resizeCallbacks: new Set<() => void>(),
  translate: (_key: string, fallback: string) => fallback,
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
vi.mock('../src/components/chat/submission/use-composer-navigation-focus', () => ({
  useDesignCanvasNavigationFocus: () => () => false,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: state.translate }),
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
      versions: async (id: string) => {
        state.calls.push(['versions', id]);
        return state.versions();
      },
      state: async (id: string) => (
        state.calls.push(['state', id]),
        {
          readonly: state.processing,
          turnId: state.processing ? 'active' : undefined,
          changed: state.changed,
          baseVersionId: state.baseVersionId,
        }
      ),
      presentToolbar: async () => {},
      syncFromStore: () => state.sync(),
      cover: async (_artworkId: string, _hostId: string, covered: boolean) => {
        if (!covered) return null;
        state.canvasVisible = false;
        state.previewVisible = false;
        return state.cover();
      },
      hide: async () => {
        state.canvasVisible = false;
      },
      hidePreview: async () => {
        state.previewVisible = false;
      },
      closePreview: async () => {
        state.previewVisible = false;
      },
      attach: async (id: string) => {
        state.calls.push(['attach', id]);
        await state.attach();
        state.canvasVisible = true;
      },
      saveVersion: () => state.saveVersion(),
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
const receipt = (
  turnId: string,
  revisionId = 'a'.repeat(64),
  status = 'committed',
  artworkId = 'artwork'
) => ({
  designOutcome: {
    version: 1,
    artworkId,
    turnId,
    revisionId,
    status,
    timestamp: '2026-09-11T00:00:00.000Z',
  },
});
const render = (props?: { sessionId?: string; artworkId?: string; active?: boolean }) =>
  act(async () => {
    root.render(
      <DesignCanvas
        sessionId={props?.sessionId ?? 'artwork'}
        artworkId={props?.artworkId ?? 'artwork'}
        active={props?.active ?? true}
        workspaceSlug="local"
        name="Artwork"
      />
    );
  });
beforeEach(() => {
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      async decode() {}
    }
  );
  state.cover
    .mockReset()
    .mockResolvedValue({ src: 'data:image/png;base64,cGl4ZWxz', width: 800, height: 600 });
  state.canvasVisible = false;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {
        state.resizeCallbacks.add(callback);
      }
      observe() {}
      disconnect() {
        state.resizeCallbacks.delete(this.callback);
      }
    }
  );
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  state.history = [];
  state.synced = false;
  state.previewVisible = false;
  state.processing = false;
  state.versions.mockReset().mockResolvedValue([]);
  state.baseVersionId = undefined;
  state.changed = true;
  state.calls = [];
  state.docSessionId = '';
  state.sync.mockReset().mockResolvedValue(undefined);
  state.attach.mockReset().mockResolvedValue(undefined);
  state.saveVersion.mockReset();
  state.resizeCallbacks.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.querySelectorAll('[data-test-overlay]').forEach((node) => node.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const visibleCanvas = () =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    top: 0,
    left: 0,
    bottom: 600,
    right: 800,
    toJSON: () => ({}),
  });
const resizeCanvas = () =>
  act(async () => {
    for (const callback of state.resizeCallbacks) callback();
  });
const deferredAttachment = () => {
  let resolve!: () => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

it('clears a recovered attachment error after the current canvas attaches successfully', async () => {
  visibleCanvas();
  state.attach.mockRejectedValueOnce(Error('Attachment failed'));
  await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Attachment failed');
  await resizeCanvas();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('preserves a save error when a pending attachment succeeds', async () => {
  visibleCanvas();
  await render();
  const pending = deferredAttachment();
  state.attach.mockImplementationOnce(() => pending.promise);
  await resizeCanvas();
  state.saveVersion.mockRejectedValueOnce(Error('Save failed'));
  const save = container.querySelector<HTMLButtonElement>('[aria-label="Save version"]');
  expect(save?.disabled).toBe(false);
  await act(async () => save?.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Save failed');
  await act(async () => pending.resolve());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Save failed');
});

it('retains a current attachment failure when a superseded attachment succeeds', async () => {
  visibleCanvas();
  const previous = deferredAttachment();
  state.attach.mockImplementationOnce(() => previous.promise);
  await render();
  state.attach.mockRejectedValueOnce(Error('Current attachment failed'));
  await render({ artworkId: 'next-artwork' });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Current attachment failed'
  );
  await act(async () => previous.resolve());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Current attachment failed'
  );
});

it('ignores a superseded attachment failure after the current canvas succeeds', async () => {
  visibleCanvas();
  const previous = deferredAttachment();
  state.attach.mockImplementationOnce(() => previous.promise);
  await render();
  await render({ artworkId: 'next-artwork' });
  await act(async () => previous.reject(Error('Old attachment failed')));
  expect(container.querySelector('[role="alert"]')).toBeNull();
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
  const save = [...container.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === 'Save version'
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

const openVersions = () =>
  act(async () => {
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Version history"]');
    button?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });

it('shows loading before an empty history and explains versions without claiming a successful autosave', async () => {
  let finish!: (versions: []) => void;
  state.versions.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await openVersions();
  expect(document.querySelector('[role="menu"]')?.textContent).toContain('Loading versions…');
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain(
    'No saved versions yet'
  );
  await act(async () => finish([]));
  expect(document.querySelector('[role="menu"]')?.textContent).toContain('No saved versions yet');
  expect(document.querySelector('[role="menu"]')?.textContent).toContain('Use Save version');
  expect(container.textContent).toContain('No saved version');
  expect(container.textContent).not.toContain('Autosaved');
});

it('shows a failed history read and recovers with an explicit retry', async () => {
  state.versions.mockRejectedValue(Error('History unavailable'));
  await render();
  await openVersions();
  expect(document.querySelector('[role="menu"]')?.textContent).toContain('History unavailable');
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain(
    'No saved versions yet'
  );
  state.versions.mockResolvedValue([]);
  const retry = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === 'Retry loading versions'
  );
  await act(async () => retry?.click());
  expect(document.querySelector('[role="menu"]')?.textContent).toContain('No saved versions yet');
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('History unavailable');
});

it('keeps the version state after a failed save and disables version actions while processing', async () => {
  state.baseVersionId = 'version-one';
  state.versions.mockResolvedValue([
    { commitId: 'version-one', number: 1, createdAt: '2026-10-05T12:00:00Z' },
  ]);
  state.saveVersion.mockRejectedValue(Error('Version write failed'));
  await render();
  const save = container.querySelector<HTMLButtonElement>('[aria-label="Save version"]')!;
  await act(async () => save.click());
  expect(container.textContent).toContain('Changes not versioned');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Version write failed');
  state.processing = true;
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(save.disabled).toBe(true);
  await openVersions();
  const version = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
    item.textContent?.includes('V1')
  );
  expect(version?.getAttribute('aria-disabled')).toBe('true');
});

it('identifies an unchanged saved version without implying autosave success', async () => {
  state.baseVersionId = 'version-one';
  state.changed = false;
  state.versions.mockResolvedValue([
    { commitId: 'version-one', number: 1, createdAt: '2026-10-05T12:00:00Z' },
  ]);
  await render();
  expect(container.querySelector('[role="status"]')?.textContent).toBe('V1');
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Save version"]')?.disabled).toBe(
    true
  );
  expect(container.querySelector('[aria-label="Focus canvas"]')).not.toBeNull();
});

const blockingOverlay = (role = 'menu') => {
  const overlay = document.createElement('div');
  overlay.setAttribute('role', role);
  overlay.setAttribute('data-test-overlay', '');
  document.body.append(overlay);
  return overlay;
};

it('retains inert canvas pixels under nested overlays until the native editor returns', async () => {
  visibleCanvas();
  await render();
  expect(state.canvasVisible).toBe(true);
  const menu = blockingOverlay();
  await resizeCanvas();
  expect(state.canvasVisible).toBe(false);
  const frame = container.querySelector('img');
  expect(frame?.getAttribute('src')).toBe('data:image/png;base64,cGl4ZWxz');
  expect(frame?.getAttribute('aria-hidden')).toBe('true');
  const nested = blockingOverlay('alertdialog');
  menu.remove();
  await resizeCanvas();
  expect(container.querySelector('img')).toBe(frame);
  expect(state.canvasVisible).toBe(false);
  const restore = deferredAttachment();
  state.attach.mockReturnValueOnce(restore.promise);
  nested.remove();
  await resizeCanvas();
  expect(container.querySelector('img')).toBe(frame);
  await act(async () => restore.resolve());
  expect(state.canvasVisible).toBe(true);
  expect(container.querySelector('img')).toBeNull();
});

it('ignores a delayed capture after the menu closes and after switching artwork', async () => {
  visibleCanvas();
  await render();
  const capture = Promise.withResolvers<{ src: string; width: number; height: number } | null>();
  state.cover.mockReturnValueOnce(capture.promise);
  const menu = blockingOverlay();
  await resizeCanvas();
  menu.remove();
  await resizeCanvas();
  await render({ artworkId: 'another-artwork' });
  await act(async () =>
    capture.resolve({ src: 'data:image/png;base64,b2xk', width: 800, height: 600 })
  );
  expect(container.querySelector('img')).toBeNull();
  expect(state.canvasVisible).toBe(true);
});

it('keeps menus usable on capture failure and restores the editor afterward', async () => {
  visibleCanvas();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await render();
  state.cover.mockRejectedValueOnce(Error('Capture failed'));
  const menu = blockingOverlay();
  await resizeCanvas();
  expect(state.canvasVisible).toBe(false);
  expect(container.querySelector('img')).toBeNull();
  menu.remove();
  await resizeCanvas();
  expect(state.canvasVisible).toBe(true);
});

it('does not hide the canvas for non-intersecting overlays', async () => {
  visibleCanvas();
  await render();
  const menu = blockingOverlay();
  vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(new DOMRect(900, 0, 100, 100));
  await resizeCanvas();
  expect(state.canvasVisible).toBe(true);
  expect(container.querySelector('img')).toBeNull();
});

it('clears the temporary frame when the panel becomes inactive', async () => {
  visibleCanvas();
  await render();
  blockingOverlay();
  await resizeCanvas();
  expect(container.querySelector('img')).not.toBeNull();
  await render({ active: false });
  expect(container.querySelector('img')).toBeNull();
  expect(state.canvasVisible).toBe(false);
});
