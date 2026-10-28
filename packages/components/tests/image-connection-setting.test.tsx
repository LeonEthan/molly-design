// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Provider, createStore } from 'jotai';
import type {
  CheckImageConnection,
  ProtectedImageConnection,
} from '@molly/shared/embedded-harness';

import en from '../../../locales/en.json';
import zh from '../../../locales/zh_CN.json';
import { imageKeyMigrationNoticeDismissedAtom } from '../src/atoms/settings';
import { mollyStorage } from '../src/lib/product-storage';
import {
  ImageConnectionForm,
  ImageConnectionSetting,
  applyImageProtocolChoice,
  buildImageConnectionSave,
  addressForTypedKey,
  applyImageAddressEdit,
  commitImageAddress,
  createImageConnectionFormDraft,
  imageConnectionCanSave,
  imageConnectionCheckMessageKey,
  imageConnectionDraftIssues,
  imageConnectionUsesStoredKey,
  typedKeyMatchesAddress,
  type ImageConnectionFormDraft,
} from '../src/components/settings/image-connection-setting';
import { CONNECTION_CHECK_DELAY_MS } from '../src/components/settings/connection-check';
import { initI18n } from '../src/i18n';

const { imageIpc } = vi.hoisted(() => ({
  imageIpc: {
    getImageSnapshot: vi.fn(),
    saveImage: vi.fn(),
    checkImage: vi.fn(),
    deleteImage: vi.fn(),
  },
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
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      clearApiKey: false,
      model: '',
    });
    expect(createImageConnectionFormDraft(storedConnection()).baseUrl).toBe(
      'https://api.openai.com/v1'
    );
    expect(createImageConnectionFormDraft(storedConnection()).apiKey).toBe('');
    expect(buildImageConnectionSave(draftOf({ model: '' }))).toBeUndefined();
  });
  it.each([
    'https://user:secret@images.example/v1',
    'https://images.example/v1?key=secret',
    'https://images.example/v1#fragment',
    'ftp://images.example/v1',
    'http://images.example.invalid/v1',
    'http://image-gateway.local/v1',
    'http://100.64.0.1/v1',
    'http://169.254.1.1/v1',
    'http://[fe80::1]/v1',
    'http://[fd00::1]:8080/v1',
    'http://10.1/v1',
    'http://0x0a000001/v1',
  ])('rejects unsafe endpoint %s', (baseUrl) => {
    expect(imageConnectionDraftIssues(draftOf({ baseUrl })).baseUrl).toBe(true);
    expect(buildImageConnectionSave(draftOf({ baseUrl }))).toBeUndefined();
  });
  it.each([
    'https://images.example.invalid/v1',
    'http://127.0.0.1:8080/v1',
    'http://10.0.0.1:8080/v1',
    'http://172.16.0.1/v1',
    'http://192.168.0.1/v1',
    'http://[::1]:8080/v1',
  ])('uses the same endpoint validation for the draft and save: %s', (baseUrl) => {
    const draft = draftOf({ baseUrl, apiKey: 'synthetic-renewed-key' });
    expect(imageConnectionDraftIssues(draft).baseUrl).toBe(false);
    expect(buildImageConnectionSave(draft, storedConnection())).toEqual({
      expectedRevision: 3,
      enabled: true,
      protocol: 'openai-images',
      baseUrl,
      model: 'saved-custom-model',
      apiKey: 'synthetic-renewed-key',
      clearApiKey: false,
    });
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
  it('follows an unedited default and preserves a custom address when the protocol changes', () => {
    expect(
      applyImageProtocolChoice(createImageConnectionFormDraft(undefined), 'dashscope')
    ).toEqual({
      enabled: true,
      protocol: 'dashscope',
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      apiKey: '',
      clearApiKey: false,
      model: '',
    });
    expect(
      applyImageProtocolChoice(
        draftOf({ baseUrl: 'https://images.example/v1', apiKey: 'synthetic' }),
        'dashscope'
      )
    ).toMatchObject({
      protocol: 'dashscope',
      baseUrl: 'https://images.example/v1',
      apiKey: '',
      model: '',
    });
    expect(
      applyImageProtocolChoice(draftOf({ protocol: 'dashscope', apiKey: 'synthetic' }), 'dashscope')
        .apiKey
    ).toBe('synthetic');
    const url = 'https://images.example.com/v1';
    let bound = addressForTypedKey(null, '');
    expect(bound).toBe('');
    for (let index = 1; index <= url.length; index += 1) {
      const edited = applyImageAddressEdit(bound, url.slice(0, index));
      expect(edited.clearTypedKey).toBe(false);
      bound = edited.addressWhenKeyTyped ?? '';
    }
    expect(typedKeyMatchesAddress(bound, 'https://i')).toBe(false);
    expect(typedKeyMatchesAddress(bound, url)).toBe(false);
    bound = commitImageAddress(bound, url) ?? '';
    expect(typedKeyMatchesAddress(bound, url)).toBe(true);
    expect(applyImageAddressEdit(bound, 'https://elsewhere.example.com/v1').clearTypedKey).toBe(
      true
    );
    expect(addressForTypedKey(null, url)).toBe(url);
    expect(imageConnectionCanSave(draftOf({ apiKey: 'synthetic' }), undefined)).toBe(true);
    expect(imageConnectionCanSave(draftOf({ apiKey: '' }), undefined)).toBe(false);
    expect(imageConnectionCanSave(draftOf({ apiKey: '' }), storedConnection())).toBe(true);
    expect(
      imageConnectionCanSave(
        draftOf({ apiKey: '', baseUrl: 'https://elsewhere.example/v1' }),
        storedConnection()
      )
    ).toBe(false);
    expect(imageConnectionCanSave(draftOf({ clearApiKey: true }), storedConnection())).toBe(true);
    expect(imageConnectionCanSave(draftOf({ clearApiKey: true }), undefined)).toBe(false);
    expect(createImageConnectionFormDraft(storedConnection()).baseUrl).toBe(
      storedConnection().baseUrl
    );
    const dashscope = storedConnection({
      protocol: 'dashscope',
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    });
    expect(imageConnectionUsesStoredKey(createImageConnectionFormDraft(dashscope), dashscope)).toBe(
      true
    );
    expect(
      imageConnectionUsesStoredKey(
        applyImageProtocolChoice(createImageConnectionFormDraft(dashscope), 'openai-images'),
        dashscope
      )
    ).toBe(false);
  });
  it('maps image check failures to the #188 sentences', () => {
    expect(imageConnectionCheckMessageKey({ ok: false, reason: 'key_rejected', status: 401 })).toBe(
      'settings.imageConnection.check.keyRejected'
    );
    expect(imageConnectionCheckMessageKey({ ok: false, reason: 'unsupported', status: 404 })).toBe(
      null
    );
    expect(imageConnectionCheckMessageKey({ ok: false, reason: 'unsupported', status: 405 })).toBe(
      null
    );
    expect(imageConnectionCheckMessageKey({ ok: false, reason: 'unsupported', status: 501 })).toBe(
      null
    );
    expect(imageConnectionCheckMessageKey({ ok: false, reason: 'unsupported' })).toBe(null);
    expect(imageConnectionCheckMessageKey({ ok: false, reason: 'http_error', status: 404 })).toBe(
      'settings.imageConnection.check.notFound'
    );
    expect(imageConnectionCheckMessageKey({ ok: false, reason: 'unreachable' })).toBe(
      'settings.imageConnection.check.unreachable'
    );
    expect(copy('settings.imageConnection.check.enterBaseUrl')).toBe('Enter a base URL.');
    expect(copy('settings.imageConnection.check.keyRejected')).toBe(
      'The key was rejected. Check the key and try again.'
    );
    expect(copy('settings.imageConnection.check.notFound')).toBe(
      'That address was not found from your computer. Check the base URL.'
    );
    expect(copy('settings.imageConnection.check.unreachable')).toBe(
      "Can't reach the server from your computer. Check the URL and your network."
    );
    expect(zh['settings.imageConnection.check.enterBaseUrl']).toBe('请输入服务地址。');
    expect(zh['settings.imageConnection.check.keyRejected']).toBe('密钥被拒绝。请检查密钥后再试。');
    expect(zh['settings.imageConnection.check.notFound']).toBe(
      '从你的电脑找不到这个地址。请检查服务地址。'
    );
    expect(zh['settings.imageConnection.check.unreachable']).toBe(
      '你的电脑连不上这台服务器。请检查地址和网络。'
    );
  });
  it('keeps the example placeholder and the real provider roots in the hints', () => {
    expect(copy('settings.imageConnection.baseUrlPlaceholder')).toBe('https://api.example.com/v1');
    expect(copy('settings.imageConnection.baseUrlHint')).toContain('https://api.openai.com/v1');
    expect(copy('settings.imageConnection.baseUrlHintDashscope')).toContain(
      'https://dashscope.aliyuncs.com/api/v1'
    );
    expect(zh['settings.imageConnection.baseUrlHint']).toContain('https://api.openai.com/v1');
    expect(zh['settings.imageConnection.baseUrlHintDashscope']).toContain(
      'https://dashscope.aliyuncs.com/api/v1'
    );
  });
  it('ships the candidate-model copy in English and Chinese', () => {
    expect(en['settings.imageConnection.chooseModel']).toBe('Choose a model.');
    expect(en['settings.imageConnection.otherModel']).toBe('Other model ID');
    expect(en['settings.imageConnection.modelCandidates']).toBe('Model');
    expect(zh['settings.imageConnection.chooseModel']).toBe('请选择模型。');
    expect(zh['settings.imageConnection.otherModel']).toBe('其他模型 ID');
    expect(zh['settings.imageConnection.modelCandidates']).toBe('模型');
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
      (node) =>
        node.textContent?.trim() === text ||
        (text === copy('settings.models.moreOptions') && node.textContent?.startsWith(text))
    );
    expect(found, `button "${text}"`).toBeDefined();
    return found as HTMLButtonElement;
  };

  const modelChip = (view: HTMLElement, model: string): HTMLButtonElement => {
    const found = [...view.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find(
      (node) => node.textContent?.includes(model)
    );
    expect(found, `model chip "${model}"`).toBeDefined();
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

  const blur = async (input: HTMLInputElement) => {
    await act(async () => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
  };

  const baseUrlInput = async (view: HTMLElement): Promise<HTMLInputElement> => {
    const existing = view.querySelector<HTMLInputElement>('input[id$="-base-url"]');
    if (existing) return existing;
    await click(button(view, copy('settings.models.moreOptions')));
    const opened = view.querySelector<HTMLInputElement>('input[id$="-base-url"]');
    expect(opened).not.toBeNull();
    return opened as HTMLInputElement;
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
    await baseUrlInput(view);
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
    expect(view.textContent).not.toContain(STORED_KEY);
    expect(view.textContent).toContain(copy('settings.models.keyLocalHint'));
    expect(removeKeyButton(view)).not.toBeNull();
  });

  it('opens a legacy stored row with its exact values and no selected candidate', async () => {
    const saves: ImageConnectionFormDraft[] = [];
    const stored = storedConnection();
    const view = await renderForm({ stored, onSave: (draft) => void saves.push(draft) });
    expect(stored.protocol).toBeUndefined();
    expect(button(view, copy('common.save')).disabled).toBe(true);
    expect(modelChip(view, 'gpt-image-2').getAttribute('aria-checked')).toBe('false');
    expect(modelChip(view, 'gpt-image-1').getAttribute('aria-checked')).toBe('false');
    expect(button(view, copy('settings.models.moreOptions')).textContent).toContain(
      'api.openai.com/v1 · saved-custom-model'
    );
    await baseUrlInput(view);
    expect(view.querySelector<HTMLInputElement>('input[id$="-base-url"]')?.value).toBe(
      stored.baseUrl
    );
    expect(view.querySelector<HTMLInputElement>('input[id$="-model"]')?.value).toBe(stored.model);
    await act(async () => {
      view
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(saves).toEqual([]);
    expect(stored.revision).toBe(3);
  });

  it('keeps Connect outside the scrolling drawer body', async () => {
    const view = await renderForm({ pinActions: true });
    const body = view.querySelector('[data-drawer-body]');
    const footer = view.querySelector('[data-drawer-footer]');
    const connect = button(view, copy('settings.models.connect'));
    expect(body).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(body?.contains(connect)).toBe(false);
    expect(footer?.contains(connect)).toBe(true);
    expect(footer?.className).toContain('shrink-0');
    expect(body?.className).toContain('overflow-y-auto');
  });

  it('offers no remove action when nothing is stored', async () => {
    const view = await renderForm();
    expect(apiKeyInput(view).getAttribute('placeholder')).toBe('sk-...');
    expect(removeKeyButton(view)).toBeNull();
  });

  it('offers connection removal only when the container provides it', async () => {
    const removals: string[] = [];
    const withDelete = await renderForm({
      stored: storedConnection(),
      onDelete: () => void removals.push('remove'),
    });
    await click(button(withDelete, copy('settings.imageConnection.delete')));
    expect(removals).toEqual(['remove']);

    const withoutDelete = await renderForm({ stored: storedConnection() });
    expect(
      [...withoutDelete.querySelectorAll('button')].find(
        (node) => node.textContent?.trim() === copy('settings.imageConnection.delete')
      )
    ).toBeUndefined();
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

    const urlInput = await baseUrlInput(view);
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

  it('connects a new OpenAI Images draft with only a key and one model click', async () => {
    const saves: ImageConnectionFormDraft[] = [];
    const view = await renderForm({ onSave: (draft) => void saves.push(draft) });
    const advanced = button(view, copy('settings.models.moreOptions'));
    expect(advanced.getAttribute('aria-expanded')).toBe('false');
    expect(advanced.textContent).toContain('api.openai.com/v1');
    expect(view.querySelector('input[id$="-base-url"]')).toBeNull();
    expect(view.querySelector('input[id$="-model"]')).toBeNull();
    await typeInto(apiKeyInput(view), 'synthetic-typed-key');
    expect(view.textContent).not.toContain(copy('settings.imageConnection.check.enterBaseUrl'));
    expect(advanced.getAttribute('aria-expanded')).toBe('false');
    expect(view.textContent).toContain(copy('settings.imageConnection.chooseModel'));
    const connect = button(view, copy('settings.models.connect'));
    expect(connect.disabled).toBe(true);
    await click(modelChip(view, 'gpt-image-2'));
    expect(connect.disabled).toBe(false);
    expect(advanced.textContent).toContain('gpt-image-2');
    await click(connect);
    expect(saves[0]).toMatchObject({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-image-2',
      apiKey: 'synthetic-typed-key',
    });
  });

  it('switches protocol defaults and candidates while preserving a custom address', async () => {
    const view = await renderForm();
    await typeInto(apiKeyInput(view), 'synthetic-typed-key');
    await click(modelChip(view, 'gpt-image-2'));
    await click(button(view, copy('settings.imageConnection.protocols.dashscope')));
    expect(apiKeyInput(view).value).toBe('');
    expect(modelChip(view, 'qwen-image-2.1').getAttribute('aria-checked')).toBe('false');
    expect(modelChip(view, 'qwen-image-2.0').getAttribute('aria-checked')).toBe('false');
    expect(
      [...view.querySelectorAll('button[role="radio"]')].some((node) =>
        node.textContent?.includes('gpt-image-2')
      )
    ).toBe(false);
    expect(button(view, copy('settings.models.moreOptions')).textContent).toContain(
      'dashscope.aliyuncs.com/api/v1 · —'
    );
    const address = await baseUrlInput(view);
    await typeInto(address, 'https://images.example.com/v1');
    await click(button(view, copy('settings.imageConnection.protocols.openaiImages')));
    expect(apiKeyInput(view).value).toBe('');
    expect(address.value).toBe('https://images.example.com/v1');
  });

  it('does not save a new image connection that has no key', async () => {
    const saves: ImageConnectionFormDraft[] = [];
    const view = await renderForm({ onSave: (draft) => void saves.push(draft) });
    await typeInto(await baseUrlInput(view), 'https://images.example.com/v1');
    await click(modelChip(view, 'gpt-image-2'));
    const connect = button(view, copy('settings.models.connect'));
    expect(connect.disabled).toBe(true);
    await click(connect);
    await act(async () => {
      view
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(saves).toEqual([]);
  });

  it.each([
    'http://images.example.invalid/v1',
    'http://image-gateway.local/v1',
    'http://[fd00::1]:8080/v1',
  ])('shows the endpoint policy and disables Save for %s', async (baseUrl) => {
    const saves: ImageConnectionFormDraft[] = [];
    const view = await renderForm({
      stored: storedConnection(),
      onSave: (draft) => void saves.push(draft),
    });
    await typeInto(await baseUrlInput(view), baseUrl);
    await typeInto(apiKeyInput(view), 'synthetic-renewed-key');
    expect(view.textContent).toContain(copy('settings.imageConnection.invalidBaseUrl'));
    expect(copy('settings.imageConnection.invalidBaseUrl')).toContain('HTTPS');
    expect(copy('settings.imageConnection.invalidBaseUrl')).toContain('private');
    expect(button(view, copy('common.save')).disabled).toBe(true);
    await click(button(view, copy('common.save')));
    expect(saves).toEqual([]);
  });

  it.each(['http://192.168.0.1:8080/v1', 'http://172.16.0.1:8080/v1'])(
    'saves a private HTTP endpoint only after replacing the destination-bound key: %s',
    async (baseUrl) => {
      const saves: ImageConnectionFormDraft[] = [];
      const view = await renderForm({
        stored: storedConnection(),
        onSave: (draft) => void saves.push(draft),
      });
      await typeInto(await baseUrlInput(view), baseUrl);
      expect(view.textContent).not.toContain(copy('settings.imageConnection.invalidBaseUrl'));
      expect(button(view, copy('common.save')).disabled).toBe(true);
      expect(view.textContent).toContain(copy('settings.models.keyRequired'));
      await typeInto(apiKeyInput(view), 'synthetic-renewed-key');
      expect(button(view, copy('common.save')).disabled).toBe(false);
      await click(button(view, copy('common.save')));
      expect(saves).toEqual([draftOf({ baseUrl, apiKey: 'synthetic-renewed-key' })]);
      expect(buildImageConnectionSave(saves[0], storedConnection())).toMatchObject({
        expectedRevision: 3,
        baseUrl,
        apiKey: 'synthetic-renewed-key',
      });
      expect(apiKeyInput(view).value).toBe('');
    }
  );

  describe('free check', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    const settle = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(CONNECTION_CHECK_DELAY_MS);
      });

    it('rebinds a custom endpoint, checks and saves it, then restores the default', async () => {
      const requests: CheckImageConnection[] = [];
      const saves: ImageConnectionFormDraft[] = [];
      const view = await renderForm({
        onSave: (draft) => void saves.push(draft),
        onCheck: async (input) => {
          requests.push(input);
          return { ok: true, models: ['gpt-image-2'] };
        },
      });
      await typeInto(apiKeyInput(view), 'synthetic-default-key');
      const address = await baseUrlInput(view);
      await typeInto(address, 'https://images.example.com/v1');
      expect(apiKeyInput(view).value).toBe('');
      expect(view.textContent).toContain(copy('settings.models.keyRequired'));
      await typeInto(apiKeyInput(view), 'synthetic-custom-key');
      await settle();
      expect(requests).toEqual([
        {
          protocol: 'openai-images',
          baseUrl: 'https://images.example.com/v1',
          apiKey: 'synthetic-custom-key',
        },
      ]);
      await click(modelChip(view, 'gpt-image-2'));
      await click(button(view, copy('settings.models.connect')));
      expect(saves[0]).toMatchObject({
        baseUrl: 'https://images.example.com/v1',
        model: 'gpt-image-2',
      });
      await click(button(view, copy('settings.models.useDefaultEndpoint')));
      expect(button(view, copy('settings.models.moreOptions')).getAttribute('aria-expanded')).toBe(
        'false'
      );
      expect(button(view, copy('settings.models.moreOptions')).textContent).toContain(
        'api.openai.com/v1'
      );
    });

    it('allows saving after a key rejection', async () => {
      const saves: ImageConnectionFormDraft[] = [];
      const view = await renderForm({
        onSave: (draft) => void saves.push(draft),
        onCheck: async () => ({ ok: false, reason: 'key_rejected', status: 401 }),
      });
      await typeInto(apiKeyInput(view), 'synthetic-typed-key');
      await click(modelChip(view, 'gpt-image-2'));
      await settle();
      expect(view.textContent).toContain(copy('settings.imageConnection.check.keyRejected'));
      const connect = button(view, copy('settings.models.connect'));
      expect(connect.disabled).toBe(false);
      await click(connect);
      expect(saves[0]).toMatchObject({ model: 'gpt-image-2' });
    });

    it('shows unreachable and carries its badge to the saved row', async () => {
      imageIpc.getImageSnapshot.mockResolvedValue({ connection: null });
      imageIpc.checkImage.mockResolvedValue({ ok: false, reason: 'unreachable' });
      imageIpc.saveImage.mockResolvedValue(storedConnection({ revision: 4, model: 'gpt-image-2' }));
      await act(async () => {
        root?.render(createElement(ImageConnectionSetting, { variant: 'panel' }));
      });
      const view = container as HTMLElement;
      await typeInto(apiKeyInput(view), 'synthetic-typed-key');
      await click(modelChip(view, 'gpt-image-2'));
      await settle();
      expect(view.textContent).toContain(copy('settings.imageConnection.check.unreachable'));
      expect(button(view, copy('settings.models.connect')).disabled).toBe(false);
      await click(button(view, copy('settings.models.connect')));
      expect(view.textContent).toContain(copy('settings.check.badge.unreachable'));
      expect(view.querySelector('form')).toBeNull();
    });

    it('tags a missing candidate and opens Advanced without replacing the choice', async () => {
      const saves: ImageConnectionFormDraft[] = [];
      const view = await renderForm({
        onSave: (draft) => void saves.push(draft),
        onCheck: async () => ({ ok: true, models: ['gpt-image-1', 'dall-e-3'] }),
      });
      await typeInto(apiKeyInput(view), 'synthetic-typed-key');
      await click(modelChip(view, 'gpt-image-2'));
      await settle();
      expect(modelChip(view, 'gpt-image-2').textContent).toContain(
        copy('settings.models.picker.notListed')
      );
      expect(view.textContent).toContain(copy('settings.imageConnection.modelNotListed'));
      expect(button(view, copy('settings.models.moreOptions')).getAttribute('aria-expanded')).toBe(
        'true'
      );
      expect(view.querySelector<HTMLInputElement>('input[id$="-model"]')?.value).toBe(
        'gpt-image-2'
      );
      expect(view.textContent).toContain(
        copy('settings.imageConnection.suggestions').replace('{{count}}', '2')
      );
      expect(button(view, 'gpt-image-1')).toBeDefined();
      expect(button(view, 'dall-e-3')).toBeDefined();
      await click(button(view, copy('settings.models.connect')));
      expect(saves[0]).toMatchObject({ model: 'gpt-image-2' });
    });

    it('checks a typed key once it settles and offers the listed models', async () => {
      const requests: CheckImageConnection[] = [];
      const view = await renderForm({
        onCheck: async (input) => {
          requests.push(input);
          return { ok: true, models: ['gpt-image-2', 'dall-e-3', 'gpt-4.1'] };
        },
      });
      await typeInto(await baseUrlInput(view), 'https://images.example.com/v1');
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
      expect(view.querySelector('[role="alert"]')).toBeNull();
      expect(view.querySelector<HTMLInputElement>('input[id$="-model"]')!.value).toBe('');
      expect(view.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
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
      expect(view.textContent).toContain(copy('settings.imageConnection.check.keyRejected'));
      expect(view.textContent).not.toContain('The provider rejected this key (401).');
      await typeInto(await baseUrlInput(view), 'https://elsewhere.example.com/v1');
      await settle();
      expect(requests).toHaveLength(1);
      expect(view.textContent).not.toContain('rejected');
    });

    it.each([
      [
        { ok: false, reason: 'http_error', status: 404 } as const,
        'settings.imageConnection.check.notFound' as const,
      ],
      [
        { ok: false, reason: 'unreachable' } as const,
        'settings.imageConnection.check.unreachable' as const,
      ],
    ])('shows the plain image failure %j', async (result, key) => {
      const view = await renderForm({
        stored: storedConnection(),
        onCheck: async () => result,
      });
      await settle();
      expect(view.querySelector('[role="alert"]')?.textContent).toBe(copy(key));
      expect(view.querySelector('[role="alert"]')?.textContent).toContain('your computer');
    });

    it.each(['http://192.168.0.1:8080/v1', 'http://172.16.0.1:8080/v1'])(
      'checks a private HTTP image endpoint with its newly typed key: %s',
      async (baseUrl) => {
        const requests: CheckImageConnection[] = [];
        const view = await renderForm({
          stored: storedConnection(),
          onCheck: async (input) => {
            requests.push(input);
            return { ok: true, models: ['synthetic-image-model'] };
          },
        });
        await typeInto(await baseUrlInput(view), baseUrl);
        await settle();
        expect(requests).toEqual([]);
        await typeInto(apiKeyInput(view), 'synthetic-renewed-key');
        await settle();
        expect(requests).toEqual([
          { protocol: 'openai-images', baseUrl, apiKey: 'synthetic-renewed-key' },
        ]);
        expect(view.textContent).toContain(
          copy('settings.imageConnection.modelNotListed').replace('{{count}}', '1')
        );
      }
    );

    it('clears a key typed before an address edit and follows the new protocol default', async () => {
      const requests: CheckImageConnection[] = [];
      const fresh = await renderForm({
        onCheck: async (input) => {
          requests.push(input);
          return { ok: true, models: [] };
        },
      });
      await typeInto(apiKeyInput(fresh), 'synthetic-typed-key');
      const freshUrl = await baseUrlInput(fresh);
      await typeInto(freshUrl, 'https://images.example.com/v1');
      expect(apiKeyInput(fresh).value).toBe('');
      await settle();
      expect(requests).toEqual([]);
      await typeInto(apiKeyInput(fresh), 'synthetic-custom-key');
      await settle();
      expect(requests).toEqual([
        {
          protocol: 'openai-images',
          baseUrl: 'https://images.example.com/v1',
          apiKey: 'synthetic-custom-key',
        },
      ]);

      await act(async () => root?.unmount());
      root = createRoot(container as HTMLDivElement);
      const stored = storedConnection({
        protocol: 'dashscope',
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      });
      const switched = await renderForm({
        stored,
        onCheck: async (input) => {
          requests.push(input);
          return { ok: true };
        },
      });
      await settle();
      await click(button(switched, copy('settings.imageConnection.protocols.openaiImages')));
      await settle();
      expect(requests).toHaveLength(1);
      expect(
        button(switched, copy('settings.models.moreOptions')).getAttribute('aria-expanded')
      ).toBe('false');
      expect(button(switched, copy('settings.models.moreOptions')).textContent).toContain(
        'api.openai.com/v1 · —'
      );
      expect(switched.textContent).toContain(copy('settings.models.keyRequired'));
      expect(button(switched, copy('common.save')).disabled).toBe(true);
      await typeInto(apiKeyInput(switched), 'synthetic-typed-key');
      await settle();
      expect(requests[1]).toEqual({
        protocol: 'openai-images',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'synthetic-typed-key',
      });
    });

    it('drops a key once the first address changes', async () => {
      const requests: CheckImageConnection[] = [];
      const view = await renderForm({
        onCheck: async (input) => {
          requests.push(input);
          return { ok: true };
        },
      });
      await typeInto(apiKeyInput(view), 'synthetic-typed-key');
      const firstAddress = await baseUrlInput(view);
      await typeInto(firstAddress, 'https://images.example.com/v1');
      expect(apiKeyInput(view).value).toBe('');
      await blur(firstAddress);
      await typeInto(firstAddress, 'https://elsewhere.example.com/v1');
      expect(apiKeyInput(view).value).toBe('');
      await settle();
      expect(requests).toEqual([]);
      await click(button(view, copy('settings.imageConnection.protocols.dashscope')));
      await typeInto(apiKeyInput(view), 'synthetic-typed-key');
      await click(button(view, copy('settings.imageConnection.protocols.openaiImages')));
      expect(apiKeyInput(view).value).toBe('');
      await settle();
      expect(requests).toEqual([]);
    });

    it('drops a key that was typed for a different address', async () => {
      const requests: CheckImageConnection[] = [];
      const view = await renderForm({
        onCheck: async (input) => {
          requests.push(input);
          return { ok: true };
        },
      });
      await typeInto(await baseUrlInput(view), 'https://images.example.com/v1');
      await typeInto(apiKeyInput(view), 'synthetic-typed-key');
      await typeInto(await baseUrlInput(view), 'https://elsewhere.example.com/v1');
      expect(apiKeyInput(view).value).toBe('');
      await settle();
      expect(requests).toEqual([]);
    });

    it('saves a custom model ID from Advanced without selecting a candidate', async () => {
      const saves: ImageConnectionFormDraft[] = [];
      const view = await renderForm({ onSave: (draft) => void saves.push(draft) });
      await typeInto(apiKeyInput(view), 'synthetic-typed-key');
      await baseUrlInput(view);
      await typeInto(view.querySelector<HTMLInputElement>('input[id$="-model"]')!, 'flux-pro');
      expect(modelChip(view, 'gpt-image-2').getAttribute('aria-checked')).toBe('false');
      expect(modelChip(view, 'gpt-image-1').getAttribute('aria-checked')).toBe('false');
      const connect = button(view, copy('settings.models.connect'));
      expect(connect.disabled).toBe(false);
      await click(connect);
      expect(saves).toEqual([
        draftOf({
          apiKey: 'synthetic-typed-key',
          model: 'flux-pro',
        }),
      ]);
    });

    it('collapses More options for provider roots and expands for custom addresses', async () => {
      const moreOptions = (view: HTMLElement) => button(view, copy('settings.models.moreOptions'));
      const mount = async (props: Partial<FormProps> = {}) => {
        await act(async () => {
          root?.unmount();
        });
        root = createRoot(container as HTMLDivElement);
        return renderForm(props);
      };
      const saved = await mount({ stored: storedConnection() });
      expect(moreOptions(saved).getAttribute('aria-expanded')).toBe('false');
      expect(saved.querySelector('input[id$="-base-url"]')).toBeNull();
      const slash = await mount({
        stored: storedConnection({ baseUrl: 'https://api.openai.com/v1/' }),
      });
      expect(moreOptions(slash).getAttribute('aria-expanded')).toBe('false');
      const dashscope = await mount({
        stored: storedConnection({
          protocol: 'dashscope',
          baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
        }),
      });
      expect(moreOptions(dashscope).getAttribute('aria-expanded')).toBe('false');
      const custom = await mount({
        stored: storedConnection({ baseUrl: 'https://images.example.com/v1' }),
      });
      expect(moreOptions(custom).getAttribute('aria-expanded')).toBe('true');
      expect(custom.querySelector<HTMLInputElement>('input[id$="-base-url"]')?.value).toBe(
        'https://images.example.com/v1'
      );
      const fresh = await mount();
      expect(moreOptions(fresh).getAttribute('aria-expanded')).toBe('false');
      expect(fresh.querySelector('input[id$="-base-url"]')).toBeNull();
      await click(moreOptions(fresh));
      expect(moreOptions(fresh).getAttribute('aria-expanded')).toBe('true');
      expect(fresh.querySelector<HTMLInputElement>('input[id$="-base-url"]')?.placeholder).toBe(
        'https://api.example.com/v1'
      );
      const keyFirst = await mount();
      await typeInto(apiKeyInput(keyFirst), 'synthetic-typed-key');
      expect(moreOptions(keyFirst).getAttribute('aria-expanded')).toBe('false');
      expect(keyFirst.querySelector('input[id$="-base-url"]')).toBeNull();
      await click(moreOptions(keyFirst));
      const keyFirstUrl = keyFirst.querySelector<HTMLInputElement>('input[id$="-base-url"]')!;
      await typeInto(keyFirstUrl, 'https://images.example.com/v1');
      expect(moreOptions(keyFirst).getAttribute('aria-expanded')).toBe('true');
      expect(apiKeyInput(keyFirst).value).toBe('');
      expect(keyFirstUrl.isConnected).toBe(true);
    });

    it('shows an example placeholder and blocks an empty address before any check', async () => {
      const requests: CheckImageConnection[] = [];
      const view = await renderForm({
        onCheck: async (input) => {
          requests.push(input);
          return { ok: true };
        },
      });
      const urlInput = await baseUrlInput(view);
      expect(urlInput.value).toBe('https://api.openai.com/v1');
      await typeInto(urlInput, '');
      expect(urlInput.placeholder).toBe(copy('settings.imageConnection.baseUrlPlaceholder'));
      expect(urlInput.placeholder).toBe('https://api.example.com/v1');
      expect(view.querySelector('[role="alert"]')).toBeNull();
      await typeInto(apiKeyInput(view), 'synthetic-typed-key');
      await settle();
      expect(requests).toEqual([]);
      expect(view.querySelector('[role="alert"]')?.textContent).toBe(
        copy('settings.imageConnection.check.enterBaseUrl')
      );
    });

    it.each([
      [
        { ok: false, reason: 'rate_limited', status: 429 } as const,
        'settings.check.failures.rate_limited' as const,
        '429',
      ],
      [
        { ok: false, reason: 'http_error', status: 500 } as const,
        'settings.check.failures.http_error' as const,
        '500',
      ],
      [
        { ok: false, reason: 'invalid_response' } as const,
        'settings.check.failures.invalid_response' as const,
        '',
      ],
    ])('keeps the shared failure line for %j', async (result, key, status) => {
      const view = await renderForm({
        stored: storedConnection(),
        onCheck: async () => result,
      });
      await settle();
      const host = 'api.openai.com';
      expect(view.querySelector('[role="alert"]')?.textContent).toBe(
        copy(key).replaceAll('{{status}}', status).replaceAll('{{host}}', host)
      );
    });

    it('stays quiet when the service has no model list', async () => {
      const view = await renderForm({
        stored: storedConnection(),
        onCheck: async () => ({ ok: false, reason: 'unsupported', status: 404 }),
      });
      await settle();
      expect(view.querySelector('[role="alert"]')).toBeNull();
      expect(view.textContent).not.toContain("This service can't be checked for free");
    });

    it('never sends a typed key to an invalid public HTTP endpoint', async () => {
      const requests: CheckImageConnection[] = [];
      const view = await renderForm({
        onCheck: async (input) => {
          requests.push(input);
          return { ok: true };
        },
      });
      await typeInto(await baseUrlInput(view), 'http://images.example.invalid/v1');
      await typeInto(apiKeyInput(view), 'synthetic-renewed-key');
      await settle();
      expect(requests).toEqual([]);
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
      expect(view.querySelector('[role="alert"]')).toBeNull();
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

  it('logs a failed first read and reports the connection after an explicit retry', async () => {
    const failure = new Error('keychain locked');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    imageIpc.getImageSnapshot.mockImplementationOnce(async () => {
      throw failure;
    });
    imageIpc.getImageSnapshot.mockImplementation(async () => ({ connection: storedConnection() }));
    const reported: (ProtectedImageConnection | null)[] = [];
    await act(async () => {
      root?.render(
        createElement(ImageConnectionSetting, {
          onConnectionChange: (connection) => reported.push(connection),
        })
      );
    });
    const view = container as HTMLElement;
    expect(view.textContent).toContain(copy('settings.models.error'));
    expect(consoleError).toHaveBeenCalledWith('Failed to read the image connection', failure);
    expect(reported).toEqual([]);

    await click(button(view, copy('common.retry')));

    expect(reported).toEqual([storedConnection()]);
    expect(view.textContent).not.toContain(copy('settings.models.error'));
    consoleError.mockRestore();
  });

  it('keeps the row actions reachable when the stored key is missing', async () => {
    imageIpc.getImageSnapshot.mockImplementation(async () => ({
      connection: storedConnection({ enabled: false, hasApiKey: false }),
    }));
    await act(async () => {
      root?.render(createElement(ImageConnectionSetting));
    });
    const view = container as HTMLElement;
    expect(
      view.querySelector(`button[aria-label="${copy('settings.imageConnection.moreActions')}"]`)
    ).not.toBeNull();
  });

  it('removes the saved connection only after confirmation and returns to set-up', async () => {
    const deleted: unknown[] = [];
    imageIpc.getImageSnapshot.mockImplementation(async () => ({ connection: storedConnection() }));
    imageIpc.deleteImage.mockImplementation(async (input: unknown) => void deleted.push(input));
    let answer = false;
    vi.stubGlobal('confirm', () => answer);
    await act(async () => {
      root?.render(createElement(ImageConnectionSetting));
    });
    const view = container as HTMLElement;
    const textButton = (text: string) =>
      [...view.querySelectorAll<HTMLButtonElement>('button')].find(
        (node) => node.textContent?.trim() === text
      )!;
    await act(async () => textButton(copy('common.edit')).click());
    await act(async () => textButton(copy('settings.imageConnection.delete')).click());
    expect(deleted).toEqual([]);
    answer = true;
    await act(async () => textButton(copy('settings.imageConnection.delete')).click());
    expect(deleted).toEqual([{ expectedRevision: 3 }]);
    expect(view.textContent).toContain(copy('settings.imageConnection.statusNotReady'));
  });

  it('dismisses the key-rotation notice and keeps it dismissed', async () => {
    imageIpc.getImageSnapshot.mockImplementation(async () => ({
      connection: storedConnection({ legacyHistoryMayContainKey: true }),
    }));
    // A fresh store per render keeps the jotai default store — used by every
    // other test here — untouched by the dismissal.
    await act(async () => {
      root?.render(
        createElement(Provider, { store: createStore() }, createElement(ImageConnectionSetting))
      );
    });
    const view = container as HTMLElement;
    expect(view.textContent).toContain(copy('settings.imageConnection.legacyHistoryWarning'));
    await click(
      view.querySelector<HTMLButtonElement>(`button[aria-label="${copy('common.dismiss')}"]`)!
    );
    expect(view.textContent).not.toContain(copy('settings.imageConnection.legacyHistoryWarning'));

    // A restarted app mounts a fresh store on the same storage: still dismissed.
    const nextStore = createStore();
    const unsubscribe = nextStore.sub(imageKeyMigrationNoticeDismissedAtom, () => undefined);
    expect(nextStore.get(imageKeyMigrationNoticeDismissedAtom)).toBe(true);
    unsubscribe();
    mollyStorage.removeItem('molly-image-key-migration-notice-dismissed');
  });
});
