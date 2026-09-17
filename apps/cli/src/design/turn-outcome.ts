import type { SessionData } from '@molly/shared/session-data';
import {
  ensureDesignDirectory,
  resolveDesignWorkspace,
  resolveDesignTurnWorkspace,
} from './workspace';
/**
 * Design turn outcome collection (P2.3).
 *
 * After a design-session turn finishes, the daemon looks at what the agent left
 * in the session workdir and classifies it into one durable verdict:
 *
 *   missing design.yaml            -> no_artifact (canvas untouched)
 *   unchanged since send          -> no_artifact (nothing this turn produced)
 *   structure/collection failure   -> invalid (+ bounded diagnostics)
 *   imported and saved             -> committed (revisionId)
 *   baseline moved under us        -> invalid (+ durable conflict diagnostics)
 *   cancelled / turn failed        -> cancelled / failed (nothing collected)
 *
 * The verdict is stamped as a `DesignTurnOutcome` on the history entry whose id
 * is the turn-input manifest's turnId, so the receipt survives reopen without
 * touching the workspace again.
 *
 * Boundaries this module deliberately keeps:
 *
 * - The manifest `design-input/<turnId>/manifest.json` written by P2.2
 *   (`./turn-input.ts`) is the integrity anchor. No manifest means no design
 *   turn input was frozen (pre-P2.2 session, internal turn, or the meta-read
 *   branch), so there is nothing to report and nothing is written.
 * - A turn that produced nothing is not a turn that found something. The
 *   workspace project is compared against the manifest's `artifactAtSend`
 *   (`./artifact.ts`): a byte-identical inherited project requires an explicit,
 *   exact-content resubmission attempt before it can commit. Without that check a
 *   turn whose agent wrote nothing would re-import the previous turn's project
 *   and report it as its own.
 * - Unchanged projects without explicit intent return before import or canvas comparison. Their
 *   files, existing candidates, and historical receipts remain untouched. A
 *   missing dispatch digest is not proof of no change: legacy manifests keep
 *   their existing validation and atomic save path. An explicit resubmission
 *   needs separate attempt evidence; identical rewrites do not establish it.
 * - Validation is storage-layer structure only — schema, Bento kernel replay,
 *   asset integrity, and the intake's own fail-closed snapshot rules. Semantic
 *   checks the agent could have run itself (its `finalize.mjs`, preview
 *   rendering, taste) are not re-run here, nothing is repaired, and no paid
 *   call is retried (agent-naive; root `AGENTS.md`).
 * - The design store is the single committer. This module never writes
 *   `design.json` itself: it asks `designOperation` to save against the frozen
 *   baseline, and the store's `DESIGN_CONFLICT` records a lost race without
 *   overwriting the canvas or creating a candidate. `DESIGN_BUSY` — the store's lock held past its deadline — is
 *   read the same way, because it means a writer was in there, so this turn's
 *   document may be behind the canvas.
 * - Idempotent per turn: an outcome already stamped on the turn is the truth,
 *   and a re-run does not re-collect, re-commit, or re-create work.
 * - A verdict survives losing its stamp, up to the reach of a later collection.
 *   The verdict is written to the turn's own directory first
 *   (`design-input/<turnId>/receipt.json`, P2.2's `writeDesignTurnReceipt`) and
 *   stamped on the history entry second, so of the two durable effects of one
 *   turn — the store write and the history write — it is the second that can be
 *   lost without losing the verdict: a collection that finds a receipt stamps
 *   what it says instead of deciding again, without re-collecting.
 *   Two limits come with that, and both are stated rather than papered over. The
 *   stretch *before* the receipt is written has nothing to recover from: a daemon
 *   that dies between the store write and the receipt (or before either) meets no
 *   receipt when it finalizes that turn again, so the turn is decided again — safe,
 *   because the store's CAS means a canvas that moved is never overwritten, but not
 *   identical, since a document this turn already committed reports a
 *   conflict if the user saved in between. And a stamp that fails on a *live*
 *   daemon is not recovered at all: it is logged, the turn finalizes, and nothing
 *   re-runs this stage for a turn that already ended (the canvas holds the truth;
 *   the history receipt is missing).
 * - A receipt is app bookkeeping that sits in the agent's own workspace, which is
 *   a boundary rather than a guarantee. `design-input/<turnId>/` is the session
 *   workdir, so an agent can write the file — the same standing as the manifest
 *   beside it (`./turn-input.ts`), and the same reason this module validates every
 *   byte it reads instead of trusting the directory. What a forged receipt buys is
 *   bounded, and worth stating exactly: this module never writes `design.json`
 *   from it, the payload is only ever read through `sanitizeDesignTurnOutcome`,
 *   and both ids have to match the collection in hand (the same turn of the same
 *   artwork), so the most it can do is mislabel that turn's own receipt and hide that
 *   turn's artifact. It cannot touch the canvas, another turn, or another artwork.
 */

