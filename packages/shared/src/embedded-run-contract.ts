import type { McpServer, PromptResponse } from '@agentclientprotocol/sdk';
import { z } from 'zod';
import {
  HarnessRunOutcomeSchema,
  HarnessRunSnapshotSchema,
  HarnessSessionBindingSchema,
  McpCredentialBindingSchema,
  mcpCredentialMatchesServer,
  type HarnessRunOutcome,
  type HarnessRunSnapshot,
  type HarnessSessionBinding,
  type McpCredentialBinding,
  type ProtectedImageConnection,
} from './embedded-harness';
import { sha256Hex } from './incremental-sha256';

export type Mismatch = {
  reason: 'mcp_binding' | 'binding_identity' | 'snapshot' | 'outcome';
  field?: string;
};
export type Accepted<T> = { ok: true; value: T } | { ok: false; mismatch: Mismatch };

function mismatch(reason: Mismatch['reason'], field?: string): Accepted<never> {
  return { ok: false, mismatch: { reason, ...(field ? { field } : {}) } };
}

type RunConfig = Pick<
  HarnessRunSnapshot,
  'runtimeEpoch' | 'harness' | 'connection' | 'selection' | 'permissionProfileId'
> & { productSessionId: string };

export function readMcpBindings(
  servers: readonly McpServer[],
  workspaceId: string | undefined
): Accepted<McpCredentialBinding[]> {
  const connections: McpCredentialBinding[] = [];
  for (const server of servers) {
    const raw = server._meta?.mollyMcpCredential;
    if (raw === undefined) continue;
    const parsed = McpCredentialBindingSchema.safeParse(raw);
    if (!parsed.success) return mismatch('mcp_binding', 'schema');
    const binding = parsed.data;
    const catalog = server._meta?.mollyConnection;
    if (binding.workspaceId !== workspaceId) return mismatch('mcp_binding', 'workspaceId');
    if (!mcpCredentialMatchesServer(binding, server)) return mismatch('mcp_binding', 'destination');
    if (
      !catalog ||
      typeof catalog !== 'object' ||
      !('id' in catalog) ||
      catalog.id !== binding.serverId
    )
      return mismatch('mcp_binding', 'serverId');
    if (connections.some((entry) => entry.serverId === binding.serverId))
      return mismatch('mcp_binding', 'duplicateServerId');
    connections.push(binding);
  }
  return { ok: true, value: connections };
}

export function acceptSessionBinding(
  raw: unknown,
  expected: Pick<RunConfig, 'runtimeEpoch' | 'harness'>
): Accepted<HarnessSessionBinding> {
  const parsed = HarnessSessionBindingSchema.safeParse(raw);
  if (!parsed.success) return mismatch('binding_identity', 'schema');
  if (parsed.data.runtimeEpoch !== expected.runtimeEpoch)
    return mismatch('binding_identity', 'runtimeEpoch');
  if (JSON.stringify(parsed.data.harness) !== JSON.stringify(expected.harness))
    return mismatch('binding_identity', 'harness');
  return { ok: true, value: parsed.data };
}

export function buildRunSnapshot(input: {
  config: RunConfig;
  turnId: string;
  binding: HarnessSessionBinding;
  mcpConnections: McpCredentialBinding[];
  imageConnection?: ProtectedImageConnection | null;
}): HarnessRunSnapshot {
  const { config, turnId, binding, mcpConnections, imageConnection } = input;
  return HarnessRunSnapshotSchema.parse({
    schemaVersion: 1,
    runId: sha256Hex(new TextEncoder().encode(JSON.stringify([config.productSessionId, turnId]))),
    runtimeEpoch: config.runtimeEpoch,
    sessionId: config.productSessionId,
    turnId,
    connection: config.connection,
    imageConnection: imageConnection ?? undefined,
    ...(mcpConnections.length ? { mcpConnections } : {}),
    selection: config.selection,
    harness: config.harness,
    toolsetHash: binding.toolsetHash,
    pluginSetHash: binding.pluginSetHash,
    permissionProfileId: config.permissionProfileId,
  });
}

export function acceptRunSnapshot(
  raw: unknown,
  expected: {
    config: RunConfig;
    binding: HarnessSessionBinding;
    mcpConnections: McpCredentialBinding[];
  }
): Accepted<HarnessRunSnapshot> {
  const parsed = HarnessRunSnapshotSchema.safeParse(raw);
  if (!parsed.success) return mismatch('snapshot', 'schema');
  const snapshot = parsed.data;
  const { config, binding, mcpConnections } = expected;
  const fields = {
    runtimeEpoch: config.runtimeEpoch,
    sessionId: config.productSessionId,
    harness: config.harness,
    connection: config.connection,
    selection: config.selection,
    permissionProfileId: config.permissionProfileId,
    permissionMode: undefined,
    toolsetHash: binding.toolsetHash,
    pluginSetHash: binding.pluginSetHash,
    mcpConnections,
  };
  for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
    const actual = field === 'mcpConnections' ? (snapshot.mcpConnections ?? []) : snapshot[field];
    if (JSON.stringify(actual) !== JSON.stringify(fields[field]))
      return mismatch('snapshot', field);
  }
  return { ok: true, value: snapshot };
}

