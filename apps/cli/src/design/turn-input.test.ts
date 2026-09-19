import { formatDesignElementReference } from '@molly/shared/design-element-reference';
/**
 * Design turn-input manifest tests (P2.2). Synthetic designs and synthetic
 * image bytes only; the manifest is the integrity anchor for P2.3, so these
 * cover content correctness, atomic/idempotent writes and blocking failures.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { designOperation, acknowledgeDesign } from './store';
import {
  DESIGN_TURN_INPUT_DIRNAME,
  DesignTurnInputError,
  materializeDesignTurnInput,
} from './turn-input';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Minimal byte-correct PNG container (header + IHDR); the manifest records
 *  bytes, not decodability, so a real encoder is not needed. */
const pngBytes = (seed: number): Buffer => {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(8, 8);
  ihdr.writeUInt32BE(4, 12);
  return Buffer.concat([header, ihdr, Buffer.from([seed, seed >>> 8])]);
};

/** The smallest workspace project the artifact collector accepts (P2.1 layout). */
async function writeProject(workdir: string, page: string): Promise<void> {
  await mkdir(path.join(workdir, 'pages'), { recursive: true });
  await writeFile(
    path.join(workdir, 'design.yaml'),
    'format: molly-canvas/1\ntitle: Frozen\nsize: [320, 200]\n' + page
  );
}

async function setupDesign(options: { width?: number; height?: number } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'molly-turn-input-'));
  roots.push(root);
  const sessionId = randomUUID();
  await designOperation(root, {
    operation: 'create',
    association: {
      sessionId,
      name: 'Synthetic',
      userId: 'local:test',
      machineId: 'test-machine',
      createdAt: '2026-09-10T00:00:00.000Z',
    },
    width: options.width ?? 800,
    height: options.height ?? 600,
  });
  await acknowledgeDesign(root, sessionId);
  const workdir = path.join(root, 'chats', sessionId);
  await mkdir(workdir, { recursive: true });
  return { root, sessionId, workdir };
}