import { intakeAuthoring } from '@molly/design-authoring';
import {
  DESIGN_TURN_OUTCOME_VERSION,
  sanitizeDesignTurnOutcome,
  sanitizeDesignTurnOutcomeDiagnostics,
  type DesignTurnOutcome,
  type DesignTurnOutcomeDiagnostic,
  type SessionMeta,
} from '@molly/shared';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getMollyDataDir } from '@molly/shared/node/installation-profile';
import { DESIGN_ARTIFACT_ENTRY, readDesignArtifact } from './artifact';
import { buildAssetDataUris } from './authoring-assets';
import { DESIGN_BUSY, type DesignLockTiming } from './lock';
import { designOperation } from './store';
import {
  DESIGN_TURN_INPUT_DIRNAME,
  DESIGN_TURN_MANIFEST_FILENAME,
  isDesignTurnId,
  readDesignTurnReceipt,
  writeDesignTurnReceipt,
  type DesignTurnManifest,
} from './turn-input';

const SHA256_RE = /^[a-f0-9]{64}$/;

/**
 * The part of `SessionDocument` this module needs. Structural, so the real
 * document satisfies it and a test can hand over the smallest possible stand-in.
 */
export interface DesignTurnOutcomeSession {
  getMetaState(): Promise<SessionMeta | undefined>;
  sessionData: Pick<SessionData, 'history' | 'commands'>;
}

export interface DesignTurnOutcomeContext {
  /** Live daemon evidence; never read from Agent-writable input files. */
  designSubmission?: import('./sync-service').DesignSubmission;
  designNativeTerminal?: 'end_turn' | 'failed' | 'cancelled';
  sessionId: string;
  sessionDoc: DesignTurnOutcomeSession;
  /**
   * The turn-input manifest's turnId — the user turn, and the id of the history
   * entry the outcome is stamped on. Internal turns have none and never reach
   * this module.
   */
  turnId: string;
  /** Absolute session workdir (`chats/<sessionId>`); defaults to the data-root layout. */
  workdir?: string;
  /** Trusted host workspace from the live Session; never read from the manifest. */
  workspaceRoot?: string;
  /** Test seam: defaults to the daemon data root (the root the workdir lives under). */
  dataRoot?: string;
  /**
   * Test seam: timing for the store's write lock, so a collection that loses to
   * a held lock can be exercised without waiting out the real deadline
   * (`./store.ts`, `./lock.ts`). Production passes nothing.
   */
  lock?: DesignLockTiming;
  /** Test seam: defaults to the wall clock. */
  now?: () => Date;
}

export type DesignTurnSkipReason =
  | 'not_design'
  | 'session_doc_unreadable'
  | 'no_manifest'
  | 'already_recorded'
  | 'entry_missing';

export type DesignTurnAttempt =
  | { status: 'recorded'; outcome: DesignTurnOutcome }
  | { status: 'skipped'; reason: DesignTurnSkipReason };

const outcomeBase = (
  ctx: DesignTurnOutcomeContext,
  artworkId: string
): Omit<DesignTurnOutcome, 'status'> => ({
  version: DESIGN_TURN_OUTCOME_VERSION,
  turnId: ctx.turnId,
  artworkId,
  timestamp: (ctx.now ?? (() => new Date()))().toISOString(),
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const diagnostics = (
  entries: readonly DesignTurnOutcomeDiagnostic[]
): DesignTurnOutcomeDiagnostic[] | undefined => sanitizeDesignTurnOutcomeDiagnostics(entries);

type ManifestPresent =
  | { kind: 'unreadable'; message: string }
  | { kind: 'ok'; manifest: DesignTurnManifest };
type ManifestRead = { kind: 'missing' } | ManifestPresent;

async function readTurnManifest(workdir: string, turnId: string): Promise<ManifestRead> {
  // A turn whose id cannot name a turn directory never had a frozen manifest
  // (P2.2 refuses to materialize one), so there is nothing to read and no path
  // to build out of it.
  if (!isDesignTurnId(turnId)) return { kind: 'missing' };
  const file = path.join(workdir, DESIGN_TURN_INPUT_DIRNAME, turnId, DESIGN_TURN_MANIFEST_FILENAME);
  let bytes: string;
  try {
    bytes = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'unreadable', message: errorMessage(error) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    return { kind: 'unreadable', message: `manifest is not valid JSON: ${errorMessage(error)}` };
  }
  const manifest = parsed as Partial<DesignTurnManifest> | null;
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    typeof manifest.baselineRevisionId !== 'string' ||
    !SHA256_RE.test(manifest.baselineRevisionId)
  ) {
    return { kind: 'unreadable', message: 'manifest does not carry a usable baselineRevisionId' };
  }
  return { kind: 'ok', manifest: manifest as DesignTurnManifest };
}

/** The outcome already stamped on this turn, if any. */
const recordedOutcome = (
  history: readonly { id: string; designOutcome?: unknown }[],
  turnId: string
) => {
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (!entry || entry.id !== turnId) continue;
    return sanitizeDesignTurnOutcome(entry.designOutcome);
  }
  return undefined;
};

