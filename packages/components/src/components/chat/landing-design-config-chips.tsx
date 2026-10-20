import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Image as ImageIcon } from '@/ui/icons';
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

/** After onboarding, keeps the auto-selected Agent and image model visible in the composer footer. */
export function LandingDesignConfigChips({
  agentLabel,
  imageModelId,
  disabled,
}: {
  agentLabel: string | null;
  imageModelId: string | null;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  if (!agentLabel && !imageModelId) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {agentLabel ? (
        <ConfigBadge
          icon={<Bot className="h-3.5 w-3.5" aria-hidden />}
          label={t('chat.landingChips.agent', 'Agent')}
          value={agentLabel}
          disabled={disabled}
        />
      ) : null}
      {imageModelId ? (
        <ConfigBadge
          icon={<ImageIcon className="h-3.5 w-3.5" aria-hidden />}
          label={t('chat.landingChips.imageModel', 'Image model')}
          value={imageModelId}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}
