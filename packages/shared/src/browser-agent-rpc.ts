import { z } from 'zod';
import { SessionIdSchema } from './message-schemas';

export const BROWSER_HOST_POLL_INTERVAL_MS = 500;
export const BROWSER_HOST_TTL_MS = 3_000;
export const BROWSER_HOST_OPERATION_TIMEOUT_MS = 45_000;

/** Browser operations the Agent may request. The desktop resolves the actual page itself. */
const BrowserElementRefSchema = z
  .string()
  .max(64)
  .regex(/^(f\d+)?e\d+$/);

export const AgentBrowserCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), url: z.string().min(1).max(2_048) }).strict(),
  z.object({ kind: z.literal('snapshot') }).strict(),
  z.object({ kind: z.literal('screenshot') }).strict(),
  z
    .object({
      kind: z.literal('click'),
      ref: BrowserElementRefSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('type'),
      ref: BrowserElementRefSchema,
      text: z.string().max(2_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('save_image'),
      ref: BrowserElementRefSchema,
    })
    .strict(),
  z.object({ kind: z.literal('scroll'), deltaY: z.number().int().min(-2_000).max(2_000) }).strict(),
]);
export type AgentBrowserCommand = z.infer<typeof AgentBrowserCommandSchema>;

/**
 * Flat MCP presentation of the command union. Some OpenAI-compatible tool
 * adapters reduce a top-level JSON Schema union to an empty object. Keep the
 * actual operation contract above as the post-parse authority.
 */
export const AgentBrowserToolInputSchema = z
  .object({
    kind: z
      .enum(['navigate', 'snapshot', 'screenshot', 'click', 'type', 'save_image', 'scroll'])
      .describe('Browser action. Supply only the fields required by that action.'),
    url: z.string().max(2_048).optional().describe('Required for navigate: public HTTP(S) URL.'),
    ref: BrowserElementRefSchema.optional().describe(
      'Required for click, type, and save_image: upstream ref such as e5 from the current snapshot.'
    ),
    text: z.string().max(2_000).optional().describe('Required for type.'),
    deltaY: z
      .number()
      .int()
      .min(-2_000)
      .max(2_000)
      .optional()
      .describe('Required for scroll; positive scrolls down.'),
  })
  .strict();

export const AgentBrowserScopeSchema = z
  .object({
    sessionId: SessionIdSchema,
    browserId: z.string().regex(/^session-browser-[a-zA-Z0-9_-]{1,128}$/),
    runId: z.string().min(1).max(200),
    sites: z.array(z.string().min(1).max(253)).min(1).max(8),
  })
  .strict();
export type AgentBrowserScope = z.infer<typeof AgentBrowserScopeSchema>;

export const AgentBrowserReplySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().max(50_000) }).strict(),
  z
    .object({
      kind: z.literal('image'),
      mimeType: z.literal('image/jpeg'),
      base64: z.string().max(2_800_000),
      pageUrl: z.string().max(2_048),
    })
    .strict(),
]);
export type AgentBrowserReply = z.infer<typeof AgentBrowserReplySchema>;

export const AgentBrowserHostReplySchema = z.discriminatedUnion('kind', [
  ...AgentBrowserReplySchema.options,
  z
    .object({
      kind: z.literal('asset'),
      base64: z.string().max(7_000_000),
      pageUrl: z.string().max(2_048),
      imageUrl: z.string().max(2_048),
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
