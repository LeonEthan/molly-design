// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { Provider } from 'jotai';
import { SessionList } from '../src/components/session-list';
import { SidebarRowEndSlot } from '../src/components/sidebar-row-shared';
import { initI18n } from '../src/i18n';

describe('SessionList activity status', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(async () => {
    await initI18n('en');
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }
    root = undefined;
    container?.remove();
    container = undefined;
    vi.restoreAllMocks();
  });

  it('does not update shared list state during render', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        React.createElement(
          Provider,
          null,
          React.createElement(SessionList, {
            sessions: [
              {
                sessionId: 'session-1',
                title: 'Fix sidebar state sync',
                repoFullName: 'loro-dev/lody',
                branchName: 'fix/sidebar-state-sync',
                latestMessageAt: '2026-04-22T00:00:00.000Z',
                addedLines: 0,
                deletedLines: 0,
                isWorking: false,
                hasUnreadMessages: false,
                isOffline: false,
                isWaitingPermission: false,
              },
            ],
            repos: [{ repoFullName: 'loro-dev/lody', collapsed: false }],
          })
        )
      );
    });

    const emittedRenderUpdateWarning = consoleError.mock.calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('Cannot update a component'))
    );
    expect(emittedRenderUpdateWarning).toBe(false);
  });

  it('keeps the working animation on an active-only fixed SVG', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        React.createElement(SidebarRowEndSlot, {
          isWorking: true,
        })
      );
    });

    const spinner = container.querySelector('[data-session-working-spinner]');
    expect(spinner?.tagName).toBe('svg');
    expect(spinner?.classList.contains('h-3')).toBe(true);
    expect(spinner?.classList.contains('w-3')).toBe(true);
    expect(spinner?.classList.contains('shrink-0')).toBe(true);
    expect(spinner?.classList.contains('animate-spin')).toBe(true);
    expect(spinner?.classList.contains('will-change-transform')).toBe(true);

    flushSync(() => {
      root?.render(
        React.createElement(SidebarRowEndSlot, {
          isWorking: false,
          hasUnreadMessages: true,
        })
      );
    });

    expect(container.querySelector('[data-session-working-spinner]')).toBeNull();
    expect(container.querySelector('.will-change-transform')).toBeNull();
  });
});
