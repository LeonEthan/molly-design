import type { ReactNode } from 'react';
import { ShieldCheck, Compass, PenLine, ShieldOff, Eye } from 'lucide-react';
import { AcpSessionSelect, type AcpSessionSelectOption } from '@/components/shared';

import type {
  AcpConfigOptionSelector,
  AcpConfigOptionValue,
} from '@/components/shared/acp-selector-options';
import { cn } from '@/lib/utils';

export type ChatLandingTone = 'light' | 'dark';

const modeIconClassName = 'h-3.5 w-3.5';

/**
 * Shared icon size for agent config logos in compact selectors.
 * The Button component now only applies a default icon size when children do
 * not provide explicit sizing.
 */
export const agentIconClassName = 'h-3 w-3 shrink-0 opacity-80';

/**
 * Get icon for permission mode
 */
export const getModeIcon = (modeId: string | null): ReactNode => {
  switch (modeId) {
    case 'plan':
      return <Compass className={modeIconClassName} />;
    case 'acceptEdits':
      return <PenLine className={modeIconClassName} />;
    case 'dontAsk':
      return <ShieldOff className={modeIconClassName} />;
    case 'read-only':
      return <Eye className={modeIconClassName} />;
    default:
      return <ShieldCheck className={modeIconClassName} />;
  }
};

/**
 * Get selector tag class name based on tone (no border, muted text).
 */
export const getSelectorTagClassName = (_tone: ChatLandingTone): string => {
  return cn(
    'w-auto h-6 px-2 gap-1 rounded-[4px] [&_span]:text-xs [&_span]:leading-tight',
    'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
  );
};

/**
 * Bordered variant for selectors with icons (e.g. agent config with OpenAI/Claude icons).
 */
export const getCompactSelectorTagClassName = (_tone: ChatLandingTone): string => {
  return cn(
    'w-auto h-6 px-2 gap-1 rounded-[4px] border [&_span]:text-xs [&_span]:leading-tight',
    'border-input-border/70 bg-input/80 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
  );
};

export interface ModeSelectorProps {
  value: string | null;
  onChange: (value: string) => void;
  options: AcpSessionSelectOption[];
  tone: ChatLandingTone;
  disabled?: boolean;
}

/**
 * Mode selector component for ChatLanding
 */
export function ModeSelector({
  value,
  onChange,
  options,
  tone,
  disabled = false,
}: ModeSelectorProps) {
  const selectorTagClassName = getSelectorTagClassName(tone);

  if (options.length === 0) {
    return null;
  }

  return (
    <AcpSessionSelect
      tone={tone}
      value={value}
      onChange={onChange}
      options={options}
      placeholder="Mode"
      disabled={disabled || options.length === 0}
      align="start"
      icon={getModeIcon(value)}
      className={cn(selectorTagClassName, 'max-w-[12rem]')}
      ariaLabel="Permission mode"
    />
  );
}

export interface ModelSelectorProps {
  value: string | null;
  onChange: (value: string) => void;
  options: AcpSessionSelectOption[];
  tone?: ChatLandingTone;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

/**
 * Model selector component for ChatLanding
 */
export function ModelSelector({
  value,
  onChange,
  options,
  tone = 'light',
  placeholder = 'Model',
  ariaLabel = 'Model',
  disabled = false,
}: ModelSelectorProps) {
  if (options.length === 0) {
    return null;
  }

  return (
    <AcpSessionSelect
      tone={tone}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      disabled={disabled || options.length === 0}
      align="start"
      ariaLabel={ariaLabel}
    />
  );
}

export interface ConfigOptionSelectorsProps {
  selectors: AcpConfigOptionSelector[];
  values: Record<string, AcpConfigOptionValue>;
  onChange: (configId: string, value: AcpConfigOptionValue) => void;
  tone?: ChatLandingTone;
}

/**
 * Renders dynamic config option selectors from the agent's configOptions.
 */
export function ConfigOptionSelectors({
  selectors,
  values,
  onChange,
  tone = 'light',
}: ConfigOptionSelectorsProps) {
  if (selectors.length === 0) return null;
  return (
    <>
      {selectors.map((selector) =>
        selector.type === 'select' ? (
          <AcpSessionSelect
            key={selector.configId}
            tone={tone}
            value={(values[selector.configId] as string | undefined) ?? selector.currentValue}
            onChange={(v) => onChange(selector.configId, v)}
            options={selector.options}
            placeholder={selector.label}
            disabled={selector.options.length === 0}
            align="start"
            showDescription
            ariaLabel={selector.label}
          />
        ) : null
      )}
    </>
  );
}
