import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ElectronBrowserAccountSiteInput,
  ElectronBrowserAccountSummary,
  ElectronChromeProfileChoice,
} from '@molly/shared/electron-ipc';
import { getPublicBrowserBridge } from '@/lib/electron-ipc-client';
import { Button } from '@/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Section } from './form-primitives';

type Site = ElectronBrowserAccountSiteInput['site'];
const siteNames: Record<Site, string> = { 'pinterest.com': 'Pinterest' };
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Source profile and website are selected in Molly; cookie values never enter the renderer. */
export function BrowserAccountsSetting() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<ElectronBrowserAccountSummary | null>(null);
  const [profiles, setProfiles] = useState<ElectronChromeProfileChoice[] | null>(null);
  const [profileId, setProfileId] = useState('');
  const [busy, setBusy] = useState(false);
  const [importingSite, setImportingSite] = useState<Site | null>(null);
  const [importFailed, setImportFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ site: Site; imported: number } | null>(null);

  const refresh = useCallback(async () => {
    const bridge = getPublicBrowserBridge();
    if (!bridge) throw new Error(t('settings.browserAccounts.unavailable'));
    const nextSummary = await bridge.getAccountSummary();
    setSummary(nextSummary);
    if (!nextSummary.importAvailable) {
      setProfiles([]);
      setProfileId('');
      return;
    }
    const nextProfiles = await bridge.getChromeProfiles();
    setProfiles(nextProfiles);
    setProfileId((current) =>
      nextProfiles.some((profile) => profile.id === current)
        ? current
        : (nextProfiles.find((profile) => profile.isDefault)?.id ?? nextProfiles[0]?.id ?? '')
    );
  }, [t]);

  useEffect(() => {
    void refresh().catch((failure) => setError(errorMessage(failure)));
  }, [refresh]);

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
      if (!profileId) throw new Error(t('settings.browserAccounts.chooseProfile'));
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
        const response = await bridge.importChromeAccount(profileId, site, hasExisting);
        setResult({ site, imported: response.imported });
      } catch (failure) {
        setImportFailed(true);
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

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('settings.browserAccounts.intro')}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
          {importFailed ? (
            <span className="mt-1 block">{t('settings.browserAccounts.retryHint')}</span>
          ) : null}
        </p>
      ) : null}
      {!summary ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('settings.browserAccounts.loading')}
        </p>
      ) : (
        <>
          {!summary.persistent ? (
            <p className="text-xs text-muted-foreground">
              {t('settings.browserAccounts.developmentMemory')}
            </p>
          ) : null}
          {summary.importAvailable ? (
            <Section
              title={t('settings.browserAccounts.chromeProfileTitle')}
              hint={t('settings.browserAccounts.chromeProfileHint')}
            >
              {profiles && profiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('settings.browserAccounts.noChromeProfiles')}
                </p>
              ) : (
                <Select value={profileId} onValueChange={setProfileId} disabled={busy || !profiles}>
                  <SelectTrigger aria-label={t('settings.browserAccounts.chromeProfile')}>
                    <SelectValue placeholder={t('settings.browserAccounts.chooseProfile')} />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles?.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Section>
          ) : (
            <p className="text-xs text-muted-foreground">
              {summary.importUnavailableReason
                ? t(
                    `settings.browserAccounts.importUnavailableReasons.${summary.importUnavailableReason}`
                  )
                : t('settings.browserAccounts.importUnavailable')}
            </p>
          )}
          <Section
            title={t('settings.browserAccounts.sitesTitle')}
            hint={t('settings.browserAccounts.sitesHint')}
          >
            <div className="space-y-3">
              {summary.sites.map(({ site, cookieCount }) => (
                <div key={site} className="rounded-md border border-border/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{siteNames[site]}</p>
                      <p className="text-xs text-muted-foreground">
                        {t('settings.browserAccounts.cookieCount', { total: cookieCount })}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {summary.importAvailable ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || !profileId}
                          onClick={() => void importSite(site)}
                        >
                          {t(
                            importingSite === site
                              ? 'settings.browserAccounts.importing'
                              : 'settings.browserAccounts.importSite'
                          )}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy || cookieCount === 0}
                        onClick={() => void clearCookies(site)}
                      >
                        {t('settings.browserAccounts.clearCookies')}
                      </Button>
                    </div>
                  </div>
                  {importingSite === site ? (
                    <p role="status" className="mt-2 text-xs text-muted-foreground">
                      {t('settings.browserAccounts.authorizationHint')}
                    </p>
                  ) : null}
                  {result?.site === site ? (
                    <p role="status" className="mt-2 text-xs text-muted-foreground">
                      {t('settings.browserAccounts.imported', { total: result.imported })}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void run(async () => {})}
          >
            {t('settings.browserAccounts.refresh')}
          </Button>
        </>
      )}
    </div>
  );
}
