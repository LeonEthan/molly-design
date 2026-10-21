import sharp from 'sharp';
import {
  ImageGenerationError,
  IMAGE_GENERATION_MAX_IMAGE_BYTES,
  IMAGE_GENERATION_MAX_EDGE,
  IMAGE_GENERATION_MAX_PIXELS,
} from '@/mcp/image-generation';

function browserImageFormat(bytes: Buffer): 'webp' | 'avif' | undefined {
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP')
    return 'webp';
  if (bytes.length < 16 || bytes.toString('latin1', 4, 8) !== 'ftyp') return undefined;
  const end = Math.min(bytes.readUInt32BE(0), bytes.length);
  for (let offset = 8; offset + 4 <= end; offset += 4) {
    if (offset === 12) continue;
    const brand = bytes.toString('latin1', offset, offset + 4);
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }
  return undefined;
}

export async function normalizeBrowserImage(bytes: Buffer): Promise<Buffer> {
  if (bytes.length === 0 || bytes.length > IMAGE_GENERATION_MAX_IMAGE_BYTES)
    throw new ImageGenerationError('image generation failed: image exceeds the allowed byte range');
  const format = browserImageFormat(bytes);
  if (!format) return bytes;
  const decoder = sharp(bytes, {
    failOn: 'warning',
    limitInputPixels: IMAGE_GENERATION_MAX_PIXELS,
    limitInputChannels: 4,
    pages: -1,
  }).timeout({ seconds: 15 });
  try {
    const metadata = await decoder.metadata();
    const width = metadata.width;
    const height = metadata.pageHeight ?? metadata.height;
    const pages = metadata.pages ?? 1;
    if (
      metadata.format !== (format === 'avif' ? 'heif' : 'webp') ||
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
    return await decoder.png().toBuffer();
  } catch (error) {
    if (error instanceof ImageGenerationError) throw error;
    throw new ImageGenerationError('image is invalid, truncated, or exceeds decoding limits');
  } finally {
    decoder.destroy();
  }
}
