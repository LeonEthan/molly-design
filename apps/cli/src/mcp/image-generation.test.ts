import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  IMAGE_CONNECTION_VERSION,
  type ImageConnectionSettings,
  type ImageHttpRequest,
  type ImageHttpResponse,
  type ImageHttpTransport,
} from '@molly/shared';
import {
  IMAGE_GENERATION_MAX_IMAGE_BYTES,
  ImageGenerationError,
  buildImageGenerationRequest,
  generateImageAsset,
  editImageAsset,
  readImageDimensions,
  writeGeneratedImageAsset,
} from './image-generation';

/** A key value that must never appear in an error, a log, or a tool result. */
const SECRET_KEY = 'sk-live-super-secret-value';

const settings: ImageConnectionSettings = {
  v: IMAGE_CONNECTION_VERSION,
  enabled: true,
  baseUrl: 'https://images.example.com/v1',
  apiKey: SECRET_KEY,
  model: 'gpt-image-2',
  updatedAt: 1_700_000_000_000,
};

/** A real, decodable PNG of the requested size. */
function pngFixture(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const gifFixture = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(13);
  bytes.write('GIF89a', 0, 'ascii');
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
};

/** A scripted transport that records every request it was handed. */
function scriptedTransport(handler: (request: ImageHttpRequest) => ImageHttpResponse): {
  calls: ImageHttpRequest[];
  transport: ImageHttpTransport;
} {
  const calls: ImageHttpRequest[] = [];
  return {
    calls,
    transport: async (request) => {
      calls.push(request);
      return handler(request);
    },
  };
}

const jsonResponse = (status: number, body: unknown): ImageHttpResponse => ({
  status,
  bytes: new TextEncoder().encode(JSON.stringify(body)),
});

const bytesResponse = (status: number, bytes: Uint8Array): ImageHttpResponse => ({ status, bytes });

const makeWorkdir = async (): Promise<string> =>
  await mkdtemp(path.join(os.tmpdir(), 'molly-imagegen-'));

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('buildImageGenerationRequest', () => {
  it('posts to the configured images endpoint with the model and a bearer header', () => {
    const request = buildImageGenerationRequest({ settings, prompt: 'a red kite' });
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://images.example.com/v1/images/generations');
    expect(request.headers.authorization).toBe(`Bearer ${SECRET_KEY}`);
    expect(request.headers['content-type']).toBe('application/json');
    expect(JSON.parse(request.body ?? '{}')).toEqual({
      model: 'gpt-image-2',
      prompt: 'a red kite',
      n: 1,
    });
  });

  it('passes an explicit size through and omits an empty one', () => {
    const sized = buildImageGenerationRequest({ settings, prompt: 'p', size: '1024x1024' });
    expect(JSON.parse(sized.body ?? '{}').size).toBe('1024x1024');
    const empty = buildImageGenerationRequest({ settings, prompt: 'p', size: '   ' });
    expect(JSON.parse(empty.body ?? '{}')).not.toHaveProperty('size');
  });

  it('refuses an absurd size spec rather than forwarding it upstream', () => {
    expect(() =>
      buildImageGenerationRequest({ settings, prompt: 'p', size: 'x'.repeat(40) })
    ).toThrow(ImageGenerationError);
  });

  it('never asks for more than the one image the tool can return', () => {
    // `n` is the difference between one paid image and an unbounded bill.
    const request = buildImageGenerationRequest({ settings, prompt: 'p', size: '512x512' });
    expect(JSON.parse(request.body ?? '{}').n).toBe(1);
  });
});

/** Baseline JPEG SOI + SOF0 header — enough for the dimension reader, and no more. */
function jpegFixture(width: number, height: number): Buffer {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]);
}

