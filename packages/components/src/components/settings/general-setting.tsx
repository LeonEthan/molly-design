import { useMemo, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  GetNotificationPermissionStatusResult,
  OpenSystemNotificationSettingsResult,
} from '@molly/shared';
import { Loading } from '@/ui';
import { Switch } from '@/ui/switch';
import { toast } from 'sonner';
import {
  electronSessionCompletionNotificationsEnabledAtom,
  queuedMessageBehaviorAtom,
  sessionSidebarCodeChangesOnlyAtom,
} from '@/atoms';
import { useAtom } from 'jotai';
import { CompactRow, CompactSection } from './compact-layout';
import { settingContainerClass } from '.';
import { AutoArchiveSection } from './auto-archive-setting';

import { QueuedMessageBehaviorControl } from './queued-message-behavior-control';
import { CliDaemonSetting } from './cli-daemon-setting';
import { useAppCapability } from '@/lib/app-platform';
import { getIpcServices } from '@/lib/electron-ipc-client';
import { useElectronAutoLaunch } from '@/hooks/use-electron-auto-launch';

type ElectronPlatform = 'darwin' | 'win32' | 'linux' | 'unknown';

type ElectronNotificationPermissionStatusResult = GetNotificationPermissionStatusResult;

function normalizeElectronPlatform(platform: string | undefined): ElectronPlatform {
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') {
    return platform;
  }
  return 'unknown';
}

function getDesktopNotificationHintKey(platform: ElectronPlatform): string {
  switch (platform) {
    case 'darwin':
      return 'settings.notifications.desktopHint.darwin';
    case 'win32':
      return 'settings.notifications.desktopHint.win32';
    case 'linux':
      return 'settings.notifications.desktopHint.linux';
    default:
      return 'settings.notifications.desktopHint.unknown';
  }
}

/**
 * Fetches the prevent-sleep setting from the main process on mount.
 */
function useElectronPreventSleepSetting(
  isElectron: boolean,
  setEnabled: (enabled: boolean) => void
) {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const services = getIpcServices();
    if (!isElectron || !services) {
      return undefined;
    }
    let active = true;
    void services.app.getPreventSleepEnabled().then((result) => {
      if (active && typeof result?.enabled === 'boolean') {
        setEnabled(result.enabled);
      }
    });
    return () => {
      active = false;
    };
  }, [isElectron, setEnabled]);
}

/**
 * 通用设置页面组件
 * 包含通知、输入和桌面客户端设置
 */
