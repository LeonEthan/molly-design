import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BROWSER_ACCOUNT_SITES,
  BROWSER_ACCOUNT_SITE_IDS,
  type BrowserAccountSiteId,
} from '@molly/shared/browser-account-sites';
import type {
  AccountImportBrowserId,
  BrowserAccountImportErrorCode,
  ElectronBrowserAccountSummary,
  ElectronBrowserImportSources,
  ElectronBrowserProfileChoice,
  ElectronBrowserImportReport,
} from '@molly/shared/electron-ipc';
import { getPublicBrowserBridge } from '@/lib/electron-ipc-client';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { ChevronDown, Loader2, X } from '@/ui/icons';
import {
  Dialog,
  DialogContentWithoutClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
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

type Props = { open: boolean; onOpenChange: (open: boolean) => void };
const choiceKey = (browserId: string, profileId: string) => JSON.stringify([browserId, profileId]);

export function BrowserAccountImportDialog({ open, onOpenChange }: Props) {
  return open ? <ImportSession onOpenChange={onOpenChange} /> : null;
}

function ImportSession({ onOpenChange }: Pick<Props, 'onOpenChange'>) {
  const { t } = useTranslation();
  const [bridge] = useState(getPublicBrowserBridge);
  const [summary, setSummary] = useState<ElectronBrowserAccountSummary | null>(null);
  const [sources, setSources] = useState<ElectronBrowserImportSources['sources']>([]);
  const [profiles, setProfiles] = useState<
    Partial<Record<AccountImportBrowserId, ElectronBrowserProfileChoice[]>>
  >({});
  const [browserId, setBrowserId] = useState<AccountImportBrowserId | null>(null);
  const [choice, setChoice] = useState('');
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<BrowserAccountSiteId>>(
    () => new Set(BROWSER_ACCOUNT_SITE_IDS)
  );
  const [error, setError] = useState<BrowserAccountImportErrorCode | null>(null);
  const [report, setReport] = useState<ElectronBrowserImportReport | null>(null);
  const operation = useRef<string | null>(null);
  const live = useRef(true);
  const catalogRequest = useRef(0);
  const privacyRequest = useRef(0);

  const loadSources = useCallback(async () => {
    const request = ++catalogRequest.current;
    setLoading(true);
    setError(null);
    setCatalogFailed(false);
    try {
      if (!bridge) throw new Error('unavailable');
      const nextSummary = await bridge.getAccountSummary();
      if (!live.current || catalogRequest.current !== request) return;
      setSummary(nextSummary);
      if (!nextSummary.importAvailable || nextSummary.recoveryRequired) return;
      const next = await bridge.getImportSources();
      if (!live.current || catalogRequest.current !== request) return;
      setSources(next.sources);
      const browser =
        next.sources.find((source) => source.browserId === 'chrome') ?? next.sources[0];
      if (browser) {
        setBrowserId(browser.browserId);
        setChoice(`browser:${browser.browserId}`);
      }
    } catch {
      if (live.current && catalogRequest.current === request) {
        setCatalogFailed(true);
        setError('unavailable');
      }
    } finally {
      if (live.current && catalogRequest.current === request) setLoading(false);
    }
  }, [bridge]);

  const endSession = useCallback(() => {
    live.current = false;
    catalogRequest.current++;
    privacyRequest.current++;
    if (operation.current)
      void bridge?.cancelAccountImport(operation.current).catch(() => undefined);
  }, [bridge]);

  useEffect(() => {
    live.current = true;
    void loadSources();
    return endSession;
  }, [endSession, loadSources]);

  const profile = browserId
    ? profiles[browserId]?.find((entry) => choiceKey(browserId, entry.id) === choice)
    : undefined;
  const needsProfile = Boolean(browserId && profiles[browserId]?.length && !profile);

  const close = async () => {
    const operationId = operation.current;
    if (operationId && bridge) {
      const outcome = await bridge.cancelAccountImport(operationId).catch(() => 'finishing');
      if (!live.current) return;
      if (outcome === 'finishing' && operation.current === operationId) {
        setFinishing(true);
        return;
      }
    }
    operation.current = null;
    privacyRequest.current++;
    onOpenChange(false);
  };

  const runImport = async () => {
    if (catalogFailed) {
      await loadSources();
      return;
    }
    if (!bridge || !browserId || needsProfile || selected.size === 0 || operation.current) return;
    const operationId = crypto.randomUUID();
    operation.current = operationId;
    setBusy(true);
    setError(null);
    setFinishing(false);
    privacyRequest.current++;
    setSettingsOpened(false);
    setSettingsFailed(false);
    try {
      const result = await bridge.importBrowserAccount({
        operationId,
        browserId,
        ...(profile ? { profileId: profile.id } : {}),
        siteIds: [...selected],
      });
      if (!live.current || operation.current !== operationId) return;
      if (result.ok) {
        if ('profiles' in result) {
          setProfiles((current) => ({ ...current, [browserId]: result.profiles }));
          setChoice('');
        } else setReport(result.report);
      } else setError(result.error);
    } catch {
      if (live.current && operation.current === operationId) setError('unavailable');
    } finally {
      if (operation.current === operationId) {
        operation.current = null;
        if (live.current) {
          setBusy(false);
          setFinishing(false);
        }
      }
    }
  };

  const openPrivacySettings = async () => {
    const request = ++privacyRequest.current;
    setSettingsFailed(false);
    try {
      const result = await bridge?.openBrowserDataPrivacySettings();
      if (!live.current || privacyRequest.current !== request) return;
      setSettingsOpened(Boolean(result?.opened));
      setSettingsFailed(!result?.opened);
    } catch {
      if (live.current && privacyRequest.current === request) setSettingsFailed(true);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContentWithoutClose className="flex max-w-xl flex-col gap-5 overflow-y-auto">
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-3 top-3 h-7 w-7"
          aria-label={t('common.close')}
          onClick={() => void close()}
          disabled={finishing}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
        <DialogHeader className="pr-7">
          <DialogTitle>{t('settings.browserImport.title')}</DialogTitle>
          <DialogDescription>{t('settings.browserImport.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <label
            id="browser-import-source-label"
            className="shrink-0 text-sm text-muted-foreground"
          >
            {t('settings.browserImport.from')}
          </label>
          <Select
            value={choice}
            disabled={busy || loading || Boolean(report)}
            onValueChange={(value) => {
              const source = sources.find(
                (entry) =>
                  `browser:${entry.browserId}` === value ||
                  profiles[entry.browserId]?.some(
                    (candidate) => choiceKey(entry.browserId, candidate.id) === value
                  )
              );
              if (!source) return;
              setBrowserId(source.browserId);
              setChoice(value);
              setError(null);
              setReport(null);
              privacyRequest.current++;
              setSettingsOpened(false);
              setSettingsFailed(false);
            }}
          >
            <SelectTrigger
              aria-labelledby="browser-import-source-label"
              className="min-w-0 flex-1 bg-input-field"
            >
              <SelectValue
                placeholder={t(
                  loading
                    ? 'settings.browserImport.loading'
                    : needsProfile
                      ? 'settings.browserImport.chooseProfile'
                      : 'settings.browserImport.noSources'
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {sources.map((source) => (
                <SelectGroup key={source.browserId}>
                  <SelectItem value={`browser:${source.browserId}`}>
                    {source.browserName}
                  </SelectItem>
                  {profiles[source.browserId]?.length ? (
                    <>
                      <SelectLabel>{source.browserName}</SelectLabel>
                      {profiles[source.browserId]!.map((candidate) => (
                        <SelectItem
                          key={candidate.id}
                          value={choiceKey(source.browserId, candidate.id)}
                        >
                          {source.browserName} · {candidate.name}
                        </SelectItem>
                      ))}
                    </>
                  ) : null}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        {needsProfile ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('settings.browserImport.profileRequired')}
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-muted-foreground">
          <WithInfo
            text={t('settings.browserImport.authorization')}
            info={t('settings.browserImport.authorizationDetail')}
          />
          {summary && !summary.persistent ? (
            <span className="mt-1 block">{t('settings.browserAccounts.developmentMemory')}</span>
          ) : null}
        </p>
        <Collapsible
          open={expanded}
          onOpenChange={setExpanded}
          className="rounded-lg border border-border"
        >
          <CollapsibleTrigger className="flex w-full items-center gap-3 p-4 text-left text-sm">
            <span className="flex-1 font-medium">{t('settings.browserImport.websites')}</span>
            <span className="text-xs text-muted-foreground">
              {t('settings.browserImport.selected', {
                count: selected.size,
                total: BROWSER_ACCOUNT_SITES.length,
              })}
            </span>
            <ChevronDown
              aria-hidden
              className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="max-h-72 space-y-3 overflow-y-auto border-t border-border px-4 py-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  disabled={busy || Boolean(report)}
                  checked={
                    selected.size === BROWSER_ACCOUNT_SITES.length
                      ? true
                      : selected.size > 0
                        ? 'indeterminate'
                        : false
                  }
                  onCheckedChange={(checked) =>
                    setSelected(new Set(checked === true ? BROWSER_ACCOUNT_SITE_IDS : []))
                  }
                />
                {t('settings.browserImport.selectAll')}
              </label>
              {(['design', 'commerce'] as const).map((group) => (
                <div key={group} className="space-y-2">
                  <h3 className="pt-2 text-xs font-medium text-muted-foreground">
                    {t(`settings.browserImport.group.${group}`)}
                  </h3>
                  {BROWSER_ACCOUNT_SITES.filter((site) => site.group === group).map((site) => (
                    <label
                      key={site.id}
                      className="flex cursor-pointer items-start gap-3 rounded-md py-1.5 text-sm"
                    >
                      <Checkbox
                        className="mt-0.5"
                        disabled={busy || Boolean(report)}
                        checked={selected.has(site.id)}
                        onCheckedChange={(checked) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked === true) next.add(site.id);
                            else next.delete(site.id);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block">{site.name}</span>
                        <span className="block break-words text-xs leading-relaxed text-muted-foreground">
                          {site.domains.join(', ')}
                        </span>
                      </span>
                      {report ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {report.sites.find((row) => row.siteId === site.id)?.imported ?? 0}
                        </span>
                      ) : null}
                    </label>
                  ))}
                </div>
              ))}
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('settings.browserImport.domainScope')}
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
        {summary && !summary.importAvailable ? (
          <p role="alert" className="text-sm text-muted-foreground">
            {t(
              `settings.browserAccounts.importUnavailableReasons.${summary.importUnavailableReason ?? 'macos-required'}`
            )}
          </p>
        ) : null}
        {summary?.recoveryRequired ? (
          <p role="alert" className="text-sm text-destructive">
            {t('settings.browserImport.errors.restore-incomplete')}
          </p>
        ) : null}
        {error ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{t(`settings.browserImport.errors.${error}`)}</p>
            {error === 'source-access-denied' ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void openPrivacySettings()}
                >
                  {t('settings.browserAccounts.openFilesAndFolders')}
                </Button>
                {settingsOpened ? (
                  <p className="text-xs text-muted-foreground">
                    {t('settings.browserImport.settingsReturn')}
                  </p>
                ) : null}
                {settingsFailed ? (
                  <p className="text-xs">
                    {t('settings.browserAccounts.openFilesAndFoldersFailed')}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        {busy ? (
          <p role="status" className="flex items-start gap-2 text-xs text-muted-foreground">
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
            {t(finishing ? 'settings.browserImport.finishing' : 'settings.browserImport.importing')}
          </p>
        ) : null}
        {report ? (
          <div role="status" className="space-y-1 text-sm">
            <p>
              {t(
                report.imported > 0
                  ? 'settings.browserImport.completed'
                  : 'settings.browserImport.empty',
                {
                  count: report.imported,
                  sites: report.sites.filter((row) => row.imported > 0).length,
                }
              )}
            </p>
            {report.skippedExpired + report.skippedPartitioned > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('settings.browserImport.skipped', {
                  expired: report.skippedExpired,
                  partitioned: report.skippedPartitioned,
                })}
              </p>
            ) : null}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('settings.browserImport.verifyLogin')}
            </p>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('settings.browserImport.mergeHint')}
          </p>
        )}
        <DialogFooter>
          {!report ? (
            <Button variant="outline" onClick={() => void close()} disabled={finishing}>
              {t('common.cancel')}
            </Button>
          ) : null}
          <Button
            onClick={() => (report ? onOpenChange(false) : void runImport())}
            disabled={
              !report &&
              (loading ||
                busy ||
                (!browserId && !catalogFailed) ||
                needsProfile ||
                selected.size === 0 ||
                Boolean(summary && (!summary.importAvailable || summary.recoveryRequired)))
            }
          >
            {t(
              report
                ? 'settings.browserImport.done'
                : busy
                  ? 'settings.browserAccounts.importing'
                  : settingsOpened
                    ? 'settings.browserImport.continue'
                    : error
                      ? 'settings.browserImport.retry'
                      : 'settings.browserImport.import'
            )}
          </Button>
        </DialogFooter>
      </DialogContentWithoutClose>
    </Dialog>
  );
}
