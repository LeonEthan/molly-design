import { LoroDoc } from 'loro-crdt';
import { createHistoryWriter } from '@molly/shared';
import { createLoroSessionData } from '@molly/shared/session-data';
/**
 * P2.3 classification matrix: a synthetic YAML artwork left in a session
 * workdir is collected, classified, and committed through the single committer.
 * Every fixture is synthetic; no agent runs and no network is touched.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionHistoryInput, SessionId, SessionMeta } from '@molly/shared';
import { sanitizeDesignTurnOutcome, type DesignTurnOutcome } from '@molly/shared';
import { DESIGN_ARTIFACT_ENTRY, readDesignArtifact } from './artifact';
import { DESIGN_LOCK_FILENAME } from './lock';
import {
  writeHistoricalCandidate,
  listHistoricalCandidateFiles,
} from './historical-candidate.fixture';
import { designOperation, readDesignCandidate } from './store';
import {
  collectDesignTurnOutcome,
  recordDesignTurnTerminalOutcome,
  type DesignTurnOutcomeSession,
} from './turn-outcome';
import {
  DESIGN_TURN_INPUT_DIRNAME,
  DESIGN_TURN_MANIFEST_FILENAME,
  materializeDesignTurnInput,
  writeDesignTurnReceipt,
} from './turn-input';

function syntheticPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const d = y * (stride + 1) + 1 + x * 3;
      raw[d] = rgb[0];
      raw[d + 1] = rgb[1];
      raw[d + 2] = rgb[2];
    }
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ])
  );
}

const enc = new TextEncoder();

const MANIFEST = `format: molly-canvas/1
title: Turn outcome test
size: [320, 200]
`;

const PAGE = `background:
  type: solid
  color: "#FFFFFF"
elements:
  - id: title
    kind: text
    bounds: [10, 10, 200, 40]
    text:
      paragraphs:
        - runs:
            - text: "Hello"
              fontSize: 24
  - id: band
    kind: shape
    bounds: [10, 60, 100, 100]
    shapeName: rect
    fill:
      type: solid
      color: "#1F6B8A"
  - id: photo
    kind: image
    bounds: [120, 60, 64, 64]
    src: media/pic.png
    fit: cover
`;

/** The page above, but pointing at a media file that was never written. */
const BROKEN_PAGE = PAGE.replace('media/pic.png', 'media/missing.png');

/** The page above, restyled: one real edit an agent could have made. */
const RESTYLED_PAGE = PAGE.replace('#1F6B8A', '#7B6B8A');

/**
 * The page above with an element id the store refuses and the intake does not
 * bound (its schema caps an id at 200 characters; the authoring validator only
 * asks for a non-empty unique string). A project this far apart from the store
 * is one neither gate can turn into a canvas write.
 */
const OVERLONG_ID_PAGE = PAGE.replace('id: title', `id: ${'t'.repeat(250)}`);

interface ProjectFiles {
  /** The project's manifest; defaults to `MANIFEST`. */
  manifest?: string;
  /** Also write an unreferenced `media/extra.png` so the digest differs. */
  extraMedia?: boolean;
}

const files = (page: string, options: ProjectFiles = {}): Map<string, Uint8Array> => {
  const entries: [string, Uint8Array][] = [
    [DESIGN_ARTIFACT_ENTRY, enc.encode((options.manifest ?? MANIFEST) + page)],
    ['media/pic.png', syntheticPng(8, 8, [31, 107, 138])],
  ];
  if (options.extraMedia) entries.push(['media/extra.png', syntheticPng(4, 4, [123, 107, 138])]);
  return new Map(entries);
};

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

type Harness = {
  root: string;
  sessionId: string;
  turnId: string;
  workdir: string;
  readonly history: SessionHistoryInput[];
  append: (entry: SessionHistoryInput) => void;
  sessionDoc: DesignTurnOutcomeSession;
  /** Drop the recorded outcome so a second collection is not short-circuited. */
  forgetOutcome: () => void;
};

function createHarness(
  options: {
    /** Absent means "not a design session". */
    design?: boolean;
    page?: string | null;
    /** Write the P2.2 manifest (default true). */
    manifest?: boolean;
    /** Use this baseline instead of the live revision. */
    baselineRevisionId?: string;
    /** Omit the user turn entry, as a rewound turn would. */
    history?: boolean;
    metaThrows?: boolean;
  } = {}
): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'molly-turn-outcome-'));
  roots.push(root);
  const sessionId = crypto.randomUUID();
  const turnId = 'turn-outcome-1';
  const workdir = path.join(root, 'chats', sessionId);
  mkdirSync(workdir, { recursive: true });

  const initialEntry: SessionHistoryInput = {
    id: turnId,
    role: 'user',
    items: [{ type: 'text', text: 'design a poster' }],
    timestamp: '2026-09-10T00:00:00.000Z',
    status: 'handled',
    fileDiff: [],
  };
  const history = options.history === false ? [] : [initialEntry];
  const meta = {
    id: sessionId as SessionId,
    machineId: 'test-machine',
    userId: 'local:test',
    createdAt: '2026-09-10T00:00:00.000Z',
    ...(options.design === false
      ? {}
      : { design: { artworkId: sessionId, path: 'design.json' as const } }),
  } as SessionMeta;

  const doc = new LoroDoc();
  const writer = createHistoryWriter(doc);
  for (const entry of history) writer.append(entry);
  const sessionData = createLoroSessionData({ sessionId: sessionId as SessionId, doc, writer });
  const sessionDoc: DesignTurnOutcomeSession = {
    sessionData,
    getMetaState: async () => {
      if (options.metaThrows) throw Error('session doc unavailable');
      return meta;
    },
  };

  return {
    root,
    sessionId,
    turnId,
    workdir,
    get history() {
      return writer.readStored();
    },
    append: (entry) => writer.append(entry),
    sessionDoc,
    forgetOutcome: () => {
      writer.update((entries) => {
        for (const item of entries) delete item.designOutcome;
        return entries;
      });
    },
  };
}

