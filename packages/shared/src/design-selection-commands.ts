import { z } from 'zod';

/**
 * Display-only selection summary flowing canvas → shell for composer mirroring,
 * plus the validated command vocabulary flowing through the main process → canvas for direct
 * property edits. Element references and mutations still resolve against the
 * canonical document; these payloads never identify an edit target by themselves.
 */

export const DESIGN_SELECTION_BODY_LIMIT = 8192;
export const DESIGN_SELECTION_SUMMARY_ELEMENTS_MAX = 8;

export const DESIGN_ELEMENT_KINDS = [
  'text',
  'shape',
  'line',
  'image',
  'icon',
  'table',
  'chart',
] as const;
export const DesignElementKindSchema = z.enum(DESIGN_ELEMENT_KINDS);
export type DesignElementKind = z.infer<typeof DesignElementKindSchema>;

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
const cropEdge = z.number().finite().min(-10).max(0.999999);
export const DesignImageCropSchema = z
  .tuple([cropEdge, cropEdge, cropEdge, cropEdge])
  .superRefine(([left, top, right, bottom], ctx) => {
    if (left + right >= 1)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Horizontal crop must leave content' });
    if (top + bottom >= 1)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Vertical crop must leave content' });
  });

/** Per-kind current values for selection controls; absent = not applicable or indeterminate. */
export const DesignSelectedElementSchema = z
  .object({
    id: z.string().min(1).max(200),
    kind: DesignElementKindSchema,
    x: z.number().finite().min(0).max(4096).optional(),
    y: z.number().finite().min(0).max(4096).optional(),
    width: z.number().positive().max(100000).optional(),
    height: z.number().positive().max(100000).optional(),
    // text
    color: hexColor.optional(),
    fontFamily: z.string().min(1).max(200).optional(),
    fontSize: z.number().positive().max(1000).optional(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    alignH: z.enum(['left', 'center', 'right', 'justify']).optional(),
    // shape/icon fill (null = no fill; absent = non-solid or n/a)
    fill: hexColor.nullable().optional(),
    // shape/line stroke (null = no border)
    borderColor: hexColor.nullable().optional(),
    borderWidth: z.number().positive().max(100).optional(),
    // image
    fit: z.enum(['fill', 'contain', 'cover']).optional(),
    crop: DesignImageCropSchema.optional(),
    // line arrowheads
    arrowStart: z.enum(['arrow', 'stealth', 'diamond', 'oval']).nullable().optional(),
    arrowEnd: z.enum(['arrow', 'stealth', 'diamond', 'oval']).nullable().optional(),
  })
  .strict();
export type DesignSelectedElement = z.infer<typeof DesignSelectedElementSchema>;

export const DesignSelectionSummarySchema = z
  .object({
    count: z.number().int().min(0).max(10000),
    kinds: z.array(DesignElementKindSchema).max(DESIGN_ELEMENT_KINDS.length),
    elements: z
      .array(DesignSelectedElementSchema)
      .max(DESIGN_SELECTION_SUMMARY_ELEMENTS_MAX)
      .optional(),
    fonts: z.array(z.string().min(1).max(200)).max(100).optional(),
  })
  .strict();
export type DesignSelectionSummary = z.infer<typeof DesignSelectionSummarySchema>;

/** Shell → canvas property edits; one command maps to one kernel batch on the current selection. */
export const DesignCanvasCommandSchema = z
  .discriminatedUnion('verb', [
    z
      .object({
        verb: z.literal('text-style'),
        color: hexColor.optional(),
        fontFamily: z.string().min(1).max(200).optional(),
        fontSize: z.number().positive().max(1000).optional(),
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        alignH: z.enum(['left', 'center', 'right', 'justify']).optional(),
      })
      .strict(),
    z.object({ verb: z.literal('fill'), fill: hexColor.nullable() }).strict(),
    z
      .object({
        verb: z.literal('border'),
        color: hexColor.nullable(),
        width: z.number().positive().max(100).optional(),
      })
      .strict(),
    z
      .object({
        verb: z.literal('size'),
        width: z.number().positive().max(100000),
        height: z.number().positive().max(100000),
      })
      .strict(),
    z
      .object({
        verb: z.literal('position'),
        x: z.number().finite().min(0).max(4096),
        y: z.number().finite().min(0).max(4096),
      })
      .strict(),
    z.object({ verb: z.literal('image-fit'), fit: z.enum(['fill', 'contain', 'cover']) }).strict(),
    z.object({ verb: z.literal('image-crop'), crop: DesignImageCropSchema.nullable() }).strict(),
    z.object({ verb: z.literal('line-arrow'), preset: z.enum(['none', 'end', 'both']) }).strict(),
    // Element creation on the canvas (dock insert buttons); image requires the
    // content-addressed asset reference plus optional natural-size hints so the
    // canvas can fit bounds to the image aspect.
    z
      .object({
        verb: z.literal('add-element'),
        kind: z.enum(['text', 'shape', 'line', 'image']),
        shapeName: z.enum(['rect', 'roundRect', 'ellipse', 'oval', 'triangle', 'arrow']).optional(),
        src: z
          .string()
          .regex(/^asset:[0-9a-f]{64}$/)
          .optional(),
        naturalWidth: z.number().positive().max(100000).optional(),
        naturalHeight: z.number().positive().max(100000).optional(),
      })
      .strict(),
  ])
  .superRefine((command, ctx) => {
    if (command.verb === 'add-element' && command.kind === 'image' && command.src === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'add-element kind=image requires src',
        path: ['src'],
      });
    }
  });
export type DesignCanvasCommand = z.infer<typeof DesignCanvasCommandSchema>;

export const DesignCanvasCommandResultSchema = z
  .object({
    ok: z.boolean(),
    applied: z.number().int().min(0).optional(),
    error: z.string().max(500).optional(),
  })
  .strict();
export type DesignCanvasCommandResult = z.infer<typeof DesignCanvasCommandResultSchema>;

/** Native toolbar requests carry a selection epoch, never an editable target. */
export const DesignSelectionActionSchema = z.enum([
  'reference',
  'generate',
  'edit',
  'style',
  'regenerate',
]);
export type DesignSelectionAction = z.infer<typeof DesignSelectionActionSchema>;
export const DesignToolbarRequestSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('command'),
      selectionEpoch: z.number().int().nonnegative(),
      command: DesignCanvasCommandSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('action'),
      selectionEpoch: z.number().int().nonnegative(),
      action: DesignSelectionActionSchema,
    })
    .strict(),
]);
export type DesignToolbarRequest = z.infer<typeof DesignToolbarRequestSchema>;
export const DesignToolbarPresentationSchema = z
  .object({
    dark: z.boolean(),
    actionsEnabled: z.boolean(),
    labels: z
      .record(z.string().max(80), z.string().max(500))
      .refine((value) => Object.keys(value).length <= 100),
  })
  .strict();
export type DesignToolbarPresentation = z.infer<typeof DesignToolbarPresentationSchema>;
