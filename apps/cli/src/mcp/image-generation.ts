/**
 * Built-in image generation/edit plumbing.
 *
 * Three separable pieces, kept in one module because they share one contract:
 *
 * 1. **Build** the upstream Images request from the resolved connection.
 * 2. **Read** the upstream answer into image bytes — `b64_json` in the response
 *    body, or a `url` we fetch once. Neither path retries: a paid call that
 *    failed is a failure the user decides what to do about.
 * 3. **Land** those bytes in the session workdir as a content-addressed asset
 *    the agent can reference from its YAML artwork.
 *
 * Discipline that matters more than the code:
 *
 * - The API key is a request header and nothing else. It is never logged, never
 *   returned in a tool result, and never included in an error message: every
 *   error this module raises is built from the endpoint, the status, and the
 *   upstream's own text. `assertNoSecret` in the tests pins that.
 * - Only image types the design pipeline can actually import are accepted
 *   (PNG/JPEG/GIF — the same set `sniffStaticV1ImageMime` and the design store
 *   admit). A WebP or SVG that renders in a browser but cannot become a Bento
 *   asset is refused with an actionable message instead of being written to a
 *   directory the intake will later reject.
 * - The write is content-addressed, so the same bytes always land at the same
 *   path. This does not make repeating a paid request idempotent. A path that already holds
 *   *different* bytes is refused rather than overwritten: the workdir is user
 *   space, and a generated asset never had a right to replace something there.
 */

import {
  IMAGE_CONNECTION_GENERATIONS_PATH,
  IMAGE_CONNECTION_EDITS_PATH,
  isImageConnectionReady,
  imageConnectionUrl,
  type ImageConnectionSettings,
  type ImageHttpRequest,
  type ImageHttpResponse,
  type ImageHttpTransport,
} from '@molly/shared';
import { redactCredential } from '@/design/image-connection';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  sniffStaticV1ImageMime,
  type StaticV1ImageMimeType,
} from '../../../../packages/design-bento/vendor/packages/contracts/src/static-v1';

export const IMAGE_GENERATION_TIMEOUT_MS = 180_000;
/** The upstream JSON envelope (prompt echo + base64 payload) may be larger than the image. */
export const IMAGE_GENERATION_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
/** Matches the design store's per-asset cap (`turn-outcome.ts` `MAX_ASSET_BYTES`). */
export const IMAGE_GENERATION_MAX_IMAGE_BYTES = 16 * 1024 * 1024;
/** Import limits, not canvas sizes or provider request defaults. Never silently resize. */
export const IMAGE_GENERATION_MAX_EDGE = 16_384;
export const IMAGE_GENERATION_MAX_PIXELS = 64_000_000;
const UPSTREAM_ERROR_CHARS = 300;
const MAX_SIZE_SPEC_CHARS = 32;

/** The asset directory a YAML artwork references as `media/...`. */
export const DESIGN_MEDIA_DIRNAME = 'media';

export const IMAGE_BACKGROUNDS = ['transparent', 'opaque', 'auto'] as const;
export type ImageBackground = (typeof IMAGE_BACKGROUNDS)[number];
export const IMAGE_OUTPUT_FORMATS = ['png', 'jpeg'] as const;
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];

export class ImageGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

export interface GenerateImageOptions {
  settings: ImageConnectionSettings;
  prompt: string;
  /** Optional upstream `size` (e.g. `1024x1024`). Passed through verbatim. */
  size?: string;
  /** Optional upstream `background`; `transparent` needs an alpha-capable output format. */
  background?: ImageBackground;
  /** Optional upstream `output_format`, limited to formats the design intake imports. */
  outputFormat?: ImageOutputFormat;
  /** Absolute session workdir; the asset lands under `<workdir>/media/`. */
  workdir: string;
  transport: ImageHttpTransport;
  /** Native MCP request cancellation. */
  signal?: AbortSignal;
}

