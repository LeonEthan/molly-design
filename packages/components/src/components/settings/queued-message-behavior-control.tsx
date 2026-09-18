import { useTranslation } from 'react-i18next';
import type { QueuedMessageBehavior } from '@/atoms';
import { cn } from '@/lib/utils';

export type QueuedMessageBehaviorControlProps = {
  value: QueuedMessageBehavior;
  onChange: (value: QueuedMessageBehavior) => void;
  className?: string;
};

export function QueuedMessageBehaviorControl({
  value,
  onChange,
  className,
}: QueuedMessageBehaviorControlProps) {
  const { t } = useTranslation();
  const options: Array<{ value: QueuedMessageBehavior; label: string }> = [
    {
      value: 'queue',
      label: t('settings.general.sessions.queuedMessageBehavior.queue', 'Queue'),
    },
    {
      value: 'guide',
      label: t('settings.general.sessions.queuedMessageBehavior.guide', 'Steer'),
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t(
        'settings.general.sessions.queuedMessageBehavior.label',
        'Queued message behavior'
      )}
      className={cn('inline-grid h-[30px] grid-cols-2 rounded-md bg-muted p-[2px]', className)}
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
              'min-w-16 rounded-[3px] px-3 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              selected
                ? 'bg-popover text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
