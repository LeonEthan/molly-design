/**
 * Preview rendering (P2.4b): a synthetic YAML artwork in a session workdir is
 * staged for the desktop, and the file the desktop writes back is verified
 * before its path is handed to any agent.
 *
 * Every fixture is synthetic and every "desktop" is a function: nothing here
 * renders, and nothing touches the network.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { DesignRenderHostWork } from '@molly/shared';
import { ARTWORK_ENTRY } from '@molly/design-authoring';
import { canonicalContentBytes } from './store';
import {
  DESIGN_PREVIEW_DIRNAME,
  MAX_KEPT_PREVIEWS,
  buildPreviewPayload,
  renderDesignPreview,
  type DesignPreviewContext,
  type DesignRenderQueue,
} from './render-preview';
import type { DesignRenderPreviewOutcome } from './render-host';

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

const PAGE = `format: molly-canvas/1
title: Preview test
size: [320, 200]
background:
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
  - id: photo
    kind: image
    bounds: [120, 60, 64, 64]
    src: media/pic.png
    fit: cover
`;

const BROKEN_PAGE = PAGE.replace('media/pic.png', 'media/missing.png');
const LEFTOVER_PPTD = `version: v2
title: Leftover Kimi PPTD
size: [320, 200]
pages:
  - pages/main.page
`;

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

type Harness = {
  dataRoot: string;
  ctx: DesignPreviewContext;
  workdir: string;
  previewDirectory: string;
};

function createHarness(options: { artifact?: boolean; page?: string } = {}): Harness {
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'molly-render-preview-'));
  roots.push(dataRoot);
  const sessionId = 'artwork-1';
  const workdir = path.join(dataRoot, 'chats', sessionId);
  mkdirSync(path.join(workdir, 'pages'), { recursive: true });
  mkdirSync(path.join(workdir, 'media'), { recursive: true });
  if (options.artifact !== false) {
    writeFileSync(path.join(workdir, ARTWORK_ENTRY), options.page ?? PAGE);
    writeFileSync(path.join(workdir, 'media', 'pic.png'), syntheticPng(8, 8, [31, 107, 138]));
  }
  return {
    dataRoot,
    workdir,
    previewDirectory: path.join(workdir, DESIGN_PREVIEW_DIRNAME),
    ctx: {
      artworkId: sessionId,
      workdir,
      dataRoot,
      name: 'Preview test',
      userId: 'user-1',
      machineId: 'machine-1',
      now: () => new Date('2026-09-10T12:00:00.000Z'),
    },
  };
}

type RecordingQueue = DesignRenderQueue & { seen: DesignRenderHostWork[] };

/**
 * A stand-in desktop: whatever `handle` returns is what the host reported.
 */
function queueThat(
  handle: (work: DesignRenderHostWork) => Promise<DesignRenderPreviewOutcome>
): RecordingQueue {
  const seen: DesignRenderHostWork[] = [];
  return {
    seen,
    enqueue: async (work) => {
      seen.push(work);
      return await handle(work);
    },
  };
}

/** A desktop that renders correctly: write a PNG where it was asked to. */
const renderingQueue = (onPayload?: (payload: Record<string, unknown>) => void): RecordingQueue =>
  queueThat(async (work) => {
    if (onPayload) {
      onPayload(JSON.parse(await readFile(work.payloadPath, 'utf8')) as Record<string, unknown>);
    }
    await writeFile(work.outputPath, syntheticPng(work.width, work.height, [10, 20, 30]));
    return { status: 'rendered', absolutePath: work.outputPath };
  });

describe('buildPreviewPayload', () => {
  it.each([false, true])(
    'preserves a typed asset-size diagnostic (observation: %s)',
    async (observe) => {
      const { workdir } = createHarness();
      const bytes = Buffer.alloc(16_777_217);
      bytes.set(syntheticPng(8, 8, [31, 107, 138]));
      writeFileSync(path.join(workdir, 'media', 'pic.png'), bytes);
      const built = observe
        ? await buildPreviewPayload(workdir, {})
        : await buildPreviewPayload(workdir);
      expect(built).toMatchObject({
        status: 'refused',
        assetFailure: {
          code: 'asset_too_large',
          path: 'media/pic.png',
          actualBytes: 16_777_217,
          limitBytes: 16_777_216,
        },
      });
    }
  );

  it('preserves the asset path and expected kind for unsupported bytes', async () => {
    const { workdir } = createHarness();
    writeFileSync(path.join(workdir, 'media', 'pic.png'), 'not an image');
    expect(await buildPreviewPayload(workdir)).toMatchObject({
      status: 'refused',
      assetFailure: { code: 'asset_format_unsupported', path: 'media/pic.png', kind: 'image' },
    });
  });

  it('imports the project through the same intake the post-turn collection uses', async () => {
    const { workdir } = createHarness();
    const built = await buildPreviewPayload(workdir);
    expect(built.status).toBe('ok');
    if (built.status !== 'ok') return;
    expect(built.width).toBe(320);
    expect(built.height).toBe(200);
    expect(built.doc).toMatchObject({ canvas: { width: 320, height: 200 } });
    expect(Object.values(built.assets)).toEqual([
      `data:image/png;base64,${Buffer.from(syntheticPng(8, 8, [31, 107, 138])).toString('base64')}`,
    ]);
  });

  it('says there is nothing to preview when the agent has not written a project', async () => {
    const { workdir } = createHarness({ artifact: false });
    const built = await buildPreviewPayload(workdir);
    expect(built.status).toBe('refused');
    expect(built.status === 'refused' && built.error).toContain('Write the project first');
  });

  it('refuses an invalid project with the intake’s own diagnostics', async () => {
    const { workdir } = createHarness({ page: BROKEN_PAGE });
    const built = await buildPreviewPayload(workdir);
    expect(built.status).toBe('refused');
    expect(built.status === 'refused' && built.error).toContain('did not pass the design intake');
  });
});

