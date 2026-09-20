// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DesignContinuationPreparationResultSchema,
  buildDesignContinuationPublication,
} from '@molly/shared';
import { DesignContinuationDialog } from '../src/components/sessions/design-continuation-dialog';
import { activeWorkspaceRuntimeAtom } from '../src/atoms/runtime';
import { userAtom } from '../src/atoms';
import { initI18n } from '../src/i18n';
import en from '../../../locales/en.json';

vi.mock('../src/atoms/runtime', async () => {
  const { atom } = await import('jotai');
  return { activeWorkspaceRuntimeAtom: atom(null) };
});
vi.mock('../src/atoms', async () => {
  const { atom } = await import('jotai');
  return { userAtom: atom(null) };
});

const result = () =>
  DesignContinuationPreparationResultSchema.parse({
    type: 'session/design-continuation-prepare',
    record: {
      version: 1,
      workspaceId: 'workspace-1',
      source: {
        id: 'source',
        machineId: 'machine-1',
        userId: 'local:user',
        cliType: 'builtin',
        agentType: 'codex',
        design: { artworkId: 'artwork', path: 'design.json' },
      },
      target: {
        sessionId: '00000000-0000-4000-8000-000000000001',
        agentConfigId: 'molly-config',
        createdAt: '2026-09-20T00:00:00.000Z',
      },
      reference: {
        version: 1,
        source: { sessionId: 'source', artworkId: 'artwork', machineId: 'machine-1' },
        messages: [
          {
            sourceTurnId: 'old-turn',
            role: 'user',
            text: '<img src=x onerror="alert(1)"> Synthetic historical context',
            truncated: true,
          },
        ],
        attachmentCandidates: [],
        omitted: { turns: 4, items: 3, attachments: 2 },
      },
    },
    attachments: [],
  });
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
function button(key: keyof typeof en) {
  return [...document.querySelectorAll('button')].find((el) => el.textContent === en[key])!;
}
async function click(key: keyof typeof en) {
  await act(async () => button(key).click());
}
async function choose() {
  await act(async () => {
    const select = document.querySelector('select')!;
    select.value = 'molly-config';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(prepare: () => Promise<ReturnType<typeof result>> = async () => result()) {
  const store = createStore();
  const events: string[] = [];
  const runtime = {
    workspaceId: 'workspace-1',
    requestDesignContinuationPreparation: prepare,
    writer: {
      publishDesignContinuation: async (
        record: ReturnType<typeof result>['record'],
        identity: { signal: AbortSignal }
      ) => {
        identity.signal.throwIfAborted();
        events.push('published');
        return buildDesignContinuationPublication(record);
      },
    },
  };
  store.set(activeWorkspaceRuntimeAtom as never, runtime as never);
  store.set(userAtom as never, { id: 'local:user' } as never);
  await act(async () =>
    root.render(
      <Provider store={store}>
        <DesignContinuationDialog
          source={result().record.source as never}
          configs={[
            {
              id: 'molly-config',
              name: 'Molly',
              machineId: 'machine-1',
              cliType: 'builtin',
              agentType: 'molly',
              env: {},
            } as never,
          ]}
          onClose={() => {
            events.push('closed');
          }}
          onPublished={() => {
            events.push('navigated');
          }}
        />
      </Provider>
    )
  );
  return { store, events };
}

describe('explicit design continuation dialog', () => {
  it('requires selection, previews text literally, and publishes only after confirmation', async () => {
    const f = await fixture();
    expect(button('design.continuation.prepare').disabled).toBe(true);
    expect(f.events).toEqual([]);
    await choose();
    await click('design.continuation.prepare');
    expect(f.events).toEqual([]);
    expect(document.querySelector('pre')?.textContent).toContain('<img src=x');
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain(en['design.continuation.nextStep']);
    await click('design.continuation.confirm');
    expect(f.events).toEqual(['published', 'navigated']);
  });

  it('requires renewed review when the confirmed preview differs', async () => {
    let prepared = result();
    const f = await fixture(async () => prepared);
    await choose();
    await click('design.continuation.prepare');
    prepared = result();
    prepared.record.reference.messages[0].text = 'Updated reference';
    await click('design.continuation.confirm');
    expect(f.events).toEqual([]);
    expect(document.querySelector('[role=alert]')?.textContent).toBe(
      en['design.continuation.changed']
    );
    expect(document.querySelector('pre')?.textContent).toBe('Updated reference');
    await click('design.continuation.confirm');
    expect(f.events).toEqual(['published', 'navigated']);
  });

  it.each(['close', 'workspace', 'unmount'] as const)(
    'ignores an in-flight preparation after %s',
    async (action) => {
      let pending = false;
      const deferredResult = deferred<ReturnType<typeof result>>();
      const f = await fixture(async () => (pending ? deferredResult.promise : result()));
      await choose();
      await click('design.continuation.prepare');
      pending = true;
      await click('design.continuation.confirm');
      if (action === 'close') await click('common.cancel');
      if (action === 'workspace')
        await act(async () => {
          f.store.set(activeWorkspaceRuntimeAtom as never, null as never);
        });
      if (action === 'unmount') await act(async () => root.render(null));
      await act(async () => deferredResult.resolve(result()));
      expect(f.events).toEqual(action === 'close' ? ['closed'] : []);
    }
  );

  it('reports a fixed error without exposing raw provider text or automatically retrying', async () => {
    const f = await fixture(async () => {
      throw new Error('synthetic-private-diagnostic');
    });
    await choose();
    await click('design.continuation.prepare');
    expect(document.querySelector('[role=alert]')?.textContent).toBe(
      en['design.continuation.failed']
    );
    expect(document.body.textContent).not.toContain('synthetic-private-diagnostic');
    expect(f.events).toEqual([]);
    expect(button('design.continuation.prepare').disabled).toBe(false);
  });
});
