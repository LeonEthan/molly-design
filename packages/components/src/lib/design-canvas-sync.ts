import { sanitizeDesignTurnOutcome } from '@molly/shared';
import { getIpcServices } from './electron-ipc-client';

/**
 * P2-A2: after a turn commits, an already-open native editor still holds the
 * document it loaded. The durable `designOutcome` on session history is the
 * renderer's signal that the store moved; this module turns that signal into
 * one call on the design channel. The host checks saved versions and preserves
 * unsaved edits before replacing a stale editor.
 *
 * The revision returned here is only a trigger. The Electron side compares the
 * editor's loaded revision with the store, so a later manual save or a
 * historical receipt on first mount does not reload a
 * canvas that is already current.
 */

/**
 * The revision the latest committed turn of this artwork recorded, if any.
 *
 * Walks oldest-to-newest and keeps the last readable `committed` revision for
 * `artworkId`. Other statuses, other artworks, and a committed payload with no
 * revision do not count — none of those mean the store took this turn's
 * document. A later thumbnail on the same revision does not change the value,
 * so a card gaining its image is not a second reload.
 */
export function latestCommittedDesignRevision(
  history: readonly { designOutcome?: unknown }[] | undefined,
  artworkId: string
): string | undefined {
  if (!history) return undefined;
  let revisionId: string | undefined;
  for (const entry of history) {
    const outcome = sanitizeDesignTurnOutcome(entry.designOutcome);
    if (
      outcome?.status === 'committed' &&
      outcome.artworkId === artworkId &&
      outcome.revisionId !== undefined
    ) {
      revisionId = outcome.revisionId;
    }
  }
  return revisionId;
}

/**
 * Ask the design service to reload this artwork's open editor from the store.
 *
 * No Electron host, or a host without a design service, is a no-op: there is
 * no native editor to go stale. A real reload failure rejects so the canvas
 * can show it instead of leaving the editor on the superseded document.
 */
export async function syncOpenDesignCanvas(artworkId: string): Promise<void> {
  const design = getIpcServices()?.design;
  if (!design) return;
  await design.syncFromStore(artworkId);
}

/** A receipt identity distinguishes a new successful turn even at the same revision. */
export function latestCommittedDesignReceipt(
  history: readonly { designOutcome?: unknown }[] | undefined,
  artworkId: string
): string | undefined {
  let receipt: string | undefined;
  for (const entry of history ?? []) {
    const outcome = sanitizeDesignTurnOutcome(entry.designOutcome);
    if (outcome?.status === 'committed' && outcome.artworkId === artworkId && outcome.revisionId) {
      receipt = `${outcome.turnId}:${outcome.revisionId}`;
    }
  }
  return receipt;
}