export interface GeneratedImageAsset {
  /** Workdir-relative path, exactly what a YAML artwork must reference. */
  path: string;
  absolutePath: string;
  sha256: string;
  mimeType: StaticV1ImageMimeType;
  width: number;
  height: number;
  bytes: number;
}

/**
 * Ask the upstream for one image and land it in the workdir.
 *
 * `n` is pinned to 1: the tool returns a single asset, and asking for more would
 * multiply what the user pays for behind a schema that cannot express it.
 */
export async function generateImageAsset(
  options: GenerateImageOptions
): Promise<GeneratedImageAsset> {
  const bytes = await generateImageBytes(options);
  return await writeGeneratedImageAsset(options.workdir, bytes, options.signal);
}

/** A managed host can journal provenance before publishing these bytes. */
export async function generateImageBytes(options: GenerateImageOptions): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  const bytes = await requestImageBytes(options);
  options.signal?.throwIfAborted();
  return bytes;
}

async function requestImageBytes(
  options: GenerateImageOptions,
  request?: ImageHttpRequest
): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  const response = await callUpstream(
    options.transport,
    request ?? buildImageGenerationRequest(options),
    options.settings.apiKey
  );
  options.signal?.throwIfAborted();
  if (response.status < 200 || response.status >= 300) {
    throw new ImageGenerationError(
      `image generation failed: HTTP ${response.status}${describeBody(
        response.bytes,
        options.settings.apiKey
      )}`
    );
  }
  const payload = parseGenerationBody(response.bytes, options.settings.apiKey);
  if (payload.base64 !== undefined) {
    return decodeBase64Payload(payload.base64);
  }
  if (payload.url !== undefined) {
    return await downloadGeneratedImage(options, payload.url);
  }
  throw new ImageGenerationError(
    'image generation failed: the response carried neither b64_json nor url'
  );
}

async function callUpstream(
  transport: ImageHttpTransport,
  request: ImageHttpRequest,
  credential: string
): Promise<ImageHttpResponse> {
  try {
    return await transport(request);
  } catch (error) {
    request.signal?.throwIfAborted();
    throw new ImageGenerationError(
      `image generation failed: ${redactCredential(error instanceof Error ? error.message : String(error), credential)}`
    );
  }
}

async function downloadGeneratedImage(
  options: GenerateImageOptions,
  url: string
): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new ImageGenerationError('image generation failed: the returned image URL is invalid');
  }
  if (
    !['http:', 'https:'].includes(parsedUrl.protocol) ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    throw new ImageGenerationError(
      'image generation failed: returned image URL must use http(s) without embedded credentials'
    );
  }
  // The URL comes from the configured upstream; this is a plain GET of the bytes
  // it already produced, not a second generation. Bounded and non-redirecting
  // for the same reasons the API call is.
  const response = await callUpstream(
    options.transport,
    {
      url,
      method: 'GET',
      headers: { accept: 'image/*' },
      timeoutMs: IMAGE_GENERATION_TIMEOUT_MS,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      maxBytes: IMAGE_GENERATION_MAX_IMAGE_BYTES,
    },
    options.settings.apiKey
  );
  if (response.status < 200 || response.status >= 300) {
    throw new ImageGenerationError(
      `image generation failed: fetching the returned image failed with HTTP ${response.status}`
    );
  }
  if (response.bytes.byteLength > IMAGE_GENERATION_MAX_IMAGE_BYTES) {
    throw new ImageGenerationError(
      `image generation failed: the image exceeds ${IMAGE_GENERATION_MAX_IMAGE_BYTES} bytes`
    );
  }
  return response.bytes;
}

/**
 * The upstream request. Exported so the tests assert the real shape — endpoint,
 * model, and a present bearer header — instead of asserting a fake's own memory
 * of what it was called with.
 */
export function buildImageGenerationRequest(
  options: Pick<
    GenerateImageOptions,
    'settings' | 'prompt' | 'size' | 'background' | 'outputFormat' | 'signal'
  >
): ImageHttpRequest {
  return imageJsonRequest(options, IMAGE_CONNECTION_GENERATIONS_PATH, imageRequestFields(options));
}

