/**
 * The session workspace's authoring artifact: where it is, and what it is.
 *
 * A design session's workspace (`chats/<artworkId>`) holds the agent's YAML
 * artwork at its root — `design.yaml` beside `media/`;
 * `@molly/design-authoring` owns the allowlist and the fail-closed snapshot
 * rules for it. Three stages need to talk about "the project that is there right
 * now", and they must agree on the answer:
 *
 * - P2.2 freezes what it was when a turn was dispatched (`./turn-input.ts`), so
 *   P2.3 can tell "this turn produced nothing" from "this turn re-imported the
 *   project an earlier turn left behind". That is the `at_send` record.
 * - P2.3 collects it after the turn (`./turn-outcome.ts`).
 * - The render bridge previews the same file (`./render-preview.ts`).
 *
 * One observation, three answers: `absent` when the workspace has no entry at
 * all, `present` with a content digest when it has one, and `rejected` with the
 * collector's own refusal message when it holds something we will not import
 * (symlink, hardlink, escape, non-regular entry, leftover `.pptd`). Nothing here
 * writes, repairs, or retries anything. A leftover `.pptd` without `design.yaml`
 * is `absent`: it is not this turn's artifact.
 *
 * The digest covers the entry and every page and media file, so a turn that
 * rewrote one page counts as having produced something. It is the *conventional*
 * sha256 of a canonical encoding (sorted paths, length-prefixed bytes), not the
 * store's document digest: a YAML project and the canvas document it imports are
 * different things.
 */

import {
  ARTWORK_ENTRY,
  AuthoringSnapshotError,
  collectAuthoring,
  digestAuthoring,
} from '@molly/design-authoring';
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import path from 'node:path';

/** The design artifact entry, at the workdir root (P2.1 contract). */
export const DESIGN_ARTIFACT_ENTRY = ARTWORK_ENTRY;

export type DesignArtifact =
  /** No entry: the workspace holds no project (yet). */
  | { status: 'absent' }
  /** The collected project and the digest that identifies exactly these bytes. */
  | { status: 'present'; digest: string; snapshot: Map<string, Uint8Array> }
  /**
   * The entry exists but the snapshot is one we refuse to import. `rejectedBy`
   * distinguishes the collector's own structural refusal (`snapshot`) from an
   * unreadable workspace (`io`) — they are reported under different diagnostic
   * codes, but neither is ever repaired.
   */
  | { status: 'rejected'; rejectedBy: 'snapshot' | 'io'; message: string };

/**
 * What a turn's manifest records about the artifact it was dispatched with: the
 * same three states without the bytes and without the message.
 *
 * The message is deliberately not persisted. The manifest is the turn's frozen
 * input and a file the agent can read; a refusal is re-observed, with its own
 * message, by the collection that has to act on it.
 */
export type DesignArtifactAtSend =
  | { status: 'absent' }
  | { status: 'present'; digest: string }
  | { status: 'rejected' };

/** Narrow one observation to the shape a manifest may carry. */
export const artifactAtSendRecord = (artifact: DesignArtifact): DesignArtifactAtSend => {
  if (artifact.status === 'present') return { status: 'present', digest: artifact.digest };
  return { status: artifact.status };
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Content identity of one collected project.
 *
 * Injective: every part is length-delimited (a relative path cannot contain a
 * NUL), so two different snapshots cannot produce the same input to the hash.
 */
function artifactDigest(snapshot: Map<string, Uint8Array>): string {
  const hash = createHash('sha256');
  for (const rel of [...snapshot.keys()].sort()) {
    const bytes = snapshot.get(rel);
    if (bytes === undefined) continue;
    hash.update(rel);
    hash.update('\0');
    hash.update(String(bytes.byteLength));
    hash.update('\0');
    hash.update(bytes);
  }
  return hash.digest('hex');
}

/**
 * Observe the workspace's project without changing anything.
 *
 * The entry is checked before the collection so a workspace that simply has no
 * project is `absent`, not a collection failure; from there the collector's own
 * rules decide. Never throws: an unreadable workspace is a reported state, the
 * same way it is for the collection.
 */
export function readDesignArtifact(workdir: string): Promise<DesignArtifact> {
  return observeDesignArtifact(workdir, () => {
    const snapshot = collectAuthoring(workdir);
    return { status: 'present', digest: artifactDigest(snapshot), snapshot } as const;
  });
}

/** Same exact full-tree identity, with fixed-buffer reads instead of a retained snapshot. */
export function readDesignArtifactDigest(
  workdir: string
): Promise<Exclude<DesignArtifact, { status: 'present' }> | { status: 'present'; digest: string }> {
  return observeDesignArtifact(
    workdir,
    () => ({ status: 'present', digest: digestAuthoring(workdir) }) as const
  );
}

async function observeDesignArtifact<T extends { status: 'present'; digest: string }>(
  workdir: string,
  read: () => T
): Promise<T | Exclude<DesignArtifact, { status: 'present' }>> {
  try {
    await lstat(path.join(workdir, DESIGN_ARTIFACT_ENTRY));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'absent' };
    return { status: 'rejected', rejectedBy: 'io', message: errorMessage(error) };
  }
  try {
    return read();
  } catch (error) {
    return {
      status: 'rejected',
      rejectedBy: error instanceof AuthoringSnapshotError ? 'snapshot' : 'io',
      message: errorMessage(error),
    };
  }
}
