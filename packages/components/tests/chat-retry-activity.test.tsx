// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Provider, createStore } from 'jotai';
import { getSessionRoomId, type SessionId, type SessionMeta } from '@molly/shared';
import { sessionMetaCacheAtom } from '../src/atoms/doc-meta';
import { SessionChatStreamView, type ChatStreamItem } from '../src/components/ai-gui/view';
import { initI18n } from '../src/i18n';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const sessionId = 'session-retry-activity' as SessionId;
const retryMessage = (status: 'in_progress' | 'completed', finished = false): ChatStreamItem => ({
  type: 'message',
  sessionId,
  turnIndex: 0,
  message: {
    id: 'assistant-retry',
    role: 'assistant',
    timestamp: '2026-10-14T00:00:00.000Z',
    read: true,
    finished,
    items: [
      {
        type: 'tool_call',
        toolCallId: 'retry-1',
        title: 'Retrying',
        activityKind: 'codex_retry',
        status,
      },
    ],
  },
});

describe('native retry activity in the conversation', () => {
  let container: HTMLDivElement;
  let root: Root;
  const store = createStore();
  let observers: Array<{ callback: ResizeObserverCallback; targets: Set<Element> }>;

  beforeEach(async () => {
    await initI18n('en');
    observers = [];
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function () {
      return this.parentElement;
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        targets = new Set<Element>();
        constructor(callback: ResizeObserverCallback) {
          observers.push({ callback, targets: this.targets });
        }
        observe(target: Element) {
          this.targets.add(target);
        }
        unobserve(target: Element) {
          this.targets.delete(target);
        }
        disconnect() {
          this.targets.clear();
        }
      }
    );
    store.set(sessionMetaCacheAtom, {
      [getSessionRoomId(sessionId)]: {
        id: sessionId,
        agentType: 'codex',
      } as SessionMeta,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const render = async (items: ChatStreamItem[]) => {
    await act(async () => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(SessionChatStreamView, {
            sessionId,
            items,
            lastAssistantMessageId: 'assistant-retry',
            agentActivityLabel: 'Thinking',
            renderMessageRow: () => null,
          })
        )
      );
    });
    await act(async () => {
      for (const observer of observers) {
        observer.callback(
          [...observer.targets].map((target) => ({
            target,
            contentRect: { width: 800, height: 600 },
          })) as ResizeObserverEntry[],
          {} as ResizeObserver
        );
      }
    });
  };

  it('shows only the retry line during backoff and restores Thinking after recovery', async () => {
    await render([retryMessage('in_progress')]);
    expect(container.textContent?.match(/Retrying/g)).toHaveLength(1);
    expect(container.textContent).toContain('Retrying…');
    expect(container.textContent).not.toContain('Thinking');

    await render([retryMessage('completed')]);
    expect(container.textContent).not.toContain('Retrying');
    expect(container.textContent).toContain('Thinking');
  });

  it('does not suppress activity for a new user turn behind an old retry', async () => {
    await render([
      retryMessage('in_progress', true),
      {
        type: 'message',
        sessionId,
        turnIndex: 1,
        message: {
          id: 'new-user-turn',
          role: 'user',
          timestamp: '2026-10-14T00:00:01.000Z',
          read: true,
          items: [{ type: 'text', text: 'Continue' }],
        },
      },
    ]);
    expect(container.textContent).toContain('Thinking');
  });
});
