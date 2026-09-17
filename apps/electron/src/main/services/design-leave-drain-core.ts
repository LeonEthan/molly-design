/**
 * Which in-flight attaches `leaveDesign` must wait for.
 *
 * A record exists from `records.set` onward while the product API may still be
 * loading, so reading that record's state can misreport a clean canvas as
 * unsaved edits. The attach promise now settles only after the complete API
 * reports its real ready state. Maps are injected so the selection and re-check
 * semantics stay testable under `node --test` without Electron.
 *
 * Two load outcomes, both safe to continue past:
 *
 * - The load or readiness wait rejects: `attachDesign` destroys the record, so
 *   the later per-record pass finds nothing to preserve.
 * - The load rejects later (register/readonly): the record stays behind as a
 *   half-initialized zombie, and the later per-record pass still protects it
 *   through the usual dirty/undefined dialog. The drain swallows the rejection
 *   because preservation is decided there, not here.
 *
 * Over-waiting is safe but imprecise by construction: `hosts` records
 * visibility intent, not load ownership, so a hidden mid-load attach whose
 * artwork is not yet knowable is awaited even when leaving another artwork.
 * That only delays leave, never discards.
 */

export async function drainRelevantLoads(
  loading: ReadonlyMap<string, PromiseLike<unknown>>,
  hosts: ReadonlyMap<string, string>,
  id: string,
  hostId?: string
): Promise<void> {
  for (;;) {
    const pending: string[] = []
    for (const key of loading.keys()) {
      if (hostId !== undefined ? key === hostId : hosts.get(key) === id || !hosts.has(key))
        pending.push(key)
    }
    if (pending.length === 0) return
    await Promise.all(
      pending.map((key) =>
        Promise.resolve(loading.get(key)).then(
          () => undefined,
          () => undefined
        )
      )
    )
  }
}
