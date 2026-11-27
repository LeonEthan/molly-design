/**
 * The single design committer.
 *
 * Canonical `design.json` writes go through `designOperation` in this module.
 * Historical conflict candidates remain readable, with no candidate writer.
 * The one exception to canonical storage is the
 * P0 fixed sample, which `./sample.ts` links into `chats/molly-p0/` — an id that
 * is not a design session, holding the raw fixture rather than a saved design,
 * created once and never replaced.
 *
 * Two callers, one writer: the Electron-owned CLI worker (`cli/design.js`)
 * forwards UI save/read/create requests over stdin, and the daemon calls
 * `designOperation` in-process for post-turn collection (P2.3,
 * `./turn-outcome.ts`). What a caller has is a baseline — a sha256 revision id
 * it believes is current — and a save whose baseline moved gets
 * `DESIGN_CONFLICT` instead of overwriting someone else's work; the daemon turns
 * that into durable conflict diagnostics. The comparison and the write are one step
 * because they happen under the artwork's own write lock (`./lock.ts`): two
 * callers that read the same revision cannot both land, and a caller that cannot
 * get the lock in time is told `DESIGN_BUSY` rather than waiting forever.
 *
 * Healthy reads take no lock: bytes become visible whole (`publishBytesAtomic`).
 * Projection repair alone acquires the lock and re-reads latest canonical; the
 * returned complete revision is the baseline checked by the next save.
 *
 * `design.json` holds embedded base64 assets so a confirmed save has no
 * partially committed asset table; the per-file digest of exactly those bytes
 * is the revisionId. A lost reply is safely retryable when the requested bytes
 * already landed.
 *
 * Historical candidate files remain readable through `readDesignCandidate`,
 * including embedded assets. There are no candidate approval or deletion APIs.
 */

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveIsolatedDataPath } from '@molly/shared/node/installation-profile';
import { z } from 'zod';
import { designAssociation, designId, designInput, designSize, validateAssets } from './content';
export {
  acceptsDesignContent,
  designAssociation,
  designId,
  designInput,
  designSize,
} from './content';
import { DESIGN_LOCK_FILENAME, withDesignLock, type DesignLockTiming } from './lock';
import { ensureCurrentProjection } from './current-projection';

const editingContext = z
  .object({
    baseVersionId: z.string().regex(/^[a-f0-9]{40}$/),
    actionId: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const savedSchema = designInput.extend({
  association: designAssociation,
  editing: editingContext.optional(),
});
export const designRequest = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('create'),
      association: designAssociation,
      width: designSize.default(800),
      height: designSize.default(600),
      copy: designInput.optional(),
    })
    .strict(),
  z
    .object({ operation: z.literal('read'), sessionId: designId, readOnly: z.boolean().optional() })
    .strict(),
  z
    .object({
      operation: z.literal('save'),
      sessionId: designId,
      baseRevisionId: z.string().regex(/^[a-f0-9]{64}$/),
      content: designInput,
      name: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
]);
export type DesignRequest = z.input<typeof designRequest>;
export type DesignPayload = z.output<typeof savedSchema> & { revisionId: string };
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export const DESIGN_CANDIDATES_DIRNAME = 'candidates';

const candidateEnvelope = z
  .object({
    version: z.literal(1),
    /** sha256 of the canonical content bytes — addresses the design, not the envelope. */
    candidateId: z.string().regex(/^[a-f0-9]{64}$/),
    artworkId: designId,
    turnId: z.string().min(1).max(200),
    /** Historical dispatch baseline; this envelope remains read-only. */
    baselineRevisionId: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.string().datetime(),
    content: designInput,
  })
  .strict();
export type DesignCandidate = z.output<typeof candidateEnvelope>;

/**
 * Content-addressed without depending on key insertion order: the id must be
 * stable across processes and reloads for the same produced design.
 */
export const canonicalContentBytes = (content: {
  doc: unknown;
  assets: Record<string, string>;
}): Uint8Array => {
  const assets: Record<string, string> = {};
  for (const key of Object.keys(content.assets).sort()) {
    assets[key] = content.assets[key] as string;
  }
  return Buffer.from(JSON.stringify({ doc: content.doc, assets }), 'utf8');
};