describe('renderDesignPreview', () => {
  it('stages the project, renders it, and verifies the file before returning it', async () => {
    const { ctx, previewDirectory } = createHarness();
    let staged: Record<string, unknown> | undefined;
    const queue = renderingQueue((payload) => {
      staged = payload;
    });

    const result = await renderDesignPreview(ctx, queue);
    expect(result.status).toBe('rendered');
    if (result.status !== 'rendered') return;

    const name = path.basename(result.path);
    expect(result.path).toBe(`${DESIGN_PREVIEW_DIRNAME}/${name}`);
    expect(name).toMatch(/^1789041600000-[0-9a-f]{8}\.png$/);
    expect(result.width).toBe(320);
    expect(result.height).toBe(200);
    expect(result.bytes).toBe(syntheticPng(320, 200, [10, 20, 30]).byteLength);

    // The staged payload is the same content the store would commit, addressed
    // the same way, plus the association the canvas needs.
    expect(staged).toMatchObject({
      association: {
        sessionId: 'artwork-1',
        name: 'Preview test',
        userId: 'user-1',
        machineId: 'machine-1',
        createdAt: '2026-09-10T12:00:00.000Z',
      },
    });
    const doc = staged?.['doc'] as Record<string, unknown>;
    const assets = staged?.['assets'] as Record<string, string>;
    expect(staged?.['revisionId']).toBe(
      createHash('sha256').update(canonicalContentBytes({ doc, assets })).digest('hex')
    );

    // Staging is scratch: the payload is gone once the host has read it.
    expect(readdirSync(path.join(ctx.dataRoot, 'design-preview-stage'))).toEqual([]);
    expect(readdirSync(previewDirectory)).toEqual([name]);
  });

  it('refuses a rendering whose bytes are not a PNG', async () => {
    const { ctx } = createHarness();
    const queue = queueThat(async (work) => {
      await writeFile(work.outputPath, Buffer.from('<html>not an image</html>'));
      return { status: 'rendered', absolutePath: work.outputPath };
    });

    const result = await renderDesignPreview(ctx, queue);
    expect(result.status).toBe('refused');
    expect(result.status === 'refused' && result.error).toContain('not a PNG');
  });

  it('refuses a rendering that lands outside the session workspace', async () => {
    const { ctx } = createHarness();
    const outside = await mkdtemp(path.join(tmpdir(), 'molly-render-outside-'));
    const escaped = path.join(outside, 'escaped.png');
    const queue = queueThat(async () => {
      await writeFile(escaped, syntheticPng(4, 4, [0, 0, 0]));
      return { status: 'rendered', absolutePath: escaped };
    });

    try {
      const result = await renderDesignPreview(ctx, queue);
      expect(result.status).toBe('refused');
      expect(result.status === 'refused' && result.error).toContain(
        'outside the session workspace'
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('passes the host’s refusal through unchanged', async () => {
    const { ctx } = createHarness();
    const queue = queueThat(async () => ({
      status: 'refused',
      error: 'the Molly desktop is not running',
    }));
    await expect(renderDesignPreview(ctx, queue)).resolves.toEqual({
      status: 'refused',
      error: 'the Molly desktop is not running',
    });
  });

  it('refuses an empty file rather than reporting a rendered preview', async () => {
    const { ctx } = createHarness();
    const queue = queueThat(async (work) => {
      await writeFile(work.outputPath, Buffer.alloc(0));
      return { status: 'rendered', absolutePath: work.outputPath };
    });
    const result = await renderDesignPreview(ctx, queue);
    expect(result.status).toBe('refused');
    expect(result.status === 'refused' && result.error).toContain('no readable PNG');
  });

  it(`keeps only the newest ${MAX_KEPT_PREVIEWS} previews in the workspace`, async () => {
    const { ctx, previewDirectory } = createHarness();
    const queue = renderingQueue();
    const base = Date.parse('2026-09-10T12:00:00.000Z');
    // One distinct second per render, so the names sort into render order.
    let clock = base;
    const ticking: DesignPreviewContext = { ...ctx, now: () => new Date(clock) };

    for (let index = 0; index < MAX_KEPT_PREVIEWS + 2; index++) {
      clock = base + (index + 1) * 1_000;
      expect(await renderDesignPreview(ticking, queue)).toMatchObject({ status: 'rendered' });
    }

    const kept = readdirSync(previewDirectory).sort();
    expect(kept).toHaveLength(MAX_KEPT_PREVIEWS);
    // The newest survives, and the two oldest were pruned.
    expect(kept[kept.length - 1]?.startsWith(String(clock))).toBe(true);
    expect(kept.some((name) => name.startsWith(String(base + 1_000)))).toBe(false);
    expect(kept.some((name) => name.startsWith(String(base + 2_000)))).toBe(false);
  });

  it('never reads or writes the committed canvas', async () => {
    const { ctx, workdir } = createHarness();
    writeFileSync(path.join(workdir, 'design.json'), '{"the":"user’s own canvas"}');
    const before = readFileSync(path.join(workdir, 'design.json'), 'utf8');

    await renderDesignPreview(ctx, renderingQueue());
    expect(readFileSync(path.join(workdir, 'design.json'), 'utf8')).toBe(before);
  });
});

describe('manual source snapshots', () => {
  it('freezes only the referenced YAML closure and notices same-path asset bytes', async () => {
    const { workdir } = createHarness();
    writeFileSync(path.join(workdir, 'notes.txt'), 'invalid: [');
    writeFileSync(path.join(workdir, 'media', 'unreferenced.bin'), Buffer.alloc(17 * 1024 * 1024));
    const first = await buildPreviewPayload(workdir, {});
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') throw Error(JSON.stringify(first));
    expect(first.dependencies).toEqual([ARTWORK_ENTRY, 'media/pic.png']);
    expect(first.dependencies).not.toContain('design.pptd');
    expect(
      await buildPreviewPayload(workdir, { previousSourceIdentity: first.sourceIdentity })
    ).toMatchObject({ status: 'unchanged', sourceIdentity: first.sourceIdentity });
    const firstAssets = { ...first.assets };
    writeFileSync(path.join(workdir, 'media', 'pic.png'), syntheticPng(64, 64, [0, 200, 0]));
    const second = await buildPreviewPayload(workdir, {});
    expect(second.status).toBe('ok');
    if (second.status !== 'ok') throw Error(JSON.stringify(second));
    expect(second.sourceIdentity).not.toBe(first.sourceIdentity);
    expect(second.assets).not.toEqual(first.assets);
    expect(first.assets).toEqual(firstAssets);
    expect(Object.keys(first.assets)).toHaveLength(1);
  });

  it('refuses mixed observations and incomplete references without modifying the draft', async () => {
    const { workdir } = createHarness();
    const { collectAuthoring } = await import('@molly/design-authoring');
    const first = collectAuthoring(workdir, { referencedOnly: true });
    writeFileSync(path.join(workdir, ARTWORK_ENTRY), PAGE.replace('Hello', 'Intermediate'));
    const second = collectAuthoring(workdir, { referencedOnly: true });
    const reads = [first, second];
    const unstable = await buildPreviewPayload(workdir, { collect: () => reads.shift()! });
    expect(unstable).toMatchObject({
      status: 'refused',
      error: expect.stringContaining('changed during observation'),
    });
    expect(unstable.sourceIdentity).toBeUndefined();
    expect(readFileSync(path.join(workdir, ARTWORK_ENTRY), 'utf8')).toContain('Intermediate');
    writeFileSync(path.join(workdir, ARTWORK_ENTRY), BROKEN_PAGE);
    expect(await buildPreviewPayload(workdir, {})).toMatchObject({
      status: 'refused',
      dependencies: [ARTWORK_ENTRY, 'media/missing.png'],
    });
  });

  it('does not preview or import leftover Kimi PPTD', async () => {
    const { workdir } = createHarness({ artifact: false });
    writeFileSync(path.join(workdir, 'design.pptd'), LEFTOVER_PPTD);
    const leftoverOnly = await buildPreviewPayload(workdir, {});
    expect(leftoverOnly.status).toBe('refused');
    expect(leftoverOnly.error).toMatch(ARTWORK_ENTRY);
    expect(leftoverOnly.dependencies).toEqual([ARTWORK_ENTRY]);
    expect(leftoverOnly.dependencies).not.toContain('design.pptd');
    expect(leftoverOnly.sourceIdentity).toBeUndefined();

    const { workdir: mixed } = createHarness();
    const valid = await buildPreviewPayload(mixed, {});
    expect(valid.status).toBe('ok');
    if (valid.status !== 'ok') throw Error(JSON.stringify(valid));
    writeFileSync(path.join(mixed, 'design.pptd'), LEFTOVER_PPTD);
    const afterLeftover = await buildPreviewPayload(mixed, {
      previousSourceIdentity: valid.sourceIdentity,
    });
    expect(afterLeftover.status).toBe('refused');
    expect(afterLeftover.error).toMatch(/MOLLY-E-PPTD/);
    expect(afterLeftover.sourceIdentity).toBeUndefined();
    expect(afterLeftover.dependencies).toEqual([ARTWORK_ENTRY]);
    expect(afterLeftover.dependencies).not.toContain('design.pptd');
  });
});
