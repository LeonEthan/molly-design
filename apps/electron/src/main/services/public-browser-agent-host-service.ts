import {
  AgentBrowserRpcResultSchema,
  BROWSER_HOST_POLL_INTERVAL_MS,
  BROWSER_HOST_TTL_MS,
  type AgentBrowserHostReport,
  type AgentBrowserHostWork
} from '@molly/shared/browser-agent-rpc'
import { readLocalPlatformSnapshot } from '../platform'
import type { CliService } from './cli-service'
import type { PublicBrowserService } from './public-browser-service'

const errorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).trim().slice(0, 1_000) ||
  'Browser operation failed.'

/** Desktop side of the existing owner-only machine-socket handoff. No new listener. */
export class PublicBrowserAgentHost {
  private timer: ReturnType<typeof setTimeout> | undefined
  private reports: AgentBrowserHostReport[] = []
  private readonly inFlight = new Set<string>()
  private readonly busyPages = new Set<string>()
  private running = false
  private lastSuccessAt: number | undefined

  constructor(
    private readonly cliService: CliService,
    private readonly browser: PublicBrowserService,
    private readonly now: () => number = () => Date.now()
  ) {}

  start(): void {
    if (this.running) return
    this.running = true
    void this.cycle()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.browser.revokeAllAgentCommands()
  }

  private async cycle(): Promise<void> {
    await this.pollOnce()
    if (this.running)
      this.timer = setTimeout(() => void this.cycle(), BROWSER_HOST_POLL_INTERVAL_MS)
  }

  async pollOnce(): Promise<void> {
    const sent = this.reports.slice(0, 8)
    try {
      const machineId = await this.cliService.getLocalMachineId()
      const snapshot = await readLocalPlatformSnapshot()
      if (!machineId || !snapshot) throw new Error('Local Molly runtime is unavailable.')
      const response = await this.cliService.sendLocalMachineRpc({
        machineId,
        workspaceId: snapshot.workspace.workspaceId,
        method: 'browser/host',
        params: {
          reports: sent,
          leases: this.browser
            .activeAgentScopes()
            .slice(0, 8)
            .map(({ sessionId, browserId, runId }) => ({
              sessionId,
              browserId,
              runId
            })),
          takeovers: this.browser
            .takeoverScopes()
            .slice(0, 8)
            .map(({ sessionId, browserId, runId }) => ({
              sessionId,
              browserId,
              runId
            }))
        }
      })
      if (!response.ok) throw new Error(response.error)
      const parsed = AgentBrowserRpcResultSchema.safeParse(response.result)
      if (!parsed.success || parsed.data.type !== 'browser/host') {
        throw new Error('Unexpected browser host answer.')
      }
      this.lastSuccessAt = this.now()
      this.reports = this.reports.slice(sent.length)
      for (const lease of parsed.data.revoke) this.browser.revokeAgentCommand(lease.browserId)
      for (const work of parsed.data.requests) {
        if (this.inFlight.has(work.requestId)) continue
        if (this.busyPages.has(work.scope.browserId)) {
          this.reports.push({
            requestId: work.requestId,
            ok: false,
            error: 'Browser page is still finishing a previous operation.'
          })
          continue
        }
        this.inFlight.add(work.requestId)
        this.busyPages.add(work.scope.browserId)
        void this.execute(work)
      }
    } catch {
      if (
        this.lastSuccessAt !== undefined &&
        this.now() - this.lastSuccessAt > BROWSER_HOST_TTL_MS
      ) {
        this.browser.revokeAllAgentCommands()
        this.lastSuccessAt = undefined
      }
    }
  }

  private async execute(work: AgentBrowserHostWork): Promise<void> {
    let report: AgentBrowserHostReport
    try {
      const reply = await this.browser.executeAgentCommand(work.scope, work.command)
      report = { requestId: work.requestId, ok: true, reply }
    } catch (error) {
      report = { requestId: work.requestId, ok: false, error: errorMessage(error) }
    } finally {
      this.inFlight.delete(work.requestId)
      this.busyPages.delete(work.scope.browserId)
    }
    if (this.running) this.reports.push(report)
  }
}

export function startPublicBrowserAgentHost(
  cliService: CliService,
  browser: PublicBrowserService
): () => void {
  const host = new PublicBrowserAgentHost(cliService, browser)
  host.start()
  return () => host.stop()
}