/** Temp file + fsync + rename + parent fsync: the only way bytes become visible. */
async function publishBytesAtomic(directory: string, target: string, bytes: string): Promise<void> {
  const temporary = path.join(directory, '.' + randomUUID() + '.tmp');
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
    if (process.platform !== 'win32') {
      const parent = await open(directory, constants.O_RDONLY);
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

/** The candidate itself cannot be a symlink, and a missing file is not an error. */
async function readCandidateFile(file: string): Promise<DesignCandidate | null> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw Error('Invalid design candidate');
    const parsed = candidateEnvelope.parse(JSON.parse((await handle.readFile()).toString('utf8')));
    if (digest(canonicalContentBytes(parsed.content)) !== parsed.candidateId)
      throw Error('Design candidate checksum mismatch');
    return parsed;
  } finally {
    await handle.close();
  }
}

async function designChatDirectory(dataRoot: string, artworkId: string): Promise<string> {
  const directory = resolveIsolatedDataPath(dataRoot, 'chats', artworkId);
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink())
    throw Error('Design workspace cannot be a symlink');
  return directory;
}

async function candidatesDirectory(dataRoot: string, artworkId: string): Promise<string> {
  const directory = resolveIsolatedDataPath(
    await designChatDirectory(dataRoot, artworkId),
    DESIGN_CANDIDATES_DIRNAME
  );
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink())
    throw Error('Design candidates directory cannot be a symlink');
  return directory;
}

/** Read one candidate, verifying that its content still hashes to its id. */
export async function readDesignCandidate(
  dataRoot: string,
  artworkId: unknown,
  candidateId: unknown
): Promise<{ candidate: DesignCandidate; file: string }> {
  const id = designId.parse(artworkId);
  const candidate = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(candidateId);
  const file = resolveIsolatedDataPath(
    await candidatesDirectory(dataRoot, id),
    `${candidate}.json`
  );
  const parsed = await readCandidateFile(file);
  if (!parsed) throw Error('Design candidate not found');
  if (parsed.artworkId !== id || parsed.candidateId !== candidate)
    throw Error('Design candidate identity mismatch');
  return { candidate: parsed, file };
}

export class DesignProjectionPendingError extends Error {
  readonly code = 'DESIGN_PROJECTION_PENDING';
  constructor(
    readonly revisionId: string,
    cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

async function publishSavedProjection(
  directory: string,
  payload: DesignPayload,
  assertHeld: () => Promise<void>
) {
  try {
    await ensureCurrentProjection(directory, payload, assertHeld);
  } catch (cause) {
    throw new DesignProjectionPendingError(payload.revisionId, cause);
  }
}

function withArtworkLock<T>(
  directory: string,
  timing: DesignLockTiming,
  work: (assertHeld: () => Promise<void>) => Promise<T>
) {
  resolveIsolatedDataPath(directory, DESIGN_LOCK_FILENAME);
  return withDesignLock(directory, timing, work);
}

async function readCanonical(directory: string, id: string): Promise<DesignPayload> {
  const current = resolveIsolatedDataPath(directory, 'design.json');

  const file = await open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw Error('Invalid design file');
    const bytes = await file.readFile();
    if (Buffer.byteLength(bytes, 'utf8') > 64 * 1024 * 1024) throw Error('Invalid design file');
    const saved = savedSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (saved.association.sessionId !== id) throw Error('Design association mismatch');
    validateAssets(saved);
    return { ...saved, revisionId: digest(bytes) };
  } finally {
    await file.close();
  }
}

export interface DesignOperationOptions {
  /** Timing seams for the write lock; see `./lock.ts`. */
  lock?: DesignLockTiming;
  /** Dispatch only verifies; save/reopen recover the current representation. */
  projection?: 'verify';
  /** History owns this context; ordinary saves cannot choose or rebase it. */
  editing?: z.output<typeof editingContext>;
}

/**
 * Read/create/save the current canvas. Callers pass the revisionId they believe
 * is current as `baseRevisionId`; a save whose baseline moved is rejected with
 * `DESIGN_CONFLICT` rather than overwriting someone else's work, and a write
 * that cannot take the artwork's lock inside its deadline is rejected with
 * `DESIGN_BUSY`.
 */
export async function designOperation(
  dataRoot: string,
  raw: unknown,
  options?: DesignOperationOptions
): Promise<DesignPayload> {
  const request = designRequest.parse(raw);
  const id = request.operation === 'create' ? request.association.sessionId : request.sessionId;
  const directory = resolveIsolatedDataPath(dataRoot, 'chats', id);
  if (request.operation !== 'read') await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink())
    throw Error('Design workspace cannot be a symlink');
  const current = resolveIsolatedDataPath(directory, 'design.json');
  if (request.operation === 'read') {
    const payload = await readCanonical(directory, id);
    try {
      await ensureCurrentProjection(directory, payload, async () => {}, true);
      return payload;
    } catch (error) {
      if (request.readOnly || options?.projection === 'verify') throw error;
    }
    return withArtworkLock(directory, options?.lock ?? {}, async (assertHeld) => {
      const latest = await readCanonical(directory, id);
      await ensureCurrentProjection(directory, latest, assertHeld);
      return latest;
    });
  }

