import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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

const FontSampleSchema = z.object({ file: z.string(), face: z.string().min(1).max(120) }).strict();

const INPUT_ERROR =
  'Provide path, paths or fonts; region requires path; text is required with fonts and forbidden otherwise.';

export const ViewImageInputSchema = z
  .object({
    path: z.string().optional(),
    paths: z.array(z.string()).min(2).max(9).optional(),
    region: RegionSchema.optional(),
    fonts: z.array(FontSampleSchema).min(1).max(8).optional(),
    text: z.string().min(1).max(60).optional(),
  })
  .strict()
  .refine(
    (input) =>
      (input.fonts !== undefined
        ? input.paths === undefined && input.text !== undefined
        : (input.path !== undefined) !== (input.paths !== undefined) && input.text === undefined) &&
      (input.region === undefined || input.path !== undefined),
    INPUT_ERROR
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

function systemFontDirectories(): string[] {
  switch (process.platform) {
    case 'darwin':
      return ['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library/Fonts')];
    case 'win32':
      return [
        ...(process.env.WINDIR ? [path.join(process.env.WINDIR, 'Fonts')] : []),
        ...(process.env.LOCALAPPDATA
          ? [path.join(process.env.LOCALAPPDATA, 'Microsoft/Windows/Fonts')]
          : []),
      ];
    default:
      return [
        '/usr/share/fonts',
        '/usr/local/share/fonts',
        path.join(os.homedir(), '.local/share/fonts'),
        path.join(os.homedir(), '.fonts'),
      ];
  }
}

async function resolveFont(file: string, scope: DesignImageViewScope) {
  if (!path.isAbsolute(file)) throw new Error('Font file path must be absolute.');
  const target = await realpath(file);
  const roots = await Promise.all(
    [scope.workdir, ...systemFontDirectories()].map(async (root) =>
      realpath(root).catch(() => undefined)
    )
  );
  if (!roots.some((root) => root !== undefined && inside(root, target)))
    throw new Error('Font path is outside the system font directories and this design session.');
  if (
    !['.ttf', '.otf', '.ttc'].includes(path.extname(file).toLowerCase()) ||
    !['.ttf', '.otf', '.ttc'].includes(path.extname(target).toLowerCase())
  )
    throw new Error('Font file must be .ttf, .otf or .ttc.');
  if (!(await stat(target)).isFile()) throw new Error('Font path must be a regular file.');
  return target;
}

const normalizedFace = (value: string) => value.toLowerCase().replace(/[\s-]/g, '');

function hasFontFace(bytes: Buffer, face: string): boolean {
  const collection = bytes.toString('ascii', 0, 4) === 'ttcf';
  const faceCount = collection ? bytes.readUInt32BE(8) : 1;
  if (faceCount === 0 || (collection && faceCount > (bytes.length - 12) / 4))
    throw new Error('Invalid font collection');
  const offsets = collection
    ? Array.from({ length: faceCount }, (_, index) => bytes.readUInt32BE(12 + index * 4))
    : [0];
  const requested = normalizedFace(face);
  return offsets.some((offset) => {
    if (
      bytes.readUInt32BE(offset) !== 0x00010000 &&
      !['OTTO', 'true'].includes(bytes.toString('ascii', offset, offset + 4))
    )
      throw new Error('Invalid font signature');
    const tables = bytes.readUInt16BE(offset + 4);
    for (let index = 0; index < tables; index++) {
      const table = offset + 12 + index * 16;
      if (bytes.toString('ascii', table, table + 4) !== 'name') continue;
      const start = bytes.readUInt32BE(table + 8);
      const count = bytes.readUInt16BE(start + 2);
      const strings = start + bytes.readUInt16BE(start + 4);
      const names = new Map<number, Set<string>>();
      for (let record = 0; record < count; record++) {
        const entry = start + 6 + record * 12;
        const platform = bytes.readUInt16BE(entry);
        const id = bytes.readUInt16BE(entry + 6);
        if (![1, 2, 4, 6, 16, 17].includes(id)) continue;
        const length = bytes.readUInt16BE(entry + 8);
        const begin = strings + bytes.readUInt16BE(entry + 10);
        if (begin + length > bytes.length) throw new Error('Invalid font names');
        const value = bytes.subarray(begin, begin + length);
        const name = normalizedFace(
          platform === 0 || platform === 3
            ? Buffer.from(value).swap16().toString('utf16le')
            : value.toString('latin1')
        );
        const values = names.get(id) ?? new Set<string>();
        values.add(name);
        names.set(id, values);
      }
      for (const id of [1, 4, 6, 16]) if (names.get(id)?.has(requested)) return true;
      for (const [familyId, styleId] of [
        [1, 2],
        [16, 17],
      ]) {
        if (familyId === undefined || styleId === undefined) continue;
        for (const family of names.get(familyId) ?? [])
          for (const style of names.get(styleId) ?? [])
            if (family + style === requested) return true;
      }
    }
    return false;
  });
}

