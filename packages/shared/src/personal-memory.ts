import { z } from 'zod';

export const PERSONAL_MEMORY_LIMIT = 32;
export const PersonalMemoryEntrySchema = z
  .object({
    id: z.string().min(1).max(100),
    text: z.string().trim().min(1).max(300),
  })
  .strict();
export const PersonalMemoryChangesSchema = z
  .array(PersonalMemoryEntrySchema.partial({ id: true }))
  .max(8);
export const PersonalMemorySnapshotSchema = z
  .object({
    revision: z.string().min(1).max(100),
    enabled: z.boolean(),
    entries: z.array(PersonalMemoryEntrySchema).max(PERSONAL_MEMORY_LIMIT),
  })
  .strict();
export type PersonalMemorySnapshot = z.infer<typeof PersonalMemorySnapshotSchema>;
export const PersonalMemoryOperationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read') }).strict(),
  z
    .object({
      action: z.literal('edit'),
      revision: z.string(),
      id: z.string(),
      text: PersonalMemoryEntrySchema.shape.text,
    })
    .strict(),
  z.object({ action: z.literal('delete'), revision: z.string(), id: z.string() }).strict(),
  z.object({ action: z.literal('configure'), revision: z.string(), enabled: z.boolean() }).strict(),
]);
export const HARNESS_MEMORY_METHOD = '_molly/personal-memory';
export const HarnessMemoryRequestSchema = z
  .object({
    productSessionId: z.string(),
    runtimeEpoch: z.string(),
    runId: z.string(),
    turnId: z.string(),
    operation: z.discriminatedUnion('action', [
      z.object({ action: z.literal('read') }).strict(),
      z
        .object({
          action: z.literal('capture'),
          revision: z.string(),
          changes: PersonalMemoryChangesSchema,
        })
        .strict(),
    ]),
  })
  .strict();
export type HarnessMemoryRequest = z.infer<typeof HarnessMemoryRequestSchema>;
export type PersonalMemoryProvider = (
  request: HarnessMemoryRequest,
  signal: AbortSignal
) => Promise<PersonalMemorySnapshot>;
