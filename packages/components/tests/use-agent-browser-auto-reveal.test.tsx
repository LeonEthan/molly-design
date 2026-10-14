// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ElectronPublicBrowserState } from '@molly/shared';

import { useAgentBrowserAutoReveal } from '../src/hooks/use-agent-browser-auto-reveal';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Control = ElectronPublicBrowserState['agentControl'];

describe('useAgentBrowserAutoReveal', () => {
  let root: Root;
  let container: HTMLDivElement;
  let handlers: Array<(payload: unknown) => void>;
  let setPanelOpen: (open: boolean) => void;

  function Harness({
    browserId,
    turnId,
    suppressed,
  }: {
    browserId: string | null;
    turnId: string | null;
    suppressed: boolean;
  }) {
    const [panelOpen, setOpen] = useState(false);
    setPanelOpen = setOpen;
    useAgentBrowserAutoReveal({
      browserId,
      turnId,
      suppressed,
      onReveal: () => setOpen(true),
    });
    return <div data-testid="panel" data-open={String(panelOpen)} />;
  }

  const renderHarness = (props: {
    browserId: string | null;
    turnId: string | null;
    suppressed?: boolean;
  }) => {
    act(() => {
      root.render(<Harness {...props} suppressed={props.suppressed ?? false} />);
    });
  };

  const panelOpen = () =>
    container.querySelector('[data-testid="panel"]')?.getAttribute('data-open') === 'true';

  const emit = (browserId: string, agentControl: Control) => {
    act(() => {
      for (const handler of handlers) {
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

  beforeEach(() => {
    handlers = [];
    window.__MOLLY_ELECTRON__ = true;
    window.ipc = {
      invoke: async () => ({ ok: true }),
      on: (channel: string, handler: (payload: unknown) => void) => {
        if (channel === 'publicBrowser.state') handlers.push(handler);
        return () => {
          handlers = handlers.filter((entry) => entry !== handler);
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
  });

  it('reveals when the Agent takes control of the viewed session browser', () => {
    renderHarness({ browserId: 'session-browser-a', turnId: 'turn-1' });
    expect(panelOpen()).toBe(false);

    emit('session-browser-a', 'agent');

    expect(panelOpen()).toBe(true);
  });

  it('does not reopen after the user closes the panel during the same turn', () => {
    renderHarness({ browserId: 'session-browser-a', turnId: 'turn-1' });
    emit('session-browser-a', 'agent');
    expect(panelOpen()).toBe(true);

    act(() => setPanelOpen(false));
    emit('session-browser-a', 'human');
    emit('session-browser-a', 'agent');
    emit('session-browser-a', 'human');
    emit('session-browser-a', 'agent');

    expect(panelOpen()).toBe(false);
  });

  it('reveals again on the next turn', () => {
    renderHarness({ browserId: 'session-browser-a', turnId: 'turn-1' });
    emit('session-browser-a', 'agent');
    act(() => setPanelOpen(false));

    renderHarness({ browserId: 'session-browser-a', turnId: 'turn-2' });
    emit('session-browser-a', 'human');
    expect(panelOpen()).toBe(false);
    emit('session-browser-a', 'agent');

    expect(panelOpen()).toBe(true);
  });

  it('ignores browsers of sessions that are not in view', () => {
    renderHarness({ browserId: 'session-browser-a', turnId: 'turn-1' });

    emit('session-browser-b', 'agent');

    expect(panelOpen()).toBe(false);
  });

  it('does not reveal without a viewed session browser', () => {
    renderHarness({ browserId: null, turnId: null });

    emit('session-browser-a', 'agent');

    expect(panelOpen()).toBe(false);
  });

  it('ignores human and takeover states', () => {
    renderHarness({ browserId: 'session-browser-a', turnId: 'turn-1' });

    emit('session-browser-a', 'human');
    emit('session-browser-a', 'human-takeover');

    expect(panelOpen()).toBe(false);
  });

  it('does not reveal while Zen suppresses the panel and spends that turn', () => {
    renderHarness({ browserId: 'session-browser-a', turnId: 'turn-1', suppressed: true });
    emit('session-browser-a', 'agent');
    expect(panelOpen()).toBe(false);

    renderHarness({ browserId: 'session-browser-a', turnId: 'turn-1', suppressed: false });
    emit('session-browser-a', 'human');
    emit('session-browser-a', 'agent');
    expect(panelOpen()).toBe(false);

    renderHarness({ browserId: 'session-browser-a', turnId: 'turn-2', suppressed: false });
    emit('session-browser-a', 'agent');
    expect(panelOpen()).toBe(true);
  });
});
