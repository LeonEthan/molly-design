import { staticV1UnregisteredFontFamilies } from '../../../../packages/design-bento/vendor/packages/contracts/src/static-v1';
import { createVisualDocumentKernel } from '../../../../packages/design-bento/vendor/packages/kernel/src/kernel';
import type {
  BentoDocV4,
  VisualCommandV4,
} from '../../../../packages/design-bento/vendor/packages/contracts/src/index';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assertRenderableLines } from '../../../../packages/design-authoring/src/canvas-format';
import {
  describeAssetAdmissionFailure,
  inspectAssetAdmission,
} from '../../../../packages/design-authoring/src/asset-admission';

export const designId = z.string().uuid();
export const designSize = z.number().int().min(1).max(4096);
const bounds = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().positive(),
  z.number().positive(),
]);
const documentSchema = z
  .object({
    schemaVersion: z.literal(4),
    canvas: z.object({ width: designSize, height: designSize }).strict(),
    diagnostics: z.array(z.unknown()).max(1000).default([]),
    background: z.record(z.string(), z.unknown()),
    fonts: z
      .array(
        z
          .object({ family: z.string().min(1), src: z.string().regex(/^asset:[a-f0-9]{64}$/) })
          .passthrough()
      )
      .max(100)
      .optional(),
    elements: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            kind: z.enum(['text', 'shape', 'line', 'image', 'icon', 'table', 'chart']),
            bounds,
            zIndex: z.number().int().nonnegative(),
          })
          .passthrough()
      )
      .max(2000),
  })
  .strict();
export const designInput = z
  .object({
    doc: z
      .union([z.string().max(32 * 1024 * 1024), documentSchema])
      .transform((value) =>
        documentSchema.parse(typeof value === 'string' ? JSON.parse(value) : value)
      ),
    assets: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.string().max(32 * 1024 * 1024)),
  })
  .strict();
export const designAssociation = z
  .object({
    sessionId: designId,
    name: z.string().trim().min(1).max(200),
    userId: z.string().min(1).max(200),
    machineId: z.string().min(1).max(200),
    createdAt: z.string().datetime(),
  })
  .strict();
/**
 * Whether the store could write this document and its assets.
 *
 * The rules are the ones a write applies (`designInput` plus `validateAssets`:
 * schema, kernel replay, asset integrity), so the answer is exactly "a save of
 * this content would be accepted". The intake is the fail-closed gate for a
 * *project* and the two do not cover the same vocabulary — the store bounds an
 * element id the intake leaves free — which is why a caller deciding whether a
 * document is usable has to ask this one too.
 */
export function acceptsDesignContent(raw: unknown): boolean {
  try {
    validateAssets(designInput.parse(raw));
    return true;
  } catch {
    return false;
  }
}

export function validateAssets(content: z.output<typeof designInput>) {
  if (new Set(content.doc.elements.map((e) => e.id)).size !== content.doc.elements.length)
    throw Error('Duplicate element IDs');
  const kernel = createVisualDocumentKernel({
    schemaVersion: 4,
    canvas: content.doc.canvas,
    background: { type: 'solid', color: '#ffffff' },
    diagnostics: [],
    elements: [],
  });
  const commands: VisualCommandV4[] = [
    {
      type: 'setBackground',
      background: content.doc.background as unknown as BentoDocV4['background'],
    },
    ...(content.doc.fonts ?? []).map((font) => ({
      type: 'addFontRegistration' as const,
      font: font as unknown as NonNullable<BentoDocV4['fonts']>[number],
    })),
    ...content.doc.elements.map((element) => ({
      type: 'createElement' as const,
      element: element as unknown as BentoDocV4['elements'][number],
    })),
  ];
  const checked = kernel.apply({
    batchId: 'validate',
    actor: 'design-service',
    baseRevision: 0,
    commands,
  });
  if (!checked.ok) throw Error(checked.error.message);
  assertRenderableLines(content.doc.elements);
  const missingFonts = staticV1UnregisteredFontFamilies(
    content.doc.elements,
    (content.doc.fonts ?? []).map((font) => font.family)
  );
  if (missingFonts.length) throw Error('Register required fonts: ' + missingFonts.join(', '));
  const required = new Set<string>();
  const walk = (value: unknown, depth = 0): void => {
    if (depth > 40) throw Error('Document nesting exceeds limit');
    if (typeof value === 'string' && value.startsWith('asset:')) required.add(value.slice(6));
    if (Array.isArray(value)) value.forEach((v) => walk(v, depth + 1));
    else if (value && typeof value === 'object')
      for (const [key, v] of Object.entries(value)) {
        if (
          ['src', 'href', 'url'].includes(key) &&
          typeof v === 'string' &&
          !/^asset:[a-f0-9]{64}$/.test(v)
        )
          throw Error('External document resources are unsupported');
        walk(v, depth + 1);
      }
  };
  walk(content.doc);
  const assets: Record<string, string> = {};
  for (const key of required) {
    const uri = content.assets[key];
    const match = uri?.match(
      /^data:(image\/(?:png|jpeg|gif)|font\/(?:ttf|otf|woff|woff2));base64,([A-Za-z0-9+/]+={0,2})$/
    );
    if (!match?.[2]) throw Error('Missing or unsupported asset: ' + key);
    const bytes = Buffer.from(match[2], 'base64');
    const admission = inspectAssetAdmission(bytes, `asset:${key}`);
    if (!admission.ok) throw Error(describeAssetAdmissionFailure(admission.failure));
    if (admission.mime !== match[1]) throw Error('Asset MIME does not match its bytes');
    if (createHash('sha256').update(bytes).digest('hex') !== key)
      throw Error('Asset checksum mismatch: ' + key);
    assets[key] = uri as string;
  }
  return assets;
}