async function createDesign(harness: Harness, options: { width?: number; height?: number } = {}) {
  const created = await designOperation(harness.root, {
    operation: 'create',
    association: {
      sessionId: harness.sessionId,
      name: 'Turn outcome',
      userId: 'local:test',
      machineId: 'test-machine',
      createdAt: '2026-09-10T00:00:00.000Z',
    },
    width: options.width ?? 800,
    height: options.height ?? 600,
  });
  return created;
}

async function writeArtifact(
  harness: Harness,
  page: string | null,
  options: ProjectFiles = {}
): Promise<void> {
  if (page === null) return;
  for (const [rel, bytes] of files(page, options)) {
    const file = path.join(harness.workdir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  }
}

/**
 * The manifest of a turn that was dispatched *before* `artifactAtSend` existed:
 * the same anchor, collected without the stale-project comparison. The
 * multi-turn tests below freeze the real manifest instead (P2.2 writes it).
 */
async function writeManifest(harness: Harness, baselineRevisionId: string): Promise<void> {
  const dir = path.join(harness.workdir, DESIGN_TURN_INPUT_DIRNAME, harness.turnId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, DESIGN_TURN_MANIFEST_FILENAME),
    JSON.stringify(
      {
        version: 1,
        turnId: harness.turnId,
        prompt: 'design a poster',
        canvas: { width: 800, height: 600 },
        baselineRevisionId,
        skillSourceIdentity: 'test',
        skillDrift: [],
        references: [],
      },
      null,
      2
    )
  );
}

/** Freeze this turn's input the way dispatch does, with the workspace as it is now. */
async function freezeTurnInput(harness: Harness): Promise<void> {
  await materializeDesignTurnInput({
    workdir: harness.workdir,
    turnId: harness.turnId,
    artworkId: harness.sessionId,
    prompt: 'design a poster',
    skillSourceIdentity: 'test',
    dataRoot: harness.root,
  });
}

const contextFor = (harness: Harness, now = new Date('2026-09-10T01:00:00.000Z')) => ({
  designNativeTerminal: 'end_turn' as const,
  sessionId: harness.sessionId,
  sessionDoc: harness.sessionDoc,
  turnId: harness.turnId,
  workdir: harness.workdir,
  dataRoot: harness.root,
  now: () => now,
});

const recordedOutcome = (harness: Harness): DesignTurnOutcome | undefined => {
  const entry = harness.history.find((item) => item.id === harness.turnId);
  return sanitizeDesignTurnOutcome(entry?.designOutcome);
};

/** Release the canvas, as a user save between manifest and collection would. */
async function moveBaseline(harness: Harness, revisionId: string): Promise<void> {
  const current = await designOperation(harness.root, {
    operation: 'read',
    sessionId: harness.sessionId,
  });
  await designOperation(harness.root, {
    operation: 'save',
    sessionId: harness.sessionId,
    baseRevisionId: revisionId,
    content: { doc: current.doc, assets: current.assets },
    name: 'Saved while the agent worked',
  });
}