/** Shared configuration/prompt/option validation for both paid endpoints. */
function imageRequestFields(
  options: Pick<
    GenerateImageOptions,
    'settings' | 'prompt' | 'size' | 'background' | 'outputFormat'
  >
): Record<string, unknown> {
  if (!isImageConnectionReady(options.settings)) {
    throw new ImageGenerationError(
      'Image connection is incomplete or disabled: configure URL, API key and an explicit model in Molly settings.'
    );
  }
  if (options.prompt.trim().length === 0)
    throw new ImageGenerationError('prompt must not be empty');
  const size = options.size?.trim();
  if (size !== undefined && size.length > MAX_SIZE_SPEC_CHARS) {
    throw new ImageGenerationError(`size is longer than ${MAX_SIZE_SPEC_CHARS} characters`);
  }
  if (options.background !== undefined && !IMAGE_BACKGROUNDS.includes(options.background)) {
    throw new ImageGenerationError('background must be transparent, opaque or auto');
  }
  if (options.outputFormat !== undefined && !IMAGE_OUTPUT_FORMATS.includes(options.outputFormat)) {
    throw new ImageGenerationError('output_format must be png or jpeg');
  }
  if (options.background === 'transparent' && options.outputFormat === 'jpeg') {
    throw new ImageGenerationError(
      'a transparent background needs output_format png; JPEG has no alpha channel. No image request was sent.'
    );
  }
  return {
    model: options.settings.model,
    prompt: options.prompt,
    n: 1,
    ...(size === undefined || size.length === 0 ? {} : { size }),
    ...(options.background === undefined ? {} : { background: options.background }),
    ...(options.outputFormat === undefined ? {} : { output_format: options.outputFormat }),
  };
}

function imageJsonRequest(
  options: Pick<GenerateImageOptions, 'settings' | 'signal'>,
  apiPath: string,
  body: Record<string, unknown>
): ImageHttpRequest {
  return {
    url: imageConnectionUrl(options.settings, apiPath),
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.settings.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    timeoutMs: IMAGE_GENERATION_TIMEOUT_MS,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    maxBytes: IMAGE_GENERATION_MAX_RESPONSE_BYTES,
  };
}

/** Input paths are workspace-local files; uploads never dereference URLs or outside symlinks. */
export interface EditImageOptions extends GenerateImageOptions {
  /** Trusted Session cwd for ordinary attachments; output still lands in the artwork directory. */
  sourceWorkdir?: string;
  images: string[];
  mask?: string;
}

export const IMAGE_EDIT_MAX_INPUTS = 16;
export const IMAGE_EDIT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export async function editImageAsset(options: EditImageOptions): Promise<GeneratedImageAsset> {
  const bytes = await editImageBytes(options);
  return await writeGeneratedImageAsset(options.workdir, bytes, options.signal);
}

export async function editImageBytes(options: EditImageOptions): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  const request = await buildImageEditRequest(options);
  const bytes = await requestImageBytes(options, request);
  options.signal?.throwIfAborted();
  return bytes;
}

