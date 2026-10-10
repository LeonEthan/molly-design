// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelChecklist } from '../src/components/settings/model-checklist';
import { initI18n } from '../src/i18n';

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  await initI18n('en');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const models = [
  { modelId: 'b-model', name: 'B', input: ['text'], contextWindow: 8192, thinking: ['off'] },
  { modelId: 'a-model', name: 'A', input: ['text'], contextWindow: 8192, thinking: ['off'] },
  { modelId: 'c-model', name: 'C', input: ['text'], contextWindow: 8192, thinking: ['off'] },
] as const;

describe('ModelChecklist', () => {
  it('keeps catalog order when nothing was listed for the key', async () => {
    await act(async () =>
      root.render(
        createElement(ModelChecklist, { models: [...models], selected: [], onChange: () => undefined })
      )
    );
    const ids = [...host.querySelectorAll('li label span.font-mono')].map((n) => n.textContent);
    expect(ids).toEqual(['b-model', 'a-model', 'c-model']);
  });

  it('floats models the provider listed for this key without selecting them', async () => {
    const changes: string[][] = [];
    await act(async () =>
      root.render(
        createElement(ModelChecklist, {
          models: [...models],
          selected: [],
          listed: new Set(['c-model']),
          onChange: (next) => changes.push(next),
        })
      )
    );
    const ids = [...host.querySelectorAll('li label span.font-mono')].map((n) => n.textContent);
    expect(ids).toEqual(['c-model', 'b-model', 'a-model']);
    expect(changes).toEqual([]);
  });
});
