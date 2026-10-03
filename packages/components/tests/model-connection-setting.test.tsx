// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ModelConnectionForm,
  ModelConnectionRow,
  applyProviderChoice,
} from '../src/components/settings/model-connection-setting';
import type { ModelConnection, SaveModelConnection } from '@molly/shared/embedded-harness';
import { initI18n } from '../src/i18n';
import en from '../../../locales/en.json';
import zh from '../../../locales/zh_CN.json';

const stored: ModelConnection = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  revision: 3,
  providerPresetId: 'openai',
  displayName: 'Synthetic',
  baseUrl: 'https://example.invalid/v1',
  enabled: true,
  credentialRef: 'PRIVATE_REFERENCE_NOT_A_SECRET',
};
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
async function render(
  onSave: (input: SaveModelConnection) => Promise<void>,
  value?: ModelConnection
) {
  await act(async () =>
    root.render(
      createElement(ModelConnectionForm, { stored: value, onSave, onCancel: () => undefined })
    )
  );
}
async function change(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('encrypted model connection form', () => {
  it('edits explicit compatible metadata without exposing or replacing the stored key', async () => {
    const writes: SaveModelConnection[] = [];
    const customModels: NonNullable<ModelConnection['customModels']> = [
      {
        modelId: 'vendor/custom',
        name: 'Custom',
        input: ['text', 'image'],
        contextWindow: 32768,
        maxTokens: 4096,
        thinking: ['off', 'high'],
        toolCalls: true,
        usageInStreaming: true,
        maxTokensField: 'max_tokens',
      },
    ];
    await render(
      async (input) => {
        writes.push(input);
      },
      { ...stored, providerPresetId: 'openai-compatible', customModels }
    );
    expect(host.textContent).toContain(en['settings.models.compatibleHint']);
    const limit = host.querySelector<HTMLInputElement>('input[id$="-maxTokens"]')!;
    await change(limit, '65536');
    expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    await change(limit, '2048');
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(writes[0]).toMatchObject({
      expectedRevision: 3,
      customModels: [{ ...customModels[0], maxTokens: 2048 }],
    });
    expect(writes[0].apiKey).toBeUndefined();
    expect(host.innerHTML).not.toContain(stored.credentialRef);
  });

  it('requires explicit model fields and permits adding and removing a compatible model', async () => {
    const writes: SaveModelConnection[] = [];
    await render(
      async (input) => {
        writes.push(input);
      },
      { ...stored, providerPresetId: 'openai-compatible' }
    );
    const submit = () => host.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(submit().disabled).toBe(true);
    const add = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === en['settings.models.addCustomModel']
    )!;
    await act(async () => add.click());
    expect(submit().disabled).toBe(true);
    for (const [field, value] of [
      ['modelId', 'custom'],
      ['name', 'Custom'],
      ['contextWindow', '32768'],
      ['maxTokens', '4096'],
    ]) {
      await change(host.querySelector<HTMLInputElement>(`fieldset input[id$="-${field}"]`)!, value);
    }
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[id$="-toolCalls"]')!.click()
    );
    expect(submit().disabled).toBe(false);
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(writes[0].customModels).toEqual([
      {
        modelId: 'custom',
        name: 'Custom',
        input: ['text'],
        contextWindow: 32768,
        maxTokens: 4096,
        thinking: ['off'],
        toolCalls: true,
        usageInStreaming: false,
        maxTokensField: 'max_tokens',
      },
    ]);
    const remove = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Remove model 1'
    )!;
    await act(async () => remove.click());
    expect(submit().disabled).toBe(true);
  });

  it('rejects duplicate model IDs and explains compatibility in Chinese', async () => {
    await initI18n('zh_CN');
    const model: NonNullable<ModelConnection['customModels']>[number] = {
      modelId: 'first',
      name: 'Custom',
      input: ['text'],
      contextWindow: 32768,
      maxTokens: 4096,
      thinking: ['off'],
      toolCalls: false,
      usageInStreaming: false,
      maxTokensField: 'max_tokens',
    };
    await render(async () => undefined, {
      ...stored,
      providerPresetId: 'openai-compatible',
      customModels: [model, { ...model, modelId: 'second' }],
    });
    expect(host.textContent).toContain(zh['settings.models.compatibleHint']);
    expect(host.textContent).toContain(zh['settings.models.toolsRequiredHint']);
    await change(host.querySelectorAll<HTMLInputElement>('input[id$="-modelId"]')[1], 'first');
    expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    expect(host.textContent).toContain(zh['settings.models.customModelsInvalid']);
  });

  it('labels Kimi Code separately and preserves the saved secret by omission', async () => {
    const writes: SaveModelConnection[] = [];
    await render(
      async (input) => {
        writes.push(input);
      },
      { ...stored, providerPresetId: 'kimi-coding', baseUrl: 'https://api.kimi.com/coding/' }
    );
    expect(host.textContent).toContain(en['settings.models.kimiCode']);
    expect(host.textContent).toContain(en['settings.models.kimiCodeHint']);
    expect(host.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(writes[0]).toMatchObject({ providerPresetId: 'kimi-coding' });
    expect(writes[0].apiKey).toBeUndefined();
  });

  it('explains a historical Moonshot/Kimi Code mismatch without rewriting or submitting it', async () => {
    const writes: SaveModelConnection[] = [];
    await render(
      async (input) => {
        writes.push(input);
      },
      { ...stored, providerPresetId: 'moonshot', baseUrl: 'https://api.kimi.com/coding/' }
    );
    expect(host.querySelector('[role=alert]')?.textContent).toBe(
      en['settings.models.kimiCodeProviderRequired']
    );
    expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(writes).toEqual([]);
  });
  it('does not infer a provider or expose credential references', async () => {
    await render(async () => undefined);
    expect(host.textContent).toContain(en['settings.models.chooseProvider']);
    expect(host.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');
    expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    expect(host.textContent).not.toContain('PRIVATE_REFERENCE_NOT_A_SECRET');
  });

  it('retains the key by omission and sends the exact CAS revision', async () => {
    const writes: SaveModelConnection[] = [];
    await render(async (input) => {
      writes.push(input);
    }, stored);
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(writes).toEqual([
      {
        id: stored.id,
        expectedRevision: 3,
        providerPresetId: 'openai',
        displayName: 'Synthetic',
        baseUrl: stored.baseUrl,
        enabled: true,
      },
    ]);
    expect(host.innerHTML).not.toContain('PRIVATE_REFERENCE_NOT_A_SECRET');
  });

  it('requires renewed consent for another destination and clears a submitted replacement', async () => {
    const writes: SaveModelConnection[] = [];
    await render(async (input) => {
      writes.push(input);
    }, stored);
    const endpoint = host.querySelector<HTMLInputElement>('input[id$="-endpoint"]')!;
    const key = host.querySelector<HTMLInputElement>('input[type=password]')!;
    await change(key, 'SYNTHETIC_OLD_DRAFT');
    await change(endpoint, 'https://second.invalid/v1');
    expect(key.value).toBe('');
    expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    await change(key, 'SYNTHETIC_RENEWED_KEY');
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(writes[0]).toMatchObject({
      baseUrl: 'https://second.invalid/v1',
      apiKey: 'SYNTHETIC_RENEWED_KEY',
    });
    expect(key.value).toBe('');
    expect(host.innerHTML).not.toContain('SYNTHETIC_RENEWED_KEY');
  });

  it('reveals and restores a provider default endpoint without hiding where requests go', async () => {
    const writes: SaveModelConnection[] = [];
    await render(
      async (input) => {
        writes.push(input);
      },
      { ...stored, providerPresetId: 'deepseek', baseUrl: 'https://api.deepseek.com/' }
    );
    const endpointField = () => host.querySelector<HTMLInputElement>('input[id$="-endpoint"]');
    const button = (label: string) =>
      [...host.querySelectorAll('button')].find((node) => node.textContent === label)!;
    expect(endpointField()).toBeNull();
    expect(host.textContent).toContain('Sends requests to https://api.deepseek.com');
    await act(async () => button(en['settings.models.useCustomEndpoint']).click());
    expect(endpointField()!.value).toBe('https://api.deepseek.com/');
    await change(endpointField()!, 'https://proxy.invalid/v1');
    await act(async () => button(en['settings.models.useDefaultEndpoint']).click());
    expect(endpointField()).toBeNull();
    await change(host.querySelector<HTMLInputElement>('input[type=password]')!, 'SYNTHETIC_KEY');
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(writes[0]).toMatchObject({
      providerPresetId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'SYNTHETIC_KEY',
    });
  });
});