export async function buildImageEditRequest(options: EditImageOptions): Promise<ImageHttpRequest> {
  options.signal?.throwIfAborted();
  const fields = imageRequestFields(options);
  if (options.images.length < 1 || options.images.length > IMAGE_EDIT_MAX_INPUTS) {
    throw new ImageGenerationError(
      `edit requires 1 to ${IMAGE_EDIT_MAX_INPUTS} source/reference images`
    );
  }
  const root = path.resolve(options.workdir);
  const sourceRoot = path.resolve(options.sourceWorkdir ?? options.workdir);
  const allowedRoots = await Promise.all(
    [root, sourceRoot].map(async (lexical) => ({ lexical, resolved: await realpath(lexical) }))
  );
  options.signal?.throwIfAborted();
  const dataUrls: string[] = [];
  const dimensions: Array<{ width: number; height: number }> = [];
  let total = 0;
  const appendFile = async (input: string, field: 'image' | 'mask') => {
    options.signal?.throwIfAborted();
    const candidate = path.resolve(root, input);
    const resolved = await realpath(candidate);
    options.signal?.throwIfAborted();
    if (
      !allowedRoots.some(
        (allowed) =>
          (isWithin(allowed.lexical, candidate) || isWithin(allowed.resolved, candidate)) &&
          isWithin(allowed.resolved, resolved)
      )
    ) {
      throw new ImageGenerationError('image input must be a file inside the session workspace');
    }
    const handle = await open(
      candidate,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const stat = await handle.stat();
      options.signal?.throwIfAborted();
      if (!stat.isFile() || stat.size === 0 || stat.size > IMAGE_GENERATION_MAX_IMAGE_BYTES) {
        throw new ImageGenerationError(
          `image input must be a nonempty regular file no larger than ${IMAGE_GENERATION_MAX_IMAGE_BYTES} bytes`
        );
      }
      total += stat.size;
      if (total > IMAGE_EDIT_MAX_TOTAL_BYTES)
        throw new ImageGenerationError('image inputs exceed 64 MiB total');
      // Read a bounded snapshot, even if the file grows concurrently.
      const bytes = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, length);
        options.signal?.throwIfAborted();
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      const after = await handle.stat();
      if (
        length !== stat.size ||
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        after.ctimeMs !== stat.ctimeMs
      )
        throw new ImageGenerationError('image input changed while reading; reread before retrying');
      const content = bytes.subarray(0, length);
      const mimeType =
        sniffStaticV1ImageMime(content) ??
        (content.toString('ascii', 0, 4) === 'RIFF' && content.toString('ascii', 8, 12) === 'WEBP'
          ? 'image/webp'
          : null);
      if (mimeType === null || (field === 'mask' && mimeType !== 'image/png')) {
        throw new ImageGenerationError(
          field === 'mask'
            ? 'mask must be a PNG image'
            : 'source/reference image must be PNG, JPEG, GIF or WebP'
        );
      }
      dimensions.push(await decodeImageDimensions(content, mimeType, options.signal));
      dataUrls.push(`data:${mimeType};base64,${content.toString('base64')}`);
    } finally {
      await handle.close();
    }
  };
  for (const input of options.images) await appendFile(input, 'image');
  if (options.mask !== undefined) {
    await appendFile(options.mask, 'mask');
    const sourceSize = dimensions[0];
    const maskSize = dimensions.at(-1);
    if (
      sourceSize &&
      maskSize &&
      (sourceSize.width !== maskSize.width || sourceSize.height !== maskSize.height)
    ) {
      throw new ImageGenerationError('mask dimensions must match the first source image');
    }
  }
  // specs/generative-layered-design-workflow.md: relays dropped multipart fields; JSON is verified.
  const [mask] = options.mask === undefined ? [] : dataUrls.splice(-1);
  return imageJsonRequest(options, IMAGE_CONNECTION_EDITS_PATH, {
    ...fields,
    images: dataUrls.map((url) => ({ image_url: url })),
    ...(mask === undefined ? {} : { mask: { image_url: mask } }),
  });
}

type GenerationPayload = { base64?: string; url?: string };

/** The `data[0]` entry of an OpenAI-Images-compatible response. */
function parseGenerationBody(bytes: Uint8Array, credential: string): GenerationPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ImageGenerationError('image generation failed: the response was not valid JSON');
  }
  const data = (parsed as { data?: unknown } | null)?.data;
  const first = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!first || typeof first !== 'object') {
    throw new ImageGenerationError(
      `image generation failed: the response carried no image${describeBody(bytes, credential)}`
    );
  }
  const base64 = typeof first.b64_json === 'string' ? first.b64_json : undefined;
  const url = typeof first.url === 'string' && first.url.length > 0 ? first.url : undefined;
  return { ...(base64 === undefined ? {} : { base64 }), ...(url === undefined ? {} : { url }) };
}

