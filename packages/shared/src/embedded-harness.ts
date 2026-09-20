import { z } from 'zod';
export { McpImageBindingSchema, type McpImageBinding } from '#mcp-image-binding';
export * from '#harness-image-import';
// The workspace-relative attachment root is a harness boundary contract too:
// the daemon materializes resource_link files there and the adapter validates
// containment against the same value (issue #49: a stale copy broke prompts).
export { SESSION_ATTACHMENTS_DIR_RELATIVE } from '#session-paths';

export const MOLLY_HARNESS_ID = 'molly' as const;
export const MOLLY_HARNESS_PROTOCOL_VERSION = 1 as const;
export const PI_ENGINE_VERSION = '0.85.1' as const;
export const MOLLY_BUILTIN_MCP_CONNECTION = { id: 'molly:builtin', revision: 1 } as const;

/** Execution eligibility only: historical configs remain readable. */
export function getEmbeddedHarnessTargetError(input: {
  cliType: string;
  agentType: string;
  customAcp?: unknown;
  runtimeOverrides?: unknown;
  extraArgs?: readonly string[];
}): 'legacy_harness_execution_disabled' | 'harness_launch_override_forbidden' | undefined {
  if (input.cliType !== 'builtin' || input.agentType !== MOLLY_HARNESS_ID)
    return 'legacy_harness_execution_disabled';
  if (
    input.customAcp !== undefined ||
    input.runtimeOverrides !== undefined ||
    (input.extraArgs?.length ?? 0) > 0
  )
    return 'harness_launch_override_forbidden';
  return undefined;
}

const identifier = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9._:-]+$/);
const revision = z.number().int().positive();

/** Private dismissal handshake for a form carried by ACP's existing elicitation API. */
export const HARNESS_QUESTION_DISMISS_METHOD = '_molly/dismiss_question';
export const HarnessQuestionIdentitySchema = z
  .object({
    version: z.literal(1),
    questionId: z.string().uuid(),
    runId: identifier,
    runtimeEpoch: z.string().uuid(),
  })
  .strict();
export const HarnessQuestionDismissRequestSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    request: HarnessQuestionIdentitySchema,
  })
  .strict();

/** A secret-bearing endpoint must have one unambiguous, explicitly selected origin. */
export const ModelEndpointSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      if (url.username || url.password || url.search || url.hash) return false;
      return (
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      );
    } catch {
      return false;
    }
  }, 'Use HTTPS, or explicitly configured loopback HTTP, without credentials, query or fragment');

/** Public destination; credential values never form part of a catalog or run snapshot. */
export const McpCredentialDestinationSchema = z.discriminatedUnion('transport', [
  z.object({ transport: z.literal('http'), url: ModelEndpointSchema }).strict(),
  z
    .object({
      transport: z.literal('stdio'),
      command: z
        .string()
        .min(1)
        .max(4096)
        .refine((value) => !value.includes('\0') && !/[\r\n]/.test(value)),
      args: z
        .array(
          z
            .string()
            .max(4096)
            .refine((value) => !value.includes('\0'))
        )
        .max(64),
    })
    .strict(),
]);
export type McpCredentialDestination = z.infer<typeof McpCredentialDestinationSchema>;

const mcpCredentialFieldName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/);
const reservedMcpHeaders = new Set([
  'host',
  'connection',
  'content-length',
  'content-type',
  'accept',
  'accept-encoding',
  'transfer-encoding',
  'upgrade',
  'trailer',
  'te',
  'expect',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
]);
const reservedMcpEnvironment = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SHELL',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'TMPDIR',
  'TMP',
  'TEMP',
  'ENV',
  'BASH_ENV',
  'BASHOPTS',
  'SHELLOPTS',
  'CDPATH',
  'GLOBIGNORE',
  'IFS',
  'DO_NOT_TRACK',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
]);

