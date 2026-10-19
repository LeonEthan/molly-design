import { useTranslation } from 'react-i18next';
import type { DesignModelClass } from '@/lib/design-model-readiness';

/**
 * Blocks a design-session start when a required model class is not connected,
 * naming what is missing and offering the Settings section that fixes it.
 */
export function DesignModelReadinessReminder({
  missing,
  onOpenSettings,
}: {
  missing: readonly DesignModelClass[];
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const both = missing.includes('language') && missing.includes('image');
  const key = both
    ? 'chat.validation.missingModelsBoth'
    : missing.includes('language')
      ? 'chat.validation.missingModelLanguage'
      : 'chat.validation.missingModelImage';
  const fallback = both
    ? 'Connect a language model and an image model to start designing.'
    : missing.includes('language')
      ? 'Connect a language model to start designing.'
      : 'Connect an image model to start designing.';
  return (
    <span>
      {t(key, fallback)}{' '}
      <button
        type="button"
        onClick={onOpenSettings}
        className="underline underline-offset-2 hover:text-foreground"
      >
        {t('chat.cliHint.goToSettings')}
      </button>
    </span>
  );
}
