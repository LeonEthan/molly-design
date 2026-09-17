/**
 * Whether an already-open design editor must be torn down and re-created from
 * the store (P2-A2).
 *
 * The editor loads its document once and remembers the revision it may save
 * against. A turn that commits through the daemon writes a new revision
 * without going through that instance, so the open view keeps showing — and
 * would later try to save — the superseded document. Adopt already reloads on
 * success; a committed turn needs the same decision.
 *
 * A canvas that is not open is not stale: the next attach reads the store, and
 * inventing a reload would create a native view over whatever the user is
 * actually looking at.
 */
export function openDesignCanvasNeedsReload(
  loadedRevisionId: string | undefined,
  storeRevisionId: string
): boolean {
  return loadedRevisionId !== undefined && loadedRevisionId !== storeRevisionId
}

/** A copy/close may preserve or discard only the instance the caller selected. */
export function selectCanvasInstance<T extends { artworkId: string }>(
  entries: Iterable<readonly [string, T]>,
  artworkId: string,
  hostId?: string
): readonly [string, T] | undefined {
  const matches = [...entries].filter(
    ([key, value]) => value.artworkId === artworkId && (hostId === undefined || key === hostId)
  )
  if (matches.length > 1)
    throw Error('Choose a specific canvas instance; all unsaved edits are retained')
  return matches[0]
}
