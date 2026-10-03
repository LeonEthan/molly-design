// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({
  cache: new Map<string, string>(),
  handlers: new Set<(payload: { artworkId: string }) => void>(),
}));
vi.mock('../src/lib/electron-ipc-client', () => ({
  getIpcServices: () => ({
    design: {
      thumbnail: async (artworkId: string) => {
        const dataUrl = ipc.cache.get(artworkId);
        if (!dataUrl) throw Error('No saved artwork');
        return dataUrl;
      },
    },
  }),
  onIpcEvent: (_channel: string, handler: (payload: { artworkId: string }) => void) => {
    ipc.handlers.add(handler);
    return () => ipc.handlers.delete(handler);
  },
}));

import { useDesignThumbnail } from '../src/hooks/use-design-thumbnail';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Row({ artworkId }: { artworkId: string }) {
  const src = useDesignThumbnail(artworkId);
  return createElement('img', { 'data-src': src ?? '' });
}

describe('useDesignThumbnail', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    container?.remove();
  });

  async function mount(artworkId: string) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(Row, { artworkId })));
  }
  async function unmount() {
    await act(async () => root?.unmount());
    root = undefined;
  }
  const shown = () => container?.querySelector('img')?.getAttribute('data-src');
  const push = (artworkId: string) =>
    act(async () => {
      for (const handler of ipc.handlers) handler({ artworkId });
    });

  it('updates a mounted row when Electron refreshes its artwork', async () => {
    ipc.cache.set('mounted', 'data:v1');
    await mount('mounted');
    expect(shown()).toBe('data:v1');
    ipc.cache.set('mounted', 'data:v2');
    await push('mounted');
    expect(shown()).toBe('data:v2');
  });

  it('keeps a refresh that arrives while the sidebar row is unmounted', async () => {
    ipc.cache.set('hidden', 'data:blank');
    await mount('hidden');
    expect(shown()).toBe('data:blank');
    await unmount();
    ipc.cache.set('hidden', 'data:after-turn');
    await push('hidden');
    await mount('hidden');
    expect(shown()).toBe('data:after-turn');
  });
});
