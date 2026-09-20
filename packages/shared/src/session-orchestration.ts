import { z } from 'zod';

import type { MachineId, SessionId, WorkspaceId } from './ids';
import type { SessionTurnInputConfig } from './ai';

export const MOLLY_OPERATION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
export const MOLLY_OPERATION_ID_MAX_LENGTH = 64;
export const MOLLY_OPERATION_DEFAULT_DEADLINE_SECONDS = 86_400;
export const MOLLY_OPERATION_MIN_DEADLINE_SECONDS = 60;
export const MOLLY_OPERATION_MAX_DEADLINE_SECONDS = 604_800;
export const MOLLY_OPERATION_COMMAND_MAX_BYTES = 256 * 1024;
export const MOLLY_OPERATION_COMPLETION_MAX_BYTES = 64 * 1024;
export const MOLLY_MAX_CHAIN_DEPTH = 32;

export const MollyOperationIdSchema = z
  .string()
  .min(1)
  .max(MOLLY_OPERATION_ID_MAX_LENGTH)
  .regex(MOLLY_OPERATION_ID_PATTERN);

export const MollyErrorSchema = z
  .object({
    code: z.string().trim().min(1),
    message: z.string(),
    retryable: z.boolean(),
  })
  .strict();

export type MollyError = z.infer<typeof MollyErrorSchema>;

const OperationTargetSchema = z.object({ sessionId: z.string(), userTurnId: z.string() }).strict();
const OperationOutputPreviewSchema = z
  .object({
    text: z.string(),
    truncated: z.literal(true).optional(),
    omittedBytes: z.number().int().nonnegative().optional(),
  })
  .strict();

export const MollyOperationItemSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('active'),
      label: z.string().optional(),
      target: OperationTargetSchema,
      inputDurable: z.boolean(),
    })
    .strict(),
  z
    .object({
      status: z.literal('succeeded'),
      label: z.string().optional(),
      target: OperationTargetSchema,
      assistantTurnId: z.string(),
      output: OperationOutputPreviewSchema.optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      label: z.string().optional(),
      target: OperationTargetSchema.optional(),
      error: MollyErrorSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('cancelled'),
      label: z.string().optional(),
      target: OperationTargetSchema.optional(),
    })
    .strict(),
]);

const OperationResultSchema = z.object({ items: z.array(MollyOperationItemSchema) }).strict();
const CompletionTruncationSchema = z
  .object({ truncated: z.literal(true), omittedBytes: z.number().int().nonnegative() })
  .strict();
export const MollyOperationCompletionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('result'),
      value: OperationResultSchema,
      truncation: CompletionTruncationSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('error'),
      error: MollyErrorSchema,
      truncation: CompletionTruncationSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('cancelled'),
      partial: OperationResultSchema.optional(),
      truncation: CompletionTruncationSchema.optional(),
    })
    .strict(),
]);

export type MollyOperationKind =
  | 'session_create'
  | 'session_create_many'
  | 'session_chat'
  | 'session_chat_many';

export type OperationProgressKind = Extract<
  MollyOperationKind,
  'session_create' | 'session_create_many'
>;

export type OperationProgressStatus = 'created' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type OperationProgressItem = {
  target: MollyOperationItemTarget;
  label?: string;
  status: OperationProgressStatus;
};

export type OperationProgressContent = {
  type: 'operation_progress';
  operationId: string;
  operationKind: OperationProgressKind;
  items: OperationProgressItem[];
};

/**
 * Durable batch Operations intentionally bypass the cooperative session quotas;
 * single-target Commands stay subject to them (specs/session-orchestration.md).
 */
export function shouldBypassSessionQuota(kind: MollyOperationKind): boolean {
  return kind === 'session_create_many' || kind === 'session_chat_many';
}

export type MollyOperationItemTarget = {
  sessionId: SessionId;
  userTurnId: string;
};

export type MollyOperationOutputPreview = {
  text: string;
  truncated?: true;
  omittedBytes?: number;
};

export type MollyOperationItemResult =
  | {
      status: 'active';
      label?: string;
      target: MollyOperationItemTarget;
      inputDurable: boolean;
    }
  | {
      status: 'succeeded';
      label?: string;
      target: MollyOperationItemTarget;
      assistantTurnId: string;
      output?: MollyOperationOutputPreview;
    }
  | {
      status: 'failed';
      label?: string;
      target?: MollyOperationItemTarget;
      error: MollyError;
    }
  | {
      status: 'cancelled';
      label?: string;
      target?: MollyOperationItemTarget;
    };

