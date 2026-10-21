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
  // Copies carry the publishing canvas page's epoch and instance, so a send
  // staged earlier retires exactly that copy: epochs restart when the canvas
  // is recreated, and the instance tells one lifetime from the next.
  const copies = new Map<string, { epoch: number; instance: string; notes: readonly T[] }>()
  const flights = new Map<string, { epoch: number; instance?: string; notes: readonly T[] }>()
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
    publish(scope: string, epoch: number, instance: string, notes: readonly T[]) {
      if (notes.length) copies.set(scope, { epoch, instance, notes })
      else copies.delete(scope)
    },
    peek(scope: string): readonly T[] {
      return copies.get(scope)?.notes ?? []
    },
    accept(scope: string, epoch: number) {
      const copy = copies.get(scope)
      flights.set(scope, { epoch, instance: copy?.instance, notes: copy?.notes ?? [] })
      copies.delete(scope)
    },
    settle(scope: string, epoch: number, sent: boolean, instance?: string): readonly T[] {
      const flight = flights.get(scope)
      const matches = (held: { epoch: number; instance?: string }) =>
        held.epoch === epoch && (instance === undefined || held.instance === instance)
      if (!flight || !matches(flight)) {
        // A staged send never created a flight: it retires the retained copy
        // only when the pins never changed since staging, in the same canvas
        // lifetime that produced them.
        const copy = copies.get(scope)
        if (sent && copy && matches(copy)) copies.delete(scope)
        return []
      }
      flights.delete(scope)
      if (sent) return []
      const merged = merge(flight.notes, copies.get(scope)?.notes ?? [])
      if (merged.length)
        copies.set(scope, { epoch, instance: flight.instance ?? '', notes: merged })
      return flight.notes
    },
    async restoreInto(scope: string, restore: (notes: readonly T[]) => Promise<unknown>) {
      const notes = copies.get(scope)?.notes
      if (!notes?.length) return
      try {
        await restore(notes)
      } catch {}
    }
  }
}
