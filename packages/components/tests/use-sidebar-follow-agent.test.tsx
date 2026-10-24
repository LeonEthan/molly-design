// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronPublicBrowserState } from '@molly/shared';

import {
  clearSidebarFollowMemory,
  useSidebarFollowAgent,
} from '../src/hooks/use-sidebar-follow-agent';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Control = ElectronPublicBrowserState['agentControl'];
type Panel = { open: boolean; tab: 'browser' | 'design' | null };
type HarnessProps = {
  browserId: string | null;
  turnId: string | null;
  sessionId?: string | null;
  historySessionId?: string | null;
  runningTurnId?: string | null;
  canvasHostId?: string | null;
  artworkId?: string | null;
  committedReceipt?: string;
  committedReceiptTimestamp?: string;
  historyReady?: boolean;
  historySynced?: boolean;
  suppressed?: boolean;
  initialPanel?: Panel;
};

describe('useSidebarFollowAgent', () => {
  let root: Root;
  let container: HTMLDivElement;
  let handlers: Record<string, Array<(payload: unknown) => void>>;
  let revisions: Record<string, string>;
  let canvasTurnIds: Record<string, string | undefined>;
  let noteManualSidebarInteraction: () => void;
  let setPanel: (panel: Panel) => void;

  function Harness(props: HarnessProps) {
    const [panel, updatePanel] = useState<Panel>(
      props.initialPanel ?? { open: true, tab: 'design' }
    );
    const [zen, setZen] = useState(props.suppressed ?? false);
    const [location] = useState('/local/sessions/a?tab=session:a');
    setPanel = updatePanel;
    const follow = useSidebarFollowAgent({
      ...props,
      sessionId: props.sessionId ?? props.browserId,
      historySessionId:
        props.historySessionId === undefined
          ? (props.sessionId ?? props.browserId)
          : props.historySessionId,
      runningTurnId: props.runningTurnId ?? null,
      canvasHostId: props.canvasHostId ?? null,
      artworkId: props.artworkId ?? props.canvasHostId ?? null,
      historyReady: props.historyReady ?? props.historySynced ?? false,
      suppressed: zen,
      onReveal: (tab, exitZen) => {
        if (exitZen) setZen(false);
        updatePanel({ open: true, tab });
      },
    });
    noteManualSidebarInteraction = follow.noteManualSidebarInteraction;
    return (
      <div
        data-testid="panel"
        data-open={String(panel.open)}
        data-tab={panel.tab}
        data-zen={String(zen)}
        data-location={location}
      />
    );
  }

  const renderHarness = (props: HarnessProps) => {
    act(() => {
      root.render(<Harness {...props} />);
    });
  };

  const attribute = (name: string) =>
    container.querySelector('[data-testid="panel"]')?.getAttribute(name);
  const activeTab = () => attribute('data-tab');
  const emit = (browserId: string, agentControl: Control) => {
    act(() => {
      for (const handler of handlers['publicBrowser.state'] ?? []) {
        handler({
          browserId,
          phase: 'ready',
          canGoBack: false,
          canGoForward: false,
          agentControl,
        } satisfies ElectronPublicBrowserState);
      }
    });
  };
  const emitPreview = (hostId: string, sourceIdentity: string, status = 'ready') => {
    act(() => {
      for (const handler of handlers['design.preview'] ?? []) {
        handler({ hostId, sourceIdentity, status, source: '/synthetic/design.yaml' });
      }
    });
  };
  const emitDesignState = async (artworkId: string, revisionId: string, turnId?: string) => {
    revisions[artworkId] = revisionId;
    canvasTurnIds[artworkId] = turnId;
    await act(async () => {
      for (const handler of handlers['design.state'] ?? []) handler({ artworkId });
    });
  };
  const finishBrowsingSegment = () => {
    act(() => {
      vi.advanceTimersByTime(500);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-10-24T00:00:00.000Z');
    clearSidebarFollowMemory();
    handlers = {};
    revisions = {};
    canvasTurnIds = {};
    window.__MOLLY_ELECTRON__ = true;
    window.ipc = {
      invoke: async (channel: string, ...args: unknown[]) =>
        channel === 'design.state'
          ? {
              revisionId: revisions[args[0] as string],
              turnId: canvasTurnIds[args[0] as string],
            }
          : { ok: true },
      on: (channel: string, handler: (payload: unknown) => void) => {
        (handlers[channel] ??= []).push(handler);
        return () => {
          handlers[channel] = (handlers[channel] ?? []).filter((entry) => entry !== handler);
        };
      },
      send: () => {},
    } as unknown as NonNullable<typeof window.ipc>;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.__MOLLY_ELECTRON__;
    delete window.ipc;
    vi.useRealTimers();
  });

  it('coalesces command boundaries within a browsing segment and follows the next segment', () => {
    renderHarness({ browserId: 'session-browser-a', turnId: 'turn-1' });
    emit('session-browser-a', 'agent');
    expect(activeTab()).toBe('browser');

    act(() => setPanel({ open: true, tab: 'design' }));
    emit('session-browser-a', 'human');
    act(() => {
      vi.advanceTimersByTime(499);
    });
    emit('session-browser-a', 'agent');
    expect(activeTab()).toBe('design');

    emit('session-browser-a', 'human');
    finishBrowsingSegment();
    emit('session-browser-a', 'agent');
    expect(activeTab()).toBe('browser');
  });

  it('suppresses later browsing segments after a manual switch until the next turn', () => {
    renderHarness({ browserId: 'session-browser-a', turnId: 'turn-1' });
    emit('session-browser-a', 'agent');
    act(() => {
      noteManualSidebarInteraction();
      setPanel({ open: true, tab: 'design' });
    });

    emit('session-browser-a', 'human');
    finishBrowsingSegment();
    emit('session-browser-a', 'agent');
    expect(activeTab()).toBe('design');

    renderHarness({ browserId: 'session-browser-a', turnId: 'turn-2' });
    emit('session-browser-a', 'human');
    finishBrowsingSegment();
    emit('session-browser-a', 'agent');
    expect(activeTab()).toBe('browser');
  });

  it('follows only new ready snapshots for the current executing session', () => {
    renderHarness({
      browserId: 'session-browser-a',
      turnId: 'turn-1',
      runningTurnId: 'turn-1',
      canvasHostId: 'session-a',
    });
    emit('session-browser-a', 'agent');
    expect(activeTab()).toBe('browser');

    emitPreview('session-a', 'snapshot-1');
    expect(activeTab()).toBe('design');
    act(() => setPanel({ open: true, tab: 'browser' }));
    emitPreview('session-a', 'snapshot-1');
    expect(activeTab()).toBe('browser');
    emitPreview('session-a', 'snapshot-2');
    expect(activeTab()).toBe('design');

    act(() => setPanel({ open: true, tab: 'browser' }));
    renderHarness({
      browserId: 'session-browser-b',
      turnId: 'turn-2',
      runningTurnId: null,
      canvasHostId: 'session-a',
    });
    emitPreview('session-a', 'snapshot-3');
    expect(activeTab()).toBe('browser');
  });

  it('does not follow live snapshots after a manual sidebar switch', () => {
    renderHarness({
      browserId: 'session-browser-a',
      turnId: 'turn-1',
      runningTurnId: 'turn-1',
      canvasHostId: 'session-a',
    });
    act(() => {
      noteManualSidebarInteraction();
      setPanel({ open: true, tab: 'browser' });
    });

    emitPreview('session-a', 'snapshot-1');

    expect(activeTab()).toBe('browser');
  });

  it('reveals each commit once even after manual interaction and reopens the panel', async () => {
    const props = {
      browserId: 'session-browser-a',
      turnId: 'turn-1',
      runningTurnId: 'turn-1',
      canvasHostId: 'session-a',
      historySynced: true,
    };
    renderHarness(props);
    act(() => {
      noteManualSidebarInteraction();
      setPanel({ open: false, tab: null });
    });

    await emitDesignState('session-a', 'revision-1');
    renderHarness({ ...props, committedReceipt: 'turn-1:revision-1' });
    expect(attribute('data-open')).toBe('true');
    expect(activeTab()).toBe('design');

    act(() => setPanel({ open: true, tab: 'browser' }));
    renderHarness({ ...props, committedReceipt: 'turn-1:revision-1' });
    expect(activeTab()).toBe('browser');
    await emitDesignState('session-a', 'revision-2');
    renderHarness({ ...props, turnId: 'turn-2', committedReceipt: 'turn-2:revision-2' });
    expect(activeTab()).toBe('design');
  });

  it('treats a receipt already present at mount as handled', async () => {
    const props = {
      browserId: 'session-browser-a',
      turnId: 'turn-1',
      canvasHostId: 'session-a',
      historySynced: true,
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness({ ...props, committedReceipt: 'old-turn:old-revision' });
    expect(attribute('data-open')).toBe('false');
    expect(activeTab()).toBeNull();

    await emitDesignState('session-a', 'new-revision');
    renderHarness({ ...props, committedReceipt: 'turn-1:new-revision' });
    expect(attribute('data-open')).toBe('true');
    expect(activeTab()).toBe('design');
  });

  it('keeps Zen and navigation unchanged while recording a committed canvas reveal', async () => {
    const props = {
      browserId: 'session-browser-a',
      turnId: 'turn-1',
      runningTurnId: 'turn-1',
      canvasHostId: 'session-a',
      historySynced: true,
      suppressed: true,
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);
    const location = attribute('data-location');
    emit('session-browser-a', 'agent');
    emitPreview('session-a', 'snapshot-1');
    expect(attribute('data-open')).toBe('false');
    expect(attribute('data-zen')).toBe('true');

    await emitDesignState('session-a', 'revision-1');
    renderHarness({ ...props, committedReceipt: 'turn-1:revision-1' });

    expect(attribute('data-open')).toBe('true');
    expect(activeTab()).toBe('design');
    expect(attribute('data-zen')).toBe('true');
    expect(attribute('data-location')).toBe(location);
  });

  it('ignores browser events and existing receipts from a non-current conversation tab', () => {
    renderHarness({
      browserId: 'session-browser-a',
      turnId: 'turn-1',
      canvasHostId: 'session-a',
      historySynced: true,
      initialPanel: { open: false, tab: null },
    });
    emit('session-browser-b', 'agent');
    expect(attribute('data-open')).toBe('false');

    renderHarness({
      browserId: 'session-browser-b',
      turnId: 'turn-2',
      canvasHostId: 'session-a',
      historySynced: true,
      committedReceipt: 'turn-2:revision-2',
    });
    emit('session-browser-a', 'agent');
    expect(attribute('data-open')).toBe('false');
    expect(activeTab()).toBeNull();
  });

  it('does not switch for waiting previews or turns without a committed receipt', () => {
    const props = {
      browserId: 'session-browser-a',
      turnId: 'turn-1',
      runningTurnId: 'turn-1',
      canvasHostId: 'session-a',
      historySynced: true,
      initialPanel: { open: true, tab: 'browser' } satisfies Panel,
    };
    renderHarness(props);
    emitPreview('session-a', 'snapshot-1', 'waiting');
    renderHarness({ ...props, committedReceipt: undefined });

    expect(activeTab()).toBe('browser');
  });

  it('reveals a new receipt even when history becomes ready after the commit', async () => {
    const props = {
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      historySessionId: null,
      turnId: 'turn-1',
      runningTurnId: 'turn-1',
      canvasHostId: 'session-a',
      historyReady: false,
      historySynced: false,
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);
    vi.setSystemTime('2026-10-24T00:00:01.000Z');
    await emitDesignState('session-a', 'revision-1');

    renderHarness({
      ...props,
      historySessionId: 'session-a',
      historyReady: true,
      committedReceipt: 'turn-1:revision-1',
      committedReceiptTimestamp: '2026-10-23T00:00:00.000Z',
    });

    expect(attribute('data-open')).toBe('true');
    expect(activeTab()).toBe('design');
  });

  it('does not replay an older receipt when history becomes ready after mount', () => {
    const props = {
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      historySessionId: null,
      turnId: 'turn-1',
      runningTurnId: 'turn-1',
      canvasHostId: 'session-a',
      historyReady: false,
      historySynced: false,
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);

    renderHarness({
      ...props,
      historySessionId: 'session-a',
      historyReady: true,
      committedReceipt: 'turn-1:revision-1',
      committedReceiptTimestamp: '2026-10-23T23:59:59.000Z',
    });

    expect(attribute('data-open')).toBe('false');
    expect(activeTab()).toBeNull();
  });

  it('does not initialize a new conversation baseline from the previous conversation history', () => {
    const initialPanel = { open: false, tab: null } satisfies Panel;
    renderHarness({
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      historySessionId: 'session-a',
      turnId: 'turn-1',
      canvasHostId: 'session-a',
      historyReady: true,
      historySynced: true,
      initialPanel,
    });

    const switched = {
      browserId: 'session-browser-b',
      sessionId: 'session-b',
      turnId: 'turn-2',
      canvasHostId: 'session-a',
      historyReady: true,
      historySynced: true,
      initialPanel,
    };
    renderHarness({
      ...switched,
      historySessionId: 'session-a',
      committedReceipt: 'turn-1:revision-1',
      committedReceiptTimestamp: '2026-10-23T00:00:00.000Z',
    });
    renderHarness({
      ...switched,
      historySessionId: 'session-b',
      committedReceipt: 'turn-2:revision-2',
      committedReceiptTimestamp: '2026-10-23T00:00:00.000Z',
    });

    expect(attribute('data-open')).toBe('false');
    expect(activeTab()).toBeNull();
  });

  it('does not replay older receipts that arrive through later history synchronization', () => {
    const props = {
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      historySessionId: 'session-a',
      turnId: 'turn-1',
      canvasHostId: 'session-a',
      historyReady: true,
      historySynced: false,
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);

    renderHarness({
      ...props,
      historySynced: true,
      committedReceipt: 'turn-1:revision-1',
      committedReceiptTimestamp: '2026-10-23T00:00:00.000Z',
    });

    expect(attribute('data-open')).toBe('false');
    expect(activeTab()).toBeNull();
  });

  it('keeps a new receipt pending until its revision activity arrives', async () => {
    const props = {
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      historySessionId: 'session-a',
      turnId: 'turn-1',
      canvasHostId: 'session-a',
      historyReady: true,
      historySynced: true,
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);
    renderHarness({ ...props, committedReceipt: 'turn-1:revision-1' });
    expect(attribute('data-open')).toBe('false');

    await emitDesignState('session-a', 'revision-1');

    expect(attribute('data-open')).toBe('true');
    expect(activeTab()).toBe('design');
  });

  it('does not treat execution-start activity as a new commit', async () => {
    const props = {
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      historySessionId: null,
      turnId: 'turn-2',
      canvasHostId: 'session-a',
      historyReady: false,
      historySynced: false,
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);
    renderHarness({
      ...props,
      historySessionId: 'session-a',
      historyReady: true,
      committedReceipt: 'turn-1:revision-1',
    });

    await emitDesignState('session-a', 'revision-1', 'assistant:turn-2');
    expect(attribute('data-open')).toBe('false');
    await emitDesignState('session-a', 'revision-1');

    expect(attribute('data-open')).toBe('false');
    expect(activeTab()).toBeNull();
  });

  it('does not follow older history that arrives after execution-start activity', async () => {
    const props = {
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      historySessionId: null,
      turnId: 'turn-2',
      canvasHostId: 'session-a',
      historyReady: false,
      historySynced: false,
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);
    await emitDesignState('session-a', 'revision-1', 'assistant:turn-2');

    renderHarness({
      ...props,
      historySessionId: 'session-a',
      historyReady: true,
      committedReceipt: 'turn-1:revision-1',
    });

    expect(attribute('data-open')).toBe('false');
    expect(activeTab()).toBeNull();
  });

  it('reveals a same-revision receipt for the new turn when the receipt arrives first', async () => {
    const props = {
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      historySessionId: 'session-a',
      turnId: 'turn-2',
      canvasHostId: 'session-a',
      historyReady: true,
      historySynced: true,
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);
    await emitDesignState('session-a', 'revision-1', 'assistant:turn-2');
    renderHarness({ ...props, committedReceipt: 'turn-2:revision-1' });
    expect(attribute('data-open')).toBe('true');
    expect(activeTab()).toBe('design');

    act(() => setPanel({ open: true, tab: 'browser' }));
    await emitDesignState('session-a', 'revision-1');

    expect(activeTab()).toBe('browser');
  });

  it('accepts a committed receipt from the applied steer turn', async () => {
    const props = {
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      historySessionId: 'session-a',
      turnId: 'steer-turn',
      canvasHostId: 'session-a',
      historyReady: true,
      historySynced: true,
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);
    await emitDesignState('session-a', 'revision-1', 'assistant:original-turn');
    renderHarness({ ...props, committedReceipt: 'steer-turn:revision-1' });

    await emitDesignState('session-a', 'revision-1');

    expect(attribute('data-open')).toBe('true');
    expect(activeTab()).toBe('design');
  });

  it('reveals a committed turn even when the next turn starts before its release is observed', async () => {
    const props = {
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      historySessionId: 'session-a',
      turnId: 'turn-c',
      canvasHostId: 'session-a',
      historyReady: true,
      historySynced: true,
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);
    await emitDesignState('session-a', 'revision-1', 'assistant:turn-b');
    await emitDesignState('session-a', 'revision-1', 'assistant:turn-c');
    renderHarness({ ...props, committedReceipt: 'turn-b:revision-1' });

    expect(attribute('data-open')).toBe('true');
    expect(activeTab()).toBe('design');
  });
});
