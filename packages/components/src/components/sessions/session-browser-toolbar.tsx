import { useEffect, useRef, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  MessageCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui/tooltip';
import { cn } from '@/lib/utils';

type SessionBrowserToolbarProps = {
  leadingSlot?: ReactNode;
  focusAddress?: boolean;
  address: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  annotationEnabled: boolean;
  annotationAvailable: boolean;
  busy: boolean;
  onAddressChange: (address: string) => void;
  onRestoreAddress: () => void;
  onNavigate: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onToggleAnnotation: () => void;
};

function ToolbarButton({
  label,
  children,
  className,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8 shrink-0', className)}
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function SessionBrowserToolbar({
  leadingSlot,
  focusAddress = false,
  address,
  canGoBack,
  canGoForward,
  loading,
  annotationEnabled,
  annotationAvailable,
  busy,
  onAddressChange,
  onRestoreAddress,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onStop,
  onToggleAnnotation,
}: SessionBrowserToolbarProps) {
  const { t } = useTranslation();
  const addressInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusAddress) addressInputRef.current?.focus();
  }, [focusAddress]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onNavigate();
  };

  return (
    <TooltipProvider delayDuration={350}>
      {/* Pad for the notch on mobile full-screen drawers; desktop keeps
         `--safe-area-top: 0` so the bar height is unchanged. */}
      <div className="flex min-w-0 items-center gap-0.5 border-b border-border bg-background px-1.5 pb-1.5 pt-[calc(0.375rem+var(--safe-area-top))]">
        {leadingSlot}
        <ToolbarButton
          label={t('sessions.browser.back', 'Back')}
          disabled={!canGoBack || busy}
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label={t('sessions.browser.forward', 'Forward')}
          disabled={!canGoForward || busy}
          onClick={onForward}
        >
          <ArrowRight className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label={
            loading
              ? t('sessions.browser.stop', 'Stop loading')
              : t('sessions.browser.reload', 'Reload')
          }
          disabled={busy}
          onClick={loading ? onStop : onReload}
        >
          {loading ? <X className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
        </ToolbarButton>

        <form className="min-w-0 flex-1 px-1" onSubmit={submit}>
          <div className="flex h-8 min-w-0 items-center rounded-md border border-input-border bg-input-field transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
            <input
              ref={addressInputRef}
              type="text"
              inputMode="url"
              value={address}
              onChange={(event) => onAddressChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onRestoreAddress();
                  event.currentTarget.blur();
                }
              }}
              placeholder={t('sessions.browser.addressPlaceholder', 'Enter a URL')}
              aria-label={t('sessions.browser.address', 'Address')}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
              className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </form>

        <ToolbarButton
          label={
            annotationAvailable
              ? annotationEnabled
                ? t('sessions.browser.annotationDisable', 'Exit annotation mode')
                : t('sessions.browser.annotationEnable', 'Annotate page')
              : t(
                  'sessions.browser.annotationManagedOnly',
                  'Annotation is available only for local and private-network pages'
                )
          }
          className={annotationEnabled ? 'bg-accent text-accent-foreground' : undefined}
          disabled={!annotationAvailable || busy}
          aria-pressed={annotationEnabled}
          onClick={onToggleAnnotation}
        >
          <MessageCircle className="h-4 w-4" />
        </ToolbarButton>
      </div>
    </TooltipProvider>
  );
}
