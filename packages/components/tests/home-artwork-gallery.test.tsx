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
        if (dataUrl === undefined) throw Error('No saved artwork');
        return dataUrl;
      },
    },
  }),
  onIpcEvent: (_channel: string, handler: (payload: { artworkId: string }) => void) => {
    ipc.handlers.add(handler);
    return () => ipc.handlers.delete(handler);
  },
}));

import { HomeArtworkGallery } from '../src/components/chat/home-artwork-gallery';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const items = [
  { sessionId: 's-poster', artworkId: 'poster', title: 'Poster', dateLabel: 'Oct 7' },
  { sessionId: 's-stopped', artworkId: 'stopped', title: 'Stopped run', dateLabel: 'Oct 6' },
];

describe('HomeArtworkGallery', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    container?.remove();
    ipc.cache.clear();
  });

  async function mount(limit = 24, shownItems = items) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        createElement(HomeArtworkGallery, {
          heading: 'Your work',
          limit,
          countLabel: (count: number, truncated: boolean) =>
            `${truncated ? 'latest ' : ''}${count} designs`,
          items: shownItems,
          onOpen: () => {},
        })
      )
    );
  }
  const titles = () =>
    [...(container?.querySelectorAll('button') ?? [])].map((card) =>
      card.textContent?.replace('Oct 7', '').replace('Oct 6', '')
    );
  const push = (artworkId: string) =>
    act(async () => {
      for (const handler of ipc.handlers) handler({ artworkId });
    });

  it('leaves out designs with nothing on the canvas and counts only what it shows', async () => {
    ipc.cache.set('poster', 'data:image/png;base64,AAAA');
    ipc.cache.set('stopped', '');
    await mount();
    expect(titles()).toEqual(['Poster']);
    expect(container?.textContent).toContain('1 designs');
  });

  it('brings a design back once something has been drawn on it', async () => {
    ipc.cache.set('poster', 'data:image/png;base64,AAAA');
    ipc.cache.set('stopped', '');
    await mount();
    ipc.cache.set('stopped', 'data:image/png;base64,BBBB');
    await push('stopped');
    expect(titles()).toEqual(['Poster', 'Stopped run']);
    expect(container?.textContent).toContain('2 designs');
  });

  it('applies the limit after blank designs are left out and says when it truncates', async () => {
    ipc.cache.set('limit-blank', '');
    ipc.cache.set('limit-second', 'data:image/png;base64,BBBB');
    ipc.cache.set('limit-third', 'data:image/png;base64,CCCC');
    await mount(1, [
      { sessionId: 's1', artworkId: 'limit-blank', title: 'Blank', dateLabel: 'Oct 7' },
      { sessionId: 's2', artworkId: 'limit-second', title: 'Second', dateLabel: 'Oct 6' },
      { sessionId: 's3', artworkId: 'limit-third', title: 'Third', dateLabel: 'Oct 5' },
    ]);
    expect(titles()).toEqual(['Second']);
    expect(container?.textContent).toContain('latest 1 designs');
  });
});
