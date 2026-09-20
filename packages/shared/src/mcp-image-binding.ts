import { z } from 'zod';

const FieldName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/)
  .refine((name) => !['__proto__', 'prototype', 'constructor'].includes(name));
const commonFields = { prompt: FieldName, model: FieldName, size: FieldName.optional() };
const uniqueFields = (fields: Record<string, string | undefined>) => {
  const names = Object.values(fields).filter((name) => name !== undefined);
  return new Set(names).size === names.length;
};
const ToolName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:/-]+$/);

/** Public, top-level field names only. Credentials belong to the connection vault. */
export const McpImageBindingSchema = z
  .object({
    version: z.literal(1),
    model: z
      .string()
      .min(1)
      .max(256)
      .regex(/^\S+$/)
      .refine((value) =>
        Array.from(value).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
      ),
    generate: z
      .object({
        tool: ToolName,
        fields: z.object(commonFields).strict().refine(uniqueFields),
      })
      .strict()
      .optional(),
    edit: z
      .object({
        tool: ToolName,
        fields: z
          .object({ ...commonFields, images: FieldName, mask: FieldName.optional() })
          .strict()
          .refine(uniqueFields),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => Boolean(value.generate || value.edit))
  .refine((value) => !value.generate || !value.edit || value.generate.tool !== value.edit.tool);

export type McpImageBinding = z.infer<typeof McpImageBindingSchema>;
