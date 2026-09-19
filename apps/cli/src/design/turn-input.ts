import {
  readDesignElementReferences,
  validateDesignElementReferences,
} from '@molly/shared/design-element-reference';
/**
 * Design-turn input materialization (P2.2), and the one directory a turn owns.
 *
 * Before a design-session turn is dispatched, the daemon freezes the turn's
 * input into the design workspace:
 *
 *   <workdir>/design-input/<turnId>/manifest.json
 *   <workdir>/design-input/<turnId>/references/<sha256>.<ext>
 *
 * The manifest records the prompt text, canvas size, the design's baseline
 * revisionId as saved at send time (read through the design store — the single
 * committer), the delivered skill content identity (and any drifted files the
 * materializer refused to overwrite), the workspace project as it stood at send
 * time (`artifactAtSend`; see `./artifact.ts`), and one entry per reference
 * image with its real sha256. P2.3's post-turn collection compares the post-turn
 * design against `baselineRevisionId` to decide commit versus preserved conflict, so this
 * manifest is the integrity anchor: failures here must block the dispatch, never
 * warn and continue.
 *
 * Two rules keep one turn's input frozen:
 *
 * - **Written once.** A turn that is set up again — the same userTurnId
 *   re-dispatched after a restart, see `durable pointer recovery` in
 *   `../lib/message-handler.ts` — gets back the manifest already on disk instead
 *   of a new one. Re-materializing must not re-read a baseline that may have
 *   moved since, and must not replace references the agent may already have
 *   read.
 * - **The workspace at send time is recorded, not assumed.** `artifactAtSend`
 *   is what P2.3 uses to tell "this turn produced a project" from "this turn
 *   found the previous turn's project still sitting there". It costs one pass
 *   over the project on the dispatch path, which is deliberate: without it the
 *   collection cannot distinguish the two, and a stale project would be
 *   re-imported as this turn's output.
 *
 * The same directory also carries the turn's *receipt*: the verdict P2.3 reached
 * (`./turn-outcome.ts` writes it before it stamps the history entry). It is the
 * recovery contract between a turn's two durable effects — the design store
 * write and the history stamp — so a turn that committed and then lost its stamp
 * is restored from its receipt instead of being collected a second time. A
 * receipt shares its turn's key, directory, and write discipline.
 *
 * Discipline (same as store.ts): every write is temp-file + fsync + rename in
 * the same directory, with a parent-directory fsync on POSIX. References are
 * content-named, so the same image attached twice lands once.
 */

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeDesignTurnOutcome, type DesignTurnOutcome } from '@molly/shared';
import { getMollyDataDir } from '@molly/shared/node/installation-profile';
import { collectAuthoring } from '@molly/design-authoring';
import { snapshotIdentity } from './render-preview';
import { artifactAtSendRecord, readDesignArtifact, type DesignArtifactAtSend } from './artifact';
import { designOperation } from './store';

export const DESIGN_TURN_INPUT_DIRNAME = 'design-input';
export const DESIGN_TURN_MANIFEST_FILENAME = 'manifest.json';
export const DESIGN_TURN_RECEIPT_FILENAME = 'receipt.json';

export class DesignTurnInputError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DesignTurnInputError';
  }
}

export interface DesignTurnReferenceInput {
  bytes: Buffer;
  mimeType: string;
}

export interface DesignTurnManifestReference {
  /** Path relative to the turn directory: references/<sha256>.<ext> */
  file: string;
  sha256: string;
  bytes: number;
  mimeType: string;
}

export interface DesignTurnManifest {
  version: 1;
  turnId: string;
  prompt: string;
  canvas: { width: number; height: number };
  /** Design store revisionId (sha256 of the saved design.json) at send time. */
  baselineRevisionId: string;
  /** Content identity of the delivered skill material (P2.1 materializer). */
  skillSourceIdentity: string;
  /**
   * Workdir-relative skill files the user modified since we delivered them;
   * the materializer left them untouched, so the agent may not see the bundled
   * content for these paths.
   */
  skillDrift: string[];
  references: DesignTurnManifestReference[];
  /**
   * The workspace project as it stood when this turn was dispatched. Optional
   * because a `version: 1` manifest written before the field existed still
   * anchors a turn; such a turn is collected the way it always was, without the
   * stale-artifact comparison.
   */
  artifactAtSend?: DesignArtifactAtSend;
  /** Display-only identity of YAML and referenced assets; never a commit/read proof. */
  previewSourceAtSend?: string;
  /** Recorded dispatch fact; consumers must compare with trusted Session workspace paths. */
  artifactWorkdir?: string;
  artworkId?: string;
}

export interface MaterializeDesignTurnInputOptions {
  /** Absolute session workdir (chats/<sessionId>). */
  workdir: string;
  /** Trusted, resolved authoring directory; input/receipt workdir remains stable. */
  artifactWorkdir?: string;
  /** The dispatch's userTurnId — the idempotency key for this turn's input. */
  turnId: string;
  /** SessionMeta.design.artworkId (the design store session key). */
  artworkId: string;
  /** The turn's assembled text prompt (without app-internal scaffolding). */
  prompt: string;
  skillSourceIdentity: string;
  skillDrift?: string[];
  references?: DesignTurnReferenceInput[];
  /** Test seam: defaults to the daemon data root (same root the workdir lives under). */
  dataRoot?: string;
}

