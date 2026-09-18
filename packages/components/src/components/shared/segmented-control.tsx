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
  disabled = false,
  pill = false,
}: {
  value: TValue;
  onChange: (value: TValue) => void;
  options: Array<SegmentedControlOption<TValue>>;
  ariaLabel: string;
  size?: SegmentedControlSize;
  className?: string;
  disabled?: boolean;
  /** Capsule geometry for inline config rows: fully rounded track and
   * segments. The default squared control is the frozen §5 chrome recipe;
   * pill is an opt-in per-instance shape, never the default. */
  pill?: boolean;
}) {
  const selectedIndex = options.findIndex((option) => option.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-grid h-[30px] auto-cols-fr grid-flow-col bg-muted p-[2px]',
        pill ? 'rounded-full' : 'rounded-md',
        disabled && 'pointer-events-none opacity-40',
        className
      )}
    >
      {pill && selectedIndex >= 0 ? (
        // Sliding selection thumb (iOS metaphor): one surface, two positions.
        // Columns are equal (auto-cols-fr), so the thumb width is exactly one
        // column and translateX(index * 100%) lands without measurement.
        <span
          aria-hidden
          data-segmented-thumb
          className="absolute inset-y-[2px] left-[2px] z-0 rounded-full bg-popover shadow-sm transition-transform duration-200 ease-out"
          style={{
            width: `calc((100% - 4px) / ${options.length})`,
            transform: `translateX(${selectedIndex * 100}%)`,
          }}
        />
      ) : null}
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative z-[1] flex items-center justify-center gap-1.5 px-3 text-xs font-medium transition-colors',
              pill ? 'rounded-full' : 'rounded-[3px]',
              size === 'md' ? 'min-w-20' : 'min-w-16',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              selected
                ? pill
                  ? // The thumb carries the selected surface.
                    'text-foreground'
                  : 'bg-popover text-foreground shadow-sm'
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