/**
 * Write the verdict onto this turn's history entry, keeping the first one.
 *
 * Returns false when the turn's entry is gone (the user rewound or resent the
 * turn before finalization landed) — the caller reports that instead of
 * claiming a receipt it could not write.
 */
async function stampOutcome(
  ctx: DesignTurnOutcomeContext,
  outcome: DesignTurnOutcome
): Promise<boolean> {
  const result = await ctx.sessionDoc.sessionData.commands.applyHistoryAction({
    kind: 'design-outcome',
    turnId: ctx.turnId,
    outcome,
  });
  return result.matched === true;
}

/**
 * Decide which verdict this turn gets, then record it.
 *
 * `classify` returns the verdict for a turn that reached collection; the two
 * terminal entry points below supply their own (cancelled / failed) without
 * touching the artifact. Everything around that — the design gate, the manifest
 * anchor, idempotency, the receipt, the stamp — is shared so the
 * three paths cannot disagree.
 */
async function recordTurnOutcome(
  ctx: DesignTurnOutcomeContext,
  classify: (args: {
    artworkId: string;
    workdir: string;
    dataRoot: string;
    manifestFile: ManifestPresent;
    requiresNativeTerminal: boolean;
  }) => Promise<{ outcome: DesignTurnOutcome }>
): Promise<DesignTurnAttempt> {
  const dataRoot = ctx.dataRoot ?? getMollyDataDir();
  const workdir = ctx.workdir ?? path.join(dataRoot, 'chats', ctx.sessionId);

  let meta: SessionMeta | undefined;
  let history: readonly { id: string; designOutcome?: unknown }[];
  try {
    meta = await ctx.sessionDoc.getMetaState();
    if (!meta?.design) return { status: 'skipped', reason: 'not_design' };
    // Read after the gate: a non-design session pays nothing for this stage.
    const read = await ctx.sessionDoc.sessionData.history.readTurn(ctx.turnId);
    history = read.state === 'ready' ? [read.turn] : [];
  } catch {
    // Nothing durable can be said about a session doc we cannot read, and a
    // half-written receipt is worse than none.
    return { status: 'skipped', reason: 'session_doc_unreadable' };
  }
  const artworkId = meta.design.artworkId;
  if (recordedOutcome(history, ctx.turnId)) {
    return { status: 'skipped', reason: 'already_recorded' };
  }

  // A receipt means this turn's verdict was already reached and written down,
  // and only the history stamp was lost — the daemon died between the two writes,
  // and this is it finalizing that turn again. Stamping what it says is the whole
  // recovery: nothing is collected, committed, or rendered a second time — so a
  // turn can never commit twice, and a revision it already committed can never
  // come back as a conflict. Both ids are checked because the file is in the
  // agent's workspace (see the module doc): it may only speak for the turn it
  // names, and for this artwork.
  const receipt = await readDesignTurnReceipt(workdir, ctx.turnId);
  if (receipt !== undefined && receipt.turnId === ctx.turnId && receipt.artworkId === artworkId) {
    if (!(await stampOutcome(ctx, receipt))) return { status: 'skipped', reason: 'entry_missing' };
    return { status: 'recorded', outcome: receipt };
  }

  let manifestFile = await readTurnManifest(workdir, ctx.turnId);
  if (manifestFile.kind === 'missing') {
    if (meta.agentType !== 'pi-acp' && !(meta.cliType === 'builtin' && meta.agentType === 'claude'))
      return { status: 'skipped', reason: 'no_manifest' };
    manifestFile = {
      kind: 'unreadable',
      message: 'Design turn input is missing; draft preserved',
    };
  }

  let artifactWorkdir = workdir;
  if (ctx.workspaceRoot !== undefined && manifestFile.kind === 'ok') {
    try {
      artifactWorkdir = resolveDesignTurnWorkspace(
        resolveDesignWorkspace({
          workspaceRoot: ctx.workspaceRoot,
          sessionId: ctx.sessionId,
          artworkId,
          legacyWorkdir: workdir,
        }),
        manifestFile.manifest,
        artworkId
      ).artifactWorkdir;
      await ensureDesignDirectory(
        artifactWorkdir === workdir ? workdir : ctx.workspaceRoot,
        artifactWorkdir
      );
    } catch (error) {
      // A mismatch is a diagnostic, not permission to follow the file's claimed root.
      manifestFile = { kind: 'unreadable', message: errorMessage(error) };
    }
  }
  const collected = await classify({
    artworkId,
    workdir: artifactWorkdir,
    dataRoot,
    manifestFile,
    requiresNativeTerminal: meta.agentType === 'pi-acp',
  });

  try {
    // Written before the stamp, so the two durable effects of this turn — the
    // store write that is already done, and the history write that follows —
    // are recoverable as a pair.
    await writeDesignTurnReceipt(workdir, ctx.turnId, collected.outcome);
  } catch {
    // A receipt that cannot be written is a recovery aid that was not stored,
    // not a verdict that was not reached. The stamp still happens; if *it* is
    // then lost, this turn is simply decided again, exactly as it was before
    // the receipt existed. Losing a reached verdict — or a commit — to a
    // bookkeeping file would be the worse failure.
  }

  if (!(await stampOutcome(ctx, collected.outcome))) {
    // The commit (if any) happened, but the turn's entry is gone — report that
    // instead of claiming a history receipt that was not recorded.
    return { status: 'skipped', reason: 'entry_missing' };
  }

  return {
    status: 'recorded',
    outcome: collected.outcome,
  };
}

