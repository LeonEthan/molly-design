import { z } from 'zod';
import type { McpConnectionSpec } from './workspace-mcp';
import { ImageConnectionProtocolSchema } from '#image-connection';
// The workspace-relative attachment root is a harness boundary contract too:
// the daemon materializes resource_link files there and the adapter validates
// containment against the same value (issue #49: a stale copy broke prompts).
export { SESSION_ATTACHMENTS_DIR_RELATIVE } from '#session-paths';

export const MOLLY_HARNESS_ID = 'molly' as const;
export const MOLLY_HARNESS_PROTOCOL_VERSION = 1 as const;
export const PI_ENGINE_VERSION = '1.0.4' as const;
/** Unmodified published Pi packages every worker profile lists; settings reports the same set. */
export const MOLLY_PI_PACKAGES = [
  'pi-skillful',
  '@juicesharp/rpiv-ask-user-question',
  '@zigai/pi-mention-skill',
  '@ff-labs/pi-fff',
  'cc-safety-net',
] as const;
export type MollyPiPackage = (typeof MOLLY_PI_PACKAGES)[number];
export const MOLLY_BUILTIN_MCP_CONNECTION = { id: 'molly:builtin', revision: 1 } as const;
/** Pi 1.0 `McpExposure`: how a server's tools reach the model. Absent means Pi's default, `codemode`. */
export const MCP_EXPOSURES = ['codemode', 'deferred', 'direct', 'hidden'] as const;
export type McpExposure = (typeof MCP_EXPOSURES)[number];
export const MAX_MCP_TOOL_EXPOSURE_RULES = 64;
const MAX_MCP_TOOL_PATTERN_LENGTH = 128;
const RESERVED_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export const isMcpExposure = (value: unknown): value is McpExposure =>
  typeof value === 'string' && (MCP_EXPOSURES as readonly string[]).includes(value);

/**
 * One Pi `toolExposure` entry. Pi applies exact names first, then the first matching `*` pattern, so
 * rules persist as an ordered list: Flock does not preserve object key order.
 */
export type McpToolExposureRule = { pattern: string; exposure: McpExposure };

export const isMcpToolExposureRules = (value: unknown): value is McpToolExposureRule[] => {
  if (!Array.isArray(value) || value.length > MAX_MCP_TOOL_EXPOSURE_RULES) return false;
  const patterns = new Set<string>();
  return value.every((rule: unknown) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
    const { pattern, exposure, ...rest } = rule as Record<string, unknown>;
    if (
      Object.keys(rest).length > 0 ||
      typeof pattern !== 'string' ||
      pattern.length === 0 ||
      pattern.length > MAX_MCP_TOOL_PATTERN_LENGTH ||
      pattern.trim() !== pattern ||
      RESERVED_RECORD_KEYS.has(pattern) ||
      patterns.has(pattern) ||
      !isMcpExposure(exposure)
    )
      return false;
    patterns.add(pattern);
    return true;
  });
};

/** Pi's `toolExposure` object, built in rule order immediately before registration. */
export const toPiToolExposure = (
  rules: readonly McpToolExposureRule[]
): Record<string, McpExposure> =>
  Object.fromEntries(rules.map(({ pattern, exposure }) => [pattern, exposure]));

/** Pi lists this one line for the built-in server in its `mcp_servers` prompt section. */
export const MOLLY_BUILTIN_MCP_DESCRIPTION =
  'Molly design tools: render artwork previews, resubmit drafts, upload files, and manage Molly sessions and tasks';
/** The render → read loop passes pixels the model must see, so the preview tool is declared directly. */
export const MOLLY_BUILTIN_MCP_TOOL_EXPOSURE: readonly McpToolExposureRule[] = [
  { pattern: 'molly_render_preview', exposure: 'direct' },
];
export const MOLLY_BUILTIN_IMAGE_MCP_DESCRIPTION =
  'Generate or edit raster assets with the user’s image connection (each call may be billed)';
export const MOLLY_BUILTIN_BROWSER_MCP_DESCRIPTION =
  'Drive the user’s visible Molly browser page: open, read, look at, click, type, scroll and save images';

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

/** The public destination a protected credential is bound to. */
export const mcpConnectionDestination = (
  connection: McpConnectionSpec
): McpCredentialDestination =>
  connection.transport === 'http'
    ? { transport: 'http', url: connection.url }
    : { transport: 'stdio', command: connection.command, args: connection.args ?? [] };

