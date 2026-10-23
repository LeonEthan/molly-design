import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SessionIdSchema } from '@molly/shared';
import { DESIGN_PREVIEW_DIRNAME } from '@/design/render-preview';
import { buildMollyMcpServer } from './molly-mcp-server';
import { resolveDesignImageViewScope } from './design-tools';
import { ViewImageInputSchema, type DesignImageViewScope } from './view-image';

const DESCRIPTION =
  'View one image, one region of an image, up to nine images as a numbered contact sheet, or up to eight installed font faces rendered with the same text under a reference region (fonts + text). Returns a bounded JPEG (long edge at most 1280 px) plus the original size and bytes, so viewing never puts a full-size file into context. Use region with original pixel coordinates to inspect detail at native resolution. Read-only; it never changes files. Image paths must be inside this design session; font files may also come from the system font directories.';

const FONT_FIXTURE = fileURLToPath(
  new URL('./fixtures/fonts/MollyTestSerif-Regular.ttf', import.meta.url)
);
const FACE = 'Molly Test Serif';
const FontRowsMetadataSchema = z.object({
  rows: z.array(
    z.object({
      row: z.union([z.string(), z.number()]),
      path: z.string().optional(),
      file: z.string().optional(),
      face: z.string().optional(),
      inkWidth: z.number(),
      inkHeight: z.number(),
      widthRatio: z.number().optional(),
      downscaled: z.boolean().optional(),
      deliveredInkWidth: z.number().optional(),
      deliveredInkHeight: z.number().optional(),
    })
  ),
});

