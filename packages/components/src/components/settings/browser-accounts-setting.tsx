import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ElectronBrowserAccountSummary } from '@molly/shared/electron-ipc';
import { getPublicBrowserBridge } from '@/lib/electron-ipc-client';
import { Button } from '@/ui/button';
import { BrowserAccountImportDialog } from './browser-account-import-dialog';

export function BrowserAccountsSetting() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<ElectronBrowserAccountSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [cleared, setCleared] = useState(false);
  const refresh = useCallback(async () => {
    const bridge = getPublicBrowserBridge();
    if (bridge) setSummary(await bridge.getAccountSummary());
  }, []);
  useEffect(() => {
    void refresh().catch(() => setError(true));
  }, [refresh]);
  const clear = async () => {
    if (!window.confirm(t('settings.browserImport.clearConfirm'))) return;
    const bridge = getPublicBrowserBridge();
    if (!bridge) return;
    setBusy(true);
    setError(false);
    setCleared(false);
    try {
      await bridge.clearAccountData();
      await refresh();
      setCleared(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('settings.browserImport.settingsDescription')}
        </p>
        <Button
          onClick={() => {
            setCleared(false);
            setOpen(true);
          }}
          disabled={busy || !getPublicBrowserBridge()}
        >
          {t('settings.browserAccounts.importFromBrowser')}
        </Button>
        {summary ? (
          <p className="text-xs text-muted-foreground">
            {t('settings.browserImport.saved', { count: summary.cookieCount })}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('settings.browserImport.clearDescription')}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !summary}
          onClick={() => void clear()}
        >
          {t(busy ? 'settings.browserImport.clearing' : 'settings.browserImport.clear')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t('settings.browserImport.clearFailed')}
        </p>
      ) : null}
      {cleared ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('settings.browserImport.cleared')}
        </p>
      ) : null}
      <BrowserAccountImportDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) void refresh().catch(() => setError(true));
        }}
      />
    </div>
  );
}
