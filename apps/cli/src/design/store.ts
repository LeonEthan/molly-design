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

import {
  sniffStaticV1ImageMime,
  sniffStaticV1FontMime,
  staticV1UnregisteredFontFamilies,
} from '../../../../packages/design-bento/vendor/packages/contracts/src/static-v1';
import { createVisualDocumentKernel } from '../../../../packages/design-bento/vendor/packages/kernel/src/kernel';
import type {
  BentoDocV4,
  VisualCommandV4,
} from '../../../../packages/design-bento/vendor/packages/contracts/src/index';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { withDesignLock, type DesignLockTiming } from './lock';
import { ensureCurrentProjection } from './current-projection';

export const designId = z.string().uuid();
export const designSize = z.number().int().min(1).max(4096);
const bounds = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().positive(),
  z.number().positive(),
]);
const documentSchema = z
  .object({
    schemaVersion: z.literal(4),
    canvas: z.object({ width: designSize, height: designSize }).strict(),
    diagnostics: z.array(z.unknown()).max(1000).default([]),
    background: z.record(z.string(), z.unknown()),
    fonts: z
      .array(
        z
          .object({ family: z.string().min(1), src: z.string().regex(/^asset:[a-f0-9]{64}$/) })
          .passthrough()
      )
      .max(100)
      .optional(),
    elements: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            kind: z.enum(['text', 'shape', 'line', 'image', 'icon', 'table', 'chart']),
            bounds,
            zIndex: z.number().int().nonnegative(),
          })
          .passthrough()
      )
      .max(2000),
  })
  .strict();
export const designInput = z
  .object({
    doc: z
      .union([z.string().max(32 * 1024 * 1024), documentSchema])
      .transform((value) =>
        documentSchema.parse(typeof value === 'string' ? JSON.parse(value) : value)
      ),
    assets: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.string().max(32 * 1024 * 1024)),
  })
  .strict();
export const designAssociation = z
  .object({
    sessionId: designId,
    name: z.string().trim().min(1).max(200),
    userId: z.string().min(1).max(200),
    machineId: z.string().min(1).max(200),
    createdAt: z.string().datetime(),
  })
  .strict();
const savedSchema = designInput.extend({ association: designAssociation });
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
  z.object({ operation: z.literal('read'), sessionId: designId }).strict(),
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
  const directory = path.join(dataRoot, 'chats', artworkId);
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink())
    throw Error('Design workspace cannot be a symlink');
  return directory;
}

async function candidatesDirectory(dataRoot: string, artworkId: string): Promise<string> {
  const directory = path.join(
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
  const file = path.join(await candidatesDirectory(dataRoot, id), `${candidate}.json`);
  const parsed = await readCandidateFile(file);
  if (!parsed) throw Error('Design candidate not found');
  if (parsed.artworkId !== id || parsed.candidateId !== candidate)
    throw Error('Design candidate identity mismatch');
  return { candidate: parsed, file };
}

/**
 * Whether the store could write this document and its assets.
 *
 * The rules are the ones a write applies (`designInput` plus `validateAssets`:
 * schema, kernel replay, asset integrity), so the answer is exactly "a save of
 * this content would be accepted". The intake is the fail-closed gate for a
 * *project* and the two do not cover the same vocabulary — the store bounds an
 * element id the intake leaves free — which is why a caller deciding whether a
 * document is usable has to ask this one too.
 */
export function acceptsDesignContent(raw: unknown): boolean {
  try {
    validateAssets(designInput.parse(raw));
    return true;
  } catch {
    return false;
  }
}

function validateAssets(content: z.output<typeof designInput>) {
  if (new Set(content.doc.elements.map((e) => e.id)).size !== content.doc.elements.length)
    throw Error('Duplicate element IDs');
  const kernel = createVisualDocumentKernel({
    schemaVersion: 4,
    canvas: content.doc.canvas,
    background: { type: 'solid', color: '#ffffff' },
    diagnostics: [],
    elements: [],
  });
  const commands: VisualCommandV4[] = [
    {
      type: 'setBackground',
      background: content.doc.background as unknown as BentoDocV4['background'],
    },
    ...(content.doc.fonts ?? []).map((font) => ({
      type: 'addFontRegistration' as const,
      font: font as unknown as NonNullable<BentoDocV4['fonts']>[number],
    })),
    ...content.doc.elements.map((element) => ({
      type: 'createElement' as const,
      element: element as unknown as BentoDocV4['elements'][number],
    })),
  ];
  const checked = kernel.apply({
    batchId: 'validate',
    actor: 'design-service',
    baseRevision: 0,
    commands,
  });
  if (!checked.ok) throw Error(checked.error.message);
  const missingFonts = staticV1UnregisteredFontFamilies(
    content.doc.elements,
    (content.doc.fonts ?? []).map((font) => font.family)
  );
  if (missingFonts.length) throw Error('Register required fonts: ' + missingFonts.join(', '));
  const required = new Set<string>();
  const walk = (value: unknown, depth = 0): void => {
    if (depth > 40) throw Error('Document nesting exceeds limit');
    if (typeof value === 'string' && value.startsWith('asset:')) required.add(value.slice(6));
    if (Array.isArray(value)) value.forEach((v) => walk(v, depth + 1));
    else if (value && typeof value === 'object')
      for (const [key, v] of Object.entries(value)) {
        if (
          ['src', 'href', 'url'].includes(key) &&
          typeof v === 'string' &&
          !/^asset:[a-f0-9]{64}$/.test(v)
        )
          throw Error('External document resources are unsupported');
        walk(v, depth + 1);
      }
  };
  walk(content.doc);
  const assets: Record<string, string> = {};
  for (const key of required) {
    const uri = content.assets[key];
    const match = uri?.match(
      /^data:(image\/(?:png|jpeg|gif)|font\/(?:ttf|otf|woff|woff2));base64,([A-Za-z0-9+/]+={0,2})$/
    );
    if (!match?.[2]) throw Error('Missing or unsupported asset: ' + key);
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 16 * 1024 * 1024) throw Error('Asset exceeds 16 MiB');
    if ((sniffStaticV1ImageMime(bytes) ?? sniffStaticV1FontMime(bytes)) !== match[1])
      throw Error('Asset MIME does not match its bytes');
    if (digest(bytes) !== key) throw Error('Asset checksum mismatch: ' + key);
    assets[key] = uri as string;
  }
  return assets;
}