describe('provider choice', () => {
  const labelOf = (preset: string) => `Label:${preset}`;

  it('fills the default endpoint and names a new connection after the provider', () => {
    expect(
      applyProviderChoice({ provider: '', name: '', endpoint: '' }, 'deepseek', labelOf)
    ).toEqual({
      provider: 'deepseek',
      name: 'Label:deepseek',
      endpoint: 'https://api.deepseek.com',
    });
  });

  it('follows the provider while the endpoint and name are still its suggestions', () => {
    expect(
      applyProviderChoice(
        {
          provider: 'kimi-coding',
          name: 'Label:kimi-coding',
          endpoint: 'https://api.kimi.com/coding/',
        },
        'openai',
        labelOf
      )
    ).toEqual({ provider: 'openai', name: 'Label:openai', endpoint: 'https://api.openai.com/v1' });
    expect(
      applyProviderChoice(
        { provider: 'openai', name: 'Label:openai', endpoint: 'https://api.openai.com/v1' },
        'openai-compatible',
        labelOf
      )
    ).toEqual({ provider: 'openai-compatible', name: 'Label:openai-compatible', endpoint: '' });
  });

  it('never overwrites an endpoint or name the user typed', () => {
    expect(
      applyProviderChoice(
        { provider: 'openai', name: 'Studio key', endpoint: 'https://proxy.invalid/v1' },
        'anthropic',
        labelOf
      )
    ).toEqual({ provider: 'anthropic', name: 'Studio key', endpoint: 'https://proxy.invalid/v1' });
  });
});

describe('connection row', () => {
  async function renderRow(connection: ModelConnection) {
    await act(async () =>
      root.render(createElement(ModelConnectionRow, { connection, onEdit: () => undefined }))
    );
  }

  it('names the provider and shows On without repeating a default endpoint', async () => {
    await renderRow({ ...stored, providerPresetId: 'xai', baseUrl: 'https://api.x.ai/v1/' });
    expect(host.textContent).toContain(en['settings.models.providers.xai']);
    expect(host.textContent).toContain(en['settings.models.statusOn']);
    expect(host.textContent).not.toContain('api.x.ai');
    expect(host.textContent).not.toContain(stored.credentialRef);
  });

  it('shows a custom endpoint and Off for a disabled connection', async () => {
    await renderRow({ ...stored, enabled: false });
    expect(host.textContent).toContain(
      `${en['settings.models.providers.openai']} · example.invalid/v1`
    );
    expect(host.textContent).toContain(en['settings.models.statusOff']);
  });
});
