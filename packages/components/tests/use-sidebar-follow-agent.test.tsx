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
type CommittedReceipt = { id: string; timestamp?: string };
type HarnessProps = {
  browserId: string | null;
  turnId: string | null;
  sessionId?: string | null;
  historySessionId?: string | null;
  runningTurnId?: string | null;
  canvasHostId?: string | null;
  committedReceipts?: readonly CommittedReceipt[];
  suppressed?: boolean;
  initialPanel?: Panel;
  now?: () => number;
};

const BEFORE_VIEW = '2026-10-23T23:59:59.000Z';
const AT_VIEW = '2026-10-24T00:00:00.000Z';
const AFTER_VIEW = '2026-10-24T00:00:01.000Z';
const LATER_VIEW = '2026-10-24T00:00:02.000Z';
const NOW = () => Date.parse(AT_VIEW);
const receipt = (id: string, timestamp = AFTER_VIEW): CommittedReceipt => ({ id, timestamp });

describe('useSidebarFollowAgent', () => {
  let root: Root;
  let container: HTMLDivElement;
  let handlers: Record<string, Array<(payload: unknown) => void>>;
  let noteManualSidebarInteraction: () => void;
  let setPanel: (panel: Panel) => void;

  function Harness(props: HarnessProps) {
    const [panel, updatePanel] = useState<Panel>(
      props.initialPanel ?? { open: true, tab: 'design' }
    );
    const [zen, setZen] = useState(props.suppressed ?? false);
    const [designReveals, setDesignReveals] = useState(0);
    const [location] = useState('/local/sessions/a?tab=session:a');
    setPanel = updatePanel;
    const follow = useSidebarFollowAgent({
      browserId: props.browserId,
      sessionId: props.sessionId ?? props.browserId,
      historySessionId:
        props.historySessionId === undefined
          ? (props.sessionId ?? props.browserId)
          : props.historySessionId,
      turnId: props.turnId,
      runningTurnId: props.runningTurnId ?? null,
      canvasHostId: props.canvasHostId ?? null,
      committedReceipts: props.committedReceipts,
      suppressed: zen,
      onReveal: (tab, exitZen) => {
        if (exitZen) setZen(false);
        if (tab === 'design') setDesignReveals((count) => count + 1);
        updatePanel({ open: true, tab });
      },
      now: props.now ?? NOW,
    });
    noteManualSidebarInteraction = follow.noteManualSidebarInteraction;
    return (
      <div
        data-testid="panel"
        data-open={String(panel.open)}
        data-tab={panel.tab}
        data-zen={String(zen)}
        data-location={location}
        data-design-reveals={designReveals}
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
  const revealCount = () => Number(attribute('data-design-reveals'));
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
  const finishBrowsingSegment = () => {
    act(() => {
      vi.advanceTimersByTime(500);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AT_VIEW);
    clearSidebarFollowMemory();
    handlers = {};
    window.__MOLLY_ELECTRON__ = true;
    window.ipc = {
      invoke: async () => ({ ok: true }),
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
    const props = { browserId: 'session-browser-a', turnId: 'turn-1' };
    renderHarness(props);
    act(() => {
      noteManualSidebarInteraction();
      setPanel({ open: true, tab: 'design' });
    });
    emit('session-browser-a', 'agent');
    expect(activeTab()).toBe('design');

    renderHarness({ ...props, turnId: 'turn-2' });
    emit('session-browser-a', 'agent');
    expect(activeTab()).toBe('browser');
  });

  it('counts explicit panel opening as manual and clears it for a queued turn', () => {
    const props = {
      browserId: 'session-browser-a',
      turnId: 'turn-a',
      runningTurnId: 'turn-a',
      canvasHostId: 'session-a',
    };
    renderHarness(props);
    act(() => {
      noteManualSidebarInteraction();
      setPanel({ open: true, tab: 'browser' });
    });
    emitPreview('session-a', 'snapshot-a');
    expect(activeTab()).toBe('browser');

    renderHarness({ ...props, turnId: 'turn-c', runningTurnId: 'turn-c' });
    emitPreview('session-a', 'snapshot-c');
    expect(activeTab()).toBe('design');
  });

  it('binds manual suppression to the claimed turn when metadata catches up', () => {
    const props = {
      browserId: 'session-browser-a',
      turnId: 'turn-a',
      runningTurnId: 'turn-b',
      canvasHostId: 'session-a',
    };
    renderHarness(props);
    act(() => {
      noteManualSidebarInteraction();
      setPanel({ open: true, tab: 'browser' });
    });

    renderHarness({ ...props, turnId: 'turn-b' });
    emitPreview('session-a', 'snapshot-b');
    expect(activeTab()).toBe('browser');
  });

  it('does not carry manual suppression into a queued turn accepted before the interaction', () => {
    const props = {
      browserId: 'session-browser-a',
      turnId: 'turn-a',
      runningTurnId: 'turn-a',
      canvasHostId: 'session-a',
    };
    renderHarness(props);
    act(() => {
      noteManualSidebarInteraction();
      setPanel({ open: true, tab: 'browser' });
    });

    renderHarness({ ...props, turnId: 'turn-c', runningTurnId: 'turn-c' });
    emitPreview('session-a', 'snapshot-c');
    expect(activeTab()).toBe('design');
  });

  it('follows only new ready snapshots for the current executing session', () => {
    renderHarness({
      browserId: 'session-browser-a',
      turnId: 'turn-1',
      runningTurnId: 'turn-1',
      canvasHostId: 'session-a',
      initialPanel: { open: true, tab: 'browser' },
    });
    emitPreview('session-a', 'snapshot-1');
    expect(activeTab()).toBe('design');
    expect(revealCount()).toBe(1);

    emitPreview('session-a', 'snapshot-1');
    expect(revealCount()).toBe(1);
    emitPreview('session-a', 'snapshot-2');
    expect(revealCount()).toBe(2);
  });

  it('deduplicates a ready snapshot across conversation resubscriptions', () => {
    const props = {
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      turnId: 'turn-a',
      runningTurnId: 'turn-a',
      canvasHostId: 'session-a',
      initialPanel: { open: true, tab: 'browser' } satisfies Panel,
    };
    renderHarness(props);
    renderHarness({
      ...props,
      browserId: 'session-browser-b',
      sessionId: 'session-b',
      historySessionId: 'session-b',
      turnId: 'turn-b',
      runningTurnId: null,
      canvasHostId: 'session-a',
    });
    emitPreview('session-a', 'snapshot-away');
    expect(revealCount()).toBe(0);

    renderHarness(props);
    emitPreview('session-a', 'snapshot-away');
    expect(activeTab()).toBe('browser');
    expect(revealCount()).toBe(0);
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
    expect(revealCount()).toBe(0);
  });

  it('reveals each new receipt once after manual interaction and reopens the panel', () => {
    const props = {
      browserId: 'session-browser-a',
      turnId: 'turn-1',
      runningTurnId: 'turn-1',
      canvasHostId: 'session-a',
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);
    act(() => noteManualSidebarInteraction());

    renderHarness({ ...props, committedReceipts: [receipt('turn-1:revision-1')] });
    expect(attribute('data-open')).toBe('true');
    expect(activeTab()).toBe('design');
    expect(revealCount()).toBe(1);

    act(() => setPanel({ open: true, tab: 'browser' }));
    renderHarness({ ...props, committedReceipts: [receipt('turn-1:revision-1')] });
    expect(revealCount()).toBe(1);
    renderHarness({ ...props, committedReceipts: [receipt('turn-2:revision-2')] });
    expect(activeTab()).toBe('design');
    expect(revealCount()).toBe(2);
  });

  it('never reveals missing, invalid, or pre-view timestamps', () => {
    renderHarness({
      browserId: 'session-browser-a',
      turnId: 'turn-a',
      committedReceipts: [
        { id: 'missing' },
        { id: 'invalid', timestamp: 'not-a-date' },
        receipt('old:revision-1', BEFORE_VIEW),
      ],
      initialPanel: { open: false, tab: null },
    });

    expect(attribute('data-open')).toBe('false');
    expect(revealCount()).toBe(0);
  });

  it('reveals a receipt at the exact view start once', () => {
    const props = {
      browserId: 'session-browser-a',
      turnId: 'turn-a',
      committedReceipts: [receipt('turn-a:revision-1', AT_VIEW)],
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);
    expect(revealCount()).toBe(1);

    renderHarness(props);
    expect(revealCount()).toBe(1);
  });

  it('starts a new view on session switches without replaying away receipts', () => {
    let currentTime = AT_VIEW;
    const now = () => Date.parse(currentTime);
    const props = {
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      turnId: 'turn-a',
      committedReceipts: [receipt('old:revision-1', BEFORE_VIEW)],
      initialPanel: { open: false, tab: null } satisfies Panel,
      now,
    };
    renderHarness(props);
    currentTime = LATER_VIEW;
    renderHarness({
      ...props,
      browserId: 'session-browser-b',
      sessionId: 'session-b',
      historySessionId: 'session-b',
      turnId: 'turn-b',
    });
    renderHarness(props);
    expect(revealCount()).toBe(0);

    renderHarness({ ...props, committedReceipts: [receipt('new:revision-1', LATER_VIEW)] });
    expect(revealCount()).toBe(1);
  });

  it('distinguishes a same-turn same-revision recommit by timestamp', () => {
    const props = {
      browserId: 'session-browser-a',
      turnId: 'turn-a',
      committedReceipts: [
        receipt('turn-a:revision-1', AFTER_VIEW),
        receipt('turn-a:revision-1', LATER_VIEW),
      ],
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);
    expect(revealCount()).toBe(2);

    renderHarness(props);
    expect(revealCount()).toBe(2);
  });

  it('ignores a receipt from a non-current history session', () => {
    const props = {
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      historySessionId: 'session-b',
      turnId: 'turn-a',
      committedReceipts: [receipt('turn-a:revision-1')],
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);
    expect(revealCount()).toBe(0);

    renderHarness({ ...props, historySessionId: 'session-a' });
    expect(revealCount()).toBe(1);
  });

  it('keeps Zen and navigation unchanged while recording a committed reveal', () => {
    const props = {
      browserId: 'session-browser-a',
      turnId: 'turn-a',
      runningTurnId: 'turn-a',
      canvasHostId: 'session-a',
      suppressed: true,
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);
    const location = attribute('data-location');
    emit('session-browser-a', 'agent');
    emitPreview('session-a', 'snapshot-1');
    expect(attribute('data-open')).toBe('false');
    expect(attribute('data-zen')).toBe('true');

    renderHarness({ ...props, committedReceipts: [receipt('turn-a:revision-1')] });
    expect(attribute('data-open')).toBe('true');
    expect(activeTab()).toBe('design');
    expect(attribute('data-zen')).toBe('true');
    expect(attribute('data-location')).toBe(location);
  });

  it('ignores browser events and previews from a non-current conversation tab', () => {
    renderHarness({
      browserId: 'session-browser-a',
      turnId: 'turn-a',
      runningTurnId: 'turn-a',
      canvasHostId: 'session-a',
      initialPanel: { open: false, tab: null },
    });
    emit('session-browser-b', 'agent');
    emitPreview('session-b', 'snapshot-b');
    expect(attribute('data-open')).toBe('false');

    emit('session-browser-a', 'agent');
    expect(activeTab()).toBe('browser');
  });

  it('does not switch for waiting previews or turns without committed receipts', () => {
    renderHarness({
      browserId: 'session-browser-a',
      turnId: 'turn-a',
      runningTurnId: 'turn-a',
      canvasHostId: 'session-a',
      initialPanel: { open: true, tab: 'browser' } satisfies Panel,
    });
    emitPreview('session-a', 'snapshot-1', 'waiting');
    expect(activeTab()).toBe('browser');
    expect(revealCount()).toBe(0);
  });

  it('reveals a current receipt already present in the first synced history', () => {
    renderHarness({
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      turnId: 'turn-a',
      runningTurnId: 'turn-a',
      committedReceipts: [receipt('turn-a:revision-1')],
      initialPanel: { open: false, tab: 'browser' } satisfies Panel,
    });

    expect(attribute('data-open')).toBe('true');
    expect(activeTab()).toBe('design');
  });

  it('reveals a current receipt without waiting for canvas query evidence', () => {
    const props = {
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      historySessionId: null,
      turnId: 'turn-a',
      runningTurnId: 'turn-a',
      initialPanel: { open: false, tab: 'browser' } satisfies Panel,
    };
    renderHarness(props);
    renderHarness({
      ...props,
      historySessionId: 'session-a',
      committedReceipts: [receipt('turn-a:revision-1')],
    });

    expect(attribute('data-open')).toBe('true');
    expect(activeTab()).toBe('design');
  });

  it('reveals two current candidates at the same revision', () => {
    renderHarness({
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      turnId: 'turn-b',
      runningTurnId: 'turn-a',
      committedReceipts: [
        receipt('turn-b:revision-1', AFTER_VIEW),
        receipt('turn-c:revision-1', LATER_VIEW),
      ],
      initialPanel: { open: false, tab: 'browser' } satisfies Panel,
    });

    expect(revealCount()).toBe(2);
    expect(activeTab()).toBe('design');
  });

  it('reveals applied steer and queued commits from timestamps alone', () => {
    const props = {
      browserId: 'session-browser-a',
      sessionId: 'session-a',
      turnId: 'steer-turn',
      runningTurnId: 'original-turn',
      committedReceipts: [receipt('steer-turn:revision-1', AFTER_VIEW)],
      initialPanel: { open: false, tab: null } satisfies Panel,
    };
    renderHarness(props);
    expect(revealCount()).toBe(1);

    renderHarness({
      ...props,
      turnId: 'turn-c',
      runningTurnId: 'turn-c',
      committedReceipts: [
        receipt('steer-turn:revision-1', AFTER_VIEW),
        receipt('turn-c:revision-1', LATER_VIEW),
      ],
    });
    expect(revealCount()).toBe(2);
  });

  it.each(['old-first', 'new-first'] as const)(
    'uses timestamps instead of history arrival order (%s)',
    (order) => {
      const oldReceipt = receipt('old:revision-1', BEFORE_VIEW);
      const newReceipt = receipt('new:revision-1', AFTER_VIEW);
      renderHarness({
        browserId: 'session-browser-a',
        turnId: 'turn-a',
        committedReceipts: order === 'old-first' ? [oldReceipt, newReceipt] : [newReceipt, oldReceipt],
        initialPanel: { open: false, tab: null } satisfies Panel,
      });

      expect(revealCount()).toBe(1);
      expect(activeTab()).toBe('design');
    }
  );

  it('does not replay a pre-view receipt on repeated history renders', () => {
    const props = {
      browserId: 'session-browser-a',
      turnId: 'turn-a',
      committedReceipts: [receipt('old:revision-1', BEFORE_VIEW)],
      initialPanel: { open: false, tab: 'browser' } satisfies Panel,
    };
    renderHarness(props);
    renderHarness(props);

    expect(attribute('data-open')).toBe('false');
    expect(revealCount()).toBe(0);
  });
});
