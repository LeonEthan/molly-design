/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findLatestModelFailureRetryTarget,
  useModelFailureRetry,
  type ModelFailureRetryControl,
} from '../src/components/sessions/use-model-failure-retry';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const userEntry = (id: string) => ({
  id,
  role: 'user',
  items: [{ type: 'text', text: `original message of ${id}` }],
  inputConfig: {
    prompt: `original message of ${id}`,
    inputBlocks: [{ type: 'text', text: `original message of ${id}` }],
  },
});

const modelFailure = (id: string, code = 'model_temporarily_unavailable') => ({
  id,
  role: 'system',
  items: [
    {
      type: 'system_notice',
      name: 'chat_failed',
      meta: { reason: 'acp_upstream_api_error', code, message: 'Model request failed: 503' },
    },
  ],
});

const otherFailure = (id: string, reason: string) => ({
  id,
  role: 'system',
  items: [{ type: 'system_notice', name: 'chat_failed', meta: { reason } }],
});

describe('findLatestModelFailureRetryTarget', () => {
  it('targets the latest transient model failure and its original user entry', () => {
    const target = findLatestModelFailureRetryTarget([userEntry('user-1'), modelFailure('n-1')]);
    expect(target?.noticeId).toBe('n-1');
    expect(target?.userEntry.id).toBe('user-1');
  });

  it('accepts model_request_failed as the other transient code', () => {
    const target = findLatestModelFailureRetryTarget([
      userEntry('user-1'),
      modelFailure('n-1', 'model_request_failed'),
    ]);
    expect(target?.noticeId).toBe('n-1');
  });

  it('resends the nearest preceding user entry, not an older one', () => {
    const target = findLatestModelFailureRetryTarget([
      userEntry('user-1'),
      { id: 'assistant-1', role: 'assistant', items: [] },
      userEntry('user-2'),
      modelFailure('n-1'),
    ]);
    expect(target?.userEntry.id).toBe('user-2');
  });

  it('is superseded by a newer user turn', () => {
    expect(
      findLatestModelFailureRetryTarget([
        userEntry('user-1'),
        modelFailure('n-1'),
        userEntry('user-2'),
      ])
    ).toBeNull();
  });

  it('ignores non-model failure reasons', () => {
    expect(
      findLatestModelFailureRetryTarget([
        userEntry('user-1'),
        otherFailure('n-1', 'acp_provider_overloaded'),
      ])
    ).toBeNull();
    expect(
      findLatestModelFailureRetryTarget([
        userEntry('user-1'),
        otherFailure('n-1', 'acp_internal_error'),
      ])
    ).toBeNull();
    expect(
      findLatestModelFailureRetryTarget([
        userEntry('user-1'),
        otherFailure('n-1', 'agent_disconnected'),
      ])
    ).toBeNull();
  });

  it('ignores permanent model codes', () => {
    for (const code of [
      'model_auth_rejected',
      'model_quota_exceeded',
      'model_context_overflow',
      'model_content_blocked',
      'model_request_rejected',
    ]) {
      expect(
        findLatestModelFailureRetryTarget([userEntry('user-1'), modelFailure('n-1', code)])
      ).toBeNull();
    }
  });

  it('lets a newer failure notice supersede an older transient one', () => {
    expect(
      findLatestModelFailureRetryTarget([
        userEntry('user-1'),
        modelFailure('n-1'),
        otherFailure('n-2', 'acp_internal_error'),
      ])
    ).toBeNull();
  });

  it('returns null when the failed round has no preceding user entry', () => {
    expect(findLatestModelFailureRetryTarget([modelFailure('n-1')])).toBeNull();
    expect(findLatestModelFailureRetryTarget([])).toBeNull();
    expect(findLatestModelFailureRetryTarget(undefined)).toBeNull();
  });
});

describe('useModelFailureRetry', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('never retries on its own and resends the original user entry on click', async () => {
    const resent: unknown[] = [];
    let release: (accepted: boolean) => void = () => undefined;
    const onRetry = (entry: unknown) => {
      resent.push(entry);
      return new Promise<boolean>((resolve) => {
        release = resolve;
      });
    };
    let control: ModelFailureRetryControl | null = null;

    function Consumer() {
      control = useModelFailureRetry({
        sessionId: 'session-1',
        history: [userEntry('user-1'), modelFailure('n-1')],
        canRetry: true,
        onRetry,
      });
      return null;
    }

    await act(async () => root.render(<Consumer />));
    expect(control).not.toBeNull();
    expect(control?.noticeId).toBe('n-1');
    // No automatic retry from the UI: the harness owns those.
    expect(resent).toEqual([]);
    expect(control?.pending).toBe(false);

    act(() => control?.retry());
    expect(control?.pending).toBe(true);
    expect(resent).toHaveLength(1);
    expect((resent[0] as { id: string }).id).toBe('user-1');

    await act(async () => release(true));
    expect(control?.pending).toBe(false);
  });

  it('does nothing while retries are gated off', async () => {
    const resent: unknown[] = [];
    let control: ModelFailureRetryControl | null = null;

    function Consumer() {
      control = useModelFailureRetry({
        sessionId: 'session-1',
        history: [userEntry('user-1'), modelFailure('n-1')],
        canRetry: false,
        onRetry: async (entry) => {
          resent.push(entry);
          return true;
        },
      });
      return null;
    }

    await act(async () => root.render(<Consumer />));
    expect(control?.canRetry).toBe(false);

    await act(async () => control?.retry());
    expect(resent).toEqual([]);
    expect(control?.pending).toBe(false);
  });

  it('becomes clickable again when the resend is not accepted', async () => {
    const resent: unknown[] = [];
    let control: ModelFailureRetryControl | null = null;

    function Consumer() {
      control = useModelFailureRetry({
        sessionId: 'session-1',
        history: [userEntry('user-1'), modelFailure('n-1')],
        canRetry: true,
        onRetry: async (entry) => {
          resent.push(entry);
          return false;
        },
      });
      return null;
    }

    await act(async () => root.render(<Consumer />));
    await act(async () => control?.retry());
    expect(resent).toHaveLength(1);
    expect(control?.pending).toBe(false);
    expect(control?.canRetry).toBe(true);
  });
});
