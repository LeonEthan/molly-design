import {
  DesignCanvasHostResultSchema,
  machineSupportsDesignCanvasSerialEditing,
  type DesignCanvasReport
} from '@molly/shared/local-machine-rpc'
import { readLocalPlatformSnapshot } from '../platform'
import type { CliService } from './cli-service'
import {
  designCanvasAccess,
  setDesignCanvasStateQuery,
  syncDesignCanvasFromStore
} from './design-service'

/** Same owner-only local control socket as render hosting, independent of slow raster work. */
export function startDesignCanvasHost(cli: CliService): () => void {
  let reports: DesignCanvasReport[] = []
  let pending: Promise<void> | undefined
  let stopped = false
  const exchange = (): Promise<void> => {
    if (pending) return pending
    pending = (async () => {
      try {
        const machineId = await cli.getLocalMachineId()
        const snapshot = await readLocalPlatformSnapshot()
        if (!machineId || !snapshot) throw Error('Canvas execution state is unknown')
        const result = await cli.sendLocalMachineRpc({
          machineId,
          workspaceId: snapshot.workspace.workspaceId,
          method: 'design/canvas-host',
          params: { version: 1, reports: reports.slice(0, 100) }
        })
        if (!result.ok) throw Error(result.error)
        // An old daemon cannot acknowledge this version; absence remains read-only.
        const response = DesignCanvasHostResultSchema.parse(result.result)
        if (!machineSupportsDesignCanvasSerialEditing(response.machine))
          throw Error('Daemon does not support serial canvas editing')
        reports = [
          ...reports.slice(100),
          ...(await designCanvasAccess.update(response.active, syncDesignCanvasFromStore))
        ]
      } catch (error) {
        await designCanvasAccess.disconnected()
        throw error
      }
    })().finally(() => {
      pending = undefined
    })
    return pending
  }
  setDesignCanvasStateQuery(exchange)
  // Polls are observation/flush handoff, never dispatch or an automatic agent retry.
  const tick = () => {
    if (!stopped) void exchange().catch(() => {})
  }
  const timer = setInterval(tick, 500)
  tick()
  return () => {
    stopped = true
    clearInterval(timer)
    void designCanvasAccess.disconnected()
  }
}
