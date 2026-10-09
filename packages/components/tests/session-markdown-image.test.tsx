// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSessionRoomId, type SessionId } from '@molly/shared';
import type { WorkspaceRuntime } from '../src/atoms/runtime';
import { MarkdownRenderer } from '../src/components/ai-gui/markdown-renderer';
import { useSessionMarkdownImageResolver } from '../src/hooks/use-session-markdown-image';

type PreviewRequest = Parameters<WorkspaceRuntime['requestFilePreview']>;
type PreviewResult = Awaited<ReturnType<WorkspaceRuntime['requestFilePreview']>>;

const state = vi.hoisted(() => ({
  sessions: new Map<string, { machineId?: string; parentSessionId?: string }>(),
  request: undefined as PreviewRequest | undefined,
  result: undefined as PreviewResult | undefined,
  runtimeAvailable: true,
}));

vi.mock('../src/atoms/doc-meta', async () => {
  const { atom } = await import('jotai');
  return {
    sessionMetaAtomFamily: (roomId: string) => atom(() => state.sessions.get(roomId) ?? null),
  };
});

vi.mock('../src/atoms/runtime', async () => {
  const { atom } = await import('jotai');
  return {
    activeWorkspaceRuntimeAtom: atom(() =>
      state.runtimeAvailable
        ? {
            requestFilePreview: async (...request: PreviewRequest) => {
              state.request = request;
              if (!state.result) throw new Error('Preview result unavailable');
              return state.result;
            },
          }
        : null
    ),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const sessionId = 'session-artwork' as SessionId;
let root: Root | undefined;
let container: HTMLDivElement;

function SessionImage({
  sessionId: imageSessionId,
  href,
}: {
  sessionId?: SessionId;
  href: string;
}) {
  const resolveAgentImageUrl = useSessionMarkdownImageResolver(imageSessionId);
  return createElement(MarkdownRenderer, {
    text: `![Draft](${href})`,
    resolveAgentImageUrl,
  });
}

async function renderImage(href: string, imageSessionId: SessionId | undefined = sessionId) {
  await act(async () => {
    root?.render(
      createElement(
        Provider,
        null,
        createElement(SessionImage, { sessionId: imageSessionId, href })
      )
    );
  });
}

beforeEach(() => {
  state.sessions.clear();
  state.sessions.set(getSessionRoomId(sessionId), { machineId: 'machine-artwork' });
  state.request = undefined;
  state.runtimeAvailable = true;
  state.result = {
    status: 'resource',
    kind: 'binary',
    path: 'media/draft.png',
    external: false,
    sizeBytes: 128,
    url: 'molly-resource://file/opaque-draft',
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
});

it.each([
  { parentSessionId: undefined, ownerSessionId: 'session-artwork' },
  { parentSessionId: 'session-parent', ownerSessionId: 'session-parent' },
])('loads the image through its $ownerSessionId owner on the session machine', async (route) => {
  state.sessions.set(getSessionRoomId(sessionId), {
    machineId: 'machine-artwork',
    parentSessionId: route.parentSessionId,
  });

  await renderImage('sandbox:/workspace/artwork/media/draft.png');

  expect(state.request).toEqual([
    'machine-artwork',
    { sessionId, path: '/workspace/artwork/media/draft.png' },
    { ownerSessionId: route.ownerSessionId },
  ]);
  expect(container.querySelector('img')?.getAttribute('src')).toBe(
    'molly-resource://file/opaque-draft'
  );
});

it('reads file URLs through the same owning-session preview', async () => {
  await renderImage('file:///workspace/artwork/media/draft%20literal.png');

  expect(state.request).toEqual([
    'machine-artwork',
    { sessionId, path: '/workspace/artwork/media/draft literal.png' },
    { ownerSessionId: 'session-artwork' },
  ]);
  expect(container.querySelector('img')?.getAttribute('src')).toBe(
    'molly-resource://file/opaque-draft'
  );
});

it('decodes the Markdown path once before requesting the image resource', async () => {
  await renderImage('sandbox:/workspace/artwork/media/draft%20literal%2520name.png');

  expect(state.request?.[1]).toEqual({
    sessionId,
    path: '/workspace/artwork/media/draft literal%20name.png',
  });
  expect(container.querySelector('img')?.getAttribute('src')).toBe(
    'molly-resource://file/opaque-draft'
  );
});

it('shows the preview failure without falling back to a raw local image URL', async () => {
  state.result = {
    v: 3,
    status: 'error',
    code: 'path_not_allowed',
    message: 'Image is outside the workspace',
  };

  await renderImage('sandbox:/workspace/artwork/media/draft.png');

  expect(state.request?.[1].path).toBe('/workspace/artwork/media/draft.png');
  expect(container.textContent).toContain('Draft: Image is outside the workspace');
  expect(container.querySelector('img')).toBeNull();
});

it('cannot read an image without an owning session', async () => {
  await act(async () => {
    root?.render(
      createElement(Provider, null, createElement(SessionImage, { href: 'media/draft.png' }))
    );
  });

  expect(state.request).toBeUndefined();
  expect(container.textContent).toContain('Draft: Unable to load image');
  expect(container.querySelector('img')).toBeNull();
});

it.each(['metadata', 'runtime'])(
  'cannot read an image before its %s is available',
  async (missing) => {
    if (missing === 'metadata') state.sessions.clear();
    else state.runtimeAvailable = false;

    await renderImage('media/draft.png');

    expect(state.request).toBeUndefined();
    expect(container.textContent).toContain('Draft: Unable to load image');
    expect(container.querySelector('img')).toBeNull();
  }
);

it('does not render a nonbinary resource as an image', async () => {
  state.result = {
    status: 'resource',
    kind: 'text',
    path: 'media/draft.png',
    external: false,
    sizeBytes: 128,
    url: 'molly-resource://file/opaque-text',
  };

  await renderImage('media/draft.png');

  expect(state.request?.[1].path).toBe('media/draft.png');
  expect(container.textContent).toContain('Draft: Unable to load image');
  expect(container.querySelector('img')).toBeNull();
});
