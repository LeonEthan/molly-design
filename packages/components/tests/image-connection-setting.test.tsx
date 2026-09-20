// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProtectedImageConnection } from '@molly/shared/embedded-harness';

import en from '../../../locales/en.json';
import {
  ImageConnectionForm,
  ImageConnectionSetting,
  buildImageConnectionSave,
  createImageConnectionFormDraft,
  imageConnectionDraftIssues,
  type ImageConnectionFormDraft,
} from '../src/components/settings/image-connection-setting';
import { initI18n } from '../src/i18n';

const { imageIpc } = vi.hoisted(() => ({
  imageIpc: { getImageSnapshot: vi.fn(), saveImage: vi.fn(), testImage: vi.fn() },
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
          testState: { phase: 'idle' },
          onSave: () => undefined,
          onTest: () => undefined,
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
        baseUrl: 'https://api.openai.com/v1',
        model: 'explicit-new-model',
        clearApiKey: false,
      },
    ]);
    expect(apiKeyInput(view).value).toBe('');
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
    const onClearApiKey = vi.fn();
    const onSave = vi.fn();
    const view = await renderForm({ stored: storedConnection(), onClearApiKey, onSave });

    await click(removeKeyButton(view) as HTMLElement);
    expect(onClearApiKey).toHaveBeenCalledTimes(1);
    expect(apiKeyInput(view).value).toBe('');
    // Clearing alone writes nothing: the user still has to save, and that save
    // carries the removal rather than the stored key.
    expect(onSave).not.toHaveBeenCalled();

    await click(button(view, copy('common.save')));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ clearApiKey: true, apiKey: '' }));
  });

  it('disables Save until the draft is valid and changed', async () => {
    const onSave = vi.fn();
    const view = await renderForm({ stored: storedConnection(), onSave });
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
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://images.example.com/v1',
        apiKey: 'synthetic-renewed-key',
      })
    );
  });

  it('blocks the paid-path test until the saved connection is ready and clean', async () => {
    const onTest = vi.fn();
    const nothingStored = await renderForm({ onTest });
    expect(button(nothingStored, copy('settings.imageConnection.test')).disabled).toBe(true);
    expect(nothingStored.textContent).toContain(copy('settings.imageConnection.testNeedsSaved'));

    await act(async () => {
      root?.render(
        createElement(ImageConnectionForm, {
          stored: storedConnection({ enabled: false }),
          testState: { phase: 'idle' },
          onSave: () => undefined,
          onTest,
          onClearApiKey: () => undefined,
        })
      );
    });
    expect(button(container as HTMLElement, copy('settings.imageConnection.test')).disabled).toBe(
      true
    );
    expect((container as HTMLElement).textContent).toContain(
      copy('settings.imageConnection.testNeedsComplete')
    );

    await act(async () => {
      root?.render(
        createElement(ImageConnectionForm, {
          stored: storedConnection(),
          testState: { phase: 'idle' },
          onSave: () => undefined,
          onTest,
          onClearApiKey: () => undefined,
        })
      );
    });
    const clean = container as HTMLElement;
    expect(button(clean, copy('settings.imageConnection.test')).disabled).toBe(false);
    await click(button(clean, copy('settings.imageConnection.test')));
    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it('holds the test back while the draft has unsaved changes', async () => {
    const view = await renderForm({ stored: storedConnection() });
    const modelInput = view.querySelector<HTMLInputElement>('input[id$="-model"]')!;
    await typeInto(modelInput, 'gpt-image-3');
    expect(button(view, copy('settings.imageConnection.test')).disabled).toBe(true);
    expect(view.textContent).toContain(copy('settings.imageConnection.testNeedsSave'));
  });

  it('locks every control while saving and reports the failure it got', async () => {
    const view = await renderForm({
      stored: storedConnection(),
      saving: true,
      saveError: 'local machine RPC is not available',
    });
    expect(button(view, copy('settings.imageConnection.saving')).disabled).toBe(true);
    expect(button(view, copy('settings.imageConnection.test')).disabled).toBe(true);
    // Every editable control locks, so an in-flight save cannot race an edit
    // that the read-back would then reset.
    for (const input of view.querySelectorAll('input')) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
    expect(view.querySelector('button[role="switch"]')?.hasAttribute('disabled')).toBe(true);
    expect(removeKeyButton(view)?.disabled).toBe(true);
    expect(view.querySelector('[role="alert"]')?.textContent).toBe(
      copy('settings.imageConnection.saveFailed').replace(
        '{{message}}',
        'local machine RPC is not available'
      )
    );
  });

  it('reports the probe outcome and the readiness the tool gate follows', async () => {
    const view = await renderForm({
      stored: storedConnection(),
      testState: { phase: 'ok', modelCount: 12 },
    });
    expect(view.querySelector('[role="status"]')?.textContent).toBe(
      copy('settings.imageConnection.testOk').replace('{{modelCount}}', '12')
    );
    expect(view.textContent).toContain(copy('settings.imageConnection.statusReady'));

    const failed = await renderForm({
      stored: storedConnection({ hasApiKey: false }),
      testState: { phase: 'error', message: 'HTTP 401: invalid API key provided' },
    });
    expect(failed.querySelector('[role="alert"]')?.textContent).toBe(
      copy('settings.imageConnection.testFailed').replace(
        '{{message}}',
        'HTTP 401: invalid API key provided'
      )
    );
    expect(failed.textContent).toContain(copy('settings.imageConnection.statusNotReady'));
  });
});
