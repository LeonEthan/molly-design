import { useTranslation } from 'react-i18next';
import { DropdownMenuItem } from '@/ui/dropdown-menu';

export type VersionHistoryLoad =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };

export function DesignVersionHistoryFeedback({
  load,
  empty,
  onRetry,
}: {
  load: VersionHistoryLoad;
  empty: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (load.phase === 'loading')
    return (
      <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
        {t('design.versionsLoading', 'Loading versions…')}
      </p>
    );
  if (load.phase === 'error')
    return (
      <>
        <div role="alert" className="px-3 py-2 text-sm">
          <p>{t('design.versionsUnavailable', 'Version history unavailable')}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{load.message}</p>
        </div>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onRetry();
          }}
        >
          {t('design.versionsRetry', 'Retry loading versions')}
        </DropdownMenuItem>
      </>
    );
  if (!empty) return null;
  return (
    <div role="status" className="px-3 py-2 text-sm">
      <p>{t('design.versionsEmpty', 'No saved versions yet')}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {t(
          'design.versionsEmptyHint',
          'Use Save version to keep a point you can return to. Autosave keeps your current artwork separately.'
        )}
      </p>
    </div>
  );
}