export type MollyOperationResult = {
  items: MollyOperationItemResult[];
};

export type MollyCompletionTruncation = {
  truncated: true;
  omittedBytes: number;
};

export type MollyOperationCompletion =
  | { type: 'result'; value: MollyOperationResult; truncation?: MollyCompletionTruncation }
  | { type: 'error'; error: MollyError; truncation?: MollyCompletionTruncation }
  | {
      type: 'cancelled';
      partial?: MollyOperationResult;
      truncation?: MollyCompletionTruncation;
    };

export type MollyOperationSnapshot =
  | {
      id: string;
      kind: MollyOperationKind;
      state: 'active';
      createdAt: string;
      deadlineAt: string;
      progress?: { totalItems: number; terminalItems: number };
      items: MollyOperationItemResult[];
    }
  | {
      id: string;
      kind: MollyOperationKind;
      state: 'finished';
      createdAt: string;
      deadlineAt: string;
      finishedAt: string;
      completion: MollyOperationCompletion;
    };

export type FrozenOperationContinuationConfig = {
  agentConfigId?: string;
  inputConfig: SessionTurnInputConfig;
  /** Frozen causal Turn for delegated Operations; recovery must not re-resolve it. */
  sourceTurnId?: string;
  /**
   * Effective per-target create/chat config captured at acceptance. Null entries
   * correspond to batch items rejected before a target was accepted.
   */
  targetDispatchConfigs?: Array<{
    agentConfigId?: string;
    modeId?: string;
    modelId?: string;
    modelSelection?: SessionTurnInputConfig['modelSelection'];
    configOptionValues?: Record<string, string | boolean>;
    /**
     * Frozen capability gate for the built-in Molly Task MCP tools, carried
     * from the driving Turn so recovery keeps the same tool surface.
     */
    taskToolsEnabled?: boolean;
    mcpServerIds?: SessionTurnInputConfig['mcpServerIds'];
    inheritSessionDefaults?: false;
  } | null>;
};

export type StoredMollyOperation = {
  workspaceId: WorkspaceId;
  ownerMachineId: MachineId;
  requesterSessionId: SessionId;
  requesterUserId: string;
  operationId: string;
  kind: MollyOperationKind;
  fingerprint: string;
  canonicalCommand: unknown;
  frozenContinuationConfig: FrozenOperationContinuationConfig;
  initiatorChainDepth: number;
  createdAt: string;
  deadlineAt: string;
  state: 'active' | 'finished';
  items: MollyOperationItemResult[];
  completion?: MollyOperationCompletion;
  finishedAt?: string;
};

export type StoredMollyDelivery = {
  sequence: number;
  workspaceId: WorkspaceId;
  requesterSessionId: SessionId;
  operationId: string;
  deliveryId: string;
  systemTurnId: string;
  state: 'pending' | 'consumed';
  executionPhase: 'ready' | 'claimed' | 'prepared' | 'started' | 'uncertain';
  attemptCount: number;
  activeClaimId?: string;
  activeClaimWorkerBootId?: string;
  initiatorChainDepth: number;
  completion: MollyOperationCompletion;
  consumedAt?: string;
};

export type OperationCompletionContent = {
  type: 'operation_completion';
  deliveryId: string;
  operationId: string;
  operationKind: MollyOperationKind;
  /** Stable system history entry id for the matching operation_progress card, when one exists. */
  progressMessageId?: string;
  completion: MollyOperationCompletion;
  continuation?: {
    status: 'not_started' | 'uncertain';
    reason: {
      code:
        | 'CONFIGURATION_UNAVAILABLE'
        | 'DELIVERY_ATTEMPTS_EXHAUSTED'
        | 'DELIVERY_EXECUTION_UNCERTAIN';
      message: string;
    };
  };
};

export const makeMollyError = (code: string, message: string, retryable: boolean): MollyError => ({
  code,
  message,
  retryable,
});

export const isTerminalMollyOperationItem = (item: MollyOperationItemResult): boolean =>
  item.status !== 'active';
