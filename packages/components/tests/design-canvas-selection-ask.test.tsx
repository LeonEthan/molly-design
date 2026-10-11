// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignElementReference } from '@molly/shared/design-element-reference';

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => void>(),
}));

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ history: { location: { href: '/', state: {} }, replace() {} } }),
  useRouterState: ({ select }: { select: (state: { location: { state: object } }) => unknown }) =>
    select({ location: { state: {} } }),
  useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
    select({ pathname: '/local/sessions/design-session' }),
  useNavigate: () => async () => {},
  useBlocker: () => {},
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

vi.mock('../src/atoms', async () => {
  const { atom } = await import('jotai');
  return {
    ...(await import('../src/atoms/layout-state')),
    ...(await import('../src/atoms/sidebar-state')),
    userAtom: atom(null),
    currentWorkspaceIdAtom: atom('workspace'),
    WORKSPACE_FOCUS_SCOPES: { content: 'content' },
  };
});

vi.mock('../src/atoms/runtime', async () => ({
  activeWorkspaceRuntimeAtom: (await import('jotai')).atom(null),
}));

vi.mock('../src/atoms/local-probe', async () => ({
  localProbeResultAtom: (await import('jotai')).atom({ machineId: 'machine' }),
}));

vi.mock('../src/hooks/use-session-doc', () => ({
  useSessionDoc: () => ({ history: null, synced: false }),
}));

vi.mock('../src/lib/electron-ipc-client', () => ({
  onIpcEvent: (channel: string, handler: (event: unknown) => void) => {
    ipc.handlers.set(channel, handler);
    return () => ipc.handlers.delete(channel);
  },
  getIpcServices: () => ({
    design: {
      attach: async () => {},
      hide: async () => {},
      cover: async () => null,
      presentToolbar: async () => {},
      highlight: async () => {},
      hidePreview: async () => {},
      closePreview: async () => {},
      selectionSummary: async () => null,
      versions: async () => [],
      state: async () => ({ readonly: false, changed: false }),
    },
  }),
}));

import { DesignCanvas } from '../src/components/sessions/design-canvas';

const SESSION_ID = 'design-session';
const reference: DesignElementReference = {
  artworkId: SESSION_ID,
  baselineRevisionId: 'a'.repeat(64),
  elementIds: ['headline'],
};
let root: Root | undefined;
let container: HTMLDivElement;

async function mount(props: Partial<React.ComponentProps<typeof DesignCanvas>>) {
  root ??= createRoot(container);
  await act(async () => {
    root?.render(
      <Provider store={createStore()}>
        <DesignCanvas
          sessionId={SESSION_ID}
          active
          workspaceSlug="local"
          name="Synthetic"
          {...props}
        />
      </Provider>
    );
  });
}

async function emit(event: object) {
  await act(async () => {
    ipc.handlers.get('design.selectionAction')?.({ hostId: SESSION_ID, reference, ...event });
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  ipc.handlers.clear();
  vi.unstubAllGlobals();
});

describe('inline ask from the canvas selection', () => {
  it('sends the prompt with its captured reference as a turn', async () => {
    const sent: [DesignElementReference, string][] = [];
    const referenced: unknown[] = [];
    await mount({
      onSendSelection: async (target, prompt) => {
        sent.push([target, prompt]);
      },
      onReferenceSelection: (...args) => referenced.push(args),
    });
    await emit({ action: 'ask', prompt: 'Warmer headline', send: true });
    expect(sent).toEqual([[reference, 'Warmer headline']]);
    expect(referenced).toEqual([]);
  });

  it('only fills the composer draft when asked to add to chat', async () => {
    const sent: unknown[] = [];
    const referenced: unknown[] = [];
    await mount({
      onSendSelection: async (...args) => {
        sent.push(args);
      },
      onReferenceSelection: (...args) => referenced.push(args),
    });
    await emit({ action: 'ask', prompt: 'Warmer headline', send: false });
    expect(sent).toEqual([]);
    expect(referenced).toEqual([[reference, 'Warmer headline']]);
  });

  it('shows a send failure on the canvas', async () => {
    await mount({
      onSendSelection: async () => {
        throw Error('Open this artwork’s conversation before referencing elements');
      },
      onReferenceSelection: () => {},
    });
    await emit({ action: 'ask', prompt: 'Warmer headline', send: true });
    expect(container.textContent).toContain(
      'Open this artwork’s conversation before referencing elements'
    );
  });

  it('ignores asks for another artwork', async () => {
    const sent: unknown[] = [];
    await mount({
      onSendSelection: async (...args) => {
        sent.push(args);
      },
      onReferenceSelection: () => {},
    });
    await act(async () => {
      ipc.handlers.get('design.selectionAction')?.({
        hostId: SESSION_ID,
        reference: { ...reference, artworkId: 'other-artwork' },
        action: 'ask',
        prompt: 'Warmer headline',
        send: true,
      });
    });
    expect(sent).toEqual([]);
  });
});