describe('collectDesignTurnOutcome', () => {
  it('keeps legacy manifests without dispatch content evidence on the validated commit path', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await writeManifest(harness, created.revisionId);

    const attempt = await collectDesignTurnOutcome(contextFor(harness));
    expect(attempt.status).toBe('recorded');
    if (attempt.status !== 'recorded') return;
    expect(attempt.outcome).toMatchObject({
      status: 'committed',
      turnId: harness.turnId,
      artworkId: harness.sessionId,
      timestamp: '2026-09-10T01:00:00.000Z',
    });

    const stored = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    // The canvas is the imported document, not the empty canvas it started as.
    expect(stored.revisionId).toBe(attempt.outcome.revisionId);
    expect(stored.revisionId).not.toBe(created.revisionId);
    expect(stored.doc.canvas).toEqual({ width: 320, height: 200 });
    expect(stored.doc.elements).toHaveLength(3);
    expect(recordedOutcome(harness)).toEqual(attempt.outcome);
  });

  it.each(['absent', 'rejected'] as const)(
    'does not infer unchanged contents from %s dispatch evidence',
    async (status) => {
      const harness = createHarness();
      const created = await createDesign(harness);
      await writeManifest(harness, created.revisionId);
      const manifestPath = path.join(
        harness.workdir,
        DESIGN_TURN_INPUT_DIRNAME,
        harness.turnId,
        DESIGN_TURN_MANIFEST_FILENAME
      );
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.artifactAtSend =
        status === 'absent' ? { status } : { status, message: 'snapshot unavailable at dispatch' };
      writeFileSync(manifestPath, JSON.stringify(manifest));
      await writeArtifact(harness, PAGE);
      expect(await collectDesignTurnOutcome(contextFor(harness))).toMatchObject({
        status: 'recorded',
        outcome: { status: 'committed' },
      });
    }
  );

  it('records a commit without creating thumbnail or render scratch files', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await writeManifest(harness, created.revisionId);

    const attempt = await collectDesignTurnOutcome(contextFor(harness));
    expect(attempt.status).toBe('recorded');
    if (attempt.status !== 'recorded') return;
    expect(attempt.outcome).not.toHaveProperty('thumbnail');
    expect(existsSync(path.join(harness.workdir, 'design-thumbnail'))).toBe(false);
    expect(existsSync(path.join(harness.root, 'design-preview-stage'))).toBe(false);
  });

  it('preserves legacy thumbnail files when recording and reopening a turn', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeManifest(harness, created.revisionId);
    await writeArtifact(harness, PAGE);
    const directory = path.join(harness.workdir, 'design-thumbnail');
    mkdirSync(directory);
    const file = path.join(directory, `${'a'.repeat(64)}.png`);
    const bytes = syntheticPng(8, 8, [31, 107, 138]);
    writeFileSync(file, bytes);
    const first = await collectDesignTurnOutcome(contextFor(harness));
    expect(first.status).toBe('recorded');
    expect(await collectDesignTurnOutcome(contextFor(harness))).toEqual({
      status: 'skipped',
      reason: 'already_recorded',
    });
    expect(readdirSync(directory)).toEqual([path.basename(file)]);
    expect(readFileSync(file)).toEqual(Buffer.from(bytes));
    expect(recordedOutcome(harness)).not.toHaveProperty('thumbnail');
  });

  it('does not accept a leftover .pptd as this turn’s artifact', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    writeFileSync(
      path.join(harness.workdir, 'design.pptd'),
      'version: v2\ntitle: Leftover\nsize: [320, 200]\npages:\n  - pages/main.page\n'
    );
    mkdirSync(path.join(harness.workdir, 'pages'), { recursive: true });
    writeFileSync(path.join(harness.workdir, 'pages', 'main.page'), PAGE);
    await writeManifest(harness, created.revisionId);

    expect(await collectDesignTurnOutcome(contextFor(harness))).toEqual({
      status: 'recorded',
      outcome: expect.objectContaining({ status: 'no_artifact' }),
    });
    const stored = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(stored.revisionId).toBe(created.revisionId);
    expect(stored.doc.elements).toHaveLength(0);
    expect(await readDesignArtifact(harness.workdir)).toEqual({ status: 'absent' });
  });

  it('rejects leftover .pptd even when a new design.yaml is also present', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    writeFileSync(path.join(harness.workdir, 'design.pptd'), 'leftover PPTD is not admitted');
    await writeManifest(harness, created.revisionId);

    const attempt = await collectDesignTurnOutcome(contextFor(harness));
    expect(attempt.status).toBe('recorded');
    if (attempt.status !== 'recorded') return;
    expect(attempt.outcome.status).toBe('invalid');
    expect(attempt.outcome.diagnostics?.[0]).toMatchObject({
      code: 'design_collect_rejected',
      message: expect.stringContaining('leftover PPTD'),
    });
    const stored = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(stored.revisionId).toBe(created.revisionId);
  });

  it('reports no_artifact and leaves an existing canvas untouched', async () => {
    const harness = createHarness();
    const created = await createDesign(harness, { width: 640, height: 480 });
    await writeManifest(harness, created.revisionId);

    const attempt = await collectDesignTurnOutcome(contextFor(harness));
    expect(attempt).toEqual({
      status: 'recorded',
      outcome: expect.objectContaining({ status: 'no_artifact' }),
    });
    const stored = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(stored.revisionId).toBe(created.revisionId);
    expect(stored.doc.elements).toHaveLength(0);
  });

  it('does not promote unchanged workspace contents that differ from the canvas', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE, { extraMedia: true });
    await freezeTurnInput(harness);
    const before = await readDesignArtifact(harness.workdir);

    expect(await collectDesignTurnOutcome(contextFor(harness))).toMatchObject({
      status: 'recorded',
      outcome: { status: 'no_artifact' },
    });
    expect(await listHistoricalCandidateFiles(harness.root, harness.sessionId)).toEqual([]);
    expect(await readDesignArtifact(harness.workdir)).toEqual(before);
    const stored = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(stored.revisionId).toBe(created.revisionId);
    expect(stored.doc.elements).toHaveLength(0);
  });

  it('preserves an existing candidate when identical bytes are rewritten after dispatch', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeManifest(harness, created.revisionId);
    await writeArtifact(harness, PAGE);
    await moveBaseline(harness, created.revisionId);
    const saved = await writeHistoricalCandidate(harness.root, {
      artworkId: harness.sessionId,
      turnId: harness.turnId,
      baselineRevisionId: created.revisionId,
      createdAt: '2026-09-11T00:00:00.000Z',
      content: { doc: created.doc, assets: created.assets },
    });
    const first = {
      status: 'recorded' as const,
      outcome: {
        version: 1 as const,
        artworkId: harness.sessionId,
        turnId: harness.turnId,
        status: 'candidate' as const,
        candidateId: saved.candidateId,
        timestamp: '2026-09-11T00:00:00.000Z',
      },
    };
    await writeDesignTurnReceipt(harness.workdir, harness.turnId, first.outcome);
    const receiptPath = path.join(
      harness.workdir,
      DESIGN_TURN_INPUT_DIRNAME,
      harness.turnId,
      'receipt.json'
    );
    const receipt = readFileSync(receiptPath);
    const candidates = await listHistoricalCandidateFiles(harness.root, harness.sessionId);
    const candidate = await readDesignCandidate(
      harness.root,
      harness.sessionId,
      first.outcome.candidateId!
    );
    // Old receipts still restore their historical candidate verdict, even after
    // the dispatch snapshot would otherwise classify these bytes as unchanged.
    await freezeTurnInput(harness);
    harness.forgetOutcome();
    expect(await collectDesignTurnOutcome(contextFor(harness))).toEqual(first);
    // A distinct turn has independent dispatch evidence; merely rewriting the
    // same bytes does not create an explicit resubmission attempt.
    harness.turnId = 'turn-outcome-2';
    harness.append({ ...harness.history[0]!, id: harness.turnId, designOutcome: undefined });
    await freezeTurnInput(harness);
    await writeArtifact(harness, PAGE);
    expect(await collectDesignTurnOutcome(contextFor(harness))).toMatchObject({
      status: 'recorded',
      outcome: { status: 'no_artifact' },
    });
    expect(await listHistoricalCandidateFiles(harness.root, harness.sessionId)).toEqual(candidates);
    expect(
      await readDesignCandidate(harness.root, harness.sessionId, first.outcome.candidateId!)
    ).toEqual(candidate);
    expect(harness.history[0]?.designOutcome).toEqual(first.outcome);
    expect(readFileSync(receiptPath)).toEqual(receipt);
  });

  it('reports no_artifact when unchanged content already equals the canvas', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeManifest(harness, created.revisionId);
    await writeArtifact(harness, PAGE);
    expect(await collectDesignTurnOutcome(contextFor(harness))).toMatchObject({
      status: 'recorded',
      outcome: { status: 'committed' },
    });
    harness.turnId = 'turn-outcome-2';
    harness.append({ ...harness.history[0]!, id: harness.turnId, designOutcome: undefined });
    await freezeTurnInput(harness);
    expect(await collectDesignTurnOutcome(contextFor(harness))).toMatchObject({
      status: 'recorded',
      outcome: { status: 'no_artifact' },
    });
    expect(await listHistoricalCandidateFiles(harness.root, harness.sessionId)).toEqual([]);
  });

  it('does not blame the turn for a project that was already unimportable when it was sent', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    // The broken project predates the turn: it is unchanged since send, so its
    // missing media is not something this turn did. It is reported as nothing
    // this turn produced, exactly as a healthy unchanged project would be.
    await writeArtifact(harness, BROKEN_PAGE);
    await freezeTurnInput(harness);

    const attempt = await collectDesignTurnOutcome(contextFor(harness));
    expect(attempt).toEqual({
      status: 'recorded',
      outcome: expect.objectContaining({ status: 'no_artifact' }),
    });
    expect(await listHistoricalCandidateFiles(harness.root, harness.sessionId)).toEqual([]);
    const stored = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(stored.revisionId).toBe(created.revisionId);
  });

  it('does not blame the turn for an inherited project the store will not take', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    // An element id past the store's own bound: the intake accepts it, so only
    // the store's rules can tell. It predates the turn, so the turn reports what
    // any unchanged project reports — nothing this turn produced.
    await writeArtifact(harness, OVERLONG_ID_PAGE);
    await freezeTurnInput(harness);

    const attempt = await collectDesignTurnOutcome(contextFor(harness));
    expect(attempt).toEqual({
      status: 'recorded',
      outcome: expect.objectContaining({ status: 'no_artifact' }),
    });
    expect(await listHistoricalCandidateFiles(harness.root, harness.sessionId)).toEqual([]);
    expect(
      (
        await designOperation(harness.root, {
          operation: 'read',
          sessionId: harness.sessionId,
        })
      ).revisionId
    ).toBe(created.revisionId);

    // The same project, now written *by* this turn: it is the turn's own output,
    // so its rejection is the turn's to report rather than a state it inherited.
    harness.forgetOutcome();
    rmSync(path.join(harness.workdir, DESIGN_TURN_INPUT_DIRNAME, harness.turnId, 'receipt.json'), {
      force: true,
    });
    await writeArtifact(harness, OVERLONG_ID_PAGE.replace('#1F6B8A', '#7B6B8A'));

    const changed = await collectDesignTurnOutcome(contextFor(harness));
    expect(changed.status).toBe('recorded');
    if (changed.status !== 'recorded') return;
    expect(changed.outcome).toMatchObject({
      status: 'invalid',
      diagnostics: [expect.objectContaining({ code: 'design_store_failed' })],
    });
    expect(await listHistoricalCandidateFiles(harness.root, harness.sessionId)).toEqual([]);
  });

  it('collects the project once the turn actually changed it', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await freezeTurnInput(harness);
    // The agent edited one page — the project is no longer the one it started
    // from, so this turn did produce something.
    await writeArtifact(harness, RESTYLED_PAGE);

    const attempt = await collectDesignTurnOutcome(contextFor(harness));
    expect(attempt.status).toBe('recorded');
    if (attempt.status !== 'recorded') return;
    expect(attempt.outcome.status).toBe('committed');
    const stored = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(stored.revisionId).toBe(attempt.outcome.revisionId);
    expect(stored.revisionId).not.toBe(created.revisionId);
    expect(stored.doc.elements).toHaveLength(3);
  });

  it('leaves the user’s newer save untouched without offering an unchanged project', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await freezeTurnInput(harness);
    // The user saved while this turn ran. The project still in the workspace is
    // an older document: it produces neither a candidate nor a commit.
    await moveBaseline(harness, created.revisionId);
    const userSaved = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });

    const attempt = await collectDesignTurnOutcome(contextFor(harness));
    expect(attempt.status).toBe('recorded');
    if (attempt.status !== 'recorded') return;
    expect(attempt.outcome.status).toBe('no_artifact');
    expect(await listHistoricalCandidateFiles(harness.root, harness.sessionId)).toHaveLength(0);
    const stored = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(stored.revisionId).toBe(userSaved.revisionId);
    expect(stored.doc.elements).toHaveLength(0);
  });

  it('preserves the draft and diagnostics when the store refuses to write it in time', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await writeManifest(harness, created.revisionId);
    // Another writer holds the artwork's lock past the deadline. The store
    // refuses (`DESIGN_BUSY`) rather than overwriting or waiting forever, and a
    // refusal must never cost the turn its work — the document is adoptable, and
    // only the *forced* write is what we refuse to do.
    writeFileSync(
      path.join(harness.workdir, DESIGN_LOCK_FILENAME),
      JSON.stringify({ pid: 1, token: 'someone-else' })
    );
    let at = Date.now();
    const lock = {
      now: () => {
        at += 1_000;
        return at;
      },
      sleep: async () => undefined,
    };

    const attempt = await collectDesignTurnOutcome({ ...contextFor(harness), lock });
    expect(attempt.status).toBe('recorded');
    if (attempt.status !== 'recorded') return;
    expect(attempt.outcome.status).toBe('invalid');
    expect(attempt.outcome.diagnostics?.[0]?.code).toBe('design_commit_conflict');
    const stored = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(stored.revisionId).toBe(created.revisionId);
    expect(await listHistoricalCandidateFiles(harness.root, harness.sessionId)).toHaveLength(0);
  });

  it('recovers a lost stamp from the receipt, and never decides twice', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await writeManifest(harness, created.revisionId);

    const first = await collectDesignTurnOutcome(contextFor(harness));
    expect(first.status).toBe('recorded');
    if (first.status !== 'recorded') return;
    // The verdict is on disk twice: the receipt this turn's directory keeps, and
    // the history entry. Both preserve the same verdict.
    const receiptFile = path.join(
      harness.workdir,
      DESIGN_TURN_INPUT_DIRNAME,
      harness.turnId,
      'receipt.json'
    );
    expect(JSON.parse(readFileSync(receiptFile, 'utf8'))).toEqual(first.outcome);
    const committed = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });

    // The daemon died between the receipt and the history write. By the time the
    // collection runs again, the turn's document has been edited further and the
    // user has saved: deciding again would report a conflict for a document this
    // turn already committed — an invitation to undo their own save.
    harness.forgetOutcome();
    await writeArtifact(harness, RESTYLED_PAGE);
    await moveBaseline(harness, committed.revisionId);
    const userSaved = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    const second = await collectDesignTurnOutcome(contextFor(harness));
    expect(second.status).toBe('recorded');
    if (second.status !== 'recorded') return;
    // Recovery stamps exactly what was written down without collecting again.
    expect(second.outcome).toEqual(first.outcome);
    expect(recordedOutcome(harness)).toEqual(second.outcome);
    expect(await listHistoricalCandidateFiles(harness.root, harness.sessionId)).toEqual([]);
    // The canvas the user saved is still theirs, byte for byte, and nothing was
    // committed a second time.
    const live = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(live).toEqual(userSaved);
    expect(live.revisionId).not.toBe(committed.revisionId);
  });

  it('decides again when the crash left no receipt, and still never overwrites the canvas', async () => {
    const harness = createHarness();
    await createDesign(harness);
    // A first design turn: no project existed in the workspace when it was sent.
    await freezeTurnInput(harness);
    await writeArtifact(harness, PAGE);

    const first = await collectDesignTurnOutcome(contextFor(harness));
    expect(first.status).toBe('recorded');
    if (first.status !== 'recorded') return;
    expect(first.outcome.status).toBe('committed');
    const committed = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });

    // The daemon died between the store write and the receipt, so the commit
    // landed with nothing recording that it did. That is the stretch the receipt
    // cannot cover, and deciding again is the only reading of the turn that does
    // not rest on a missing file. It stays safe — the store's CAS refuses the
    // moved baseline, so the user's save is never overwritten — and the cost is
    // the documented one: this turn's already-committed document comes back as a
    // conflict rather than the commit it was.
    harness.forgetOutcome();
    rmSync(path.join(harness.workdir, DESIGN_TURN_INPUT_DIRNAME, harness.turnId, 'receipt.json'), {
      force: true,
    });
    // The user resized the canvas while the daemon was down, so the canvas no
    // longer holds this turn's document: the store's comparison has nothing left
    // to recognise the turn's bytes by.
    await designOperation(harness.root, {
      operation: 'save',
      sessionId: harness.sessionId,
      baseRevisionId: committed.revisionId,
      content: {
        doc: { ...committed.doc, canvas: { width: 640, height: 480 } },
        assets: committed.assets,
      },
      name: 'Saved while the daemon was down',
    });
    const userSaved = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });

    const second = await collectDesignTurnOutcome(contextFor(harness));
    expect(second.status).toBe('recorded');
    if (second.status !== 'recorded') return;
    expect(second.outcome.status).toBe('invalid');
    expect(second.outcome.diagnostics?.[0]?.code).toBe('design_commit_conflict');
    expect(await listHistoricalCandidateFiles(harness.root, harness.sessionId)).toHaveLength(0);
    const live = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(live).toEqual(userSaved);
  });

  it('ignores a receipt that is not this turn’s verdict', async () => {
    const harness = createHarness();
    await createDesign(harness);
    await writeArtifact(harness, PAGE);
    const receiptFile = path.join(
      harness.workdir,
      DESIGN_TURN_INPUT_DIRNAME,
      harness.turnId,
      'receipt.json'
    );
    const forged = {
      version: 1,
      status: 'committed',
      turnId: harness.turnId,
      artworkId: harness.sessionId,
      revisionId: 'f'.repeat(64),
      timestamp: '2026-09-10T02:00:00.000Z',
    };

    // Corrupt, and a verdict belonging to something else: neither may be
    // stamped, because neither is this turn's record.
    for (const written of [
      '{ not json',
      JSON.stringify({ ...forged, turnId: 'someone-else' }),
      JSON.stringify({ ...forged, artworkId: crypto.randomUUID() }),
    ]) {
      harness.forgetOutcome();
      const current = await designOperation(harness.root, {
        operation: 'read',
        sessionId: harness.sessionId,
      });
      await writeManifest(harness, current.revisionId);
      writeFileSync(receiptFile, written);
      const attempt = await collectDesignTurnOutcome(contextFor(harness));
      expect(attempt.status).toBe('recorded');
      if (attempt.status !== 'recorded') return;
      expect(attempt.outcome.status).toBe('committed');
      expect(attempt.outcome.revisionId).not.toBe(forged.revisionId);
    }
  });

  it('reports invalid with the validator diagnostics for a broken artifact', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, BROKEN_PAGE);
    await writeManifest(harness, created.revisionId);

    const attempt = await collectDesignTurnOutcome(contextFor(harness));
    expect(attempt.status).toBe('recorded');
    if (attempt.status !== 'recorded') return;
    expect(attempt.outcome.status).toBe('invalid');
    expect(attempt.outcome.diagnostics?.some(({ code }) => code === 'MOLLY-E005')).toBe(true);
    const stored = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(stored.revisionId).toBe(created.revisionId);
  });

  it('rejects a symlinked entry artifact instead of following it', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    writeFileSync(path.join(harness.workdir, 'outside.pptd'), MANIFEST);
    symlinkSync(
      path.join(harness.workdir, 'outside.pptd'),
      path.join(harness.workdir, DESIGN_ARTIFACT_ENTRY)
    );
    await writeManifest(harness, created.revisionId);

    const attempt = await collectDesignTurnOutcome(contextFor(harness));
    expect(attempt.status).toBe('recorded');
    if (attempt.status !== 'recorded') return;
    expect(attempt.outcome.status).toBe('invalid');
    expect(attempt.outcome.diagnostics?.[0]?.code).toBe('design_collect_rejected');
  });

  it('preserves final-conflict draft and durable diagnostics when the user saved meanwhile', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await writeManifest(harness, created.revisionId);
    await moveBaseline(harness, created.revisionId);
    const userSaved = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });

    const attempt = await collectDesignTurnOutcome(contextFor(harness));
    expect(attempt.status).toBe('recorded');
    if (attempt.status !== 'recorded') return;
    expect(attempt.outcome.status).toBe('invalid');
    expect(attempt.outcome.diagnostics?.[0]?.code).toBe('design_commit_conflict');
    expect(attempt.outcome.candidateId).toBeUndefined();
    expect(attempt.outcome.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'design_draft_preserved',
          message: expect.stringContaining(harness.workdir),
        }),
        expect.objectContaining({
          code: 'design_continue_required',
          message: expect.stringMatching(/design-current\/design\.yaml/),
        }),
      ])
    );

    // The user's canvas and the Agent draft are both retained.
    const stored = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(stored.revisionId).toBe(userSaved.revisionId);
    expect(stored.doc.elements).toHaveLength(0);
    expect(await readDesignArtifact(harness.workdir)).toMatchObject({ status: 'present' });
    expect(await listHistoricalCandidateFiles(harness.root, harness.sessionId)).toEqual([]);
    expect(
      JSON.parse(
        readFileSync(
          path.join(harness.workdir, DESIGN_TURN_INPUT_DIRNAME, harness.turnId, 'receipt.json'),
          'utf8'
        )
      )
    ).toEqual(attempt.outcome);
  });

  it('restores durable conflict diagnostics when the same turn is collected again', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await writeManifest(harness, created.revisionId);
    await moveBaseline(harness, created.revisionId);

    const first = await collectDesignTurnOutcome(contextFor(harness));
    expect(first.status).toBe('recorded');
    if (first.status !== 'recorded') return;

    harness.forgetOutcome();
    const second = await collectDesignTurnOutcome(contextFor(harness));
    expect(second).toEqual(first);
    const candidates = await listHistoricalCandidateFiles(harness.root, harness.sessionId);
    expect(candidates).toHaveLength(0);
  });

  it('applies once when a finalized turn is collected twice', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await writeManifest(harness, created.revisionId);

    const first = await collectDesignTurnOutcome(contextFor(harness));
    expect(first.status).toBe('recorded');
    if (first.status !== 'recorded') return;
    const stored = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });

    // The artifact is gone, so a second run could only be a re-commit.
    rmSync(path.join(harness.workdir, DESIGN_ARTIFACT_ENTRY));
    const second = await collectDesignTurnOutcome(contextFor(harness));
    expect(second).toEqual({ status: 'skipped', reason: 'already_recorded' });
    expect(harness.history[0]?.designOutcome).toEqual(first.outcome);
    const after = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(after.revisionId).toBe(stored.revisionId);
  });

  it('reports invalid when the manifest cannot anchor the baseline', async () => {
    const harness = createHarness();
    await createDesign(harness);
    await writeArtifact(harness, PAGE);
    const dir = path.join(harness.workdir, DESIGN_TURN_INPUT_DIRNAME, harness.turnId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, DESIGN_TURN_MANIFEST_FILENAME), '{ not json');

    const attempt = await collectDesignTurnOutcome(contextFor(harness));
    expect(attempt.status).toBe('recorded');
    if (attempt.status !== 'recorded') return;
    expect(attempt.outcome.status).toBe('invalid');
    expect(attempt.outcome.diagnostics?.[0]?.code).toBe('design_manifest_unreadable');
  });

  it('reports invalid when the manifest belongs to another turn', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await writeManifest(harness, created.revisionId);
    const manifestFile = path.join(
      harness.workdir,
      DESIGN_TURN_INPUT_DIRNAME,
      harness.turnId,
      DESIGN_TURN_MANIFEST_FILENAME
    );
    const manifest = JSON.parse(
      await import('node:fs/promises').then((fs) => fs.readFile(manifestFile, 'utf8'))
    ) as Record<string, unknown>;
    writeFileSync(manifestFile, JSON.stringify({ ...manifest, turnId: 'someone-else' }));

    const attempt = await collectDesignTurnOutcome(contextFor(harness));
    expect(attempt.status).toBe('recorded');
    if (attempt.status !== 'recorded') return;
    expect(attempt.outcome.diagnostics?.[0]?.code).toBe('design_manifest_mismatch');
  });

  it('does nothing without a frozen manifest (pre-P2.2 session)', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);

    expect(await collectDesignTurnOutcome(contextFor(harness))).toEqual({
      status: 'skipped',
      reason: 'no_manifest',
    });
    expect(harness.history[0]?.designOutcome).toBeUndefined();
    const stored = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(stored.revisionId).toBe(created.revisionId);
  });

  it('is a no-op for a session that is not a design session', async () => {
    const harness = createHarness({ design: false });
    await writeArtifact(harness, PAGE);
    await writeManifest(harness, 'b'.repeat(64));

    expect(await collectDesignTurnOutcome(contextFor(harness))).toEqual({
      status: 'skipped',
      reason: 'not_design',
    });
    expect(harness.history[0]?.designOutcome).toBeUndefined();
  });

  it('skips silently when the session document is unreadable', async () => {
    const harness = createHarness({ metaThrows: true });
    expect(await collectDesignTurnOutcome(contextFor(harness))).toEqual({
      status: 'skipped',
      reason: 'session_doc_unreadable',
    });
  });

  it('does not claim a card when the turn entry is gone', async () => {
    const harness = createHarness({ history: false });
    const created = await createDesign(harness);
    await writeManifest(harness, created.revisionId);

    expect(await collectDesignTurnOutcome(contextFor(harness))).toEqual({
      status: 'skipped',
      reason: 'entry_missing',
    });
    expect(harness.history).toEqual([]);
  });
});

