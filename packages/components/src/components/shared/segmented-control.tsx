import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type SegmentedControlOption<TValue extends string> = {
  value: TValue;
  label: ReactNode;
  icon?: ReactNode;
};

export type SegmentedControlSize = 'md' | 'sm';

/**
 * De-pilled segmented control (spec §5): a muted track with a raised popover
 * segment for the selected value — explicitly not a pill. One home for the
 * recipe so a chrome refresh edits a single string instead of hand-synced
 * copies (TransportToggle and QueuedMessageBehaviorControl were byte-identical
 * before this existed).
 */
export function SegmentedControl<TValue extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = 'md',
  className,
}: {
  value: TValue;
  onChange: (value: TValue) => void;
  options: Array<SegmentedControlOption<TValue>>;
  ariaLabel: string;
  size?: SegmentedControlSize;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-grid h-[30px] auto-cols-fr grid-flow-col rounded-md bg-muted p-[2px]',
        className
      )}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-[3px] px-3 text-xs font-medium transition-colors',
              size === 'md' ? 'min-w-20' : 'min-w-16',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              selected
                ? 'bg-popover text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
