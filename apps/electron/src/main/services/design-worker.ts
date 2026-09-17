import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

/** The existing single design request queue, with an explicit process shutdown barrier. */
export class DesignWorker {
  private worker: ChildProcessWithoutNullStreams | undefined
  private workerExited: Promise<void> = Promise.resolve()
  private pending: { resolve(value: unknown): void; reject(error: Error): void } | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private stopping = false
  private shutdown: Promise<void> | undefined
  private readonly spawn: () => ChildProcessWithoutNullStreams

  constructor(spawn: () => ChildProcessWithoutNullStreams) {
    this.spawn = spawn
  }

  request<T>(request: unknown, beforeSend?: () => void): Promise<T> {
    if (this.stopping) return Promise.reject(Error('Design service is shutting down'))
    const result = this.queue
      .catch(() => {})
      .then(
        () =>
          new Promise<T>((resolve, reject) => {
            beforeSend?.()
            if (!this.worker) this.start()
            const child = this.worker!
            const pending = { resolve: (value: unknown) => resolve(value as T), reject }
            this.pending = pending
            child.stdin.write(JSON.stringify(request) + '\n', (error) => {
              if (error) {
                if (this.pending === pending) this.pending = undefined
                reject(error)
              }
            })
          })
      )
    this.queue = result
    return result
  }

  close(): Promise<void> {
    if (this.shutdown) return this.shutdown
    // Seal admission before awaiting: already accepted work still uses the same queue.
    this.stopping = true
    this.shutdown = (async () => {
      await this.queue.catch(() => {})
      const child = this.worker
      if (child) child.stdin.end()
      await this.workerExited
    })()
    return this.shutdown
  }

  private start(): void {
    const child = this.spawn()
    this.worker = child
    const lines = createInterface({ input: child.stdout })
    this.workerExited = new Promise<void>((resolve) => {
      const stopped = () => {
        if (this.worker === child) {
          this.worker = undefined
          this.pending?.reject(Error('Design service stopped; retry to check the saved drawing'))
          this.pending = undefined
        }
        lines.close()
        resolve()
      }
      child.once('exit', stopped)
      child.once('error', () => {
        if (this.worker !== child) return
        // Failed spawn has no process to await. A live child still owes an exit.
        this.pending?.reject(Error('Design service stopped; retry to check the saved drawing'))
        this.pending = undefined
        if (child.pid === undefined) stopped()
      })
    })
    lines.on('line', (line) => {
      if (this.worker !== child) return
      const current = this.pending
      this.pending = undefined
      try {
        const response = JSON.parse(line)
        if (response.ok) current?.resolve(response.value)
        else current?.reject(Error(response.error))
      } catch {
        current?.reject(Error('Invalid design service response'))
      }
    })
    child.stderr.resume()
  }
}

/** Flush can be cancelled; seal the worker only after the existing editor decision succeeds. */
export async function quitDesignWorker(
  worker: DesignWorker,
  flush: () => Promise<boolean>,
  disposeViews: () => void
): Promise<boolean> {
  if (!(await flush())) return false
  disposeViews()
  await worker.close()
  return true
}
