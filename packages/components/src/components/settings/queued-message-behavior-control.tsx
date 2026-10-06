import { useTranslation } from 'react-i18next';
import type { QueuedMessageBehavior } from '@/atoms';
import { cn } from '@/lib/utils';
import { SegmentedControl } from '@/components/shared/segmented-control';

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

  return (
    <SegmentedControl
      ariaLabel={t(
        'settings.general.sessions.queuedMessageBehavior.label',
        'When I send a message during a design task'
      )}
      size="sm"
      className={cn('h-auto min-h-[30px] w-full [&>button]:py-1.5', className)}
      value={value}
      onChange={onChange}
      options={[
        {
          value: 'queue',
          label: t(
            'settings.general.sessions.queuedMessageBehavior.queue',
            'After the current step'
          ),
        },
        {
          value: 'guide',
          label: t('settings.general.sessions.queuedMessageBehavior.guide', 'As soon as possible'),
        },
      ]}
    />
  );
}