describe('recordDesignTurnTerminalOutcome', () => {
  it('records a cancelled turn without touching the canvas or the candidate list', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await writeManifest(harness, created.revisionId);

    const attempt = await recordDesignTurnTerminalOutcome({
      ...contextFor(harness),
      status: 'cancelled',
    });
    expect(attempt.status).toBe('recorded');
    if (attempt.status !== 'recorded') return;
    expect(attempt.outcome.status).toBe('cancelled');
    expect(attempt.outcome.diagnostics).toBeUndefined();
    const stored = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(stored.revisionId).toBe(created.revisionId);
    expect(await listHistoricalCandidateFiles(harness.root, harness.sessionId)).toEqual([]);
  });

  it('records a failed turn with its bounded message', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeManifest(harness, created.revisionId);

    const attempt = await recordDesignTurnTerminalOutcome({
      ...contextFor(harness),
      status: 'failed',
      message: 'The agent process disconnected unexpectedly.',
    });
    expect(attempt.status).toBe('recorded');
    if (attempt.status !== 'recorded') return;
    expect(attempt.outcome).toMatchObject({
      status: 'failed',
      diagnostics: [
        { code: 'design_turn_failed', message: 'The agent process disconnected unexpectedly.' },
      ],
    });
  });

  it('keeps the first verdict when a failure follows a collection', async () => {
    const harness = createHarness();
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await writeManifest(harness, created.revisionId);
    await collectDesignTurnOutcome(contextFor(harness));

    expect(
      await recordDesignTurnTerminalOutcome({ ...contextFor(harness), status: 'cancelled' })
    ).toEqual({ status: 'skipped', reason: 'already_recorded' });
    expect(recordedOutcome(harness)?.status).toBe('committed');
  });

  it('does not record a failure for a turn whose input was never frozen', async () => {
    const harness = createHarness();
    await createDesign(harness);
    expect(
      await recordDesignTurnTerminalOutcome({ ...contextFor(harness), status: 'failed' })
    ).toEqual({ status: 'skipped', reason: 'no_manifest' });
    expect(harness.history[0]?.designOutcome).toBeUndefined();
  });
});

