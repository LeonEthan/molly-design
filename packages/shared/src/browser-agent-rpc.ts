import { z } from 'zod';
import { SessionIdSchema } from './message-schemas';
import { BROWSER_AGENT_MACHINE_PROTOCOL_VERSION } from './machine-protocol-capabilities';

export const BROWSER_HOST_POLL_INTERVAL_MS = 500;
export const BROWSER_HOST_TTL_MS = 3_000;
export const BROWSER_HOST_OPERATION_TIMEOUT_MS = 45_000;

export const BROWSER_AGENT_PROTOCOL_VERSION = BROWSER_AGENT_MACHINE_PROTOCOL_VERSION;
export const BrowserHostCapabilitiesSchema = z
  .object({
    version: z.literal(BROWSER_AGENT_PROTOCOL_VERSION),
    driver: z.literal('agent-browser'),
    driverRevision: z.string().min(1).max(100),
  })
  .strict();
export type BrowserHostCapabilities = z.infer<typeof BrowserHostCapabilitiesSchema>;

const BrowserElementRefSchema = z
  .string()
  .max(32)
  .regex(/^@?e\d+$/);
const identity = z.string().uuid();
const reference = { ref: BrowserElementRefSchema, observationId: identity };
const empty = z.object({}).strict();
const boundedJson = z
  .json()
  .refine((value) => JSON.stringify(value).length <= 64_000, 'JSON exceeds 64 KB.');
export const BrowserWebMcpSummarySchema = z
  .object({
    status: z.enum(['ready', 'unavailable']),
    untrusted: z.literal(true),
    toolCount: z.number().int().nonnegative(),
    tools: z
      .array(
        z
          .object({
            name: z.string().max(500),
            description: z.string().max(500),
            origin: z.string().max(2048),
            frameId: z.string().max(200),
          })
          .strict()
      )
      .max(16),
    truncated: z.boolean(),
  })
  .strict()
  .refine((value) => JSON.stringify(value).length <= 4096);
export type BrowserWebMcpSummary = z.infer<typeof BrowserWebMcpSummarySchema>;
export const BrowserWebMcpFields = { webmcp: BrowserWebMcpSummarySchema.optional() };

export const AgentBrowserActionInputSchemas = {
  navigate: z.object({ url: z.string().min(1).max(2048) }).strict(),
  back: empty,
  forward: empty,
  reload: empty,
  snapshot: z
    .object({
      interactive: z.boolean().optional(),
      depth: z.number().int().min(1).max(20).optional(),
      selector: z.string().max(500).optional(),
    })
    .strict(),
  read: empty,
  screenshot: empty,
  click: z.object(reference).strict(),
  type: z.object({ ...reference, text: z.string().max(2000) }).strict(),
  press: z
    .object({
      key: z.enum([
        'Enter',
        'Tab',
        'Shift+Tab',
        'Escape',
        'Backspace',
        'Delete',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ]),
    })
    .strict(),
  select: z.object({ ...reference, value: z.string().max(2000) }).strict(),
  check: z.object({ ...reference, checked: z.boolean() }).strict(),
  scroll: z.object({ deltaY: z.number().int().min(-2000).max(2000) }).strict(),
  wait: z
    .object({
      condition: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('element'), ...reference }).strict(),
        z.object({ kind: z.literal('text'), text: z.string().min(1).max(1000) }).strict(),
        z.object({ kind: z.literal('url'), pattern: z.string().min(1).max(2048) }).strict(),
        z
          .object({
            kind: z.literal('load'),
            state: z.enum(['load', 'domcontentloaded', 'networkidle']),
          })
          .strict(),
      ]),
      timeoutMs: z.number().int().min(1).max(10_000).optional(),
    })
    .strict(),
  frame: z.object({ target: z.union([z.literal('main'), z.object(reference).strict()]) }).strict(),
  dialog: z
    .object({
      action: z.enum(['status', 'accept', 'dismiss']),
      text: z.string().max(2000).optional(),
    })
    .strict(),
  webmcp_list: z
    .object({ toolId: identity.optional(), offset: z.number().int().min(0).max(512).optional() })
    .strict(),
  webmcp_invoke: z.object({ toolId: identity, input: boundedJson }).strict(),
  webmcp_result: z.object({ invocationId: identity }).strict(),
  webmcp_cancel: z.object({ invocationId: identity }).strict(),
  save_image: z.object(reference).strict(),
} as const;
export type AgentBrowserAction = keyof typeof AgentBrowserActionInputSchemas;
const inputs = AgentBrowserActionInputSchemas;
export const AgentBrowserCommandSchema = z.discriminatedUnion('kind', [
  inputs.navigate.extend({ kind: z.literal('navigate') }).strict(),
  inputs.back.extend({ kind: z.literal('back') }).strict(),
  inputs.forward.extend({ kind: z.literal('forward') }).strict(),
  inputs.reload.extend({ kind: z.literal('reload') }).strict(),
  inputs.snapshot.extend({ kind: z.literal('snapshot') }).strict(),
  inputs.read.extend({ kind: z.literal('read') }).strict(),
  inputs.screenshot.extend({ kind: z.literal('screenshot') }).strict(),
  inputs.click.extend({ kind: z.literal('click') }).strict(),
  inputs.type.extend({ kind: z.literal('type') }).strict(),
  inputs.press.extend({ kind: z.literal('press') }).strict(),
  inputs.select.extend({ kind: z.literal('select') }).strict(),
  inputs.check.extend({ kind: z.literal('check') }).strict(),
  inputs.scroll.extend({ kind: z.literal('scroll') }).strict(),
  inputs.wait.extend({ kind: z.literal('wait') }).strict(),
  inputs.frame.extend({ kind: z.literal('frame') }).strict(),
  inputs.dialog.extend({ kind: z.literal('dialog') }).strict(),
  inputs.webmcp_list.extend({ kind: z.literal('webmcp_list') }).strict(),
  inputs.webmcp_invoke.extend({ kind: z.literal('webmcp_invoke') }).strict(),
  inputs.webmcp_result.extend({ kind: z.literal('webmcp_result') }).strict(),
  inputs.webmcp_cancel.extend({ kind: z.literal('webmcp_cancel') }).strict(),
  inputs.save_image.extend({ kind: z.literal('save_image') }).strict(),
]);
export type AgentBrowserCommand = z.infer<typeof AgentBrowserCommandSchema>;