export interface DesignOperationOptions {
  /** Timing seams for the write lock; see `./lock.ts`. */
  lock?: DesignLockTiming;
  /** Dispatch only verifies; save/reopen recover the current representation. */
  projection?: 'verify';
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
  const directory = path.join(dataRoot, 'chats', id);
  if (request.operation !== 'read') await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink())
    throw Error('Design workspace cannot be a symlink');
  const current = path.join(directory, 'design.json');
  const read = async (): Promise<DesignPayload> => {
    const file = await open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw Error('Invalid design file');
      const bytes = await file.readFile();
      const saved = savedSchema.parse(JSON.parse(bytes.toString('utf8')));
      if (saved.association.sessionId !== id) throw Error('Design association mismatch');
      validateAssets(saved);
      return { ...saved, revisionId: digest(bytes) };
    } finally {
      await file.close();
    }
  };
  if (request.operation === 'read') {
    const payload = await read();
    try {
      await ensureCurrentProjection(directory, payload, async () => {}, true);
      return payload;
    } catch (error) {
      if (options?.projection === 'verify') throw error;
    }
    return withDesignLock(directory, options?.lock ?? {}, async (assertHeld) => {
      const latest = await read();
      await ensureCurrentProjection(directory, latest, assertHeld);
      return latest;
    });
  }

  // Everything from here writes, and the baseline this write is checked against
  // is read inside the lock: a caller cannot compare a revision it read before
  // another writer landed.
  return await withDesignLock(directory, options?.lock ?? {}, async (assertHeld) => {
    let previous: DesignPayload | undefined;
    try {
      previous = await read();
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    if (request.operation === 'create' && previous) {
      if (JSON.stringify(previous.association) !== JSON.stringify(request.association))
        throw Error('Design already exists');
      await ensureCurrentProjection(directory, previous, assertHeld);
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
      association:
        request.operation === 'create'
          ? request.association
          : { ...previous?.association, ...(request.name ? { name: request.name } : {}) },
    });
    const bytes = JSON.stringify(saved);
    if (bytes.length > 64 * 1024 * 1024) throw Error('Design exceeds 64 MiB');
    if (request.operation === 'save' && previous?.revisionId !== request.baseRevisionId) {
      // Lost acknowledgement is safely retryable when the requested bytes already landed.
      if (previous?.revisionId === digest(bytes)) {
        await ensureCurrentProjection(directory, previous, assertHeld);
        return previous;
      }
      throw Error('DESIGN_CONFLICT');
    }
    if (request.operation === 'create') {
      const pending = path.join(dataRoot, 'design-pending');
      await mkdir(pending, { recursive: true });
      const marker = await open(path.join(pending, id), 'a', 0o600);
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
    await ensureCurrentProjection(directory, payload, assertHeld);
    return payload;
  });
}

/** Only unfinished associations are repaired; acknowledged/deleted sessions are never rediscovered. */
export async function pendingDesigns(dataRoot: string): Promise<DesignPayload[]> {
  const directory = path.join(dataRoot, 'design-pending');
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
export async function acknowledgeDesign(dataRoot: string, raw: unknown): Promise<void> {
  await unlink(path.join(dataRoot, 'design-pending', designId.parse(raw))).catch((error) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  });
}
