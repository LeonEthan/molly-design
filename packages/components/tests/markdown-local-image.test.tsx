// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from '../src/components/ai-gui/markdown-renderer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function render(props: ComponentProps<typeof MarkdownRenderer>) {
  if (!container) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => root?.render(createElement(MarkdownRenderer, props)));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
});

it('renders an agent local image through the session file resource resolver', async () => {
  const paths: string[] = [];
  await render({
    text: [
      '![Draft](sandbox:/workspace/artwork/media/draft.png)',
      '![Preview](/workspace/artwork/preview.png)',
      '![Relative](media/detail.png)',
    ].join('\n\n'),
    resolveAgentImageUrl: async (path) => {
      paths.push(path);
      return `molly-resource://file/${encodeURIComponent(path)}`;
    },
  });
  expect(paths).toEqual([
    '/workspace/artwork/media/draft.png',
    '/workspace/artwork/preview.png',
    'media/detail.png',
  ]);
  expect([...container!.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual(
    paths.map((path) => `molly-resource://file/${encodeURIComponent(path)}`)
  );
});

it('shows a failed local read without giving the raw path to an image element', async () => {
  await render({
    text: '![Reference](sandbox:/workspace/missing.png)',
    resolveAgentImageUrl: async () => {
      throw new Error('File not found');
    },
  });
  expect(container?.textContent).toContain('Reference: File not found');
  expect(container?.querySelector('img')).toBeNull();
});

it('requires session resolution for local images but preserves ordinary remote images', async () => {
  await render({
    text: '![Local](sandbox:/workspace/draft.png)\n\n![Remote](https://example.com/image.png)',
  });
  expect(container?.textContent).toContain('Local: Unable to load image');
  expect([...container!.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual(
    ['https://example.com/image.png']
  );
});

it('ignores an old image read after the source or session resolver changes', async () => {
  const first = Promise.withResolvers<string>();
  const second = Promise.withResolvers<string>();
  const nextSession = Promise.withResolvers<string>();
  const resolveAgentImageUrl = (path: string) =>
    path.endsWith('first.png') ? first.promise : second.promise;
  await render({ text: '![Draft](media/first.png)', resolveAgentImageUrl });
  await render({ text: '![Draft](media/second.png)', resolveAgentImageUrl });
  await act(async () => first.resolve('molly-resource://file/old'));
  expect(container?.querySelector('img')).toBeNull();
  await act(async () => second.resolve('molly-resource://file/current'));
  expect(container?.querySelector('img')?.getAttribute('src')).toBe(
    'molly-resource://file/current'
  );
  await render({
    text: '![Draft](media/second.png)',
    resolveAgentImageUrl: () => nextSession.promise,
  });
  expect(container?.querySelector('img')).toBeNull();
  await act(async () => nextSession.resolve('molly-resource://file/next-session'));
  expect(container?.querySelector('img')?.getAttribute('src')).toBe(
    'molly-resource://file/next-session'
  );
});