it.each(['pi-acp', 'claude'])(
  'accepts valid %s output without a read ledger after native success and independent checks',
  async (agentType) => {
    const harness = createHarness();
    const meta = await harness.sessionDoc.getMetaState();
    if (!meta) throw Error('Synthetic meta missing');
    meta.agentType = agentType;
    meta.cliType = 'builtin';
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await writeManifest(harness, created.revisionId);
    const outcome = await collectDesignTurnOutcome(contextFor(harness));
    expect(outcome).toMatchObject({
      status: 'recorded',
      outcome: { status: 'committed' },
    });
    expect(
      (await designOperation(harness.root, { operation: 'read', sessionId: harness.sessionId }))
        .revisionId
    ).not.toBe(created.revisionId);
    expect((await readDesignArtifact(harness.workdir)).status).toBe('present');
  }
);

it.each([false, true])(
  'unchanged bytes require explicit resubmission evidence (explicit=%s)',
  async (explicit) => {
    const harness = createHarness();
    const meta = await harness.sessionDoc.getMetaState();
    if (!meta) throw Error('Synthetic meta missing');
    meta.agentType = 'pi-acp';
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await freezeTurnInput(harness);
    const artifact = await readDesignArtifact(harness.workdir);
    if (artifact.status !== 'present') throw Error('Synthetic artifact missing');
    const manifest = readFileSync(
      path.join(harness.workdir, DESIGN_TURN_INPUT_DIRNAME, harness.turnId, 'manifest.json')
    );
    const outcome = await collectDesignTurnOutcome({
      ...contextFor(harness),
      designSubmission: explicit
        ? {
            artworkId: harness.sessionId,
            draftId: harness.workdir,
            revisionId: created.revisionId,
            artifactDigest: artifact.digest,
          }
        : undefined,
    });
    expect(outcome).toMatchObject({
      status: 'recorded',
      outcome: { status: explicit ? 'committed' : 'no_artifact' },
    });
    expect(
      readFileSync(
        path.join(harness.workdir, DESIGN_TURN_INPUT_DIRNAME, harness.turnId, 'manifest.json')
      )
    ).toEqual(manifest);
    expect(await readDesignArtifact(harness.workdir)).toEqual(artifact);
  }
);