/** Secret fields cannot rewrite transport framing or the isolated child environment. */
export function areMcpCredentialFieldsAllowed(
  destination: McpCredentialDestination,
  names: string[]
): boolean {
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) return false;
  return names.every((name) => {
    if (destination.transport === 'http') return !reservedMcpHeaders.has(name.toLowerCase());
    const upper = name.toUpperCase();
    return (
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
      !reservedMcpEnvironment.has(upper) &&
      !/^(PI_|MOLLY_|LODY_|NODE_|ELECTRON_|LD_|DYLD_|XDG_|BASH_FUNC_)/.test(upper)
    );
  });
}

export const McpCredentialValuesSchema = z
  .record(
    mcpCredentialFieldName,
    z
      .string()
      .min(1)
      .max(16_384)
      .refine((value) => !value.includes('\0') && !/[\r\n]/.test(value))
  )
  .refine((values) => Object.keys(values).length > 0 && Object.keys(values).length <= 32)
  .refine((values) => new TextEncoder().encode(JSON.stringify(values)).byteLength <= 65_536);

const mcpCredentialOwner = { workspaceId: identifier, serverId: identifier };
export const McpCredentialBindingSchema = z
  .object({
    ...mcpCredentialOwner,
    credentialRef: z.string().uuid(),
    revision,
    destination: McpCredentialDestinationSchema,
    fieldNames: z.array(mcpCredentialFieldName).min(1).max(32),
  })
  .strict()
  .refine((value) => areMcpCredentialFieldsAllowed(value.destination, value.fieldNames));
export type McpCredentialBinding = z.infer<typeof McpCredentialBindingSchema>;

export function mcpCredentialMatchesServer(
  binding: McpCredentialBinding,
  server: { type?: string; url?: string; command?: string; args?: string[] }
): boolean {
  const target = binding.destination;
  return target.transport === 'http'
    ? server.type === 'http' && server.url === target.url
    : server.type === undefined &&
        server.command === target.command &&
        JSON.stringify(server.args ?? []) === JSON.stringify(target.args);
}

export const SaveMcpCredentialSettingsSchema = z
  .object({
    serverId: identifier,
    destination: McpCredentialDestinationSchema,
    expectedRevision: revision.optional(),
    values: McpCredentialValuesSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.values || areMcpCredentialFieldsAllowed(value.destination, Object.keys(value.values))
  );
export const SaveMcpCredentialSchema = SaveMcpCredentialSettingsSchema.safeExtend({
  workspaceId: identifier,
});
export type SaveMcpCredential = z.infer<typeof SaveMcpCredentialSchema>;
export const DeleteMcpCredentialSchema = z
  .object({ ...mcpCredentialOwner, expectedRevision: revision })
  .strict();

/** Main-only encrypted payload. Never expose this schema as renderer acquisition IPC. */
export const StoredMcpCredentialSchema = z
  .object({ connection: McpCredentialBindingSchema, values: McpCredentialValuesSchema })
  .strict()
  .refine(
    (value) =>
      JSON.stringify([...value.connection.fieldNames].sort()) ===
      JSON.stringify(Object.keys(value.values).sort())
  );

export const ProviderPresetIdSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'moonshot',
  'kimi-coding',
  'zai',
  'minimax',
  'openrouter',
  'openai-compatible',
]);
export type ProviderPresetId = z.infer<typeof ProviderPresetIdSchema>;

