// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceMcpServerMeta } from '@molly/shared';
import {
  McpConnectionForm,
  type McpConnectionFormValue,
} from '../src/components/settings/mcp-connection-form';
import { initI18n } from '../src/i18n';
import en from '../../../locales/en.json';

const stored: WorkspaceMcpServerMeta = {
  id: 'synthetic' as WorkspaceMcpServerMeta['id'],
  name: 'Synthetic',
  transport: 'http',
  createdAt: 1,
  updatedAt: 1,
  connection: {
    transport: 'http',
    url: 'https://mcp.invalid/mcp',
    protectedCredentials: {
      credentialRef: '00000000-0000-4000-8000-000000000001',
      revision: 3,
    },
  },
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
async function render(entry = stored) {
  const writes: McpConnectionFormValue[] = [];
  await act(async () =>
    root.render(
      createElement(McpConnectionForm, {
        initialEntry: entry,
        onCancel() {},
        onSubmit(value) {
          writes.push(value);
        },
      })
    )
  );
  return writes;
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function change(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('protected MCP credential form', () => {
  it('preserves, validates and explicitly removes public image bindings', async () => {
    const imageBinding: WorkspaceMcpServerMeta['imageBinding'] = {
      version: 1,
      model: 'synthetic-image',
      generate: { tool: 'draw', fields: { prompt: 'text', model: 'model_id' } },
    };
    const writes = await render({ ...stored, imageBinding });
    await submit();
    expect(writes[0].imageBinding).toEqual(imageBinding);
    const editor = host.querySelector<HTMLTextAreaElement>('textarea[id$="-image-binding"]')!;
    const changeBinding = async (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          editor,
          value
        );
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await changeBinding(JSON.stringify({ ...imageBinding, model: '' }));
    expect(host.querySelector('button[type=submit]')).toHaveProperty('disabled', true);
    await submit();
    expect(writes).toHaveLength(1);
    expect(host.textContent).toContain(en['settings.mcp.imageBinding.invalid']);
    await changeBinding('');
    await submit();
    expect(writes[1]).not.toHaveProperty('imageBinding');
    expect(writes[1].connection).toEqual(stored.connection);
  });
  it('renders stored credentials empty and preserves only their reference on save', async () => {
    const writes = await render();
    expect(host.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');
    expect(host.textContent).toContain(en['settings.mcp.protectedStored']);
    expect(host.innerHTML).not.toContain(stored.connection!.protectedCredentials!.credentialRef);
    await submit();
    expect(writes[0].connection).toEqual(stored.connection);
  });
  it('clears submitted secrets and requires re-entry rather than a no-auth retry', async () => {
    const writes = await render();
    await change(host.querySelector('input[type=password]')!, 'synthetic-replacement');
    await submit();
    expect(writes[0].connection).toHaveProperty('bearerToken', 'synthetic-replacement');
    expect(host.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');
    expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    await submit();
    expect(writes).toHaveLength(1);
    await change(host.querySelector('input[type=password]')!, 'synthetic-explicit-retry');
    await submit();
    expect(writes[1].connection).toHaveProperty('bearerToken', 'synthetic-explicit-retry');
  });
  it('clears the reference only through the explicit removal action', async () => {
    const writes = await render();
    const remove = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === en['settings.mcp.removeStoredCredentials']
    )!;
    await act(async () => remove.click());
    await submit();
    expect(writes[0].connection).toEqual({ transport: 'http', url: 'https://mcp.invalid/mcp' });
  });
  it('masks legacy header values during explicit migration', async () => {
    const writes = await render({
      ...stored,
      connection: {
        transport: 'http',
        url: 'https://mcp.invalid/mcp',
        headers: { 'X-Key': 'synthetic-legacy' },
      },
    });
    const secret = [...host.querySelectorAll<HTMLInputElement>('input')].find(
      (field) => field.value === 'synthetic-legacy'
    )!;
    expect(secret.type).toBe('password');
    await submit();
    expect(writes[0].connection).toHaveProperty('headers', { 'X-Key': 'synthetic-legacy' });
    expect(
      [...host.querySelectorAll<HTMLInputElement>('input')].some(
        (field) => field.value === 'synthetic-legacy'
      )
    ).toBe(false);
  });
});