export function GeneralSettingsComponent() {
  const { t } = useTranslation();
  const githubIntegrationAvailable = useAppCapability('githubIntegration');
  const [electronCompletionNotificationsEnabled, setElectronCompletionNotificationsEnabled] =
    useAtom(electronSessionCompletionNotificationsEnabledAtom);
  const [sessionSidebarCodeChangesOnly, setSessionSidebarCodeChangesOnly] = useAtom(
    sessionSidebarCodeChangesOnlyAtom
  );
  const [queuedMessageBehavior, setQueuedMessageBehavior] = useAtom(queuedMessageBehaviorAtom);
  const [preventSleepEnabled, setPreventSleepEnabled] = useState(true);
  const isElectron = typeof window !== 'undefined' && window.__MOLLY_ELECTRON__ === true;
  const autoLaunch = useElectronAutoLaunch(isElectron);
  const electronPlatform = useMemo(() => {
    if (!isElectron || typeof window === 'undefined') {
      return 'unknown';
    }
    return normalizeElectronPlatform(window.__MOLLY_PLATFORM__?.os);
  }, [isElectron]);
  const [notificationSupported, setNotificationSupported] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>('default');
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const isSwitchDisabled = !notificationSupported || isProcessing;

  const readElectronNotificationPermission =
    useCallback(async (): Promise<ElectronNotificationPermissionStatusResult> => {
      if (typeof window === 'undefined') {
        return {
          supported: false,
          permission: 'default',
          source: 'renderer',
          error: 'Window is not available',
        };
      }

      const rendererSupported = 'Notification' in window && typeof Notification === 'function';
      const rendererPermission: NotificationPermission = rendererSupported
        ? Notification.permission
        : 'default';

      const services = getIpcServices();
      const reader = services
        ? services.notifications.getPermissionStatus.bind(services.notifications)
        : undefined;
      if (reader) {
        try {
          const result = await reader();
          if (
            result &&
            typeof result === 'object' &&
            typeof result.supported === 'boolean' &&
            (result.permission === 'granted' ||
              result.permission === 'denied' ||
              result.permission === 'default')
          ) {
            if (
              result.supported &&
              result.source === 'renderer' &&
              result.permission === 'default'
            ) {
              return {
                ...result,
                supported: rendererSupported,
                permission: rendererPermission,
              };
            }
            return result;
          }
        } catch (error) {
          return {
            supported: false,
            permission: 'default',
            source: 'renderer',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      return {
        supported: rendererSupported,
        permission: rendererPermission,
        source: 'renderer',
      };
    }, []);

  const syncNotificationPermission = useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!isElectron) return;
    const result = await readElectronNotificationPermission();
    setNotificationSupported(result.supported);
    setPermissionStatus(result.permission);
    setNotificationsEnabled(
      result.supported && result.permission === 'granted' && electronCompletionNotificationsEnabled
    );
  }, [electronCompletionNotificationsEnabled, isElectron, readElectronNotificationPermission]);

  useEffect(() => {
    void syncNotificationPermission();

    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void syncNotificationPermission();
      }
    };

    const handleWindowFocus = () => {
      void syncNotificationPermission();
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [syncNotificationPermission]);

  useEffect(() => {
    if (!isElectron) {
      return undefined;
    }
    void syncNotificationPermission();
    return undefined;
  }, [electronCompletionNotificationsEnabled, isElectron, syncNotificationPermission]);

  useElectronPreventSleepSetting(isElectron, setPreventSleepEnabled);

  const permissionLabel = useMemo(() => {
    if (!notificationsEnabled) return t('settings.notifications.disabledDesktop');
    switch (permissionStatus) {
      case 'granted':
        return t('settings.notifications.permissionGranted');
      case 'denied':
        return t('settings.notifications.permissionDeniedStatusDesktop');
      default:
        return t('settings.notifications.permissionDefault');
    }
  }, [notificationsEnabled, permissionStatus, t]);

  const disableReason = notificationSupported
    ? undefined
    : t('settings.notifications.reason.notSupported');

  const desktopHint = useMemo(() => {
    return t(getDesktopNotificationHintKey(electronPlatform));
  }, [electronPlatform, t]);

  const openSystemNotificationSettings =
    useCallback(async (): Promise<OpenSystemNotificationSettingsResult> => {
      if (typeof window === 'undefined') {
        return { opened: false, platform: 'unknown', error: 'Window is not available' };
      }

      const services = getIpcServices();
      const opener = services
        ? services.notifications.openSystemSettings.bind(services.notifications)
        : undefined;
      if (!opener) {
        return {
          opened: false,
          platform: window.__MOLLY_PLATFORM__?.os ?? 'unknown',
          error: 'openSystemNotificationSettings is not available',
        };
      }

      try {
        return await opener();
      } catch (error) {
        return {
          opened: false,
          platform: window.__MOLLY_PLATFORM__?.os ?? 'unknown',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }, []);

  const handleToggleNotifications = async (checked: boolean) => {
    if (!notificationSupported) {
      return;
    }

    const previousValue = notificationsEnabled;
    const previousElectronEnabled = electronCompletionNotificationsEnabled;
    setIsProcessing(true);

    try {
      if (!checked) {
        setElectronCompletionNotificationsEnabled(false);
        setNotificationsEnabled(false);
        return;
      }

      const initialPermission = await readElectronNotificationPermission();
      setNotificationSupported(initialPermission.supported);
      setPermissionStatus(initialPermission.permission);
      if (!initialPermission.supported) {
        setElectronCompletionNotificationsEnabled(false);
        setNotificationsEnabled(false);
        toast.error(t('settings.notifications.unsupportedDesktop'));
        return;
      }

      let currentPermission = initialPermission.permission;
      if (
        currentPermission !== 'granted' &&
        typeof Notification === 'function' &&
        typeof Notification.requestPermission === 'function'
      ) {
        try {
          currentPermission = await Notification.requestPermission();
          setPermissionStatus(currentPermission);
        } catch {
          currentPermission = initialPermission.permission;
        }
      }

      if (currentPermission !== 'granted') {
        setElectronCompletionNotificationsEnabled(false);
        setNotificationsEnabled(false);
        const openResult = await openSystemNotificationSettings();
        toast.error(t('settings.notifications.permissionDenied'), {
          description: openResult.opened
            ? t('settings.notifications.permissionDeniedDescriptionDesktopOpened', {
                hint: desktopHint,
              })
            : t('settings.notifications.permissionDeniedDescriptionDesktop', {
                hint: desktopHint,
              }),
        });
        return;
      }

      setElectronCompletionNotificationsEnabled(true);
      setNotificationsEnabled(true);
      return;
    } catch (error) {
      console.error('Failed to toggle notifications', error);
      toast.error(t('settings.notifications.error'), {
        description: t('settings.notifications.errorDescription'),
      });
      setElectronCompletionNotificationsEnabled(previousElectronEnabled);
      void syncNotificationPermission();
      setNotificationsEnabled(previousValue);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div className={settingContainerClass}>
        <CompactSection>
          <CompactRow
            label={t(
              'settings.general.sessions.queuedMessageBehavior.label',
              'Queued message behavior'
            )}
            helper={t(
              'settings.general.sessions.queuedMessageBehavior.helper',
              'Choose whether messages sent while the agent is working wait in the queue or steer the active response.'
            )}
          >
            <QueuedMessageBehaviorControl
              value={queuedMessageBehavior}
              onChange={setQueuedMessageBehavior}
            />
          </CompactRow>
          <CompactRow
            label={t(
              'settings.general.sessions.codeOnlyLineChanges.label',
              'Show code-only line changes'
            )}
            helper={t(
              'settings.general.sessions.codeOnlyLineChanges.helper',
              'When enabled, session sidebar line counts exclude docs, tests, and dev files.'
            )}
          >
            <Switch
              id="session-sidebar-code-changes-only-toggle"
              checked={sessionSidebarCodeChangesOnly}
              onCheckedChange={setSessionSidebarCodeChangesOnly}
            />
          </CompactRow>

          <CompactRow
            label={t('settings.notifications.enableToggleDesktop')}
            helper={
              <span className="flex flex-col gap-0.5">
                <span>{permissionLabel}</span>
                {disableReason && !isProcessing ? <span>{disableReason}</span> : null}
                {permissionStatus !== 'granted' ? <span>{desktopHint}</span> : null}
                {!notificationSupported ? (
                  <span className="text-destructive">
                    {t('settings.notifications.unsupportedDesktop')}
                  </span>
                ) : null}
              </span>
            }
            alignTop
          >
            {isProcessing ? (
              <Loading size="sm" className="h-5 w-9" />
            ) : (
              <Switch
                id="notification-toggle"
                checked={notificationsEnabled}
                disabled={isSwitchDisabled}
                onCheckedChange={(checked) => {
                  void handleToggleNotifications(checked);
                }}
              />
            )}
          </CompactRow>
        </CompactSection>
        {isElectron && (
          <CompactSection title={t('settings.general.autoLaunch.title', 'Startup')}>
            <CliDaemonSetting />
            <CompactRow
              label={t('settings.general.autoLaunch.label', 'Launch at startup')}
              helper={t(
                'settings.general.autoLaunch.helper',
                'Automatically run Molly when you sign in'
              )}
            >
              {autoLaunch.enabledLoading ? (
                <Loading size="sm" className="h-5 w-9" />
              ) : (
                <Switch
                  id="auto-launch-toggle"
                  checked={autoLaunch.enabled}
                  disabled={!autoLaunch.supported || autoLaunch.loading}
                  onCheckedChange={(checked) => {
                    void autoLaunch.updateEnabled(checked);
                  }}
                />
              )}
            </CompactRow>
            <CompactRow
              label={t('settings.general.autoLaunch.hideWindowLabel', 'Hide window on auto-launch')}
              helper={t(
                'settings.general.autoLaunch.hideWindowHelper',
                'Keep the main window hidden when Molly starts automatically after sign-in'
              )}
            >
              {autoLaunch.hideWindowLoading ? (
                <Loading size="sm" className="h-5 w-9" />
              ) : (
                <Switch
                  id="auto-launch-hide-window-toggle"
                  checked={autoLaunch.hideWindowOnAutoLaunch}
                  disabled={!autoLaunch.enabled || autoLaunch.loading}
                  onCheckedChange={(checked) => {
                    void autoLaunch.updateHideWindow(checked);
                  }}
                />
              )}
            </CompactRow>
            <div id="prevent-sleep" className="scroll-mt-24">
              <CompactRow label={t('settings.general.preventSleep.label', 'Prevent sleep')}>
                <Switch
                  id="prevent-sleep-toggle"
                  checked={preventSleepEnabled}
                  onCheckedChange={(checked) => {
                    void (async () => {
                      setPreventSleepEnabled(checked);
                      const result = await getIpcServices()?.app.setPreventSleepEnabled(checked);
                      if (typeof result?.enabled === 'boolean') {
                        setPreventSleepEnabled(result.enabled);
                      }
                    })();
                  }}
                />
              </CompactRow>
            </div>
          </CompactSection>
        )}

        {githubIntegrationAvailable ? <AutoArchiveSection /> : null}
      </div>
    </>
  );
}
