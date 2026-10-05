import { deriveSessionTurnFacts, type SessionTurnFacts } from './session-turn-facts';
import { normalizeFileDiff, type FileDiff, type SessionId } from '@molly/shared';
import { useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { activeWorkspaceRuntimeAtom } from '@/atoms/runtime';
import { acquireConversationDerivation, type ConversationView } from '@/lib/conversation-view';
import {
  areSessionDiffSummariesEqual,
  buildSessionDiffSummary,
  EMPTY_SESSION_DIFF_SUMMARY,
  type SessionDiffSummary,
} from './session-diff-summary';

type SessionDiffSummaryState = {
  ready: boolean;
  synced: boolean;
  revision: number;
  summary: SessionDiffSummary;
  unavailableMessage?: string;
};

const INITIAL_STATE: SessionDiffSummaryState = {
  ready: false,
  synced: false,
  revision: 0,
  summary: EMPTY_SESSION_DIFF_SUMMARY,
};

type SessionHistoryInput = Parameters<typeof buildSessionDiffSummary>[0];
type SessionHistoryEntryInput = NonNullable<SessionHistoryInput>[number];

function getSessionHistoryEntryRole(entry: SessionHistoryEntryInput): string | undefined {
  const role = (entry as { readonly role?: unknown }).role;
  return typeof role === 'string' ? role : undefined;
}

function normalizeHistoryEntryFileDiffs(entry: SessionHistoryEntryInput): FileDiff[] {
  const rawDiffs = (entry as { readonly fileDiff?: unknown }).fileDiff;
  if (!Array.isArray(rawDiffs)) return [];
  return rawDiffs.flatMap((rawDiff) => {
    const normalized = normalizeFileDiff(rawDiff);
    return normalized === undefined ? [] : [normalized];
  });
}

/**
 * Per-turn diff inputs for the whole conversation in order, from a fact table
 * over the view: turns the background pass has not reached yet are absent and
 * appear as the pass completes.
 */
function collectDiffInputs(
  view: ConversationView,
  facts: ReadonlyMap<string, SessionTurnFacts>
): SessionTurnFacts[] {
  const entries: SessionTurnFacts[] = [];
  for (let i = 0; i < view.turnCount; i += 1) {
    const row = view.index(i);
    const fact = row ? facts.get(row.id) : undefined;
    if (fact) entries.push(fact);
  }
  return entries;
}

/** The diff-relevant identity of one turn. */
const diffInputEntryShape = (entry: SessionDiffInputEntry): unknown => [
  entry?.id ?? '',
  getSessionHistoryEntryRole(entry) ?? '',
  normalizeHistoryEntryFileDiffs(entry).map((fileDiff) => [
    fileDiff.filePath,
    fileDiff.add,
    fileDiff.del,
    fileDiff.cc === undefined
      ? null
      : [
          fileDiff.cc.v,
          fileDiff.cc.fileId,
          fileDiff.cc.baseOpId ?? '',
          fileDiff.cc.opId ?? '',
          fileDiff.cc.base ?? '',
          fileDiff.cc.deleted === true,
        ],
  ]),
];

export function computeSessionDiffInputsFingerprint(history: SessionHistoryInput): string {
  return JSON.stringify((history ?? []).map((entry) => diffInputEntryShape(entry)));
}

type SessionDiffInputEntry = NonNullable<SessionHistoryInput>[number];

/**
 * Per-entry serialization, memoized on the entry object.
 *
 * A fact is replaced only when its turn changed, so an unchanged entry keeps
 * its identity across passes and is never re-serialized.
 */
const diffInputEntryFingerprints = new WeakMap<object, string>();
const diffInputEntryFingerprint = (entry: SessionDiffInputEntry): string => {
  if (!entry || typeof entry !== 'object') return JSON.stringify(diffInputEntryShape(entry));
  const cached = diffInputEntryFingerprints.get(entry);
  if (cached !== undefined) return cached;
  const computed = JSON.stringify(diffInputEntryShape(entry));
  diffInputEntryFingerprints.set(entry, computed);
  return computed;
};

/**
 * Whether the diff-relevant content of the collected turns changed.
 *
 * Facts arrive at token rate while a turn streams and in chunks while the
 * background pass fills the conversation, so this runs once per frame over
 * every turn. Serializing the whole conversation to answer it cost a 144 KiB
 * string per frame on a 4,000-turn session; identical entries are now settled
 * by reference and only a replaced entry is serialized.
 */
export function sessionDiffInputsChanged(
  previous: SessionHistoryInput | undefined,
  next: SessionHistoryInput
): boolean {
  if (previous === undefined) return true;
  const before = previous ?? [];
  const after = next ?? [];
  if (before.length !== after.length) return true;
  for (let index = 0; index < after.length; index += 1) {
    const beforeEntry = before[index];
    const afterEntry = after[index];
    if (beforeEntry === afterEntry) continue;
    if (diffInputEntryFingerprint(beforeEntry) !== diffInputEntryFingerprint(afterEntry)) {
      return true;
    }
  }
  return false;
}

export function useSessionDiffSummary(
  sessionId: SessionId,
  options: { readonly enabled?: boolean } = {}
): SessionDiffSummaryState {
  const runtime = useAtomValue(activeWorkspaceRuntimeAtom);
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<SessionDiffSummaryState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    let acquiredStore = false;
    let releaseSync: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;
    let lease: ReturnType<typeof acquireConversationDerivation<SessionTurnFacts>> | null = null;
    let frame: number | null = null;
    let previousInputs: SessionHistoryInput | undefined;
    setState(INITIAL_STATE);

    if (enabled && runtime) {
      void (async () => {
        try {
          const store = await runtime.acquireSessionStore(sessionId);
          acquiredStore = true;
          if (cancelled) {
            runtime.releaseSessionStoreRef(sessionId);
            acquiredStore = false;
            return;
          }
          releaseSync = store.acquireSync();
          lease = acquireConversationDerivation(store.history, deriveSessionTurnFacts);
          const derivation = lease.table;
          const updateSummary = () => {
            frame = null;
            if (cancelled) return;
            const inputs = collectDiffInputs(store.history, derivation.facts) as never;
            if (!sessionDiffInputsChanged(previousInputs, inputs)) return;
            previousInputs = inputs;
            const summary = buildSessionDiffSummary(inputs);
            setState((previous) =>
              areSessionDiffSummariesEqual(previous.summary, summary)
                ? previous.ready
                  ? previous
                  : { ...previous, ready: true }
                : { ...previous, ready: true, revision: previous.revision + 1, summary }
            );
          };
          updateSummary();
          void store.firstSynced
            .then(() => {
              if (!cancelled) setState((previous) => ({ ...previous, synced: true }));
            })
            .catch(() => {});
          unsubscribe = derivation.subscribe(() => {
            if (frame === null) frame = requestAnimationFrame(updateSummary);
          });
        } catch (error) {
          console.error('Failed to load historical session diff summary', { sessionId, error });
        }
      })();
    }

    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      unsubscribe?.();
      lease?.release();
      releaseSync?.();
      if (acquiredStore && runtime) runtime.releaseSessionStoreRef(sessionId);
    };
  }, [enabled, runtime, sessionId]);

  return state;
}
