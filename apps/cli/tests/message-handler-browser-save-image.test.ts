import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, test, vi } from 'vitest';
import { LocalMachineRpcRequestSchema, type WorkspaceId } from '@molly/shared';
import { MessageHandler } from '../src/lib/message-handler';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { SessionManager } from '../src/session/session-manager';
import type { Logger } from '../src/utils/logger';
import {
  IMAGE_GENERATION_MAX_IMAGE_BYTES,
  writeGeneratedImageAsset,
} from '../src/mcp/image-generation';
import { createTestCloudPort } from './test-cloud-port';

const hooks = vi.hoisted(() => ({ afterNormalize: undefined as undefined | (() => void) }));
vi.mock('../src/browser/save-image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/browser/save-image')>();
  return {
    normalizeBrowserImage: async (bytes: Buffer) => {
      const result = await actual.normalizeBrowserImage(bytes);
      hooks.afterNormalize?.();
      return result;
    },
  };
});

const directories: string[] = [];
afterEach(async () => {
  hooks.afterNormalize = undefined;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});
const silent = (): Logger => ({
  info() {},
  warn() {},
  error() {},
  success() {},
  debug() {},
  setLevel() {},
  child: () => silent(),
  close: async () => {},
});
const image = () => sharp({ create: { width: 7, height: 5, channels: 4, background: '#123456' } });

async function fixture() {
  const workdir = await mkdtemp(path.join(tmpdir(), 'molly-browser-save-'));
  directories.push(workdir);
  let activeRun: string | undefined = 'turn-1';
  const handler = new MessageHandler(
    { on() {}, setRequestPermissionHandler() {} } as unknown as SessionManager,
    {
      repo: { watch: () => ({ unsubscribe() {} }), getDocMeta: async () => undefined },
    } as unknown as LoroDocumentManager,
    silent(),
    {
      token: 'synthetic',
      workspaceId: 'workspace-1' as WorkspaceId,
      userId: 'user-1',
      machineId: 'machine-1',
      machineName: 'synthetic',
      cliVersion: '0.0.0',
      cloudPort: createTestCloudPort(),
    }
  );
  Object.assign(handler, {
    executionService: {
      getActiveInvocationContext: () => (activeRun ? { sourceTurnId: activeRun } : undefined),
    },
    sessionManager: {
      getSession: () => ({
        agentClient: {},
        getDesignHookLaunchId: () => '12000000-0000-4000-8000-000000000001',
      }),
    },
    readDesignSession: async () => ({ artworkId: 'artwork-1' }),
    resolveActiveDesignContext: async () => ({ artifactWorkdir: workdir }),
  });
  const save = (bytes: Buffer, beforeResult?: () => void) => {
    Object.assign(handler, {
      browserHost: {
        enqueue: async () => {
          beforeResult?.();
          return {
            ok: true,
            reply: {
              kind: 'asset',
              base64: bytes.toString('base64'),
              mimeType: 'image/jpeg',
              pageUrl: 'https://example.com',
              imageUrl: 'https://example.com/image',
            },
          };
        },
      },
    });
    return handler.handleLocalMachineRpc(
      LocalMachineRpcRequestSchema.parse({
        machineId: 'machine-1',
        workspaceId: 'workspace-1',
        ownerSessionId: 'session-1',
        method: 'browser/execute',
        params: {
          launchId: '12000000-0000-4000-8000-000000000001',
          requestId: '11000000-0000-4000-8000-000000000001',
          command: {
            kind: 'save_image',
            ref: 'e1',
            observationId: '13000000-0000-4000-8000-000000000001',
          },
        },
      })
    );
  };
  return {
    workdir,
    save,
    endRun: () => {
      activeRun = undefined;
    },
  };
}

test.each(['webp', 'avif'] as const)(
  '%s browser save publishes PNG with original dimensions',
  async (format) => {
    const context = await fixture();
    const bytes = await image().toFormat(format).toBuffer();
    const result = await context.save(bytes);
    if (
      !result.ok ||
      result.result.type !== 'browser/execute' ||
      !result.result.ok ||
      result.result.reply.kind !== 'saved_image'
    )
      throw new Error(JSON.stringify(result));
    const reply = result.result.reply;
    expect(reply).toMatchObject({ mimeType: 'image/png', width: 7, height: 5 });
    expect(reply.path).toMatch(/\.png$/);
    const saved = await readFile(path.join(context.workdir, reply.path));
    expect(await sharp(saved).metadata()).toMatchObject({ format: 'png', width: 7, height: 5 });
    await expect(writeGeneratedImageAsset(context.workdir, bytes)).rejects.toThrow(
      'not a PNG, JPEG, or GIF'
    );
  }
);

test.each(['png', 'jpeg', 'gif'] as const)(
  '%s browser save preserves exact bytes',
  async (format) => {
    const context = await fixture();
    const bytes = await image().toFormat(format).toBuffer();
    const result = await context.save(bytes);
    if (
      !result.ok ||
      result.result.type !== 'browser/execute' ||
      !result.result.ok ||
      result.result.reply.kind !== 'saved_image'
    )
      throw new Error(JSON.stringify(result));
    expect(result.result.reply).toMatchObject({ mimeType: `image/${format}`, width: 7, height: 5 });
    await expect(readFile(path.join(context.workdir, result.result.reply.path))).resolves.toEqual(
      bytes
    );
  }
);

test('corrupt AVIF reports the existing fixed decode error without publication', async () => {
  const context = await fixture();
  const bytes = (await image().avif().toBuffer()).subarray(0, 32);
  expect(await context.save(bytes)).toMatchObject({
    ok: true,
    result: { ok: false, error: 'image is invalid, truncated, or exceeds decoding limits' },
  });
  await expect(readdir(context.workdir)).resolves.toEqual([]);
});

test('oversize browser input stays rejected before conversion', async () => {
  const context = await fixture();
  const bytes = Buffer.alloc(IMAGE_GENERATION_MAX_IMAGE_BYTES + 1);
  (await image().webp().toBuffer()).copy(bytes);
  expect(await context.save(bytes)).toMatchObject({
    ok: true,
    result: { ok: false, error: 'image generation failed: image exceeds the allowed byte range' },
  });
  await expect(readdir(context.workdir)).resolves.toEqual([]);
});

test('a cancelled browser run cannot publish returned image bytes', async () => {
  const context = await fixture();
  const bytes = await image().avif().toBuffer();
  expect(await context.save(bytes, context.endRun)).toMatchObject({
    ok: true,
    result: { ok: false, error: 'Browser run ended before the operation result was returned.' },
  });
  await expect(readdir(context.workdir)).resolves.toEqual([]);
});

test('a run cancelled during normalization cannot publish the PNG', async () => {
  const context = await fixture();
  const bytes = await image().webp().toBuffer();
  hooks.afterNormalize = context.endRun;
  expect(await context.save(bytes)).toMatchObject({
    ok: true,
    result: { ok: false, error: 'Browser run ended before image publication.' },
  });
  await expect(readdir(context.workdir)).resolves.toEqual([]);
});

test('other formats retain the existing intake refusal', async () => {
  const context = await fixture();
  expect(await context.save(Buffer.from('<svg width="7" height="5"></svg>'))).toMatchObject({
    ok: true,
    result: {
      ok: false,
      error:
        'image generation failed: the returned bytes are not a PNG, JPEG, or GIF image, so the design intake could not import them',
    },
  });
  await expect(readdir(context.workdir)).resolves.toEqual([]);
});
