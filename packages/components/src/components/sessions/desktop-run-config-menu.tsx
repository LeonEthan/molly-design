import { useMemo, useRef, type ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import {
  Check,
  ChevronDown,
  ListChecks,
  Monitor,
  ShieldAlert,
  Sparkles,
  Zap,
} from '@/ui/icons';
import { MOLLY_UNSELECTED_MODEL } from '@molly/shared/embedded-harness';
import { useTranslation } from 'react-i18next';
import {
  classifyPermissionModeFace,
  type AgentConfigCliType,
  type AgentConfigMeta,
  type MachineId,
} from '@molly/shared';

import { getAllAgentConfigAtom } from '@/atoms';
import { getModeIcon as getPermissionModeIcon } from '@/components/chat/chat-landing-selectors';
import { AgentIcon } from '@/components/icons/agent-icon';
import {
  RecentRunConfigMenuGroup,
  type RecentRunConfigItem,
} from '@/components/sessions/recent-run-config-menu-group';
import {
  resolveConfigOptionValue,
  resolveOnOffConfigOptionEnabled,
  resolvePlanModeSelectorEnabled,
  toggleOnOffConfigOptionValue,
  togglePlanModeSelectorValue,
  type AcpConfigOptionSelector,
  type AcpConfigOptionValue,
  type AcpSelectConfigOptionSelector,
} from '@/components/shared/acp-selector-options';
import type { AcpSessionSelectOption } from '@/components/shared/acp-session-select';
import type { AgentSelection } from '@/components/shared/agent-selector';
import { MenuOptionSearchList } from '@/components/shared/menu-option-search-list';
import {
  DEEPSEEK_DELEGATION_DISCUSSION_URL,
  DeepSeekDelegationWarningContent,
  shouldShowDeepSeekDelegationWarning,
} from '@/components/shared/deepseek-delegation-warning';
import { orderAcpConfigOptionSelectors } from '@/lib/acp-selector-order';
import { openExternalUrl } from '@/lib/native-browser';
import { resolvePermissionModeFace } from '@/lib/permission-mode-face';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { Badge } from '@/ui/badge';
import { Switch } from '@/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';

/**
 * Desktop composer run-config controls. Two buttons on the composer footer:
 *
 *   [ agent icon + model · reasoning ⌄ ]  [ permission icon + name ⌄ ]
 *
 * `DesktopRunConfigMenu` is one flat menu of value rows, each opening a
 * submenu: Agent (only where the caller offers switching), Model (the
 * connection-grouped catalog with search), Reasoning (a stepped effort
 * track), then the Plan/Fast switch rows. Recently-used whole configurations
 * sit on top when the caller has them. `DesktopPermissionModeButton` stays a
 * separate button because permission is the knob users flip most — its face
 * shows the full permission name and opens a flat permission list.
 *
 * Both menus use the app-wide DropdownMenu surface.
 */

/* Option row with a trailing check for the selected value; description under
   the label when present. Selecting keeps the menu (and submenu) OPEN — same
   as the Plan/Fast toggle rows — so several run knobs can be adjusted in one
   visit; the check mark moving is the feedback. Dismiss via Esc/outside. */
function OptionItem({
  icon,
  label,
  description,
  selected,
  disabled,
  onSelect,
}: {
  icon?: ReactNode;
  label: string;
  description?: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      role="menuitemradio"
      aria-checked={selected}
      onSelect={(event) => {
        event.preventDefault();
        onSelect();
      }}
      className="min-h-9 items-start gap-2 rounded-lg px-2.5 py-2 aria-checked:bg-foreground/[0.06]"
    >
      {/* Center the icon/check on the label's first line box (text-[0.8rem] +
          leading-tight = 16px): vertically centered on single-line rows, and
          hugging the first line when a description wraps below. */}
      {icon ? <span className="flex h-4 shrink-0 items-center">{icon}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('truncate leading-tight', selected && 'font-medium')}>{label}</span>
        {description ? (
          <span className="text-xs leading-snug text-muted-foreground">{description}</span>
        ) : null}
      </span>
      {selected ? (
        <span className="flex h-4 shrink-0 items-center">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}

/* Submenu row: label left, current value + chevron right. */
function ValueSubTrigger({
  label,
  value,
  icon,
  leadingIcon,
  disabled = false,
}: {
  label: string;
  value: string | null;
  leadingIcon?: ReactNode;
  /** Rides beside the value, for a row whose value has a mark of its own. */
  icon?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <DropdownMenuSubTrigger className="min-h-9 gap-2.5 rounded-lg pr-2" disabled={disabled}>
      {leadingIcon ? <span className="text-muted-foreground">{leadingIcon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="ml-4 flex min-w-0 max-w-40 items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span className="min-w-0 truncate">{value}</span>
      </span>
    </DropdownMenuSubTrigger>
  );
}

/* Switch row that keeps the menu open on click. The whole row is the control;
   the Switch is a purely visual state indicator (clicks land on the item). */
function ToggleItem({
  icon,
  label,
  checked,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <DropdownMenuItem
      role="menuitemcheckbox"
      aria-checked={checked}
      onSelect={(event) => {
        event.preventDefault();
        onToggle();
      }}
    >
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center',
          checked ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Switch
        checked={checked}
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none ml-4 shrink-0"
      />
    </DropdownMenuItem>
  );
}

/* Compact permission trigger chrome. */
const TRIGGER_CLASS = cn(
  'inline-flex h-7 min-w-0 select-none items-center gap-1.5 rounded-[4px] px-2 text-xs leading-tight',
  'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
  'data-[state=open]:bg-muted data-[state=open]:text-foreground',
  'disabled:cursor-default disabled:opacity-70'
);

export type DesktopMachineMenuOption = {
  value: MachineId;
  label: string;
  disabled?: boolean;
};

export function DesktopMachineMenu({
  value,
  visibleLocalMachineId = null,
  selectedLabel,
  options,
  onChange,
  disabled = false,
  disabledReason,
}: {
  value: MachineId | null;
  visibleLocalMachineId?: MachineId | null;
  selectedLabel?: string | null;
  options: ReadonlyArray<DesktopMachineMenuOption>;
  onChange: (machineId: MachineId) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const { t } = useTranslation();
  const selectedOption = options.find((option) => option.value === value);
  const selectedIsLocal = selectedOption?.value === visibleLocalMachineId;
  const label =
    selectedOption?.label ?? selectedLabel ?? t('chat.machineSelector.placeholder', 'Machine');
  const isDisabled = disabled || options.length === 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-6 min-w-0 select-none items-center gap-1.5 rounded-md bg-input/60 px-2 dark:bg-foreground/[0.08]',
            'text-xs font-normal leading-tight text-foreground/80 transition-colors [&_svg]:text-current [&_svg]:opacity-100',
            'hover:bg-input hover:text-foreground data-[state=open]:bg-input data-[state=open]:text-foreground dark:hover:bg-foreground/[0.12] dark:data-[state=open]:bg-foreground/[0.12]',
            'disabled:cursor-default disabled:opacity-70'
          )}
          disabled={isDisabled}
          title={disabledReason}
          aria-label={t('chat.machineSelector.placeholder', 'Machine')}
        >
          <Monitor className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="max-w-32 truncate">{label}</span>
          {selectedIsLocal ? (
            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
              {t('chat.machineSelector.local', 'Local')}
            </Badge>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        avoidCollisions={false}
        className="min-w-52 max-w-72"
      >
        <DropdownMenuLabel className="px-2.5 pb-1 pt-1.5 text-[0.68rem] font-medium tracking-wide text-muted-foreground/70">
          {t('chat.machineSelector.placeholder', 'Machine')}
        </DropdownMenuLabel>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            disabled={option.disabled}
            onSelect={() => onChange(option.value)}
          >
            <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span
              className={cn('min-w-0 flex-1 truncate', option.value === value && 'font-medium')}
            >
              {option.label}
            </span>
            {option.value === visibleLocalMachineId ? (
              <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
                {t('chat.machineSelector.local', 'Local')}
              </Badge>
            ) : null}
            {option.value === value ? (
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Provider/model and reasoning ─────────────────────────────────── */

export type DesktopRunConfigMenuProps = {
  agentSelection: AgentSelection | null;
  /** Explicit configuration metadata for the selected runtime, never a harness picker. */
  availableAgentConfigs?: ReadonlyArray<AgentConfigMeta>;
  /**
   * Enables the Agent row: picking an entry switches the whole agent (the
   * caller owns the machine scope of `availableAgentConfigs`). Surfaces where
   * the agent is fixed omit the callback and the row stays hidden.
   */
  onAgentChange?: (selection: AgentSelection) => void;
  /** Keep the whole run-config menu inert and explain why on hover/focus. */
  disabledReason?: string;
  agentLocked?: boolean;
  fallbackAgent?: {
    cliType?: AgentConfigCliType | null;
    agentType?: string | null;
  };
  modelOptions: ReadonlyArray<AcpSessionSelectOption>;
  selectedModelId: string | null;
  onModelChange?: (value: string) => void;
  configOptionSelectors?: AcpConfigOptionSelector[];
  configOptionValues?: Record<string, AcpConfigOptionValue>;
  onConfigOptionChange?: (configId: string, value: AcpConfigOptionValue) => void;
  /**
   * Whole run configurations the user recently started a chat with, already
   * filtered (current selection removed, unusable entries dropped) and capped
   * by the caller. Empty renders no section at all.
   */
  recentRunConfigs?: ReadonlyArray<RecentRunConfigItem>;
  onRecentRunConfigSelect?: (id: string) => void;
};

export function DesktopRunConfigMenu({
  agentSelection,
  availableAgentConfigs,
  onAgentChange,
  disabledReason,
  agentLocked = false,
  fallbackAgent,
  modelOptions,
  selectedModelId,
  onModelChange,
  configOptionSelectors = [],
  configOptionValues,
  onConfigOptionChange,
  recentRunConfigs,
  onRecentRunConfigSelect,
}: DesktopRunConfigMenuProps) {
  const { t } = useTranslation();
  const executorConfigs = useAtomValue(getAllAgentConfigAtom);
  const selectableAgentConfigs = availableAgentConfigs ?? executorConfigs;
  const {
    modelSelectors,
    interactionModeSelectors,
    thoughtLevelSelectors,
    planModeSelectors,
    fastModeSelectors,
    otherSelectors,
  } = useMemo(() => orderAcpConfigOptionSelectors(configOptionSelectors), [configOptionSelectors]);
  const extraSelectSelectors = useMemo(
    () =>
      otherSelectors.filter(
        (selector): selector is AcpSelectConfigOptionSelector => selector.type === 'select'
      ),
    [otherSelectors]
  );

  const selectedAgentConfig = useMemo(
    () =>
      agentSelection
        ? selectableAgentConfigs.find(
            (cfg) => cfg.id === agentSelection.agentId && cfg.machineId === agentSelection.machineId
          )
        : null,
    [agentSelection, selectableAgentConfigs]
  );

  /* Model (free-standing modelOptions first, else the model config selector). */
  const modelConfigSelector: AcpSelectConfigOptionSelector | undefined = modelSelectors[0];
  const modelPickerOptions = useMemo(
    () =>
      (modelOptions.length > 0 ? modelOptions : (modelConfigSelector?.options ?? [])).filter(
        (option) => option.value !== MOLLY_UNSELECTED_MODEL
      ),
    [modelConfigSelector, modelOptions]
  );
  const modelValue: string | null =
    modelOptions.length > 0
      ? selectedModelId
      : modelConfigSelector
        ? ((resolveConfigOptionValue(
            modelConfigSelector,
            configOptionValues?.[modelConfigSelector.configId]
          ) as string) ?? null)
        : null;
  const modelLabel =
    modelValue && modelValue !== MOLLY_UNSELECTED_MODEL
      ? (modelPickerOptions.find((opt) => opt.value === modelValue)?.label ?? modelValue)
      : t('chat.runConfig.selectModel', 'Select model');
  const showDeepSeekDelegationWarning = shouldShowDeepSeekDelegationWarning({
    cliType: selectedAgentConfig?.cliType ?? fallbackAgent?.cliType,
    agentType: selectedAgentConfig?.agentType ?? fallbackAgent?.agentType,
    modelId: modelValue,
  });
  const handleModelSelect = (value: string) => {
    if (modelOptions.length > 0) {
      onModelChange?.(value);
    } else if (modelConfigSelector) {
      onConfigOptionChange?.(modelConfigSelector.configId, value as AcpConfigOptionValue);
    }
  };

  /* Provider-specific interaction mode (for example Grok Agent / Plan / Ask). */
  const interactionSelector = interactionModeSelectors[0];
  const interactionValue = interactionSelector
    ? ((resolveConfigOptionValue(
        interactionSelector,
        configOptionValues?.[interactionSelector.configId]
      ) as string) ?? null)
    : null;
  const interactionLabel =
    interactionSelector?.options.find((opt) => opt.value === interactionValue)?.label ??
    interactionValue;

  /* Reasoning (first thought-level select selector). */
  const thinkingSelector = useMemo(
    () =>
      thoughtLevelSelectors.find((s) => s.type === 'select') as
        | AcpSelectConfigOptionSelector
        | undefined,
    [thoughtLevelSelectors]
  );
  const thinkingValue = thinkingSelector
    ? ((resolveConfigOptionValue(
        thinkingSelector,
        configOptionValues?.[thinkingSelector.configId]
      ) as string) ?? null)
    : null;
  const thinkingLabel =
    thinkingSelector?.options.find((opt) => opt.value === thinkingValue)?.label ?? thinkingValue;

  /* Plan / Fast. */
  const planSelector = planModeSelectors[0];
  const planOn = planSelector
    ? resolvePlanModeSelectorEnabled(planSelector, configOptionValues?.[planSelector.configId])
    : false;
  const fastSelector = fastModeSelectors[0];
  const fastOn = fastSelector
    ? resolveOnOffConfigOptionEnabled(fastSelector, configOptionValues?.[fastSelector.configId])
    : false;

  const modelPickerLabel = t('chat.runConfig.modelPickerLabel', 'Provider and model');
  const agentRowLabel = t('chat.runConfig.agentLabel', 'Agent');
  const modelRowLabel = t('chat.runConfig.modelLabel', 'Model');
  const modelSearchPlaceholder = t('chat.runConfig.modelSearchPlaceholder', 'Search models');
  const modelSearchEmptyLabel = t('chat.runConfig.modelSearchEmpty', 'No models match');
  const reasoningLabel = t('chat.runConfig.reasoningLabel', 'Reasoning');
  const planRowLabel = t('chat.mobileNewChat.planModeLabel', 'Plan');
  const fastRowLabel = t('chat.runConfig.fastLabel', 'Fast');

  const selectedModelOption = modelValue
    ? modelPickerOptions.find((opt) => opt.value === modelValue)
    : undefined;
  /* The Model row disambiguates same-named models the way the grouped list
     does — connection first. The trigger pill stays `model · reasoning`. */
  const modelRowValue = selectedModelOption?.group
    ? `${selectedModelOption.group} · ${modelLabel}`
    : modelLabel;

  const effortSelector =
    thinkingSelector && thinkingSelector.options.length > 1 ? thinkingSelector : null;
  const showAgentRow = onAgentChange != null && selectableAgentConfigs.length > 1;

  const hasAnyRow =
    showAgentRow ||
    selectedAgentConfig != null ||
    modelPickerOptions.length > 0 ||
    extraSelectSelectors.length > 0 ||
    interactionSelector != null ||
    thinkingSelector != null ||
    planSelector != null ||
    fastSelector != null;
  if (!hasAnyRow) return null;

  const toggleFast = () => {
    if (!fastSelector) return;
    onConfigOptionChange?.(
      fastSelector.configId,
      toggleOnOffConfigOptionValue(fastSelector, configOptionValues?.[fastSelector.configId])
    );
  };

  const triggerButton = (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'h-7 min-w-0 select-none gap-1.5 rounded-full bg-foreground/[0.04] px-3 text-xs font-normal text-foreground hover:bg-foreground/[0.07] data-[state=open]:bg-foreground/[0.07]',
        disabledReason && 'cursor-default opacity-70 hover:bg-foreground/[0.04]'
      )}
      aria-label={modelPickerLabel}
      aria-disabled={disabledReason ? true : undefined}
    >
      {selectedAgentConfig ? (
        <AgentIcon
          cliType={selectedAgentConfig.cliType}
          agentType={selectedAgentConfig.agentType}
          brandId={selectedAgentConfig.brandId}
          env={selectedAgentConfig.env}
          className="size-3.5 shrink-0"
        />
      ) : (
        <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span className="block min-w-0 max-w-64 truncate text-left" title={modelLabel}>
        {modelLabel}
      </span>
      {thinkingLabel ? (
        <span className="shrink-0 text-muted-foreground">· {thinkingLabel}</span>
      ) : null}
      {planOn ? (
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      ) : null}
      {fastOn ? <Zap className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" /> : null}
      <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
    </Button>
  );

  return (
    <DropdownMenu>
      {disabledReason ? (
        <Tooltip delayDuration={300}>
          {/* A native disabled button cannot reliably trigger hover/focus events.
              Keep this focusable but outside DropdownMenuTrigger so it stays inert. */}
          <TooltipTrigger asChild>{triggerButton}</TooltipTrigger>
          <TooltipContent side="top">{disabledReason}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-24px)] rounded-2xl p-1.5">
        {onRecentRunConfigSelect ? (
          <RecentRunConfigMenuGroup
            items={recentRunConfigs ?? []}
            onSelect={onRecentRunConfigSelect}
          />
        ) : null}
        {showAgentRow ? (
          <DropdownMenuSub>
            <ValueSubTrigger
              label={agentRowLabel}
              value={selectedAgentConfig?.name ?? null}
              leadingIcon={
                selectedAgentConfig ? (
                  <AgentIcon
                    cliType={selectedAgentConfig.cliType}
                    agentType={selectedAgentConfig.agentType}
                    brandId={selectedAgentConfig.brandId}
                    env={selectedAgentConfig.env}
                    className="size-4"
                  />
                ) : undefined
              }
            />
            <DropdownMenuSubContent className="w-64">
              {selectableAgentConfigs.map((config) => (
                <OptionItem
                  key={`${config.machineId}:${config.id}`}
                  icon={
                    <AgentIcon
                      cliType={config.cliType}
                      agentType={config.agentType}
                      brandId={config.brandId}
                      env={config.env}
                      className="h-4 w-4"
                    />
                  }
                  label={config.name}
                  selected={
                    agentSelection?.agentId === config.id &&
                    agentSelection?.machineId === config.machineId
                  }
                  onSelect={() =>
                    onAgentChange?.({ agentId: config.id, machineId: config.machineId })
                  }
                />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuSub>
          <ValueSubTrigger label={modelRowLabel} value={modelRowValue} />
          <DropdownMenuSubContent className="flex w-72 flex-col overflow-hidden p-0">
            <MenuOptionSearchList
              options={modelPickerOptions}
              onSelect={(opt) => handleModelSelect(opt.value)}
              searchPlaceholder={modelSearchPlaceholder}
              emptyText={
                modelPickerOptions.length
                  ? modelSearchEmptyLabel
                  : t(
                      'chat.runConfig.noModels',
                      'Add a model connection in Settings to get started.'
                    )
              }
              renderOption={(opt, select) => (
                <OptionItem
                  key={opt.value}
                  label={opt.label}
                  selected={opt.value === modelValue}
                  disabled={opt.disabled}
                  onSelect={select}
                />
              )}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {effortSelector ? (
          <DropdownMenuSub>
            <ValueSubTrigger label={reasoningLabel} value={thinkingLabel} />
            <DropdownMenuSubContent className="w-64">
              <div className="px-2 pb-1 pt-2.5 text-center text-base font-medium leading-tight text-primary">
                {thinkingLabel}
              </div>
              <EffortSlider
                label={reasoningLabel}
                options={effortSelector.options}
                value={thinkingValue}
                onChange={(value) =>
                  onConfigOptionChange?.(effortSelector.configId, value as AcpConfigOptionValue)
                }
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}

        {showDeepSeekDelegationWarning ? (
          <DropdownMenuItem
            asChild
            className="mx-1 my-1 max-w-72 items-start gap-2 whitespace-normal border border-status-warning/30 bg-status-warning/[0.08] px-2.5 py-2 focus:bg-status-warning/[0.14]"
          >
            <a
              href={DEEPSEEK_DELEGATION_DISCUSSION_URL}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                event.preventDefault();
                void openExternalUrl(DEEPSEEK_DELEGATION_DISCUSSION_URL);
              }}
            >
              <DeepSeekDelegationWarningContent />
            </a>
          </DropdownMenuItem>
        ) : null}

        {interactionSelector ? (
          <DropdownMenuSub>
            <ValueSubTrigger label={interactionSelector.label} value={interactionLabel} />
            <DropdownMenuSubContent>
              {interactionSelector.options.map((opt) => (
                <OptionItem
                  key={opt.value}
                  label={opt.label}
                  description={opt.description}
                  selected={opt.value === interactionValue}
                  disabled={opt.disabled}
                  onSelect={() =>
                    onConfigOptionChange?.(
                      interactionSelector.configId,
                      opt.value as AcpConfigOptionValue
                    )
                  }
                />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}

        {extraSelectSelectors.map((selector) => {
          const selectedValue =
            (resolveConfigOptionValue(
              selector,
              configOptionValues?.[selector.configId]
            ) as string) ?? null;
          const selectedLabel =
            selector.options.find((option) => option.value === selectedValue)?.label ??
            selectedValue;
          const locked = selector.configId === 'agent_preset' && agentLocked;
          return (
            <DropdownMenuSub key={selector.configId}>
              <ValueSubTrigger label={selector.label} value={selectedLabel} disabled={locked} />
              <DropdownMenuSubContent>
                {selector.options.map((option) => (
                  <OptionItem
                    key={option.value}
                    label={option.label}
                    description={option.description}
                    selected={option.value === selectedValue}
                    disabled={option.disabled || locked}
                    onSelect={() =>
                      onConfigOptionChange?.(selector.configId, option.value as AcpConfigOptionValue)
                    }
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}

        {planSelector || fastSelector ? <DropdownMenuSeparator /> : null}
        {planSelector ? (
          <ToggleItem
            icon={<ListChecks className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}
            label={planRowLabel}
            checked={planOn}
            onToggle={() =>
              onConfigOptionChange?.(
                planSelector.configId,
                togglePlanModeSelectorValue(planSelector, configOptionValues?.[planSelector.configId])
              )
            }
          />
        ) : null}
        {fastSelector ? (
          <ToggleItem
            icon={<Zap className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}
            label={fastRowLabel}
            checked={fastOn}
            onToggle={toggleFast}
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* Discrete reasoning-effort track inside the Reasoning submenu: one stop per
   option, a thumb on the current one. It is plain submenu content, so it owns
   its arrow keys rather than letting the menu's roving focus take them —
   ArrowLeft would otherwise close the submenu. */
function EffortSlider({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<AcpSessionSelectOption>;
  value: string | null;
  onChange: (value: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const lastIndex = options.length - 1;
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const select = (next: number) => {
    const clamped = Math.min(lastIndex, Math.max(0, next));
    const option = options[clamped];
    if (option && clamped !== index && !option.disabled) onChange(option.value);
  };
  const indexAt = (clientX: number) => {
    const bounds = trackRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= EFFORT_THUMB_PX) return index;
    const ratio = (clientX - bounds.left - EFFORT_THUMB_PX / 2) / (bounds.width - EFFORT_THUMB_PX);
    return Math.round(Math.min(1, Math.max(0, ratio)) * lastIndex);
  };
  const stopLeft = (stop: number) =>
    `calc(${EFFORT_THUMB_PX / 2}px + (100% - ${EFFORT_THUMB_PX}px) * ${lastIndex ? stop / lastIndex : 0})`;

  return (
    <div className="px-2 pb-2 pt-3">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={lastIndex}
        aria-valuenow={index}
        aria-valuetext={options[index]?.label}
        className="relative h-7 cursor-pointer touch-none rounded-full bg-foreground/[0.07] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onKeyDown={(event) => {
          const step =
            event.key === 'ArrowRight' || event.key === 'ArrowUp'
              ? 1
              : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
                ? -1
                : null;
          if (step !== null) select(index + step);
          else if (event.key === 'Home') select(0);
          else if (event.key === 'End') select(lastIndex);
          else return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          select(indexAt(event.clientX));
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            select(indexAt(event.clientX));
          }
        }}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 rounded-full bg-primary dark:bg-foreground/40"
          style={{ width: `calc(${stopLeft(index)} + ${EFFORT_THUMB_PX / 2}px)` }}
        />
        {options.map((option, stop) => (
          <span
            key={option.value}
            aria-hidden="true"
            className={cn(
              'absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full',
              stop <= index ? 'bg-primary-foreground/60' : 'bg-muted-foreground/50'
            )}
            style={{ left: stopLeft(stop) }}
          />
        ))}
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/10 bg-white shadow-md transition-[left] duration-150"
          style={{ left: stopLeft(index) }}
        />
      </div>
    </div>
  );
}

const EFFORT_THUMB_PX = 32;

/* ── Permission mode (standalone button) ─────────────────────────────── */

/* Warning-tone modes (full access / skip permissions) share the amber shield
   with the mobile face; everything else keeps its neutral per-mode icon. */
function permissionModeIcon(modeId: string | null): ReactNode {
  const face = classifyPermissionModeFace(modeId);
  if (face.kind !== 'hidden' && face.tone === 'warning') {
    return <ShieldAlert className="h-4 w-4 shrink-0 text-status-warning" />;
  }
  return getPermissionModeIcon(modeId);
}

export type DesktopPermissionModeButtonProps = {
  modeOptions: ReadonlyArray<AcpSessionSelectOption>;
  selectedModeId: string | null;
  onModeChange?: (value: string) => void;
  configOptionSelectors?: AcpConfigOptionSelector[];
  configOptionValues?: Record<string, AcpConfigOptionValue>;
  onConfigOptionChange?: (configId: string, value: AcpConfigOptionValue) => void;
};

export function DesktopPermissionModeButton({
  modeOptions,
  selectedModeId,
  onModeChange,
  configOptionSelectors = [],
  configOptionValues,
  onConfigOptionChange,
}: DesktopPermissionModeButtonProps) {
  const { t } = useTranslation();
  const { options, value, label, source } = useMemo(
    () =>
      resolvePermissionModeFace({
        modeOptions,
        selectedModeId,
        configOptionSelectors,
        configOptionValues,
      }),
    [configOptionSelectors, configOptionValues, modeOptions, selectedModeId]
  );
  const permissionLabel = t('chat.runConfig.permissionLabel', 'Permission');

  if (options.length === 0) return null;

  const handleSelect = (next: string) => {
    if (source?.kind === 'configOption') {
      onConfigOptionChange?.(source.configId, next as AcpConfigOptionValue);
    } else if (source?.kind === 'modeId') {
      onModeChange?.(next);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={TRIGGER_CLASS} aria-label={permissionLabel}>
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            {permissionModeIcon(value ?? null)}
          </span>
          {/* Full mode name on desktop; truncates when the row runs tight. */}
          <span className="min-w-0 max-w-36 truncate">{label ?? permissionLabel}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52 max-w-80">
        <DropdownMenuLabel className="px-2.5 pb-1 pt-1.5 text-[0.68rem] font-medium tracking-wide text-muted-foreground/70">
          {permissionLabel}
        </DropdownMenuLabel>
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            disabled={opt.disabled}
            onSelect={() => handleSelect(opt.value)}
            className="items-start"
          >
            <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              {permissionModeIcon(opt.value)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cn('truncate', opt.value === value && 'font-medium')}>
                {opt.label}
              </span>
              {opt.description ? (
                // Safety copy (e.g. the Full-access warning) must stay readable
                // — wrap instead of truncating.
                <span className="text-xs leading-snug text-muted-foreground">
                  {opt.description}
                </span>
              ) : null}
            </span>
            {opt.value === value ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