export const sameMcpDestination = (
  left: McpCredentialDestination,
  right: McpCredentialDestination
): boolean => {
  if (left.transport === 'http') return right.transport === 'http' && left.url === right.url;
  if (right.transport === 'http') return false;
  return (
    left.command === right.command &&
    left.args.length === right.args.length &&
    left.args.every((arg, index) => arg === right.args[index])
  );
};

/** Legacy rows may hold values outside protected storage (`${VAR}`, passthrough, plaintext). */
export const hasUnprotectedMcpValues = (connection: McpConnectionSpec): boolean =>
  connection.transport === 'stdio'
    ? Object.keys(connection.env ?? {}).length > 0 || (connection.envPassthrough?.length ?? 0) > 0
    : Object.keys(connection.headers ?? {}).length > 0 || connection.bearerToken !== undefined;

/** Settings-only tool listing: one saved server, initialize and `tools/list` only (A5). */
export const MCP_TOOL_DISCOVERY_LIMITS = {
  tools: 256,
  pages: 16,
  name: 128,
  title: 200,
  description: 1_000,
} as const;

export const ListMcpToolsSchema = z
  .object({
    serverId: identifier,
    destination: McpCredentialDestinationSchema,
    protectedCredentials: z.object({ credentialRef: z.string().uuid(), revision }).strict().optional(),
  })
  .strict();
export type ListMcpTools = z.infer<typeof ListMcpToolsSchema>;

/** What main sends the one-shot CLI helper on stdin; values were checked against their binding. */
export const McpToolDiscoveryRequestSchema = z
  .object({
    destination: McpCredentialDestinationSchema,
    values: McpCredentialValuesSchema.optional(),
  })
  .strict();
export type McpToolDiscoveryRequest = z.infer<typeof McpToolDiscoveryRequestSchema>;

export const McpDiscoveredToolSchema = z
  .object({
    name: z.string().min(1).max(MCP_TOOL_DISCOVERY_LIMITS.name),
    title: z.string().max(MCP_TOOL_DISCOVERY_LIMITS.title).optional(),
    description: z.string().max(MCP_TOOL_DISCOVERY_LIMITS.description).optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .strict();
export type McpDiscoveredTool = z.infer<typeof McpDiscoveredToolSchema>;

export const MCP_TOOL_DISCOVERY_FAILURES = [
  'changed',
  'unsupported',
  'needs_credentials',
  'unreachable',
  'timed_out',
  'invalid_response',
  'limit_exceeded',
  'unavailable',
] as const;
export type McpToolDiscoveryFailure = (typeof MCP_TOOL_DISCOVERY_FAILURES)[number];

export const McpToolDiscoveryResultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      tools: z.array(McpDiscoveredToolSchema).max(MCP_TOOL_DISCOVERY_LIMITS.tools),
      truncated: z.boolean(),
    })
    .strict(),
  z.object({ ok: z.literal(false), reason: z.enum(MCP_TOOL_DISCOVERY_FAILURES) }).strict(),
]);
export type McpToolDiscoveryResult = z.infer<typeof McpToolDiscoveryResultSchema>;

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

/** User-declared OpenAI Chat Completions metadata, enriched by discovery, not remote capability verification. */
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
    maxTokensField: z.enum(['max_tokens', 'max_completion_tokens']),
    usageInStreaming: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.maxTokens <= value.contextWindow);
export type CompatibleModelDefinition = z.infer<typeof CompatibleModelDefinitionSchema>;

/** A model listed by a connection's own `GET /models`, with what the response itself told us. */
export const DiscoveredModelSchema = z
  .object({
    modelId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(300).optional(),
    contextWindow: z.number().int().positive().max(16_777_216).optional(),
    maxTokens: z.number().int().positive().max(16_777_216).optional(),
  })
  .strict();
export type DiscoveredModel = z.infer<typeof DiscoveredModelSchema>;

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

/**
 * The endpoint most of each native preset's pinned SDK models use. Settings prefills
 * it so a designer only picks a provider and pastes a key; it is a suggestion the user
 * can replace, never a fallback for a missing saved endpoint.
 */
export const PROVIDER_PRESET_DEFAULT_BASE_URLS: Record<
  Exclude<ProviderPresetId, 'openai-compatible'>,
  string
> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  xai: 'https://api.x.ai/v1',
  deepseek: 'https://api.deepseek.com',
  moonshot: 'https://api.moonshot.ai/v1',
  'kimi-coding': 'https://api.kimi.com/coding',
  zai: 'https://api.z.ai/api/coding/paas/v4',
  minimax: 'https://api.minimax.io/anthropic',
  openrouter: 'https://openrouter.ai/api/v1',
};

/**
 * A connection on its preset's default endpoint keeps each model's own SDK endpoint;
 * any other endpoint replaces every model's. OpenRouter serves its Anthropic-protocol
 * models at `/api`, not the default `/api/v1`.
 */
export function isProviderPresetDefaultEndpoint(preset: ProviderPresetId, baseUrl: string) {
  return (
    preset !== 'openai-compatible' &&
    baseUrl.trim().replace(/\/+$/, '') === PROVIDER_PRESET_DEFAULT_BASE_URLS[preset]
  );
}

/**
 * How settings checks a key for free, by the protocol each native preset's pinned SDK
 * models use (guarded in harness-pi): list models (`openai`, `anthropic`, `google`) or
 * validate the key without listing (`openrouter`). A check never sends a model request.
 */
export const PROVIDER_PRESET_CHECKS: Record<
  ProviderPresetId,
  'openai' | 'anthropic' | 'google' | 'openrouter'
> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  xai: 'openai',
  deepseek: 'openai',
  moonshot: 'openai',
  'kimi-coding': 'anthropic',
  zai: 'openai',
  minimax: 'anthropic',
  openrouter: 'openrouter',
  'openai-compatible': 'openai',
};

export const ConnectionCheckFailureSchema = z.enum([
  'key_rejected',
  'unsupported',
  'unreachable',
  'rate_limited',
  'http_error',
  'invalid_response',
  'changed',
  'needs_key',
]);
export type ConnectionCheckFailure = z.infer<typeof ConnectionCheckFailureSchema>;
/** `models` lists the IDs the service reported; it is absent when the check only validates the key. */
export type ConnectionCheckResult =
  | { ok: true; models?: string[] }
  | { ok: false; reason: ConnectionCheckFailure; status?: number };

/**
 * Offline model metadata snapshot (models.dev, MIT), projected at build time into the
 * harness resources. Keys are models.dev provider ids; enrichment for a compatible
 * connection matches by modelId. Metadata fills discovery defaults; the user's saved
 * declaration always wins.
 */
export const ModelMetadataSnapshotSchema = z
  .object({
    version: z.literal(1),
    source: z.literal('models.dev'),
    generatedAt: z.string().min(1).max(40),
    providers: z.record(
      z.string().min(1).max(100),
      z.object({
        models: z.record(
          z.string().min(1).max(200),
          z
            .object({
              name: z.string().min(1).max(300).optional(),
              contextWindow: z.number().int().positive().max(16_777_216).optional(),
              maxTokens: z.number().int().positive().max(16_777_216).optional(),
              imageInput: z.boolean().optional(),
              toolCalls: z.boolean().optional(),
              reasoning: z.boolean().optional(),
            })
            .strict()
        ),
      })
    ),
  })
  .strict();
export type ModelMetadataSnapshot = z.infer<typeof ModelMetadataSnapshotSchema>;

/** Settings discovery: list the models a chat-capable connection serves. Explicit user action. */
export const DiscoverModelConnectionSchema = z
  .object({
    providerPresetId: ProviderPresetIdSchema,
    baseUrl: ModelEndpointSchema,
    apiKey: z.string().trim().min(1).max(16_384).optional(),
    stored: z.object({ id: identifier, revision }).strict().optional(),
  })
  .strict();
// Keyless discovery is intentional: local servers (Ollama, LM Studio) serve /models
// without an Authorization header.
export type DiscoverModelConnection = z.infer<typeof DiscoverModelConnectionSchema>;
export type DiscoverModelConnectionResult =
  | { ok: true; models: DiscoveredModel[]; filteredNonChat: number }
  | {
      ok: false;
      reason: 'unreachable' | 'invalid_response' | 'needs_key' | 'changed' | 'unsupported' | 'http_error';
      status?: number;
    };

