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
import { getPublicBrowserBridge, onIpcEvent } from '@/lib/electron-ipc-client';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { ArrowUpRight, ChevronDown, Loader2, X } from '@/ui/icons';
import { BrowserImportAccess, type BrowserImportAccessState } from './browser-import-access';
import { InfoTip } from './info-tip';
import {
  Dialog,
  DialogContentWithoutClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible';

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

export function BrowserAccountImportDialog({ open, onOpenChange }: Props) {
  return open ? <ImportSession variant="dialog" onOpenChange={onOpenChange} /> : null;
}

/** The same import, laid out inline for a host that supplies its own frame and title. */
export function BrowserAccountImportPanel({ onClose }: { onClose: () => void }) {
  return (
    <ImportSession
      variant="panel"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    />
  );
}

const REPORT_COLUMNS = ['discovered', 'imported', 'skipped', 'failed'] as const;

function ImportSession({
  onOpenChange,
  variant,
}: Pick<Props, 'onOpenChange'> & { variant: 'dialog' | 'panel' }) {
  const { t } = useTranslation();
  const [bridge] = useState(getPublicBrowserBridge);
  const [summary, setSummary] = useState<ElectronBrowserAccountSummary | null>(null);
  const [sources, setSources] = useState<ElectronBrowserImportSources['sources']>([]);
  const [browserId, setBrowserId] = useState<AccountImportBrowserId | null>(null);
  const [profiles, setProfiles] = useState<ElectronBrowserProfileChoice[]>([]);
  const [profileId, setProfileId] = useState('');
  const [loading, setLoading] = useState(true);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [access, setAccess] = useState<BrowserImportAccessState>('unrequested');
  const [applicationName, setApplicationName] = useState('Molly');
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [rechecked, setRechecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<BrowserAccountSiteId>>(
    () => new Set(BROWSER_ACCOUNT_SITE_IDS)
  );
  const [error, setError] = useState<BrowserAccountImportErrorCode | null>(null);
  const [report, setReport] = useState<ElectronBrowserImportReport | null>(null);
  const operation = useRef<string | null>(null);
  const listing = useRef<string | null>(null);
  const live = useRef(true);
  const catalogRequest = useRef(0);
  const refreshing = useRef<number | null>(null);
  const accessRef = useRef(access);
  accessRef.current = access;
  const browserRef = useRef<AccountImportBrowserId | null>(null);
  browserRef.current = browserId;

  const denyAccess = useCallback(() => {
    setProfiles([]);
    setProfileId('');
    setAccess('denied');
  }, []);

  const listProfiles = useCallback(
    async (target: AccountImportBrowserId, request: number) => {
      if (!bridge) throw new Error('unavailable');
      const operationId = crypto.randomUUID();
      listing.current = operationId;
      setProfiles([]);
      setProfileId('');
      try {
        const result = await bridge.getImportProfiles(target, operationId);
        if (!live.current || catalogRequest.current !== request) return undefined;
        if (result.ok) {
          setAccess('readable');
          setProfiles(result.profiles);
          if (result.profiles.length === 1) setProfileId(result.profiles[0]!.id);
        } else if (result.error === 'source-access-denied') {
          denyAccess();
        } else if (result.error !== 'cancelled') {
          setCatalogFailed(true);
          setError(result.error);
        }
        return result;
      } finally {
        if (listing.current === operationId) listing.current = null;
      }
    },
    [bridge, denyAccess]
  );

  const loadSources = useCallback(
    async (readProfiles = false) => {
      if (refreshing.current !== null) return undefined;
      const request = ++catalogRequest.current;
      refreshing.current = request;
      setLoading(true);
      setError(null);
      setCatalogFailed(false);
      try {
        if (!bridge) throw new Error('unavailable');
        const nextSummary = await bridge.getAccountSummary();
        if (!live.current || catalogRequest.current !== request) return undefined;
        setSummary(nextSummary);
        if (!nextSummary.importAvailable || nextSummary.recoveryRequired) return undefined;
        const next = await bridge.getImportSources();
        if (!live.current || catalogRequest.current !== request) return undefined;
        setSources(next.sources);
        setApplicationName(next.applicationName ?? 'Molly');
        const browser =
          next.sources.find((source) => source.browserId === browserRef.current) ??
          next.sources.find((source) => source.browserId === 'chrome') ??
          next.sources[0];
        if (browser) {
          setBrowserId(browser.browserId);
          if (readProfiles) return await listProfiles(browser.browserId, request);
        }
      } catch (cause) {
        console.error('Failed to read browser import sources', cause);
        if (live.current && catalogRequest.current === request) {
          setCatalogFailed(true);
          setError('unavailable');
        }
      } finally {
        if (refreshing.current === request) refreshing.current = null;
        if (live.current && catalogRequest.current === request) setLoading(false);
      }
      return undefined;
    },
    [bridge, listProfiles]
  );

  const switchBrowser = (target: AccountImportBrowserId) => {
    ++catalogRequest.current;
    setBrowserId(target);
    setProfiles([]);
    setProfileId('');
    setAccess('unrequested');
    setError(null);
    setCatalogFailed(false);
    setRechecked(false);
    setSettingsFailed(false);
  };

  const requestAccess = async () => {
    setSettingsFailed(false);
    const result = await loadSources(true);
    if (!live.current || !result || result.ok || result.error !== 'source-access-denied') return;
    try {
      const opened = await bridge?.openImportSettings();
      if (live.current) setSettingsFailed(!opened?.opened);
    } catch (cause) {
      console.error('Failed to open browser access settings', cause);
      if (live.current) setSettingsFailed(true);
    }
  };

  const recheckAccess = () => {
    setRechecked(true);
    void loadSources(true);
  };

  const cancelListing = useCallback(() => {
    const operationId = listing.current;
    if (operationId) void bridge?.cancelAccountImport(operationId).catch(() => undefined);
  }, [bridge]);

  const endSession = useCallback(() => {
    live.current = false;
    catalogRequest.current++;
    refreshing.current = null;
    cancelListing();
    if (operation.current)
      void bridge?.cancelAccountImport(operation.current).catch(() => undefined);
  }, [bridge, cancelListing]);

  useEffect(() => {
    live.current = true;
    void loadSources();
    return endSession;
  }, [endSession, loadSources]);

  useEffect(() => {
    const retry = () => {
      if (accessRef.current === 'denied' && !operation.current) void loadSources(true);
    };
    const stopNativeForeground = onIpcEvent('app.windowForeground', (foreground) => {
      if (foreground) retry();
    });
    window.addEventListener('focus', retry);
    return () => {
      stopNativeForeground();
      window.removeEventListener('focus', retry);
    };
  }, [loadSources]);

  const profile = profiles.find((entry) => entry.id === profileId);
  const accessGuide =
    Boolean(browserId) &&
    access !== 'readable' &&
    !catalogFailed &&
    Boolean(summary?.importAvailable && !summary.recoveryRequired);
  const importBlocked =
    loading ||
    busy ||
    (!browserId && !catalogFailed) ||
    (Boolean(browserId) && !accessGuide && !catalogFailed && !profile) ||
    selected.size === 0 ||
    Boolean(summary && (!summary.importAvailable || summary.recoveryRequired));

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
    onOpenChange(false);
  };

  const runImport = async () => {
    if (catalogFailed) {
      await loadSources(Boolean(browserId));
      return;
    }
    if (!bridge || !browserId || !profile || selected.size === 0 || operation.current) return;
    const operationId = crypto.randomUUID();
    operation.current = operationId;
    setBusy(true);
    setError(null);
    setFinishing(false);
    try {
      const result = await bridge.importBrowserAccount({
        operationId,
        browserId,
        profileId: profile.id,
        siteIds: [...selected],
      });
      if (!live.current || operation.current !== operationId) return;
      if (result.ok) setReport(result.report);
      else if (result.error === 'profile-changed') {
        setError(result.error);
        await listProfiles(browserId, catalogRequest.current);
      } else if (result.error === 'source-access-denied') denyAccess();
      else setError(result.error);
    } catch (cause) {
      console.error('Browser account import failed', cause);
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

  const reportRows = report
    ? report.sites.map((row) => ({
        row,
        name: BROWSER_ACCOUNT_SITES.find((site) => site.id === row.siteId)?.name ?? row.siteId,
      }))
    : [];

  const fields = (
    <>
      {sources.length > 1 ? (
        <div className="flex items-center gap-3">
          <label
            id="browser-import-source-label"
            className="w-16 shrink-0 text-sm text-muted-foreground"
          >
            {t('settings.browserImport.from')}
          </label>
          <Select
            value={browserId ?? ''}
            disabled={busy || loading || Boolean(report)}
            onValueChange={(value) => void switchBrowser(value as AccountImportBrowserId)}
          >
            <SelectTrigger
              aria-labelledby="browser-import-source-label"
              className="w-full min-w-0 bg-input-field pr-4"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sources.map((source) => (
                <SelectItem key={source.browserId} value={source.browserId}>
                  {source.browserName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {browserId &&
      !report &&
      !catalogFailed &&
      summary?.importAvailable &&
      !summary.recoveryRequired ? (
        <BrowserImportAccess
          state={access}
          applicationName={applicationName}
          browserName={
            sources.find((source) => source.browserId === browserId)?.browserName ?? browserId
          }
          pending={loading || busy}
          onRecheck={recheckAccess}
        />
      ) : null}
      {accessGuide && settingsFailed ? (
        <p role="alert" className="text-xs text-destructive">
          {t('settings.browserImport.permission.settingsFailed')}
        </p>
      ) : null}
      {access === 'denied' && rechecked && !loading ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t('settings.browserImport.permission.stillDenied')}
        </p>
      ) : null}
      {!accessGuide ? (
        <div className="flex flex-col gap-2">
          <label id="browser-import-profile-label" className="text-sm text-muted-foreground">
            {t('settings.browserImport.profile')}
          </label>
          <Select
            value={profileId}
            disabled={busy || loading || Boolean(report) || profiles.length === 0}
            onValueChange={(value) => {
              setProfileId(value);
              setError(null);
            }}
          >
            <SelectTrigger
              aria-labelledby="browser-import-profile-label"
              className="w-full min-w-0 bg-input-field pr-4"
            >
              <SelectValue
                placeholder={t(
                  loading
                    ? 'settings.browserImport.loading'
                    : profiles.length > 0
                      ? 'settings.browserImport.chooseProfile'
                      : 'settings.browserImport.noProfiles'
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {report ? (
        <div
          role="status"
          className="max-h-72 overflow-y-auto rounded-lg border border-border px-4 py-3"
        >
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="pb-2 text-left font-medium">
                  {t('settings.browserImport.websites')}
                </th>
                {REPORT_COLUMNS.map((column) => (
                  <th key={column} scope="col" className="pb-2 pl-3 text-right font-medium">
                    {t(`settings.browserImport.columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reportRows.map(({ row, name }) => (
                <tr key={row.siteId} data-site-id={row.siteId}>
                  <th scope="row" className="py-1 text-left font-normal">
                    {name}
                  </th>
                  {REPORT_COLUMNS.map((column) => (
                    <td key={column} className="py-1 pl-3 text-right">
                      {row[column]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
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
                  disabled={busy}
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
                        disabled={busy}
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
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
      {access === 'readable' && !report ? (
        <div className="flex justify-end">
          <InfoTip>{t('settings.browserImport.permission.privacyNote')}</InfoTip>
        </div>
      ) : null}
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
        <div role="alert" className="text-sm text-destructive">
          <p>{t(`settings.browserImport.errors.${error}`)}</p>
        </div>
      ) : null}
      {busy ? (
        <p role="status" className="flex items-start gap-2 text-xs text-muted-foreground">
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          {t(finishing ? 'settings.browserImport.finishing' : 'settings.browserImport.importing')}
        </p>
      ) : null}
    </>
  );
  const actions = (
    <>
      {!report ? (
        <Button variant="outline" onClick={() => void close()} disabled={finishing}>
          {t(variant === 'panel' ? 'settings.browserImport.notNow' : 'common.cancel')}
        </Button>
      ) : null}
      {accessGuide && !report ? (
        <Button disabled={importBlocked} onClick={() => void requestAccess()}>
          {t('settings.browserImport.permission.openSettings')}
          <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Button>
      ) : (
        <Button
          onClick={() => (report ? onOpenChange(false) : void runImport())}
          disabled={!report && importBlocked}
        >
          {t(
            report
              ? 'settings.browserImport.done'
              : busy
                ? 'settings.browserAccounts.importing'
                : error
                  ? 'settings.browserImport.retry'
                  : 'settings.browserImport.import'
          )}
        </Button>
      )}
    </>
  );

  if (variant === 'panel')
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <div data-drawer-body="" className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5">{fields}</div>
        </div>
        <div
          data-drawer-footer=""
          className="mt-5 flex shrink-0 justify-end gap-2 border-t border-border/40 pt-4"
        >
          {actions}
        </div>
      </div>
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <DialogContentWithoutClose
        aria-describedby={undefined}
        className="flex max-w-xl flex-col gap-5 overflow-y-auto"
      >
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
        </DialogHeader>
        {fields}
        <DialogFooter>{actions}</DialogFooter>
      </DialogContentWithoutClose>
    </Dialog>
  );
}
