export type LiveSource = {
  path: string
  live: { sessionId: string; turnId: string; sourceTurnId?: string }
}

/** Canvas preparation can precede the causal input identity; subscribe before it exists. */
export async function bindLiveSource(
  source: LiveSource,
  resolve: () => Promise<string | LiveSource>
): Promise<(LiveSource['live'] & { sourceTurnId: string }) | undefined> {
  const latest = source.live.sourceTurnId ? source : await resolve()
  if (
    typeof latest === 'string' ||
    latest.path !== source.path ||
    latest.live.sessionId !== source.live.sessionId ||
    latest.live.turnId !== source.live.turnId
  )
    throw Error('Design source changed while resolving its input')
  const sourceTurnId = latest.live.sourceTurnId
  return sourceTurnId ? { ...latest.live, sourceTurnId } : undefined
}
