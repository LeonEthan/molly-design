import { z } from 'zod';
import { isAbsolute } from 'node:path';
import {
  HarnessIdentitySchema,
  ModelConnectionSchema,
  ModelSelectionSchema,
  StoredMcpCredentialSchema,
} from '@molly/shared/embedded-harness';

const absolutePath = z.string().min(1).max(4096).refine(isAbsolute);
export const WorkerConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    runtimeEpoch: z.string().uuid(),
    productSessionId: z.string().min(1),
    workspaceId: z.string().min(1).max(200).optional(),
    harness: HarnessIdentitySchema,
    privateRoot: absolutePath,
    cwd: absolutePath,
    shellPath: absolutePath,
    connection: ModelConnectionSchema,
    selection: ModelSelectionSchema,
    systemPrompt: z.string().min(1).max(500_000),
    readBeforeEditReminder: z.string().min(1).max(16_384).optional(),
    designImageImport: z.boolean().optional(),
    designImageRecovery: z.boolean().optional(),
    permissionProfileId: z.string().min(1),
    /** Molly private data the auto-review sandbox denies, apart from the session cwd. */
    privateDataRoots: z.array(absolutePath).max(8).optional(),
    nativeSessionFile: absolutePath.optional(),
    nativeSessionId: z.string().uuid().optional(),
  })
  .strict();
export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;
export const WorkerCredentialGrantSchema = z
  .object({
    type: z.literal('credential'),
    runtimeEpoch: z.string().uuid(),
    runId: z.string().min(1).max(200),
    apiKey: z.string().min(1).max(16_384),
  })
  .strict();

export const WorkerMcpCredentialGrantSchema = z
  .object({
    type: z.literal('mcp-credentials'),
    runtimeEpoch: z.string().uuid(),
    runId: z.string().min(1).max(200),
    credentials: z.array(StoredMcpCredentialSchema).min(1).max(32),
  })
  .strict()
  .refine((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 512_000);
