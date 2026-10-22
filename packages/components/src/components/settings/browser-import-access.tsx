import { useTranslation } from 'react-i18next';
import mollyMark from '@/assets/molly-mark.svg';
import { Button } from '@/ui/button';
import { Check, ChevronDown, ChevronRight, Globe, MousePointer2, Settings2 } from '@/ui/icons';

export type BrowserImportAccessState = 'unrequested' | 'denied' | 'readable';

type Props = {
  state: BrowserImportAccessState;
  applicationName: string;
  browserName: string;
  pending: boolean;
  onRecheck: () => void;
};

export function BrowserImportAccess({
  state,
  applicationName,
  browserName,
  pending,
  onRecheck,
}: Props) {
  const { t } = useTranslation();
  const browser = browserName.replace(/^Google /, '');
  if (state === 'readable') {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-border pb-5 text-sm">
        <span className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" aria-hidden />
          {browserName}
        </span>
        <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5 text-foreground" aria-hidden />
          {t('settings.browserImport.permission.granted')}
        </span>
      </div>
    );
  }
  const denied = state === 'denied';
  return (
    <section aria-label={t('settings.browserImport.permission.settingsGuide')}>
      <h3 className="text-xl font-medium tracking-tight">
        {t(`settings.browserImport.permission.${denied ? 'deniedTitle' : 'beforeTitle'}`, {
          browser,
        })}
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {t(
          `settings.browserImport.permission.${denied ? 'deniedDescription' : 'beforeDescription'}`,
          { app: applicationName, browser }
        )}
      </p>
      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-background shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
          {t('settings.browserImport.permission.settingsGuide')}
          <Settings2 className="h-3.5 w-3.5" aria-hidden />
        </div>
        <div className="flex flex-wrap items-center gap-1 px-3 pt-3 text-[11px] text-muted-foreground">
          <span>{t('settings.browserImport.permission.privacy')}</span>
          <ChevronRight className="h-3 w-3" aria-hidden />
          <span>{t('settings.browserImport.permission.files')}</span>
        </div>
        <div className="px-5 pb-6 pt-5 text-sm">
          <div className="flex items-center gap-2 border-b border-border pb-4">
            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted p-1">
              <img src={mollyMark} alt="" className="h-full w-full dark:invert" />
            </span>
            <span className="min-w-0 break-words font-medium">{applicationName}</span>
          </div>
          <div className="relative flex items-center justify-between gap-3 pb-3 pl-6 pt-5">
            <span>{browserName}</span>
            <span
              aria-hidden
              className="flex h-[18px] w-8 shrink-0 rounded-full bg-muted-foreground/50 p-0.5 outline outline-offset-4 outline-foreground/70"
            >
              <span className="h-3.5 w-3.5 rounded-full bg-background shadow-sm" />
            </span>
            <MousePointer2 className="absolute -right-1 -bottom-2 h-4 w-4 -rotate-12" aria-hidden />
          </div>
        </div>
      </div>
      {denied ? (
        <Button
          variant="link"
          className="mt-3 h-auto p-0 text-xs font-normal text-foreground underline"
          disabled={pending}
          onClick={onRecheck}
        >
          {t('settings.browserImport.permission.recheck')}
        </Button>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          {t('settings.browserImport.permission.returnHint', { browser: browserName })}
        </p>
      )}
    </section>
  );
}
