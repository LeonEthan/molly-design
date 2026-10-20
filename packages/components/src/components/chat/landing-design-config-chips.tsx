import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Image as ImageIcon, ChevronDown } from '@/ui/icons';
import { cn } from '@/lib/utils';
function ConfigChip({
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
  const [expanded, setExpanded] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      title={value}
      aria-expanded={expanded}
      onClick={() => setExpanded((open) => !open)}
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border/50 bg-foreground/[0.03] px-2.5 py-1 text-xs text-foreground transition-colors',
        'hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60',
        disabled && 'opacity-70'
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      {expanded ? (
        <span className="min-w-0 font-medium break-all text-left">{value}</span>
      ) : (
        <span className="min-w-0 max-w-[12rem] truncate font-medium">{value}</span>
      )}
      <ChevronDown
        aria-hidden
        className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
      />
    </button>
  );
}

/** After onboarding, surfaces the auto-selected Agent and image model above the landing composer. */
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
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 px-1 pb-1">
      {agentLabel ? (
        <ConfigChip
          icon={<Bot className="h-3.5 w-3.5" aria-hidden />}
          label={t('chat.landingChips.agent', 'Agent')}
          value={agentLabel}
          disabled={disabled}
        />
      ) : null}
      {imageModelId ? (
        <ConfigChip
          icon={<ImageIcon className="h-3.5 w-3.5" aria-hidden />}
          label={t('chat.landingChips.imageModel', 'Image model')}
          value={imageModelId}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}
