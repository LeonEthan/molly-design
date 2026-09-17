/**
 * The filesystem half of the design render bridge.
 *
 * The agent-facing preview (`./render-preview.ts`) stages a payload the
 * desktop reads, then checks the file it claims to have written:
 *
 * - **Staging is atomic.** Temp file, fsync, rename; a half-written payload is
 *   never observable by a host that polls mid-write.
 * - **A report is not a rendering.** The host's word that it wrote a file is
 *   checked against the bytes before any of it is used, and the check is the
 *   same storage-level one the store applies to an imported asset: header sniff
 *   and size, never a decode, never a semantic judgement.
 * - **The output stays in the session workdir.** A rendering that landed
 *   anywhere else is refused rather than handed on.
 *
 * Nothing here retries or repairs: a bad render is an honest refusal
 * (agent-naive; root `AGENTS.md`).
 */

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { DesignRenderHostWork } from '@molly/shared';
import { sniffStaticV1ImageMime } from '../../../../packages/design-bento/vendor/packages/contracts/src/static-v1';
import type { DesignRenderPreviewOutcome } from './render-host';

/**
 * The part of the render host the preview caller drives. Narrow on purpose: staging
 * a payload and verifying the image are filesystem concerns, and keeping them
 * apart from the queue is what lets each be tested without the other.
 */
export interface DesignRenderQueue {
  enqueue(work: DesignRenderHostWork): Promise<DesignRenderPreviewOutcome>;
}

/** One staged payload, shared by every bridge request. */
export const MAX_STAGED_PAYLOAD_BYTES = 64 * 1024 * 1024;

/**
 * Where staged payloads wait, relative to the daemon data root.
 *
 * The host consumes staged previews within one poll. Each transient payload
 * has its request id as its name, so independent renders never collide.
 */
export const DESIGN_PREVIEW_STAGE_DIRNAME = 'design-preview-stage';

/** Enough of the file to hold the PNG signature and the IHDR dimensions. */
const PNG_HEADER_BYTES = 24;

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const refused = (error: string): { status: 'refused'; error: string } => ({
  status: 'refused',
  error: error.slice(0, 800),
});

/** Temp file + fsync + rename, so a half-written payload is never observable. */
export async function publishBytesAtomic(
  directory: string,
  target: string,
  bytes: string
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(bytes, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/**
 * The real pixel size of a PNG, read from its own header.
 *
 * Deriving this from the bytes rather than trusting a claim is the point: the
 * daemon records what a card may show, and the header is the only thing that
 * knows. `undefined` means the file does not carry readable IHDR dimensions.
 */
export const readPngDimensions = (
  header: Uint8Array
): { width: number; height: number } | undefined => {
  if (header.byteLength < PNG_HEADER_BYTES) return undefined;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  // 8 signature bytes, 4 length, 4 type ('IHDR'), then width and height, both
  // big-endian.
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1) return undefined;
  return { width, height };
};

export type VerifiedRender =
  | { status: 'rendered'; path: string; bytes: Buffer; width: number; height: number }
  | { status: 'refused'; error: string };

/**
 * Confirm the host wrote a PNG inside this session's workdir, and report the
 * path (relative to `workdir`, forward slashes) plus the real dimensions.
 *
 * The dimensions come back even for callers that do not record them, because
 * reading them is the only way to know the file is a PNG at all.
 */
export async function verifyRenderedPng(
  absolutePath: string,
  workdir: string
): Promise<VerifiedRender> {
  let bytes: Buffer;
  let width: number;
  let height: number;
  try {
    const stat = await lstat(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0) {
      return refused('the desktop reported a rendering but wrote no readable PNG');
    }
    const handle = await open(absolutePath, 'r');
    try {
      const header = Buffer.alloc(PNG_HEADER_BYTES);
      const { bytesRead } = await handle.read(header, 0, PNG_HEADER_BYTES, 0);
      const readable = header.subarray(0, bytesRead);
      if (sniffStaticV1ImageMime(readable) !== 'image/png') {
        return refused('the desktop reported a rendering but the file is not a PNG');
      }
      const dimensions = readPngDimensions(readable);
      if (!dimensions) {
        return refused('the desktop reported a rendering but the file is not a PNG');
      }
      width = dimensions.width;
      height = dimensions.height;
    } finally {
      await handle.close();
    }
    bytes = await readFile(absolutePath);
  } catch (error) {
    return refused(`the rendered image could not be read: ${errorMessage(error)}`);
  }

  const relative = path.relative(path.resolve(workdir), absolutePath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return refused('the rendered image landed outside the session workspace');
  }
  return {
    status: 'rendered',
    path: relative.split(path.sep).join('/'),
    bytes,
    width,
    height,
  };
}
