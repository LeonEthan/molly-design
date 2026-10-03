/**
 * Sidebar artwork thumbnails (2026-10-02 owner approval, designer UI phase 5).
 *
 * A thumbnail is a derived, disposable cache of the artwork's last saved revision:
 * deleting every cached file only costs a re-render. Showing a row reads the cache
 * and renders only when nothing is cached; a refresh compares the saved revision and
 * renders only when it moved. Callers decide when to refresh (after an Agent turn and
 * when the person leaves the canvas), so editing never re-renders on every autosave.
 *
 * Renders run one at a time: each is an offscreen Chromium page, and a sidebar full
 * of uncached rows must not open dozens at once.
 */

export type DesignThumbnail = { revisionId: string; dataUrl: string }

export type DesignThumbnailPorts<Saved extends { revisionId: string }> = {
  readSaved(artworkId: string): Promise<Saved>
  render(saved: Saved): Promise<string>
  readCached(artworkId: string): Promise<DesignThumbnail | undefined>
  writeCached(artworkId: string, thumbnail: DesignThumbnail): Promise<void>
}

export class DesignThumbnails<Saved extends { revisionId: string }> {
  private renders: Promise<unknown> = Promise.resolve()
  private readonly refreshing = new Map<string, Promise<string>>()
  private readonly waiting = new Map<string, Promise<string>>()
  private readonly ports: DesignThumbnailPorts<Saved>

  constructor(ports: DesignThumbnailPorts<Saved>) {
    this.ports = ports
  }

  async get(artworkId: string): Promise<string> {
    const cached = await this.ports.readCached(artworkId)
    return cached ? cached.dataUrl : this.refresh(artworkId)
  }

  /**
   * A refresh requested while another is running may follow a newer save than the
   * running one read, so it waits and reads again; refreshes that have not started
   * yet share that one follow-up.
   */
  refresh(artworkId: string): Promise<string> {
    const waiting = this.waiting.get(artworkId)
    if (waiting) return waiting
    const running = this.refreshing.get(artworkId)
    const start = running
      ? () =>
          running
            .catch(() => {})
            .then(() => {
              this.waiting.delete(artworkId)
              return this.refreshOnce(artworkId)
            })
      : () => this.refreshOnce(artworkId)
    const next: Promise<string> = start().finally(() => {
      if (this.refreshing.get(artworkId) === next) this.refreshing.delete(artworkId)
    })
    this.refreshing.set(artworkId, next)
    if (running) this.waiting.set(artworkId, next)
    return next
  }

  private async refreshOnce(artworkId: string): Promise<string> {
    const [saved, cached] = await Promise.all([
      this.ports.readSaved(artworkId),
      this.ports.readCached(artworkId)
    ])
    if (cached?.revisionId === saved.revisionId) return cached.dataUrl
    const dataUrl = await this.serialized(() => this.ports.render(saved))
    await this.ports.writeCached(artworkId, { revisionId: saved.revisionId, dataUrl })
    return dataUrl
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.renders.catch(() => {}).then(work)
    this.renders = next
    return next
  }
}