/** A typed key goes only to the destination being checked; a saved key only to its own. */
export const CheckModelConnectionSchema = z
  .object({
    providerPresetId: ProviderPresetIdSchema,
    baseUrl: ModelEndpointSchema,
    apiKey: z.string().trim().min(1).max(16_384).optional(),
    stored: z.object({ id: identifier, revision }).strict().optional(),
  })
  .strict()
  .refine((value) => value.apiKey !== undefined || value.stored !== undefined);
export type CheckModelConnection = z.infer<typeof CheckModelConnectionSchema>;

export const CheckImageConnectionSchema = z
  .object({
    protocol: ImageConnectionProtocolSchema.optional(),
    baseUrl: ModelEndpointSchema,
    apiKey: z.string().trim().min(1).max(16_384).optional(),
    expectedRevision: revision.optional(),
  })
  .strict()
  .refine((value) => value.apiKey !== undefined || value.expectedRevision !== undefined);
export type CheckImageConnection = z.infer<typeof CheckImageConnectionSchema>;

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

export const ModelConnectionAuthTypeSchema = z.enum(['api_key', 'openai_oauth']);

/**
 * Presets with an official subscription sign-in (pi-ai OAuth). The authType value stays
 * 'openai_oauth' for vault compatibility; this set is the source of truth for which
 * presets may carry it.
 */
export const OAUTH_PROVIDER_PRESETS = ['openai', 'kimi-coding'] as const;
export type OAuthProviderPresetId = (typeof OAUTH_PROVIDER_PRESETS)[number];
export type ModelConnectionAuthType = z.infer<typeof ModelConnectionAuthTypeSchema>;

/** Public OAuth account metadata; tokens stay in the main vault. */
export const ModelConnectionOAuthSchema = z
  .object({
    email: z.string().trim().min(1).max(300).optional(),
    plan: z.string().trim().min(1).max(60).optional(),
    accountId: z.string().trim().min(1).max(200).optional(),
    /** Refresh was rejected; the user must sign in again. */
    denied: z.boolean().optional(),
  })
  .strict();
export type ModelConnectionOAuth = z.infer<typeof ModelConnectionOAuthSchema>;

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
    /** Absent means an API key connection. OAuth exists only for the OpenAI preset. */
    authType: ModelConnectionAuthTypeSchema.optional(),
    oauth: ModelConnectionOAuthSchema.optional(),
    customModels: CompatibleModelsSchema.optional(),
    /** Native catalog models offered in the conversation picker; absent offers all of them. */
    models: z
      .array(z.string().trim().min(1).max(200))
      .min(1)
      .max(1_000)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
  })
  .strict();
export const ModelConnectionSchema = ModelConnectionFieldsSchema.refine(
  (value) => value.customModels === undefined || value.providerPresetId === 'openai-compatible',
  'Custom models require an OpenAI-compatible connection'
)
  .refine(
    (value) => value.models === undefined || value.providerPresetId !== 'openai-compatible',
    'OpenAI-compatible connections offer exactly their declared models'
  )
  .refine(
    (value) =>
      value.authType !== 'openai_oauth' ||
      (OAUTH_PROVIDER_PRESETS as readonly string[]).includes(value.providerPresetId),
    'OAuth sign-in exists only for presets with an official subscription flow'
  )
  .refine(
    (value) => value.oauth === undefined || value.authType === 'openai_oauth',
    'OAuth account metadata requires an OAuth connection'
  );
export type ModelConnection = z.infer<typeof ModelConnectionSchema>;

/** The renderer can replace a secret, but cannot select or read a credential reference.
 *  OAuth account metadata is also main-owned: the form never writes it. */
