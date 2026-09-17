import type { ObservedPreviewResult } from '../../../../cli/src/design/render-preview'

/** One bounded in-flight observation/publication and one coalesced dirty bit. */
export class SourceObservation {
  private generation = 0
  private running: Promise<void> | undefined
  private dirty = false
  private closed = false
  private last: ObservedPreviewResult | undefined
  readonly consumers = new Map<
    string,
    (result: ObservedPreviewResult, current: () => boolean) => Promise<void>
  >()
  private readonly observe: (previous?: string) => Promise<ObservedPreviewResult>
  private readonly dependencies: (paths: string[], valid: boolean) => boolean
  private readonly fallbackDependencies: readonly string[]
  constructor(
    observe: (previous?: string) => Promise<ObservedPreviewResult>,
    dependencies: (paths: string[], valid: boolean) => boolean,
    fallbackDependencies: readonly string[] = ['design.yaml']
  ) {
    this.observe = observe
    this.dependencies = dependencies
    this.fallbackDependencies = fallbackDependencies
  }
  invalidate() {
    this.generation++
    this.dirty = true
  }
  refresh(): Promise<void> {
    if (this.closed) return Promise.resolve()
    this.invalidate()
    if (this.running) return this.running
    this.running = this.drain().finally(() => {
      this.running = undefined
    })
    return this.running
  }
  private async drain() {
    let dependencyRetries = 0
    while (this.dirty && !this.closed) {
      this.dirty = false
      const generation = this.generation
      const current = () => !this.closed && generation === this.generation
      let result: ObservedPreviewResult
      try {
        result = await this.observe(this.last?.sourceIdentity)
      } catch (error) {
        result = { status: 'refused', error: String(error) }
      }
      if (!current()) continue
      if (result.status === 'unchanged' && this.last) result = this.last
      if (
        this.dependencies(
          result.dependencies ?? [...this.fallbackDependencies],
          result.status !== 'refused'
        )
      ) {
        if (++dependencyRetries <= 2) {
          this.invalidate()
          continue
        }
        result = {
          status: 'refused',
          error: 'Dependencies changed repeatedly; waiting for valid files.'
        }
      }
      if (result.sourceIdentity) this.last = result
      await Promise.allSettled(
        [...this.consumers.values()].map((consume) => consume(result, current))
      )
    }
  }
  close() {
    this.closed = true
    this.generation++
    this.consumers.clear()
    this.last = undefined
  }
}
