import { z } from 'zod';
import { SessionIdSchema } from './message-schemas';

export const BROWSER_HOST_POLL_INTERVAL_MS = 500;
export const BROWSER_HOST_TTL_MS = 3_000;
export const BROWSER_HOST_OPERATION_TIMEOUT_MS = 45_000;

const BrowserElementRefSchema = z
  .string()
  .max(64)
  .regex(/^(f\d+)?e\d+$/)
  .describe('Element ref such as e5 or f1e9 from the most recent snapshot.');

/** Per-action inputs; each is one `molly_browser` tool. The desktop resolves the actual page itself. */
export const AgentBrowserActionInputSchemas = {
  navigate: z
    .object({ url: z.string().min(1).max(2_048).describe('Destination URL.') })
    .strict(),
  snapshot: z.object({}).strict(),
  screenshot: z.object({}).strict(),
  click: z.object({ ref: BrowserElementRefSchema }).strict(),
  type: z
    .object({
      ref: BrowserElementRefSchema,
      text: z.string().max(2_000).describe('Text to type into the element.'),
    })
    .strict(),
  scroll: z
    .object({
      deltaY: z
        .number()
        .int()
        .min(-2_000)
        .max(2_000)
        .describe('Pixels to scroll; positive scrolls down.'),
    })
    .strict(),
  save_image: z.object({ ref: BrowserElementRefSchema }).strict(),
} as const;
export type AgentBrowserAction = keyof typeof AgentBrowserActionInputSchemas;

const inputs = AgentBrowserActionInputSchemas;
export const AgentBrowserCommandSchema = z.discriminatedUnion('kind', [
  inputs.navigate.extend({ kind: z.literal('navigate') }).strict(),
  inputs.snapshot.extend({ kind: z.literal('snapshot') }).strict(),
  inputs.screenshot.extend({ kind: z.literal('screenshot') }).strict(),
  inputs.click.extend({ kind: z.literal('click') }).strict(),
  inputs.type.extend({ kind: z.literal('type') }).strict(),
  inputs.save_image.extend({ kind: z.literal('save_image') }).strict(),
  inputs.scroll.extend({ kind: z.literal('scroll') }).strict(),
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
  .object({ url: BrowserUrlSchema, title: BrowserTitleSchema })
  .strict();

export const BrowserSnapshotSchema = BrowserPageStateSchema.extend({
  snapshot: z.string().max(50_000),
  truncated: z.boolean(),
}).strict();

export const BrowserSavedImageSchema = z
  .object({
    pageUrl: BrowserUrlSchema,
    imageUrl: BrowserUrlSchema,
    path: z.string().max(4_096),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mimeType: z.string().max(100),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    bytes: z.number().int().positive(),
  })
  .strict();

const ObservationReplySchemas = [
  BrowserPageStateSchema.extend({ kind: z.literal('page') }).strict(),
  BrowserSnapshotSchema.extend({ kind: z.literal('snapshot') }).strict(),
  z
    .object({
      kind: z.literal('image'),
      mimeType: z.literal('image/jpeg'),
      base64: z.string().max(2_800_000),
      pageUrl: BrowserUrlSchema,
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
  z.object({ type: z.literal('browser/host-status'), connected: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('browser/pause-all'),
      paused: z.array(AgentBrowserHostLeaseSchema).max(64),
    })
    .strict(),
  z
    .object({
      type: z.literal('browser/host'),
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
      })
      .strict(),
  ]),
]);
export type AgentBrowserRpcResult = z.infer<typeof AgentBrowserRpcResultSchema>;
