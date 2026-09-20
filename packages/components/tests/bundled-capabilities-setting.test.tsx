// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  BundledCapabilitiesSetting,
  BundledCapabilitiesView,
} from '../src/components/settings/bundled-capabilities-setting';
import { initI18n } from '../src/i18n';
import en from '../../../locales/en.json';
import zh from '../../../locales/zh_CN.json';

const snapshot = {
  harness: {
    id: 'molly',
    engine: 'pi',
    engineVersion: '0.85.1',
    protocolVersion: 1,
    buildId: 'a'.repeat(64),
  },
  extensions: [
    {
      name: 'pi-ask-question',
      version: '0.4.0',
      commit: 'b'.repeat(40),
      license: 'MIT',
      tools: ['ask_question'],
      activation: 'requires-question-ui-v1',
    },
  ],
} as const;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
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
  delete window.ipc;
});

it.each(['en', 'zh_CN'] as const)(
  'shows version and conditional activation without installation controls: %s',
  async (lang) => {
    await initI18n(lang);
    await act(async () =>
      root.render(
        <BundledCapabilitiesView
          snapshot={{
            ...snapshot,
            extensions: [{ ...snapshot.extensions[0], tools: ['ask_question'] }],
          }}
        />
      )
    );
    const copy = lang === 'en' ? en : zh;
    expect(host.textContent).toContain('pi-ask-question · 0.4.0 · MIT');
    expect(host.textContent).toContain(copy['settings.models.capabilitiesQuestionActivation']);
    expect(host.textContent).toContain(copy['settings.models.capabilitiesLimits']);
    expect(host.querySelector('button, input, select, a')).toBeNull();
  }
);

it.each([undefined, null])('distinguishes loading and unknown availability: %s', async (value) => {
  await act(async () => root.render(<BundledCapabilitiesView snapshot={value} />));
  expect(host.textContent).toContain(
    value === undefined
      ? en['settings.models.capabilitiesLoading']
      : en['settings.models.capabilitiesUnavailable']
  );
  expect(host.textContent).not.toContain('pi-ask-question');
});

it('uses only the public inventory IPC and reports a failed read without raw diagnostics', async () => {
  const channels: string[] = [];
  window.ipc = {
    invoke: async (channel: string) => {
      channels.push(channel);
      throw new Error('synthetic-private-path');
    },
  } as never;
  await act(async () => root.render(<BundledCapabilitiesSetting />));
  expect(channels).toEqual(['modelConnections.getBundledCapabilities']);
  expect(host.textContent).toContain(en['settings.models.capabilitiesUnavailable']);
  expect(host.textContent).not.toContain('synthetic-private-path');
});
