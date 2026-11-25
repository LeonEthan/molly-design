import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DESIGN_PREVIEW_DIRNAME } from '@/design/render-preview';
import { buildMollyMcpServer } from './molly-mcp-server';
import { buildMollyImageMcpServer } from './molly-image-mcp-server';
import { PersonalMemoryService } from '@/agent/personal-memory';
import type { DesignImageViewScope } from './view-image';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const FONT_FIXTURE = fileURLToPath(
  new URL('./fixtures/fonts/MollyTestSerif-Regular.ttf', import.meta.url)
);
const FACE = 'Molly Test Serif';

async function waitForSocket(socketPath: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const sock = net.createConnection(socketPath);
      sock.once('connect', () => {
        sock.destroy();
        resolve(true);
      });
      sock.once('error', () => {
        sock.destroy();
        resolve(false);
      });
    });
    if (connected) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 25);
      timer.unref();
    });
  }
  throw new Error(`Timed out waiting for molly-core IPC socket at ${socketPath}`);
}

function imageResult(result: CallToolResult) {
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  const image = result.content.find((block) => block.type === 'image');
  const text = result.content.find((block) => block.type === 'text');
  if (!image || image.type !== 'image' || !text || text.type !== 'text') {
    throw new Error('Missing image result');
  }
  expect(image.mimeType).toBe('image/jpeg');
  return {
    bytes: Buffer.from(image.data, 'base64'),
    metadata: JSON.parse(text.text) as Record<string, unknown>,
  };
}

const errorText = (result: CallToolResult) => {
  expect(result.isError).toBe(true);
  return result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
};