function decodeBase64Payload(base64: string): Uint8Array {
  if (base64.length > Math.ceil(IMAGE_GENERATION_MAX_IMAGE_BYTES / 3) * 4) {
    throw new ImageGenerationError('image generation failed: base64 image exceeds the byte limit');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64) {
    throw new ImageGenerationError('image generation failed: the image is not canonical base64');
  }
  if (bytes.byteLength === 0) {
    throw new ImageGenerationError('image generation failed: the returned image was empty');
  }
  if (bytes.byteLength > IMAGE_GENERATION_MAX_IMAGE_BYTES) {
    throw new ImageGenerationError(
      `image generation failed: the image exceeds ${IMAGE_GENERATION_MAX_IMAGE_BYTES} bytes`
    );
  }
  return new Uint8Array(bytes);
}

/**
 * The upstream's own text, with the credential removed.
 *
 * The base URL is user-typed, so the endpoint on the other side is not
 * necessarily a party we trust: a gateway that echoes request headers into its
 * error body would otherwise put the key into a tool result the agent reads and
 * a daemon log line. Redacting the exact credential we sent closes that echo.
 */
function describeBody(bytes: Uint8Array, credential: string): string {
  const text = new TextDecoder().decode(bytes.slice(0, UPSTREAM_ERROR_CHARS * 4));
  let message = text.trim();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    const upstream = parsed?.error?.message;
    if (typeof upstream === 'string' && upstream.trim().length > 0) message = upstream.trim();
  } catch {
    // Not JSON; the raw snippet is the honest answer.
  }
  if (message.length === 0) return '';
  return `: ${redactCredential(message, credential).slice(0, UPSTREAM_ERROR_CHARS)}`;
}

const EXTENSION_BY_MIME: Record<StaticV1ImageMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
};

/**
 * Write image bytes into `<workdir>/media/<sha256>.<ext>`, atomically and
 * idempotently.
 *
 * A path that already holds the same bytes is reused (the content address is the
 * identity), a symlink or non-regular file is refused, and anything else at that
 * path is a collision we do not resolve by writing — the caller gets an error
 * naming the path. A checked real media parent excludes directory symlinks. An
 * exclusive hard link publishes the fsynced temporary inode without replacing a
 * concurrent writer. This is not a sandbox against malicious same-user processes.
 */
export async function writeGeneratedImageAsset(
  workdir: string,
  bytes: Uint8Array,
  signal?: AbortSignal
): Promise<GeneratedImageAsset> {
  signal?.throwIfAborted();
  if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_GENERATION_MAX_IMAGE_BYTES) {
    throw new ImageGenerationError('image generation failed: image exceeds the allowed byte range');
  }
  // Freeze caller-owned bytes before any filesystem await.
  bytes = Buffer.from(bytes);
  const { mimeType, width, height, sha256 } = await inspectGeneratedImage(bytes, signal);
  const dimensions = { width, height };
  const relative = `${DESIGN_MEDIA_DIRNAME}/${sha256}.${EXTENSION_BY_MIME[mimeType]}`;
  const root = path.resolve(workdir);
  const absolutePath = path.resolve(root, relative);
  if (!isWithin(root, absolutePath)) {
    throw new ImageGenerationError('image generation failed: the asset path escapes the workdir');
  }

  await mkdir(root, { recursive: true });
  const resolvedRoot = await realpath(root);
  const media = path.join(resolvedRoot, DESIGN_MEDIA_DIRNAME);
  await mkdir(media).catch((error: unknown) => {
    if (!isFileError(error, 'EEXIST')) throw error;
  });
  const parent = await lstat(media);
  if (parent.isSymbolicLink() || !parent.isDirectory() || (await realpath(media)) !== media) {
    throw new ImageGenerationError(
      'image generation failed: media directory must be a real workspace directory'
    );
  }
  const checkParent = async () => {
    const current = await lstat(media);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== parent.dev ||
      current.ino !== parent.ino ||
      (await realpath(media)) !== media
    ) {
      throw new ImageGenerationError(
        'image generation failed: media directory changed during import'
      );
    }
  };
  const target = path.join(media, `${sha256}.${EXTENSION_BY_MIME[mimeType]}`);
  signal?.throwIfAborted();
  await checkParent();
  if (!(await matchesExistingAsset(target, bytes, signal))) {
    await writeFileAtomically(target, bytes, checkParent, signal);
  }
  await checkParent();
  signal?.throwIfAborted();

  return {
    path: relative,
    absolutePath,
    sha256,
    mimeType,
    width: dimensions.width,
    height: dimensions.height,
    bytes: bytes.byteLength,
  };
}