it.each(['pi-acp', 'claude'])(
  '%s final compare-and-swap race preserves exact draft without a candidate',
  async (agentType) => {
    const harness = createHarness();
    const created = await createDesign(harness);
    const meta = await harness.sessionDoc.getMetaState();
    if (!meta) throw Error('Synthetic meta missing');
    meta.agentType = agentType;
    meta.cliType = 'builtin';
    await writeArtifact(harness, PAGE);
    await freezeTurnInput(harness);
    const before = await readDesignArtifact(harness.workdir);
    if (before.status !== 'present') throw Error('Synthetic artifact missing');
    const file = path.join(harness.workdir, DESIGN_LOCK_FILENAME);
    writeFileSync(file, JSON.stringify({ pid: 1, token: 'external-writer' }));
    const outcome = await collectDesignTurnOutcome({
      ...contextFor(harness),
      designSubmission: {
        artworkId: harness.sessionId,
        draftId: harness.workdir,
        revisionId: created.revisionId,
        artifactDigest: before.digest,
      },
      lock: {
        now: () => 0,
        sleep: async () => {
          rmSync(file);
          await moveBaseline(harness, created.revisionId);
        },
      },
    });
    expect(outcome).toMatchObject({
      status: 'recorded',
      outcome: {
        status: 'invalid',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'design_commit_conflict' }),
        ]),
      },
    });
    expect(await readDesignArtifact(harness.workdir)).toEqual(before);
    expect(await listHistoricalCandidateFiles(harness.root, harness.sessionId)).toEqual([]);
    const current = await designOperation(harness.root, {
      operation: 'read',
      sessionId: harness.sessionId,
    });
    expect(current.revisionId).not.toBe(created.revisionId);
    expect(current.doc.elements).toHaveLength(0);
  }
);

