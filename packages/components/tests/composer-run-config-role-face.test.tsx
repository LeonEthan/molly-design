// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { type AgentConfigId, type AgentConfigMeta, type MachineId } from '@molly/shared';

import { DesktopRunConfigMenu } from '../src/components/sessions/desktop-run-config-menu';
import { initI18n } from '../src/i18n';
import { TooltipProvider } from '../src/ui/tooltip';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const machineId = 'machine-1' as MachineId;
const agentConfig: AgentConfigMeta = {
  id: 'config-1' as AgentConfigId,
  machineId,
  name: 'Codex Primary',
  description: undefined,
  cliType: 'builtin',
  agentType: 'codex',
  env: {},
};

type MenuProps = ComponentProps<typeof DesktopRunConfigMenu>;

const baseProps: MenuProps = {
  agentSelection: { agentId: agentConfig.id, machineId },
  availableAgentConfigs: [agentConfig],
  modelOptions: [{ value: 'gpt-5.5', label: '5.5' }],
  selectedModelId: 'gpt-5.5',
  onModelChange: () => undefined,
  configOptionSelectors: [],
  configOptionValues: {},
  onConfigOptionChange: () => undefined,
};

describe('Desktop model picker without Roles', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(async () => {
    await initI18n('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = undefined;
    }
    container?.remove();
    container = undefined;
  });

  const render = async (props: Partial<MenuProps> = {}): Promise<HTMLDivElement> => {
    await act(async () => {
      root?.render(
        createElement(
          TooltipProvider,
          { delayDuration: 0 },
          createElement(DesktopRunConfigMenu, { ...baseProps, ...props })
        )
      );
    });
    return container as HTMLDivElement;
  };

  it('names the model without exposing a harness or Role control', async () => {
    const view = await render();
    const trigger = view.querySelector('button[aria-label="Provider and model"]');
    expect(trigger?.textContent).not.toContain('Codex Primary');
    expect(trigger?.textContent).toContain('5.5');
  });

  it('keeps the menu closed and explains when a machine must be selected first', async () => {
    const disabledReason = 'Select a machine first';
    const view = await render({ disabledReason });
    const trigger = view.querySelector<HTMLButtonElement>(
      'button[aria-label="Provider and model"]'
    );
    expect(trigger?.getAttribute('aria-disabled')).toBe('true');

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      trigger?.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();

    await act(async () => {
      trigger?.focus();
    });
    await vi.waitFor(() => {
      expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(disabledReason);
    });
  });

  const openMenu = async (view: HTMLElement) => {
    // Radix opens the menu on pointerdown, not click.
    await act(async () => {
      view
        .querySelector('button[aria-label="Provider and model"]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });
    return document.querySelector('[role="menu"]') as HTMLElement;
  };
  it('opens model choices without Role selection or creation', async () => {
    const view = await render();
    const menu = await openMenu(view);
    expect(menu.querySelector('[role="menuitemradio"]')?.textContent).toContain('5.5');
    expect(menu.textContent).not.toMatch(/Role|New role|角色/);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
