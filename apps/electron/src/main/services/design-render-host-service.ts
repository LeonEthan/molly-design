/**
 * Start the desktop's design preview render host (P2.4b).
 *
 * The loop itself is `design-render-host-core.ts`; this module is the wiring the
 * core deliberately does not carry: the machine-local control socket, the
 * staged payload files the daemon writes, and the offscreen Chromium render.
 *
 * The desktop polls the daemon rather than the daemon calling the desktop, so
 * this is the only inbound surface a preview needs — there is no new IPC
 * channel, no new listening socket, and nothing a remote party could address.
 * The socket is the owner-only local control socket the desktop already uses to
 * talk to its daemon.
 *
 * Every failure here is deliberately quiet and unremarkable: a machine with no
 * daemon, no provisioned catalog, or no design sessions simply polls and gets
 * nothing. That is the honest state for a desktop whose agent side is not
 * running, and it must not look like an error to the person using it.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  DESIGN_RENDER_HOST_POLL_INTERVAL_MS,
  DesignRenderRpcResultSchema
} from '@molly/shared/local-machine-rpc'
import type { DesignPayload } from '../../../../cli/src/design/store'
import { readLocalPlatformSnapshot } from '../platform'
import { renderSavedDesign } from './design-service'
import type { CliService } from './cli-service'
import {
  DesignRenderHostLoop,
  type DesignRenderHostReport,
  type DesignRenderHostWork
} from './design-render-host-core'

/** Same shape the design canvas is served, so the render path is the export path. */
const readStagedPayload = async (payloadPath: string): Promise<DesignPayload> =>
  JSON.parse(await readFile(payloadPath, 'utf8')) as DesignPayload

/** Temp file + fsync + rename, so the daemon never verifies a half-written PNG. */
async function writeOutputAtomic(outputPath: string, bytes: Uint8Array): Promise<void> {
  const directory = dirname(outputPath)
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(bytes)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, outputPath)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

/**
 * Ask the daemon for queued previews, handing over everything finished since
 * the last poll.
 *
 * Rejects on every failure — that is how the core learns the reports were not
 * delivered and must be kept. The daemon needs the machine and workspace ids
 * only because the machine-RPC envelope carries them for every method; the
 * render-host methods act on the caller's own machine by construction, since
 * the socket never leaves it.
 */
const makeExchange =
  (cliService: CliService) =>
  async (reports: DesignRenderHostReport[]): Promise<DesignRenderHostWork[]> => {
    const machineId = await cliService.getLocalMachineId()
    if (machineId === null) throw new Error('the local agent runtime is not running')
    const snapshot = await readLocalPlatformSnapshot()
    if (!snapshot) throw new Error('the local workspace catalog is not provisioned yet')

    const response = await cliService.sendLocalMachineRpc({
      machineId,
      workspaceId: snapshot.workspace.workspaceId,
      method: 'design/render-host',
      params: { reports }
    })
    if (!response.ok) throw new Error(response.error)
    const parsed = DesignRenderRpcResultSchema.safeParse(response.result)
    if (!parsed.success || parsed.data.type !== 'design/render-host') {
      throw new Error('the daemon answered the render host unexpectedly')
    }
    return parsed.data.requests
  }

/**
 * Begin polling, and return the disposer that stops it.
 *
 * Started once, after the app is ready: rendering needs a `BrowserWindow`, and
 * the daemon treats two pollers as one host that restarted.
 */
export function startDesignRenderHost(cliService: CliService): () => void {
  let lastLoggedFailure = ''
  const loop = new DesignRenderHostLoop<DesignPayload>({
    exchange: makeExchange(cliService),
    readPayload: readStagedPayload,
    renderPng: async (payload) => await renderSavedDesign(payload, 'png'),
    writeOutput: writeOutputAtomic,
    log: (message) => {
      // A poll once every couple of seconds must not fill the log with the same
      // line: log a failure when it changes, and stay silent while it repeats.
      if (message === lastLoggedFailure) return
      lastLoggedFailure = message
      console.warn(`[design-render-host] ${message}`)
    }
  })
  loop.start(DESIGN_RENDER_HOST_POLL_INTERVAL_MS)
  return () => loop.stop()
}
