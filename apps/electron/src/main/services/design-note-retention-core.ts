/**
 * Unsent canvas notes parked in main memory while a canvas frame is replaced.
 *
 * A reload destroys the page that holds the pins, so the shell reads them first,
 * retains them here per host, and restores them into the next frame. Nothing is
 * written to disk; `forget` runs whenever the instance itself is destroyed.
 */
export function createRetainedNotes<T>() {
  const notes = new Map<string, readonly T[]>()
  return {
    retain(hostId: string, value: readonly T[]) {
      if (value.length) notes.set(hostId, value)
      else notes.delete(hostId)
    },
    take(hostId: string): readonly T[] {
      const value = notes.get(hostId) ?? []
      notes.delete(hostId)
      return value
    },
    forget(hostId: string) {
      notes.delete(hostId)
    }
  }
}
