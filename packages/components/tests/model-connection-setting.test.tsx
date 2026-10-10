// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ModelConnectionForm,
  ModelConnectionRow,
  ModelConnectionSetting,
  applyProviderChoice,
} from '../src/components/settings/model-connection-setting';
import type {
  CheckModelConnection,
  HarnessModelCatalog,
  ModelConnection,
  SaveModelConnection,
} from '@molly/shared/embedded-harness';
import { CONNECTION_CHECK_DELAY_MS } from '../src/components/settings/connection-check';
import { initI18n } from '../src/i18n';
import en from '../../../locales/en.json';
import zh from '../../../locales/zh_CN.json';

const { connectionIpc } = vi.hoisted(() => ({
  connectionIpc: {
    getSnapshot: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    getModelCatalog: vi.fn().mockRejectedValue(new Error('no catalog')),
    getModelMetadataSnapshot: vi.fn().mockRejectedValue(new Error('no snapshot')),
  },
}));
vi.mock('../src/lib/electron-ipc-client', () => ({
  getIpcServices: () => ({ modelConnections: connectionIpc }),
}));

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

async function pickDiscovered(text: string) {
  await act(async () =>
    [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes(text))!
      .click()
  );
}

async function openMoreOptions() {
  const trigger = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === en['settings.models.moreOptions']
  )!;
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  await act(async () => trigger.click());
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
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
        maxTokensField: 'max_tokens',
      },
    ];
    await render(
      async (input) => {
        writes.push(input);
      },
      { ...stored, providerPresetId: 'openai-compatible', customModels }
    );
    expect(host.textContent).toContain(en['settings.models.compatibleLead']);
    expect(host.textContent).not.toContain(en['settings.models.compatibleHint']);
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
      maxTokensField: 'max_tokens',
    };
    await render(async () => undefined, {
      ...stored,
      providerPresetId: 'openai-compatible',
      customModels: [model, { ...model, modelId: 'second' }],
    });
    expect(host.textContent).toContain(zh['settings.models.compatibleLead']);
    expect(host.textContent).not.toContain(zh['settings.models.compatibleHint']);
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
    expect(host.querySelector('[role="radio"][aria-checked="true"]')).toBeNull();
    expect(host.querySelector('input[type=password]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    expect(host.textContent).not.toContain('PRIVATE_REFERENCE_NOT_A_SECRET');
  });

  it('asks for the key once a provider tile is picked and suggests its address', async () => {
    await render(async () => undefined);
    const tile = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((node) =>
      node.textContent?.endsWith(en['settings.models.providers.deepseek'])
    )!;
    await act(async () => tile.click());
    expect(host.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');
    expect(host.textContent).toContain('Sends requests to https://api.deepseek.com');
    await openMoreOptions();
    expect(host.querySelector<HTMLInputElement>('input[id$="-name"]')!.value).toBe(
      en['settings.models.providers.deepseek']
    );
  });

  it('keeps optional edits when collapsed and saves without a model catalog or a key check', async () => {
    const writes: SaveModelConnection[] = [];
    await render(async (input) => {
      writes.push(input);
    }, stored);
    expect(host.querySelector('input[id$="-name"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[id$="-endpoint"]')!.value).toBe(
      stored.baseUrl
    );
    await openMoreOptions();
    await change(host.querySelector<HTMLInputElement>('input[id$="-name"]')!, 'Studio');
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === en['settings.models.moreOptions'])!
        .click()
    );
    expect(host.querySelector('input[id$="-name"]')).toBeNull();
    await act(async () =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(writes).toEqual([
      {
        id: stored.id,
        expectedRevision: stored.revision,
        displayName: 'Studio',
        providerPresetId: stored.providerPresetId,
        baseUrl: stored.baseUrl,
        enabled: true,
      },
    ]);
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
  async function renderRow(connection: ModelConnection, onToggle = () => undefined) {
    await act(async () =>
      root.render(
        createElement(ModelConnectionRow, { connection, onEdit: () => undefined, onToggle })
      )
    );
  }
  const rowSwitch = () => host.querySelector<HTMLButtonElement>('[role="switch"]')!;

  it('names the provider and shows a switched-on connection without its default endpoint', async () => {
    await renderRow({ ...stored, providerPresetId: 'xai', baseUrl: 'https://api.x.ai/v1/' });
    expect(host.textContent).toContain(en['settings.models.providers.xai']);
    expect(host.textContent).not.toContain('api.x.ai');
    expect(host.textContent).not.toContain(stored.credentialRef);
    expect(rowSwitch().getAttribute('aria-label')).toBe('Use Synthetic');
    expect(rowSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('shows a custom endpoint and a switched-off connection', async () => {
    await renderRow({ ...stored, enabled: false });
    expect(host.textContent).toContain(
      `${en['settings.models.providers.openai']} · example.invalid/v1`
    );
    expect(rowSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('turns a connection off without asking for its key again', async () => {
    const toggles: SaveModelConnection[] = [];
    await renderRow(stored, (input: SaveModelConnection) => void toggles.push(input));
    await act(async () => rowSwitch().click());
    expect(toggles).toEqual([
      {
        id: stored.id,
        expectedRevision: stored.revision,
        displayName: stored.displayName,
        providerPresetId: stored.providerPresetId,
        baseUrl: stored.baseUrl,
        enabled: false,
      },
    ]);
  });

  it('cannot turn on a connection whose endpoint needs another provider', async () => {
    await renderRow({
      ...stored,
      providerPresetId: 'moonshot',
      baseUrl: 'https://api.kimi.com/coding/v1',
      enabled: false,
    });
    expect(rowSwitch().disabled).toBe(true);
  });
});

describe('connection list', () => {
  it('switches a connection in place, keeping the list order', async () => {
    const second: ModelConnection = {
      ...stored,
      id: '00000000-0000-4000-8000-000000000002',
      displayName: 'Second',
    };
    connectionIpc.getSnapshot.mockResolvedValue({ connections: [stored, second] });
    connectionIpc.save.mockImplementation(async (input: SaveModelConnection) => ({
      ...stored,
      revision: stored.revision + 1,
      enabled: input.enabled,
    }));
    await act(async () => root.render(createElement(ModelConnectionSetting)));
    const switches = () => [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
    await act(async () => switches()[0]!.click());
    expect(switches().map((entry) => entry.getAttribute('aria-label'))).toEqual([
      'Use Synthetic',
      'Use Second',
    ]);
    expect(switches()[0]!.getAttribute('aria-checked')).toBe('false');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

const catalog: HarnessModelCatalog['models'] = [
  {
    providerPresetId: 'openai',
    modelId: 'gpt-x',
    name: 'GPT X',
    input: ['text', 'image'],
    contextWindow: 400_000,
    thinking: ['off', 'high'],
  },
  {
    providerPresetId: 'openai',
    modelId: 'gpt-x-mini',
    name: 'GPT X Mini',
    input: ['text'],
    contextWindow: 128_000,
    thinking: ['off'],
  },
  {
    providerPresetId: 'anthropic',
    modelId: 'claude-x',
    name: 'Claude X',
    input: ['text', 'image'],
    contextWindow: 200_000,
    thinking: ['off', 'high'],
  },
];

describe('free key check and model choice', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECTION_CHECK_DELAY_MS);
    });
  const submit = () =>
    act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  const radio = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((node) =>
      node.textContent?.startsWith(label)
    )!;

  it('checks a typed key once it settles; Choose preselects the whole catalog, not the listing', async () => {
    const requests: CheckModelConnection[] = [];
    const writes: SaveModelConnection[] = [];
    await act(async () =>
      root.render(
        createElement(ModelConnectionForm, {
          initialProvider: 'openai',
          catalog,
          onSave: async (input) => void writes.push(input),
          onCancel: () => undefined,
          onCheck: async (input) => {
            requests.push(input);
            return { ok: true, models: ['gpt-x'] };
          },
        })
      )
    );
    await change(host.querySelector<HTMLInputElement>('input[type=password]')!, 'SYNTHETIC_KEY');
    expect(requests).toEqual([]);
    await settle();
    expect(requests).toEqual([
      { providerPresetId: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'SYNTHETIC_KEY' },
    ]);
    expect(host.textContent).toContain('Key check passed · 1 model listed');
    await openMoreOptions();
    expect(radio('All 2').getAttribute('aria-checked')).toBe('true');
    await act(async () => radio(en['settings.models.picker.choose']).click());
    // Listing informs with a not-listed tag; it must not shrink the preselection.
    expect(host.textContent).toContain(en['settings.models.picker.notListed']);
    const boxes = [...host.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]')];
    expect(boxes.map((box) => box.getAttribute('aria-checked'))).toEqual(['true', 'true']);
    await submit();
    expect(writes[0]).toMatchObject({
      providerPresetId: 'openai',
      models: ['gpt-x', 'gpt-x-mini'],
    });
    expect(host.innerHTML).not.toContain('SYNTHETIC_KEY');
  });

  it('does not collapse Choose to the single Kimi membership listing', async () => {
    const kimiCatalog: HarnessModelCatalog['models'] = [
      {
        providerPresetId: 'kimi-coding',
        modelId: 'k3',
        name: 'Kimi K3',
        input: ['text', 'image'],
        contextWindow: 1_048_576,
        thinking: ['low', 'high', 'max'],
      },
      {
        providerPresetId: 'kimi-coding',
        modelId: 'k3-256k',
        name: 'Kimi K3-256K',
        input: ['text', 'image'],
        contextWindow: 262_144,
        thinking: ['low', 'high', 'max'],
      },
      {
        providerPresetId: 'kimi-coding',
        modelId: 'kimi-for-coding',
        name: 'kimi-for-coding',
        input: ['text', 'image'],
        contextWindow: 1_048_576,
        thinking: ['low', 'high', 'max'],
      },
      {
        providerPresetId: 'kimi-coding',
        modelId: 'kimi-for-coding-highspeed',
        name: 'Kimi For Coding HighSpeed',
        input: ['text', 'image'],
        contextWindow: 262_144,
        thinking: ['off'],
      },
    ];
    const writes: SaveModelConnection[] = [];
    await act(async () =>
      root.render(
        createElement(ModelConnectionForm, {
          initialProvider: 'kimi-coding',
          catalog: kimiCatalog,
          onSave: async (input) => void writes.push(input),
          onCancel: () => undefined,
          onCheck: async () => ({ ok: true, models: ['k3'] }),
        })
      )
    );
    await change(host.querySelector<HTMLInputElement>('input[type=password]')!, 'SYNTHETIC_KEY');
    await settle();
    expect(host.textContent).toContain('Key check passed · 1 model listed');
    await openMoreOptions();
    expect(radio('All 4').getAttribute('aria-checked')).toBe('true');
    await act(async () => radio(en['settings.models.picker.choose']).click());
    const boxes = [...host.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]')];
    expect(boxes).toHaveLength(4);
    expect(boxes.map((box) => box.getAttribute('aria-checked'))).toEqual([
      'true',
      'true',
      'true',
      'true',
    ]);
    await submit();
    expect(writes[0]).toMatchObject({
      providerPresetId: 'kimi-coding',
      models: ['k3', 'k3-256k', 'kimi-for-coding', 'kimi-for-coding-highspeed'],
    });
  });

  it('checks a saved key only against the provider and address it was saved for', async () => {
    const requests: CheckModelConnection[] = [];
    await act(async () =>
      root.render(
        createElement(ModelConnectionForm, {
          stored: { ...stored, models: ['gpt-x-mini'] },
          catalog,
          onSave: async () => undefined,
          onCancel: () => undefined,
          onCheck: async (input) => {
            requests.push(input);
            return { ok: false, reason: 'key_rejected', status: 401 };
          },
        })
      )
    );
    await openMoreOptions();
    expect(radio(en['settings.models.picker.choose']).getAttribute('aria-checked')).toBe('true');
    await settle();
    expect(requests).toEqual([
      {
        providerPresetId: 'openai',
        baseUrl: stored.baseUrl,
        stored: { id: stored.id, revision: stored.revision },
      },
    ]);
    expect(host.textContent).toContain('The provider rejected this key (401).');
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    await change(
      host.querySelector<HTMLInputElement>('input[id$="-endpoint"]')!,
      'https://x.invalid/v1'
    );
    await settle();
    expect(requests).toHaveLength(1);
  });

  it('offers every model again when the choice goes back to All', async () => {
    const writes: SaveModelConnection[] = [];
    await act(async () =>
      root.render(
        createElement(ModelConnectionForm, {
          stored: { ...stored, models: ['gpt-x-mini'] },
          catalog,
          onSave: async (input) => void writes.push(input),
          onCancel: () => undefined,
        })
      )
    );
    await openMoreOptions();
    await act(async () => radio('All 2').click());
    await submit();
    expect(writes[0]).not.toHaveProperty('models');
    expect(writes[0]).toMatchObject({ id: stored.id, expectedRevision: stored.revision });
  });
});

describe('connection management', () => {
  it('deletes a connection only after confirmation and removes its row', async () => {
    const deleted: unknown[] = [];
    connectionIpc.getSnapshot.mockResolvedValue({ connections: [stored] });
    connectionIpc.delete.mockImplementation(async (input: unknown) => void deleted.push(input));
    let answer = false;
    vi.stubGlobal('confirm', () => answer);
    await act(async () => root.render(createElement(ModelConnectionSetting)));
    const button = (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (node) => node.textContent === label
      )!;
    await act(async () => button(en['common.edit']).click());
    await act(async () => button(en['settings.models.delete']).click());
    expect(deleted).toEqual([]);
    answer = true;
    await act(async () => button(en['settings.models.delete']).click());
    expect(deleted).toEqual([{ id: stored.id, expectedRevision: stored.revision }]);
    expect(host.textContent).not.toContain('Synthetic');
    expect(host.textContent).toContain(en['settings.models.empty']);
  });

  it('shows the picker choice outside More options and summarizes the chosen subset', async () => {
    connectionIpc.getSnapshot.mockResolvedValue({
      connections: [{ ...stored, models: ['gpt-5', 'gpt-5-mini'] }],
    });
    connectionIpc.getModelCatalog.mockResolvedValue({
      models: ['gpt-5', 'gpt-5-mini', 'gpt-4o'].map((modelId) => ({
        providerPresetId: 'openai',
        modelId,
        name: modelId,
        input: ['text'],
        contextWindow: 128000,
        thinking: ['off'],
      })),
    });
    await act(async () => root.render(createElement(ModelConnectionSetting)));
    expect(host.textContent).toContain(
      en['settings.models.summary.countOf'].replace('{{count}}', '2').replace('{{total}}', '3')
    );
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((node) => node.textContent === en['common.edit'])!
        .click()
    );
    // First-class section: visible without opening More options.
    expect(host.textContent).toContain(en['settings.models.picker.title']);
    expect(host.querySelector('[id$="-name"]')).toBeNull();
    await openMoreOptions();
    expect(host.querySelector('[id$="-name"]')).not.toBeNull();
  });

  it('starts a new connection from a provider shortcut when none exist', async () => {
    connectionIpc.getSnapshot.mockResolvedValue({ connections: [] });
    await act(async () => root.render(createElement(ModelConnectionSetting)));
    const shortcut = [...host.querySelectorAll<HTMLButtonElement>('button')].find((node) =>
      node.textContent?.endsWith(en['settings.models.providers.anthropic'])
    )!;
    await act(async () => shortcut.click());
    await openMoreOptions();
    expect(host.querySelector<HTMLInputElement>('input[id$="-name"]')!.value).toBe(
      en['settings.models.providers.anthropic']
    );
    expect(host.textContent).toContain('Sends requests to https://api.anthropic.com');
  });

  it('discovers compatible models from the service and saves the picked declarations', async () => {
    const writes: SaveModelConnection[] = [];
    const discovered = [
      {
        modelId: 'deepseek-chat',
        name: 'DeepSeek Chat',
        contextWindow: 65536,
        maxTokens: 8192,
      },
      { modelId: 'vendor/raw' },
    ];
    await act(async () =>
      root.render(
        createElement(ModelConnectionForm, {
          initialProvider: 'openai-compatible',
          metadataSnapshot: null,
          onSave: async (input) => {
            writes.push(input);
          },
          onCancel: () => undefined,
          onDiscover: async () => ({ ok: true, models: discovered, filteredNonChat: 2 }),
        })
      )
    );
    await change(
      host.querySelector<HTMLInputElement>('input[id$="-endpoint"]')!,
      'https://gateway.invalid/v1'
    );
    await change(host.querySelector<HTMLInputElement>('input[type=password]')!, 'sk-synthetic');
    const discoverButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === en['settings.models.discover.button']
    )!;
    await act(async () => discoverButton.click());
    expect(host.textContent).toContain(
      en['settings.models.discover.found'].replace('{{count}}', '2')
    );
    expect(host.textContent).toContain(
      en['settings.models.discover.filtered'].replace('{{count}}', '2')
    );
    await pickDiscovered('deepseek-chat');
    expect(host.textContent).toContain('DeepSeek Chat');
    await pickDiscovered('vendor/raw');
    expect(host.querySelector('fieldset input[id$="-modelId"]')).not.toBeNull();
    const submit = host.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(submit.disabled).toBe(true);
    await act(async () =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(writes).toEqual([]);
  });

  it('saves discovered models once the incomplete declaration is completed', async () => {
    const writes: SaveModelConnection[] = [];
    await act(async () =>
      root.render(
        createElement(ModelConnectionForm, {
          initialProvider: 'openai-compatible',
          metadataSnapshot: null,
          onSave: async (input) => {
            writes.push(input);
          },
          onCancel: () => undefined,
          onDiscover: async () => ({
            ok: true,
            models: [{ modelId: 'vendor/raw', name: 'Raw Model' }],
            filteredNonChat: 0,
          }),
        })
      )
    );
    await change(
      host.querySelector<HTMLInputElement>('input[id$="-endpoint"]')!,
      'https://gateway.invalid/v1'
    );
    await change(host.querySelector<HTMLInputElement>('input[type=password]')!, 'sk-synthetic');
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === en['settings.models.discover.button'])!
        .click()
    );
    await pickDiscovered('vendor/raw');
    await change(
      host.querySelector<HTMLInputElement>('fieldset input[id$="-contextWindow"]')!,
      '32768'
    );
    await change(host.querySelector<HTMLInputElement>('fieldset input[id$="-maxTokens"]')!, '4096');
    await act(async () =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(writes[0]?.customModels).toEqual([
      {
        modelId: 'vendor/raw',
        name: 'Raw Model',
        input: ['text'],
        contextWindow: 32768,
        maxTokens: 4096,
        thinking: ['off'],
        toolCalls: false,
        maxTokensField: 'max_tokens',
      },
    ]);
  });

  it('enriches discovery rows from the packaged metadata snapshot without overriding the service', async () => {
    const snapshot = {
      version: 1 as const,
      source: 'models.dev' as const,
      generatedAt: '2026-10-10T00:00:00Z',
      providers: {
        deepseek: {
          models: {
            'deepseek-reasoner': {
              name: 'DeepSeek Reasoner',
              contextWindow: 131072,
              maxTokens: 65536,
              reasoning: true,
              toolCalls: true,
            },
          },
        },
      },
    };
    await act(async () =>
      root.render(
        createElement(ModelConnectionForm, {
          initialProvider: 'openai-compatible',
          metadataSnapshot: snapshot,
          onSave: async () => undefined,
          onCancel: () => undefined,
          onDiscover: async () => ({
            ok: true,
            models: [{ modelId: 'deepseek-reasoner' }],
            filteredNonChat: 0,
          }),
        })
      )
    );
    await change(
      host.querySelector<HTMLInputElement>('input[id$="-endpoint"]')!,
      'https://gateway.invalid/v1'
    );
    await change(host.querySelector<HTMLInputElement>('input[type=password]')!, 'sk-synthetic');
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === en['settings.models.discover.button'])!
        .click()
    );
    expect(host.textContent).toContain('DeepSeek Reasoner');
    expect(host.textContent).toContain(en['settings.models.picker.thinks']);
    await pickDiscovered('deepseek-reasoner');
    expect(
      host.querySelector<HTMLInputElement>('fieldset input[id$="-contextWindow"]')!.value
    ).toBe('131072');
    expect(host.querySelector<HTMLInputElement>('fieldset input[id$="-maxTokens"]')!.value).toBe(
      '65536'
    );
    expect(host.querySelector<HTMLButtonElement>('fieldset button[id$="-thinking-high"]')!,).not.toBeNull();
  });

  it('keeps the manual declaration path when discovery fails', async () => {
    await act(async () =>
      root.render(
        createElement(ModelConnectionForm, {
          initialProvider: 'openai-compatible',
          metadataSnapshot: null,
          onSave: async () => undefined,
          onCancel: () => undefined,
          onDiscover: async () => ({ ok: false, reason: 'unreachable' as const }),
        })
      )
    );
    await change(
      host.querySelector<HTMLInputElement>('input[id$="-endpoint"]')!,
      'https://gateway.invalid/v1'
    );
    await change(host.querySelector<HTMLInputElement>('input[type=password]')!, 'sk-synthetic');
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === en['settings.models.discover.button'])!
        .click()
    );
    expect(host.textContent).toContain(en['settings.models.discover.failed']);
    expect(
      [...host.querySelectorAll<HTMLButtonElement>('button')].some(
        (button) => button.textContent === en['settings.models.addCustomModel']
      )
    ).toBe(true);
  });
});