export const ModelThinkingLevelSchema = z.enum([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

/** User-declared OpenAI Chat Completions metadata, not remote capability verification. */
export const CompatibleModelDefinitionSchema = z
  .object({
    modelId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(300),
    input: z
      .array(z.enum(['text', 'image']))
      .min(1)
      .max(2)
      .refine((values) => values.includes('text') && new Set(values).size === values.length),
    contextWindow: z.number().int().positive().max(16_777_216),
    maxTokens: z.number().int().positive().max(16_777_216),
    thinking: z
      .array(ModelThinkingLevelSchema)
      .min(1)
      .max(7)
      .refine((values) => new Set(values).size === values.length),
    toolCalls: z.boolean(),
    usageInStreaming: z.boolean(),
    maxTokensField: z.enum(['max_tokens', 'max_completion_tokens']),
  })
  .strict()
  .refine((value) => value.maxTokens <= value.contextWindow);
export type CompatibleModelDefinition = z.infer<typeof CompatibleModelDefinitionSchema>;

const CompatibleModelsSchema = z
  .array(CompatibleModelDefinitionSchema)
  .min(1)
  .max(32)
  .refine((models) => new Set(models.map((model) => model.modelId)).size === models.length);

/** Public SDK provider identity, shared by packaged catalog and worker construction. */
export const MOLLY_PROVIDER_IDS: Record<ProviderPresetId, string> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  xai: 'xai',
  deepseek: 'deepseek',
  moonshot: 'moonshotai',
  'kimi-coding': 'kimi-coding',
  zai: 'zai',
  minimax: 'minimax',
  openrouter: 'openrouter',
  'openai-compatible': 'molly-compatible',
};

export const HarnessModelCatalogSchema = z
  .object({
    version: z.literal(1),
    engineVersion: z.literal(PI_ENGINE_VERSION),
    models: z
      .array(
        z
          .object({
            providerPresetId: ProviderPresetIdSchema,
            modelId: z.string().min(1).max(200),
            name: z.string().min(1).max(300),
            input: z.array(z.enum(['text', 'image'])),
            contextWindow: z.number().int().positive(),
            thinking: z.array(ModelThinkingLevelSchema).min(1),
          })
          .strict()
      )
      .max(10_000),
  })
  .strict();
export type HarnessModelCatalog = z.infer<typeof HarnessModelCatalogSchema>;

/** Diagnose known protocol mismatches without rewriting a saved connection or inferring credentials. */
export function getModelConnectionConfigurationIssue(input: {
  providerPresetId: string;
  baseUrl: string;
}): 'kimi_code_requires_own_provider' | 'kimi_code_requires_anthropic_base' | undefined {
  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    return undefined;
  }
  if (url.hostname !== 'api.kimi.com') return undefined;
  const path = url.pathname.replace(/\/+$/, '');
  if (
    input.providerPresetId === 'moonshot' &&
    (path === '/coding' || path.startsWith('/coding/'))
  ) {
    return 'kimi_code_requires_own_provider';
  }
  if (input.providerPresetId === 'kimi-coding' && path !== '/coding') {
    return 'kimi_code_requires_anthropic_base';
  }
  return undefined;
}

const ModelConnectionFieldsSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: identifier,
    revision,
    providerPresetId: ProviderPresetIdSchema,
    displayName: z.string().trim().min(1).max(120),
    baseUrl: ModelEndpointSchema,
    credentialRef: identifier,
    enabled: z.boolean(),
    customModels: CompatibleModelsSchema.optional(),
  })
  .strict();
export const ModelConnectionSchema = ModelConnectionFieldsSchema.refine(
  (value) => value.customModels === undefined || value.providerPresetId === 'openai-compatible',
  'Custom models require an OpenAI-compatible connection'
);
export type ModelConnection = z.infer<typeof ModelConnectionSchema>;

