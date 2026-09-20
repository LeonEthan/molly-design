import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import {
  HarnessImageImportRequestSchema,
  HarnessImageImportResultSchema,
  HarnessImageImportIdentitySchema,
  HarnessImageAssetDescriptorSchema,
  type HarnessImageImportRequest,
  type HarnessImageImportResult,
} from '@molly/shared/embedded-harness';
import { z } from 'zod';
import { inspectGeneratedImage, writeGeneratedImageAsset } from '@/mcp/image-generation';
import { ensureDesignDirectory, type DesignWorkspace } from './workspace';

export const HarnessImageImportIntentSchema = z
  .object({
    version: z.literal(1),
    operationId: z.string().regex(/^[a-f0-9]{64}$/),
    identity: HarnessImageImportIdentitySchema,
    artworkId: z.string().uuid(),
    expectedAssets: z.array(HarnessImageAssetDescriptorSchema).min(1).max(16),
  })
  .strict()
  .refine(
    (value) =>
      value.operationId ===
      createHash('sha256')
        .update(JSON.stringify([value.identity.runId, value.identity.toolCallId]))
        .digest('hex')
  )
  .refine(
    (value) =>
      value.expectedAssets.reduce((total, asset) => total + asset.bytes, 0) <= 16 * 1024 * 1024
  );

/** Import into the host-resolved draft only; this never saves a canonical artwork. */
export async function importHarnessImages(input: {
  request: HarnessImageImportRequest;
  workspace: DesignWorkspace;
  artworkId: string;
  operationDirectory: string;
  signal: AbortSignal;
}): Promise<HarnessImageImportResult> {
  const request = HarnessImageImportRequestSchema.parse(input.request);
  input.signal.throwIfAborted();
  // Validate every image before publishing any one of them; preserve source order.
  const images = [];
  for (const image of request.images) {
    const bytes = Buffer.from(image.data, 'base64');
    if (bytes.toString('base64') !== image.data) throw new Error('harness_image_encoding_invalid');
    const descriptor = await inspectGeneratedImage(bytes, input.signal);
    if (descriptor.mimeType !== image.mimeType) throw new Error('harness_image_mime_mismatch');
    images.push({ bytes, descriptor });
  }
  const workspace = input.workspace;
  const check = async () => {
    input.signal.throwIfAborted();
    await ensureDesignDirectory(
      workspace.artifactWorkdir === workspace.inputWorkdir
        ? workspace.inputWorkdir
        : workspace.workspaceRoot,
      workspace.artifactWorkdir
    );
    input.signal.throwIfAborted();
  };
  await check();
  const operationId = createHash('sha256')
    .update(JSON.stringify([request.runId, request.toolCallId]))
    .digest('hex');
  const { images: _images, ...identity } = request;
  const receipt = JSON.stringify(
    HarnessImageImportIntentSchema.parse({
      version: 1,
      operationId,
      identity,
      artworkId: input.artworkId,
      expectedAssets: images.map(({ descriptor }) => descriptor),
    })
  );
  // This is an import intent, not proof of publication. It contains no image bytes,
  // prompt, credential, or caller-selected absolute path. Recovery must verify files.
  await mkdir(input.operationDirectory, { recursive: true, mode: 0o700 });
  const file = path.join(input.operationDirectory, `${operationId}.images.json`);
  let handle;
  try {
    handle = await open(file, 'wx', 0o600);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    const existing = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const stat = await existing.stat();
      if (!stat.isFile() || stat.size !== Buffer.byteLength(receipt))
        throw new Error('harness_image_import_conflict', { cause: error });
      const buffer = Buffer.alloc(stat.size + 1);
      const { bytesRead } = await existing.read(buffer, 0, buffer.length, 0);
      if (
        JSON.stringify(
          HarnessImageImportIntentSchema.parse(
            JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
          )
        ) !== receipt
      )
        throw new Error('harness_image_import_conflict', { cause: error });
    } finally {
      await existing.close();
    }
  }
  if (handle) {
    try {
      await handle.writeFile(receipt);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  if (process.platform !== 'win32') {
    const directory = await open(
      input.operationDirectory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  const assets = [];
  for (const image of images) {
    await check();
    assets.push(
      await writeGeneratedImageAsset(workspace.artifactWorkdir, image.bytes, input.signal)
    );
  }
  await check();
  return HarnessImageImportResultSchema.parse({ assets });
}
