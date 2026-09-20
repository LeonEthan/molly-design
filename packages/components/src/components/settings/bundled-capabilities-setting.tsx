import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getIpcServices, type IpcServices } from '@/lib/electron-ipc-client';
import { CompactSection } from './compact-layout';

type Snapshot = Awaited<ReturnType<IpcServices['modelConnections']['getBundledCapabilities']>>;

export function BundledCapabilitiesView({ snapshot }: { snapshot: Snapshot | null | undefined }) {
  const { t } = useTranslation();
  return (
    <CompactSection
      title={t('settings.models.capabilitiesTitle')}
      description={t('settings.models.capabilitiesHint')}
    >
      <div className="space-y-3 p-3 text-sm">
        {snapshot === undefined ? (
          <p role="status">{t('settings.models.capabilitiesLoading')}</p>
        ) : snapshot === null ? (
          <p role="status">{t('settings.models.capabilitiesUnavailable')}</p>
        ) : (
          <>
            <p>
              {t('settings.models.capabilitiesEngine', { version: snapshot.harness.engineVersion })}
            </p>
            <p className="break-all text-xs text-muted-foreground">
              {t('settings.models.capabilitiesBuild', { build: snapshot.harness.buildId })}
            </p>
            <ul className="space-y-3">
              {snapshot.extensions.map((extension) => (
                <li key={extension.name} className="space-y-1">
                  <p className="font-medium">
                    {extension.name} · {extension.version} · {extension.license}
                  </p>
                  <p>{t('settings.models.capabilitiesQuestion')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.models.capabilitiesQuestionActivation')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.models.capabilitiesLimits')}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </CompactSection>
  );
}

export function BundledCapabilitiesSetting() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>();
  useEffect(() => {
    let active = true;
    const services = getIpcServices();
    const result = services?.modelConnections.getBundledCapabilities() ?? Promise.resolve(null);
    void result.then(
      (value) => {
        if (active) setSnapshot(value);
      },
      () => {
        if (active) setSnapshot(null);
      }
    );
    return () => {
      active = false;
    };
  }, []);
  return <BundledCapabilitiesView snapshot={snapshot} />;
}
