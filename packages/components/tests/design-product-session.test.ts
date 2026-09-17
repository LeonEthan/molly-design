// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProductSession } from '../../design-bento/src/product-session';

beforeEach(() => vi.stubGlobal('CSS', { escape: (value: string) => value }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  delete (window as unknown as { molly?: unknown }).molly;
});

it('publishes the complete generic canvas API at the real ready boundary', async () => {
  let resolveFonts!: () => void;
  const fontsReady = new Promise<void>((resolve) => {
    resolveFonts = resolve;
  });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: fontsReady } });
  const readyEvent = new Promise<void>((resolve) =>
    window.addEventListener('molly:ready', () => resolve(), { once: true })
  );
  createProductSession({
    sessionId: 'art',
    revisionId: 'old',
    snapshot: () => ({}),
    assets: () => ({}),
    setDirty: () => {},
    setReadonly: () => {},
    commitPending: () => {},
  });
  const api = (
    window as unknown as {
      molly: {
        setReadonly(value: boolean): void;
        state(): { ready: boolean };
        snapshot(): Promise<unknown>;
        flush(permit: string): Promise<{ ok: boolean }>;
      };
    }
  ).molly;
  expect(api.state().ready).toBe(false);
  expect([typeof api.setReadonly, typeof api.snapshot, typeof api.flush]).toEqual([
    'function',
    'function',
    'function',
  ]);
  resolveFonts();
  await readyEvent;
  expect(api.state().ready).toBe(true);
});

it('freezes semantic commands after committing buffered input and flushes without admitting new input', async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  let content = 'before',
    buffered = '',
    readonly = false;
  const saved: unknown[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    saved.push(JSON.parse(String(init.body)));
    return { ok: true, json: async () => ({ ok: true, revisionId: 'next' }) };
  });
  const session = createProductSession({
    sessionId: 'art',
    revisionId: 'old',
    snapshot: () => ({ content }),
    assets: () => ({}),
    setDirty: () => {},
    setReadonly: (value) => {
      readonly = value;
    },
    commitPending: () => {
      if (buffered && !readonly) {
        content = buffered;
        buffered = '';
        session.changed();
      }
    },
  });
  const api = (
    window as unknown as {
      molly: {
        setReadonly(value: boolean): void;
        state(): { dirty: boolean; readonly: boolean };
        flush(permit: string): Promise<{ ok: boolean }>;
        save(): Promise<{ ok: boolean }>;
      };
    }
  ).molly;
  expect(readonly).toBe(true);
  api.setReadonly(false);
  buffered = 'buffered human text';
  api.setReadonly(true);
  expect(content).toBe('buffered human text');
  expect(readonly).toBe(true);
  const input = new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: 'blocked' });
  document.dispatchEvent(input);
  expect(input.defaultPrevented).toBe(true);
  expect(await api.save()).toMatchObject({ ok: false });
  expect(await api.flush('one-save-permit')).toEqual({ ok: true });
  expect(saved).toEqual([
    {
      doc: { content: 'buffered human text' },
      assets: {},
      baseRevisionId: 'old',
      writePermit: 'one-save-permit',
    },
  ]);
  expect(api.state()).toMatchObject({ dirty: false, readonly: true });
  api.setReadonly(false);
  expect(readonly).toBe(false);
  buffered = 'unfinished composition';
  document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  api.setReadonly(true);
  expect(await api.flush('composition-permit')).toMatchObject({ ok: false });
  expect(buffered).toBe('unfinished composition');
  expect(content).toBe('buffered human text');
  api.setReadonly(false);
  document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  api.setReadonly(true);
  expect(content).toBe('unfinished composition');
  vi.stubGlobal('fetch', async () => ({
    ok: false,
    status: 500,
    json: async () => ({ ok: false, error: 'disk unavailable' }),
  }));
  expect(await api.flush('failed-save')).toMatchObject({ ok: false });
  expect(api.state()).toMatchObject({ dirty: true, readonly: true });
  expect(content).toBe('unfinished composition');
});

it('rejects a delayed command or capture after selection changes, including returning to the same ID', async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  const values: Record<string, number> = { a: 10, b: 20 };
  let selected = 'a';
  const session = createProductSession({
    sessionId: 'art',
    revisionId: 'old',
    snapshot: () => values,
    assets: () => ({}),
    setDirty: () => {},
    setReadonly: () => {},
    commitPending: () => {},
    pickImageFile: () => {},
    applyCommands: () => {
      values[selected] = 99;
      return { ok: true, applied: 1 };
    },
  });
  const api = (
    window as unknown as {
      molly: {
        setReadonly(value: boolean): void;
        selection(epoch?: number): unknown;
        applyCommands(input: unknown, epoch?: number): { ok: boolean };
      };
    }
  ).molly;
  api.setReadonly(false);
  session.selection([{ id: 'a' }], { count: 1, kinds: ['shape'] });
  selected = 'b';
  session.selection([{ id: 'b' }], { count: 1, kinds: ['shape'] });
  expect(api.applyCommands({ verb: 'fill', fill: '#ffffff' }, 1).ok).toBe(false);
  expect(() => api.selection(1)).toThrow('Selection changed');
  selected = 'a';
  session.selection([{ id: 'a' }], { count: 1, kinds: ['shape'] });
  expect(api.applyCommands({ verb: 'fill', fill: '#ffffff' }, 1).ok).toBe(false);
  expect(values).toEqual({ a: 10, b: 20 });
  expect(api.applyCommands({ verb: 'fill', fill: '#ffffff' }, 3).ok).toBe(true);
  expect(values).toEqual({ a: 99, b: 20 });
  window.dispatchEvent(new Event('pagehide'));
});

it('reports the saved selection again after autosave so passive mirroring needs no freeze', async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  let api: { setReadonly(value: boolean): void; state(): { dirty: boolean; revisionId: string } };
  const reports: { dirty: boolean; revisionId: string }[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/selection')) reports.push(api.state());
    return { ok: true, json: async () => ({ ok: true, revisionId: 'saved' }) };
  });
  const session = createProductSession({
    sessionId: 'art',
    revisionId: 'old',
    snapshot: () => ({}),
    assets: () => ({}),
    setDirty: () => {},
    setReadonly: () => {},
    commitPending: () => {},
    pickImageFile: () => {},
    applyCommands: () => ({ ok: true }),
  });
  api = (window as unknown as { molly: typeof api }).molly;
  api.setReadonly(false);
  session.selection([{ id: 'a' }], { count: 1, kinds: ['shape'] });
  session.changed();
  await vi.advanceTimersByTimeAsync(150);
  expect(reports.at(-1)).toMatchObject({ dirty: true, revisionId: 'old' });
  await vi.advanceTimersByTimeAsync(500);
  expect(reports.at(-1)).toMatchObject({ dirty: false, revisionId: 'saved' });
  window.dispatchEvent(new Event('pagehide'));
});
