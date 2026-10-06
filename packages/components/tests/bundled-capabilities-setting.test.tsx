// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  BundledCapabilitiesSetting,
  BundledCapabilitiesView,
} from '../src/components/settings/bundled-capabilities-setting';
import { MOLLY_PI_PACKAGES } from '@molly/shared/embedded-harness';
import { initI18n } from '../src/i18n';
import en from '../../../locales/en.json';
import zh from '../../../locales/zh_CN.json';

const snapshot = {
  harness: {
    id: 'molly',
    engine: 'pi',
    engineVersion: '1.0.0',
    protocolVersion: 1,
    buildId: 'a'.repeat(64),
  },
  engine: { name: '@earendil-works/pi-coding-agent', version: '1.0.0', license: 'MIT' },
  addons: MOLLY_PI_PACKAGES.map((name) => ({ name, version: '1.2.3', license: 'MIT' })),
};
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
  'lists Pi and every shipped add-on in plain words without installation controls: %s',
  async (lang) => {
    await initI18n(lang);
    await act(async () => root.render(<BundledCapabilitiesView snapshot={snapshot} />));
    const copy = lang === 'en' ? en : zh;
    expect(host.textContent).not.toContain('@earendil-works/pi-coding-agent');
    const details = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === copy['settings.engine.technicalDetails']
    )!;
    expect(details.getAttribute('aria-expanded')).toBe('false');
    await act(async () => details.click());
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('@earendil-works/pi-coding-agent · 1.0.0 · MIT');
    expect(host.textContent).toContain(snapshot.harness.buildId);
    for (const name of MOLLY_PI_PACKAGES)
      expect(host.textContent).toContain(`${name} · 1.2.3 · MIT`);
    for (const slug of ['skills', 'questions', 'mentions', 'fileSearch', 'safetyNet'])
      expect(host.textContent).toContain(
        copy[`settings.engine.addons.${slug}.title` as keyof typeof copy]
      );
    expect(host.querySelector('input, select, a')).toBeNull();
    expect(host.querySelector('[role="switch"]')).toBeNull();
    await act(async () => details.click());
    expect(host.textContent).not.toContain('@earendil-works/pi-coding-agent');
  }
);

it.each([undefined, null])('distinguishes loading and unknown availability: %s', async (value) => {
  await act(async () => root.render(<BundledCapabilitiesView snapshot={value} />));
  expect(host.textContent).toContain(
    value === undefined
      ? en['settings.models.capabilitiesLoading']
      : en['settings.models.capabilitiesUnavailable']
  );
  expect(host.textContent).not.toContain('@juicesharp/rpiv-ask-user-question');
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