/** The renderer can replace a secret, but cannot select or read a credential reference. */
export const SaveModelConnectionSchema = ModelConnectionFieldsSchema.omit({
  schemaVersion: true,
  id: true,
  revision: true,
  credentialRef: true,
})
  .extend({
    id: z.string().uuid().optional(),
    expectedRevision: z.number().int().positive().optional(),
    apiKey: z.string().trim().min(1).max(16_384).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.providerPresetId === 'openai-compatible'
        ? !value.enabled || value.customModels !== undefined
        : value.customModels === undefined,
    'Enabled compatible connections require explicit custom models; native presets do not accept them'
  )
  .refine(
    (value) => !value.enabled || getModelConnectionConfigurationIssue(value) === undefined,
    'Provider protocol does not match the Kimi Code endpoint'
  );
export type SaveModelConnection = z.infer<typeof SaveModelConnectionSchema>;

/** Public image metadata only. The credential and legacy backup stay in the main vault. */
export const ProtectedImageConnectionSchema = z
  .object({
    id: z.string().uuid(),
    revision,
    enabled: z.boolean(),
    baseUrl: ModelEndpointSchema,
    model: z.string().trim().min(1).max(200),
    hasApiKey: z.boolean(),
    legacyHistoryMayContainKey: z.boolean(),
  })
  .strict();
export type ProtectedImageConnection = z.infer<typeof ProtectedImageConnectionSchema>;
export const SaveProtectedImageConnectionSchema = ProtectedImageConnectionSchema.omit({
  id: true,
  revision: true,
  hasApiKey: true,
  legacyHistoryMayContainKey: true,
})
  .extend({
    expectedRevision: revision.optional(),
    apiKey: z.string().trim().min(1).max(16_384).optional(),
    clearApiKey: z.boolean().default(false),
  })
  .strict()
  .refine((value) => !(value.clearApiKey && value.apiKey), 'Choose replacement or removal');
export type SaveProtectedImageConnection = z.infer<typeof SaveProtectedImageConnectionSchema>;
/** Private migration payload; never returned by renderer IPC. */
export const LegacyImageCredentialSchema = z
  .object({
    v: z.literal(1),
    enabled: z.boolean(),
    baseUrl: z.string().max(2048),
    model: z.string().max(200),
    apiKey: z.string().max(16_384),
    updatedAt: z.number(),
  })
  .strict();
export type LegacyImageCredential = z.infer<typeof LegacyImageCredentialSchema>;
export const DeleteModelConnectionSchema = z
  .object({
    id: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
  })
  .strict();

export const ModelSelectionSchema = z
  .object({
    connectionId: identifier,
    modelId: z.string().trim().min(1).max(200),
    thinking: ModelThinkingLevelSchema.default('off'),
  })
  .strict();
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;

export const MOLLY_UNSELECTED_MODEL = 'molly-model:unselected';

/** Lossless public projection for existing ACP model pickers; never a provider request ID. */
export function encodeMollyModelOption(connectionId: string, modelId: string): string {
  return `molly-model:${encodeURIComponent(connectionId)}/${encodeURIComponent(modelId)}`;
}

export function decodeMollyModelOption(
  value: unknown,
  thinking: unknown = 'off'
): ModelSelection | undefined {
  if (typeof value !== 'string' || !value.startsWith('molly-model:')) return undefined;
  const parts = value.slice('molly-model:'.length).split('/');
  if (parts.length !== 2) return undefined;
  try {
    const parsed = ModelSelectionSchema.safeParse({
      connectionId: decodeURIComponent(parts[0]!),
      modelId: decodeURIComponent(parts[1]!),
      thinking,
    });
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** ACP fields are UI projections only. Reject ambiguous or unsupported executable controls. */
export function validateMollyRunConfigProjection(input: {
  modelSelection?: ModelSelection;
  modelId?: string | null;
  modeId?: string | null;
  configOptionValues?: Record<string, unknown> | null;
}): ModelSelection {
  const options = input.configOptionValues ?? {};
  const selected = ModelSelectionSchema.parse(
    input.modelSelection ??
      decodeMollyModelOption(input.modelId ?? options.model, options.reasoning_effort ?? 'off')
  );
  if (
    input.modeId ||
    Object.keys(options).some((key) => !['model', 'reasoning_effort'].includes(key))
  )
    throw new Error('harness_legacy_config_unsupported');
  for (const option of [input.modelId, options.model]) {
    if (option == null) continue;
    const projected = decodeMollyModelOption(option, options.reasoning_effort ?? selected.thinking);
    if (!projected || JSON.stringify(projected) !== JSON.stringify(selected))
      throw new Error('harness_model_selection_conflict');
  }
  if (options.reasoning_effort !== undefined && options.reasoning_effort !== selected.thinking)
    throw new Error('harness_model_selection_conflict');
  return selected;
}

export const HarnessIdentitySchema = z
  .object({
    id: z.literal(MOLLY_HARNESS_ID),
    engine: z.literal('pi'),
    engineVersion: z.literal(PI_ENGINE_VERSION),
    buildId: identifier,
    protocolVersion: z.literal(MOLLY_HARNESS_PROTOCOL_VERSION),
  })
  .strict();

/** Worker announcement is public; credentials never travel in ACP metadata. */
export const HarnessSessionBindingSchema = z
  .object({
    version: z.literal(1),
    runtimeEpoch: z.string().uuid(),
    harness: HarnessIdentitySchema,
    toolsetHash: z.string().regex(/^[a-f0-9]{64}$/),
    pluginSetHash: z.string().regex(/^[a-f0-9]{64}$/),
    nativeSessionFile: z.string().min(1).max(4096),
  })
  .strict();
export type HarnessSessionBinding = z.infer<typeof HarnessSessionBindingSchema>;

/** Run-owned discovery precedes the final schema/toolset hash; it grants no inference. */
export const HarnessMcpPreparationSchema = z
  .object({
    version: z.literal(1),
    runId: identifier,
    runtimeEpoch: identifier,
    sessionId: identifier,
    turnId: identifier,
    workspaceId: identifier,
    connection: ModelConnectionSchema,
    mcpConnections: z.array(McpCredentialBindingSchema).min(1).max(32),
  })
  .strict()
  .refine(
    (value) =>
      value.mcpConnections.every((binding) => binding.workspaceId === value.workspaceId) &&
      new Set(value.mcpConnections.map((binding) => binding.serverId)).size ===
        value.mcpConnections.length
  );
export type HarnessMcpPreparation = z.infer<typeof HarnessMcpPreparationSchema>;
export const MOLLY_PREPARE_MCP_METHOD = '_molly/prepare_mcp_run';

export const HarnessRunSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: identifier,
    runtimeEpoch: identifier,
    sessionId: identifier,
    turnId: identifier,
    connection: ModelConnectionSchema,
    imageConnection: ProtectedImageConnectionSchema.optional(),
    mcpConnections: z.array(McpCredentialBindingSchema).max(32).optional(),
    selection: ModelSelectionSchema,
    harness: HarnessIdentitySchema,
    pluginSetHash: z.string().regex(/^[a-f0-9]{64}$/),
    toolsetHash: z.string().regex(/^[a-f0-9]{64}$/),
    permissionProfileId: identifier,
    artworkRevisionAtDispatch: identifier.optional(),
  })
  .strict()
  .refine(
    (value) => value.connection.id === value.selection.connectionId,
    'Selection must name the frozen connection'
  );
export type HarnessRunSnapshot = z.infer<typeof HarnessRunSnapshotSchema>;

export const HarnessRunOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('completed'), nativeEndEntryId: identifier }).strict(),
  z.object({ status: z.literal('failed'), errorCode: identifier }).strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('interrupted'), reason: identifier }).strict(),
]);
export type HarnessRunOutcome = z.infer<typeof HarnessRunOutcomeSchema>;