/** Decode all frames before publication; retain the exact encoded bytes, never repair/resize. */
export async function inspectGeneratedImage(bytes: Uint8Array, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_GENERATION_MAX_IMAGE_BYTES)
    throw new ImageGenerationError('image generation failed: image exceeds the allowed byte range');
  const mimeType = sniffStaticV1ImageMime(bytes);
  if (mimeType === null) {
    throw new ImageGenerationError(
      'image generation failed: the returned bytes are not a PNG, JPEG, or GIF image, so the design intake could not import them'
    );
  }
  // Freeze mutable callers across native asynchronous decode and digest computation.
  bytes = Buffer.from(bytes);
  const dimensions = await decodeImageDimensions(bytes, mimeType, signal);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    path: `${DESIGN_MEDIA_DIRNAME}/${sha256}.${EXTENSION_BY_MIME[mimeType]}`,
    sha256,
    mimeType,
    width: dimensions.width,
    height: dimensions.height,
    bytes: bytes.byteLength,
  };
}

async function decodeImageDimensions(
  bytes: Uint8Array,
  mimeType: StaticV1ImageMimeType | 'image/webp',
  signal?: AbortSignal
): Promise<{ width: number; height: number }> {
  signal?.throwIfAborted();
  const decoder = sharp(bytes, {
    failOn: 'warning',
    limitInputPixels: IMAGE_GENERATION_MAX_PIXELS,
    limitInputChannels: 4,
    pages: -1,
  }).timeout({ seconds: 15 });
  try {
    const metadata = await decoder.metadata();
    signal?.throwIfAborted();
    // Some GIF decoders crop the logical screen to its frame rectangles. The
    // original bytes still advertise that screen to browser consumers: budget
    // both representations, not only the decoder's smaller working surface.
    const container = mimeType === 'image/webp' ? null : readImageDimensions(bytes, mimeType);
    if (mimeType !== 'image/webp' && container === null)
      throw new ImageGenerationError('image dimensions are missing or invalid');
    const width = Math.max(metadata.width, container?.width ?? 0);
    const height = Math.max(metadata.pageHeight ?? metadata.height, container?.height ?? 0);
    const pages = metadata.pages ?? 1;
    if (
      metadata.format !== mimeType.slice('image/'.length) ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      !Number.isSafeInteger(pages) ||
      width < 1 ||
      height < 1 ||
      pages < 1 ||
      width > IMAGE_GENERATION_MAX_EDGE ||
      height > IMAGE_GENERATION_MAX_EDGE ||
      width * height * pages > IMAGE_GENERATION_MAX_PIXELS
    )
      throw new ImageGenerationError(
        'image dimensions exceed the import limits (16384 per edge, 64 million pixels across frames)'
      );
    // Metadata is not decode evidence. Force every pixel through the bounded raw
    // pipeline; discard output without changing the original image or its digest.
    await decoder.toColourspace('srgb').ensureAlpha().raw().toBuffer();
    signal?.throwIfAborted();
    return { width, height };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ImageGenerationError) throw error;
    // Decoder diagnostics can carry embedded metadata; expose a fixed local error.
    throw new ImageGenerationError('image is invalid, truncated, or exceeds decoding limits');
  } finally {
    decoder.destroy();
  }
}