const RunIdentitySchema = z.object({ runId: z.string(), runtimeEpoch: z.string().uuid() });
type RunIdentity = z.infer<typeof RunIdentitySchema>;
const ResponseMetaSchema = z.object({
  mollyRunId: z.string(),
  mollyRuntimeEpoch: z.string().uuid(),
  mollyNativeOutcome: HarnessRunOutcomeSchema,
  mollyPersonalMemory: z.string().optional().catch(undefined),
  mollyPersonalMemoryDiagnostic: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .optional()
    .catch(undefined),
});
type RunResponse = { outcome: HarnessRunOutcome; memory?: string; memoryDiagnostic?: string };

export function runRequestMeta(snapshot: HarnessRunSnapshot) {
  return { mollyRunSnapshot: snapshot };
}

export function readRunIdentity(meta: unknown): Accepted<RunIdentity> {
  const envelope = z.object({ mollyRunSnapshot: RunIdentitySchema }).safeParse(meta);
  return envelope.success
    ? { ok: true, value: envelope.data.mollyRunSnapshot }
    : mismatch('snapshot', 'identity');
}

export function runResponseMeta(input: RunResponse & { snapshot: HarnessRunSnapshot }) {
  return {
    ...(input.memory ? { mollyPersonalMemory: input.memory } : {}),
    ...(input.memoryDiagnostic ? { mollyPersonalMemoryDiagnostic: input.memoryDiagnostic } : {}),
    mollyRunId: input.snapshot.runId,
    mollyRuntimeEpoch: input.snapshot.runtimeEpoch,
    mollyNativeOutcome: input.outcome,
  };
}

export function readRunResponseMeta(meta: unknown): Accepted<RunResponse & RunIdentity> {
  const parsed = ResponseMetaSchema.safeParse(meta);
  if (!parsed.success) return mismatch('outcome', 'schema');
  const value = parsed.data;
  return {
    ok: true,
    value: {
      runId: value.mollyRunId,
      runtimeEpoch: value.mollyRuntimeEpoch,
      outcome: value.mollyNativeOutcome,
      ...(value.mollyPersonalMemory !== undefined ? { memory: value.mollyPersonalMemory } : {}),
      ...(value.mollyPersonalMemoryDiagnostic !== undefined
        ? { memoryDiagnostic: value.mollyPersonalMemoryDiagnostic }
        : {}),
    },
  };
}

export function acceptRunResponse(
  response: PromptResponse,
  snapshot: RunIdentity
): Accepted<RunResponse> {
  const parsed = readRunResponseMeta(response._meta);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (value.runId !== snapshot.runId) return mismatch('outcome', 'runId');
  if (value.runtimeEpoch !== snapshot.runtimeEpoch) return mismatch('outcome', 'runtimeEpoch');
  if (
    response.stopReason === 'end_turn'
      ? value.outcome.status !== 'completed'
      : response.stopReason !== 'cancelled' || value.outcome.status !== 'cancelled'
  )
    return mismatch('outcome', 'stopReason');
  const { outcome, memory, memoryDiagnostic } = value;
  return {
    ok: true,
    value: {
      outcome,
      ...(memory !== undefined ? { memory } : {}),
      ...(memoryDiagnostic !== undefined ? { memoryDiagnostic } : {}),
    },
  };
}

export const MODEL_ERROR_CATEGORIES = [
  'context_overflow',
  'auth',
  'quota',
  'content_policy',
  'invalid_request',
  'not_found',
  'unreachable',
  'transient',
  'unknown',
] as const;
export type ModelErrorCategory = (typeof MODEL_ERROR_CATEGORIES)[number];

const FAILURE_CODE_BY_CATEGORY = {
  context_overflow: 'model_context_overflow',
  auth: 'model_auth_rejected',
  quota: 'model_quota_exceeded',
  content_policy: 'model_content_blocked',
  invalid_request: 'model_request_rejected',
  not_found: 'model_endpoint_not_found',
  unreachable: 'model_server_unreachable',
  transient: 'model_temporarily_unavailable',
  unknown: 'model_request_failed',
} as const satisfies Record<ModelErrorCategory, import('./ai').ModelRequestFailureCode>;

export function failureCodeForCategory(category: unknown): import('./ai').ModelRequestFailureCode {
  return typeof category === 'string' && Object.hasOwn(FAILURE_CODE_BY_CATEGORY, category)
    ? FAILURE_CODE_BY_CATEGORY[category as ModelErrorCategory]
    : 'model_request_failed';
}
