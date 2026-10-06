import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MollyPiPackage } from '@molly/shared/embedded-harness';
import { getIpcServices, type IpcServices } from '@/lib/electron-ipc-client';
import {
  AtSign,
  BookOpen,
  Cpu,
  ChevronDown,
  CircleQuestionMark,
  Search,
  ShieldCheck,
  type LucideIcon,
} from '@/ui/icons';
import { Button } from '@/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/ui/collapsible';
import { CompactSection } from './compact-layout';
import { WithInfo } from './info-tip';

type Snapshot = Awaited<ReturnType<IpcServices['modelConnections']['getBundledCapabilities']>>;

const addonCopy: Record<MollyPiPackage, { slug: string; icon: LucideIcon }> = {
  'pi-skillful': { slug: 'skills', icon: BookOpen },
  '@juicesharp/rpiv-ask-user-question': { slug: 'questions', icon: CircleQuestionMark },
  '@zigai/pi-mention-skill': { slug: 'mentions', icon: AtSign },
  '@ff-labs/pi-fff': { slug: 'fileSearch', icon: Search },
  'cc-safety-net': { slug: 'safetyNet', icon: ShieldCheck },
};

function PackageLine({
  name,
  version,
  license,
}: {
  name: string;
  version: string;
  license: string;
}) {
  return (
    <p className="break-all font-mono text-[11px] text-muted-foreground" title={name}>
      {name} · {version} · {license}
    </p>
  );
}

function EngineRow({
  icon: Icon,
  title,
  description,
  info,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  info?: string;
}) {
  return (
    <li className="flex gap-3 px-5 py-3.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05]">
        <Icon aria-hidden className="h-4 w-4 text-foreground" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm text-foreground">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          <WithInfo text={description} info={info} />
        </p>
      </div>
    </li>
  );
}

export function BundledCapabilitiesView({ snapshot }: { snapshot: Snapshot | null | undefined }) {
  const { t } = useTranslation();
  return (
    <CompactSection
      title={t('settings.models.capabilitiesTitle')}
      description={t('settings.engine.description')}
      info={t('settings.models.capabilitiesHint')}
    >
      {snapshot === undefined ? (
        <p role="status" className="px-5 pb-5 text-sm">
          {t('settings.models.capabilitiesLoading')}
        </p>
      ) : snapshot === null ? (
        <p role="status" className="px-5 pb-5 text-sm">
          {t('settings.models.capabilitiesUnavailable')}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border/40 border-t border-border/40 pb-1">
            <EngineRow
              icon={Cpu}
              title={t('settings.engine.pi.title', { version: snapshot.engine.version })}
              description={t('settings.engine.pi.description')}
            />
            <li className="px-5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('settings.engine.addonsTitle', { count: snapshot.addons.length })}
            </li>
            {snapshot.addons.map((addon) => {
              const copy = addonCopy[addon.name as MollyPiPackage];
              return (
                <EngineRow
                  key={addon.name}
                  icon={copy?.icon ?? Cpu}
                  title={copy ? t(`settings.engine.addons.${copy.slug}.title`) : addon.name}
                  description={copy ? t(`settings.engine.addons.${copy.slug}.description`) : ''}
                  info={
                    copy?.slug === 'questions'
                      ? `${t('settings.models.capabilitiesQuestionActivation')} ${t('settings.models.capabilitiesLimits')}`
                      : undefined
                  }
                />
              );
            })}
          </ul>
          <Collapsible className="px-5 py-3">
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
                {t('settings.engine.technicalDetails')}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-2">
              <PackageLine {...snapshot.engine} />
              {snapshot.addons.map((addon) => (
                <PackageLine key={addon.name} {...addon} />
              ))}
              <p className="break-all font-mono text-[11px] text-muted-foreground">
                {t('settings.models.capabilitiesBuild', { build: snapshot.harness.buildId })}
              </p>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
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
