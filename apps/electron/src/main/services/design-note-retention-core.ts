/**
 * Unsent canvas notes parked in main memory while a canvas frame is replaced.
 *
 * A reload destroys the page that holds the pins, so the shell reads them first and
 * retains them here per host. Only a successful read replaces the snapshot: `null`
 * (the canvas could not be read) keeps the last good one, and an empty array clears it
 * (the user cleared the notes or an accepted send consumed them). The next frame
 * releases the snapshot once it has restored the notes. Nothing is written to disk;
 * `forget` runs when the artwork's canvas is torn down for good.
 */
export function createRetainedNotes<T>() {
  const notes = new Map<string, readonly T[]>()
  return {
    retain(hostId: string, value: readonly T[] | null) {
      if (value === null) return
      if (value.length) notes.set(hostId, value)
      else notes.delete(hostId)
    },
    peek(hostId: string): readonly T[] {
      return notes.get(hostId) ?? []
    },
    release(hostId: string) {
      notes.delete(hostId)
    },
    forget(hostId: string) {
      notes.delete(hostId)
    }
  }
}
