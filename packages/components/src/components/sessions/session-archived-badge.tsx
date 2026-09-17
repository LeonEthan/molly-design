import { Archive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';

const STATUS_PILL_CLASS =
  'inline-flex h-6 shrink-0 select-none items-center gap-1.5 rounded-md border border-border/70 bg-transparent px-2 ' +
  'text-[0.7rem] font-medium leading-none text-muted-foreground transition-colors ' +
  'hover:border-border hover:text-foreground ' +
  'outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50 ' +
  'text-foreground/80';

export function SessionArchivedBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  const label = t('sessions.archived', 'Archived');
  const description = t(
    'sessions.archivedDescription',
    'This conversation is archived. Restore it to continue chatting.'
  );
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={`${label}: ${description}`}
          className={cn(STATUS_PILL_CLASS, className)}
        >
          <Archive className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-72 px-2.5 py-2">
        <div className="font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
      </TooltipContent>
    </Tooltip>
  );
}
