// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionDoc, SessionId } from '@molly/shared';
import { FloatingPermissionRequest } from '../src/components/sessions/floating-permission-request';
import { initI18n } from '../src/i18n';

const responses = vi.hoisted(() => [] as unknown[]);
vi.mock('../src/hooks/use-permission-response', () => ({
  usePermissionResponse: () => ({
    isReady: true,
    respondToPermission: async (...args: unknown[]) => {
      responses.push(args);
    },
  }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const history = [
  {
    id: 'turn',
    $cid: 'turn',
    role: 'assistant',
    read: false,
    timestamp: '2026-09-19T00:00:00.000Z',
    fileDiff: [],
    items: [
      {
        type: 'tool_call',
        toolCallId: 'image',
        status: 'in_progress',
        permissionRequest: {
          requestId: 'request',
          options: [
            { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
          ],
        },
      },
    ],
  },
] as unknown as SessionDoc['history'];

describe('pending permission Stop', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    responses.length = 0;
    await initI18n('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const button = (name: string) =>
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent === name);
  const render = async (onStop?: () => Promise<void>, active = true, sessionHistory = history) => {
    await act(async () =>
      root.render(
        <FloatingPermissionRequest
          sessionId={'synthetic' as SessionId}
          sessionStatus={active ? { type: 'requestPermission' } : undefined}
          sessionHistory={sessionHistory}
          onStop={onStop}
        />
      )
    );
  };
  it('stops through the owner without approving or denying the pending tool', async () => {
    const release = Promise.withResolvers<void>();
    const actions: string[] = [];
    await render(async () => {
      actions.push('stop');
      await release.promise;
    });
    await act(async () => button('Stop')?.click());
    expect(actions).toEqual(['stop']);
    expect(responses).toEqual([]);
    expect(button('Stop')?.disabled).toBe(true);
    expect(button('Allow once')?.disabled).toBe(true);
    expect(button('Deny')?.disabled).toBe(true);
    await act(async () => release.resolve());
    expect(button('Stop')?.disabled).toBe(false);
    // Dispatch/presence settlement, not the click itself, removes the pending surface.
    expect(button('Allow once')).toBeDefined();
    await render(undefined, false);
    expect(container.textContent).toBe('');
  });
  it('leaves deny as a permission response and does not invoke Stop', async () => {
    const actions: string[] = [];
    await render(async () => {
      actions.push('stop');
    });
    await act(async () => button('Deny')?.click());
    expect(actions).toEqual([]);
    expect(responses).toEqual([
      ['synthetic', 'request', { outcome: 'selected', optionId: 'deny' }, { turnId: 'turn' }],
    ]);
  });
  it('preserves permission and permits explicit retry after a failed Stop request', async () => {
    await render(async () => {
      throw new Error('synthetic stop failure');
    });
    await act(async () => button('Stop')?.click());
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(button('Stop')?.disabled).toBe(false);
    expect(button('Allow once')?.disabled).toBe(false);
    expect(responses).toEqual([]);
  });
  it('keeps Stop available when a question replaces the composer', async () => {
    const askHistory = structuredClone(history);
    const tool = askHistory[0]!.items[0]!;
    if (tool.type !== 'tool_call' || !tool.permissionRequest) throw new Error('invalid fixture');
    tool.permissionRequest.options = [
      { optionId: 'answer', name: 'Submit answers', kind: 'allow_once' },
      { optionId: 'cancel', name: 'Cancel', kind: 'reject_once' },
    ];
    tool.permissionRequest._meta = {
      claudeCode: {
        requestType: 'askUserQuestion',
        askUserQuestion: {
          version: 1,
          allowCustomAnswer: true,
          questions: [
            {
              question: 'Choose a test color',
              header: 'Color',
              multiSelect: false,
              options: [{ label: 'Blue' }, { label: 'Orange' }],
            },
          ],
        },
      },
    };
    const actions: string[] = [];
    await render(
      async () => {
        actions.push('stop');
      },
      true,
      askHistory
    );
    expect(container.textContent).toContain('Choose a test color');
    await act(async () => button('Stop')?.click());
    expect(actions).toEqual(['stop']);
    expect(responses).toEqual([]);
  });
  it('does not expose Stop without a cancellable owner or active permission', async () => {
    await render();
    expect(button('Stop')).toBeUndefined();
    expect(button('Allow once')).toBeDefined();
    await render(async () => undefined, false);
    expect(button('Stop')).toBeUndefined();
  });
});
