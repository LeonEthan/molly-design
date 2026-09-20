// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfigId, AgentConfigMeta, MachineId, ProviderSetupTask } from '@molly/shared';
import { AgentEngineCatalog } from '../src/components/settings/agent-engine-catalog';
import { MachineProvidersSection } from '../src/components/settings/machine-detail-pane';
import { initI18n } from '../src/i18n';
import en from '../../../locales/en.json';
import zh from '../../../locales/zh_CN.json';

const legacy: AgentConfigMeta = {
  id: 'synthetic-legacy' as AgentConfigId,
  machineId: 'synthetic-machine' as MachineId,
  name: 'Historical Claude',
  description: undefined,
  cliType: 'builtin',
  agentType: 'claude',
  env: { API_KEY: 'synthetic-private-value' },
  prompt: 'synthetic-private-prompt',
};
const molly: AgentConfigMeta = {
  ...legacy,
  id: 'synthetic-molly' as AgentConfigId,
  name: 'Current Molly',
  agentType: 'molly',
  env: {},
};
const pending: ProviderSetupTask = {
  v: 1,
  id: 'synthetic-setup' as AgentConfigId,
  machineId: legacy.machineId,
  config: { ...legacy, name: 'Historical setup' },
  status: 'awaiting-auth',
  attempt: 1,
  createdAt: 1,
  updatedAt: 1,
};
let host: HTMLDivElement;
let root: Root;
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
});

describe.each([AgentEngineCatalog, MachineProvidersSection])('read-only catalog %s', (Catalog) => {
  it('explains model selection without offering an external provider installer', async () => {
    await act(async () => root.render(<Catalog configs={[]} />));
    expect(host.textContent).toContain(en['settings.models.engineSelectionHint']);
    expect(host.textContent).not.toContain(en['settings.models.legacyTitle']);
    expect(host.querySelector('button, input, select, a')).toBeNull();
  });
  it('keeps legacy names without mounting login, refresh, retry or edit controls', async () => {
    const before = JSON.stringify([legacy, molly, pending]);
    await act(async () => root.render(<Catalog configs={[legacy, molly]} setups={[pending]} />));
    expect(Array.from(host.querySelectorAll('li'), (item) => item.textContent)).toEqual([
      `Historical Claude · ${en['settings.models.legacyReadOnly']}`,
      `Historical setup · ${en['settings.models.legacySetupRetired']}`,
    ]);
    expect(host.textContent).toContain(en['settings.models.legacyHint']);
    expect(host.textContent).not.toContain('synthetic-private');
    expect(host.textContent).not.toContain('Current Molly');
    expect(host.querySelector('button, input, select, a')).toBeNull();
    expect(JSON.stringify([legacy, molly, pending])).toBe(before);
  });
  it('shows registry and custom configurations as retired, even if named Molly', async () => {
    const configs: AgentConfigMeta[] = ['registry', 'custom'].map((cliType) => ({
      ...molly,
      id: cliType as AgentConfigId,
      cliType: cliType as AgentConfigMeta['cliType'],
    }));
    await act(async () => root.render(<Catalog configs={configs} />));
    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect(host.querySelector('button, input, select, a')).toBeNull();
  });
  it('localizes the retired status and migration guidance in Chinese', async () => {
    await initI18n('zh_CN');
    await act(async () => root.render(<Catalog configs={[legacy]} setups={[pending]} />));
    expect(host.textContent).toContain(zh['settings.models.legacyReadOnly']);
    expect(host.textContent).toContain(zh['settings.models.legacySetupRetired']);
    expect(host.textContent).toContain(zh['settings.models.legacyHint']);
  });
});