async function withViewer(
  scope: DesignImageViewScope | undefined,
  run: (client: Client) => Promise<void>
) {
  const server = buildMollyMcpServer({ imageViewScope: scope });
  const client = new Client({ name: 'view-image-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

const call = async (client: Client, input: Record<string, unknown>) =>
  CallToolResultSchema.parse(await client.callTool({ name: 'molly_view_image', arguments: input }));

function imageResult(result: CallToolResult) {
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  expect(result.content.filter((block) => block.type === 'image')).toHaveLength(1);
  const image = result.content.find((block) => block.type === 'image');
  const text = result.content.find((block) => block.type === 'text');
  if (!image || image.type !== 'image' || !text || text.type !== 'text')
    throw new Error('Missing image result');
  expect(image.mimeType).toBe('image/jpeg');
  return {
    bytes: Buffer.from(image.data, 'base64'),
    metadata: z.record(z.string(), z.unknown()).parse(JSON.parse(text.text)),
  };
}

const errorText = (result: CallToolResult) => {
  expect(result.isError).toBe(true);
  expect(result.content.every((block) => block.type === 'text')).toBe(true);
  return result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
};

async function solid(file: string, width: number, height: number, background: string) {
  const bytes = await sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer();
  await writeFile(file, bytes);
  return bytes;
}

async function withGateAnswer(
  root: string,
  result: unknown,
  run: (scope: DesignImageViewScope | undefined) => Promise<void>
) {
  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, result }));
    });
  });
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\view-image-${randomUUID()}`
      : path.join(root, `${randomUUID()}.sock`);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  try {
    await run(
      await resolveDesignImageViewScope({
        machineId: 'machine',
        workspaceId: 'workspace',
        sessionId: SessionIdSchema.parse('view-image-session'),
        localControlSocketPath: socketPath,
      })
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('molly_view_image', () => {
  let root: string;
  let scope: DesignImageViewScope;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'view-image-'));
    scope = {
      workdir: path.join(root, 'session'),
      previewDirectory: path.join(root, 'render', DESIGN_PREVIEW_DIRNAME),
    };
    await mkdir(scope.workdir);
    await mkdir(scope.previewDirectory, { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function fontFixture() {
    const file = path.join(scope.workdir, 'fixture.ttf');
    await copyFile(FONT_FIXTURE, file);
    return { file, face: FACE };
  }

  it('accepts font mode with an optional reference and strictly validates all three modes', async () => {
    const font = await fontFixture();
    for (const input of [
      { fonts: [font], text: 'Hello' },
      { fonts: [font], text: 'Hello', path: 'ref.png' },
      {
        fonts: [font],
        text: 'Hello',
        path: 'ref.png',
        region: { x: 0, y: 0, width: 10, height: 10 },
      },
    ])
      expect(ViewImageInputSchema.safeParse(input).success).toBe(true);
    for (const input of [
      { fonts: [font] },
      { fonts: [font], text: '' },
      { fonts: [font], text: 'a'.repeat(61) },
      { fonts: [], text: 'Hello' },
      { fonts: Array.from({ length: 9 }, () => font), text: 'Hello' },
      { fonts: [{ ...font, face: '' }], text: 'Hello' },
      { fonts: [{ ...font, face: 'a'.repeat(121) }], text: 'Hello' },
      { fonts: [{ ...font, index: 0 }], text: 'Hello' },
      { fonts: [font], paths: ['a', 'b'], text: 'Hello' },
      { fonts: [font], path: 'a', paths: ['a', 'b'], text: 'Hello' },
      { fonts: [font], text: 'Hello', region: { x: 0, y: 0, width: 10, height: 10 } },
      { path: 'a', text: 'Hello' },
      { paths: ['a', 'b'], text: 'Hello' },
      { text: 'Hello' },
    ])
      expect(ViewImageInputSchema.safeParse(input).success).toBe(false);
  });

  it('renders a reference crop and two font rows at equal ink height with width ratios and labels', async () => {
    const font = await fontFixture();
    const ink = await sharp({
      text: { text: 'Hamburgefonts', fontfile: font.file, font: `${FACE} 96`, dpi: 72, rgba: true },
    })
      .trim()
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer({ resolveWithObject: true });
    const reference = path.join(scope.workdir, 'reference.png');
    await writeFile(
      reference,
      await sharp({
        create: {
          width: ink.info.width + 40,
          height: ink.info.height + 40,
          channels: 3,
          background: '#ffffff',
        },
      })
        .composite([{ input: ink.data, left: 20, top: 20 }])
        .png()
        .toBuffer()
    );
    const region = { x: 10, y: 10, width: ink.info.width + 20, height: ink.info.height + 20 };
    const originalFont = await readFile(font.file);
    const originalReference = await readFile(reference);
    await withViewer(scope, async (client) => {
      const { bytes, metadata } = imageResult(
        await call(client, { fonts: [font, font], text: 'Hamburgefonts', path: reference, region })
      );
      const { rows } = FontRowsMetadataSchema.parse(metadata);
      const height = Math.max(48, Math.min(120, ink.info.height));
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.row)).toEqual(['R', 1, 2]);
      expect(rows.map((row) => row.inkHeight)).toEqual([height, height, height]);
      expect(rows[0]).toMatchObject({ path: reference });
      for (const row of rows.slice(1)) {
        expect(row).toMatchObject({ file: font.file, face: FACE });
        expect(row.widthRatio).toBe(row.inkWidth / (rows[0]?.inkWidth ?? 0));
      }
      expect(metadata).toMatchObject({
        text: 'Hamburgefonts',
        deliveredHeight: height * 3 + 16,
        deliveredBytes: bytes.length,
      });
      expect(await sharp(bytes).metadata()).toMatchObject({
        width: metadata.deliveredWidth,
        height: metadata.deliveredHeight,
      });
      for (const index of [0, 1, 2]) {
        const label = await sharp(bytes)
          .extract({ left: 0, top: index * (height + 8), width: 32, height: 28 })
          .raw()
          .toBuffer();
        expect([...label].some((value) => value < 50)).toBe(true);
      }
    });
    expect(await readFile(font.file)).toEqual(originalFont);
    expect(await readFile(reference)).toEqual(originalReference);
  });

  it('escapes Pango markup and renders literal <&> and quotes without a reference', async () => {
    const font = await fontFixture();
    const literal = '<&>"';
    const expectedInk = await sharp({
      text: {
        text: '&lt;&amp;&gt;&quot;',
        fontfile: font.file,
        font: `${FACE} 96`,
        dpi: 72,
        rgba: true,
      },
    })
      .trim()
      .raw()
      .toBuffer({ resolveWithObject: true });
    await withViewer(scope, async (client) => {
      const { bytes, metadata } = imageResult(await call(client, { fonts: [font], text: literal }));
      const { rows } = FontRowsMetadataSchema.parse(metadata);
      expect(rows).toEqual([
        {
          row: 1,
          file: font.file,
          face: FACE,
          inkWidth: Math.round((expectedInk.info.width * 96) / expectedInk.info.height),
          inkHeight: 96,
        },
      ]);
      expect(metadata).toMatchObject({
        text: literal,
        deliveredHeight: 96,
        deliveredBytes: bytes.length,
      });
      const ink = await sharp(bytes)
        .extract({ left: 32, top: 0, width: Number(metadata.deliveredWidth) - 32, height: 96 })
        .raw()
        .toBuffer();
      expect([...ink].some((value) => value < 30)).toBe(true);
    });
  });

  it('bounds wide rows uniformly and reports their delivered ink sizes', async () => {
    const font = await fontFixture();
    await withViewer(scope, async (client) => {
      const { bytes, metadata } = imageResult(
        await call(client, { fonts: [font], text: 'W'.repeat(60) })
      );
      const { rows } = FontRowsMetadataSchema.parse(metadata);
      expect(metadata).toMatchObject({ deliveredWidth: 1280, deliveredHeight: 96 });
      expect(rows[0]).toMatchObject({ downscaled: true, inkHeight: 96, deliveredInkWidth: 1248 });
      expect(rows[0]?.deliveredInkHeight).toBeLessThan(96);
      expect(await sharp(bytes).metadata()).toMatchObject({ width: 1280, height: 96 });
    });
  });

  it('renders a face from a TTC collection using its absolute table offsets', async () => {
    const sfnt = Buffer.from(await readFile(FONT_FIXTURE));
    const header = Buffer.alloc(16);
    header.write('ttcf');
    header.writeUInt32BE(0x00010000, 4);
    header.writeUInt32BE(1, 8);
    header.writeUInt32BE(16, 12);
    for (let index = 0; index < sfnt.readUInt16BE(4); index++) {
      const entry = 12 + index * 16 + 8;
      sfnt.writeUInt32BE(sfnt.readUInt32BE(entry) + 16, entry);
    }
    const file = path.join(scope.workdir, 'fixture.ttc');
    await writeFile(file, Buffer.concat([header, sfnt]));
    await withViewer(scope, async (client) => {
      const { metadata } = imageResult(
        await call(client, { fonts: [{ file, face: FACE }], text: 'Hello' })
      );
      expect(FontRowsMetadataSchema.parse(metadata).rows[0]).toMatchObject({
        row: 1,
        file,
        face: FACE,
        inkHeight: 96,
      });
    });
  });

  it('rejects fonts outside workdir and system roots, preview fonts and symlink escapes', async () => {
    const font = await fontFixture();
    const outside = path.join(root, 'outside.ttf');
    const preview = path.join(scope.previewDirectory, 'fixture.ttf');
    await copyFile(font.file, outside);
    await copyFile(font.file, preview);
    const escape = path.join(scope.workdir, 'escape.ttf');
    await symlink(outside, escape);
    await symlink(
      root,
      path.join(scope.workdir, 'escape-directory'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await withViewer(scope, async (client) => {
      for (const file of [
        outside,
        preview,
        escape,
        path.join(scope.workdir, 'escape-directory', 'outside.ttf'),
      ])
        expect(
          errorText(await call(client, { fonts: [{ file, face: FACE }], text: 'Hello' }))
        ).toBe('Font path is outside the system font directories and this design session.');
      expect(
        errorText(
          await call(client, { fonts: [{ file: 'fixture.ttf', face: FACE }], text: 'Hello' })
        )
      ).toBe('Font file path must be absolute.');
      const wrongExtension = path.join(scope.workdir, 'fixture.woff2');
      await copyFile(font.file, wrongExtension);
      expect(
        errorText(
          await call(client, { fonts: [{ file: wrongExtension, face: FACE }], text: 'Hello' })
        )
      ).toBe('Font file must be .ttf, .otf or .ttc.');
      const directory = path.join(scope.workdir, 'directory.ttf');
      await mkdir(directory);
      expect(
        errorText(await call(client, { fonts: [{ file: directory, face: FACE }], text: 'Hello' }))
      ).toBe('Font path must be a regular file.');
    });
  });

  it('fails the entire call for unknown faces, corrupt fonts or an invalid reference region', async () => {
    const font = await fontFixture();
    const invalid = path.join(scope.workdir, 'invalid.ttf');
    await writeFile(invalid, 'not a font');
    await solid(path.join(scope.workdir, 'ref.png'), 20, 20, '#ffffff');
    await withViewer(scope, async (client) => {
      expect(
        errorText(
          await call(client, {
            fonts: [font, { ...font, face: 'Molly Unknown Face' }],
            text: 'Hello',
          })
        )
      ).toBe(`Face "Molly Unknown Face" is not in ${font.file}.`);
      expect(
        errorText(await call(client, { fonts: [{ file: invalid, face: FACE }], text: 'Hello' }))
      ).toBe(`Cannot render ${invalid} as "${FACE}".`);
      expect(
        errorText(
          await call(client, {
            fonts: [font],
            text: 'Hello',
            path: 'ref.png',
            region: { x: 10, y: 10, width: 20, height: 20 },
          })
        )
      ).toBe('Region is outside the image.');
    });
  });
  it('delivers a 2160×2700 PNG as a 1024×1280 JPEG with exact byte metadata without changing the file', async () => {
    const file = path.join(scope.workdir, 'large.png');
    const original = await solid(file, 2160, 2700, '#123456');
    await withViewer(scope, async (client) => {
      const { bytes, metadata } = imageResult(await call(client, { path: 'large.png' }));
      expect(await sharp(bytes).metadata()).toMatchObject({
        format: 'jpeg',
        width: 1024,
        height: 1280,
      });
      expect(metadata).toEqual({
        path: 'large.png',
        format: 'jpeg',
        originalWidth: 2160,
        originalHeight: 2700,
        originalBytes: original.length,
        deliveredWidth: 1024,
        deliveredHeight: 1280,
        deliveredBytes: bytes.length,
        downscaled: true,
        scale: 2700 / 1280,
        note: 'Multiply delivered pixel coordinates by scale (and add region x/y) to get original coordinates.',
      });
    });
    expect(await readFile(file)).toEqual(original);
  });

  it('does not enlarge an 800×600 image', async () => {
    await solid(path.join(scope.workdir, 'small.png'), 800, 600, '#123456');
    await withViewer(scope, async (client) => {
      const { bytes, metadata } = imageResult(await call(client, { path: 'small.png' }));
      expect(await sharp(bytes).metadata()).toMatchObject({ width: 800, height: 600 });
      expect(metadata).toMatchObject({ downscaled: false, scale: 1 });
    });
  });

  it('crops a 600×300 region using original coordinates at native resolution', async () => {
    const file = path.join(scope.workdir, 'region.png');
    const patch = await sharp({
      create: { width: 600, height: 300, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    const original = await sharp({
      create: { width: 2160, height: 2700, channels: 3, background: '#0000ff' },
    })
      .composite([{ input: patch, left: 100, top: 200 }])
      .png()
      .toBuffer();
    await writeFile(file, original);
    const region = { x: 100, y: 200, width: 600, height: 300 };
    await withViewer(scope, async (client) => {
      const { bytes, metadata } = imageResult(await call(client, { path: file, region }));
      expect(await sharp(bytes).metadata()).toMatchObject({ width: 600, height: 300 });
      expect(metadata).toMatchObject({
        originalWidth: 2160,
        originalHeight: 2700,
        region,
        downscaled: false,
        scale: 1,
      });
      const { data } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      expect(data[0]).toBeGreaterThan(250);
      expect(data[2]).toBeLessThan(5);
    });
    expect(await readFile(file)).toEqual(original);
  });

  it('refuses out-of-bounds regions and schema-invalid coordinates and combinations', async () => {
    await solid(path.join(scope.workdir, 'region.png'), 2160, 2700, '#123456');
    await withViewer(scope, async (client) => {
      expect(
        errorText(
          await call(client, {
            path: 'region.png',
            region: { x: 2100, y: 0, width: 600, height: 300 },
          })
        )
      ).toContain('Region is outside the image.');
      for (const input of [
        {},
        { path: 'a', paths: ['a', 'b'] },
        { paths: ['a', 'b'], region: { x: 0, y: 0, width: 1, height: 1 } },
        { path: 'a', full_resolution: true },
        { path: 'a', region: { x: -1, y: 0, width: 1, height: 1 } },
        { path: 'a', region: { x: 0.5, y: 0, width: 1, height: 1 } },
        { path: 'a', region: { x: 0, y: 0, width: 0, height: 1 } },
      ])
        expect(ViewImageInputSchema.safeParse(input).success).toBe(false);
    });
  });

  it('places three numbered cells in two columns with white gaps and refuses ten images', async () => {
    const files = ['red.png', 'green.png', 'blue.png'];
    const colors = ['#ff0000', '#00ff00', '#0000ff'];
    const cells = [];
    for (const [index, file] of files.entries()) {
      const color = colors[index];
      if (!color) throw new Error('Missing fixture color');
      const original = await solid(path.join(scope.workdir, file), 800, 600, color);
      cells.push({
        index: index + 1,
        path: file,
        originalWidth: 800,
        originalHeight: 600,
        originalBytes: original.length,
      });
    }
    await withViewer(scope, async (client) => {
      const { bytes, metadata } = imageResult(await call(client, { paths: files }));
      expect(await sharp(bytes).metadata()).toMatchObject({
        format: 'jpeg',
        width: 808,
        height: 808,
      });
      expect(metadata).toEqual({
        cells,
        deliveredWidth: 808,
        deliveredHeight: 808,
        deliveredBytes: bytes.length,
        note: 'Cells are numbered left to right, top to bottom. Use path with region to look closer at one image.',
      });
      for (const [left, top, channel] of [
        [200, 200, 0],
        [608, 200, 1],
        [200, 608, 2],
      ]) {
        if (left === undefined || top === undefined || channel === undefined)
          throw new Error('Missing fixture coordinate');
        const { data } = await sharp(bytes)
          .extract({ left, top, width: 1, height: 1 })
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect(data[channel]).toBeGreaterThan(250);
        for (const [index, value] of data.entries())
          if (index !== channel) expect(value).toBeLessThan(5);
      }
      const { data: gap } = await sharp(bytes)
        .extract({ left: 403, top: 403, width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect([...gap].every((value) => value > 245)).toBe(true);
      for (const [left, top] of [
        [0, 0],
        [408, 0],
        [0, 408],
      ]) {
        if (left === undefined || top === undefined) throw new Error('Missing fixture label');
        const { data } = await sharp(bytes)
          .extract({ left, top, width: 32, height: 28 })
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect([...data].some((value) => value < 30)).toBe(true);
      }
      expect(errorText(await call(client, { paths: Array<string>(10).fill('red.png') }))).toContain(
        '9'
      );
    });
    expect(ViewImageInputSchema.safeParse({ paths: Array<string>(10).fill('a') }).success).toBe(
      false
    );
  });

  it('flattens transparent PNG onto gray and reports it in metadata', async () => {
    const file = path.join(scope.workdir, 'transparent.png');
    const original = await sharp({
      create: { width: 100, height: 80, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    await writeFile(file, original);
    await withViewer(scope, async (client) => {
      const { bytes, metadata } = imageResult(await call(client, { path: file }));
      expect(metadata).toMatchObject({ format: 'jpeg', alphaBackground: '#808080' });
      expect(await sharp(bytes).metadata()).toMatchObject({ hasAlpha: false });
      const { data } = await sharp(bytes)
        .extract({ left: 50, top: 40, width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect([...data].every((value) => Math.abs(value - 128) <= 2)).toBe(true);
    });
    expect(await readFile(file)).toEqual(original);
  });

  it('registers only for daemon-resolved design sessions and scopes paths to that session and its previews', async () => {
    const outside = path.join(root, 'outside.png');
    const preview = path.join(scope.previewDirectory, 'preview.png');
    await solid(outside, 80, 60, '#123456');
    await solid(preview, 80, 60, '#123456');
    await symlink(outside, path.join(scope.workdir, 'escape.png'));
    await symlink(
      root,
      path.join(scope.workdir, 'escape-directory'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const answer = {
      type: 'design/image-connection',
      connection: null,
      ready: false,
      available: false,
      credential: null,
    };
    await withGateAnswer(root, answer, async (absent) => {
      expect(absent).toBeUndefined();
      await withViewer(absent, async (client) => {
        expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain(
          'molly_view_image'
        );
      });
    });
    await withGateAnswer(
      root,
      {
        ...answer,
        workspaceRoot: scope.workdir,
        artworkWorkdir: path.dirname(scope.previewDirectory),
      },
      async (resolved) => {
        expect(resolved).toEqual(scope);
        await withViewer(resolved, async (client) => {
          const tools = (await client.listTools()).tools;
          expect(tools.find((tool) => tool.name === 'molly_view_image')?.description).toBe(
            DESCRIPTION
          );
          expect(tools.map((tool) => tool.name)).not.toContain('molly_render_preview');
          imageResult(await call(client, { path: preview }));
          for (const file of [
            outside,
            '../outside.png',
            'escape.png',
            'escape-directory/outside.png',
          ])
            expect(errorText(await call(client, { path: file }))).toContain(
              'Image path is outside this design session.'
            );
          await rm(scope.previewDirectory, { recursive: true });
          await symlink(
            root,
            scope.previewDirectory,
            process.platform === 'win32' ? 'junction' : 'dir'
          );
          expect(
            errorText(
              await call(client, { path: path.join(scope.previewDirectory, 'outside.png') })
            )
          ).toContain('Image path is outside this design session.');
        });
      }
    );
  });

  it('fails the whole call on an undecodable file without returning source bytes', async () => {
    await writeFile(path.join(scope.workdir, 'invalid.png'), 'synthetic invalid image');
    await solid(path.join(scope.workdir, 'valid.png'), 80, 60, '#123456');
    await withViewer(scope, async (client) => {
      expect(errorText(await call(client, { path: 'invalid.png' }))).toBe(
        'Cannot decode invalid.png.'
      );
      expect(errorText(await call(client, { paths: ['valid.png', 'invalid.png'] }))).toBe(
        'Cannot decode invalid.png.'
      );
    });
  });
});
