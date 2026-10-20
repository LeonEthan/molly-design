// @vitest-environment jsdom

import { act, createElement, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { Provider as JotaiProvider, createStore } from 'jotai';
import {
  getSessionRoomId,
  type AgentConfigId,
  type MachineId,
  type SessionHistoryParsed,
  type SessionId,
  type SessionMeta,
} from '@molly/shared';

import { sessionMetaCacheAtom } from '../src/atoms/doc-meta';
import { MessageRowView, type ModelFailureRetryControl } from '../src/components/ai-gui/view';
import { initI18n } from '../src/i18n';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const sessionId = 'session-model-failure-notice' as SessionId;

const sessionMeta = {
  id: sessionId,
  machineId: 'machine-1' as MachineId,
  agentConfigId: 'agent-1' as AgentConfigId,
  userId: 'user-1',
  createdAt: '2026-08-19T09:00:00.000Z',
  cliType: 'builtin',
  agentType: 'codex',
  status: { type: 'idle' as const },
} satisfies SessionMeta;

const failureMessage = (id: string, meta: Record<string, unknown>): SessionHistoryParsed =>
  ({
    id,
    role: 'system',
    timestamp: '2026-08-19T09:00:00.000Z',
    read: true,
    items: [{ type: 'system_notice', name: 'chat_failed', meta }],
  }) as unknown as SessionHistoryParsed;

const transientNotice = failureMessage('notice-transient', {
  reason: 'acp_upstream_api_error',
  code: 'model_temporarily_unavailable',
  message: 'Model request failed after automatic retries: 503 Service Unavailable',
});

const permanentAuthNotice = failureMessage('notice-permanent-auth', {
  reason: 'acp_upstream_api_error',
  code: 'model_auth_rejected',
  message: 'Model request failed: 401 Unauthorized',
});

const legacyUpstreamNotice = failureMessage('notice-legacy-upstream', {
  reason: 'acp_upstream_api_error',
  message: 'Internal error: API Error: 500 {"type":"error"}',
});

const buttonWithExactText = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === text
  );

describe('ChatFailedNoticeView model request failures', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(async () => {
    await initI18n('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    root = undefined;
    container?.remove();
    container = undefined;
  });

  const renderMessage = async (
    message: SessionHistoryParsed,
    modelFailureRetry?: ModelFailureRetryControl
  ) => {
    const store = createStore();
    store.set(sessionMetaCacheAtom, { [getSessionRoomId(sessionId)]: sessionMeta });
    await act(async () => {
      root?.render(
        createElement(
          JotaiProvider,
          { store },
          createElement(MessageRowView, { message, sessionId, modelFailureRetry })
        )
      );
    });
  };

  it('shows one line with a single Retry button for a transient failure', async () => {
    function Harness() {
      const [pending, setPending] = useState(false);
      return createElement(MessageRowView, {
        message: transientNotice,
        sessionId,
        modelFailureRetry: {
          noticeId: transientNotice.id,
          pending,
          canRetry: true,
          retry: () => setPending(true),
        },
      });
    }

    const store = createStore();
    store.set(sessionMetaCacheAtom, { [getSessionRoomId(sessionId)]: sessionMeta });
    await act(async () => {
      root?.render(createElement(JotaiProvider, { store }, createElement(Harness)));
    });

    expect(document.body.textContent).toContain('Model temporarily unavailable');
    expect(document.body.textContent).not.toContain('View details');
    const retryButton = buttonWithExactText('Retry');
    expect(retryButton).toBeDefined();
    expect(retryButton?.disabled).toBe(false);

    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const pendingButton = buttonWithExactText('Retrying…');
    expect(pendingButton).toBeDefined();
    expect(pendingButton?.disabled).toBe(true);
  });

  it('never shows the button for a transient notice that is not the retry target', async () => {
    await renderMessage(transientNotice);
    expect(document.body.textContent).toContain('Model temporarily unavailable');
    expect(buttonWithExactText('Retry')).toBeUndefined();
    expect(document.body.textContent).not.toContain('View details');
  });

  it('shows the action hint without Retry or View details for a permanent failure', async () => {
    await renderMessage(permanentAuthNotice, {
      noticeId: permanentAuthNotice.id,
      pending: false,
      canRetry: true,
      retry: () => undefined,
    });
    expect(document.body.textContent).toContain("The model connection's key was rejected");
    expect(document.body.textContent).toContain('Check the connection in Settings.');
    expect(buttonWithExactText('Retry')).toBeUndefined();
    expect(document.body.textContent).not.toContain('View details');
  });

  it('keeps the detail entry for uncoded upstream errors', async () => {
    await renderMessage(legacyUpstreamNotice);
    expect(document.body.textContent).toContain('Upstream API error');
    expect(document.body.textContent).toContain('View details');
    expect(buttonWithExactText('Retry')).toBeUndefined();
  });
});
