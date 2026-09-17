import { designOperation } from './store';
import type { DesignWorkspace } from './workspace';
import { readDesignArtifactDigest } from './artifact';

/** Explicit submission facts, not an assertion about what a model read. */
export interface DesignSubmission {
  artworkId: string;
  draftId: string;
  revisionId: string;
  artifactDigest: string;
}
export type DesignToolEvent =
  | { phase: 'start'; runId: string }
  | { phase: 'terminal'; runId: string; status: 'end_turn' | 'failed' | 'cancelled' }
  | { phase: 'resubmit'; expectedRevisionId: string; artifactDigest: string };

/** Active source/launch ownership is supplied by the existing execution owner. */
export class DesignSyncService {
  private runId: string | undefined;
  private terminal: 'end_turn' | 'failed' | 'cancelled' | undefined;
  private submission: DesignSubmission | undefined;
  private pending = Promise.resolve();
  constructor(
    readonly context: {
      artworkId: string;
      workspace: DesignWorkspace;
      dataRoot: string;
      assertActive: () => void;
    }
  ) {}
  getTerminalOutcome() {
    return this.terminal;
  }
  getSubmission() {
    return this.submission ? { ...this.submission } : undefined;
  }
  handle(event: DesignToolEvent): Promise<void> {
    const operation = this.pending.then(async () => {
      this.context.assertActive();
      if (event.phase === 'start') {
        if (this.runId !== undefined)
          throw Error('Native execution already registered for this turn');
        this.runId = event.runId;
        this.terminal = undefined;
        return;
      }
      if (event.phase === 'terminal') {
        if (this.runId !== event.runId) throw Error('Native execution has ended or changed');
        if (this.terminal !== undefined) throw Error('Native execution already settled');
        this.terminal = event.status;
        return;
      }
      const current = await designOperation(
        this.context.dataRoot,
        { operation: 'read', sessionId: this.context.artworkId },
        { projection: 'verify' }
      );
      if (current.revisionId !== event.expectedRevisionId)
        throw Error(
          'DESIGN_CONFLICT: current canvas changed; reread and compare the preserved draft'
        );
      const artifact = await readDesignArtifactDigest(this.context.workspace.artifactWorkdir);
      if (artifact.status !== 'present' || artifact.digest !== event.artifactDigest)
        throw Error(
          'DESIGN_DRAFT_CHANGED: exact submitted bytes no longer match; inspect the preserved draft'
        );
      this.context.assertActive();
      this.submission = {
        artworkId: this.context.artworkId,
        draftId: this.context.workspace.artifactWorkdir,
        revisionId: current.revisionId,
        artifactDigest: artifact.digest,
      };
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
