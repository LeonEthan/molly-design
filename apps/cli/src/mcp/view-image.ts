import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';

const RegionSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const ViewImageInputSchema = z
  .object({
    path: z.string().optional(),
    paths: z.array(z.string()).min(2).max(9).optional(),
    region: RegionSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      (input.path !== undefined) !== (input.paths !== undefined) &&
      (input.region === undefined || input.path !== undefined),
    'Provide path or paths; region requires path.'
  );

export type DesignImageViewScope = { workdir: string; previewDirectory: string };

const inside = (root: string, file: string): boolean => {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && !relative.split(path.sep).includes('..');
};

async function readImage(file: string, scope: DesignImageViewScope) {
  const root = await realpath(scope.workdir);
  const target = await realpath(path.resolve(scope.workdir, file));
  if (!inside(root, target)) {
    const previewStat = await lstat(scope.previewDirectory).catch(() => undefined);
    const previewRoot =
      previewStat?.isDirectory() && !previewStat.isSymbolicLink()
        ? await realpath(scope.previewDirectory)
        : undefined;
    if (!previewRoot || !inside(previewRoot, target))
      throw new Error('Image path is outside this design session.');
  }
  try {
    const bytes = await readFile(target);
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height) throw new Error('Invalid image dimensions');
    return { path: file, bytes, metadata, width: metadata.width, height: metadata.height };
  } catch {
    throw new Error(`Cannot decode ${file}.`);
  }
}

async function jpeg(
  image: Awaited<ReturnType<typeof readImage>>,
  region?: z.infer<typeof RegionSchema>
) {
  if (region && (region.x + region.width > image.width || region.y + region.height > image.height))
    throw new Error('Region is outside the image.');
  try {
    let pipeline = sharp(image.bytes);
    if (region)
      pipeline = pipeline.extract({
        left: region.x,
        top: region.y,
        width: region.width,
        height: region.height,
      });
    return await pipeline
      .flatten({ background: '#808080' })
      .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new Error(`Cannot decode ${image.path}.`);
  }
}

export async function viewImage(
  input: z.infer<typeof ViewImageInputSchema>,
  scope: DesignImageViewScope
) {
  if (input.path !== undefined) {
    const image = await readImage(input.path, scope);
    const delivered = await jpeg(image, input.region);
    const width = input.region?.width ?? image.width;
    const height = input.region?.height ?? image.height;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            path: input.path,
            format: 'jpeg',
            originalWidth: image.width,
            originalHeight: image.height,
            originalBytes: image.bytes.length,
            deliveredWidth: delivered.info.width,
            deliveredHeight: delivered.info.height,
            deliveredBytes: delivered.data.length,
            downscaled: delivered.info.width < width || delivered.info.height < height,
            ...(input.region ? { region: input.region } : {}),
            scale: Math.max(width, height) / Math.max(delivered.info.width, delivered.info.height),
            ...(image.metadata.hasAlpha ? { alphaBackground: '#808080' } : {}),
            note: 'Multiply delivered pixel coordinates by scale (and add region x/y) to get original coordinates.',
          }),
        },
        { type: 'image' as const, data: delivered.data.toString('base64'), mimeType: 'image/jpeg' },
      ],
    };
  }
  const files = input.paths;
  if (!files) throw new Error('Provide path or paths; region requires path.');
  const images = await Promise.all(files.map((file) => readImage(file, scope)));
  const columns = Math.ceil(Math.sqrt(images.length));
  const rows = Math.ceil(images.length / columns);
  const width = columns * 400 + (columns - 1) * 8;
  const height = rows * 400 + (rows - 1) * 8;
  const overlays: Parameters<ReturnType<typeof sharp>['composite']>[0] = [];
  for (const [index, image] of images.entries()) {
    let cell;
    try {
      cell = await sharp(image.bytes)
        .flatten({ background: '#808080' })
        .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new Error(`Cannot decode ${image.path}.`);
    }
    const left = (index % columns) * 408;
    const top = Math.floor(index / columns) * 408;
    overlays.push({
      input: cell.data,
      left: left + Math.floor((400 - cell.info.width) / 2),
      top: top + Math.floor((400 - cell.info.height) / 2),
    });
    overlays.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="28"><rect width="32" height="28" fill="#ffffff"/><text x="6" y="22" font-family="sans-serif" font-size="20" fill="#000000">${index + 1}</text></svg>`
      ),
      left,
      top,
    });
  }
  const delivered = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite(overlays)
    .jpeg({ quality: 70 })
    .toBuffer({ resolveWithObject: true });
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          cells: images.map((image, index) => ({
            index: index + 1,
            path: image.path,
            originalWidth: image.width,
            originalHeight: image.height,
            originalBytes: image.bytes.length,
          })),
          deliveredWidth: delivered.info.width,
          deliveredHeight: delivered.info.height,
          deliveredBytes: delivered.data.length,
          ...(images.some((image) => image.metadata.hasAlpha)
            ? { alphaBackground: '#808080' }
            : {}),
          note: 'Cells are numbered left to right, top to bottom. Use path with region to look closer at one image.',
        }),
      },
      { type: 'image' as const, data: delivered.data.toString('base64'), mimeType: 'image/jpeg' },
    ],
  };
}
