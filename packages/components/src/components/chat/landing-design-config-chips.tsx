import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Image as ImageIcon } from '@/ui/icons';
import { cn } from '@/lib/utils';

function ConfigBadge({
  icon,
  label,
  value,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  disabled?: boolean;
}) {
  return (
    <span
      title={value}
      aria-disabled={disabled || undefined}
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border/50 bg-foreground/[0.03] px-2.5 py-1 text-xs text-foreground',
        disabled && 'opacity-70'
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 font-medium break-all text-left">{value}</span>
    </span>
  );
}

/** Home composer image-model chip. The Agent chip is retired; this does not select an image model. */
export function LandingDesignConfigChips({
  imageModelId,
  disabled,
}: {
  imageModelId: string | null;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  if (!imageModelId) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <ConfigBadge
        icon={<ImageIcon className="h-3.5 w-3.5" aria-hidden />}
        label={t('chat.landingChips.imageModel', 'Image model')}
        value={imageModelId}
        disabled={disabled}
      />
    </div>
  );
}