describe('materializeDesignTurnInput', () => {
  it('freezes valid stable targets with attachments and rejects changed or deleted targets before manifest creation', async () => {
    const { root, sessionId, workdir } = await setupDesign();
    const original = await designOperation(root, { operation: 'read', sessionId });
    const saved = await designOperation(root, {
      operation: 'save',
      sessionId,
      baseRevisionId: original.revisionId,
      content: {
        doc: {
          ...original.doc,
          elements: [
            {
              id: 'target',
              kind: 'shape',
              bounds: [10, 10, 80, 80],
              zIndex: 0,
              shapeName: 'rect',
              fill: { type: 'solid', color: '#112233' },
            },
          ],
        },
        assets: original.assets,
      },
    });
    const reference = {
      artworkId: sessionId,
      baselineRevisionId: saved.revisionId,
      elementIds: ['target'],
    };
    const options = {
      workdir,
      artworkId: sessionId,
      prompt: formatDesignElementReference(reference),
      skillSourceIdentity: 'a'.repeat(64),
      dataRoot: root,
      references: [{ bytes: pngBytes(1), mimeType: 'image/png' }],
    };
    const manifest = await materializeDesignTurnInput({ ...options, turnId: 'valid' });
    expect(manifest.prompt).toBe(options.prompt);
    expect(manifest.references).toHaveLength(1);
    for (const [turnId, changed, error] of [
      ['other', { ...reference, artworkId: 'other' }, 'another artwork'],
      ['stale', { ...reference, baselineRevisionId: 'f'.repeat(64) }, 'stale'],
      ['deleted', { ...reference, elementIds: ['deleted'] }, 'deleted'],
    ] as const) {
      await expect(
        materializeDesignTurnInput({
          ...options,
          turnId,
          prompt: formatDesignElementReference(changed),
        })
      ).rejects.toThrow(error);
      await expect(
        readFile(path.join(workdir, 'design-input', turnId, 'manifest.json'))
      ).rejects.toThrow();
    }
  });

  it('keeps the frozen marker but blocks recovery after canonical changes', async () => {
    const { root, sessionId, workdir } = await setupDesign();
    const original = await designOperation(root, { operation: 'read', sessionId });
    const saved = await designOperation(root, {
      operation: 'save',
      sessionId,
      baseRevisionId: original.revisionId,
      content: {
        doc: {
          ...original.doc,
          elements: [
            { id: 'target', kind: 'shape', bounds: [10, 10, 80, 80], zIndex: 0, shapeName: 'rect' },
          ],
        },
        assets: original.assets,
      },
    });
    const options = {
      workdir,
      artworkId: sessionId,
      turnId: 'recover',
      prompt: formatDesignElementReference({
        artworkId: sessionId,
        baselineRevisionId: saved.revisionId,
        elementIds: ['target'],
      }),
      skillSourceIdentity: 'a'.repeat(64),
      dataRoot: root,
    };
    await materializeDesignTurnInput(options);
    const file = path.join(workdir, 'design-input', 'recover', 'manifest.json');
    const frozen = await readFile(file, 'utf8');
    await designOperation(root, {
      operation: 'save',
      sessionId,
      baseRevisionId: saved.revisionId,
      content: {
        doc: { ...saved.doc, background: { type: 'solid', color: '#010203' } },
        assets: saved.assets,
      },
    });
    await expect(materializeDesignTurnInput(options)).rejects.toThrow('stale');
    expect(await readFile(file, 'utf8')).toBe(frozen);
  });

  it('freezes prompt, canvas, baseline revision, skill identity and verified reference copies', async () => {
    const { root, sessionId, workdir } = await setupDesign({ width: 1200, height: 628 });
    const image = pngBytes(7);
    const turnId = 'turn-user-1';

    const manifest = await materializeDesignTurnInput({
      workdir,
      turnId,
      artworkId: sessionId,
      prompt: 'make a poster\n\nUse the skill at /x',
      skillSourceIdentity: 'a'.repeat(64),
      skillDrift: ['references/guide.md'],
      references: [{ bytes: image, mimeType: 'image/png' }],
      dataRoot: root,
    });

    const baseline = await designOperation(root, { operation: 'read', sessionId });
    expect(manifest).toEqual({
      version: 1,
      turnId,
      prompt: 'make a poster\n\nUse the skill at /x',
      canvas: { width: 1200, height: 628 },
      baselineRevisionId: baseline.revisionId,
      skillSourceIdentity: 'a'.repeat(64),
      skillDrift: ['references/guide.md'],
      references: [
        {
          file: `references/${sha256Hex(image)}.png`,
          sha256: sha256Hex(image),
          bytes: image.byteLength,
          mimeType: 'image/png',
        },
      ],
      // The workspace had no project yet, which is a fact about this turn too.
      artifactAtSend: { status: 'absent' },
    });

    const turnDir = path.join(workdir, DESIGN_TURN_INPUT_DIRNAME, turnId);
    expect(JSON.parse(await readFile(path.join(turnDir, 'manifest.json'), 'utf8'))).toEqual(
      manifest
    );
    const landed = await readFile(path.join(turnDir, 'references', `${sha256Hex(image)}.png`));
    expect(sha256Hex(landed)).toBe(sha256Hex(image));
  });

  it('freezes a turn once: a re-dispatch keeps the manifest and the references it was sent with', async () => {
    const { root, sessionId, workdir } = await setupDesign();
    const turnId = 'turn-user-retry';
    const request = {
      workdir,
      turnId,
      artworkId: sessionId,
      prompt: 'poster please',
      skillSourceIdentity: 'b'.repeat(64),
      references: [
        { bytes: pngBytes(1), mimeType: 'image/png' },
        { bytes: pngBytes(2), mimeType: 'image/png' },
      ],
      dataRoot: root,
    };

    const first = await materializeDesignTurnInput(request);
    const manifestFile = path.join(workdir, DESIGN_TURN_INPUT_DIRNAME, turnId, 'manifest.json');
    const firstBytes = await readFile(manifestFile);
    // The canvas this turn was anchored to is gone by the time the turn is set
    // up again (a restart, a rewind, a deleted design). Re-materializing must
    // not rebase the turn on it — and must not fail on its absence.
    await rm(path.join(workdir, 'design.json'));
    const second = await materializeDesignTurnInput({
      ...request,
      prompt: 'a different prompt',
      references: [{ bytes: pngBytes(9), mimeType: 'image/png' }],
    });
    const secondBytes = await readFile(manifestFile);

    expect(second).toEqual(first);
    expect(secondBytes.equals(firstBytes)).toBe(true);
    const turnDir = path.join(workdir, DESIGN_TURN_INPUT_DIRNAME, turnId);
    const referenceFiles = readdirSync(path.join(turnDir, 'references')).sort();
    expect(referenceFiles).toEqual(
      [pngBytes(1), pngBytes(2)].map((bytes) => `${sha256Hex(bytes)}.png`).sort()
    );
    // Atomic writes leave no `.tmp` siblings anywhere under the turn directory.
    expect(readdirSync(turnDir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('replaces a manifest that is not this turn’s frozen input', async () => {
    const { root, sessionId, workdir } = await setupDesign();
    const turnId = 'turn-user-corrupt-manifest';
    const turnDir = path.join(workdir, DESIGN_TURN_INPUT_DIRNAME, turnId);
    await mkdir(turnDir, { recursive: true });
    const request = {
      workdir,
      turnId,
      artworkId: sessionId,
      prompt: 'poster please',
      skillSourceIdentity: 'b'.repeat(64),
      dataRoot: root,
    };
    const baseline = await designOperation(root, { operation: 'read', sessionId });

    // Truncated, and another turn's: neither anchors this turn, so both are
    // replaced rather than reused.
    for (const written of ['{ not json', JSON.stringify({ version: 1, turnId: 'someone-else' })]) {
      await writeFile(path.join(turnDir, 'manifest.json'), written);
      const manifest = await materializeDesignTurnInput(request);
      expect(manifest).toMatchObject({
        version: 1,
        turnId,
        baselineRevisionId: baseline.revisionId,
      });
    }
  });

  it('records the project the turn was dispatched with, and tells a changed one apart', async () => {
    const { root, sessionId, workdir } = await setupDesign();
    const send = (turnId: string) =>
      materializeDesignTurnInput({
        workdir,
        turnId,
        artworkId: sessionId,
        prompt: 'p',
        skillSourceIdentity: 'c'.repeat(64),
        dataRoot: root,
      });

    // No project yet: there is nothing for P2.3 to compare against.
    expect((await send('turn-a')).artifactAtSend).toEqual({ status: 'absent' });

    await writeProject(workdir, 'elements: []\n');
    const withProject = await send('turn-b');
    expect(withProject.artifactAtSend).toEqual({
      status: 'present',
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const digest = (withProject.artifactAtSend as { digest: string }).digest;
    expect(withProject.previewSourceAtSend).toMatch(/^[a-f0-9]{64}$/);

    // The same project on the next dispatch is the same identity — which is what
    // lets P2.3 report "this turn produced nothing" instead of re-importing it.
    const unchanged = await send('turn-c');
    expect(unchanged.artifactAtSend).toEqual({ status: 'present', digest });
    expect(unchanged.previewSourceAtSend).toBe(withProject.previewSourceAtSend);

    // One rewritten page is a different project.
    await writeProject(workdir, 'elements:\n  - id: title\n    kind: text\n');
    expect((await send('turn-d')).artifactAtSend).not.toEqual({ status: 'present', digest });

    // A workspace we refuse to import is recorded as refused, without the
    // collector's message (the manifest is a file the agent can read).
    await rm(path.join(workdir, 'design.yaml'));
    await symlink(path.join(workdir, 'pages', 'canvas.yaml'), path.join(workdir, 'design.yaml'));
    expect((await send('turn-e')).artifactAtSend).toEqual({ status: 'rejected' });
  });

  it('replaces a corrupted reference copy instead of trusting the file name', async () => {
    const { root, sessionId, workdir } = await setupDesign();
    const turnId = 'turn-user-corrupt';
    const image = pngBytes(3);
    const turnDir = path.join(workdir, DESIGN_TURN_INPUT_DIRNAME, turnId);
    await mkdir(path.join(turnDir, 'references'), { recursive: true });
    await writeFile(path.join(turnDir, 'references', `${sha256Hex(image)}.png`), 'corrupt');

    await materializeDesignTurnInput({
      workdir,
      turnId,
      artworkId: sessionId,
      prompt: 'p',
      skillSourceIdentity: 'c'.repeat(64),
      references: [{ bytes: image, mimeType: 'image/png' }],
      dataRoot: root,
    });

    const landed = await readFile(path.join(turnDir, 'references', `${sha256Hex(image)}.png`));
    expect(sha256Hex(landed)).toBe(sha256Hex(image));
  });

  it('fails closed when the design baseline cannot be read', async () => {
    const { root, workdir } = await setupDesign();
    await expect(
      materializeDesignTurnInput({
        workdir,
        turnId: 'turn-user-missing',
        artworkId: randomUUID(),
        prompt: 'p',
        skillSourceIdentity: 'd'.repeat(64),
        dataRoot: root,
      })
    ).rejects.toThrow(DesignTurnInputError);
    expect(readdirSync(workdir)).not.toContain(DESIGN_TURN_INPUT_DIRNAME);
  });

  it('refuses a turnId that would escape the design-input directory', async () => {
    const { root, sessionId, workdir } = await setupDesign();
    await expect(
      materializeDesignTurnInput({
        workdir,
        turnId: '../escape',
        artworkId: sessionId,
        prompt: 'p',
        skillSourceIdentity: 'e'.repeat(64),
        dataRoot: root,
      })
    ).rejects.toThrow(DesignTurnInputError);
  });
});
