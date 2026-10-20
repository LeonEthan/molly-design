export type TeardownClock = {
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export async function flushBeforeTeardown(
  flush: () => Promise<unknown>,
  timeoutMs: number,
  clock: TeardownClock = {
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
  }
): Promise<boolean> {
  let timer: unknown
  const timeout = new Promise<false>((resolve) => {
    timer = clock.setTimeout(() => resolve(false), timeoutMs)
  })
  const flushed = flush().then(
    () => true,
    () => false
  )
  try {
    return await Promise.race([flushed, timeout])
  } finally {
    clock.clearTimeout(timer)
  }
}

export function createRetainedNotes<T>({ max }: { max: number }) {
  const copies = new Map<string, readonly T[]>()
  const flights = new Map<string, { epoch: number; notes: readonly T[] }>()
  const merge = (...lists: (readonly T[])[]) => {
    const seen = new Set<string>()
    const merged: T[] = []
    for (const note of lists.flat()) {
      const key = JSON.stringify(note)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(note)
    }
    return merged.slice(0, max)
  }
  return {
    publish(scope: string, notes: readonly T[]) {
      if (notes.length) copies.set(scope, notes)
      else copies.delete(scope)
    },
    peek(scope: string): readonly T[] {
      return copies.get(scope) ?? []
    },
    accept(scope: string, epoch: number) {
      flights.set(scope, { epoch, notes: copies.get(scope) ?? [] })
      copies.delete(scope)
    },
    settle(scope: string, epoch: number, sent: boolean): readonly T[] {
      const flight = flights.get(scope)
      if (!flight || flight.epoch !== epoch) return []
      flights.delete(scope)
      if (sent) return []
      const merged = merge(flight.notes, copies.get(scope) ?? [])
      if (merged.length) copies.set(scope, merged)
      return flight.notes
    },
    async restoreInto(scope: string, restore: (notes: readonly T[]) => Promise<unknown>) {
      const notes = copies.get(scope)
      if (!notes?.length) return
      try {
        await restore(notes)
      } catch {}
    }
  }
}
