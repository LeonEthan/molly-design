import { randomUUID } from 'node:crypto'
import type { DesignCanvasReport, DesignCanvasState } from '@molly/shared/local-machine-rpc'

export type CanvasInstance = {
  artworkId: string
  setReadonly(value: boolean, reason: string): Promise<void>
  flush(permit: string): Promise<void>
}

/** Desktop adapter: execution ownership comes exclusively from the daemon snapshot. */
export class DesignCanvasAccess {
  private known = false
  private active = new Map<string, DesignCanvasState>()
  private readonly instances = new Set<CanvasInstance>()
  private readonly permits = new Map<string, string>()
  private readonly writes = new Map<string, Set<Promise<unknown>>>()
  private readonly reported = new Set<string>()
  private updating = false

  isReadonly(id: string): boolean {
    return this.updating || !this.known || this.active.has(id) || this.permits.has(id)
  }
  isActive(id: string): boolean {
    return this.active.has(id)
  }

  async register(instance: CanvasInstance): Promise<void> {
    this.instances.add(instance)
    await instance.setReadonly(
      true,
      '执行状态待确认，画布只读 / Checking execution state — read-only'
    )
  }
  unregister(instance: CanvasInstance): void {
    this.instances.delete(instance)
  }

  async disconnected(): Promise<void> {
    this.known = false
    await this.refresh()
  }

  async update(
    states: readonly DesignCanvasState[],
    beforeRelease?: (id: string) => Promise<void>
  ): Promise<DesignCanvasReport[]> {
    const next = new Map(states.map((state) => [state.artworkId, state]))
    for (const [id, previous] of this.active) {
      if (next.has(id)) continue
      try {
        await beforeRelease?.(id)
      } catch {
        next.set(id, { ...previous, preparing: false })
      }
    }
    this.active = next
    this.known = true
    await this.refresh()
    const reports: DesignCanvasReport[] = []
    for (const state of states) {
      if (!state.preparing || this.reported.has(state.turnId)) continue
      try {
        if (this.updating) throw Error('Molly is preparing an update; try again after updating')
        await this.flush(state.artworkId)
        reports.push({ artworkId: state.artworkId, turnId: state.turnId, ok: true })
      } catch (error) {
        reports.push({
          artworkId: state.artworkId,
          turnId: state.turnId,
          ok: false,
          error: String(error).slice(0, 500)
        })
      }
      this.reported.add(state.turnId)
    }
    const live = new Set(states.map((state) => state.turnId))
    for (const id of this.reported) if (!live.has(id)) this.reported.delete(id)
    return reports
  }

  /** Every actual human persistence entry registers before its first await. */
  write<T>(id: string, permit: unknown, action: () => Promise<T>): Promise<T> {
    if (this.isReadonly(id) && (typeof permit !== 'string' || this.permits.get(id) !== permit))
      return Promise.reject(new Error('Canvas is read-only; edits are retained'))
    const pending = Promise.resolve().then(action)
    const set = this.writes.get(id) ?? new Set<Promise<unknown>>()
    set.add(pending)
    this.writes.set(id, set)
    void pending
      .finally(() => {
        set.delete(pending)
        if (!set.size) this.writes.delete(id)
      })
      .catch(() => {})
    return pending
  }

  /** Frontend preflight preserves composer errors; real dispatch repeats this after claiming. */
  async prepareForSend(id: string): Promise<void> {
    if (this.updating) throw Error('Molly is preparing an update; try again after updating')
    if (this.known && this.isActive(id)) return // Existing queue/steer owns routing.
    if (this.isReadonly(id))
      throw Error('Canvas execution state is unknown or saving; retry when connected')
    await this.flush(id)
  }

  /** Freeze new edits/dispatch while a verified update is installed; failed installs release it. */
  async prepareApplicationUpdate(queryState: () => Promise<void>): Promise<() => Promise<void>> {
    if (this.updating) throw Error('An update installation is already in progress')
    this.updating = true
    const release = async () => {
      this.updating = false
      await this.refresh()
    }
    try {
      await this.refresh()
      await queryState()
      const assertIdle = () => {
        if (!this.known || this.active.size > 0)
          throw Error('Wait for Agent execution and design processing to finish before updating')
      }
      assertIdle()
      const ids = new Set([...this.instances].map((instance) => instance.artworkId))
      for (const id of this.writes.keys()) ids.add(id)
      for (const id of ids) await this.flush(id)
      await queryState()
      assertIdle()
      return release
    } catch (error) {
      await release()
      throw error
    }
  }

  /** Explicit replacement keeps every editor frozen from flush through save/reload. */
  async replaceAfterFlush<T>(
    id: string,
    action: (assertIdle: () => void) => Promise<T>
  ): Promise<T> {
    const assertIdle = () => {
      if (this.updating) throw Error('Molly is preparing an update; import refused')
      if (!this.known || this.active.has(id))
        throw Error('Canvas execution or artifact processing is active or unknown; import refused')
    }
    assertIdle()
    return this.flush(id, async () => {
      assertIdle()
      return this.write(id, this.permits.get(id), () => action(assertIdle))
    })
  }

  private reason(): string {
    return this.known
      ? '处理中，画布只读 / Processing — read-only'
      : '执行状态待确认，画布只读 / Checking execution state — read-only'
  }

  private async refresh(): Promise<void> {
    await Promise.all(
      [...this.instances].map((instance) =>
        instance.setReadonly(this.isReadonly(instance.artworkId), this.reason())
      )
    )
  }

  private async flush<T = void>(id: string, action?: () => Promise<T>): Promise<T> {
    if (this.permits.has(id)) throw Error('Canvas save is already in progress')
    const permit = randomUUID()
    this.permits.set(id, permit)
    try {
      await this.refresh()
      // Includes accepted imports/renames and requests whose responses have not arrived yet.
      await Promise.all([...(this.writes.get(id) ?? [])])
      for (const instance of this.instances)
        if (instance.artworkId === id) await instance.flush(permit)
      return action ? await action() : (undefined as T)
    } finally {
      this.permits.delete(id)
      await this.refresh()
    }
  }
}
