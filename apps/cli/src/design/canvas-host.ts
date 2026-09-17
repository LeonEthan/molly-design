import type { DesignCanvasReport, DesignCanvasState } from '@molly/shared/local-machine-rpc';

/** A pending desktop flush belongs to the existing visible-turn owner, never a view. */
export class DesignCanvasHost {
  private readonly active = new Map<
    string,
    DesignCanvasState & { sessionId: string; settle?: (error?: Error) => void }
  >();

  async prepare(
    sessionId: string,
    artworkId: string,
    turnId: string,
    signal: AbortSignal
  ): Promise<void> {
    signal.throwIfAborted();
    const previous = this.active.get(artworkId);
    if (previous) throw new Error('This artwork already has an active turn');
    await new Promise<void>((resolve, reject) => {
      const abort = () => settle(new Error('Canvas preparation was cancelled'));
      const timer = setTimeout(
        () =>
          settle(
            new Error('Canvas save was not confirmed by the desktop; edits and input are retained')
          ),
        30_000
      );
      const settle = (error?: Error) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        const entry = this.active.get(artworkId);
        if (entry?.turnId === turnId) {
          entry.settle = undefined;
          entry.preparing = false;
        }
        if (error) reject(error);
        else resolve();
      };
      this.active.set(artworkId, { sessionId, artworkId, turnId, preparing: true, settle });
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  release(sessionId: string, turnId: string): void {
    for (const [id, entry] of this.active) {
      if (entry.sessionId !== sessionId || entry.turnId !== turnId) continue;
      entry.settle?.(new Error('Turn ended before canvas preparation completed'));
      this.active.delete(id);
    }
  }

  /** Whole authoritative snapshot. Lost transports and old reports never release ownership. */
  exchange(reports: readonly DesignCanvasReport[]): DesignCanvasState[] {
    for (const report of reports) {
      const entry = this.active.get(report.artworkId);
      if (entry?.turnId !== report.turnId) continue;
      entry.settle?.(
        report.ok ? undefined : new Error(report.error || 'Canvas save failed; edits are retained')
      );
    }
    return [...this.active.values()].map(({ artworkId, turnId, preparing }) => ({
      artworkId,
      turnId,
      preparing,
    }));
  }
}