  // Everything from here writes, and the baseline this write is checked against
  // is read inside the lock: a caller cannot compare a revision it read before
  // another writer landed.
  return await withArtworkLock(directory, options?.lock ?? {}, async (assertHeld) => {
    let previous: DesignPayload | undefined;
    try {
      previous = await readCanonical(directory, id);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    if (request.operation === 'create' && previous) {
      if (JSON.stringify(previous.association) !== JSON.stringify(request.association))
        throw Error('Design already exists');
      await publishSavedProjection(directory, previous, assertHeld);
      return previous;
    }
    const content =
      request.operation === 'create'
        ? (request.copy ?? {
            doc: {
              schemaVersion: 4 as const,
              canvas: { width: request.width, height: request.height },
              background: { type: 'solid', color: '#ffffff' },
              diagnostics: [],
              elements: [],
            },
            assets: {},
          })
        : request.content;
    const saved = savedSchema.parse({
      ...content,
      assets: validateAssets(content),
      ...(request.operation === 'save' && (options?.editing ?? previous?.editing)
        ? { editing: options?.editing ?? previous?.editing }
        : {}),
      association:
        request.operation === 'create'
          ? request.association
          : { ...previous?.association, ...(request.name ? { name: request.name } : {}) },
    });
    const bytes = JSON.stringify(saved);
    if (Buffer.byteLength(bytes, 'utf8') > 64 * 1024 * 1024) throw Error('Design exceeds 64 MiB');
    if (request.operation === 'save' && previous?.revisionId !== request.baseRevisionId) {
      // Lost acknowledgement is safely retryable when the requested bytes already landed.
      if (previous?.revisionId === digest(bytes)) {
        await publishSavedProjection(directory, previous, assertHeld);
        return previous;
      }
      throw Error('DESIGN_CONFLICT');
    }
    if (request.operation === 'create') {
      const pending = resolveIsolatedDataPath(dataRoot, 'design-pending');
      await mkdir(pending, { recursive: true });
      const marker = await open(resolveIsolatedDataPath(pending, id), 'a', 0o600);
      try {
        await marker.sync();
      } finally {
        await marker.close();
      }
      if (process.platform !== 'win32') {
        const parent = await open(pending, constants.O_RDONLY);
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      }
    }
    // The last thing before bytes become visible. Everything above decided what
    // to write while holding the lock; if that lock is no longer ours, another
    // writer may already be deciding against a canvas this write has not landed
    // on, and the refusal preserves the draft instead of losing a revision (`./lock.ts`).
    await assertHeld();
    await publishBytesAtomic(directory, current, bytes);
    const payload = { ...saved, revisionId: digest(bytes) };
    await publishSavedProjection(directory, payload, assertHeld);
    return payload;
  });
}

/** Only unfinished associations are repaired; acknowledged/deleted sessions are never rediscovered. */
export async function pendingDesigns(dataRoot: string): Promise<DesignPayload[]> {
  const directory = resolveIsolatedDataPath(dataRoot, 'design-pending');
  await mkdir(directory, { recursive: true });
  const results: DesignPayload[] = [];
  for (const id of await readdir(directory)) {
    if (!designId.safeParse(id).success) continue;
    try {
      results.push(await designOperation(dataRoot, { operation: 'read', sessionId: id }));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  return results;
}
function isMissing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export const pendingOptions = z.object({
  readOnly: z.boolean().optional(),
  cursor: designId.optional(),
  limit: z.number().int().positive().default(100),
});

export async function pendingDesignAssociations(
  dataRoot: string,
  options: z.input<typeof pendingOptions> = {}
) {
  const { cursor, limit, readOnly } = pendingOptions.parse(options);
  const pending = resolveIsolatedDataPath(dataRoot, 'design-pending');
  if (!readOnly) await mkdir(pending, { recursive: true });
  const names = await readdir(pending).catch((error) => {
    if (isMissing(error)) return [];
    throw error;
  });
  const ids = names
    .filter((id) => designId.safeParse(id).success && (!cursor || id > cursor))
    .sort();
  const items: (Pick<DesignPayload, 'association' | 'revisionId'> & {
    sessionId: string;
    projectionStale: boolean;
  })[] = [];
  for (const sessionId of ids.slice(0, limit)) {
    const directory = resolveIsolatedDataPath(dataRoot, 'chats', sessionId);
    const payload = await readExistingCanonical(directory, sessionId);
    if (!payload) continue;
    let projectionStale = false;
    try {
      await ensureCurrentProjection(directory, payload, async () => {}, true);
    } catch {
      projectionStale = true;
    }
    items.push({
      sessionId,
      association: payload.association,
      revisionId: payload.revisionId,
      projectionStale,
    });
  }
  return { items, nextCursor: ids.length > limit ? ids[limit - 1] : null };
}

async function hasCanonical(directory: string) {
  try {
    if ((await lstat(directory)).isSymbolicLink())
      throw Error('Design workspace cannot be a symlink');
    await lstat(resolveIsolatedDataPath(directory, 'design.json'));
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function readExistingCanonical(directory: string, id: string) {
  if (!(await hasCanonical(directory))) return undefined;
  try {
    return await readCanonical(directory, id);
  } catch (error) {
    if (!isMissing(error)) throw error;
    return undefined;
  }
}

export async function repairDesignProjection(dataRoot: string, raw: unknown) {
  const sessionId = designId.parse(raw);
  const directory = resolveIsolatedDataPath(dataRoot, 'chats', sessionId);
  if (!(await hasCanonical(directory))) return { sessionId, missing: true };
  return withArtworkLock(directory, {}, async (assertHeld) => {
    const latest = await readExistingCanonical(directory, sessionId);
    if (!latest) return { sessionId, missing: true };
    await ensureCurrentProjection(directory, latest, assertHeld);
    return { sessionId, revisionId: latest.revisionId };
  });
}

export async function acknowledgeDesign(
  dataRoot: string,
  raw: unknown,
  options: { verifyProjection?: boolean } = {}
): Promise<void> {
  const id = designId.parse(raw);
  const clear = () =>
    unlink(resolveIsolatedDataPath(dataRoot, 'design-pending', id)).catch((error) => {
      if (!isMissing(error)) throw error;
    });
  if (!options.verifyProjection) return clear();
  const directory = resolveIsolatedDataPath(dataRoot, 'chats', id);
  if (!(await hasCanonical(directory))) return clear();
  await withArtworkLock(directory, {}, async (assertHeld) => {
    const latest = await readExistingCanonical(directory, id);
    if (latest) await ensureCurrentProjection(directory, latest, assertHeld);
    await assertHeld();
    await clear();
  });
}