const TURN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/**
 * Whether a turn id may be turned into a path segment.
 *
 * Shared with P2.3, which builds the same turn directory when it collects: a
 * turn whose id cannot name a directory can never have a frozen manifest either,
 * so callers treat `false` as "no manifest for this turn" rather than as an
 * error.
 */
export function isDesignTurnId(value: string): boolean {
  return TURN_ID_RE.test(value);
}

const sha256Hex = (bytes: Buffer | Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

const REFERENCE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export function designTurnInputDir(workdir: string, turnId: string): string {
  if (!isDesignTurnId(turnId)) {
    throw new DesignTurnInputError(
      `refusing to materialize design turn input for unsafe turnId: ${JSON.stringify(turnId)}`
    );
  }
  const dir = path.join(path.resolve(workdir), DESIGN_TURN_INPUT_DIRNAME, turnId);
  if (!isWithin(path.resolve(workdir), dir)) {
    throw new DesignTurnInputError(`design turn input dir escapes the workdir: ${dir}`);
  }
  return dir;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Temp + fsync + rename in the target directory (store.ts discipline). */
async function writeFileAtomic(dir: string, filename: string, bytes: Buffer): Promise<void> {
  const temporary = path.join(dir, `.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path.join(dir, filename));
    if (process.platform !== 'win32') {
      const parent = await open(dir, constants.O_RDONLY);
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    }
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/**
 * Write one reference image content-named and verify the landed bytes. An
 * existing file with the same hash is kept as-is (idempotent retry); a
 * corrupted one is atomically replaced.
 */
async function materializeReference(
  referencesDir: string,
  input: DesignTurnReferenceInput
): Promise<DesignTurnManifestReference> {
  const sha256 = sha256Hex(input.bytes);
  const ext = REFERENCE_EXTENSION_BY_MIME[input.mimeType.trim().toLowerCase()] ?? 'img';
  const filename = `${sha256}.${ext}`;
  let existing: Buffer | null = null;
  try {
    existing = await readFile(path.join(referencesDir, filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (existing === null || sha256Hex(existing) !== sha256) {
    await writeFileAtomic(referencesDir, filename, input.bytes);
    const landed = await readFile(path.join(referencesDir, filename));
    if (sha256Hex(landed) !== sha256) {
      throw new DesignTurnInputError(`reference copy failed verification: ${filename}`);
    }
  }
  return {
    file: `references/${filename}`,
    sha256,
    bytes: input.bytes.byteLength,
    mimeType: input.mimeType,
  };
}

/**
 * The manifest already frozen for this turn, when it is one this build can
 * honor: version 1, this turn's own id, and a real sha256 baseline.
 *
 * Anything else — a truncated write, a hand-edited file, another turn's
 * manifest — is not this turn's frozen input, so it is replaced rather than
 * trusted. The remaining fields are read as this build wrote them: the manifest
 * lives in the agent's own workspace, and a tampered one changes only what the
 * agent was told, never what the store accepts.
 */
export async function readFrozenManifest(
  turnDir: string,
  turnId: string
): Promise<DesignTurnManifest | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(turnDir, DESIGN_TURN_MANIFEST_FILENAME), 'utf8'));
  } catch {
    return undefined;
  }
  const manifest = parsed as Partial<DesignTurnManifest> | null;
  if (!manifest || typeof manifest !== 'object') return undefined;
  if (manifest.version !== 1 || manifest.turnId !== turnId) return undefined;
  if (
    typeof manifest.baselineRevisionId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.baselineRevisionId)
  ) {
    return undefined;
  }
  return manifest as DesignTurnManifest;
}

export async function materializeDesignTurnInput(
  opts: MaterializeDesignTurnInputOptions
): Promise<DesignTurnManifest> {
  const workdir = path.resolve(opts.workdir);
  const dataRoot = opts.dataRoot ?? getMollyDataDir();
  const turnDir = designTurnInputDir(workdir, opts.turnId);

  // Frozen input is written once. A re-dispatch of the same turn — the same
  // userTurnId set up again after a restart — returns what the agent was already
  // given, so it cannot be re-anchored to a baseline that moved in between.
  const frozen = await readFrozenManifest(turnDir, opts.turnId);
  if (frozen) {
    if (frozen.artworkId !== undefined && frozen.artworkId !== opts.artworkId) {
      throw new DesignTurnInputError('frozen design input belongs to another artwork');
    }
    if (
      frozen.artifactWorkdir !== undefined &&
      frozen.artifactWorkdir !== path.resolve(opts.artifactWorkdir ?? workdir)
    ) {
      throw new DesignTurnInputError(
        'design workspace changed since dispatch; frozen input and drafts were preserved'
      );
    }
    const references = readDesignElementReferences(frozen.prompt);
    if (references.length)
      validateDesignElementReferences(
        references,
        opts.artworkId,
        await designOperation(
          dataRoot,
          { operation: 'read', sessionId: opts.artworkId },
          { projection: 'verify' }
        )
      );
    return frozen;
  }

  // The baseline is read through the single design committer: a missing or
  // corrupt canvas fails the dispatch here rather than anchoring the turn to
  // an unreadable baseline.
  let baseline: Awaited<ReturnType<typeof designOperation>>;
  try {
    baseline = await designOperation(
      dataRoot,
      { operation: 'read', sessionId: opts.artworkId },
      { projection: 'verify' }
    );
  } catch (error) {
    throw new DesignTurnInputError(
      `design baseline unreadable for artwork ${opts.artworkId}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  validateDesignElementReferences(
    readDesignElementReferences(opts.prompt),
    opts.artworkId,
    baseline
  );

  const artifactAtSend = artifactAtSendRecord(
    await readDesignArtifact(opts.artifactWorkdir ?? workdir)
  );
  let previewSourceAtSend: string | undefined;
  if (artifactAtSend.status === 'present') {
    try {
      previewSourceAtSend = snapshotIdentity(
        collectAuthoring(opts.artifactWorkdir ?? workdir, { referencedOnly: true })
      );
    } catch {
      // An invalid inherited draft does not block dispatch or acquire display authority.
    }
  }

  const referencesDir = path.join(turnDir, 'references');
  await mkdir(referencesDir, { recursive: true });

  // Dedupe by content name: the same image attached twice lands once.
  const references: DesignTurnManifestReference[] = [];
  const seenFiles = new Set<string>();
  for (const input of opts.references ?? []) {
    const reference = await materializeReference(referencesDir, input);
    if (seenFiles.has(reference.file)) continue;
    seenFiles.add(reference.file);
    references.push(reference);
  }

  const manifest: DesignTurnManifest = {
    version: 1,
    turnId: opts.turnId,
    prompt: opts.prompt,
    canvas: { width: baseline.doc.canvas.width, height: baseline.doc.canvas.height },
    baselineRevisionId: baseline.revisionId,
    skillSourceIdentity: opts.skillSourceIdentity,
    skillDrift: [...(opts.skillDrift ?? [])].sort(),
    references,
    artifactAtSend,
    ...(previewSourceAtSend ? { previewSourceAtSend } : {}),
    ...(opts.artifactWorkdir === undefined
      ? {}
      : { artifactWorkdir: path.resolve(opts.artifactWorkdir), artworkId: opts.artworkId }),
  };
  await writeFileAtomic(
    turnDir,
    DESIGN_TURN_MANIFEST_FILENAME,
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  );
  return manifest;
}

/**
 * Where this turn's collection receipt lives: beside its manifest, under the
 * same turn key, so one turn's directory holds everything that is about it.
 */
export function designTurnReceiptFile(workdir: string, turnId: string): string {
  return path.join(designTurnInputDir(workdir, turnId), DESIGN_TURN_RECEIPT_FILENAME);
}

/**
 * Record the verdict this turn's collection reached, before it is stamped on
 * the history entry.
 *
 * The two effects of one turn — the design store write (or the decision that
 * there was nothing to write) and the history stamp — are durable
 * independently, and either can be lost to a crash. The receipt is the record
 * that makes the pair recoverable: a collection that finds one stamps it
 * instead of deciding again, so a turn never commits twice and never turns its
 * own already-committed work into a conflict.
 *
 * It is the same payload the entry carries, by construction: `./turn-outcome.ts`
 * stamps what it wrote here.
 *
 * Like the manifest, this file is written into the agent's own workspace, so it
 * is app bookkeeping by convention, not by isolation. `./turn-outcome.ts` states
 * what that costs and why it is bounded.
 */
export async function writeDesignTurnReceipt(
  workdir: string,
  turnId: string,
  outcome: DesignTurnOutcome
): Promise<void> {
  await writeFileAtomic(
    designTurnInputDir(workdir, turnId),
    DESIGN_TURN_RECEIPT_FILENAME,
    Buffer.from(`${JSON.stringify(outcome, null, 2)}\n`, 'utf8')
  );
}

/**
 * The receipt this turn already has, if any.
 *
 * `undefined` for every reason there is no usable one: none was written, it is
 * unreadable or corrupt, it does not match the payload this build can render, or
 * the turnId cannot name a turn directory. A missing receipt only means the
 * collection has to decide for itself, which is always still possible.
 */
export async function readDesignTurnReceipt(
  workdir: string,
  turnId: string
): Promise<DesignTurnOutcome | undefined> {
  if (!isDesignTurnId(turnId)) return undefined;
  let bytes: string;
  try {
    bytes = await readFile(designTurnReceiptFile(workdir, turnId), 'utf8');
  } catch {
    return undefined;
  }
  try {
    return sanitizeDesignTurnOutcome(JSON.parse(bytes));
  } catch {
    return undefined;
  }
}
