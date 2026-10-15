import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionId } from '@molly/shared';

/**
 * Manual retry for embedded-harness model request failures (#137). The harness
 * already spent its bounded automatic retries before such a notice exists, so
 * the UI never retries on its own: the latest transient failure notice gets one
 * Retry button, and one click resends the ORIGINAL user message of that failed
 * round as a NEW ordinary message. The old turn is never revived.
 */

/** Failure codes that may be retried by resending the original message. */
export const MODEL_FAILURE_RETRYABLE_CODES = new Set([
  'model_temporarily_unavailable',
  'model_request_failed',
]);

export const isModelFailureRetryableCode = (code: string | undefined): boolean =>
  code !== undefined && MODEL_FAILURE_RETRYABLE_CODES.has(code);

export type ModelFailureRetryHistoryEntry = {
  id: string;
  role: string;
  items?: readonly ({ type: string; name?: string; meta?: unknown } | null | undefined)[];
  inputConfig?: { inputBlocks?: unknown; prompt?: string | undefined } | null;
};

export type ModelFailureRetryTarget = {
  noticeId: string;
  userEntry: ModelFailureRetryHistoryEntry;
};

/**
 * Mirrors `findLatestCapacityFailureNoticeId`: only the LATEST chat_failed
 * notice counts, and any newer user input supersedes it — resending an older
 * round would inject out-of-order content. Returns the notice id plus the
 * nearest preceding user entry whose content the retry resends.
 */
export function findLatestModelFailureRetryTarget(
  history: readonly ModelFailureRetryHistoryEntry[] | null | undefined
): ModelFailureRetryTarget | null {
  if (!history) return null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (!entry) continue;
    if (entry.role === 'user') return null;
    for (const item of entry.items ?? []) {
      if (item?.type !== 'system_notice' || item.name !== 'chat_failed') continue;
      const meta = item.meta as { reason?: unknown; code?: unknown } | undefined;
      const retryable =
        meta?.reason === 'acp_upstream_api_error' &&
        typeof meta.code === 'string' &&
        isModelFailureRetryableCode(meta.code);
      if (!retryable) return null;
      for (let userIndex = index - 1; userIndex >= 0; userIndex -= 1) {
        const userEntry = history[userIndex];
        if (userEntry?.role === 'user') {
          return { noticeId: entry.id, userEntry };
        }
      }
      return null;
    }
  }
  return null;
}

export type ModelFailureRetryControl = {
  noticeId: string;
  pending: boolean;
  canRetry: boolean;
  retry: () => void;
};

export function useModelFailureRetry(options: {
  sessionId: SessionId;
  history: readonly ModelFailureRetryHistoryEntry[] | null | undefined;
  canRetry: boolean;
  onRetry: (userEntry: ModelFailureRetryHistoryEntry) => Promise<boolean>;
}): ModelFailureRetryControl | null {
  const { sessionId, history, canRetry, onRetry } = options;
  const target = useMemo(() => findLatestModelFailureRetryTarget(history), [history]);
  const retryInFlightRef = useRef(false);
  const onRetryRef = useRef(onRetry);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    onRetryRef.current = onRetry;
  }, [onRetry]);

  useEffect(() => {
    retryInFlightRef.current = false;
    setPending(false);
  }, [sessionId]);

  const retry = useCallback(() => {
    if (!target || !canRetry || retryInFlightRef.current) return;
    retryInFlightRef.current = true;
    setPending(true);
    void (async () => {
      try {
        // Dispatch already owns user-visible transport diagnostics; a rejected
        // resend simply returns the button to its clickable state.
        await onRetryRef.current(target.userEntry);
      } catch {
        // Same contract as a rejected resend: become clickable again.
      } finally {
        retryInFlightRef.current = false;
        setPending(false);
      }
    })();
  }, [canRetry, target]);

  if (!target) return null;
  return {
    noticeId: target.noticeId,
    pending,
    canRetry,
    retry,
  };
}
