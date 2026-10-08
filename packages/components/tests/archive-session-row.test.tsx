// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionId, SessionMeta } from '@molly/shared';

const ipc = vi.hoisted(() => ({ cache: new Map<string, string>() }));
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
  onIpcEvent: () => () => {},
}));

import { TooltipProvider } from '../src/ui/tooltip';
import {
  ArchivedSessionGroupSection,
  type ArchivedSessionGroup,
} from '../src/components/archive/archive-view';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function archivedSession(overrides: Record<string, unknown>): SessionMeta {
  return {
    id: 'archive-row-a',
    title: 'Poster',
    lastMessageAt: Date.parse('2026-10-06T00:00:00Z'),
    branchName: 'feature/coding-branch',
    diffStats: { allChange: { add: 12, del: 3 } },
    pullRequests: [{ url: 'https://github.com/acme/app/pull/7', status: 'open' }],
    ...overrides,
  } as unknown as SessionMeta;
}

describe('ArchivedSessionGroupSection', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    container?.remove();
    ipc.cache.clear();
  });

  async function mount(group: ArchivedSessionGroup, hideGroupHeader: boolean) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        createElement(
          TooltipProvider,
          null,
          createElement(ArchivedSessionGroupSection, {
            group,
            now: new Date('2026-10-07T00:00:00Z'),
            onRestore: () => {},
            onDelete: () => {},
            onNavigate: () => {},
            onToggleCollapse: () => {},
            restoreLabel: 'Restore',
            restoreUnavailableLabel: 'Unavailable',
            removedProjectLabel: 'Removed',
            deleteLabel: 'Delete',
            chatLabel: 'Designs',
            isMultiSelectMode: false,
            selectedIds: new Set<SessionId>(),
            onToggleSelect: () => {},
            onToggleGroupSelect: () => {},
            onEnterMultiSelect: () => {},
            hideGroupHeader,
          })
        )
      )
    );
  }

  it('shows a design thumbnail and the title, without coding metadata', async () => {
    ipc.cache.set('archive-art', 'data:image/png;base64,AAAA');
    await mount(
      {
        key: '__chats__',
        kind: 'chat',
        label: 'Chats',
        collapsed: false,
        sessions: [archivedSession({ design: { artworkId: 'archive-art' } })],
      },
      true
    );
    const text = container?.textContent ?? '';
    expect(text).toContain('Poster');
    expect(text).not.toContain('feature/coding-branch');
    expect(text).not.toContain('+12');
    expect(container?.querySelector('a, [href*="github"]')).toBeNull();
    expect(container?.querySelector('[data-session-row-thumbnail] img')?.getAttribute('src')).toBe(
      'data:image/png;base64,AAAA'
    );
  });

  it('names a project group without printing its folder path', async () => {
    await mount(
      {
        key: 'local:m:p',
        kind: 'local',
        label: 'molly-test',
        local: {
          name: 'molly-test',
          path: '/Users/designer/projects/molly-test',
          available: true,
        },
        collapsed: false,
        sessions: [archivedSession({ id: 'archive-row-b' })],
      },
      false
    );
    const text = container?.textContent ?? '';
    expect(text).toContain('molly-test');
    expect(text).not.toContain('/Users/designer');
  });
});