/** The imported half of a design store write: the document and its assets. */
type DesignTurnContent = { doc: Record<string, unknown>; assets: Record<string, string> };

/**
 * Collect this turn's artifact, classify it, and commit, keep, or reject it.
 */
export async function collectDesignTurnOutcome(
  ctx: DesignTurnOutcomeContext
): Promise<DesignTurnAttempt> {
  return await recordTurnOutcome(
    ctx,
    async ({ artworkId, workdir, dataRoot, manifestFile, requiresNativeTerminal }) => {
      const base = outcomeBase(ctx, artworkId);
      const invalid = (
        entries: readonly DesignTurnOutcomeDiagnostic[]
      ): { outcome: DesignTurnOutcome } => {
        const bounded = diagnostics(entries);
        return {
          outcome: {
            ...base,
            status: 'invalid',
            ...(bounded === undefined ? {} : { diagnostics: bounded }),
          },
        };
      };
      if (requiresNativeTerminal && ctx.designNativeTerminal !== 'end_turn') {
        return {
          outcome: {
            ...base,
            status: ctx.designNativeTerminal === 'cancelled' ? 'cancelled' : 'failed',
            diagnostics: [
              {
                code: ctx.designNativeTerminal
                  ? 'design_native_turn_failed'
                  : 'design_native_terminal_missing',
                message:
                  ctx.designNativeTerminal === 'cancelled'
                    ? 'Native Pi execution was cancelled; draft and current canvas preserved.'
                    : ctx.designNativeTerminal === 'failed'
                      ? 'Native Pi reported an execution failure; draft and current canvas preserved. Explicitly continue to read the current design and retained files.'
                      : 'Native Pi completion could not be verified; draft and current canvas preserved. Explicitly continue rather than assuming ACP end_turn proves success.',
              },
            ],
          },
        };
      }
      if (manifestFile.kind === 'unreadable') {
        return invalid([{ code: 'design_manifest_unreadable', message: manifestFile.message }]);
      }
      if (manifestFile.manifest.turnId !== ctx.turnId) {
        return invalid([
          {
            code: 'design_manifest_mismatch',
            message: `manifest turnId ${JSON.stringify(manifestFile.manifest.turnId)} does not match this turn`,
          },
        ]);
      }

      // Missing entry artifact: the agent finished without producing an editable
      // design. The current canvas is left exactly as it was.
      const artifact = await readDesignArtifact(workdir);
      if (artifact.status === 'absent') return { outcome: { ...base, status: 'no_artifact' } };
      if (artifact.status === 'rejected') {
        // Symlink/hardlink/escape/non-regular entry: the artifact exists but is
        // not a snapshot we are willing to import. Never repaired, never retried.
        return invalid([
          {
            code:
              artifact.rejectedBy === 'snapshot'
                ? 'design_collect_rejected'
                : 'design_collect_failed',
            message: artifact.message,
          },
        ]);
      }

      // Only a matching dispatch digest proves that this turn produced nothing.
      // Do not import or offer an earlier project's contents just because the
      // current canvas differs. Legacy manifests without this evidence continue
      // through the existing validation and atomic version check below.
      const unchangedSinceSend =
        manifestFile.manifest.artifactAtSend?.status === 'present' &&
        manifestFile.manifest.artifactAtSend.digest === artifact.digest;
      const baseline = ctx.designSubmission;
      const verifiedAttempt =
        baseline?.artworkId === artworkId &&
        baseline.draftId === workdir &&
        baseline.artifactDigest === artifact.digest;
      if (unchangedSinceSend && !verifiedAttempt)
        return { outcome: { ...base, status: 'no_artifact' } };

      const baselineRevisionId =
        verifiedAttempt && baseline
          ? baseline.revisionId
          : manifestFile.manifest.baselineRevisionId;

      const snapshot = artifact.snapshot;
      const intake = intakeAuthoring(DESIGN_ARTIFACT_ENTRY, snapshot);
      if (intake.status === 'invalid') {
        return invalid(intake.diagnostics.map(({ code, message }) => ({ code, message })));
      }
      if (intake.status === 'unsupported') {
        return invalid(intake.issues.map(({ code, message }) => ({ code, message })));
      }

      // The store re-parses `doc` with its own schema, so this cast asserts
      // nothing: it only bridges the imported BentoDoc type to the request input
      // type, exactly as the intake → store integration test does.
      let content: DesignTurnContent;
      try {
        content = {
          doc: intake.document as unknown as Record<string, unknown>,
          assets: buildAssetDataUris(intake.assets),
        };
      } catch (error) {
        return invalid([{ code: 'design_asset_failed', message: errorMessage(error) }]);
      }

      try {
        const saved = await designOperation(
          dataRoot,
          {
            operation: 'save',
            sessionId: artworkId,
            baseRevisionId: baselineRevisionId,
            content,
          },
          { lock: ctx.lock }
        );
        return { outcome: { ...base, status: 'committed', revisionId: saved.revisionId } };
      } catch (error) {
        const conflict =
          error instanceof Error &&
          (error.message === 'DESIGN_CONFLICT' || error.message === DESIGN_BUSY);
        return invalid([
          {
            code: conflict ? 'design_commit_conflict' : 'design_store_failed',
            message: errorMessage(error),
          },
          ...(conflict
            ? [
                {
                  code: 'design_draft_preserved',
                  message: `Draft preserved: ${workdir}. The current drawing was not overwritten.`,
                },
                {
                  code: 'design_continue_required',
                  message: `Final collection found this conflict after the Agent ended. On explicit continuation, read ${path.join(dataRoot, 'chats', artworkId, 'design-current', DESIGN_ARTIFACT_ENTRY)} and its pages, compare the draft, and explicitly resubmit or adjust it. No automatic Agent restart.`,
                },
              ]
            : []),
        ]);
      }
    }
  );
}

/**
 * Record a turn that never reached collection: the user stopped it, or
 * generation failed. Nothing is collected, committed, or kept as a candidate —
 * a cancelled turn must not change the canvas behind the user's back.
 */
export async function recordDesignTurnTerminalOutcome(
  ctx: DesignTurnOutcomeContext & { status: 'cancelled' | 'failed'; message?: string }
): Promise<DesignTurnAttempt> {
  return await recordTurnOutcome(ctx, async ({ artworkId }) => {
    const base = outcomeBase(ctx, artworkId);
    if (ctx.status === 'cancelled') return { outcome: { ...base, status: 'cancelled' } };
    const entries = diagnostics([
      { code: 'design_turn_failed', message: ctx.message ?? 'the turn failed' },
    ]);
    return {
      outcome: {
        ...base,
        status: 'failed',
        ...(entries === undefined ? {} : { diagnostics: entries }),
      },
    };
  });
}