const escapeMarkup = (text: string) =>
  text.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return '&quot;';
    }
  });

async function fontInk(fontfile: string, face: string, text: string) {
  return sharp({
    text: { text: escapeMarkup(text), fontfile, font: `${face} 96`, dpi: 72, rgba: true },
  })
    .trim()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

type FontRow = {
  row: string | number;
  path?: string;
  region?: z.infer<typeof RegionSchema>;
  file?: string;
  face?: string;
};

async function fontRows(input: z.infer<typeof ViewImageInputSchema>, scope: DesignImageViewScope) {
  if (!input.fonts || input.text === undefined) throw new Error(INPUT_ERROR);
  const rows: { metadata: FontRow; data: Buffer; width: number; height: number }[] = [];
  if (input.path !== undefined) {
    const image = await readImage(input.path, scope);
    const region = input.region;
    if (
      region &&
      (region.x + region.width > image.width || region.y + region.height > image.height)
    )
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
      const cropped = await pipeline.png().toBuffer();
      const ink = await sharp(cropped)
        .trim()
        .flatten({ background: '#ffffff' })
        .png()
        .toBuffer({ resolveWithObject: true });
      rows.push({
        metadata: { row: 'R', path: input.path, ...(region ? { region } : {}) },
        data: ink.data,
        width: ink.info.width,
        height: ink.info.height,
      });
    } catch {
      throw new Error(`Cannot decode ${input.path}.`);
    }
  }
  const inkHeight = rows[0] ? Math.max(48, Math.min(120, rows[0].height)) : 96;
  for (const [index, font] of input.fonts.entries()) {
    const fontfile = await resolveFont(font.file, scope);
    let ink;
    let fallback;
    let knownFace;
    try {
      ink = await fontInk(fontfile, font.face, input.text);
      fallback = await fontInk(fontfile, 'Molly Missing Face', input.text);
      knownFace = hasFontFace(await readFile(fontfile), font.face);
    } catch {
      throw new Error(`Cannot render ${font.file} as "${font.face}".`);
    }
    if (
      !knownFace &&
      ink.info.width === fallback.info.width &&
      ink.info.height === fallback.info.height &&
      ink.data.equals(fallback.data)
    )
      throw new Error(`Face "${font.face}" is not in ${font.file}.`);
    const data = await sharp(ink.data, { raw: ink.info })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
    rows.push({
      metadata: { row: index + 1, file: font.file, face: font.face },
      data,
      width: ink.info.width,
      height: ink.info.height,
    });
  }
  const labelWidth = 32;
  const widths = rows.map((row) => Math.max(1, Math.round((row.width * inkHeight) / row.height)));
  const width = Math.min(1280, Math.max(...widths) + labelWidth);
  const height = rows.length * inkHeight + (rows.length - 1) * 8;
  const overlays: Parameters<ReturnType<typeof sharp>['composite']>[0] = [];
  const referenceWidth = input.path !== undefined ? widths[0] : undefined;
  const metadata = [];
  for (const [index, row] of rows.entries()) {
    const rowWidth = widths[index];
    if (rowWidth === undefined) throw new Error('Missing row width');
    const downscaled = rowWidth > width - labelWidth;
    const resized = await sharp(row.data)
      .resize(downscaled ? { width: width - labelWidth } : { height: inkHeight })
      .png()
      .toBuffer({ resolveWithObject: true });
    const top = index * (inkHeight + 8);
    overlays.push({
      input: resized.data,
      left: labelWidth,
      top: top + Math.floor((inkHeight - resized.info.height) / 2),
    });
    overlays.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="28"><rect width="32" height="28" fill="#ffffff"/><text x="6" y="22" font-family="sans-serif" font-size="20" fill="#000000">${row.metadata.row}</text></svg>`
      ),
      left: 0,
      top,
    });
    metadata.push({
      ...row.metadata,
      inkWidth: rowWidth,
      inkHeight,
      ...(typeof row.metadata.row === 'number' && referenceWidth
        ? { widthRatio: rowWidth / referenceWidth }
        : {}),
      ...(downscaled
        ? {
            downscaled: true,
            deliveredInkWidth: resized.info.width,
            deliveredInkHeight: resized.info.height,
          }
        : {}),
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
          rows: metadata,
          text: input.text,
          deliveredWidth: delivered.info.width,
          deliveredHeight: delivered.info.height,
          deliveredBytes: delivered.data.length,
          note: 'Rows are scaled to the same ink height; widthRatio = row ink width / reference ink width. Pick the closest row, then set fontSize from font-catalog match and render the artwork once.',
        }),
      },
      { type: 'image' as const, data: delivered.data.toString('base64'), mimeType: 'image/jpeg' },
    ],
  };
}

export async function viewImage(
  input: z.infer<typeof ViewImageInputSchema>,
  scope: DesignImageViewScope
) {
  if (input.fonts !== undefined) return fontRows(input, scope);
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
  if (!files) throw new Error(INPUT_ERROR);
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
