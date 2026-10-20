/**
 * Hold-to-compare source selection. `sourceRevisionId` on a history entry is
 * the content hash of what was current when it was recorded, so an exact match
 * against the superseded canvas's revision identifies the pre-turn content
 * regardless of entry kind ('before-agent' or an older deduplicated save).
 * Newest match wins.
 */
export function findDesignCompareSource<T extends { commitId: string; sourceRevisionId?: string }>(
  versions: readonly T[],
  preTurnRevisionId: string
): T | undefined {
  return [...versions].reverse().find((version) => version.sourceRevisionId === preTurnRevisionId)
}
