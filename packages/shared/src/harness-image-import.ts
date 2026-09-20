import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.string().min(1).max(200);
const mime = z.enum(['image/png', 'image/jpeg', 'image/gif']);
export const HARNESS_IMAGE_IMPORT_METHOD = '_molly/import_image_result';
/** Private tools/call metadata, not a model argument or a publication authority. */
export const HARNESS_INLINE_IMAGE_RESULT_META = 'molly/inline-image-result';
export const HARNESS_IMAGE_MAX_ENCODED_BYTES = 22_369_624;
export const HARNESS_IMAGE_RECOVERY_METHOD = '_molly/recover_image_results';
export const HARNESS_IMAGE_RECOVERY_PERMISSION = 'molly/recover_images';

const runIdentity = {
  version: z.literal(1),
  runId: digest,
  runtimeEpoch: z.string().uuid(),
  productSessionId: identity,
  turnId: identity,
  toolCallId: z.string().min(1).max(512),
  requestDigest: digest,
};
export const HarnessImageImportIdentitySchema = z
  .object({
    ...runIdentity,
    connectionId: identity,
    connectionRevision: z.number().int().positive(),
    serverName: z.string().min(1).max(200),
    toolName: z.string().min(1).max(128),
  })
  .strict();

/** Worker -> its owning host only. No caller-selected filesystem destination. */
export const HarnessImageImportRequestSchema = HarnessImageImportIdentitySchema.extend({
  images: z
    .array(
      z
        .object({
          mimeType: mime,
          data: z
            .string()
            .min(4)
            .max(HARNESS_IMAGE_MAX_ENCODED_BYTES)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/),
        })
        .strict()
    )
    .min(1)
    .max(16),
})
  .strict()
  .refine(
    (value) =>
      value.images.reduce((sum, image) => sum + image.data.length, 0) <=
      HARNESS_IMAGE_MAX_ENCODED_BYTES
  );
export type HarnessImageImportRequest = z.infer<typeof HarnessImageImportRequestSchema>;

export const HarnessImageAssetDescriptorSchema = z
  .object({
    path: z.string().regex(/^media\/[a-f0-9]{64}\.(png|jpg|gif)$/),
    sha256: digest,
    mimeType: mime,
    width: z.number().int().min(1).max(16384),
    height: z.number().int().min(1).max(16384),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(16 * 1024 * 1024),
  })
  .strict()
  .refine((value) => value.width * value.height <= 64_000_000)
  .refine(
    (value) =>
      value.path ===
      `media/${value.sha256}.${value.mimeType === 'image/jpeg' ? 'jpg' : value.mimeType === 'image/png' ? 'png' : 'gif'}`
  );
export const HarnessImportedAssetSchema = HarnessImageAssetDescriptorSchema.safeExtend({
  absolutePath: z.string().min(1).max(4096),
});
export const HarnessImageImportResultSchema = z
  .object({
    assets: z.array(HarnessImportedAssetSchema).min(1).max(16),
  })
  .strict();
export type HarnessImageImportResult = z.infer<typeof HarnessImageImportResultSchema>;

/** Empty arguments list a page; operationId verifies one operation without provider I/O. */
export const HarnessImageRecoveryArgumentsSchema = z
  .object({
    operationId: digest.optional(),
    cursor: digest.optional(),
  })
  .strict()
  .refine((value) => !(value.operationId && value.cursor));
export const HarnessImageRecoveryRequestSchema = z
  .object({
    ...runIdentity,
    query: HarnessImageRecoveryArgumentsSchema,
  })
  .strict();
export type HarnessImageRecoveryRequest = z.infer<typeof HarnessImageRecoveryRequestSchema>;
export const HarnessImageRecoveryResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('listed'),
      operations: z
        .array(
          z
            .object({
              operationId: digest,
              sourceTurnId: identity,
              connectionId: identity,
              connectionRevision: z.number().int().positive(),
              toolName: z.string().min(1).max(128),
              expectedAssets: z.number().int().min(1).max(16),
            })
            .strict()
        )
        .max(20),
      nextCursor: digest.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('verified'),
      operationId: digest,
      sourceTurnId: identity,
      assets: z.array(HarnessImportedAssetSchema).max(16),
      unavailable: z
        .array(
          z
            .object({
              path: HarnessImageAssetDescriptorSchema.shape.path,
              reason: z.enum(['missing', 'changed', 'unsafe']),
            })
            .strict()
        )
        .max(16),
    })
    .strict(),
]);
export type HarnessImageRecoveryResult = z.infer<typeof HarnessImageRecoveryResultSchema>;