describe('readImageDimensions', () => {
  it('reads PNG, GIF, and JPEG headers', () => {
    expect(readImageDimensions(pngFixture(3, 7), 'image/png')).toEqual({ width: 3, height: 7 });
    // GIF stores its screen size little-endian; PNG and JPEG big-endian.
    expect(readImageDimensions(gifFixture(11, 5), 'image/gif')).toEqual({ width: 11, height: 5 });
    expect(readImageDimensions(jpegFixture(640, 480), 'image/jpeg')).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('answers null for bytes it cannot read instead of guessing', () => {
    expect(readImageDimensions(new Uint8Array([1, 2, 3]), 'image/png')).toBeNull();
    expect(readImageDimensions(new Uint8Array(0), 'image/jpeg')).toBeNull();
    expect(readImageDimensions(Buffer.from([0xff, 0xd8, 0x00, 0x00]), 'image/jpeg')).toBeNull();
    expect(readImageDimensions(new Uint8Array(24), 'image/png')).toEqual({ width: 0, height: 0 });
  });
});

describe('generateImageAsset', () => {
  it('lands the decoded b64_json bytes in media/ under their content address', async () => {
    const workdir = await makeWorkdir();
    const png = pngFixture(4, 4);
    const { calls, transport } = scriptedTransport(() =>
      jsonResponse(200, { data: [{ b64_json: png.toString('base64') }] })
    );

    const asset = await generateImageAsset({ settings, prompt: 'a red kite', workdir, transport });

    expect(calls).toHaveLength(1);
    // The upstream sees exactly the configured endpoint, model, and key.
    expect(calls[0]!.url).toBe('https://images.example.com/v1/images/generations');
    expect(JSON.parse(calls[0]!.body ?? '{}').model).toBe('gpt-image-2');
    expect(JSON.parse(calls[0]!.body ?? '{}').prompt).toBe('a red kite');
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${SECRET_KEY}`);

    expect(asset.sha256).toBe(sha256Of(png));
    expect(asset.path).toBe(`media/${asset.sha256}.png`);
    expect(asset.mimeType).toBe('image/png');
    expect(asset.width).toBe(4);
    expect(asset.height).toBe(4);
    expect(asset.bytes).toBe(png.byteLength);
    await expect(readFile(asset.absolutePath)).resolves.toEqual(png);
  });

  it('fetches a returned url directly rather than asking for a second generation', async () => {
    const workdir = await makeWorkdir();
    const png = pngFixture(2, 2);
    const { calls, transport } = scriptedTransport((request) =>
      request.method === 'GET'
        ? bytesResponse(200, new Uint8Array(png))
        : jsonResponse(200, { data: [{ url: 'https://images.example.com/v1/files/abc' }] })
    );

    const asset = await generateImageAsset({ settings, prompt: 'p', workdir, transport });

    expect(calls.map((request) => request.method)).toEqual(['POST', 'GET']);
    expect(calls[1]!.url).toBe('https://images.example.com/v1/files/abc');
    expect(asset.sha256).toBe(sha256Of(png));
  });

  it('does not publish a returned-url asset after cancellation', async () => {
    const workdir = await makeWorkdir();
    const png = pngFixture(2, 2);
    const controller = new AbortController();
    let markDownloadStarted = () => {};
    let releaseDownload = () => {};
    const downloadStarted = new Promise<void>((resolve) => {
      markDownloadStarted = resolve;
    });
    const heldDownload = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    const transport: ImageHttpTransport = async (request) => {
      expect(request.signal).toBe(controller.signal);
      if (request.method === 'POST') {
        return jsonResponse(200, { data: [{ url: 'https://images.example.com/v1/files/held' }] });
      }
      markDownloadStarted();
      await heldDownload;
      return bytesResponse(200, new Uint8Array(png));
    };

    const generated = generateImageAsset({
      settings,
      prompt: 'p',
      workdir,
      transport,
      signal: controller.signal,
    });
    await downloadStarted;
    controller.abort(new Error('synthetic native cancellation'));
    releaseDownload();

    await expect(generated).rejects.toThrow('synthetic native cancellation');
    await expect(readdir(path.join(workdir, 'media'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reuses the same content-addressed path for identical bytes', async () => {
    const workdir = await makeWorkdir();
    const png = pngFixture(2, 2);
    const { transport } = scriptedTransport(() =>
      jsonResponse(200, { data: [{ b64_json: png.toString('base64') }] })
    );

    const first = await generateImageAsset({ settings, prompt: 'p', workdir, transport });
    const second = await generateImageAsset({ settings, prompt: 'p again', workdir, transport });
    expect(second.path).toBe(first.path);
    await expect(readFile(first.absolutePath)).resolves.toEqual(png);
  });

  it('surfaces an upstream HTTP error with the status and the upstream message', async () => {
    const workdir = await makeWorkdir();
    const { transport } = scriptedTransport(() =>
      jsonResponse(429, { error: { message: 'rate limit reached' } })
    );

    await expect(generateImageAsset({ settings, prompt: 'p', workdir, transport })).rejects.toThrow(
      /HTTP 429: rate limit reached/
    );
  });

  it('reports a transport failure as a failure instead of inventing a result', async () => {
    const workdir = await makeWorkdir();
    const transport: ImageHttpTransport = async () => {
      throw new Error('request timed out after 180000ms');
    };

    await expect(generateImageAsset({ settings, prompt: 'p', workdir, transport })).rejects.toThrow(
      /timed out/
    );
  });

  it('refuses an oversized image', async () => {
    const workdir = await makeWorkdir();
    const { transport } = scriptedTransport((request) =>
      request.method === 'GET'
        ? bytesResponse(200, new Uint8Array(IMAGE_GENERATION_MAX_IMAGE_BYTES + 1))
        : jsonResponse(200, { data: [{ url: 'https://images.example.com/v1/files/abc' }] })
    );

    await expect(generateImageAsset({ settings, prompt: 'p', workdir, transport })).rejects.toThrow(
      /exceeds/
    );
  });

  it('refuses a response that carries no image', async () => {
    const workdir = await makeWorkdir();
    const { transport } = scriptedTransport(() => jsonResponse(200, { data: [] }));
    await expect(generateImageAsset({ settings, prompt: 'p', workdir, transport })).rejects.toThrow(
      /carried no image/
    );
  });

  it('refuses a body that is not JSON at all', async () => {
    const workdir = await makeWorkdir();
    const { transport } = scriptedTransport(() =>
      bytesResponse(200, new TextEncoder().encode('<html>nope</html>'))
    );
    await expect(generateImageAsset({ settings, prompt: 'p', workdir, transport })).rejects.toThrow(
      /not valid JSON/
    );
  });

  it('refuses bytes the design pipeline could not import', async () => {
    const workdir = await makeWorkdir();
    const { transport } = scriptedTransport(() =>
      jsonResponse(200, {
        data: [{ b64_json: Buffer.from('RIFF----WEBPVP8 ').toString('base64') }],
      })
    );
    await expect(generateImageAsset({ settings, prompt: 'p', workdir, transport })).rejects.toThrow(
      /not a PNG, JPEG, or GIF/
    );
  });

  it('sends the key upstream but never into the error it raises', async () => {
    const workdir = await makeWorkdir();
    const { calls, transport } = scriptedTransport(() =>
      jsonResponse(401, { error: { message: 'invalid api key' } })
    );

    const thrown = await generateImageAsset({ settings, prompt: 'p', workdir, transport }).catch(
      (error: unknown) => error
    );

    expect(thrown).toBeInstanceOf(ImageGenerationError);
    // The request did carry the key — the assertion below is about the message.
    expect(calls[0]!.headers.authorization).toContain(SECRET_KEY);
    expect(String(thrown)).not.toContain(SECRET_KEY);

    const failingTransport: ImageHttpTransport = async () => {
      throw new Error('socket hang up');
    };
    const thrown2 = await generateImageAsset({
      settings,
      prompt: 'p',
      workdir,
      transport: failingTransport,
    }).catch((error: unknown) => error);
    expect(String(thrown2)).not.toContain(SECRET_KEY);
  });

  /* The base URL is user-typed, so the endpoint may echo whatever it was sent. */
  it('redacts the key when the upstream echoes the request header back', async () => {
    const workdir = await makeWorkdir();
    const { transport } = scriptedTransport(() =>
      jsonResponse(500, {
        error: { message: `upstream rejected authorization: Bearer ${SECRET_KEY}` },
      })
    );

    const thrown = (await generateImageAsset({
      settings,
      prompt: 'p',
      workdir,
      transport,
    }).catch((error: unknown) => error)) as Error;

    expect(thrown).toBeInstanceOf(ImageGenerationError);
    expect(thrown.message).toContain('[redacted]');
    expect(thrown.message).toContain('upstream rejected authorization');
    expect(thrown.message).not.toContain(SECRET_KEY);
  });
});

describe('writeGeneratedImageAsset', () => {
  it('is content-addressed and leaves unrelated files in media/ alone', async () => {
    const workdir = await makeWorkdir();
    await mkdir(path.join(workdir, 'media'), { recursive: true });
    const unrelated = path.join(workdir, 'media', 'keep.png');
    await writeFile(unrelated, 'user bytes');

    const png = pngFixture(8, 6);
    const asset = await writeGeneratedImageAsset(workdir, png);

    expect(asset.path).toBe(`media/${sha256Of(png)}.png`);
    expect(path.dirname(asset.absolutePath)).toBe(path.join(workdir, 'media'));
    expect(asset.width).toBe(8);
    expect(asset.height).toBe(6);
    await expect(readFile(unrelated, 'utf8')).resolves.toBe('user bytes');
  });

  it('refuses a symlinked target instead of following it out of the workdir', async () => {
    const workdir = await makeWorkdir();
    const outside = await makeWorkdir();
    const png = pngFixture(1, 1);
    await mkdir(path.join(workdir, 'media'), { recursive: true });
    await symlink(
      path.join(outside, 'target.png'),
      path.join(workdir, 'media', `${sha256Of(png)}.png`)
    );

    await expect(writeGeneratedImageAsset(workdir, png)).rejects.toThrow(/non-regular file/);
  });

  it('refuses to overwrite different bytes already sitting at the content address', async () => {
    const workdir = await makeWorkdir();
    const png = pngFixture(1, 1);
    await mkdir(path.join(workdir, 'media'), { recursive: true });
    await writeFile(path.join(workdir, 'media', `${sha256Of(png)}.png`), 'tampered');

    await expect(writeGeneratedImageAsset(workdir, png)).rejects.toThrow(/refusing to overwrite/);
  });
});

describe('image edits', () => {
  it.each([false, true])(
    'uploads ordered source bytes and optional mask (%s), preserving the artwork',
    async (withMask) => {
      const workdir = await mkdtemp(path.join(os.tmpdir(), 'molly-edit-'));
      const first = pngFixture(4, 3);
      const second = pngFixture(8, 6);
      const output = pngFixture(12, 9);
      await writeFile(path.join(workdir, 'first.png'), first);
      await writeFile(path.join(workdir, 'reference.png'), second);
      await writeFile(path.join(workdir, 'mask.png'), first);
      await writeFile(path.join(workdir, 'design.pptd'), 'existing artwork');
      const transport: ImageHttpTransport = async (request) => {
        expect(request.url).toBe('https://images.example.com/v1/images/edits');
        expect(request.method).toBe('POST');
        expect(request.body).toBeUndefined();
        expect(request.headers['content-type']).toBeUndefined();
        expect(request.multipart?.fields).toEqual({
          model: settings.model,
          prompt: 'preserve first, borrow second palette',
          n: '1',
          size: '1024x1024',
        });
        expect(
          request.multipart?.files.map((file) => [
            file.field,
            file.mimeType,
            Buffer.from(file.bytes),
          ])
        ).toEqual([
          ['image[]', 'image/png', first],
          ['image[]', 'image/png', second],
          ...(withMask ? [['mask', 'image/png', first]] : []),
        ]);
        return jsonResponse(200, { data: [{ b64_json: output.toString('base64') }] });
      };
      const asset = await editImageAsset({
        settings,
        transport,
        workdir,
        prompt: 'preserve first, borrow second palette',
        images: ['first.png', 'reference.png'],
        size: '1024x1024',
        ...(withMask ? { mask: 'mask.png' } : {}),
      });
      expect(await readFile(asset.absolutePath)).toEqual(output);
      expect(await readFile(path.join(workdir, 'design.pptd'), 'utf8')).toBe('existing artwork');
      expect(await readFile(path.join(workdir, 'first.png'))).toEqual(first);
    }
  );

  it('refuses empty models, missing inputs, outside paths, symlinks, invalid masks and excess bytes before transport', async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'molly-edit-invalid-'));
    await writeFile(path.join(workdir, 'image.png'), pngFixture(2, 2));
    await writeFile(path.join(workdir, 'mask.png'), pngFixture(3, 3));
    await writeFile(path.join(workdir, 'not-image'), 'not an image');
    const outside = await mkdtemp(path.join(os.tmpdir(), 'molly-outside-'));
    await writeFile(path.join(outside, 'source.png'), pngFixture(2, 2));
    await symlink(outside, path.join(workdir, 'outside'));
    await writeFile(
      path.join(workdir, 'huge.png'),
      Buffer.alloc(IMAGE_GENERATION_MAX_IMAGE_BYTES + 1)
    );
    const transport: ImageHttpTransport = async () => {
      throw new Error('unexpected network');
    };
    const options = { settings, workdir, transport, prompt: 'edit', images: ['image.png'] };
    await expect(
      editImageAsset({ ...options, settings: { ...settings, model: ' ' } })
    ).rejects.toThrow('explicit model');
    await expect(editImageAsset({ ...options, images: [] })).rejects.toThrow('requires 1');
    await expect(editImageAsset({ ...options, images: ['missing.png'] })).rejects.toThrow('ENOENT');
    await expect(
      editImageAsset({ ...options, images: [path.join(outside, 'source.png')] })
    ).rejects.toThrow('inside');
    await expect(editImageAsset({ ...options, images: ['outside/source.png'] })).rejects.toThrow(
      'inside'
    );
    await expect(editImageAsset({ ...options, images: ['not-image'] })).rejects.toThrow(
      'must be PNG'
    );
    await expect(editImageAsset({ ...options, mask: 'not-image' })).rejects.toThrow('mask must be');
    await expect(editImageAsset({ ...options, mask: 'mask.png' })).rejects.toThrow('dimensions');
    await expect(editImageAsset({ ...options, images: ['huge.png'] })).rejects.toThrow('no larger');
  });

  it('preserves unsupported-edit errors and redacts thrown transport credentials without falling back', async () => {
    const workdir = await mkdtemp(path.join(os.tmpdir(), 'molly-edit-error-'));
    await writeFile(path.join(workdir, 'image.png'), pngFixture(2, 2));
    const requests: string[] = [];
    const transport: ImageHttpTransport = async (request) => {
      requests.push(request.url);
      return jsonResponse(400, { error: { message: `edits unsupported ${SECRET_KEY}` } });
    };
    const options = { settings, workdir, transport, prompt: 'edit', images: ['image.png'] };
    await expect(editImageAsset(options)).rejects.toThrow('HTTP 400: edits unsupported [redacted]');
    expect(requests).toEqual(['https://images.example.com/v1/images/edits']);
    await expect(
      editImageAsset({
        ...options,
        transport: async () => {
          throw new Error(`transport ${SECRET_KEY}`);
        },
      })
    ).rejects.toThrow('transport [redacted]');
  });
});

it('refuses non-http and embedded-credential returned URLs before downloading', async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), 'molly-invalid-result-url-'));
  for (const url of ['file:///tmp/source.png', 'https://user:password@images.example/output.png']) {
    const requests: string[] = [];
    const transport: ImageHttpTransport = async (request) => {
      requests.push(request.url);
      return jsonResponse(200, { data: [{ url }] });
    };
    await expect(
      generateImageAsset({ settings, workdir, transport, prompt: 'generate' })
    ).rejects.toThrow('http(s) without embedded credentials');
    expect(requests).toEqual(['https://images.example.com/v1/images/generations']);
  }
});
