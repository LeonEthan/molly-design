import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip';

/**
 * Keeps the fine print of a setting one hover or focus away, so each card can lead
 * with a single plain sentence without dropping the caveats it must still state.
 */
export function InfoTip({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t('settings.moreInfo')}
            className="inline-flex h-4 w-4 shrink-0 translate-y-[2px] items-center justify-center rounded-full align-baseline text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="max-w-xs whitespace-normal text-xs font-normal leading-relaxed"
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** A one-line description followed by its fine print, for helpers and intros. */
export function WithInfo({ text, info }: { text: ReactNode; info?: ReactNode }) {
  if (!info) return <>{text}</>;
  return (
    <>
      {text} <InfoTip>{info}</InfoTip>
    </>
  );
}
