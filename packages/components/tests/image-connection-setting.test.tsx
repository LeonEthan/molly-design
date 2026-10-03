// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CheckImageConnection,
  ProtectedImageConnection,
} from '@molly/shared/embedded-harness';

import en from '../../../locales/en.json';
import {
  ImageConnectionForm,
  ImageConnectionSetting,
  buildImageConnectionSave,
  createImageConnectionFormDraft,
  imageConnectionDraftIssues,
  type ImageConnectionFormDraft,
} from '../src/components/settings/image-connection-setting';
import { CONNECTION_CHECK_DELAY_MS } from '../src/components/settings/connection-check';
import { initI18n } from '../src/i18n';

const { imageIpc } = vi.hoisted(() => ({
  imageIpc: { getImageSnapshot: vi.fn(), saveImage: vi.fn(), checkImage: vi.fn() },
}));
vi.mock('../src/lib/electron-ipc-client', () => ({
  // Production returns a fresh proxy each time; do not mask unstable effect dependencies.
  getIpcServices: () => ({ modelConnections: imageIpc }),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/* Copy is asserted through the locale file rather than retyped, so a key that
   stops resolving (or a field that renders a raw key) fails here instead of
   drifting. `initI18n('en')` loads the same root locales the app ships. */
const copy = (key: keyof typeof en): string => en[key];

const STORED_KEY = 'sk-test-stored-placeholder-not-real';

const storedConnection = (
  overrides: Partial<ProtectedImageConnection> = {}
): ProtectedImageConnection => ({
  id: '00000000-0000-4000-8000-000000000001',
  revision: 3,
  enabled: true,
  baseUrl: 'https://api.openai.com/v1',
  hasApiKey: true,
  model: 'saved-custom-model',
  legacyHistoryMayContainKey: false,
  ...overrides,
});

const draftOf = (overrides: Partial<ImageConnectionFormDraft> = {}): ImageConnectionFormDraft => ({
  enabled: true,
  protocol: 'openai-images',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  clearApiKey: false,
  model: 'saved-custom-model',
  ...overrides,
});

describe('image connection form values', () => {
  it('requires an explicit model and never seeds a credential', () => {
    expect(createImageConnectionFormDraft(undefined)).toEqual({
      enabled: true,
      protocol: 'openai-images',
      baseUrl: '',
      apiKey: '',
      clearApiKey: false,
      model: '',
    });
    expect(createImageConnectionFormDraft(storedConnection()).apiKey).toBe('');
    expect(buildImageConnectionSave(draftOf({ model: '' }))).toBeUndefined();
  });
  it.each([
    'https://user:secret@images.example/v1',
    'https://images.example/v1?key=secret',
    'https://images.example/v1#fragment',
    'ftp://images.example/v1',
  ])('rejects unsafe endpoint %s', (baseUrl) => {
    expect(buildImageConnectionSave(draftOf({ baseUrl }))).toBeUndefined();
  });
  it('sends the CAS revision and leaves retention to the main vault', () => {
    const saved = buildImageConnectionSave(draftOf(), storedConnection());
    expect(saved?.expectedRevision).toBe(3);
    expect(saved?.apiKey).toBeUndefined();
    expect(
      buildImageConnectionSave(draftOf({ apiKey: '  synthetic-new  ' }), storedConnection())?.apiKey
    ).toBe('synthetic-new');
    expect(
      buildImageConnectionSave(draftOf({ clearApiKey: true }), storedConnection())?.clearApiKey
    ).toBe(true);
    expect(
      buildImageConnectionSave(draftOf({ clearApiKey: true, apiKey: 'synthetic' }))
    ).toBeUndefined();
  });
  it('saves the chosen protocol and reads a stored row without one as OpenAI Images', () => {
    expect(createImageConnectionFormDraft(storedConnection()).protocol).toBe('openai-images');
    expect(
      createImageConnectionFormDraft(storedConnection({ protocol: 'dashscope' })).protocol
    ).toBe('dashscope');
    expect(
      buildImageConnectionSave(
        draftOf({ protocol: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/api/v1' }),
        storedConnection()
      )?.protocol
    ).toBe('dashscope');
  });
  it('rejects missing or oversized model values', () => {
    expect(imageConnectionDraftIssues(draftOf({ model: ' ' })).model).toBe(true);
    expect(imageConnectionDraftIssues(draftOf({ model: 'a'.repeat(201) })).model).toBe(true);
    expect(buildImageConnectionSave(draftOf({ model: 'a'.repeat(201) }))).toBeUndefined();
  });
});

describe('ImageConnectionForm', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(async () => {
    await initI18n('en');
    // The Radix Switch measures itself; jsdom has no layout and no observer.
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = undefined;
    }
    container?.remove();
    container = undefined;
  });

  type FormProps = ComponentProps<typeof ImageConnectionForm>;

  const renderForm = async (props: Partial<FormProps> = {}): Promise<HTMLElement> => {
    await act(async () => {
      root?.render(
        createElement(ImageConnectionForm, {
          stored: undefined,
          onSave: () => undefined,
          onClearApiKey: () => undefined,
          ...props,
        })
      );
    });
    return container as HTMLElement;
  };

  const button = (view: HTMLElement, text: string): HTMLButtonElement => {
    const found = [...view.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === text
    );
    expect(found, `button "${text}"`).toBeDefined();
    return found as HTMLButtonElement;
  };

  /** The remove-key control is icon-only, so it is found by its label. */
  const removeKeyButton = (view: HTMLElement): HTMLButtonElement | null =>
    view.querySelector<HTMLButtonElement>(
      `button[aria-label="${copy('settings.imageConnection.removeApiKey')}"]`
    );

  const apiKeyInput = (view: HTMLElement): HTMLInputElement => {
    const input = view.querySelector<HTMLInputElement>('input[type="password"]');
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  };

  const typeInto = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  const click = async (target: HTMLElement) => {
    await act(async () => {
      target.click();
    });
  };

  it('keeps an unsaved draft on rerender and saves only a public CAS update', async () => {
    imageIpc.getImageSnapshot.mockImplementation(async () => ({
      connection: storedConnection({ legacyHistoryMayContainKey: true }),
    }));
    const writes: unknown[] = [];
    imageIpc.saveImage.mockImplementation(async (input: unknown) => {
      writes.push(input);
      return storedConnection({ revision: 4, model: 'explicit-new-model' });
    });
    await act(async () => {
      root?.render(createElement(ImageConnectionSetting));
    });
    const view = container as HTMLElement;
    expect(view.textContent).toContain(copy('settings.imageConnection.legacyHistoryWarning'));
    await click(button(view, copy('common.edit')));
    const model = view.querySelector<HTMLInputElement>('input[id$="-model"]')!;
    await typeInto(model, 'explicit-new-model');
    await act(async () => {
      root?.render(createElement(ImageConnectionSetting));
    });
    expect(model.value).toBe('explicit-new-model');
    await click(button(view, copy('common.save')));
    expect(writes).toEqual([
      {
        expectedRevision: 3,
        enabled: true,
        protocol: 'openai-images',
        baseUrl: 'https://api.openai.com/v1',
        model: 'explicit-new-model',
        clearApiKey: false,
      },
    ]);
    expect(view.querySelector('input[type="password"]')).toBeNull();
    expect(view.textContent).toContain('explicit-new-model');
  });

  it('renders a stored key as stored without ever showing it', async () => {
    const view = await renderForm({ stored: storedConnection() });
    const input = apiKeyInput(view);
    expect(input.value).toBe('');
    expect(input.getAttribute('placeholder')).toBe(
      copy('settings.imageConnection.apiKeyPlaceholderStored')
    );
    expect(view.textContent).toContain(copy('settings.imageConnection.apiKeyHintStored'));
    expect(view.textContent).not.toContain(STORED_KEY);
    expect(removeKeyButton(view)).not.toBeNull();
  });

  it('offers no remove action when nothing is stored', async () => {
    const view = await renderForm();
    expect(apiKeyInput(view).getAttribute('placeholder')).toBe('sk-...');
    expect(view.textContent).toContain(copy('settings.imageConnection.apiKeyHintNew'));
    expect(removeKeyButton(view)).toBeNull();
  });

  it('clears the stored key through its own action and through nothing else', async () => {
    const cleared: string[] = [];
    const saves: ImageConnectionFormDraft[] = [];
    const view = await renderForm({
      stored: storedConnection(),
      onClearApiKey: () => void cleared.push('cleared'),
      onSave: (draft) => void saves.push(draft),
    });

    await click(removeKeyButton(view) as HTMLElement);
    expect(cleared).toEqual(['cleared']);
    expect(apiKeyInput(view).value).toBe('');
    // Clearing alone writes nothing: the user still has to save, and that save
    // carries the removal rather than the stored key.
    expect(saves).toEqual([]);

    await click(button(view, copy('common.save')));
    expect(saves[0]).toMatchObject({ clearApiKey: true, apiKey: '' });
  });

  it('disables Save until the draft is valid and changed', async () => {
    const saves: ImageConnectionFormDraft[] = [];
    const view = await renderForm({
      stored: storedConnection(),
      onSave: (draft) => void saves.push(draft),
    });
    expect(button(view, copy('common.save')).disabled).toBe(true);

    const urlInput = view.querySelector<HTMLInputElement>('input[id$="-base-url"]') as HTMLElement;
    await typeInto(urlInput as HTMLInputElement, 'not a url');
    expect(button(view, copy('common.save')).disabled).toBe(true);
    expect(view.textContent).toContain(copy('settings.imageConnection.invalidBaseUrl'));

    await typeInto(urlInput as HTMLInputElement, 'https://images.example.com/v1');
    expect(button(view, copy('common.save')).disabled).toBe(true);
    await typeInto(apiKeyInput(view), 'synthetic-renewed-key');
    expect(button(view, copy('common.save')).disabled).toBe(false);

    await click(button(view, copy('common.save')));
    expect(saves[0]).toMatchObject({
      baseUrl: 'https://images.example.com/v1',
      apiKey: 'synthetic-renewed-key',
    });
  });

  describe('free check', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    const settle = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(CONNECTION_CHECK_DELAY_MS);
      });

    it('checks a typed key once it settles and offers the listed models', async () => {
      const requests: CheckImageConnection[] = [];
      const view = await renderForm({
        onCheck: async (input) => {
          requests.push(input);
          return { ok: true, models: ['gpt-image-2', 'dall-e-3', 'gpt-4.1'] };
        },
      });
      await typeInto(
        view.querySelector<HTMLInputElement>('input[id$="-base-url"]')!,
        'https://images.example.com/v1'
      );
      await typeInto(apiKeyInput(view), 'synthetic-typed-key');
      expect(requests).toEqual([]);
      await settle();
      expect(requests).toEqual([
        {
          protocol: 'openai-images',
          baseUrl: 'https://images.example.com/v1',
          apiKey: 'synthetic-typed-key',
        },
      ]);
      expect(view.textContent).toContain('Key works · 3 models on this account');
      await typeInto(view.querySelector<HTMLInputElement>('input[id$="-model"]')!, 'image');
      await click(button(view, 'gpt-image-2'));
      expect(view.querySelector<HTMLInputElement>('input[id$="-model"]')!.value).toBe(
        'gpt-image-2'
      );
      expect(view.textContent).toContain('Your service lists this model · 3 models available');
      await typeInto(view.querySelector<HTMLInputElement>('input[id$="-model"]')!, 'my-own-model');
      expect(view.textContent).toContain("Your service doesn't list this model.");
    });

    it('checks a saved key only against the address it was saved for', async () => {
      const requests: CheckImageConnection[] = [];
      const view = await renderForm({
        stored: storedConnection(),
        onCheck: async (input) => {
          requests.push(input);
          return { ok: false, reason: 'key_rejected', status: 401 };
        },
      });
      await settle();
      expect(requests).toEqual([
        { protocol: 'openai-images', baseUrl: 'https://api.openai.com/v1', expectedRevision: 3 },
      ]);
      expect(view.textContent).toContain('The provider rejected this key (401).');
      await typeInto(
        view.querySelector<HTMLInputElement>('input[id$="-base-url"]')!,
        'https://elsewhere.example.com/v1'
      );
      await settle();
      expect(requests).toHaveLength(1);
      expect(view.textContent).not.toContain('rejected');
    });

    it('never checks DashScope, whose every request is billed', async () => {
      const requests: CheckImageConnection[] = [];
      const view = await renderForm({
        stored: storedConnection({
          protocol: 'dashscope',
          baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
        }),
        onCheck: async (input) => {
          requests.push(input);
          return { ok: true };
        },
      });
      await settle();
      expect(requests).toEqual([]);
      expect(view.textContent).toContain(copy('settings.imageConnection.testUnsupportedDashscope'));
    });
  });

  it('locks every control while saving and reports the failure it got', async () => {
    const view = await renderForm({
      stored: storedConnection(),
      saving: true,
      saveError: 'local machine RPC is not available',
    });
    expect(button(view, copy('settings.imageConnection.saving')).disabled).toBe(true);
    // Every editable control locks, so an in-flight save cannot race an edit
    // that the read-back would then reset.
    for (const input of view.querySelectorAll('input')) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
    for (const radio of view.querySelectorAll('button[role="radio"]')) {
      expect(radio.hasAttribute('disabled')).toBe(true);
    }
    expect(removeKeyButton(view)?.disabled).toBe(true);
    expect(view.querySelector('[role="alert"]')?.textContent).toBe(
      copy('settings.imageConnection.saveFailed').replace(
        '{{message}}',
        'local machine RPC is not available'
      )
    );
  });

  it('switches the saved connection off and on in place without its key', async () => {
    let current = storedConnection();
    const writes: unknown[] = [];
    imageIpc.getImageSnapshot.mockImplementation(async () => ({ connection: current }));
    imageIpc.saveImage.mockImplementation(async (input: { enabled: boolean }) => {
      writes.push(input);
      current = { ...current, revision: current.revision + 1, enabled: input.enabled };
      return current;
    });
    await act(async () => {
      root?.render(createElement(ImageConnectionSetting));
    });
    const view = container as HTMLElement;
    const toggle = () =>
      view.querySelector<HTMLButtonElement>(
        `button[role="switch"][aria-label="${copy('settings.imageConnection.enabled')}"]`
      )!;
    await click(toggle());
    expect(writes).toEqual([
      {
        expectedRevision: 3,
        enabled: false,
        protocol: 'openai-images',
        baseUrl: 'https://api.openai.com/v1',
        model: 'saved-custom-model',
        clearApiKey: false,
      },
    ]);
    expect(toggle().getAttribute('aria-checked')).toBe('false');
  });

  it('cannot switch on a saved connection that has no key', async () => {
    imageIpc.getImageSnapshot.mockImplementation(async () => ({
      connection: storedConnection({ enabled: false, hasApiKey: false }),
    }));
    await act(async () => {
      root?.render(createElement(ImageConnectionSetting));
    });
    const view = container as HTMLElement;
    expect(view.querySelector<HTMLButtonElement>('button[role="switch"]')!.disabled).toBe(true);
    expect(view.textContent).toContain(copy('settings.readiness.keyMissing'));
  });
});
