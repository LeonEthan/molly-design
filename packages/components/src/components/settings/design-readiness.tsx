import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Circle, CircleCheck, CircleDashed } from '@/ui/icons';
import {
  getModelConnectionConfigurationIssue,
  type ModelConnection,
  type ProtectedImageConnection,
} from '@molly/shared/embedded-harness';
import { useOpenSettings } from '@/hooks/use-open-settings';
import { getIpcServices, getPublicBrowserBridge } from '@/lib/electron-ipc-client';
import { cn } from '@/lib/utils';

export type DesignReadinessTarget = 'models' | 'image' | 'pinterest';

type ItemState = 'set' | 'unset' | 'unverified' | 'unknown';
type Item = { target: DesignReadinessTarget; label: string; value?: string; state: ItemState };

export type DesignReadinessViewProps = {
  /** Undefined until the saved connections have been read. */
  connections?: readonly ModelConnection[];
  /** Undefined until read; null when no image connection is saved. */
  imageConnection?: ProtectedImageConnection | null;
  /** Undefined until read. A count describes stored data, never a website sign-in. */
  pinterestCookieCount?: number;
  onShow: (target: DesignReadinessTarget) => void;
};

const stateIcons = {
  set: CircleCheck,
  unset: CircleDashed,
  unverified: Circle,
  unknown: CircleDashed,
} as const;

export function DesignReadinessView({
  connections,
  imageConnection,
  pinterestCookieCount,
  onShow,
}: DesignReadinessViewProps) {
  const { t } = useTranslation();
  const usable = connections?.filter(
    (connection) => connection.enabled && !getModelConnectionConfigurationIssue(connection)
  );
  const models: Item = { target: 'models', label: t('settings.models.title'), state: 'unknown' };
  if (connections && usable) {
    const [first, ...rest] = usable;
    Object.assign(
      models,
      first
        ? {
            state: 'set',
            value: rest.length
              ? t('settings.readiness.moreConnections', {
                  name: first.displayName,
                  count: rest.length,
                })
              : first.displayName,
          }
        : {
            state: 'unset',
            value:
              connections.length === 0
                ? t('settings.readiness.notConnected')
                : connections.some((connection) => connection.enabled)
                  ? t('settings.readiness.needsFix')
                  : t('settings.readiness.off'),
          }
    );
  }
  const image: Item = {
    target: 'image',
    label: t('settings.imageConnection.sectionConnection'),
    state: 'unknown',
  };
  if (imageConnection !== undefined) {
    Object.assign(
      image,
      !imageConnection?.enabled
        ? { state: 'unset', value: t('settings.readiness.off') }
        : !imageConnection.hasApiKey
          ? { state: 'unset', value: t('settings.readiness.keyMissing') }
          : { state: 'set', value: imageConnection.model }
    );
  }
  const pinterest: Item = { target: 'pinterest', label: 'Pinterest', state: 'unknown' };
  if (pinterestCookieCount !== undefined) {
    Object.assign(
      pinterest,
      pinterestCookieCount > 0
        ? { state: 'unverified', value: t('settings.readiness.signInNotVerified') }
        : { state: 'unset', value: t('settings.readiness.notSignedIn') }
    );
  }

  return (
    <ul aria-label={t('settings.readiness.label')} className="flex flex-wrap gap-2">
      {[models, image, pinterest].map((item) => {
        const Icon = stateIcons[item.state];
        return (
          <li key={item.target}>
            <button
              type="button"
              data-state={item.state}
              onClick={() => onShow(item.target)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/40 bg-card py-1.5 pl-2.5 pr-2 text-xs transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
            >
              <Icon
                aria-hidden
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  item.state === 'set' ? 'text-foreground' : 'text-muted-foreground'
                )}
              />
              <span className="shrink-0 text-foreground">{item.label}</span>
              {item.value ? (
                <span className="min-w-0 truncate text-muted-foreground">· {item.value}</span>
              ) : null}
              <ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function usePinterestCookieCount() {
  const [count, setCount] = useState<number>();
  useEffect(() => {
    const bridge = getPublicBrowserBridge();
    if (!bridge) return undefined;
    let live = true;
    void bridge
      .getAccountSummary()
      .then((summary) => {
        if (live)
          setCount(summary.sites.find((entry) => entry.site === 'pinterest.com')?.cookieCount);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return count;
}

/** Derived from saved settings on each visit; nothing here is stored or tested. */
export function DesignReadiness({
  connections,
  imageConnection,
  onReveal,
}: Pick<DesignReadinessViewProps, 'connections' | 'imageConnection'> & {
  onReveal: (target: Exclude<DesignReadinessTarget, 'pinterest'>) => void;
}) {
  const pinterestCookieCount = usePinterestCookieCount();
  const { openSettings } = useOpenSettings();
  if (!getIpcServices()) return null;
  return (
    <DesignReadinessView
      connections={connections}
      imageConnection={imageConnection}
      pinterestCookieCount={pinterestCookieCount}
      onShow={(target) =>
        target === 'pinterest' ? openSettings('browser-accounts') : onReveal(target)
      }
    />
  );
}
