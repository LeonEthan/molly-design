import { useMemo, type ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import {
  Brain,
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
 *   [ model icon + connection/model · reasoning ⌄ ]  [ permission icon + name ⌄ ]
 *
 * `DesktopRunConfigMenu` opens the connection/model catalog directly;
 * Reasoning and other supported run options remain beside that list.
 * `DesktopPermissionModeButton` stays a separate button because permission is
 * the knob users flip most — its face shows the full permission name and opens
 * a flat permission list.
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

  const configFaceParts: ReactNode[] = [];
  if (modelLabel) {
    configFaceParts.push(
      <span key="model" className="block min-w-0 max-w-64 truncate text-left" title={modelLabel}>
        {modelLabel}
      </span>
    );
  }
  if (thinkingLabel) {
    configFaceParts.push(
      <span
        key="thinking"
        className="shrink-0 rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] leading-4"
      >
        {thinkingLabel}
      </span>
    );
  }
  if (planOn) {
    configFaceParts.push(
      <ListChecks key="plan" className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
    );
  }
  if (fastOn) {
    configFaceParts.push(
      <Zap key="fast" className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
    );
  }
  const withFaceDots = (parts: ReactNode[], leadingDot: boolean): ReactNode[] =>
    parts.flatMap((part, index) =>
      index === 0 && !leadingDot ? [part] : [<FaceDot key={`dot-${index}`} />, part]
    );

  const modelRowLabel = t('chat.runConfig.modelPickerLabel', 'Provider and model');
  const modelSearchPlaceholder = t('chat.runConfig.modelSearchPlaceholder', 'Search models');
  const modelSearchEmptyLabel = t('chat.runConfig.modelSearchEmpty', 'No models match');
  const reasoningLabel = t('chat.runConfig.reasoningLabel', 'Reasoning');
  const planRowLabel = t('chat.mobileNewChat.planModeLabel', 'Plan');
  const fastRowLabel = t('chat.runConfig.fastLabel', 'Fast');

  const hasAnyRow =
    selectedAgentConfig != null ||
    modelPickerOptions.length > 0 ||
    extraSelectSelectors.length > 0 ||
    interactionSelector != null ||
    thinkingSelector != null ||
    planSelector != null ||
    fastSelector != null;
  if (!hasAnyRow) return null;

  const runConfigButtonAriaLabel = modelRowLabel;
  const triggerButton = (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'h-7 min-w-0 select-none gap-1.5 rounded-full bg-foreground/[0.04] px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground data-[state=open]:bg-hover data-[state=open]:text-foreground',
        disabledReason &&
          'cursor-default opacity-70 hover:bg-transparent hover:text-muted-foreground'
      )}
      aria-label={runConfigButtonAriaLabel}
      aria-disabled={disabledReason ? true : undefined}
    >
      <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
      {withFaceDots(configFaceParts, false)}
      <ChevronDown aria-hidden="true" className="size-3 shrink-0 opacity-60" />
    </Button>
  );

  const menu = (
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
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-24px)] rounded-xl p-1.5">
        <DropdownMenuLabel className="px-3 pb-1 pt-2 text-[11px] font-normal normal-case tracking-normal">
          {modelRowLabel}
        </DropdownMenuLabel>
        <div className="flex max-h-72 min-h-0 flex-col overflow-hidden">
          <MenuOptionSearchList
            options={modelPickerOptions}
            onSelect={(opt) => handleModelSelect(opt.value)}
            searchPlaceholder={modelSearchPlaceholder}
            emptyText={
              modelPickerOptions.length
                ? modelSearchEmptyLabel
                : t('chat.runConfig.noModels', 'Add a model connection in Settings to get started.')
            }
            renderOption={(opt, select) => (
              <OptionItem
                key={opt.value}
                label={opt.label}
                description={opt.description}
                selected={opt.value === modelValue}
                disabled={opt.disabled}
                onSelect={select}
              />
            )}
          />
        </div>
        {thinkingSelector ||
        extraSelectSelectors.length > 0 ||
        interactionSelector ||
        showDeepSeekDelegationWarning ? (
          <DropdownMenuSeparator />
        ) : null}
        {thinkingSelector ? (
          <DropdownMenuSub>
            <ValueSubTrigger
              label={reasoningLabel}
              value={thinkingLabel}
              leadingIcon={<Brain aria-hidden="true" className="size-4" />}
            />
            <DropdownMenuSubContent>
              {thinkingSelector.options.map((opt) => (
                <OptionItem
                  key={opt.value}
                  label={opt.label}
                  description={opt.description}
                  selected={opt.value === thinkingValue}
                  disabled={opt.disabled}
                  onSelect={() =>
                    onConfigOptionChange?.(
                      thinkingSelector.configId,
                      opt.value as AcpConfigOptionValue
                    )
                  }
                />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}

        {onRecentRunConfigSelect ? (
          <RecentRunConfigMenuGroup
            items={recentRunConfigs ?? []}
            onSelect={onRecentRunConfigSelect}
          />
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
                      onConfigOptionChange?.(
                        selector.configId,
                        option.value as AcpConfigOptionValue
                      )
                    }
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}

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

        {planSelector || fastSelector ? <DropdownMenuSeparator /> : null}
        {planSelector ? (
          <ToggleItem
            icon={<ListChecks className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}
            label={planRowLabel}
            checked={planOn}
            onToggle={() =>
              onConfigOptionChange?.(
                planSelector.configId,
                togglePlanModeSelectorValue(
                  planSelector,
                  configOptionValues?.[planSelector.configId]
                )
              )
            }
          />
        ) : null}
        {fastSelector ? (
          <ToggleItem
            icon={<Zap className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />}
            label={fastRowLabel}
            checked={fastOn}
            onToggle={() =>
              onConfigOptionChange?.(
                fastSelector.configId,
                toggleOnOffConfigOptionValue(
                  fastSelector,
                  configOptionValues?.[fastSelector.configId]
                )
              )
            }
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return menu;
}

function FaceDot() {
  return (
    <span aria-hidden="true" className="shrink-0 select-none text-muted-foreground/60">
      ·
    </span>
  );
}

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
