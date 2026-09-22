import type { Session } from 'electron'
import { retireDesignSession } from './design-session-disposal.ts'

type RecyclableSession = Pick<
  Session,
  | 'protocol'
  | 'webRequest'
  | 'setPermissionRequestHandler'
  | 'setPermissionCheckHandler'
  | 'clearData'
  | 'clearCodeCaches'
  | 'clearAuthCache'
  | 'closeAllConnections'
>

type Contents<S> = {
  session: S
  isDestroyed(): boolean
  close(options: { waitForBeforeUnload: boolean }): void
  once(event: 'destroyed', listener: () => void): unknown
}

/** Electron keeps partitions for the process lifetime. Reuse only fully drained,
 * cleaned canvas partitions, never sessions still owned by a view or request. */
export class DesignSessionPool<S extends RecyclableSession> {
  private readonly available: S[] = []
  private readonly cleaning = new Set<Promise<void>>()
  private readonly create: () => S
  private readonly report: (error: unknown) => void

  constructor(create: () => S, report: (error: unknown) => void) {
    this.create = create
    this.report = report
  }

  async acquire(): Promise<DesignSessionLease<S>> {
    // Wait for storage cleanup, not in-flight requests: a retiring request may
    // itself need a replacement surface before it can finish (toolbar/reload).
    while (!this.available.length && this.cleaning.size) await Promise.race(this.cleaning)
    return new DesignSessionLease(
      this.available.pop() ?? this.create(),
      (session) => this.recycle(session),
      this.report
    )
  }

  private recycle(session: S): void {
    const pending = (async () => {
      await Promise.all([
        session.clearData(),
        session.clearCodeCaches({}),
        session.clearAuthCache(),
        session.closeAllConnections()
      ])
      this.available.push(session)
    })()
      // Failed partitions stay denied and are never offered to another artwork.
      .catch(this.report)
      .finally(() => this.cleaning.delete(pending))
    this.cleaning.add(pending)
  }
}

class DesignSessionLease<S extends RecyclableSession> {
  readonly session: S
  private active = true
  private reusable = true
  private requests = 0
  private readonly contents = new Set<Contents<S>>()
  private readonly recycle: (session: S) => void
  private readonly report: (error: unknown) => void

  constructor(session: S, recycle: (session: S) => void, report: (error: unknown) => void) {
    this.session = session
    this.recycle = recycle
    this.report = report
  }

  readonly assertActive = (): void => {
    if (!this.active) throw Error('Retired canvas')
  }

  /** Register native destruction before any asynchronous loading can be cancelled. */
  readonly own = <T extends { webContents: Contents<S> }>(create: () => T): T => {
    this.assertActive()
    try {
      const owner = create()
      const contents = owner.webContents
      if (contents.session !== this.session) throw Error('Canvas session mismatch')
      if (!contents.isDestroyed()) {
        this.contents.add(contents)
        contents.once('destroyed', () => {
          this.contents.delete(contents)
          this.recycleIfDrained()
        })
      }
      return owner
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  /** Callers also check assertActive after each await preceding a side effect. */
  async run<T>(action: () => T | Promise<T>): Promise<T> {
    this.assertActive()
    this.requests++
    try {
      const result = await action()
      this.assertActive()
      return result
    } finally {
      this.requests--
      this.recycleIfDrained()
    }
  }

  readonly dispose = (): void => {
    if (!this.active) return
    this.active = false
    try {
      retireDesignSession(this.session)
    } catch (error) {
      this.reusable = false
      this.report(error)
    }
    for (const contents of this.contents) {
      try {
        if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false })
      } catch (error) {
        this.reusable = false
        this.report(error)
      }
    }
    this.recycleIfDrained()
  }

  private recycleIfDrained(): void {
    if (this.active || !this.reusable || this.requests || this.contents.size) return
    this.reusable = false
    this.recycle(this.session)
  }
}