export const AgentBrowserScopeSchema = z
  .object({
    sessionId: SessionIdSchema,
    browserId: z.string().regex(/^session-browser-[a-zA-Z0-9_-]{1,128}$/),
    runId: z.string().min(1).max(200),
  })
  .strict();
export type AgentBrowserScope = z.infer<typeof AgentBrowserScopeSchema>;

const BrowserUrlSchema = z.string().max(2_048);
const BrowserTitleSchema = z.string().max(500);

export const BrowserPageStateSchema = z
  .object({ url: BrowserUrlSchema, title: BrowserTitleSchema, ...BrowserWebMcpFields })
  .strict();

export const BrowserSnapshotSchema = BrowserPageStateSchema.extend({
  snapshot: z.string().max(50_000),
  observationId: identity,
  truncated: z.boolean(),
}).strict();

export const BrowserSavedImageSchema = z
  .object({
    pageUrl: BrowserUrlSchema,
    ...BrowserWebMcpFields,
    imageUrl: BrowserUrlSchema,
    path: z.string().max(4_096),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mimeType: z.string().max(100),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    bytes: z.number().int().positive(),
  })
  .strict();

export const BrowserDataReplySchema = BrowserPageStateSchema.extend({
  kind: z.literal('data'),
  data: boundedJson,
}).strict();

const ObservationReplySchemas = [
  BrowserDataReplySchema,
  BrowserPageStateSchema.extend({ kind: z.literal('page') }).strict(),
  BrowserSnapshotSchema.extend({ kind: z.literal('snapshot') }).strict(),
  z
    .object({
      kind: z.literal('image'),
      mimeType: z.literal('image/jpeg'),
      base64: z.string().max(2_800_000),
      pageUrl: BrowserUrlSchema,
      ...BrowserWebMcpFields,
    })
    .strict(),
] as const;

/** What the daemon returns to the `molly_browser` MCP server. */
export const AgentBrowserReplySchema = z.discriminatedUnion('kind', [
  ...ObservationReplySchemas,
  BrowserSavedImageSchema.extend({ kind: z.literal('saved_image') }).strict(),
]);
export type AgentBrowserReply = z.infer<typeof AgentBrowserReplySchema>;

/** What the desktop reports to the daemon; the daemon publishes `asset` bytes as `saved_image`. */
export const AgentBrowserHostReplySchema = z.discriminatedUnion('kind', [
  ...ObservationReplySchemas,
  z
    .object({
      kind: z.literal('asset'),
      base64: z.string().max(7_000_000),
      pageUrl: BrowserUrlSchema,
      ...BrowserWebMcpFields,
      imageUrl: BrowserUrlSchema,
    })
    .strict(),
]);
export type AgentBrowserHostReply = z.infer<typeof AgentBrowserHostReplySchema>;

export const AgentBrowserHostWorkSchema = z
  .object({
    requestId: z.string().uuid(),
    scope: AgentBrowserScopeSchema,
    command: AgentBrowserCommandSchema,
  })
  .strict();
export type AgentBrowserHostWork = z.infer<typeof AgentBrowserHostWorkSchema>;

export const AgentBrowserHostReportSchema = z.discriminatedUnion('ok', [
  z
    .object({
      requestId: z.string().uuid(),
      ok: z.literal(true),
      reply: AgentBrowserHostReplySchema,
    })
    .strict(),
  z
    .object({
      requestId: z.string().uuid(),
      ok: z.literal(false),
      error: z.string().min(1).max(1_000),
      ...BrowserWebMcpFields,
    })
    .strict(),
]);
export type AgentBrowserHostReport = z.infer<typeof AgentBrowserHostReportSchema>;

export const AgentBrowserHostLeaseSchema = AgentBrowserScopeSchema.pick({
  sessionId: true,
  browserId: true,
  runId: true,
});
export type AgentBrowserHostLease = z.infer<typeof AgentBrowserHostLeaseSchema>;

export const AgentBrowserRpcResultSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('browser/cancel'), ok: z.literal(true) }).strict(),
  z.object({ type: z.literal('browser/control'), ok: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('browser/host-status'),
      connected: z.boolean(),
      capabilities: BrowserHostCapabilitiesSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('browser/pause-all'),
      paused: z.array(AgentBrowserHostLeaseSchema).max(64),
    })
    .strict(),
  z
    .object({
      type: z.literal('browser/host'),
      version: z.literal(BROWSER_AGENT_PROTOCOL_VERSION),
      requests: z.array(AgentBrowserHostWorkSchema).max(8),
      revoke: z.array(AgentBrowserHostLeaseSchema).max(8),
    })
    .strict(),
  z.discriminatedUnion('ok', [
    z
      .object({
        type: z.literal('browser/execute'),
        ok: z.literal(true),
        reply: AgentBrowserReplySchema,
      })
      .strict(),
    z
      .object({
        type: z.literal('browser/execute'),
        ok: z.literal(false),
        error: z.string().min(1).max(1_000),
        ...BrowserWebMcpFields,
      })
      .strict(),
  ]),
]);
export type AgentBrowserRpcResult = z.infer<typeof AgentBrowserRpcResultSchema>;