it.each(['failed', 'cancelled', undefined] as const)(
  'preserves Pi draft after native terminal %s despite ACP end_turn',
  async (terminal) => {
    const harness = createHarness();
    const meta = await harness.sessionDoc.getMetaState();
    if (!meta) throw Error('Synthetic meta missing');
    meta.agentType = 'pi-acp';
    const created = await createDesign(harness);
    await writeArtifact(harness, PAGE);
    await writeManifest(harness, created.revisionId);
    const artifact = await readDesignArtifact(harness.workdir);
    if (artifact.status !== 'present') throw Error('Synthetic artifact missing');
    const outcome = await collectDesignTurnOutcome({
      ...contextFor(harness),
      designNativeTerminal: terminal,
      designSubmission: {
        artworkId: harness.sessionId,
        draftId: harness.workdir,
        revisionId: created.revisionId,
        artifactDigest: artifact.digest,
      },
    });
    expect(outcome).toMatchObject({
      status: 'recorded',
      outcome: { status: terminal === 'cancelled' ? 'cancelled' : 'failed' },
    });
    expect(
      (await designOperation(harness.root, { operation: 'read', sessionId: harness.sessionId }))
        .revisionId
    ).toBe(created.revisionId);
    expect(await readDesignArtifact(harness.workdir)).toEqual(artifact);
    harness.forgetOutcome();
    expect(
      await collectDesignTurnOutcome({ ...contextFor(harness), designNativeTerminal: 'end_turn' })
    ).toEqual(outcome);
  }
);
