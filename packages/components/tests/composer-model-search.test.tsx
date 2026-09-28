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

  /* ── Desktop: value-row menu (Provider / Model / Reasoning) ── */

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

  const menuContents = () => [...document.querySelectorAll('[data-radix-menu-content]')];
  /** The root menu holds the value rows; the most recently opened content is
     the submenu under test. */
  const submenuContent = () => menuContents().at(-1) ?? null;

  const openRunConfigMenu = async (props: Partial<MenuProps> = {}) => {
    await act(async () => {
      root?.render(createElement(DesktopRunConfigMenu, { ...desktopProps, ...props }));
    });
    // Radix opens the menu on pointerdown, not click.
    await act(async () => {
      container
        ?.querySelector('button[aria-label="Provider and model"]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });
  };

  /* Value rows open their submenu on ArrowRight, like any submenu. */
  const openSubmenu = async (label: string) => {
    const rootMenu = menuContents()[0];
    const row = [...(rootMenu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find(
      (el) => el.textContent?.startsWith(label)
    );
    if (!row) throw new Error(`run-config menu has no "${label}" row`);
    await act(async () => {
      row.focus();
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    return submenuContent();
  };

  const openModelMenu = async (props: Partial<MenuProps> = {}) => {
    await openRunConfigMenu(props);
    await openSubmenu('Model');
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search models"]');
    return {
      search,
      rows: () =>
        [...(submenuContent()?.querySelectorAll('[role="menuitemradio"]') ?? [])].map((node) =>
          node.textContent?.trim()
        ),
    };
  };

  it('opens the model picker with every model and a way to search them', async () => {
    const { search, rows } = await openModelMenu();
    expect(search).not.toBeNull();
    expect(rows()).toHaveLength(manyModels.length);
  });

  /* Two connections exposing the same model name — the case the Provider row
     and the connection group exist for. */
  const studio = encodeMollyModelOption('studio', 'aurora/1');
  const review = encodeMollyModelOption('review', 'aurora/1');
  const nimbus = encodeMollyModelOption('review', 'nimbus/2');
  const twoProviderModels = [
    { value: studio, label: 'Aurora 1', description: 'aurora/1', group: 'Studio' },
    { value: review, label: 'Aurora 1', description: 'aurora/1', group: 'Review' },
    { value: nimbus, label: 'Nimbus 2', description: 'nimbus/2', group: 'Review' },
  ];
  const mollyConfig: AgentConfigMeta = { ...agentConfig, name: 'Molly', agentType: 'molly' };
  const mollyProps: Partial<MenuProps> = {
    availableAgentConfigs: [mollyConfig],
    agentSelection: { agentId: mollyConfig.id, machineId },
  };

  const clickRow = async (row: HTMLElement | undefined) => {
    await act(async () => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };
  const radioRows = (content: Element | null) => [
    ...(content?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
  ];

  it('scopes the Model row to the provider picked on the Provider row', async () => {
    const onModelChange = vi.fn();
    await openRunConfigMenu({
      ...mollyProps,
      modelOptions: twoProviderModels,
      selectedModelId: studio,
      onModelChange,
    });
    /* The scope follows the selected model's provider. */
    const providerRows = radioRows(await openSubmenu('Provider'));
    expect(providerRows.map((row) => row.textContent)).toEqual([
      'All providers',
      'Studio',
      'Review',
    ]);
    expect(providerRows[1]?.getAttribute('aria-checked')).toBe('true');

    await clickRow(providerRows[2]);
    const modelRows = radioRows(await openSubmenu('Model'));
    expect(modelRows.map((row) => row.textContent)).toEqual(['Aurora 1', 'Nimbus 2']);
    /* Same label as the Studio model, but the exact Review value is picked. */
    await clickRow(modelRows[0]);
    expect(onModelChange).toHaveBeenCalledWith(review);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('restores the full grouped catalog from All providers', async () => {
    await openRunConfigMenu({
      ...mollyProps,
      modelOptions: twoProviderModels,
      selectedModelId: studio,
    });
    const providerRows = radioRows(await openSubmenu('Provider'));
    await clickRow(providerRows[0]);
    const submenu = await openSubmenu('Model');
    expect(radioRows(submenu).map((row) => row.textContent)).toEqual([
      'Aurora 1',
      'Aurora 1',
      'Nimbus 2',
    ]);
    expect(submenu?.textContent).toContain('Studio');
    expect(submenu?.textContent).toContain('Review');
    expect(submenu?.querySelector('[role="menuitem"]')).toBeNull();
  });

  it('hides the Provider row when every model comes from one provider', async () => {
    await openRunConfigMenu({
      ...mollyProps,
      modelOptions: [twoProviderModels[0]!, twoProviderModels[2]!].map((option) => ({
        ...option,
        group: 'Studio',
      })),
      selectedModelId: studio,
    });
    const rootMenu = menuContents()[0];
    const providerRow = [...(rootMenu?.querySelectorAll('[role="menuitem"]') ?? [])].find((el) =>
      el.textContent?.startsWith('Provider')
    );
    expect(providerRow).toBeUndefined();
  });

  it('shows an actionable empty state instead of offering the unselected sentinel', async () => {
    const { rows } = await openModelMenu({
      availableAgentConfigs: [{ ...agentConfig, name: 'Molly', agentType: 'molly' }],
      modelOptions: [{ value: MOLLY_UNSELECTED_MODEL, label: 'Select a connection and model' }],
      selectedModelId: MOLLY_UNSELECTED_MODEL,
    });
    expect(container?.textContent).toContain('Select model');
    expect(rows()).toEqual([]);
    expect(submenuContent()?.textContent).toContain(
      'Add a model connection in Settings to get started.'
    );
  });

  const reasoningSelector = {
    type: 'select' as const,
    configId: 'reasoning_effort',
    category: 'thought_level',
    label: 'Reasoning',
    currentValue: 'medium',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
  };

  it('lists reasoning levels as options on the Reasoning row', async () => {
    const onConfigOptionChange = vi.fn();
    await openRunConfigMenu({
      modelOptions: fewModels,
      selectedModelId: 'claude-opus-5',
      onConfigOptionChange,
      configOptionSelectors: [reasoningSelector],
    });
    const trigger = container?.querySelector('button[aria-label="Provider and model"]');
    expect(trigger?.textContent).toContain('Opus 5');
    expect(trigger?.textContent).toContain('Medium');
    expect(document.querySelector('[role="slider"]')).toBeNull();
    const rows = radioRows(await openSubmenu('Reasoning'));
    expect(rows.map((row) => row.textContent)).toEqual(['Low', 'Medium', 'High']);
    expect(rows[1]?.getAttribute('aria-checked')).toBe('true');
    await clickRow(rows[2]);
    expect(onConfigOptionChange).toHaveBeenCalledWith('reasoning_effort', 'high');
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
  });

  it('picks a model from the Model row list, keeping the menu open', async () => {
    const onModelChange = vi.fn();
    await openModelMenu({
      modelOptions: fewModels,
      selectedModelId: 'claude-opus-5',
      onModelChange,
      configOptionSelectors: [reasoningSelector],
    });
    const rows = [
      ...(submenuContent()?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
    ];
    expect(rows.map((row) => row.textContent)).toEqual(['Opus 5', 'Sonnet 5']);
    await act(async () => {
      rows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onModelChange).toHaveBeenCalledWith('claude-sonnet-5');
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
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

  it('groups connection models and finds them by raw id or connection without showing the id', async () => {
    const connectionModels = ['Studio', 'Review', 'Archive'].flatMap((connection) =>
      ['aurora/1', 'nimbus/2'].map((modelId) => ({
        value: encodeMollyModelOption(connection.toLowerCase(), modelId),
        label: modelId === 'aurora/1' ? 'Aurora 1' : 'Nimbus 2',
        description: modelId,
        group: connection,
      }))
    );
    const { search, rows } = await openModelMenu({
      availableAgentConfigs: [{ ...agentConfig, name: 'Molly', agentType: 'molly' }],
      modelOptions: connectionModels,
      /* No selection yet: the Model row shows the whole catalog, grouped. */
      selectedModelId: null,
    });
    const groupLabels = () =>
      [...(submenuContent()?.querySelectorAll('div') ?? [])]
        .map((node) => node.textContent?.trim())
        .filter((text) => text === 'Studio' || text === 'Review' || text === 'Archive');
    expect(rows()).toEqual(connectionModels.map((option) => option.label));
    expect(groupLabels()).toEqual(['Studio', 'Review', 'Archive']);
    await typeInto(search as HTMLInputElement, 'nimbus/2');
    expect(rows()).toEqual(['Nimbus 2', 'Nimbus 2', 'Nimbus 2']);
    await typeInto(search as HTMLInputElement, 'archive');
    expect(rows()).toEqual(['Aurora 1', 'Nimbus 2']);
    expect(groupLabels()).toEqual(['Archive']);
  });

  it('says so when nothing matches instead of showing an empty menu', async () => {
    const { search, rows } = await openModelMenu();
    await typeInto(search as HTMLInputElement, 'zzz');
    expect(rows()).toEqual([]);
    expect(submenuContent()?.textContent).toContain('No models match');
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
    expect(document.activeElement).toBe(submenuContent()?.querySelector('[role="menuitemradio"]'));
  });

  /* The pointer moving over the list takes focus off the field (Radix focuses
     the row under the cursor). Typing then has to keep filtering — otherwise it
     drives the menu's own typeahead and the search box looks broken. */
  it('keeps typing in the search field when focus has moved onto a row', async () => {
    const { search, rows } = await openModelMenu();
    const firstRow = submenuContent()?.querySelector<HTMLElement>('[role="menuitemradio"]');
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
    await openRunConfigMenu({
      agentSelection: { agentId: deepseekAgentConfig.id, machineId },
      availableAgentConfigs: [deepseekAgentConfig],
      modelOptions: deepseekModels,
      selectedModelId: 'deepseek-v4-flash',
    });

    const warning = document.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com/deepseek-ai/deepseek-harness/discussions/4065"]'
    );
    expect(warning?.textContent).toContain('delegated subagents may use');
    expect(warning?.textContent).toContain('Upstream discussion');
  });

  it('does not warn when the builtin DeepSeek session already uses Pro', async () => {
    await openRunConfigMenu({
      agentSelection: { agentId: deepseekAgentConfig.id, machineId },
      availableAgentConfigs: [deepseekAgentConfig],
      modelOptions: deepseekModels,
      selectedModelId: 'deepseek-v4-pro',
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
    await openSubmenu('Model');
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
