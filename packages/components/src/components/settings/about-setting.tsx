import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom } from 'jotai';
import { Loader2, AlertCircle, Download, ExternalLink } from 'lucide-react';
import type { UpdaterCheckPresentation } from '@/lib/updater-check-presentation';
import {
  readUpdaterCheckPresentation,
  UPDATE_CHECK_UNANSWERED,
} from '@/lib/updater-check-presentation';
import { Button } from '@/ui/button';
import { Switch } from '@/ui/switch';
import { CompactRow, CompactSection } from './compact-layout';
import { settingContainerClass } from '.';
import { useElectronUpdaterState } from '@/hooks/use-electron-updater-state';
import { OpenSourceAttributionsDialog } from './open-source-attributions-dialog';
import { MollyWordmark } from '@/components/molly-wordmark';
import { openExternalUrl } from '@/lib/native-browser';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { toIntlLocaleOrEn } from '@/lib/intl-locale';
import { getMollyDocumentationUrl, MOLLY_REPOSITORY_URL, MOLLY_ISSUES_URL } from '@/lib/molly-urls';
import { developerModeEnabledAtom } from '@/atoms/settings';

const BUILD_DATE = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'development';
const GIT_COMMIT = typeof __GIT_COMMIT__ !== 'undefined' ? __GIT_COMMIT__ : 'unknown';
// Build-time linked client version, injected by the web build. Used when there
// is no Electron updater state (i.e. on the web) so the About panel still shows
// a version number.
const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__.length > 0 ? __APP_VERSION__ : null;

function formatBuildDate(isoDate: string, intlLocale: string): string {
  if (isoDate === 'development') {
    return isoDate;
  }
  try {
    return new Intl.DateTimeFormat(intlLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(isoDate)
    );
  } catch {
    return isoDate;
  }
}

function updateActionLabel(
  presentation: UpdaterCheckPresentation,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  switch (presentation.kind) {
    case 'checking':
      return t('settings.about.checking');
    case 'up_to_date':
      return t('settings.about.upToDate');
    case 'downloading':
      return presentation.percent == null
        ? t('settings.about.downloadingUnknown')
        : t('settings.about.downloading', { percent: String(presentation.percent) });
    case 'ready':
      return t('settings.about.updateAndRestart');
    default:
      return t('settings.about.checkForUpdates');
  }
}

function readableUpdateError(
  message: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (!message || message === UPDATE_CHECK_UNANSWERED) {
    return message === UPDATE_CHECK_UNANSWERED
      ? t('settings.about.checkUnanswered')
      : t('settings.about.updateError');
  }
  return message;
}

export function AboutSettingsComponent() {
  const { t, i18n } = useTranslation();
  const updaterState = useElectronUpdaterState();
  const [isInstalling, setIsInstalling] = useState(false);
  const [developerModeEnabled, setDeveloperModeEnabled] = useAtom(developerModeEnabledAtom);
  const [developerModeRevealed, setDeveloperModeRevealed] = useState(false);

  const handleOpenDownloadPage = useCallback(() => {
    const url = getMollyDocumentationUrl(i18n.resolvedLanguage);
    void openExternalUrl(url);
  }, [i18n.resolvedLanguage]);

  const handleOpenWebsite = useCallback(() => {
    const url = MOLLY_REPOSITORY_URL;
    void openExternalUrl(url);
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    if (!getIpcServices()) return;
    await getIpcServices()!.updater.checkForUpdates();
  }, []);

  const handleQuitAndInstall = useCallback(async () => {
    if (!getIpcServices()) return;
    setIsInstalling(true);
    const result = await getIpcServices()!.updater.quitAndInstall();
    if (!result.ok) {
      setIsInstalling(false);
    }
  }, []);

  const presentation = readUpdaterCheckPresentation(updaterState);
  const showDeveloperModeSwitch = developerModeEnabled || developerModeRevealed;
  // Electron reports its running version through the updater; on the web there
  // is no updater, so fall back to the build-time linked client version.
  const displayVersion = updaterState?.currentVersion ?? APP_VERSION;
  const intlLocale = toIntlLocaleOrEn(i18n.resolvedLanguage ?? i18n.language);

  return (
    <div className={settingContainerClass}>
      <div className="flex flex-col items-start gap-4 py-2">
        <MollyWordmark className="h-12 text-foreground" />
        <p className="text-sm text-muted-foreground">{t('settings.about.mollyDescription')}</p>
      </div>
      <CompactSection>
        {displayVersion && (
          <CompactRow label={t('settings.about.version')}>
            <span className="text-xs tabular-nums text-muted-foreground">{displayVersion}</span>
          </CompactRow>
        )}
        <CompactRow label={t('settings.about.buildDate')}>
          <span className="text-xs tabular-nums text-muted-foreground" title={GIT_COMMIT}>
            {formatBuildDate(BUILD_DATE, intlLocale)}
          </span>
        </CompactRow>
        <CompactRow label={t('sidebar.feedback', 'Feedback')}>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5"
            onClick={() => void openExternalUrl(MOLLY_ISSUES_URL)}
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            {t('settings.about.reportIssue', 'Report an issue')}
          </Button>
        </CompactRow>
        <CompactRow label={t('menu.documentation', 'Documentation')}>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5"
            onClick={handleOpenDownloadPage}
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            {t('settings.about.readGuide', 'Read the guide')}
          </Button>
        </CompactRow>
        <CompactRow label={t('settings.about.website', 'Website')}>
          <Button variant="outline" size="sm" className="h-7 px-2.5" onClick={handleOpenWebsite}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            {t('settings.about.visitWebsite', 'Visit website')}
          </Button>
        </CompactRow>
        <CompactRow label={t('settings.about.openSourceAttributions', 'Open Source Licenses')}>
          <OpenSourceAttributionsDialog
            onTriggerDoubleClick={() => setDeveloperModeRevealed(true)}
          />
        </CompactRow>
        {showDeveloperModeSwitch && (
          <CompactRow
            label={t('settings.about.developerMode', 'Developer mode')}
            helper={t(
              'settings.about.developerModeHelper',
              'Shows local diagnostic controls in settings.'
            )}
          >
            <Switch
              checked={developerModeEnabled}
              onCheckedChange={(checked) => {
                setDeveloperModeEnabled(checked);
                if (!checked) {
                  setDeveloperModeRevealed(false);
                }
              }}
              aria-label={t('settings.about.developerMode', 'Developer mode')}
            />
          </CompactRow>
        )}
        {presentation && (
          <CompactRow label={t('settings.about.checkForUpdates')}>
            {presentation.kind === 'error' ||
            (presentation.kind === 'ready' && presentation.error) ? (
              <span className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                {readableUpdateError(
                  presentation.kind === 'error' ? presentation.message : presentation.error || '',
                  t
                )}
              </span>
            ) : null}
            <Button
              size="sm"
              variant={presentation.kind === 'ready' ? 'default' : 'outline'}
              className="h-7 px-2.5"
              disabled={
                presentation.kind === 'checking' ||
                presentation.kind === 'downloading' ||
                (presentation.kind === 'ready' && isInstalling)
              }
              onClick={() => {
                if (presentation.kind === 'ready') void handleQuitAndInstall();
                else void handleCheckForUpdates();
              }}
            >
              {presentation.kind === 'checking' ||
              presentation.kind === 'downloading' ||
              (presentation.kind === 'ready' && isInstalling) ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : presentation.kind === 'ready' ? (
                <Download className="mr-1 h-3.5 w-3.5" />
              ) : null}
              {updateActionLabel(presentation, t)}
            </Button>
          </CompactRow>
        )}
      </CompactSection>
    </div>
  );
}
