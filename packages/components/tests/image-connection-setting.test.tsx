// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_CONNECTION_VERSION, type ImageConnectionSettings } from '@molly/shared';

import en from '../../../locales/en.json';
import {
  ImageConnectionForm,
  buildImageConnectionSettings,
  createImageConnectionFormDraft,
  imageConnectionDraftIssues,
  resolveImageConnectionApiKey,
  type ImageConnectionFormDraft,
} from '../src/components/settings/image-connection-setting';
import { initI18n } from '../src/i18n';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/* Copy is asserted through the locale file rather than retyped, so a key that
   stops resolving (or a field that renders a raw key) fails here instead of
   drifting. `initI18n('en')` loads the same root locales the app ships. */
const copy = (key: keyof typeof en): string => en[key];

const STORED_KEY = 'sk-test-stored-placeholder-not-real';
const NOW_MS = 1_700_000_000_000;

const storedConnection = (
  overrides: Partial<ImageConnectionSettings> = {}
): ImageConnectionSettings => ({
  v: IMAGE_CONNECTION_VERSION,
  enabled: true,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: STORED_KEY,
  model: 'saved-custom-model',
  updatedAt: NOW_MS,
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
  it('requires a user-selected model for a new connection', () => {
    const draft = createImageConnectionFormDraft(undefined);
    expect(draft).toEqual({
      enabled: true,
      baseUrl: '',
      apiKey: '',
      clearApiKey: false,
      model: '',
    });
    expect(imageConnectionDraftIssues(draft).model).toBe(true);
    expect(
      buildImageConnectionSettings(
        { ...draft, baseUrl: 'https://images.example/v1', apiKey: 'synthetic' },
        undefined,
        NOW_MS
      )
    ).toBeUndefined();
  });

  it.each([
    'https://user:secret@images.example/v1',
    'https://images.example/v1?key=secret',
    'https://images.example/v1#fragment',
    'ftp://images.example/v1',
  ])('rejects an unusable endpoint in the form before save: %s', (baseUrl) => {
    expect(imageConnectionDraftIssues(draftOf({ baseUrl })).baseUrl).toBe(true);
    expect(buildImageConnectionSettings(draftOf({ baseUrl }), undefined, NOW_MS)).toBeUndefined();
  });

  it('rejects model names longer than the stored connection permits', () => {
    expect(imageConnectionDraftIssues(draftOf({ model: 'a'.repeat(201) })).model).toBe(true);
  });

  it('never seeds the draft with the stored key', () => {
    const draft = createImageConnectionFormDraft(storedConnection());
    expect(draft.apiKey).toBe('');
    expect(draft.baseUrl).toBe('https://api.openai.com/v1');
    expect(draft.model).toBe('saved-custom-model');
  });

  it('keeps the stored key unless the draft replaces or clears it', () => {
    const stored = storedConnection();
    expect(resolveImageConnectionApiKey(draftOf(), stored)).toBe(STORED_KEY);
    expect(resolveImageConnectionApiKey(draftOf({ apiKey: '  sk-new  ' }), stored)).toBe('sk-new');
    expect(resolveImageConnectionApiKey(draftOf({ apiKey: '' }), stored)).toBe(STORED_KEY);
    expect(resolveImageConnectionApiKey(draftOf({ clearApiKey: true }), stored)).toBe('');
    // An explicit clear wins even if the field still holds text.
    expect(
      resolveImageConnectionApiKey(draftOf({ apiKey: 'sk-new', clearApiKey: true }), stored)
    ).toBe('');
    expect(resolveImageConnectionApiKey(draftOf(), undefined)).toBe('');
  });

  it('builds a storable row, and refuses one the reader would reject', () => {
    const built = buildImageConnectionSettings(
      draftOf({ apiKey: 'sk-new', enabled: false }),
      storedConnection(),
      NOW_MS
    );
    expect(built).toEqual({
      v: IMAGE_CONNECTION_VERSION,
      enabled: false,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-new',
      model: 'saved-custom-model',
      updatedAt: NOW_MS,
    });

    // `http://user:pass@host` would store a second secret in a shown field.
    expect(
      buildImageConnectionSettings(
        draftOf({ baseUrl: 'https://user:pass@api.openai.com/v1' }),
        undefined,
        NOW_MS
      )
    ).toBeUndefined();
    expect(
      buildImageConnectionSettings(draftOf({ baseUrl: 'ftp://api.openai.com' }), undefined, NOW_MS)
    ).toBeUndefined();
    expect(
      buildImageConnectionSettings(draftOf({ model: '   ' }), undefined, NOW_MS)
    ).toBeUndefined();
  });

  it('flags exactly the fields that stop a save', () => {
    expect(imageConnectionDraftIssues(draftOf())).toEqual({ baseUrl: false, model: false });
    expect(imageConnectionDraftIssues(draftOf({ baseUrl: '' }))).toEqual({
      baseUrl: true,
      model: false,
    });
    expect(imageConnectionDraftIssues(draftOf({ model: ' ' }))).toEqual({
      baseUrl: false,
      model: true,
    });
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
    expect(button(view, copy('common.save')).disabled).toBe(false);

    await click(button(view, copy('common.save')));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://images.example.com/v1', apiKey: '' })
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
      stored: storedConnection({ apiKey: '' }),
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
