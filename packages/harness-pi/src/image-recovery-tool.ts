import { createHash } from 'node:crypto';
import { Type } from '@earendil-works/pi-ai';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import {
  HARNESS_IMAGE_RECOVERY_PERMISSION,
  HarnessImageRecoveryArgumentsSchema,
  HarnessImageRecoveryRequestSchema,
  HarnessImageRecoveryResultSchema,
  type HarnessImageRecoveryRequest,
  type HarnessImageRecoveryResult,
  type HarnessRunSnapshot,
} from '@molly/shared/embedded-harness';
import { waitForApproval, type ToolApproval } from './approved-tools';

export type ImageRecoveryProvider = (
  request: HarnessImageRecoveryRequest,
  signal: AbortSignal
) => Promise<HarnessImageRecoveryResult>;

/** Optional host-owned read capability; never calls an MCP server or image provider. */
export function createImageRecoveryTool(input: {
  approve: ToolApproval;
  recover: ImageRecoveryProvider;
  current: () => { snapshot: HarnessRunSnapshot; signal: AbortSignal } | undefined;
}): ToolDefinition {
  return {
    name: 'molly_recover_images',
    label: 'Recover existing image assets',
    description:
      'Read-only recovery of external image assets previously imported by this design session. Empty arguments list import intents, not verified files; follow nextCursor with cursor. Supply one operationId to verify existing local bytes and receive usable paths plus missing/changed/unsafe results. Does not contact a provider, regenerate, settle a paid operation, or commit artwork. It cannot retrieve results never received locally or recover built-in image receipts yet.',
    parameters: Type.Object(
      {
        operationId: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })),
        cursor: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })),
      },
      { additionalProperties: false }
    ),
    async execute(toolCallId, raw, nativeSignal) {
      try {
        const run = input.current();
        if (!run) throw new Error('harness_run_retired');
        const signal = AbortSignal.any([run.signal, ...(nativeSignal ? [nativeSignal] : [])]);
        signal.throwIfAborted();
        const query = HarnessImageRecoveryArgumentsSchema.parse(raw);
        const allowed = await waitForApproval(
          input.approve({
            toolCallId,
            name: HARNESS_IMAGE_RECOVERY_PERMISSION,
            arguments: structuredClone(query),
            signal,
          }),
          signal
        );
        signal.throwIfAborted();
        if (!allowed || input.current()?.snapshot !== run.snapshot)
          throw new Error('harness_permission_denied');
        const request = HarnessImageRecoveryRequestSchema.parse({
          version: 1,
          runId: run.snapshot.runId,
          runtimeEpoch: run.snapshot.runtimeEpoch,
          productSessionId: run.snapshot.sessionId,
          turnId: run.snapshot.turnId,
          toolCallId,
          requestDigest: createHash('sha256').update(JSON.stringify(query)).digest('hex'),
          query,
        });
        const result = HarnessImageRecoveryResultSchema.parse(await input.recover(request, signal));
        signal.throwIfAborted();
        if (input.current()?.snapshot !== run.snapshot) throw new Error('harness_run_retired');
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          details: { recovery: result.kind },
        };
      } catch {
        // Do not retain host paths, raw validation inputs or diagnostics in errors.
        throw new Error('harness_image_recovery_failed');
      }
    },
  };
}