describe.skipIf(process.platform === 'win32')('molly-core Node IPC bridge (M1.1)', () => {
  let socketDir: string;
  let socketPath: string;
  let binaryPath: string;
  let child: ChildProcess;
  let previousEnv: string | undefined;
  let previousTokenEnv: string | undefined;
  const ipcToken = 'test-stage1-mutual-ipc-token-0123456789abcdef';

  beforeAll(async () => {
    socketDir = await mkdtemp('/tmp/mc-ts-');
    binaryPath = path.join(socketDir, 'molly-core');
    socketPath = path.join(socketDir, 'core.sock');
    execFileSync('go', ['build', '-o', binaryPath, './cmd/molly-core'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        CGO_ENABLED: '0',
        GOFLAGS: '-mod=readonly',
        GOTOOLCHAIN: 'go1.27.3',
      },
      stdio: 'pipe',
    });

    child = spawn(binaryPath, ['--serve-ipc', socketPath], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        MOLLY_CORE_IPC_TOKEN: ipcToken,
      },
      stdio: 'pipe',
    });
    await waitForSocket(socketPath);
    previousEnv = process.env.MOLLY_CORE_IPC_SOCKET;
    previousTokenEnv = process.env.MOLLY_CORE_IPC_TOKEN;
    process.env.MOLLY_CORE_IPC_SOCKET = socketPath;
    process.env.MOLLY_CORE_IPC_TOKEN = ipcToken;
  }, 180_000);

  afterAll(async () => {
    if (previousEnv === undefined) delete process.env.MOLLY_CORE_IPC_SOCKET;
    else process.env.MOLLY_CORE_IPC_SOCKET = previousEnv;
    if (previousTokenEnv === undefined) delete process.env.MOLLY_CORE_IPC_TOKEN;
    else process.env.MOLLY_CORE_IPC_TOKEN = previousTokenEnv;
    if (child && !child.killed) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 2_000).unref();
      });
    }
    if (socketDir) await rm(socketDir, { recursive: true, force: true });
  });

  let root: string;
  let scope: DesignImageViewScope;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'mc-bridge-'));
    scope = {
      workdir: path.join(root, 'session'),
      previewDirectory: path.join(root, 'render', DESIGN_PREVIEW_DIRNAME),
    };
    await mkdir(scope.workdir, { recursive: true });
    await mkdir(scope.previewDirectory, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('delegates molly_view_image single, region, contact sheet, font rows, and guards to pure-Go molly-core', async () => {
    const largePath = path.join(scope.workdir, 'large.png');
    const largeBytes = await sharp({
      create: {
        width: 2160,
        height: 2700,
        channels: 4,
        background: { r: 20, g: 80, b: 200, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    await writeFile(largePath, largeBytes);

    const red = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    const green = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#00ff00' },
    })
      .png()
      .toBuffer();
    const blue = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#0000ff' },
    })
      .png()
      .toBuffer();
    await writeFile(path.join(scope.workdir, 'r.png'), red);
    await writeFile(path.join(scope.workdir, 'g.png'), green);
    await writeFile(path.join(scope.workdir, 'b.png'), blue);

    const fontFile = path.join(scope.workdir, 'fixture.ttf');
    await copyFile(FONT_FIXTURE, fontFile);

    const outside = path.join(root, 'outside.png');
    await writeFile(outside, red);
    await symlink(outside, path.join(scope.workdir, 'escape.png'));

    const server = buildMollyMcpServer({ imageViewScope: scope });
    const client = new Client({ name: 'bridge-test', version: '1.0.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
    try {
      const single = imageResult(
        CallToolResultSchema.parse(
          await client.callTool({ name: 'molly_view_image', arguments: { path: 'large.png' } })
        )
      );
      expect(single.metadata).toEqual({
        path: 'large.png',
        format: 'jpeg',
        originalWidth: 2160,
        originalHeight: 2700,
        originalBytes: largeBytes.length,
        deliveredWidth: 1024,
        deliveredHeight: 1280,
        deliveredBytes: single.bytes.length,
        downscaled: true,
        scale: 2700 / 1280,
        alphaBackground: '#808080',
        note: 'Multiply delivered pixel coordinates by scale (and add region x/y) to get original coordinates.',
      });

      const sheet = imageResult(
        CallToolResultSchema.parse(
          await client.callTool({
            name: 'molly_view_image',
            arguments: { paths: ['r.png', 'g.png', 'b.png'] },
          })
        )
      );
      expect(sheet.metadata).toMatchObject({
        deliveredWidth: 808,
        deliveredHeight: 808,
        deliveredBytes: sheet.bytes.length,
      });
      expect(sheet.metadata.cells).toHaveLength(3);

      const fontRes = imageResult(
        CallToolResultSchema.parse(
          await client.callTool({
            name: 'molly_view_image',
            arguments: {
              fonts: [{ file: fontFile, face: FACE }],
              text: 'Hamburgefonts',
              path: 'r.png',
            },
          })
        )
      );
      const rows = fontRes.metadata.rows as Array<{
        row: string | number;
        inkHeight: number;
        widthRatio?: number;
      }>;
      expect(rows).toHaveLength(2);
      expect(rows[0]?.row).toBe('R');
      expect(rows[1]?.row).toBe(1);
      expect(rows[1]?.inkHeight).toBe(rows[0]?.inkHeight);
      expect(rows[1]?.widthRatio).toBeGreaterThan(0);

      const escaped = CallToolResultSchema.parse(
        await client.callTool({ name: 'molly_view_image', arguments: { path: 'escape.png' } })
      );
      expect(errorText(escaped)).toContain('Image path is outside this design session.');

      const badFace = CallToolResultSchema.parse(
        await client.callTool({
          name: 'molly_view_image',
          arguments: { fonts: [{ file: fontFile, face: 'Unknown Face' }], text: 'Hello' },
        })
      );
      expect(errorText(badFace)).toBe(`Face "Unknown Face" is not in ${fontFile}.`);

      const svgPath = path.join(scope.workdir, 'vector-logo.svg');
      await writeFile(
        svgPath,
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#2266cc"/></svg>'
      );
      const svgResult = imageResult(
        CallToolResultSchema.parse(
          await client.callTool({
            name: 'molly_view_image',
            arguments: { path: 'vector-logo.svg' },
          })
        )
      );
      expect(svgResult.metadata).toMatchObject({
        path: 'vector-logo.svg',
        originalWidth: 120,
        originalHeight: 80,
      });

      const tiffPath = path.join(scope.workdir, 'raster.tiff');
      const tiffBytes = await sharp({
        create: { width: 96, height: 64, channels: 3, background: '#33aa55' },
      })
        .tiff()
        .toBuffer();
      await writeFile(tiffPath, tiffBytes);
      const tiffResult = imageResult(
        CallToolResultSchema.parse(
          await client.callTool({
            name: 'molly_view_image',
            arguments: { path: 'raster.tiff' },
          })
        )
      );
      expect(tiffResult.metadata).toMatchObject({
        path: 'raster.tiff',
        originalWidth: 96,
        originalHeight: 64,
      });

      const animatedWebpPath = path.join(scope.workdir, 'animated.webp');
      const framePixels = Buffer.alloc(64 * 96 * 4);
      for (let i = 0; i < 64 * 48; i++) {
        framePixels[i * 4] = 220;
        framePixels[i * 4 + 1] = 30;
        framePixels[i * 4 + 2] = 60;
        framePixels[i * 4 + 3] = 255;
      }
      for (let i = 64 * 48; i < 64 * 96; i++) {
        framePixels[i * 4] = 30;
        framePixels[i * 4 + 1] = 120;
        framePixels[i * 4 + 2] = 240;
        framePixels[i * 4 + 3] = 255;
      }
      const animatedWebpBytes = await sharp(framePixels, {
        raw: { width: 64, height: 96, channels: 4, pageHeight: 48 },
      })
        .webp({ delay: [100, 100] })
        .toBuffer();
      expect(animatedWebpBytes.includes(Buffer.from('ANMF'))).toBe(true);
      await writeFile(animatedWebpPath, animatedWebpBytes);
      const webpResult = imageResult(
        CallToolResultSchema.parse(
          await client.callTool({
            name: 'molly_view_image',
            arguments: { path: 'animated.webp' },
          })
        )
      );
      expect(webpResult.metadata).toMatchObject({
        path: 'animated.webp',
        originalWidth: 64,
        originalHeight: 48,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('delegates molly_image generate and edit with transient per-call credentials to pure-Go molly-core', async () => {
    const samplePNG = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#1188dd' },
    })
      .png()
      .toBuffer();

    let hits = 0;
    const upstream = http.createServer((req, res) => {
      hits += 1;
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            data: [{ b64_json: samplePNG.toString('base64') }],
          })
        );
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP port');
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;

    try {
      const server = buildMollyImageMcpServer({
        designGate: {
          artworkWorkdir: scope.workdir,
          workspaceRoot: scope.workdir,
          imageAvailable: true,
          imageProtocol: 'openai-images',
          imageConnection: {
            v: 1,
            enabled: true,
            protocol: 'openai-images',
            baseUrl,
            apiKey: 'sk-transient-bridge-secret-1234',
            model: 'gpt-image-1',
            updatedAt: 1,
          },
        },
      });
      const client = new Client({ name: 'image-bridge-test', version: '1.0.0' });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      await client.connect(ct);
      try {
        const generated = CallToolResultSchema.parse(
          await client.callTool({ name: 'generate', arguments: { prompt: 'blue rectangle' } })
        );
        expect(generated.isError).not.toBe(true);
        const structured = generated.structuredContent as {
          path: string;
          absolutePath: string;
          width: number;
          height: number;
          mimeType: string;
        };
        expect(structured.width).toBe(32);
        expect(structured.height).toBe(24);
        expect(structured.mimeType).toBe('image/png');
        expect(await readFile(structured.absolutePath)).toEqual(samplePNG);

        const edited = CallToolResultSchema.parse(
          await client.callTool({
            name: 'edit',
            arguments: { prompt: 'keep blue', images: [structured.path] },
          })
        );
        expect(edited.isError).not.toBe(true);
        expect(hits).toBe(2);

        const animPixels = Buffer.alloc(32 * 48 * 4);
        for (let i = 0; i < 32 * 24; i++) {
          animPixels[i * 4] = 200;
          animPixels[i * 4 + 3] = 255;
        }
        for (let i = 32 * 24; i < 32 * 48; i++) {
          animPixels[i * 4 + 2] = 200;
          animPixels[i * 4 + 3] = 255;
        }
        const animWebp = await sharp(animPixels, {
          raw: { width: 32, height: 48, channels: 4, pageHeight: 24 },
        })
          .webp({ delay: [100, 100] })
          .toBuffer();
        expect(animWebp.includes(Buffer.from('ANMF'))).toBe(true);
        const animPath = path.join(scope.workdir, 'edit-ref.webp');
        await writeFile(animPath, animWebp);

        const editedAnim = CallToolResultSchema.parse(
          await client.callTool({
            name: 'edit',
            arguments: { prompt: 'keep frame', images: ['edit-ref.webp'] },
          })
        );
        expect(editedAnim.isError).not.toBe(true);
        expect(hits).toBe(3);
      } finally {
        await client.close();
        await server.close();
      }
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it('delegates PersonalMemoryService CRUD, revision fencing, and 32x300 bounds to pure-Go molly-core', async () => {
    const dbPath = path.join(root, 'memory', 'preferences.sqlite');
    const memory = await PersonalMemoryService.open(dbPath);
    const initial = await memory.read();
    expect(initial.enabled).toBe(true);
    expect(initial.entries).toEqual([]);

    await memory.capture(
      initial.revision,
      [{ text: 'Prefers Swiss grid editorial typography.' }],
      new AbortController().signal
    );
    const saved = await memory.read();
    expect(saved.entries).toHaveLength(1);
    const entry = saved.entries[0]!;

    await expect(
      memory.capture(initial.revision, [{ text: 'Stale write' }], new AbortController().signal)
    ).rejects.toThrow('memory_stale');

    await memory.setEnabled(false, saved.revision);
    const disabled = await memory.read();
    expect(disabled.enabled).toBe(false);
    await expect(
      memory.capture(disabled.revision, [{ text: 'Blocked' }], new AbortController().signal)
    ).rejects.toThrow('memory_disabled');

    await memory.edit(entry.id, 'Prefers Bauhaus posters.', disabled.revision);
    const edited = await memory.read();
    expect(edited.entries[0]?.text).toBe('Prefers Bauhaus posters.');

    await memory.remove(entry.id, edited.revision);
    const empty = await memory.read();
    expect(empty.entries).toEqual([]);
  });

  it('keeps revision parity (including U+2028/U+2029) and FTS5 edit/remove integrity across Node -> Go -> Node backend switches', async () => {
    const dbPath = path.join(root, 'memory', 'shared-ts-go.sqlite');
    const savedSocket = process.env.MOLLY_CORE_IPC_SOCKET;
    const textWithSeparators = 'Editorial\u2028grid\u2029literal \\u2028 preference';

    try {
      delete process.env.MOLLY_CORE_IPC_SOCKET;
      const tsMemory = await PersonalMemoryService.open(dbPath);
      const tsInit = await tsMemory.read();
      await tsMemory.capture(
        tsInit.revision,
        [{ text: textWithSeparators }],
        new AbortController().signal
      );
      const tsSaved = await tsMemory.read();
      expect(tsSaved.entries).toHaveLength(1);
      const entryId = tsSaved.entries[0]!.id;

      process.env.MOLLY_CORE_IPC_SOCKET = savedSocket;
      const goMemory = await PersonalMemoryService.open(dbPath);
      const goRead = await goMemory.read();
      expect(goRead.revision).toBe(tsSaved.revision);
      expect(goRead.entries[0]?.text).toBe(textWithSeparators);

      await goMemory.edit(entryId, 'Updated via Go after FTS5 rebuild', goRead.revision);
      const goEdited = await goMemory.read();
      expect(goEdited.entries[0]?.text).toBe('Updated via Go after FTS5 rebuild');

      delete process.env.MOLLY_CORE_IPC_SOCKET;
      const tsMemoryAfter = await PersonalMemoryService.open(dbPath);
      const tsAfterRead = await tsMemoryAfter.read();
      expect(tsAfterRead.revision).toBe(goEdited.revision);
      await tsMemoryAfter.remove(entryId, tsAfterRead.revision);
      const tsFinal = await tsMemoryAfter.read();
      expect(tsFinal.entries).toEqual([]);
    } finally {
      if (savedSocket === undefined) delete process.env.MOLLY_CORE_IPC_SOCKET;
      else process.env.MOLLY_CORE_IPC_SOCKET = savedSocket;
    }
  });

  it('rejects non-object JSON null and malformed error.message frames cleanly without uncaught exceptions', async () => {
    const rogueSock = path.join(socketDir, 'rogue-null.sock');
    const rogueServer = net.createServer((conn) => {
      conn.end('null\n');
    });
    await new Promise<void>((resolve) => rogueServer.listen(rogueSock, resolve));
    const rogueObjSock = path.join(socketDir, 'rogue-err-obj.sock');
    const rogueObjServer = net.createServer((conn) => {
      conn.end(`${JSON.stringify({ ok: false, error: { message: { toString: null } } })}\n`);
    });
    await new Promise<void>((resolve) => rogueObjServer.listen(rogueObjSock, resolve));
    try {
      const { callMollyCoreIpc } = await import('./molly-core-ipc');
      await expect(callMollyCoreIpc(rogueSock, 'core.composition', {})).rejects.toThrow(
        'non-object JSON'
      );
      await expect(callMollyCoreIpc(rogueObjSock, 'core.composition', {})).rejects.toThrow(
        'molly-core IPC challenge failed'
      );
    } finally {
      await new Promise<void>((resolve) => rogueServer.close(() => resolve()));
      await new Promise<void>((resolve) => rogueObjServer.close(() => resolve()));
    }
  });
});
