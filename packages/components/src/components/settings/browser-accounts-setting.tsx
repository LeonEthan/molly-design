import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ElectronBrowserAccountSiteInput,
  ElectronBrowserAccountSummary,
  ElectronBrowserImportSources,
} from '@molly/shared/electron-ipc';
import { getPublicBrowserBridge } from '@/lib/electron-ipc-client';
import { Button } from '@/ui/button';
import { ChevronDown, Circle, CircleDashed, RefreshCw } from '@/ui/icons';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible';
import { WithInfo } from './info-tip';

type Site = ElectronBrowserAccountSiteInput['site'];
type Source = ElectronBrowserImportSources['sources'][number];
const siteNames: Record<Site, string> = { 'pinterest.com': 'Pinterest' };
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const choiceKey = (browserId: string, profileId: string) => JSON.stringify([browserId, profileId]);

function preferredChoice(sources: Source[]): string {
  const ordered = [...sources].sort(
    (a, b) => Number(b.browserId === 'chrome') - Number(a.browserId === 'chrome')
  );
  for (const source of ordered) {
    const profile = source.profiles.find((entry) => entry.isDefault) ?? source.profiles[0];
    if (profile) return choiceKey(source.browserId, profile.id);
  }
  return '';
}

/** Source browser, profile and website are chosen in Molly; cookie values never enter the renderer. */
export function BrowserAccountsSetting() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<ElectronBrowserAccountSummary | null>(null);
  const [sources, setSources] = useState<ElectronBrowserImportSources | null>(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [importingSite, setImportingSite] = useState<Site | null>(null);
  const [importFailed, setImportFailed] = useState(false);
  const [failedSource, setFailedSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ site: Site; imported: number } | null>(null);

  const refresh = useCallback(async () => {
    const bridge = getPublicBrowserBridge();
    if (!bridge) throw new Error(t('settings.browserAccounts.unavailable'));
    const nextSummary = await bridge.getAccountSummary();
    setSummary(nextSummary);
    if (!nextSummary.importAvailable) {
      setSources({ sources: [], unreadable: [] });
      setChoice('');
      return;
    }
    const next = await bridge.getImportSources();
    setSources(next);
    setChoice((current) =>
      next.sources.some((source) =>
        source.profiles.some((profile) => choiceKey(source.browserId, profile.id) === current)
      )
        ? current
        : preferredChoice(next.sources)
    );
  }, [t]);

  useEffect(() => {
    void refresh().catch((failure) => setError(errorMessage(failure)));
  }, [refresh]);

  const selected = sources?.sources.flatMap((source) =>
    source.profiles
      .filter((profile) => choiceKey(source.browserId, profile.id) === choice)
      .map((profile) => ({ source, profile }))
  )[0];

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setImportFailed(false);
    try {
      await action();
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const importSite = (site: Site) =>
    run(async () => {
      const bridge = getPublicBrowserBridge();
      if (!bridge) throw new Error(t('settings.browserAccounts.unavailable'));
      if (!selected) throw new Error(t('settings.browserAccounts.chooseSource'));
      const hasExisting =
        (summary?.sites.find((entry) => entry.site === site)?.cookieCount ?? 0) > 0;
      if (
        hasExisting &&
        !window.confirm(t('settings.browserAccounts.replaceConfirm', { site: siteNames[site] }))
      )
        return;
      setImportingSite(site);
      setResult(null);
      try {
        const response = await bridge.importBrowserAccount(
          selected.source.browserId,
          selected.profile.id,
          site,
          hasExisting
        );
        setResult({ site, imported: response.imported });
      } catch (failure) {
        setImportFailed(true);
        setFailedSource(
          t('settings.browserAccounts.sourceOption', {
            browser: selected.source.browserName,
            profile: selected.profile.name,
          })
        );
        throw failure;
      } finally {
        setImportingSite(null);
      }
    });

  const clearCookies = (site: Site) =>
    run(async () => {
      if (!window.confirm(t('settings.browserAccounts.clearConfirm', { site: siteNames[site] })))
        return;
      const bridge = getPublicBrowserBridge();
      if (!bridge) throw new Error(t('settings.browserAccounts.unavailable'));
      await bridge.clearAccountCookies(site);
      if (result?.site === site) setResult(null);
    });

  const importLabel = (site: Site) =>
    importingSite === site
      ? t('settings.browserAccounts.importing')
      : selected
        ? t('settings.browserAccounts.importFrom', { browser: selected.source.browserName })
        : t('settings.browserAccounts.importFromBrowser');

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <WithInfo
          text={t('settings.browserAccounts.intro')}
          info={t('settings.browserAccounts.introDetail')}
        />
      </p>
      {error && !importFailed ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!summary ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('settings.browserAccounts.loading')}
        </p>
      ) : (
        summary.sites.map(({ site, cookieCount }) => (
          <section
            key={site}
            aria-label={siteNames[site]}
            className="overflow-hidden rounded-2xl border border-border/40 bg-card"
          >
            <header className="flex items-center gap-3 px-5 py-4">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-sm font-semibold text-background"
              >
                {siteNames[site].slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{siteNames[site]}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {cookieCount > 0 ? (
                    <Circle aria-hidden className="h-3 w-3 shrink-0" />
                  ) : (
                    <CircleDashed aria-hidden className="h-3 w-3 shrink-0" />
                  )}
                  {cookieCount > 0
                    ? t('settings.browserAccounts.cookieCount', { total: cookieCount })
                    : t('settings.readiness.notSignedIn')}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                aria-label={t('settings.browserAccounts.refresh')}
                disabled={busy}
                onClick={() => void run(async () => {})}
              >
                <RefreshCw aria-hidden className="h-4 w-4" />
              </Button>
            </header>
            <div className="space-y-3 border-t border-border/40 px-5 py-4">
              <p className="text-xs font-medium text-foreground">
                <WithInfo
                  text={t('settings.browserAccounts.importTitle')}
                  info={t('settings.browserAccounts.importTitleInfo')}
                />
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {summary.importAvailable && sources && sources.sources.length > 0 ? (
                  <Select value={choice} onValueChange={setChoice} disabled={busy}>
                    <SelectTrigger
                      aria-label={t('settings.browserAccounts.chooseSource')}
                      className="h-8 w-auto min-w-0 flex-1 sm:max-w-[280px]"
                    >
                      <SelectValue placeholder={t('settings.browserAccounts.chooseSource')} />
                    </SelectTrigger>
                    <SelectContent>
                      {sources.sources.map((source) => (
                        <SelectGroup key={source.browserId}>
                          <SelectLabel>{source.browserName}</SelectLabel>
                          {source.profiles.map((profile) => (
                            <SelectItem
                              key={profile.id}
                              value={choiceKey(source.browserId, profile.id)}
                            >
                              {t('settings.browserAccounts.sourceOption', {
                                browser: source.browserName,
                                profile: profile.name,
                              })}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !summary.importAvailable || !selected}
                  onClick={() => void importSite(site)}
                >
                  {importLabel(site)}
                </Button>
                {cookieCount > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    disabled={busy}
                    onClick={() => void clearCookies(site)}
                  >
                    {t('settings.browserAccounts.clearCookies')}
                  </Button>
                ) : null}
              </div>
              {!summary.importAvailable ? (
                <p className="text-xs text-muted-foreground">
                  {summary.importUnavailableReason
                    ? t(
                        `settings.browserAccounts.importUnavailableReasons.${summary.importUnavailableReason}`
                      )
                    : t('settings.browserAccounts.importUnavailable')}
                </p>
              ) : sources && sources.sources.length === 0 && sources.unreadable.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('settings.browserAccounts.noSources')}
                </p>
              ) : null}
              {importFailed && error ? (
                <div role="alert" className="space-y-1 text-xs text-destructive">
                  <p>{t('settings.browserAccounts.importFailedFor', { source: failedSource })}</p>
                  <p className="break-words">{error}</p>
                  <p>{t('settings.browserAccounts.retryHint')}</p>
                </div>
              ) : null}
              {sources && sources.unreadable.length > 0 ? (
                selected ? (
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="group gap-1.5 px-0 text-xs text-muted-foreground"
                      >
                        <ChevronDown
                          aria-hidden
                          className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180"
                        />
                        {t('settings.browserAccounts.otherSourceIssues')}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2 text-xs text-muted-foreground">
                      {t('settings.browserAccounts.unreadableSources', {
                        browsers: sources.unreadable.join(', '),
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('settings.browserAccounts.unreadableSources', {
                      browsers: sources.unreadable.join(', '),
                    })}
                  </p>
                )
              ) : null}
              {import.meta.env.DEV && !summary.persistent ? (
                <p className="text-xs text-muted-foreground">
                  {t('settings.browserAccounts.developmentMemory')}
                </p>
              ) : null}
              {importingSite === site ? (
                <p role="status" className="text-xs text-muted-foreground">
                  {t('settings.browserAccounts.authorizationHint')}
                </p>
              ) : null}
              {result?.site === site ? (
                <p role="status" className="text-xs text-muted-foreground">
                  {t('settings.browserAccounts.imported', { total: result.imported })}
                </p>
              ) : null}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