export const SaveModelConnectionSchema = ModelConnectionFieldsSchema.omit({
  schemaVersion: true,
  id: true,
  revision: true,
  credentialRef: true,
  oauth: true,
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
  )
  .refine(
    (value) => value.models === undefined || value.providerPresetId !== 'openai-compatible',
    'OpenAI-compatible connections offer exactly their declared models'
  )
  .refine(
    (value) =>
      value.authType !== 'openai_oauth' ||
      ((OAUTH_PROVIDER_PRESETS as readonly string[]).includes(value.providerPresetId) &&
        !value.apiKey),
    'OAuth sign-in exists only for presets with an official subscription flow and never carries an API key'
  );
export type SaveModelConnection = z.infer<typeof SaveModelConnectionSchema>;

/**
 * The main-side OAuth session handle. `sessionId` is opaque to the renderer. Browser
 * flows carry `authorizeUrl` to open; device-code flows carry the code to display.
 * Completing the flow saves the connection.
 */
export const OpenAiAuthSessionSchema = z
  .object({
    sessionId: z.string().uuid(),
    authorizeUrl: z.string().url().max(4096).optional(),
    deviceCode: z
      .object({
        userCode: z.string().min(1).max(64),
        verificationUri: z.string().url().max(4096),
      })
      .strict()
      .optional(),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type OpenAiAuthSession = z.infer<typeof OpenAiAuthSessionSchema>;

export type OpenAiAuthCompleteResult =
  | { ok: true; connection: ModelConnection }
  | {
      ok: false;
      reason: 'cancelled' | 'timed_out' | 'denied' | 'unreachable' | 'invalid_response';
    };

/** Public image metadata only. The credential and legacy backup stay in the main vault. */
export const ProtectedImageConnectionSchema = z
  .object({
    id: z.string().uuid(),
    revision,
    enabled: z.boolean(),
    protocol: ImageConnectionProtocolSchema.optional(),
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

export const DeleteImageConnectionSchema = z
  .object({
    expectedRevision: revision,
  })
  .strict();
export type DeleteImageConnection = z.infer<typeof DeleteImageConnectionSchema>;

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

/**
 * Permission modes earlier run snapshots and saved selections may record. New Molly runs record
 * none: the embedded Pi runs tools without permission checks
 * ([Spec](../../../specs/molly-embedded-pi-harness.md)).
 */
export const MOLLY_PERMISSION_MODES = ['ask', 'auto-review'] as const;
export const MollyPermissionModeSchema = z.enum(MOLLY_PERMISSION_MODES);
export type MollyPermissionMode = z.infer<typeof MollyPermissionModeSchema>;

/** Saved mode selections no longer choose anything; unknown values stay unsupported controls. */
function assertRecordedMollyPermissionModes(input: {
  modeId?: string | null;
  configOptionValues?: Record<string, unknown> | null;
}): void {
  for (const value of [input.modeId, input.configOptionValues?.mode]) {
    if (value == null || value === '') continue;
    if (!MollyPermissionModeSchema.safeParse(value).success)
      throw new Error('harness_legacy_config_unsupported');
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
  if (Object.keys(options).some((key) => !['model', 'reasoning_effort', 'mode'].includes(key)))
    throw new Error('harness_legacy_config_unsupported');
  assertRecordedMollyPermissionModes(input);
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

export const HarnessMcpSessionSchema = z
  .object({
    version: z.literal(1),
    runtimeEpoch: identifier,
    sessionId: identifier,
    workspaceId: identifier,
    mcpConnections: z.array(McpCredentialBindingSchema).min(1).max(32),
  })
  .strict()
  .refine(
    (value) =>
      value.mcpConnections.every((binding) => binding.workspaceId === value.workspaceId) &&
      new Set(value.mcpConnections.map((binding) => binding.serverId)).size ===
        value.mcpConnections.length
  );
export type HarnessMcpSession = z.infer<typeof HarnessMcpSessionSchema>;

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
    permissionMode: MollyPermissionModeSchema.optional(),
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
      z
        .object({
          ok: z.literal(true),
          apiKey: z.string().min(1).max(16_384),
          /** OAuth account identity when the provider exposes one. */
          oauthAccountId: z.string().min(1).max(200).optional(),
          /** OAuth grants carry their connection id so a rotation of the same row is accepted. */
          oauthConnectionId: z.string().min(1).max(200).optional(),
        })
        .strict(),
      z.object({ ok: z.literal(false), error: z.literal('credential_unavailable') }).strict(),
    ]),
  })
  .strict();
export type HarnessCredentialReport = z.infer<typeof HarnessCredentialReportSchema>;

export const HarnessMcpCredentialRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    session: HarnessMcpSessionSchema,
    connection: McpCredentialBindingSchema,
  })
  .strict()
  .refine((value) =>
    value.session.mcpConnections.some(
      (binding) => JSON.stringify(binding) === JSON.stringify(value.connection)
    )
  );
export type HarnessMcpCredentialRequest = z.infer<typeof HarnessMcpCredentialRequestSchema>;
export const HarnessMcpCredentialReportSchema = z
  .object({
    requestId: z.string().uuid(),
    sessionId: identifier,
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
