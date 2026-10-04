// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceMcpServerMeta } from '@molly/shared';
import type { McpToolDiscoveryResult } from '@molly/shared/embedded-harness';
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
async function render(
  entry = stored,
  listTools?: () => Promise<McpToolDiscoveryResult>
) {
  const writes: McpConnectionFormValue[] = [];
  await act(async () =>
    root.render(
      createElement(McpConnectionForm, {
        initialEntry: entry,
        ...(listTools ? { listTools } : {}),
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

async function changeText(field: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      field,
      value
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label
  )!;
  await act(async () => button.click());
}

describe('Pi presentation fields', () => {
  it('keeps exposure rules in order on edit', async () => {
    const writes = await render({
      ...stored,
      exposure: 'hidden',
      toolExposure: [
        { pattern: 'read_*', exposure: 'deferred' },
        { pattern: '*', exposure: 'direct' },
      ],
    });
    await submit();
    expect(writes[0]).toMatchObject({
      exposure: 'hidden',
      toolExposure: [
        { pattern: 'read_*', exposure: 'deferred' },
        { pattern: '*', exposure: 'direct' },
      ],
    });
  });

  it('omits the codemode default and empty rules', async () => {
    const writes = await render();
    await submit();
    expect(writes[0]).not.toHaveProperty('exposure');
    expect(writes[0]).not.toHaveProperty('toolExposure');
  });

  it('fills a new server from one mcp.json entry and reports what it could not keep', async () => {
    const writes: McpConnectionFormValue[] = [];
    await act(async () =>
      root.render(
        createElement(McpConnectionForm, {
          onCancel() {},
          onSubmit(value) {
            writes.push(value);
          },
        })
      )
    );
    await click(en['settings.mcp.import.action']);
    await changeText(
      host.querySelector<HTMLTextAreaElement>('textarea[aria-label]')!,
      JSON.stringify({
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', 'synthetic-server'],
            env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
            description: 'Synthetic issues',
            exposure: 'deferred',
            toolExposure: { delete_issue: 'hidden' },
            timeout: 30,
          },
        },
      })
    );
    await click(en['settings.mcp.import.fill']);
    expect(host.textContent).toContain('timeout');
    expect(host.textContent).toContain('GITHUB_TOKEN');
    await submit();
    expect(writes[0]).toEqual({
      name: 'github',
      description: 'Synthetic issues',
      exposure: 'deferred',
      toolExposure: [{ pattern: 'delete_issue', exposure: 'hidden' }],
      transport: 'stdio',
      enabledByDefault: false,
      connection: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'synthetic-server'],
        env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
      },
    });
  });

  it('refuses several servers at once instead of guessing', async () => {
    await act(async () =>
      root.render(createElement(McpConnectionForm, { onCancel() {}, onSubmit() {} }))
    );
    await click(en['settings.mcp.import.action']);
    await changeText(
      host.querySelector<HTMLTextAreaElement>('textarea[aria-label]')!,
      JSON.stringify({ mcpServers: { a: { url: 'https://a.invalid' }, b: { url: 'https://b.invalid' } } })
    );
    await click(en['settings.mcp.import.fill']);
    expect(host.querySelector('[role=alert]')?.textContent).toContain('a, b');
    expect(host.querySelector<HTMLInputElement>('input[required]')!.value).toBe('');
  });
});

describe('protected MCP credential form', () => {
  it('edits a legacy mapped server using the ordinary connection fields', async () => {
    const writes = await render({
      ...stored,
      imageBinding: {
        version: 1,
        model: 'synthetic-image',
        generate: { tool: 'draw', fields: { prompt: 'text', model: 'model_id' } },
      },
    });
    expect(host.querySelector('textarea[id$="-image-binding"]')).toBeNull();
    await submit();
    expect(writes[0].connection).toEqual(stored.connection);
    expect(writes[0]).not.toHaveProperty('imageBinding');
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

describe('Settings tool list', () => {
  const listed: McpToolDiscoveryResult = {
    ok: true,
    truncated: false,
    tools: [
      { name: 'search', description: 'Search things.', readOnlyHint: true },
      { name: 'wipe', destructiveHint: true },
      { name: 'ping' },
    ],
  };

  it('shows declared hints and adds an exact-name rule on request', async () => {
    const writes = await render(
      { ...stored, toolExposure: [{ pattern: 'ping', exposure: 'hidden' }] },
      async () => listed
    );
    await click(en['settings.mcp.tools.list']);
    const text = host.textContent ?? '';
    expect(text).toContain(en['settings.mcp.tools.hints.readOnly']);
    expect(text).toContain(en['settings.mcp.tools.hints.destructive']);
    expect(text).toContain(en['settings.mcp.tools.hasRule']);
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          `button[aria-label="${en['settings.mcp.tools.addRuleFor'].replace('{{name}}', 'search')}"]`
        )!
        .click()
    );
    await submit();
    expect(writes[0]?.toolExposure).toEqual([
      { pattern: 'ping', exposure: 'hidden' },
      { pattern: 'search', exposure: 'direct' },
    ]);
  });

  it('reports a failure instead of an empty list', async () => {
    await render(stored, async () => ({ ok: false, reason: 'timed_out' }));
    await click(en['settings.mcp.tools.list']);
    expect(host.textContent).toContain(en['settings.mcp.tools.failure.timed_out']);
    expect(host.textContent).not.toContain(en['settings.mcp.tools.empty']);
  });

  it('lists only the saved server: an edited endpoint disables the action', async () => {
    await render(stored, async () => listed);
    const url = [...host.querySelectorAll<HTMLInputElement>('input')].find(
      (input) => input.value === 'https://mcp.invalid/mcp'
    )!;
    await change(url, 'https://other.invalid/mcp');
    const button = [...host.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === en['settings.mcp.tools.list']
    )!;
    expect(button.disabled).toBe(true);
    expect(host.textContent).toContain(en['settings.mcp.tools.saveFirst']);
  });
});

