// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionHistory, SessionId } from '@molly/shared';
import { activeWorkspaceRuntimeAtom } from '../src/atoms/runtime';
import { useSessionDiffSummary } from '../src/components/sessions/use-session-diff-summary';
import * as conversation from '../src/lib/conversation-view';
import { buildFixtureHistory } from './conversation-view-fixtures';

vi.mock('../src/atoms/runtime', async () => {
  const { atom } = await import('jotai');
  return { activeWorkspaceRuntimeAtom: atom(null) };
});

const SESSION_ID = 'legacy-diff-session' as SessionId;
const LEGACY_DIFF = { filePath: 'legacy.txt', add: 2, del: 1 };
let root: Root | null = null;
let container: HTMLDivElement;
const views: conversation.ConversationView[] = [];
const frames = new Map<number, FrameRequestCallback>();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let nextFrame = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  for (const view of views.splice(0)) view.dispose();
  frames.clear();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function flushFrames(): void {
  act(() => {
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback(0);
    }
  });
}

function fixture() {
  let history = buildFixtureHistory(1).map((entry) =>
    entry.role === 'assistant' ? { ...entry, fileDiff: [LEGACY_DIFF] } : entry
  );
  const historyListeners = new Set<() => void>();
  const owned = new Set<string>();
  const view = conversation.createConversationViewFromHistory({
    sessionId: SESSION_ID,
    getHistory: () => history,
    subscribe: (listener) => {
      historyListeners.add(listener);
      return () => historyListeners.delete(listener);
    },
  });
  views.push(view);
  const acquire = conversation.acquireConversationDerivation;
  function acquireTracked<F>(
    nextView: conversation.ConversationView,
    derive: conversation.DeriveTurnFact<F>
  ) {
    owned.add('derivation');
    const lease = acquire(nextView, derive);
    return {
      table: lease.table,
      release: () => {
        owned.delete('derivation');
        lease.release();
      },
    };
  }
  vi.spyOn(conversation, 'acquireConversationDerivation').mockImplementation(acquireTracked);
  const runtime = {
    acquireSessionStore: async (sessionId: SessionId) => {
      expect(sessionId).toBe(SESSION_ID);
      owned.add('store');
      return {
        history: view,
        firstSynced: Promise.resolve(),
        acquireSync: () => {
          owned.add('sync');
          return () => owned.delete('sync');
        },
      };
    },
    releaseSessionStoreRef: (sessionId: SessionId) => {
      expect(sessionId).toBe(SESSION_ID);
      owned.delete('store');
    },
  };
  const store = createStore();
  store.set(activeWorkspaceRuntimeAtom as never, runtime as never);
  let latest: ReturnType<typeof useSessionDiffSummary> | undefined;
  function Probe({ enabled }: { enabled: boolean }) {
    latest = useSessionDiffSummary(SESSION_ID, { enabled });
    return <span>{JSON.stringify(latest.summary)}</span>;
  }
  return {
    owned,
    read: () => {
      if (!latest) throw new Error('Summary probe has not rendered');
      return latest;
    },
    render: async (enabled: boolean) => {
      await act(async () =>
        root?.render(
          <Provider store={store}>
            <Probe enabled={enabled} />
          </Provider>
        )
      );
      flushFrames();
    },
    append: async (entries: SessionHistory[]) => {
      await act(async () => {
        history = [...history, ...entries];
        for (const listener of historyListeners) listener();
      });
      flushFrames();
    },
  };
}

describe('useSessionDiffSummary historical reads', () => {
  it('does not acquire conversation or sync resources while the design scope is disabled', async () => {
    const setup = fixture();
    await setup.render(false);
    expect(setup.owned).toEqual(new Set());
    expect(setup.read()).toMatchObject({ ready: false, synced: false, revision: 0 });
    expect(setup.read().summary.fileDiffsByTurn).toEqual({});
  });

  it('reads retained turn diffs without synthesizing All Changes for a new turn', async () => {
    const setup = fixture();
    await setup.render(true);
    expect(setup.read()).toMatchObject({ ready: true, synced: true });
    expect(setup.read().summary.fileDiffsByTurn).toEqual({ 'a-0': [LEGACY_DIFF] });
    const before = setup.read().summary;
    await setup.append(buildFixtureHistory(2).slice(2));
    expect(setup.read().summary).toBe(before);
    expect(setup.read().summary.diffFilePathsByTurn).toEqual({ 'a-0': ['legacy.txt'] });
    expect(setup.read().summary.fileDiffsByTurn).not.toHaveProperty('a-1');
    expect(setup.read().summary.changeEntries).toEqual([]);
    expect(setup.read().summary.changeFilePaths).toEqual([]);
  });

  it('releases the borrowed derivation, sync and session store when unmounted', async () => {
    const setup = fixture();
    await setup.render(true);
    expect(setup.owned).toEqual(new Set(['store', 'sync', 'derivation']));
    await act(async () => root?.unmount());
    root = null;
    expect(setup.owned).toEqual(new Set());
    expect(frames.size).toBe(0);
  });
});
