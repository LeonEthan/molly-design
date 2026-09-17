/**
 * The desktop half of the design preview render bridge (P2.4b).
 *
 * The daemon owns the agent, the session workdir, and the design intake, but it
 * cannot rasterize a document — that needs this process's Chromium. So a preview
 * is a hand-off: the daemon stages a payload and queues it, and this loop asks
 * for queued work on an interval, renders it, and reports the result on a later
 * poll (see `apps/cli/src/design/render-host.ts` for the daemon's side of the
 * same exchange).
 *
 * The direction is the ordinary one — the desktop calls the daemon, never the
 * reverse — so a machine with no desktop polling has no render capability at
 * all, and the daemon says so honestly rather than waiting on a call it cannot
 * make.
 *
 * Three rules shape this module:
 *
 * - **One render per request, and the report survives a failed poll.** The host
 *   is the only party that knows whether a preview rendered, so a report is held
 *   until a poll actually reaches the daemon; retrying the exchange must never
 *   re-render or lose the answer. A `requestId` already rendering is ignored if
 *   the daemon hands it out again, because a second render would race the first
 *   for the same output path.
 * - **The loop never throws and never retries work.** A render failure becomes a
 *   report the daemon turns into an honest refusal; nothing here repairs, re-runs,
 *   or second-guesses the agent's project (agent-naive; root `AGENTS.md`).
 * - **No filesystem, no Electron, no wire types.** Everything the loop touches is
 *   injected and structurally typed, so it runs (and is tested) under `node
 *   --test` without the `electron` runtime — the same split as
 *   `image-export-core.ts`.
 */

/**
 * What the daemon asks the desktop to render. Structurally the shared
 * `DesignRenderHostWork`; declared here so this module stays importable without
 * the `@molly/shared` root (which Node cannot resolve for the tests).
 */
export type DesignRenderHostWork = {
  requestId: string
  /** Staged `DesignPayload` JSON written by the daemon. Read once, then discarded. */
  payloadPath: string
  /** Absolute path the rendered PNG must be written to. */
  outputPath: string
  width: number
  height: number
}

/** The result of one handed-out request, as the daemon's schema expects it. */
export type DesignRenderHostReport =
  | { requestId: string; ok: true }
  | { requestId: string; ok: false; error: string }

export type DesignRenderHostLoopOptions<TPayload> = {
  /**
   * One `design/render-host` round trip: hand over everything finished since the
   * last poll and receive whatever is queued now. Rejecting is a failed poll —
   * nothing was delivered.
   */
  exchange: (reports: DesignRenderHostReport[]) => Promise<DesignRenderHostWork[]>
  /** Read one staged payload written by the daemon. */
  readPayload: (payloadPath: string) => Promise<TPayload>
  /** Rasterize at the document canvas size. */
  renderPng: (payload: TPayload) => Promise<Uint8Array>
  /** Write the rendered bytes where the daemon asked for them. */
  writeOutput: (outputPath: string, bytes: Uint8Array) => Promise<void>
  /** Test seams: default to the global timers. */
  setTimer?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
  log?: (message: string) => void
}

/**
 * Reports per poll, matching the daemon's `reports` array bound. Anything over
 * this is carried into the next poll rather than sent, because an oversized
 * request would fail schema validation and cost every report in it.
 */
export const MAX_REPORTS_PER_POLL = 8

/** Matches the daemon's report-error bound; a longer message would be rejected. */
export const MAX_REPORT_ERROR_CHARS = 500

const FALLBACK_ERROR = 'the preview could not be rendered'

/** Bound and never-empty: an empty message is rejected by the daemon's schema. */
const describeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  const bounded = message.trim().slice(0, MAX_REPORT_ERROR_CHARS)
  return bounded.length > 0 ? bounded : FALLBACK_ERROR
}

export class DesignRenderHostLoop<TPayload> {
  private readonly exchange: DesignRenderHostLoopOptions<TPayload>['exchange']
  private readonly readPayload: DesignRenderHostLoopOptions<TPayload>['readPayload']
  private readonly renderPng: DesignRenderHostLoopOptions<TPayload>['renderPng']
  private readonly writeOutput: DesignRenderHostLoopOptions<TPayload>['writeOutput']
  private readonly setTimer: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void
  private readonly log: (message: string) => void
  /** Finished work, waiting for a poll that actually reaches the daemon. */
  private reports: DesignRenderHostReport[] = []
  /** Request ids being rendered right now, so a re-handout cannot double-render. */
  private readonly inFlight = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false

  constructor(options: DesignRenderHostLoopOptions<TPayload>) {
    this.exchange = options.exchange
    this.readPayload = options.readPayload
    this.renderPng = options.renderPng
    this.writeOutput = options.writeOutput
    this.setTimer = options.setTimer ?? ((handler, ms) => setTimeout(handler, ms))
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle))
    this.log = options.log ?? (() => {})
  }

  /**
   * Poll once immediately — so a desktop that just opened makes previews
   * available at once rather than after an interval — then on the given period.
   *
   * `intervalMs` is a parameter and not a constant here on purpose: the value
   * must stay under the daemon's liveness TTL, and the authority for both is
   * `DESIGN_RENDER_HOST_*` in `@molly/shared`, which this module deliberately
   * does not import.
   */
  start(intervalMs: number): void {
    if (this.running) return
    this.running = true
    void this.cycle(intervalMs)
  }

  /**
   * Stop polling. Outstanding work is deliberately not reported as failed: the
   * daemon notices the liveness gap on the next host's first poll and fails
   * whatever the old host was holding, which is also the path that covers a
   * desktop that crashed rather than quit.
   */
  stop(): void {
    this.running = false
    if (this.timer === undefined) return
    this.clearTimer(this.timer)
    this.timer = undefined
  }

  private async cycle(intervalMs: number): Promise<void> {
    await this.pollOnce()
    if (!this.running) return
    this.timer = this.setTimer(() => {
      void this.cycle(intervalMs)
    }, intervalMs)
  }

  /**
   * One round trip. Public, and independent of `running`, so a test can drive
   * the exchange without timers.
   */
  async pollOnce(): Promise<void> {
    const send = this.reports.slice(0, MAX_REPORTS_PER_POLL)

    let work: DesignRenderHostWork[]
    try {
      work = await this.exchange(send)
    } catch (error) {
      // The daemon never heard these, so nothing was delivered and every report
      // is still owed. `this.reports` already holds all of them — including any
      // that finished while this poll was failing — so the only correct thing to
      // do is leave it alone.
      this.log(`design render host: poll failed: ${describeError(error)}`)
      return
    }
    // The reports that were sent are spent; the rest are still owed, and any
    // report that finished during the exchange is already behind them (reports
    // are only ever appended).
    this.reports = this.reports.slice(send.length)

    for (const item of work) {
      if (this.inFlight.has(item.requestId)) continue
      this.inFlight.add(item.requestId)
      void this.render(item)
    }
  }

  /**
   * Render one handed-out request and buffer its report.
   *
   * Never rejects: `render` is invoked without an await by `pollOnce`, so an
   * escaped rejection would be an unhandled one.
   */
  private async render(work: DesignRenderHostWork): Promise<void> {
    let report: DesignRenderHostReport
    try {
      const payload = await this.readPayload(work.payloadPath)
      const bytes = await this.renderPng(payload)
      await this.writeOutput(work.outputPath, bytes)
      report = { requestId: work.requestId, ok: true }
    } catch (error) {
      report = { requestId: work.requestId, ok: false, error: describeError(error) }
    } finally {
      this.inFlight.delete(work.requestId)
    }
    this.reports.push(report)
  }
}
