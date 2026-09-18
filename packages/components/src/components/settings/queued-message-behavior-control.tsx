import { useTranslation } from 'react-i18next';
import type { QueuedMessageBehavior } from '@/atoms';
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
        'Queued message behavior'
      )}
      size="sm"
      className={className}
      value={value}
      onChange={onChange}
      options={[
        {
          value: 'queue',
          label: t('settings.general.sessions.queuedMessageBehavior.queue', 'Queue'),
        },
        {
          value: 'guide',
          label: t('settings.general.sessions.queuedMessageBehavior.guide', 'Steer'),
        },
      ]}
    />
  );
}