export const HarnessCredentialRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    snapshot: HarnessRunSnapshotSchema,
    imageConnection: ProtectedImageConnectionSchema.optional(),
  })
  .strict();
export type HarnessCredentialRequest = z.infer<typeof HarnessCredentialRequestSchema>;
export const HarnessCredentialReportSchema = z
  .object({
    requestId: z.string().uuid(),
    runId: identifier,
    runtimeEpoch: identifier,
    connectionId: identifier,
    connectionRevision: revision,
    imageConnectionId: z.string().uuid().optional(),
    imageConnectionRevision: revision.optional(),
    result: z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), apiKey: z.string().min(1).max(16_384) }).strict(),
      z.object({ ok: z.literal(false), error: z.literal('credential_unavailable') }).strict(),
    ]),
  })
  .strict();
export type HarnessCredentialReport = z.infer<typeof HarnessCredentialReportSchema>;

export const HarnessMcpCredentialRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    preparation: HarnessMcpPreparationSchema,
    connection: McpCredentialBindingSchema,
  })
  .strict()
  .refine((value) =>
    value.preparation.mcpConnections.some(
      (binding) => JSON.stringify(binding) === JSON.stringify(value.connection)
    )
  );
export type HarnessMcpCredentialRequest = z.infer<typeof HarnessMcpCredentialRequestSchema>;
export const HarnessMcpCredentialReportSchema = z
  .object({
    requestId: z.string().uuid(),
    runId: identifier,
    runtimeEpoch: identifier,
    credentialRef: z.string().uuid(),
    credentialRevision: revision,
    result: z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), values: McpCredentialValuesSchema }).strict(),
      z.object({ ok: z.literal(false), error: z.literal('credential_unavailable') }).strict(),
    ]),
  })
  .strict();
