// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { type AgentConfigId, type AgentConfigMeta, type MachineId } from '@molly/shared';
import { encodeMollyModelOption, MOLLY_UNSELECTED_MODEL } from '@molly/shared/embedded-harness';

vi.mock('../src/components/mentions/mention-session-source', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSessionMentionItems: () => [],
}));
vi.mock('../src/components/mentions/mention-agent-role-source', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAgentRoleMentionItems: () => [],
}));
import { ChatComposer } from '../src/components/chat/chat-composer';
import { DesktopRunConfigMenu } from '../src/components/sessions/desktop-run-config-menu';
import { initI18n } from '../src/i18n';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout, so nothing can be scrolled into view.
Element.prototype.scrollIntoView = () => undefined;

const machineId = 'machine-1' as MachineId;
const agentConfig: AgentConfigMeta = {
  id: 'config-1' as AgentConfigId,
  machineId,
  name: 'Codex',
  description: undefined,
  cliType: 'builtin',
  agentType: 'codex',
  env: {},
};
const deepseekAgentConfig: AgentConfigMeta = {
  ...agentConfig,
  id: 'config-deepseek' as AgentConfigId,
  name: 'DeepSeek Harness',
  agentType: 'deepseek',
};
const deepseekModels = [
  { value: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro' },
];

/* A provider that publishes far more models than a list can be scanned for —
   the case the search field exists for. */
const manyModels = [
  { value: 'claude-opus-5', label: 'Opus 5' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'gpt-5.5-codex', label: 'GPT-5.5 Codex' },
  { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
  { value: 'grok-4', label: 'Grok 4' },
  { value: 'kimi-k2', label: 'Kimi K2' },
];
const fewModels = manyModels.slice(0, 2);

const typeInto = async (input: HTMLInputElement, value: string) => {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('composer model picker search', () => {
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

  /* ── Desktop: direct provider/model choices ── */

  type MenuProps = ComponentProps<typeof DesktopRunConfigMenu>;
  const desktopProps: MenuProps = {
    agentSelection: { agentId: agentConfig.id, machineId },
    availableAgentConfigs: [agentConfig],
    modelOptions: manyModels,
    selectedModelId: 'claude-sonnet-5',
    onModelChange: () => undefined,
    configOptionSelectors: [],
    configOptionValues: {},
    onConfigOptionChange: () => undefined,
  };

  const openModelMenu = async (props: Partial<MenuProps> = {}) => {
    await act(async () => {
      root?.render(createElement(DesktopRunConfigMenu, { ...desktopProps, ...props }));
    });
    // Radix opens the menu on pointerdown, not click.
    await act(async () => {
      container
        ?.querySelector('button[aria-label="Provider and model"]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search models"]');
    return {
      search,
      // The first menu exposes the model choices directly.
      rows: () => {
        const submenu = search
          ? search.closest('[data-radix-menu-content]')
          : [...document.querySelectorAll('[data-radix-menu-content]')].at(-1);
        return [...(submenu?.querySelectorAll('[role="menuitemradio"]') ?? [])].map((node) =>
          node.textContent?.trim()
        );
      },
    };
  };

  it('opens the model picker with every model and a way to search them', async () => {
    const { search, rows } = await openModelMenu();
    expect(search).not.toBeNull();
    expect(rows()).toHaveLength(manyModels.length);
  });

  it('selects the exact connection when two connections expose the same model', async () => {
    const onModelChange = vi.fn();
    const studio = encodeMollyModelOption('studio', 'aurora/1');
    const review = encodeMollyModelOption('review', 'aurora/1');
    await openModelMenu({
      availableAgentConfigs: [{ ...agentConfig, name: 'Molly', agentType: 'molly' }],
      modelOptions: [
        { value: MOLLY_UNSELECTED_MODEL, label: 'Select a connection and model' },
        { value: studio, label: 'Studio · Aurora 1' },
        { value: review, label: 'Review · Aurora 1' },
      ],
      selectedModelId: studio,
      onModelChange,
    });
    const menu = document.querySelector('[role="menu"]');
    const rows = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    expect(rows.map((row) => row.textContent)).toEqual(['Studio · Aurora 1', 'Review · Aurora 1']);
    expect(rows[0]?.getAttribute('aria-checked')).toBe('true');
    expect(menu?.querySelector('[role="menuitem"]')).toBeNull();
    await act(async () => {
      rows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onModelChange).toHaveBeenCalledWith(review);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('shows an actionable empty state instead of offering the unselected sentinel', async () => {
    const { rows } = await openModelMenu({
      availableAgentConfigs: [{ ...agentConfig, name: 'Molly', agentType: 'molly' }],
      modelOptions: [{ value: MOLLY_UNSELECTED_MODEL, label: 'Select a connection and model' }],
      selectedModelId: MOLLY_UNSELECTED_MODEL,
    });
    expect(container?.textContent).toContain('Select model');
    expect(rows()).toEqual([]);
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      'Add a model connection in Settings to get started.'
    );
  });

  it('retains reasoning as a separately selectable configuration', async () => {
    const onConfigOptionChange = vi.fn();
    await openModelMenu({
      modelOptions: fewModels,
      onConfigOptionChange,
      configOptionSelectors: [
        {
          type: 'select',
          configId: 'reasoning_effort',
          category: 'thought_level',
          label: 'Reasoning',
          currentValue: 'medium',
          options: [
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ],
        },
      ],
    });
    const reasoning = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((row) =>
      row.textContent?.startsWith('Reasoning')
    );
    expect(container?.textContent).toContain('Medium');
    await act(async () => {
      reasoning?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const high = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (row) => row.textContent === 'High'
    );
    expect(high).toBeDefined();
    await act(async () => {
      high?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onConfigOptionChange).toHaveBeenCalledWith('reasoning_effort', 'high');
  });

  it('narrows the list to fuzzy matches as the user types', async () => {
    const { search, rows } = await openModelMenu();
    // Not a substring of the label OR the id — a subsequence of both.
    await typeInto(search as HTMLInputElement, 'op5');
    expect(rows()).toEqual(['Opus 5']);
  });

  it('finds a model by its id, which the row does not even show', async () => {
    const { search, rows } = await openModelMenu();
    await typeInto(search as HTMLInputElement, 'haiku-4');
    expect(rows()).toEqual(['Haiku 4.5']);
  });

  it('says so when nothing matches instead of showing an empty menu', async () => {
    const { search, rows } = await openModelMenu();
    await typeInto(search as HTMLInputElement, 'zzz');
    expect(rows()).toEqual([]);
    const submenu = (search as HTMLInputElement).closest('[data-radix-menu-content]');
    expect(submenu?.textContent).toContain('No models match');
  });

  it('takes the top match on Enter, so a search never needs the mouse', async () => {
    const onModelChange = vi.fn();
    const { search } = await openModelMenu({ onModelChange });
    await typeInto(search as HTMLInputElement, 'grok');
    await act(async () => {
      (search as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    });
    expect(onModelChange).toHaveBeenCalledWith('grok-4');
  });

  it('moves into the list on ArrowDown, since the field is not a menu row', async () => {
    const { search } = await openModelMenu();
    await act(async () => {
      (search as HTMLInputElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      );
    });
    const submenu = (search as HTMLInputElement).closest('[data-radix-menu-content]');
    expect(document.activeElement).toBe(submenu?.querySelector('[role="menuitemradio"]'));
  });

  /* The pointer moving over the list takes focus off the field (Radix focuses
     the row under the cursor). Typing then has to keep filtering — otherwise it
     drives the menu's own typeahead and the search box looks broken. */
  it('keeps typing in the search field when focus has moved onto a row', async () => {
    const { search, rows } = await openModelMenu();
    const submenu = (search as HTMLInputElement).closest('[data-radix-menu-content]');
    const firstRow = submenu?.querySelector<HTMLElement>('[role="menuitemradio"]');
    await act(async () => {
      firstRow?.focus();
      firstRow?.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    });
    expect((search as HTMLInputElement).value).toBe('k');
    expect(rows()[0]).toBe('Kimi K2');
    expect(rows()).not.toContain('Opus 5');
    expect(document.activeElement).toBe(search);
  });

  it('leaves a short list alone — a search field there costs more than it saves', async () => {
    const { search, rows } = await openModelMenu({
      modelOptions: fewModels,
      selectedModelId: fewModels[0]?.value ?? null,
    });
    expect(search).toBeNull();
    expect(rows()).toHaveLength(fewModels.length);
  });

  it('links the upstream delegation warning for a builtin DeepSeek non-Pro model', async () => {
    await act(async () => {
      root?.render(
        createElement(DesktopRunConfigMenu, {
          ...desktopProps,
          agentSelection: { agentId: deepseekAgentConfig.id, machineId },
          availableAgentConfigs: [deepseekAgentConfig],
          modelOptions: deepseekModels,
          selectedModelId: 'deepseek-v4-flash',
        })
      );
    });
    await act(async () => {
      container
        ?.querySelector('button[aria-label="Provider and model"]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });

    const warning = document.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com/deepseek-ai/deepseek-harness/discussions/4065"]'
    );
    expect(warning?.textContent).toContain('delegated subagents may use');
    expect(warning?.textContent).toContain('Upstream discussion');
  });

  it('does not warn when the builtin DeepSeek session already uses Pro', async () => {
    await act(async () => {
      root?.render(
        createElement(DesktopRunConfigMenu, {
          ...desktopProps,
          agentSelection: { agentId: deepseekAgentConfig.id, machineId },
          availableAgentConfigs: [deepseekAgentConfig],
          modelOptions: deepseekModels,
          selectedModelId: 'deepseek-v4-pro',
        })
      );
    });
    await act(async () => {
      container
        ?.querySelector('button[aria-label="Provider and model"]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });

    expect(
      document.querySelector(
        'a[href="https://github.com/deepseek-ai/deepseek-harness/discussions/4065"]'
      )
    ).toBeNull();
  });

  it('does not steal focus to composer textarea when clicking search input inside ChatComposer with focusOnContainerClick', async () => {
    const textareaRef = { current: null as HTMLTextAreaElement | null };
    await act(async () => {
      root?.render(
        createElement(ChatComposer, {
          promptRef: textareaRef,
          promptValue: '',
          onPromptChange: () => undefined,
          focusOnContainerClick: true,
          footerSelector: createElement(DesktopRunConfigMenu, desktopProps),
        })
      );
    });
    // Open menu on pointerdown
    await act(async () => {
      container
        ?.querySelector('button[aria-label="Provider and model"]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search models"]');
    expect(search).not.toBeNull();

    // Click directly on search input
    await act(async () => {
      search?.focus();
      search?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Verify search input retained focus and textarea did NOT steal focus
    expect(document.activeElement).toBe(search);
    expect(document.activeElement).not.toBe(textareaRef.current);
  });
});
