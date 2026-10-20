import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectionCheckResult } from '@molly/shared/embedded-harness';
import { CircleAlert, CircleCheck, CircleDashed, LoaderCircle } from '@/ui/icons';
import { cn } from '@/lib/utils';

export type ConnectionCheckState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'done'; result: ConnectionCheckResult };

export const CONNECTION_CHECK_DELAY_MS = 700;

/**
 * Checks a complete request once it has been stable for a moment.
 * A new or withdrawn request discards any answer still in flight, so the line never
 * describes a key or address the form no longer shows.
 */
export function useConnectionCheck<T>(
  request: T | null,
  run: ((request: T) => Promise<ConnectionCheckResult>) | undefined,
  delayMs = CONNECTION_CHECK_DELAY_MS
) {
  const [state, setState] = useState<ConnectionCheckState>({ phase: 'idle' });
  const sequence = useRef(0);
  const latest = useRef(request);
  latest.current = request;
  const key = request === null ? null : JSON.stringify(request);
  const start = useCallback(() => {
    const current = latest.current;
    if (!run || current === null) return;
    const id = ++sequence.current;
    setState({ phase: 'checking' });
    void run(current).then(
      (result) => {
        if (sequence.current === id) setState({ phase: 'done', result });
      },
      () => {
        if (sequence.current === id)
          setState({ phase: 'done', result: { ok: false, reason: 'unreachable' } });
      }
    );
  }, [run]);
  useEffect(() => {
    sequence.current += 1;
    setState({ phase: 'idle' });
    if (key === null || !run) return undefined;
    const timer = setTimeout(start, delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, key, run, start]);
  return state;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * One line under the key field, shown only when the check found a real problem.
 * A passing check, a check in progress and a service without a free check stay silent.
 */
export function ConnectionCheckError({
  state,
  baseUrl,
  className,
}: {
  state: ConnectionCheckState;
  baseUrl: string;
  className?: string;
}) {
  const { t } = useTranslation();
  if (state.phase !== 'done' || state.result.ok || state.result.reason === 'unsupported')
    return null;
  return (
    <p role="alert" className={cn('flex items-center gap-1.5 text-xs text-destructive', className)}>
      <CircleAlert aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {t(`settings.check.failures.${state.result.reason}`, {
        status: state.result.status ?? '',
        host: hostOf(baseUrl),
      })}
    </p>
  );
}

/** The compact form of a check result for a connection row. */
export function ConnectionCheckBadge({ state }: { state: ConnectionCheckState | undefined }) {
  const { t } = useTranslation();
  if (!state || state.phase === 'idle') return null;
  if (state.phase === 'checking')
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <LoaderCircle aria-hidden className="h-3 w-3 animate-spin" />
        {t('settings.check.checking')}
      </span>
    );
  const { result } = state;
  const label = result.ok
    ? t('settings.check.badge.ok')
    : t(`settings.check.badge.${result.reason}`);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
        result.ok
          ? 'bg-foreground/[0.06] text-foreground'
          : result.reason === 'unsupported'
            ? 'bg-foreground/[0.04] text-muted-foreground'
            : 'bg-destructive/10 text-destructive'
      )}
    >
      {result.ok ? (
        <CircleCheck aria-hidden className="h-3 w-3" />
      ) : result.reason === 'unsupported' ? (
        <CircleDashed aria-hidden className="h-3 w-3" />
      ) : (
        <CircleAlert aria-hidden className="h-3 w-3" />
      )}
      {label}
    </span>
  );
}