async function writeFileAtomically(
  target: string,
  bytes: Uint8Array,
  checkParent: () => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await checkParent();
    signal?.throwIfAborted();
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(bytes);
      signal?.throwIfAborted();
      await file.sync();
      signal?.throwIfAborted();
    } finally {
      await file.close();
    }
    await checkParent();
    signal?.throwIfAborted();
    try {
      await link(temporary, target);
    } catch (error) {
      if (!isFileError(error, 'EEXIST')) throw error;
      if (!(await matchesExistingAsset(target, bytes, signal))) throw error;
    }
  } finally {
    // Do not unlink a path reinterpreted through a replaced directory.
    await checkParent()
      .then(() => unlink(temporary))
      .catch(() => undefined);
  }
  if (process.platform !== 'win32') {
    const directory = await open(
      path.dirname(target),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

function isFileError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function matchesExistingAsset(
  target: string,
  bytes: Uint8Array,
  signal?: AbortSignal
): Promise<boolean> {
  const existing = await statOrNull(target);
  if (existing === null) return false;
  if (existing.isSymbolicLink() || !existing.isFile()) {
    throw new ImageGenerationError('refusing to write over a non-regular file');
  }
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const current = await file.stat();
    if (!current.isFile() || current.size !== bytes.byteLength) {
      throw new ImageGenerationError(
        'refusing to overwrite an unrelated file at the content-addressed path'
      );
    }
    const snapshot = Buffer.alloc(bytes.byteLength + 1);
    let length = 0;
    while (length < snapshot.length) {
      signal?.throwIfAborted();
      const result = await file.read(snapshot, length, snapshot.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    signal?.throwIfAborted();
    if (length !== bytes.byteLength || !snapshot.subarray(0, length).equals(Buffer.from(bytes))) {
      throw new ImageGenerationError(
        'refusing to overwrite an unrelated file at the content-addressed path'
      );
    }
    return true;
  } finally {
    await file.close();
  }
}

async function statOrNull(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Dimensions from the file header, for the types the design pipeline admits.
 *
 * Returns `null` when the header is malformed or the format is not parsed here:
 * import caller refuses unavailable dimensions rather than guessing. This is
 * bounded header inspection, not a full pixel decoder or a rendering guarantee.
 */
export function readImageDimensions(
  bytes: Uint8Array,
  mimeType: StaticV1ImageMimeType
): { width: number; height: number } | null {
  try {
    if (sniffStaticV1ImageMime(bytes) !== mimeType) return null;
    if (mimeType === 'image/png') {
      // IHDR is the first chunk: 8-byte signature, 4-byte length, 4-byte type.
      if (
        bytes.length < 33 ||
        readU32(bytes, 8) !== 13 ||
        bytes[12] !== 73 ||
        bytes[13] !== 72 ||
        bytes[14] !== 68 ||
        bytes[15] !== 82
      )
        return null;
      return { width: readU32(bytes, 16), height: readU32(bytes, 20) };
    }
    if (mimeType === 'image/gif' && bytes.length >= 13) {
      // The GIF logical screen descriptor is the one little-endian header here.
      return { width: readU16LE(bytes, 6), height: readU16LE(bytes, 8) };
    }
    if (mimeType === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 <= bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        // JPEG permits padding FF bytes before a marker.
        if (bytes[offset + 1] === 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1]!;
        const length = readU16(bytes, offset + 2);
        if (length < 2 || offset + 2 + length > bytes.length) return null;
        // SOF0..SOF15 minus the DHT/JPG/DAC markers that share the range.
        if (
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc
        ) {
          const components = bytes[offset + 9];
          if (
            components === undefined ||
            components < 1 ||
            components > 4 ||
            length !== 8 + 3 * components
          )
            return null;
          return { width: readU16(bytes, offset + 7), height: readU16(bytes, offset + 5) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

const readU16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! << 8) | bytes[offset + 1]!;

const readU16LE = (bytes: Uint8Array, offset: number): number =>
  bytes[offset]! | (bytes[offset + 1]! << 8);

const readU32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!) >>>
  0;