export type HarnessMcpCredentialReport = z.infer<typeof HarnessMcpCredentialReportSchema>;
export const HarnessHostExchangeSchema = z
  .object({
    version: z.literal(1),
    connections: z.array(ModelConnectionSchema).max(256),
    reports: z.array(HarnessCredentialReportSchema).max(8),
    mcpConnections: z.array(McpCredentialBindingSchema).max(256).optional(),
    mcpReports: z.array(HarnessMcpCredentialReportSchema).max(8).optional(),
    imageConnection: ProtectedImageConnectionSchema.nullable().optional(),
    legacyImageAcknowledgement: z.string().uuid().optional(),
  })
  .strict();
export const HarnessHostResultSchema = z
  .object({
    type: z.literal('harness/host'),
    version: z.literal(1),
    requests: z.array(HarnessCredentialRequestSchema).max(8),
    mcpRequests: z.array(HarnessMcpCredentialRequestSchema).max(8).optional(),
    legacyImageMigration: z
      .object({ requestId: z.string().uuid(), connection: LegacyImageCredentialSchema })
      .strict()
      .optional(),
  })
  .strict();

const mcpBase = {
  schemaVersion: z.literal(1),
  id: identifier,
  revision,
  enabled: z.boolean(),
  credentialRefs: z.record(identifier, identifier),
};
export const ManagedMcpConnectionSchema = z.discriminatedUnion('transport', [
  z
    .object({
      ...mcpBase,
      transport: z.literal('stdio'),
      command: z.string().min(1).max(4096),
      args: z.array(z.string().max(4096)).max(64),
    })
    .strict(),
  z
    .object({ ...mcpBase, transport: z.literal('streamable-http'), endpoint: ModelEndpointSchema })
    .strict(),
]);

export const PaidOperationSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: identifier,
    runId: identifier,
    connectionId: identifier,
    connectionRevision: revision,
    toolName: z.string().min(1).max(128),
    state: z.enum(['prepared', 'dispatched', 'succeeded', 'failed', 'outcome_unknown']),
    providerRequestId: z.string().min(1).max(512).optional(),
    assetDigests: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(32),
  })
  .strict();
export type PaidOperation = z.infer<typeof PaidOperationSchema>;

/** Private built-in image receipt, not authority supplied by an arbitrary MCP server. */
export const ImageOperationResultSchema = z
  .object({
    version: z.literal(1),
    state: z.enum(['succeeded', 'failed', 'outcome_unknown']),
    dispatched: z.boolean(),
    assetDigests: PaidOperationSchema.shape.assetDigests,
  })
  .strict();

/** A disconnected dispatch is never evidence that the provider did not receive it. */
export function canDispatchPaidOperation(operation: PaidOperation): boolean {
  return operation.state === 'prepared';
}

export function recoverPaidOperation(operation: PaidOperation): PaidOperation {
  return operation.state === 'dispatched' ? { ...operation, state: 'outcome_unknown' } : operation;
}
