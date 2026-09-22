import { session } from 'electron'
import { randomUUID } from 'node:crypto'
import { DesignSessionPool } from './design-session-pool-core'

// Only Molly-owned, non-persistent canvas sessions enter this pool. Each live
// surface has an exclusive lease and its own random protocol origin.
const sessions = new DesignSessionPool(
  () => session.fromPartition('molly-canvas-' + randomUUID()),
  (error) => console.error('[Design] Canvas session cleanup failed; partition quarantined', error)
)

export const acquireDesignSession = () => sessions.acquire()
