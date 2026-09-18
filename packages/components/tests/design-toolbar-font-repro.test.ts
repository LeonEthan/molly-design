// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProductSession } from '../../design-bento/src/product-session';

beforeEach(() => vi.stubGlobal('CSS', { escape: (value: string) => value }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.head.replaceChildren();
  delete (window as unknown as { molly?: unknown }).molly;
});

it('opens the font-family popup when its trigger is clicked', async () => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  const toolbars: unknown[] = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (init?.body) toolbars.push(JSON.parse(String(init.body)));
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const requests: unknown[] = [];
  const session = createProductSession({
    sessionId: 'art',
    revisionId: 'old',
    snapshot: () => ({}),
    assets: () => ({}),
    setDirty: () => {},
    setReadonly: () => {},
    commitPending: () => {},
    applyCommands: (input: unknown) => {
      requests.push(input);
      return { ok: true, applied: 1 };
    },
  });
  const api = (
    window as unknown as {
      molly: {
        setReadonly(value: boolean): void;
        presentToolbar(value: unknown): void;
      };
    }
  ).molly;
  api.setReadonly(false);
  api.presentToolbar({ dark: false, actionsEnabled: true, labels: {} });
  session.selection(
    [{ id: 'a' }],
    {
      count: 1,
      kinds: ['text'],
      fonts: ['Inter'],
      elements: [{ id: 'a', kind: 'text', fontFamily: 'Inter', fontSize: 20 }],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    1 as any
  );
  // Flush the pending rAF positioning while the CSS stub is still installed.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const trigger = document.querySelector<HTMLButtonElement>(
    '[data-molly-toolbar=""].molly-selection-toolbar button[aria-label="Font"]'
  );
  expect(trigger).toBeTruthy();
  expect(trigger!.textContent).toContain('Inter');
  trigger!.click();
  const popup = document.querySelector('.molly-selection-popup');
  expect(popup).toBeTruthy();
  expect(popup!.querySelectorAll('button').length).toBe(1);
  popup!.querySelector<HTMLButtonElement>('button')!.click();
  expect(requests).toEqual([]);
  expect(toolbars).toEqual([
    { type: 'command', selectionEpoch: 1, command: { verb: 'text-style', fontFamily: 'Inter' } },
  ]);
  window.dispatchEvent(new Event('pagehide'));
  await new Promise((resolve) => setTimeout(resolve, 30));
});
